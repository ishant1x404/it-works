# it-works!) — Supabase-connected frontend

This is a static frontend for an anonymous, text-only room messenger. It uses Supabase Auth, Postgres RPC functions, and Realtime.

## 1. Configure the frontend

Edit `assets/js/config.js` and replace the two placeholders with:
- Project URL from Supabase → Project Settings → Data API (or API Keys)
- Publishable key beginning with `sb_publishable_` from Project Settings → API Keys

Never place a secret or `service_role` key in frontend code.

## 2. Set up the database

In Supabase → SQL Editor, open a new query, paste all of `supabase/setup.sql`, and run it. This script replaces the earlier read policies and RPC functions. Review the script before running if you have data you need to preserve: it drops and recreates the named RPC functions.

The original tables `rooms`, `room_members`, and `messages` must already exist as created in the earlier setup.

## 3. Auth settings

In Authentication → Sign In / Providers:
- Enable **Allow anonymous sign-ins**.
- Keep **Allow new users to sign up** enabled.
- For username/password accounts using the username-only UI, disable **Confirm email**. These accounts use synthetic addresses at `users.it-works.invalid`; this means standard email recovery is not available. For a public production app, use real email addresses or implement a trusted server-side username mapping and account recovery.

## 4. Realtime

The `messages` and `room_members` tables should be in the `supabase_realtime` publication. If not, run:

```sql
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.room_members;
```

If a table is already present, skip its `alter publication` statement.

## 5. Deploy

Commit the project contents to your GitHub repository. Enable GitHub Pages from Settings → Pages, using the `main` branch and `/ (root)` if desired. Wait for deployment and test with two separate browsers/devices.

## Important limitations

- The browser client uses only the publishable key; all writes are through security-definer RPC functions.
- This is a starter implementation, not a security audit. Test room capacity, concurrent joins, account recovery, and RLS before sharing widely.
- Anonymous identities are device/browser-specific and may be lost if browser storage is cleared.
