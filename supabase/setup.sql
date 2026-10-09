-- it-works! setup. Run once in Supabase SQL Editor.
-- This replaces the earlier recursive room_members read policy and hardens write paths.

alter table public.room_members add column if not exists display_name text not null default 'Guest';

-- Keep color slots unique only among active members. Historical left members can reuse colors.
alter table public.room_members drop constraint if exists room_members_room_id_color_slot_key;
create unique index if not exists room_members_active_color_slot_idx
  on public.room_members(room_id, color_slot) where status = 'active';

-- Security-definer helper prevents recursive RLS checks on room_members.
create or replace function public.is_active_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.room_members rm
    where rm.room_id = p_room_id and rm.user_id = (select auth.uid()) and rm.status = 'active');
$$;
revoke all on function public.is_active_room_member(uuid) from public;
grant execute on function public.is_active_room_member(uuid) to authenticated;

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Members can view their rooms" on public.rooms;
drop policy if exists "Members can view room membership" on public.room_members;
drop policy if exists "Members can read room messages" on public.messages;
drop policy if exists "Active members can view their rooms" on public.rooms;
drop policy if exists "Active members can view room membership" on public.room_members;
drop policy if exists "Active members can read room messages" on public.messages;
create policy "Active members can view their rooms" on public.rooms for select to authenticated
  using (public.is_active_room_member(id));
create policy "Active members can view room membership" on public.room_members for select to authenticated
  using (public.is_active_room_member(room_id));
create policy "Active members can read room messages" on public.messages for select to authenticated
  using (public.is_active_room_member(room_id));

-- Remove earlier signatures so parameter defaults don't create ambiguous RPC overloads.
drop function if exists public.join_room(text);
drop function if exists public.join_room(text, text);
drop function if exists public.create_room();
drop function if exists public.create_room(text);
drop function if exists public.leave_room(uuid);
drop function if exists public.send_message(uuid, text);

create function public.create_room(p_custom_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid; v_code text; v_tries integer := 0;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  if nullif(trim(p_custom_code),'') is not null then
    v_code := upper(trim(p_custom_code));
    if v_code !~ '^[A-Z0-9_-]{3,12}$' then raise exception 'Room code must be 3–12 letters, numbers, hyphens, or underscores'; end if;
    insert into public.rooms(code,created_by) values(v_code,v_user) returning id into v_id;
  else
    loop
      v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
      begin
        insert into public.rooms(code,created_by) values(v_code,v_user) returning id into v_id;
        exit;
      exception when unique_violation then
        v_tries := v_tries + 1; if v_tries >= 5 then raise exception 'Could not generate a room code; retry'; end if;
      end;
    end loop;
  end if;
  return jsonb_build_object('room_id',v_id,'code',v_code);
end; $$;

create function public.join_room(p_code text, p_display_name text default 'Guest')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_room uuid; v_slot integer; v_name text := left(trim(coalesce(p_display_name,'Guest')),24); v_count integer;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  if nullif(trim(p_code),'') is null then raise exception 'Room code is required'; end if;
  if v_name = '' then v_name := 'Guest'; end if;
  select id into v_room from public.rooms where code = upper(trim(p_code)) and status = 'open' for update;
  if v_room is null then raise exception 'Room not found or closed'; end if;
  if exists(select 1 from public.room_members where room_id=v_room and user_id=v_user and status='active') then
    update public.room_members set display_name=v_name,last_seen_at=now() where room_id=v_room and user_id=v_user;
    return (select jsonb_build_object('room_id',v_room,'color_slot',color_slot,'display_name',display_name) from public.room_members where room_id=v_room and user_id=v_user);
  end if;
  select count(*) into v_count from public.room_members where room_id=v_room and status='active';
  if v_count >= 16 then raise exception 'Room is full (16/16)'; end if;
  select s into v_slot from generate_series(0,15) s where not exists(select 1 from public.room_members m where m.room_id=v_room and m.status='active' and m.color_slot=s) order by s limit 1;
  if v_slot is null then raise exception 'Room is full (16/16)'; end if;
  update public.room_members set color_slot=v_slot,display_name=v_name,status='active',joined_at=now(),last_seen_at=now() where room_id=v_room and user_id=v_user;
  if not found then insert into public.room_members(room_id,user_id,color_slot,display_name) values(v_room,v_user,v_slot,v_name); end if;
  return jsonb_build_object('room_id',v_room,'color_slot',v_slot,'display_name',v_name);
end; $$;

create function public.leave_room(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.room_members set status='left',last_seen_at=now()
  where room_id=p_room_id and user_id=(select auth.uid()) and status='active';
end; $$;

create function public.send_message(p_room_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_body text := trim(p_body); v_id bigint; v_time timestamptz;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  if v_body is null or char_length(v_body)<1 or char_length(v_body)>2000 then raise exception 'Message must contain 1–2000 characters'; end if;
  -- Serialize room membership/send/trim operations for capacity and retention safety.
  perform 1 from public.rooms r join public.room_members m on m.room_id=r.id
    where r.id=p_room_id and r.status='open' and m.user_id=v_user and m.status='active' for update of r;
  if not found then raise exception 'You are not an active member of this room'; end if;
  insert into public.messages(room_id,user_id,body) values(p_room_id,v_user,v_body) returning id,created_at into v_id,v_time;
  delete from public.messages where room_id=p_room_id and id not in
    (select id from public.messages where room_id=p_room_id order by created_at desc,id desc limit 100);
  return jsonb_build_object('id',v_id,'room_id',p_room_id,'user_id',v_user,'body',v_body,'created_at',v_time);
end; $$;

revoke all on function public.create_room(text) from public;
revoke all on function public.join_room(text,text) from public;
revoke all on function public.leave_room(uuid) from public;
revoke all on function public.send_message(uuid,text) from public;
grant execute on function public.create_room(text) to authenticated;
grant execute on function public.join_room(text,text) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.send_message(uuid,text) to authenticated;

-- No direct client writes are granted by this script. Writes go through the RPC functions.
