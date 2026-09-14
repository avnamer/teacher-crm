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

There is **no authentication**. The frontend reads and writes Supabase directly with the
anon key (RLS policies allow public access), and backend endpoints are unauthenticated.
See the security issue in GitHub Issues before exposing anything new.

## Frontend (`frontend/`)

| Route | Page | Purpose |
|---|---|---|
| `/contacts` | `Contacts.jsx` | Main dashboard: teacher table, column manager, recency stats, task counters, pending voice-log approvals, overdue scheduled meetings |
| `/contacts/:id` | `ContactDetail.jsx` | Teacher detail, interaction/journal history |
| `/meetings` | `Meetings.jsx` | Scheduled + past meetings (from `interactions`, `type='meeting'`), school recency, edit/delete |
| `/whatsapp` | `WhatsApp.jsx` | Templates, bulk send via send queue, task-based recipient filter |
| `/voice-log` | `VoiceLog.jsx` | PWA voice dictation → AI analysis → `pending_voice_logs` |
| `/mentors` | `Mentors.jsx` | Mentor directory |
| `/settings` | `Settings.jsx` | Monday board, working hours, CSV import modal |
| `/book/:contactId` | `BookMeeting.jsx` | Public booking page (outside the layout; uses legacy `meetings` table) |

Shared modules in `frontend/src/lib/`. Put new cross-page definitions here instead of
copying them into pages:

- `teachers.js`: `MENTOR` constant, "my teachers" and task-done predicates
- `interactions.js`: interaction types, icons, labels
- `whatsapp.js`: phone → E.164, template resolution, click-to-chat URL, send driver
- `voiceLogActions.js`: save/approve logic for voice-log routes

## Backend (`backend/`)

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Health check |
| `GET /api/google/auth`, `/callback`, `/status` | Google OAuth; tokens stored in `settings.google_calendar_tokens` |
| `POST /api/google/sync-meetings` | Pull Google Calendar events into the legacy `meetings` table |
| `POST /api/google/create-event` | Create an event in the user's calendar (voice-log action items) |
| `POST /api/voice-log/analyze` | Send a transcript to Claude and get back teacher/summary/action items/dates |
| `GET /api/whatsapp/status` | Active send driver + capabilities |
| `POST /api/whatsapp/bulk-send` | Slot for a future `cloud_api` driver (manual click-to-chat needs no server) |

## Database (Supabase, `supabase-setup.sql`)

`supabase-setup.sql` is the schema **plus appended migrations**, in the order they were
applied. Add new changes at the end; don't edit earlier statements.

| Table | Holds |
|---|---|
| `contacts` | Teachers (plus an admin pseudo-row, `custom_fields.is_admin_row`). `custom_fields` JSONB holds Monday data, task checkbox values, `mentor_name`, `_manual_edit` |
| `interactions` | Every touchpoint: `type` ∈ `message_sent`, `correspondence`, `meeting`, `phone_call`, `journal`. `metadata` JSONB keys include `column_label` (journal), `action_items` / `transcript` / `mentioned_dates` (voice log), `meeting_status` / `meeting_group_id` (meetings), `sent_via` / `recipient_count` (bulk WhatsApp) |
| `pending_voice_logs` | Unapproved voice-log analyses, scoped by `mentor_name` |
| `settings` | Single row: Monday board, working hours, `contacts_columns` (column config JSONB), `google_calendar_tokens` |
| `mentors` | Mentor directory |
| `message_templates` | WhatsApp templates |
| `meetings` | **Legacy**: Google Calendar sync only. Still read by `ContactDetail.jsx` and `/book`, but not by the Meetings page |
| `scheduled_messages` | Written by `WhatsApp.jsx` but not consumed by anything |
| `whatsapp_auth` | Unused since the move to click-to-chat |

## Deployment

| Part | Host | Details |
|---|---|---|
| Frontend | Netlify, site `comforting-pegasus-780af0` | Base `frontend`, build `npm run build`, publish `dist`. **Production branch: `main`**. Every production deploy costs credits (see [CLAUDE.md](../CLAUDE.md)) |
| Backend | Render, service `teacher-crm-backend` (free) | `https://teacher-crm-backend.onrender.com`, root `backend`, start `npm start`. Spins down when idle (~30–50s cold start). Auto-deploy branch was originally `feature/mentors-page`; confirm in the Render dashboard that it now tracks `main` |
| Database | Supabase project `teacher-crm` (ref `ltfguyjrwrcghllvrixu`) | Free tier auto-pauses; see the `run-teacher-crm` skill for resuming |
| Google OAuth | Google Cloud client "Teacher-CRM" | Redirect URIs for localhost and Render. The consent screen shows "Onshape Academy" (cosmetic) |

## Environment variables

**`frontend/.env.local`** (Netlify env vars in production)
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BACKEND_URL`

**`backend/.env`** (Render env vars in production)
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `WHATSAPP_DRIVER` (optional, default
manual), `PORT` (optional)

### Handling secrets: lessons learned

- Don't copy a secret out of a rendered chat message. The chat app masks key-like
  strings, and copying the masked text has produced corrupted values more than once.
  Write the value to a local file and copy it from there.
- In Render's bulk env-var editor, reveal (👁) every secret field before saving. A field
  left in its masked state can be silently overwritten.
