(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  const views = [
    'homeView',
    'createRoomView',
    'joinRoomView',
    'loginView',
    'signupView',
    'chatView'
  ];

  const palette = [
    '#a020f0', '#00c853', '#2962ff', '#ffea00',
    '#f062d0', '#ff1744', '#00e5ff', '#ff9100',
    '#76ff03', '#651fff', '#ff4081', '#00bfa5',
    '#ffd740', '#7c4dff', '#f50057', '#40c4ff'
  ];

  let sb = null;
  let user = null;
  let room = null;
  let slot = 0;
  let displayName = 'Guest';
  let channel = null;
  let toastTimer = null;
  let bootPromise = null;

  function show(id) {
    views.forEach(view => {
      $(view).classList.toggle('active', view === id);
    });
  }

  function toast(message) {
    const element = $('toast');
    element.textContent = message;
    element.classList.remove('hidden');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      element.classList.add('hidden');
    }, 3200);
  }

  function fail(id, error) {
    $(id).textContent = error?.message || String(error);
  }

  async function ensureReady() {
    if (!bootPromise) {
      throw new Error('The app is still starting. Refresh and try again.');
    }

    await bootPromise;

    if (!sb) {
      throw new Error(
        'Supabase is not connected. Check assets/js/config.js.'
      );
    }
  }

  async function rpc(name, args) {
    await ensureReady();

    const { data, error } = await sb.rpc(name, args);

    if (error) throw error;

    return data;
  }

  function userLabel() {
    $('identity').textContent = user
      ? (user.is_anonymous ? 'Guest' : displayName)
      : 'Not signed in';

    $('signOutBtn').hidden = !user;
  }

  function color(slotNumber) {
    return palette[Number(slotNumber)] || palette[0];
  }

  function addMessage(message) {
    const row = document.createElement('div');
    row.className = 'message';

    const dot = document.createElement('span');
    dot.className = 'message-dot';
    dot.style.background = message.color || color(message.color_slot);

    const body = document.createElement('div');
    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const name = document.createElement('span');
    name.className = 'message-name';
    name.style.color = message.color || color(message.color_slot);
    name.textContent =
      message.display_name || message.name || 'Guest';

    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = new Date(
      message.created_at || message.createdAt || Date.now()
    ).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    meta.append(name, time);

    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = message.body || message.text || '';

    body.append(meta, text);
    row.append(dot, body);
    $('messages').append(row);
  }

  async function renderRoom() {
    await ensureReady();

    if (!room) return;

    $('activeRoomCode').textContent = room.code;
    $('messages').replaceChildren();

    const { data: members, error: memberError } = await sb
      .from('room_members')
      .select('user_id,display_name,color_slot,status')
      .eq('room_id', room.id)
      .eq('status', 'active');

    if (memberError) throw memberError;

    $('participantCount').textContent =
      `${members.length}/16 people`;

    const mine = members.find(member => member.user_id === user.id);

    if (mine) {
      slot = mine.color_slot;
      displayName = mine.display_name;
    }

    const { data: messages, error: messageError } = await sb
      .from('messages')
      .select('id,room_id,user_id,body,created_at')
      .eq('room_id', room.id)
      .order('created_at', { ascending: true })
      .limit(100);

    if (messageError) throw messageError;

    for (const message of messages) {
      const member = members.find(
        item => item.user_id === message.user_id
      );

      addMessage({
        ...message,
        display_name: member?.display_name || 'Guest',
        color_slot: member?.color_slot ?? 0
      });
    }

    $('messages').scrollTop = $('messages').scrollHeight;
  }

  async function subscribe() {
    await ensureReady();

    if (channel) {
      await sb.removeChannel(channel);
    }

    channel = sb
      .channel('room-' + room.id)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `room_id=eq.${room.id}`
        },
        async payload => {
          try {
            const { data: members, error } = await sb
              .from('room_members')
              .select('user_id,display_name,color_slot')
              .eq('room_id', room.id)
              .eq('status', 'active');

            if (error) throw error;

            const member = members.find(
              item => item.user_id === payload.new.user_id
            );

            addMessage({
              ...payload.new,
              display_name: member?.display_name || 'Guest',
              color_slot: member?.color_slot ?? 0
            });

            $('messages').scrollTop = $('messages').scrollHeight;
          } catch (error) {
            toast(error.message);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_members',
          filter: `room_id=eq.${room.id}`
        },
        () => {
          renderRoom().catch(error => toast(error.message));
        }
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR') {
          toast('Live updates failed. Check Supabase Realtime settings.');
        }
      });
  }

  async function enter(code) {
    const result = await rpc('join_room', {
      p_code: code,
      p_display_name: displayName
    });

    room = {
      id: result.room_id,
      code: code.toUpperCase()
    };

    slot = result.color_slot;
    displayName = result.display_name || displayName;

    await renderRoom();
    await subscribe();

    show('chatView');
    toast('Joined ' + room.code);
  }

  async function guest() {
    await ensureReady();

    const { data, error } = await sb.auth.signInAnonymously();

    if (error) throw error;

    user = data.user;
    displayName = 'Guest';
    userLabel();
    show('homeView');
  }

  async function boot() {
    if (
      !window.supabase ||
      !window.IT_WORKS_SUPABASE_URL ||
      window.IT_WORKS_SUPABASE_URL.includes('PASTE_') ||
      !window.IT_WORKS_SUPABASE_PUBLISHABLE_KEY ||
      window.IT_WORKS_SUPABASE_PUBLISHABLE_KEY.includes('PASTE_')
    ) {
      $('homeError').textContent =
        'Add your Supabase Project URL and publishable key in assets/js/config.js.';
      return;
    }

    sb = window.supabase.createClient(
      window.IT_WORKS_SUPABASE_URL,
      window.IT_WORKS_SUPABASE_PUBLISHABLE_KEY
    );

    const { data, error } = await sb.auth.getSession();

    if (error) throw error;

    user = data.session?.user || null;

    if (!user) {
      const result = await sb.auth.signInAnonymously();

      if (result.error) throw result.error;

      user = result.data.user;
    }

    userLabel();
  }

  document.querySelectorAll('[data-go]').forEach(button => {
    button.addEventListener('click', () => {
      show(button.dataset.go);
    });
  });

  $('brand').addEventListener('click', () => show('homeView'));

  $('guestLogin').addEventListener('click', () => {
    guest().catch(error => fail('loginError', error));
  });

  $('guestSignup').addEventListener('click', () => {
    guest().catch(error => fail('signupError', error));
  });

  $('signupForm').addEventListener('submit', async event => {
    event.preventDefault();
    fail('signupError', '');

    const name = $('signupUsername').value.trim();
    const password = $('signupPassword').value;

    if (!/^[A-Za-z0-9_]{3,24}$/.test(name)) {
      fail(
        'signupError',
        new Error('Use 3–24 letters, numbers, or underscores.')
      );
      return;
    }

    if (password !== $('confirmPassword').value) {
      fail('signupError', new Error('Passwords do not match.'));
      return;
    }

    try {
      await ensureReady();

      const { data, error } = await sb.auth.signUp({
        email: `${name.toLowerCase()}@users.it-works.invalid`,
        password,
        options: {
          data: { username: name }
        }
      });

      if (error) throw error;

      if (!data.session) {
        throw new Error(
          'Email confirmation is enabled. Disable it in Supabase Authentication settings to use username-only accounts.'
        );
      }

      user = data.user;
      displayName = name;
      userLabel();

      event.target.reset();
      show('homeView');
      toast('Account created.');
    } catch (error) {
      fail('signupError', error);
    }
  });

  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    fail('loginError', '');

    const name = $('loginUsername').value.trim();

    try {
      await ensureReady();

      const { data, error } = await sb.auth.signInWithPassword({
        email: `${name.toLowerCase()}@users.it-works.invalid`,
        password: $('loginPassword').value
      });

      if (error) throw error;

      user = data.user;
      displayName = user.user_metadata?.username || name;
      userLabel();

      event.target.reset();
      show('homeView');
      toast('Logged in.');
    } catch (error) {
      fail('loginError', error);
    }
  });

  $('createRoomForm').addEventListener('submit', async event => {
    event.preventDefault();
    fail('createError', '');

    try {
      const custom = $('customCode').value.trim() || null;

      const result = await rpc('create_room', {
        p_custom_code: custom
      });

      await enter(result.code);
      event.target.reset();
    } catch (error) {
      fail('createError', error);
    }
  });

  $('joinRoomForm').addEventListener('submit', async event => {
    event.preventDefault();
    fail('joinError', '');

    try {
      await enter($('joinCode').value.trim());
      event.target.reset();
    } catch (error) {
      fail('joinError', error);
    }
  });

  $('messageForm').addEventListener('submit', async event => {
    event.preventDefault();

    const body = $('messageInput').value.trim();

    if (!room || !body) return;

    const button = event.submitter;
    if (button) button.disabled = true;

    try {
      await rpc('send_message', {
        p_room_id: room.id,
        p_body: body
      });

      $('messageInput').value = '';
    } catch (error) {
      toast(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  });

  $('leaveBtn').addEventListener('click', async () => {
    if (!room) return;

    try {
      await rpc('leave_room', {
        p_room_id: room.id
      });
    } catch (error) {
      toast(error.message);
    }

    if (channel) {
      await sb.removeChannel(channel);
      channel = null;
    }

    room = null;
    show('homeView');
  });

  $('signOutBtn').addEventListener('click', async () => {
    try {
      await ensureReady();

      if (room && channel) {
        await sb.removeChannel(channel);
      }

      room = null;
      channel = null;

      await sb.auth.signOut();
      user = null;

      await guest();
      userLabel();
    } catch (error) {
      toast(error.message);
    }
  });

  bootPromise = boot().catch(error => {
    $('homeError').textContent = error.message;
    throw error;
  });

  // Attach a rejection handler to avoid an unhandled promise warning.
  bootPromise.catch(() => {});
})();
