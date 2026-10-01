# WhatsApp Sync — Session Handoff (2026-09-30, end of day)

Purpose of this file: let a **new** conversation/context window pick up exactly
where this one left off, with zero re-derivation. Read this file fully before
doing anything else.

## Project location

- Worktree (work happens here): `C:\Users\Avner\teacher-crm-worktrees\whatsapp-sync`
- Branch: `feature/whatsapp-sync`
- Main checkout — **never switch branches there, never run its dev servers
  without checking first** (this has caused port collisions with this
  worktree multiple times this session): `C:\Users\Avner\teacher-crm`
- Backend dev server: `http://localhost:3001`
- Frontend dev server: `http://localhost:5173`

## How to resume (do this first)

1. Check if the dev servers are already running and belong to THIS worktree
   (not the main checkout, not another Claude session):
   ```
   Get-NetTCPConnection -LocalPort 3001,5173 -State Listen
   ```
   For any PID found, confirm its command line points at this worktree path
   before trusting it — `(Get-CimInstance Win32_Process -Filter "ProcessId=X").CommandLine`.
2. If not running:
   - Backend: `cd C:\Users\Avner\teacher-crm-worktrees\whatsapp-sync\backend && node server.js` (background)
   - Frontend: `cd C:\Users\Avner\teacher-crm-worktrees\whatsapp-sync\frontend && npm run dev` (background)
3. Tell the user the servers are up and ask them to reload the extension at
   `chrome://extensions` — it should show version **1.0.30** /
   version_name **2026-09-30-30** (see "build/version convention" below for
   why this matters).
4. **First real task**: clear דודי's (Dudi's) sync cursor and run one sync to
   confirm the last fix (a full revert of a retry mechanism, untested as of
   session end) actually restored full-conversation capture. See "Immediate
   next step" below for exact details.

## What this feature is

A Manifest V3 Chrome extension (read-only, no unofficial WhatsApp libraries,
never sends messages) that syncs WhatsApp DM/group conversations — text and
voice, with Whisper transcription for voice — into the Teacher CRM's
interaction timeline. Spec lives in the main project's
`docs/superpowers/specs/` (search for "whatsapp-sync").

## Current state: CONFIRMED WORKING

- **ענת נקש** (Anat, 972505964491) — her full conversation (text + all 6
  voice messages) syncs correctly end-to-end, transcripts are accurate and
  coherent, confirmed by the user directly reading the CRM output against
  the real WhatsApp chat. This is the reference "it works" case.
- Core architecture is sound: `chrome.tabCapture`-based voice recording,
  duration-based capture (not silence-based), cursor-based incremental sync,
  day-bucketed message merging in the backend.

## Current state: BROKEN / LAST ACTION UNVERIFIED

- **דודי יעקב** (Dudi, 972546283008, contact_id
  `b3abe592-cfe9-4044-aabe-d3e3aaaaead6`) — 3 voice messages still not
  syncing as of session end:
  - "Thursday" divider, 15:11, duration 0:26
  - "Today" divider, 17:26, duration 0:42
  - "Today" divider, 18:57, duration 0:09
- Full diagnostic trail is in **GitHub Issue #55** (avnamer/teacher-crm) —
  read that issue's full comment history before re-investigating, it
  documents ~5 rounds of hypotheses and fixes, several of which were WRONG
  or caused regressions. Don't re-walk the same path.
- **LAST ACTION before stopping for the night**: discovered that a
  retry-with-delay mechanism added earlier in the session (meant to work
  around confirmed WhatsApp DOM instability) had caused a severe regression
  — Dudi's entire 27-message conversation collapsed down to capturing just
  1 message (not just the 3 voice ones — text messages too). Reverted the
  retry mechanism entirely back to synchronous extraction (build
  `2026-09-30-30` / version `1.0.30`). **This revert has not been tested
  yet** — the user went to sleep right after it shipped. Dudi's cursor was
  cleared (`whatsappLastMessageAt: null`) in preparation.
- **Immediate next step**: run a sync for Dudi and check the actual DB
  content (not just "did it complete without error" — every failure mode
  found today was silent, no thrown errors). Expect: full conversation
  captured again (27 rows worth), probably still missing or mis-dated on
  the 3 voice messages specifically (that's the still-open part of #55) —
  but if even the TEXT messages are still collapsing to ~1, the revert
  didn't fully fix it and needs further investigation from scratch.

## Build/version convention (established this session, keep following it)

Every time `whatsapp-extension/content.js` changes, bump BOTH:
- `CONTENT_JS_BUILD` constant near the top of `content.js` (~line 19)
- `manifest.json`'s `"version"` (numeric, e.g. `1.0.31`) AND `"version_name"`
  (free text, mirror the build string e.g. `"2026-09-30-31"`)

This lets the user instantly confirm — via the console's load-log line AND
the chrome://extensions page — that a reload actually picked up new code.
This was added specifically because "did you actually reload" confusion
wasted real time earlier in the project.

## Key architectural facts (hard-won today and yesterday — do not re-derive)

- WhatsApp Web voice-note playback does **not** go through any
  JS-observable browser API — no `<audio>` element, no Web Audio API, no
  WebCodecs, no dedicated Worker. Confirmed exhaustively (~20 hook
  strategies) across multiple live tests. The only way to capture the audio
  is `chrome.tabCapture` (records the tab's actual output at the OS level),
  not reading any DOM element.
- Chrome's `getUserMedia` for `chromeMediaSource: 'tab'` applies
  mic-oriented audio processing (echo cancellation, auto-gain, noise
  suppression) by default — must be disabled via the **legacy
  Google-prefixed** constraints inside `mandatory`
  (`googEchoCancellation: false`, `googAutoGainControl: false`,
  `googNoiseSuppression: false`, `googHighpassFilter: false`), not the
  modern constraint names, or captured audio comes back as unintelligible
  noise (Whisper then hallucinates plausible-sounding text in random
  languages instead of erroring).
- Voice capture must be **duration-based** (record for the message's own
  known length, read from the DOM's "0:26"-style label), not
  silence-gap-based — natural speech pauses exceed any short silence
  threshold and cut long messages off mid-sentence.
- WhatsApp Web **auto-plays the next voice message** once the current one
  finishes naturally — `resolveVoiceMessage` must detect a row already in
  "Pause voice message" state and pause it first, or the next capture grabs
  a mid-playback fragment from an unknown position instead of the start.
- A voice note not yet locally cached shows a **"Download voice message"**
  button instead of "Play voice message" — must click-and-wait (up to ~5s)
  for it to flip before proceeding, or the row gets misclassified as plain
  text with no content.
- WhatsApp Web date dividers come in **three formats**, all of which must
  be handled or a voice message (which has no other timestamp source)
  gets silently dropped or mis-dated into a completely wrong day:
  1. Literal `M/D/YYYY`
  2. Relative `"Today"` / `"Yesterday"` (and Hebrew `"היום"`/`"אתמול"`)
  3. Bare weekday name (`"Thursday"` etc., and Hebrew day names) for the
     last ~week
- The sync cursor (`contacts.custom_fields.whatsappLastMessageAt`) must
  **never advance past a voice message that hasn't finished resolving**
  (`transcriptionStatus !== 'done'`) in the current batch, or it can never
  be retried again on a future sync. Implemented in the backend's
  `POST /messages` route (`backend/src/routes/whatsappSync.js`) — look for
  the `firstUnresolvedVoice` logic.
- `frontend/src/pages/ContactDetail.jsx`'s `saveContact()` used to
  overwrite the **entire** `custom_fields` JSONB blob from stale
  page-load-time React state on every save — this could silently revert
  the sync cursor (and anything else in custom_fields) if the contact page
  had been open in a tab since before a sync last ran. **Fixed**: it now
  re-fetches `custom_fields` fresh from the DB immediately before merging
  in just the two fields this form actually edits
  (`whatsappSync`, `whatsappGroupAliases`).
- WhatsApp Web's own virtualization is **confirmed unstable even without
  any scrolling** — the identical DOM query for "rows shaped like a voice
  message" returned different counts (3, then 0) seconds apart with zero
  user action in between. A retry-with-delay mechanism was tried in
  `extractMessage` to work around this and made things **catastrophically
  worse** (collapsed a 27-message conversation down to capturing just 1) —
  it has been fully reverted. **Do not reintroduce retries in
  `extractMessage` without a much more careful, narrowly-scoped approach**
  (if at all) — this remains the core open, unsolved mystery for Dudi's
  specific 3 voice messages. Whatever mechanism eventually fixes it needs
  to NOT risk degrading rows that are already extracting correctly.

## Files most actively touched this session

- `whatsapp-extension/content.js` — bulk of extraction logic:
  `extractMessage`, `resolveVoiceMessage`, `nearestDividerDate`,
  `combineDateAndTime`, `messageKindOf`, `collectMessages`. Has TEMP DEBUG
  `console.log` calls throughout (prefixed `[whatsapp-sync] DEBUG:`) — safe
  to remove once Issue #55 is fully closed, but useful until then.
- `whatsapp-extension/background.js` — tabCapture orchestration split into
  `prepareVoiceCapture` (setup) / `finishVoiceCapture` (record + return) so
  content.js can click at the last possible moment with fresh coordinates.
- `whatsapp-extension/offscreen.js` — actual recording logic:
  `waitForSpeechThenDuration` (voice-activity-detection for start, known
  duration for stop), audio-processing-disabled `getUserMedia` call.
- `whatsapp-extension/selectors.js` — `voiceNode` / `voicePlayButton` /
  `voicePauseButton` / `voiceDownloadButton`.
- `backend/src/routes/whatsappSync.js` — `POST /messages`:
  cursor-advancement logic, TEMP DEBUG logging of voice statuses + computed
  cursor (safe to remove once #55 is closed).
- `backend/src/services/whatsappMerge.js` — day-bucketed merge,
  replace-if-not-done logic so a voice message that later resolves
  successfully can overwrite an earlier bad/incomplete save of the same
  `messageId`.
- `frontend/src/pages/ContactDetail.jsx` — `saveContact()` cursor-clobber
  fix (see above).

## GitHub Issues (source of truth for open items — this file is a snapshot, not a tracker)

- **#46** — original `chrome.tabCapture` voice-transcription investigation.
  Mostly historical now; useful for the "why tabCapture at all" reasoning.
- **#55** — Dudi-specific voice-sync issue. **ACTIVE, read this first** on
  resume. Full round-by-round diagnostic trail including the
  retry-mechanism regression and its revert.

## Debug script pattern (recreate as needed — not saved as permanent files)

Throughout this session, ad-hoc Node scripts were used against Supabase
directly (service-role key from `backend/.env`) for diagnosis and cursor
resets. Pattern: write a `.mjs` file, copy it into `backend/` (needed for
`node_modules` resolution — a script outside that directory can't resolve
`@supabase/supabase-js`), run it with `node`, delete it.

Two recurring scripts, reconstruct from these shapes:

**Check a contact's whatsapp interaction rows:**
```js
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const { data: rows } = await supabase
  .from('interactions').select('id, created_at, metadata')
  .eq('contact_id', CONTACT_ID).eq('type', 'whatsapp')
  .order('created_at', { ascending: true })
for (const row of rows) {
  console.log(`row ${row.id} created_at=${row.created_at}`)
  for (const m of row.metadata?.messages || []) {
    console.log(`  [${m.timestamp}] ${m.sender} kind=${m.kind}`,
      m.kind === 'voice' ? `dur=${m.durationSec} status=${m.transcriptionStatus}` : (m.text||'').slice(0,40))
  }
}
```

**Clear a contact's sync cursor** (needed before almost every retest —
without this, a sync thinks everything up to the old cursor is already
handled and silently does nothing):
```js
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const { data: contact } = await supabase.from('contacts').select('custom_fields').eq('id', CONTACT_ID).single()
const { whatsappLastMessageAt: _removed, ...rest } = contact.custom_fields || {}
await supabase.from('contacts').update({ custom_fields: rest }).eq('id', CONTACT_ID)
```

**Check current cursor state without touching it** (via the backend API,
no direct DB script needed):
```
curl -s http://localhost:3001/api/whatsapp-sync/targets -H "X-Extension-Token: $TOKEN"
```
(get `$TOKEN` from `backend/.env`'s `WHATSAPP_EXTENSION_TOKEN`)

## What NOT to do

- **Don't commit or push anything** — never requested this entire session,
  despite dozens of file changes. Ask explicitly before doing so.
- **Don't re-introduce the retry-with-delay mechanism** in `extractMessage`
  without first understanding why it caused such a severe regression —
  simply adding it back will very likely reproduce the same collapse.
- **Don't trust a "clean-looking" sync** (short duration, no errors
  anywhere) as a success signal — every failure mode found today was
  silent. Always verify against actual DB content using the check-script
  pattern above.
- **Don't trust `whatsappLastMessageAt` cursor state from memory** — check
  it directly via `/targets` before every test. It gets reset in multiple
  non-obvious ways (stale contact-page saves before the ContactDetail.jsx
  fix, a sync's own cursor-advancement logic legitimately moving past
  everything when zero voice messages are found in a batch, etc.).
- **Don't assume port 3001/5173 is this worktree's server** — verify the
  process's command line. Other Claude sessions and the main checkout have
  collided on these ports multiple times this session.
