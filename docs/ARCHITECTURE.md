# Architecture

Current-state reference. Update this file when a feature changes the schema, an API
endpoint, an env var, a shared module, or deployment. For *why* a feature was built the
way it was, follow the spec/PR links in [docs/README.md](README.md).

## Overview

```
Phone / browser
   │
   ├── frontend (React + Vite, Netlify) ──── Supabase (Postgres, anon key, no login)
   │        │
   │        └── VITE_BACKEND_URL
   │
   └── backend (Node/Express, Render) ────── Supabase (service key)
            ├── Anthropic API   (voice-log analysis)
            └── Google Calendar (meeting sync, event creation)
```

**Frontend auth (single-user).** The whole app is behind a Google login restricted to
the owner: `AuthGate` requires a Supabase session whose email is the owner's before
rendering anything (`frontend/src/components/AuthGate.jsx`, `pages/Login.jsx`,
`lib/auth.js`). Every table's RLS is locked to that user
(`"Owner full access"`: `auth.jwt() ->> 'email' = 'avnamer@gmail.com'`), so the public
anon key can neither read nor write — verified live. The frontend email check is UX only;
RLS is the authoritative gate. Google OAuth *Calendar* tokens live in the private
`app_private` table (RLS on, no policy), reachable only by the backend's service key —
never put secrets in a frontend-readable table.

**Backend** is still unauthenticated (protected by CORS + the Anthropic spend limit);
requiring a user JWT on the backend endpoints is a tracked follow-up. Don't add new
tables or policies without an owner policy, and don't make any table publicly readable.

## Frontend (`frontend/`)

| Route | Page | Purpose |
|---|---|---|
| `/contacts` | `Contacts.jsx` | Main dashboard: teacher table, column manager, recency stats, task counters, pending voice-log approvals, overdue scheduled meetings |
| `/contacts/:id` | `ContactDetail.jsx` | Teacher detail, interaction/journal history |
| `/meetings` | `Meetings.jsx` | Scheduled + past meetings (from `interactions`, `type='meeting'`), one row per real-world meeting (grouped by `meeting_group_id`), school recency, edit (date/content/attendees)/delete |
| `/schools` | `Schools.jsx` | One school on one screen (`?school=` in the URL): its teachers and their teams in that school (total teams/students), dashboard task columns each teacher hasn't done, open small tasks (teachers' action items + the admin's tasks tied to the school, closable in place), and a meeting history (held `meeting` interactions only, merged per meeting — 10 at a time, AI short summary cached on the record). Read-only apart from closing tasks and caching summaries; logic in `lib/schools.js` |
| `/whatsapp` | `WhatsApp.jsx` | Templates, bulk send via send queue, task-based recipient filter |
| `/whatsapp-groups` | `WhatsAppGroups.jsx` | Which WhatsApp groups the extension syncs (`whatsapp_groups.sync_enabled`), which are "קבוצת הנהלה" (`is_management`), and the task-givers' / own names (`management_settings`). The dashboard's `ManagementTasksPanel` shows `management_tasks` |
| `/voice-log` | `VoiceLog.jsx` | PWA voice dictation → AI analysis → `pending_voice_logs`; a recording opening with "משימה לעצמי" / "משימה למנהל המערכת" skips approval and goes straight to "המשימות שלי", split into tasks |
| `/mentors` | `Mentors.jsx` | Mentor directory |
| `/settings` | `Settings.jsx` | Monday board, working hours, CSV import modal |
| `/book/:contactId` | `BookMeeting.jsx` | Public booking page (outside the layout; uses legacy `meetings` table) |

Shared modules in `frontend/src/lib/`. Put new cross-page definitions here instead of
copying them into pages:

- `teachers.js`: `MENTOR` constant, "my teachers" and task-done predicates
- `interactions.js`: interaction types, icons, labels
- `whatsapp.js`: phone → E.164, template resolution, click-to-chat URL, send driver
- `adminTasks.js`: the admin's personal tasks ("המשימות שלי" panel on the dashboard) — reads/edits `metadata.action_items` on the `is_admin_row` contact's `interactions` rows; monthly recurring tasks spawn the next occurrence as a new row on mark-done
- `teams.js`: a teacher's teams ("נבחרות", `custom_fields.teams`) — which school each team belongs to (`teamSchool`), every school a teacher is linked to, grade options, teaching days/hours (`planOf`, `formatPlan`). Edited only in `components/TeamsCard.jsx` on the teacher page
- `schools.js`: the Schools page's derivations — school teachers, open teacher tasks (meeting copies merged), which admin tasks concern a school (linked teacher, else school/teacher name in the text), which records count as meeting history, short-summary caching
- `voiceLogActions.js`: save/approve logic for voice-log routes; `mergeOrCreateMeeting` folds an approved meeting voice-log into a same-day pre-scheduled meeting's `interactions` rows (or creates a fresh group) instead of writing a disconnected row

## Backend (`backend/`)

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Health check |
| `GET /api/google/auth`, `/callback`, `/status` | Google OAuth; tokens stored in the private `app_private` table |
| `POST /api/google/sync-meetings` | Pull Google Calendar events into the legacy `meetings` table |
| `POST /api/google/create-event` | Create an event in the user's calendar (voice-log action items) |
| `POST /api/voice-log/analyze` | Send a transcript to Claude and get back teacher/summary/action items/dates |
| `POST /api/voice-log/admin-tasks` | Split a dictated "task for myself" into separate tasks `[{ text, due_date, monthly }]` (relative dates resolved against today, Israel time) |
| `POST /api/meetings/analyze` | Send manually typed meeting notes + meeting date to Claude; returns summary/action items/dates (frontend `lib/meetingAnalysis.js` writes them to every group row's `metadata`) |
| `POST /api/meetings/merge` | Send several records of the same meeting (`notes[]`, oldest first) + date to Claude; returns one consolidated `content` + summary/action items/dates, later notes winning on conflict. Also returns `sources` (what was taken from each record). Used by `lib/meetingAnalysis.js`: `findDuplicateMeetingClusters()` finds held meetings on the same day sharing a school or attendee, `previewMeetingMerge()` calls this endpoint, and nothing is saved until the admin approves in `MeetingMergeProposal` (dashboard banner / Meetings page) → `applyMeetingMerge()`, or rejects → `declineMeetingMerge()` |
| `POST /api/meetings/short-summary` | `{ text }` → `{ summary }`: 2-3 line summary of one history record, for the Schools page (stored by the frontend in the record's `metadata.history_summary`) |
| `POST /api/whatsapp-sync/management-messages` | Extension → backend for a management group: `services/managementTasks.js` keeps only task-givers' messages, Claude extracts tasks for all mentors (`audience: all`) or Avner by name (`me`) into `management_tasks`; the group's `last_message_at` cursor advances only after success |
| `GET /api/whatsapp/status` | Active send driver + capabilities |
| `POST /api/whatsapp/bulk-send` | Slot for a future `cloud_api` driver (manual click-to-chat needs no server) |
| `/api/whatsapp-sync/*` | Used only by the Chrome extension (`whatsapp-extension/`), authenticated by the `X-Extension-Token` header (`middleware/extensionAuth.js`), not a Supabase session. `GET /targets` (teachers with `custom_fields.whatsappSync` + enabled groups), `POST /messages` (`services/whatsappMerge.js`: one `whatsapp` interaction per contact per Israel day per source, dedup by `messageId` then text similarity — including same-day CRM-sent `message_sent`/`mailing_list` rows; advances the contact's sync cursor but never past an unresolved voice message; for DM batches it then runs `services/whatsappTasks.js` in the background — Claude task extraction, see `interactions` below), `POST /voice-transcribe` (Whisper + Claude summary; audio is never stored), `GET /retry-candidates`, `POST /groups`, `/sync/begin`/`progress`/`finish`, `/heartbeat`, `/unmatched`, `/failed`, `GET /pending-request` + `POST /request-done` (manual sync requests from the CRM) |

Backend scripts (run from `backend/`, against the database in `backend/.env`):
`scripts/whatsapp-tasks-dry-run.mjs <contact-id>…` prints the tasks Claude finds in a contact's stored WhatsApp DMs (no writes); `scripts/action-items-assignee-backfill.mjs` tags open call/meeting action items saved before `assignee` existed — preview (plan file) then `--save`; `scripts/whatsapp-tasks-backfill.mjs` runs task extraction on DM rows without `tasks_analyzed_at` — preview first (writes a plan file), then `--save` saves exactly that plan.

## Database (Supabase, `supabase-setup.sql`)

`supabase-setup.sql` is the schema **plus appended migrations**, in the order they were
applied. Add new changes at the end; don't edit earlier statements.

| Table | Holds |
|---|---|
| `contacts` | Teachers (plus an admin pseudo-row, `custom_fields.is_admin_row`). `custom_fields` JSONB holds Monday data, task checkbox values, `mentor_name`, `_manual_edit`, `teams` (up to 3 `{ grades, students, school?, schedule?, prep? }` — `schedule`/`prep` = `{ [day 0=Sun..5=Fri]: [hours 1..8] }` for lessons / prep lessons; `grades` is one or more of ז'/ח'/ט' (a mixed-age class has several); `lib/teams.js` also reads an older single `grade` string — `school` only counts when `teaches_other_school` is true; otherwise every team belongs to `contacts.school`; see `lib/teams.js`) |
| `interactions` | Every touchpoint: `type` ∈ `message_sent`, `mailing_list`, `correspondence`, `meeting`, `phone_call`, `journal`, `whatsapp` (synced chat: `metadata.source` `dm`/`group`, `group_id`/`group_name`, `messages[]` with `messageId`/`timestamp`/`sender`/`kind` and, for voice, `transcript`/`summary`/`transcriptionStatus`/`transcriptionRetries`; tasks Claude found in the chat go in `action_items` with `source: 'whatsapp'` + `message_date`, and `tasks_analyzed_at` marks an analyzed day row). Admin-contact rows created from WhatsApp tasks: `type: 'journal'`, `metadata.source: 'whatsapp'`, `whatsapp_contact_id` / `whatsapp_contact_name` / `message_date`, one task each. `metadata` JSONB keys include `column_label` (journal), `action_items` / `transcript` / `mentioned_dates` (voice log; on call/meeting rows each action item carries `assignee` `admin`/`teacher`/`both` — `admin` and `both` are also listed in the dashboard's "המשימות שלי", meeting copies shown once and updated together, see `lib/adminTasks.js`), `meeting_status` / `meeting_group_id` / `attendees` (meetings — one row per attendee per real-world meeting, all sharing one `meeting_group_id`; `attendees` lists the *other* attendees' names on each row; `summary` / `ai_analyzed_content` from AI analysis; `merged_sources` = the original notes of same-day records merged into this meeting; `not_duplicate_of` = group ids the admin said are separate meetings; `saved_at` = when the meeting was last saved, used to order same-day records), `sent_via` / `recipient_count` (bulk WhatsApp), admin tasks on the `is_admin_row` contact: per action item `recurrence` (`{type:'monthly', day}`) / `done_at` / `next_row_id`, per row `source` (`voice_pwa` / `admin_panel` / `recurring` / `voice_task` — dictated straight from the voice log, one task per row, full `transcript` kept) and `tasks_cleared` (all tasks of a recording removed — the row is kept), `history_summary` / `history_summary_of` (Schools page: AI short summary of a record that had no `summary`, and a fingerprint of the text it was made from — regenerated when the text changes), `responded` (message/mailing rows only — whether the teacher actually replied; see `countsTowardRecency()` in `lib/interactions.js`, gates the dashboard's "last contact" recency) |
| `pending_voice_logs` | Unapproved voice-log analyses, scoped by `mentor_name` |
| `settings` | Single row, **frontend-readable**: Monday board, working hours, `contacts_columns` (column config JSONB). Never store secrets here |
| `app_private` | Secrets reachable only by the backend service key (RLS on, no policy): `google_calendar_tokens` |
| `mentors` | Mentor directory |
| `message_templates` | WhatsApp templates |
| `meetings` | **Legacy**: Google Calendar sync only. Still read by `ContactDetail.jsx` and `/book`, but not by the Meetings page |
| `scheduled_messages` | Written by `WhatsApp.jsx` but not consumed by anything |
| `whatsapp_auth` | Unused since the move to click-to-chat |
| `whatsapp_groups` | Groups the extension has seen; `sync_enabled` set from `/whatsapp-groups` |
| `whatsapp_sync_state` | Single row (`id='global'`): last run status/error, progress, failed teachers, unmatched group senders, extension heartbeat |
| `management_settings` | Single row: `task_givers` (WhatsApp names of Benny/Mika), `my_names` |
| `management_tasks` | Tasks from management groups: text, `audience`, sender, group, original message, `due_date`, `done` |
| `whatsapp_sync_requests` | Manual "sync now" requests from the CRM, polled by the extension |

Per-teacher WhatsApp sync config lives in `contacts.custom_fields`: `whatsappSync`, `whatsappGroupAliases`, and the cursors `whatsappLastMessageAt` / `whatsappLastGroupMessageAt` (written by the backend; `ContactDetail.jsx` re-reads `custom_fields` before saving so it can't clobber them).

## Deployment

| Part | Host | Details |
|---|---|---|
| Frontend | Netlify, site `comforting-pegasus-780af0` | Base `frontend`, build `npm run build`, publish `dist`. **Production branch: `main`**. Every production deploy costs credits (see [CLAUDE.md](../CLAUDE.md)) |
| Backend | Render, service `teacher-crm-backend` (free) | `https://teacher-crm-backend.onrender.com`, root `backend`, start `npm start`. Spins down when idle (~30–50s cold start). Auto-deploy branch was originally `feature/mentors-page`; confirm in the Render dashboard that it now tracks `main` |
| Database | Supabase project `teacher-crm` (ref `ltfguyjrwrcghllvrixu`) | Free tier auto-pauses; see the `run-teacher-crm` skill for resuming. Auth → URL Configuration → Redirect URLs must include the exact local dev URL (`http://localhost:5173/**`) or Google login silently redirects to the production Netlify site instead |
| Google OAuth | Google Cloud client "Teacher-CRM" | Redirect URIs for localhost and Render. The consent screen shows "Onshape Academy" (cosmetic) |

## Environment variables

**`frontend/.env.local`** (Netlify env vars in production)
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BACKEND_URL`,
`VITE_ALLOWED_EMAIL` (optional; the login-allowed owner email, defaults to
`avnamer@gmail.com` — UX only, RLS is the real gate)

**`backend/.env`** (Render env vars in production)
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (Whisper,
WhatsApp voice messages), `WHATSAPP_EXTENSION_TOKEN` (shared secret with the extension), `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `WHATSAPP_DRIVER` (optional, default
manual), `PORT` (optional)

### Handling secrets: lessons learned

- Don't copy a secret out of a rendered chat message. The chat app masks key-like
  strings, and copying the masked text has produced corrupted values more than once.
  Write the value to a local file and copy it from there.
- In Render's bulk env-var editor, reveal (👁) every secret field before saving. A field
  left in its masked state can be silently overwritten.
