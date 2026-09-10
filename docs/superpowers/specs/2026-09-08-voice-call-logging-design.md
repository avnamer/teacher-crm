# Design: Voice Call Logging (PWA)

**Date:** 2026-09-08
**Status:** Approved for planning
**Source spec:** [../../VOICE-CRM-PLAN.md](../../VOICE-CRM-PLAN.md) (original planning doc, written against Firebase — see its adaptation note for the Supabase mapping used here)

## Purpose

Let the user log a phone call with a teacher from their phone, entirely by voice: speak freely about the call, get it transcribed on-device, auto-summarized with action items extracted by Claude, matched to the right teacher, and saved to the CRM — with dated action items also pushed to the user's Google Calendar.

## App identity

- PWA display name: **Tech-School CRM**
- Installable via "Add to Home Screen" (manifest + service worker added to the existing Vite/React app)

## Architecture & data flow

1. **Frontend page `/voice-log`** (new route in the existing React app): one large mic button. Uses the Web Speech API (`SpeechRecognition`, `lang="he-IL"`) via a dedicated `useSpeechToText` hook — an isolated module with a uniform interface, so it can be swapped for a Whisper-based implementation later without touching the rest of the screen. Transcript renders live as the user speaks; user can edit the text manually before proceeding.
2. **Analyze:** on "סכם", the transcript text is POSTed to the backend, which calls the Claude API server-side (API key stays server-side, never in client code) and returns structured JSON.
3. **Teacher matching:** runs **client-side**, against "המורות שלי" only — contacts already loaded on other pages, filtered the same way as the existing recency-stats feature: `role = 'מורה מוביל/ה'` AND `custom_fields.mentor_name = 'אבנר'`. Fuzzy-matches the spoken name against that list (normalized string comparison, tolerant of small transcription errors). Certain match → shown pre-selected for confirmation. Multiple candidates → short picklist. No match → manual search field scoped to the same "המורות שלי" list.
4. **Confirmation card:** shows matched teacher (editable), summary, action items (editable), before save.
5. **Save:** on confirm, `INSERT` into the existing `interactions` table:
   - `contact_id` = confirmed teacher
   - `type` = `'phone_call'`
   - `content` = the summary text
   - `metadata` = `{ transcript, action_items, mentioned_dates, teacher_name_spoken, confirmed_by_user: true, source: 'voice_pwa' }`
   - No schema changes needed — `phone_call` type and the `content`/`metadata` columns already exist.
6. **Calendar push:** for each action item carrying a date, the frontend calls a new backend endpoint that creates an event on the user's personal Google Calendar (`avnamer@gmail.com`).

No new database tables or columns are required.

## Backend

New Express routes, alongside the existing `backend/src/routes/`:

- **`POST /api/voice-log/analyze`**
  Input: `{ transcript }`. Calls the Claude API (key read from an environment variable — the user already has an Anthropic API key) with a prompt requesting strict JSON: `{ teacher_name_spoken, summary, action_items: [{ text, due_date? }], mentioned_dates: [] }`.
  Failure (timeout, rate limit, malformed response): respond `500` with an error message. The frontend then offers "retry" and also lets the user save the interaction manually (transcript as `content`, no AI summary) rather than losing the call log entirely.

- **`POST /api/google/create-event`**
  Input: `{ title, date, notes }`. Creates an event on `avnamer@gmail.com`'s calendar.
  This reuses the existing Google OAuth plumbing (`backend/src/services/calendarSync.js`, `backend/src/routes/google.js`) but **requires re-authorization**: the stored tokens currently only carry the `calendar.readonly` scope (used for the one-way meeting sync). The auth URL must be extended to also request `https://www.googleapis.com/auth/calendar.events` (write), and the user must re-run `/api/google/auth` once to consent to the new scope.
  If no valid write-scoped token exists when this endpoint is called: return an error the frontend surfaces as "יש להתחבר מחדש ל‑Google" with a link to `/api/google/auth` — but this must **not** block saving the interaction itself. The call log is saved regardless of calendar push success.

## PWA infrastructure

- `manifest.json` (name: "Tech-School CRM", icons, start URL, standalone display mode) + a basic service worker registered in the existing Vite app, enabling "Add to Home Screen" on Android/Chrome. No offline-caching requirements beyond what's needed for installability.

## Error handling (client-side)

- `SpeechRecognition` unsupported (non-Chrome browser) → clear message suggesting Chrome.
- Empty/noise-only transcript → "סכם" button disabled.
- Network failure calling `/analyze` → error message, retry without losing the transcript.
- No teacher match → manual search/selection from "המורות שלי".
- Microphone permission denied → guidance on enabling it in browser settings.
- Calendar push failure → interaction still saves; user is told the calendar event wasn't created and why.

## Testing

No automated test infrastructure exists in this project. Verification is manual, on a real Android/Chrome device, covering: happy path end-to-end (speak → summarize → confirm → save → calendar event appears), each error state above, and a call with no dates mentioned (no calendar event expected).

## Out of scope (deferred)

- **Whisper fallback** — not built now; the transcription hook's isolated interface is designed to make this a later swap, not a rebuild.
- **Auto-save without confirmation** — deferred until manual confirmation proves the matching/summarization is reliable (per the original plan's decision log).
- **Audio recording** — none; only the on-device transcript text is ever sent anywhere.
- **WhatsApp Desktop conversation scanning** — a separate future feature (raised during this brainstorm, not designed): auto-logging past WhatsApp correspondence with teachers into the CRM. No official WhatsApp Desktop API exists, so this needs its own brainstorm on approach (WhatsApp Web automation vs. manual export) before scoping. Tracked in `docs/CHECKPOINT-v1.md`.
