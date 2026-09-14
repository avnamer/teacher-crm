# Design: Single-User Authentication (Supabase Auth)

**Status:** Approved for planning (2026-09-14)
**Builds on:** the Step 0 hardening (PR #14 — Google tokens moved to `app_private`, CORS scoped)

## Problem

The frontend talks to Supabase with the public **anon** key that ships in the JS
bundle, and every table's RLS policy is `USING (true)` — world-readable and
world-writable. Anyone who opens the site can read all teacher contacts and
interaction history, and insert/update/delete rows. Step 0 closed the Google-token
leak; this step closes the data exposure itself by putting the whole app behind a
login and restricting the database to the one authorized user.

## Goal

- Only Avner can read or write the CRM's data, enforced **server-side** by Supabase
  RLS (not just hidden in the UI).
- Login is Google sign-in, restricted to `avnamer@gmail.com`.
- The rollout never breaks the live site and never locks Avner out of his own data.

## Non-goals (explicitly out of scope)

- **Multi-mentor accounts.** Single user only. The existing `mentor_name` scoping is
  left as-is.
- **Backend JWT verification.** The Node/Express backend keeps using its service key
  and stays protected by CORS + the Anthropic spend limit. Requiring a valid user JWT
  on the backend endpoints is a separate follow-up (Step 1b).
- **Dropping the legacy `meetings` table.** It is still read by `ContactDetail.jsx`;
  it gets locked by RLS like every other table but is not removed here.

## Decisions (settled during brainstorming)

1. **Who logs in:** only Avner (single-user gate).
2. **Method:** Google sign-in, restricted to `avnamer@gmail.com`.
3. **Public booking page `/book`:** removed — no longer used.
4. **Scope:** login + database (RLS) lock only; backend untouched beyond Step 0.
5. **Rollout:** staged and reversible — add authenticated policies first, verify, then
   remove the public ones as the final cutover.

## Architecture

### 1. Frontend authentication

- **`AuthGate`** component wrapping the routed app:
  - No Supabase session → render the **Login** screen.
  - Session whose email ≠ `avnamer@gmail.com` → render a "no access" screen with a
    sign-out button (defense-in-depth; the real gate is RLS).
  - Session with the allowed email → render the app as today.
- **Login screen:** a single "התחבר עם Google" button calling
  `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`.
- **Sign-out** control in the app header/layout (`supabase.auth.signOut()`).
- The existing `frontend/src/lib/supabase.js` client already persists the session and
  automatically attaches the user's JWT to every PostgREST request, so once logged in,
  RLS sees `auth.jwt()` / `auth.uid()` with no per-call change. Session state is read
  via `supabase.auth.getSession()` + `onAuthStateChange`.
- The allowed email lives in one place the frontend can read for the UX check
  (`VITE_ALLOWED_EMAIL`, defaulting to `avnamer@gmail.com`). It is only UX — the
  authoritative check is the RLS policy.

### 2. Supabase Auth configuration (dashboard — Avner, guided)

- Enable the **Google** provider in Supabase Auth.
- Register Supabase's callback (`https://ltfguyjrwrcghllvrixu.supabase.co/auth/v1/callback`)
  as an authorized redirect URI on a Google Cloud OAuth client (reuse the existing
  Google Cloud project). This is separate from the backend's Calendar OAuth client.
- Set **Site URL** and **Redirect URLs** to the Netlify site and `http://localhost:5173`.

### 3. Database — RLS lock (the core change)

For every application table —
`contacts`, `interactions`, `pending_voice_logs`, `settings`, `mentors`,
`message_templates`, `meetings`, `scheduled_messages`, `whatsapp_auth` —
replace the public `USING (true)` policy with one that requires the authorized user:

```sql
CREATE POLICY "Owner full access" ON <table>
  FOR ALL
  USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
```

- `app_private` is unchanged (RLS on, no policy — backend service key only).
- The migration is written to `supabase-setup.sql` (appended, per the file's
  convention) in **two clearly separated, independently runnable blocks**:
  - **Block A — add owner policies.** Safe to run at any time; it only *adds* access
    for the logged-in owner and changes nothing for existing anon traffic.
  - **Block B — remove public policies.** The cutover. Drops every `USING (true)`
    policy (the pre-existing public ones and the Step-0-era public read/insert
    policies on `meetings`/`settings`). Run only after login is verified working.

### 4. Remove the public booking page

- Delete `frontend/src/pages/BookMeeting.jsx` and its `/book/:contactId` route in
  `frontend/src/App.jsx`.
- Keep the `meetings` table (now RLS-locked); its removal is a separate cleanup.

## Rollout order (this is the safety mechanism)

1. Ship the frontend auth (AuthGate + Login + sign-out) and remove `/book`.
2. Configure Supabase Auth + Google provider (dashboard).
3. Run **Block A** (add owner policies) — nothing breaks; anon still works, owner now
   also has access.
4. Log in and verify the whole app works as the owner; verify a different Google
   account sees nothing.
5. Run **Block B** (remove public policies) — the cutover.
6. Verify with the public-anon-key probe that `contacts`/`interactions`/`settings`
   return empty/blocked for anon (the same probe used to confirm the Step 0 token fix).

## Testing (manual — no automated suite in this repo)

- **Login:** Google sign-in with `avnamer@gmail.com` lands in the app; sign-out returns
  to the login screen.
- **Wrong account:** signing in with a different Google account shows the "no access"
  screen, and (after Block B) reads/writes return nothing at the database level.
- **App regression while logged in:** contacts table + column manager, contact detail,
  interactions/journal, meetings page (add/edit/delete), WhatsApp send queue, voice-log
  record→pending→approve, settings + CSV import, mentors — all still work.
- **Anon probe after Block B:** the public anon key returns zero rows for `contacts`,
  `interactions`, and `settings`.
- **Backend still works while logged in:** voice-log analyze and Calendar create-event
  still succeed (backend unchanged).

## Risks & rollback

- **Lock-out risk.** Block B is the only dangerous step and it is last and reversible.
  If login is misconfigured, re-adding a temporary `USING (true)` policy on the needed
  table via the SQL editor (always reachable with the dashboard/service role) restores
  access while the auth config is fixed.
- **OAuth redirect misconfig** is the most likely snag; caught at step 4 before any
  public policy is removed.
