# Single-User Supabase Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the whole CRM behind a Google login restricted to the owner, and lock every Supabase table's RLS to that one user — without breaking the live site or locking the owner out.

**Architecture:** A frontend `AuthGate` requires a Supabase session (Google OAuth) whose email equals the owner's before rendering the app; the Supabase JS client auto-attaches the user's JWT so RLS can enforce the same rule server-side. The database change is staged: add owner policies first (additive, safe), verify login end-to-end, then drop the public policies as the final cutover.

**Tech Stack:** React + Vite, `@supabase/supabase-js` (Auth + PostgREST), Supabase Postgres RLS.

**Notes for the implementer:**
- This repo has **no automated test framework**. "Verify" steps are manual: `npm run build`, the local dev servers (see the `run-teacher-crm` skill), a browser, and `curl` against the live Supabase REST API. That is how this project has always verified — do not scaffold a test runner.
- There is **one** Supabase project, shared by local dev and production. SQL you run affects both immediately. This is why Block A (additive) is safe and Block B (cutover) is last.
- Dashboard steps (Supabase Auth, Google Cloud) are performed by the owner (Avner); the implementer guides and then verifies the result.
- Docs (`docs/ARCHITECTURE.md`, `docs/TODO.md`, feature log) are updated by the `close-teacher-crm-feature` skill at close-out. If those files already exist on the branch (PR #15 merged), update them there too; otherwise leave them to close-out.
- The owner email is hardcoded as `avnamer@gmail.com` in the SQL and defaulted in the frontend (`VITE_ALLOWED_EMAIL` overrides the frontend default only — the SQL literal is the authoritative gate).

---

## File structure

- Create `frontend/src/lib/auth.js` — owner-email constant + `signInWithGoogle()` / `signOut()` helpers. One responsibility: auth actions/config.
- Create `frontend/src/pages/Login.jsx` — the login screen (Google button).
- Create `frontend/src/components/AuthGate.jsx` — session gate wrapping the app.
- Modify `frontend/src/App.jsx` — wrap routes in `AuthGate`; remove the `/book` route + import.
- Modify `frontend/src/components/Navbar.jsx` — add a sign-out button.
- Delete `frontend/src/pages/BookMeeting.jsx` — the public booking page.
- Modify `supabase-setup.sql` — append **Block A** (owner policies) and **Block B** (drop public policies).

---

## Task 1: Enable Google auth in Supabase + Google Cloud (dashboard, guided)

No code. This must happen before the frontend that requires login is deployed, and it enables local login testing.

**Files:** none.

- [ ] **Step 1: Create/point a Google OAuth client at Supabase's callback**

In Google Cloud Console → the existing "Teacher-CRM" project → APIs & Services → Credentials.
Create (or reuse) an OAuth 2.0 Client ID of type **Web application**, and add this Authorized redirect URI:
`https://ltfguyjrwrcghllvrixu.supabase.co/auth/v1/callback`
Copy the **Client ID** and **Client secret**.

- [ ] **Step 2: Enable the Google provider in Supabase**

Supabase dashboard → project `ltfguyjrwrcghllvrixu` → Authentication → Providers → **Google** → enable, paste the Client ID + secret from Step 1, save.

- [ ] **Step 3: Set Site URL and Redirect URLs**

Supabase → Authentication → URL Configuration:
- **Site URL:** `https://comforting-pegasus-780af0.netlify.app`
- **Redirect URLs:** add both `https://comforting-pegasus-780af0.netlify.app/**` and `http://localhost:5173/**`

- [ ] **Step 4: Verify the provider is live**

Owner confirms the Google provider shows "Enabled" in Supabase. (Full sign-in is verified in Task 6 once the frontend exists.)

---

## Task 2: Remove the public booking page

**Files:**
- Delete: `frontend/src/pages/BookMeeting.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Delete the page**

```bash
git rm frontend/src/pages/BookMeeting.jsx
```

- [ ] **Step 2: Remove the import and route in `frontend/src/App.jsx`**

Delete the import line `import BookMeeting from './pages/BookMeeting.jsx'` and the block:

```jsx
      {/* Public route - no layout */}
      <Route path="/book/:contactId" element={<BookMeeting />} />

```

- [ ] **Step 3: Verify the build still passes**

Run: `cd frontend && npm run build`
Expected: build succeeds with no error referencing `BookMeeting`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx frontend/src/pages/BookMeeting.jsx
git commit -m "Remove the public /book booking page"
```

---

## Task 3: Add the auth config + login screen

**Files:**
- Create: `frontend/src/lib/auth.js`
- Create: `frontend/src/pages/Login.jsx`

- [ ] **Step 1: Create `frontend/src/lib/auth.js`**

```js
import { supabase } from './supabase.js'

// The only account allowed into the app. The frontend uses this for UX only —
// the authoritative gate is the Supabase RLS policy on every table.
export const ALLOWED_EMAIL = (
  import.meta.env.VITE_ALLOWED_EMAIL || 'avnamer@gmail.com'
).toLowerCase()

export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
}

export function signOut() {
  return supabase.auth.signOut()
}
```

- [ ] **Step 2: Create `frontend/src/pages/Login.jsx`**

```jsx
import { signInWithGoogle } from '../lib/auth.js'

export default function Login() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
        <div className="text-4xl mb-3">🎓</div>
        <h1 className="text-xl font-bold text-gray-800 mb-1">Teacher CRM</h1>
        <p className="text-gray-500 text-sm mb-6">התחברות נדרשת כדי להיכנס למערכת</p>
        <button
          onClick={() => signInWithGoogle()}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors"
        >
          התחבר עם Google
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify the build passes**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/auth.js frontend/src/pages/Login.jsx
git commit -m "Add Google login screen and auth helpers"
```

---

## Task 4: Add the AuthGate and wrap the app

**Files:**
- Create: `frontend/src/components/AuthGate.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Create `frontend/src/components/AuthGate.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { ALLOWED_EMAIL, signOut } from '../lib/auth.js'
import Login from '../pages/Login.jsx'

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) =>
      setSession(s ?? null)
    )
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">טוען...</p>
      </div>
    )
  }

  if (!session) return <Login />

  const email = (session.user?.email || '').toLowerCase()
  if (email !== ALLOWED_EMAIL) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-3">🚫</div>
          <h1 className="text-xl font-bold text-gray-800 mb-1">אין הרשאה</h1>
          <p className="text-gray-500 text-sm mb-6">
            החשבון {email} אינו מורשה לגשת למערכת.
          </p>
          <button
            onClick={() => signOut()}
            className="w-full bg-gray-600 hover:bg-gray-700 text-white font-medium py-2.5 rounded-lg"
          >
            התנתק
          </button>
        </div>
      </div>
    )
  }

  return children
}
```

- [ ] **Step 2: Wrap the routes in `frontend/src/App.jsx`**

Add the import at the top:

```jsx
import AuthGate from './components/AuthGate.jsx'
```

Wrap the returned `<Routes>` so the whole file's `App` reads:

```jsx
function App() {
  return (
    <AuthGate>
      <Routes>
        {/* Admin routes with layout */}
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/contacts" replace />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/contacts/:id" element={<ContactDetail />} />
          <Route path="/mentors" element={<Mentors />} />
          <Route path="/whatsapp" element={<WhatsApp />} />
          <Route path="/meetings" element={<Meetings />} />
          <Route path="/voice-log" element={<VoiceLog />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuthGate>
  )
}
```

- [ ] **Step 3: Verify the build passes**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AuthGate.jsx frontend/src/App.jsx
git commit -m "Gate the app behind login via AuthGate"
```

---

## Task 5: Add a sign-out button to the navbar

**Files:**
- Modify: `frontend/src/components/Navbar.jsx`

- [ ] **Step 1: Import the sign-out helper**

Add to the top of `frontend/src/components/Navbar.jsx` (below the existing imports):

```jsx
import { signOut } from '../lib/auth.js'
```

- [ ] **Step 2: Add the desktop sign-out button**

Inside the desktop nav container (`<div className="hidden md:flex items-center gap-1">`), after the `{links.map(...)}` block and before its closing `</div>`, add:

```jsx
            <button
              onClick={() => signOut()}
              className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              <span className="ml-1">🚪</span>
              התנתק
            </button>
```

- [ ] **Step 3: Add the mobile sign-out button**

Inside the mobile menu (`{mobileOpen && (...)}`), after the `{links.map(...)}` block and before the closing `</div>`, add:

```jsx
            <button
              onClick={() => { setMobileOpen(false); signOut() }}
              className="block w-full text-right px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              <span className="ml-1">🚪</span>
              התנתק
            </button>
```

- [ ] **Step 4: Verify the build passes**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Navbar.jsx
git commit -m "Add sign-out button to the navbar"
```

---

## Task 6: Local verification of the auth flow (before any DB change)

At this point the DB is still fully public, so the app must still work, and login must succeed.

**Files:** none.

- [ ] **Step 1: Start the app locally**

Use the `run-teacher-crm` skill (backend on 3001, frontend on 5173).

- [ ] **Step 2: Verify the login gate**

Open `http://localhost:5173`. Expected: the **Login** screen (not the dashboard).

- [ ] **Step 3: Sign in as the owner**

Click "התחבר עם Google", complete Google sign-in as `avnamer@gmail.com`. Expected: redirected back and the dashboard loads; contacts render (DB still public, so data loads).

- [ ] **Step 4: Verify sign-out**

Click "התנתק". Expected: back to the Login screen.

- [ ] **Step 5: Verify a non-owner is refused (UX gate)**

Sign in with a different Google account. Expected: the "אין הרשאה" screen with a sign-out button. Sign out afterward.

Do not proceed to Task 7 until Steps 2–5 all pass.

---

## Task 7: Block A — add owner RLS policies (additive, safe)

**Files:**
- Modify: `supabase-setup.sql` (append)

- [ ] **Step 1: Append Block A to `supabase-setup.sql`**

```sql

-- ─────────────────────────────────────────────────────────────
-- Single-user auth (2026-09-14) — BLOCK A: owner policies
-- Safe to run at any time. Additive only: it grants the logged-in
-- owner access without changing existing public access. Run this,
-- verify login works (Task 8), THEN run Block B.
-- ─────────────────────────────────────────────────────────────
CREATE POLICY "Owner full access" ON contacts           FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON interactions        FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON meetings            FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON message_templates   FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON settings            FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON whatsapp_auth       FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON scheduled_messages  FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON mentors             FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON pending_voice_logs  FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
```

- [ ] **Step 2: Run Block A on the live database**

Owner runs the Block A statements in the Supabase SQL editor.
Expected: "Success. No rows returned." (If a policy name already exists from a prior run, drop it first — but on a clean project this runs once.)

- [ ] **Step 3: Verify nothing broke**

Reload the locally-running app (still signed in as owner). Expected: everything still loads and works exactly as before (public policies are still present, so the anon path is unaffected and the owner now also has an explicit policy).

- [ ] **Step 4: Commit**

```bash
git add supabase-setup.sql
git commit -m "Add Block A owner RLS policies (additive)"
```

---

## Task 8: Deploy the frontend to production, verify login live

The staged rollout requires the login-gated frontend to be live and working **before** the public policies are removed.

**Files:** none (deploy).

- [ ] **Step 1: Ship via the close flow**

Merge this branch to `main` (this is normally done by the `close-teacher-crm-feature` skill: PR → merge → Netlify production deploy). Because Block A is already applied, the owner has DB access; because the public policies are still present, nothing else breaks during this window.

- [ ] **Step 2: Verify production login**

Open `https://comforting-pegasus-780af0.netlify.app`. Expected: the Login screen. Sign in as `avnamer@gmail.com`. Expected: dashboard loads, data renders, sign-out works.

Do not proceed to Task 9 until production login is confirmed working.

---

## Task 9: Block B — remove public policies (the cutover)

**Files:**
- Modify: `supabase-setup.sql` (append)

- [ ] **Step 1: Append Block B to `supabase-setup.sql`**

```sql

-- ─────────────────────────────────────────────────────────────
-- Single-user auth (2026-09-14) — BLOCK B: remove public access
-- THE CUTOVER. Run ONLY after production login is verified (Task 8).
-- Drops every world-open policy and every any-authenticated policy,
-- leaving only the "Owner full access" policies from Block A.
-- ─────────────────────────────────────────────────────────────
-- Old any-authenticated policies (auth.role() = 'authenticated' — would let ANY signed-in Google user in)
DROP POLICY IF EXISTS "Authenticated users full access" ON contacts;
DROP POLICY IF EXISTS "Authenticated users full access" ON interactions;
DROP POLICY IF EXISTS "Authenticated users full access" ON meetings;
DROP POLICY IF EXISTS "Authenticated users full access" ON message_templates;
DROP POLICY IF EXISTS "Authenticated users full access" ON settings;
DROP POLICY IF EXISTS "Authenticated users full access" ON whatsapp_auth;
DROP POLICY IF EXISTS "Authenticated users full access" ON scheduled_messages;
-- Public (anon) policies
DROP POLICY IF EXISTS "Public can read contacts by phone" ON contacts;
DROP POLICY IF EXISTS "Public full access to interactions" ON interactions;
DROP POLICY IF EXISTS "Public can read available meetings" ON meetings;
DROP POLICY IF EXISTS "Public can insert meetings" ON meetings;
DROP POLICY IF EXISTS "Public full access to message_templates" ON message_templates;
DROP POLICY IF EXISTS "Public can read settings" ON settings;
DROP POLICY IF EXISTS "Public can update settings" ON settings;
DROP POLICY IF EXISTS "Public full access to scheduled_messages" ON scheduled_messages;
DROP POLICY IF EXISTS "Public full access to mentors" ON mentors;
DROP POLICY IF EXISTS "Public full access to pending_voice_logs" ON pending_voice_logs;
```

- [ ] **Step 2: Run Block B on the live database**

Owner runs the Block B statements in the Supabase SQL editor.
Expected: "Success. No rows returned."

- [ ] **Step 3: Verify the app still works as the owner**

Reload production (`comforting-pegasus-780af0.netlify.app`) signed in as owner. Expected: contacts, interactions, meetings, settings, WhatsApp, voice-log, mentors all still load and save. (These now go through the "Owner full access" policy with the owner's JWT.)

- [ ] **Step 4: Verify the public exposure is closed (anon probe)**

Run (the same technique used to confirm the Step 0 token fix — pulls the live anon key from the bundle, then queries as anon):

```bash
SITE=https://comforting-pegasus-780af0.netlify.app
JS=$(curl -s $SITE | grep -oE '/assets/[^"]+\.js' | head -1)
B=$(curl -s "$SITE$JS")
URL=$(echo "$B" | grep -oE 'https://[a-z0-9]+\.supabase\.co' | head -1)
KEY=$(echo "$B" | grep -oE 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' | head -1)
for t in contacts interactions settings mentors; do
  echo -n "$t -> "; curl -s "$URL/rest/v1/$t?select=*&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"; echo
done
```

Expected: every table returns `[]` (empty) — the anon key can no longer read any data.

- [ ] **Step 5: Commit**

```bash
git add supabase-setup.sql
git commit -m "Add Block B: remove public RLS policies (cutover)"
```

---

## Task 10: Close-out (docs + deploy of Block B commit)

- [ ] **Step 1: Update docs**

If `docs/ARCHITECTURE.md` / `docs/TODO.md` exist on the branch, update the auth section (no longer "no authentication"; note single-user RLS gate) and remove the auth item from `docs/TODO.md`. Otherwise the `close-teacher-crm-feature` skill handles docs and the feature-log row.

- [ ] **Step 2: Finish via the close skill**

Use `close-teacher-crm-feature` to commit any remaining doc changes, ensure the branch is merged, and record the feature. (Block B's SQL commit is documentation of what was run; the live change was made in Step 2 of Task 9.)

---

## Rollback

If login is misconfigured and the owner is locked out after Block B, restore access from the Supabase SQL editor (always reachable — it runs as the service role, which bypasses RLS) by temporarily re-adding a public policy on the needed table, e.g.:

```sql
CREATE POLICY "TEMP public read" ON settings FOR SELECT USING (true);
```

Then fix the Google/Supabase auth config and re-run Block B's relevant drop.
