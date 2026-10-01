# Extract Tasks from Synced WhatsApp Conversations

## Problem

A voice log already turns spoken follow-ups into tasks: `analyzeCallTranscript`
(`backend/src/services/claudeAnalyze.js`) returns `action_items`, which end up either
on a teacher's `interactions` row (shown as "משימות המשך" on the contact page) or on
the admin pseudo-contact's rows (the "המשימות שלי" dashboard panel,
`frontend/src/lib/adminTasks.js`).

WhatsApp sync (PR #56) saves the conversations themselves, but the commitments made in
them ("תשלח לי את מערך השיעור", "אני אגיע אליכם ביום חמישי") stay buried in the chat.
They should become tasks automatically: a teacher's tasks on that teacher, the
admin's (Avner's) tasks on the admin row, each marked as coming from WhatsApp with the
date of the message.

## Decisions (agreed with the owner, 2026-10-01)

| Question | Decision |
|---|---|
| Approval queue like voice logs? | **No.** Tasks are saved directly; a wrong one is deleted or ticked done by hand. |
| Which chats? | **DMs only** (`source === 'dm'`). Groups are out of scope. |
| How far back? | **The whole synced window** (first sync = 30 days). Tasks the conversation shows were already completed are saved with `done: true`. |
| Google Calendar events for due dates? | **No.** CRM only. |
| Where does analysis run? | **Backend, after `POST /api/whatsapp-sync/messages` saves a batch** (approach A). |

## Design

### 1. Detection — `analyzeWhatsAppTasks()` in `claudeAnalyze.js`

One Claude call per DM batch that actually saved new messages. Same model, token cap,
`responseText` / `extractJson` helpers as the existing analyzers.

**Input** (user message), built by the caller:
- Teacher's name.
- The newly saved messages, oldest first, one per line:
  `[YYYY-MM-DD HH:MM] אבנר|<teacher name>: <text>`. Voice messages use their full
  `transcript` (prefixed `🎤`); media use `mediaLabel` + caption. Messages with no
  text at all (a failed voice transcription, a bare sticker) are left out.
- The teacher's existing WhatsApp-sourced tasks and Avner's existing WhatsApp-sourced
  tasks for this teacher (text + done), under "משימות שכבר קיימות — אל תחזיר אותן שוב".

**System prompt rules:**
- A task is a concrete commitment or request to do something: sending a file, filling
  a form, arriving at a meeting, checking something. Greetings, thanks, small talk and
  general information are not tasks.
- `assignee: "teacher"` — something the teacher was asked to do or committed to do.
  `assignee: "admin"` — something Avner was asked to do or committed to do.
- `message_date` — the date (`YYYY-MM-DD`) of the message the task comes from.
- `due_date` — only when a date or relative date is mentioned (resolved relative to
  `message_date`), otherwise `null`.
- `done: true` only when a later message in the same input explicitly shows it was
  done ("שלחתי", "קיבלתי, תודה"). Otherwise `false`.
- Return only JSON: `{ "tasks": [ { "assignee", "text", "message_date", "due_date", "done" } ] }`.

**Validation** in the function: drop entries with an unknown `assignee`, empty `text`,
or a `message_date` that isn't one of the input messages' dates.

### 2. Storage

New module `backend/src/services/whatsappTasks.js`, exporting
`extractAndSaveWhatsAppTasks({ contactId, savedMessages })`. It loads the teacher's
name, the existing tasks (for the prompt and the dedup check), calls
`analyzeWhatsAppTasks`, and writes:

**Teacher task** → appended to `metadata.action_items` of the teacher's WhatsApp DM row
for `message_date` (the day row the merge just wrote; looked up by contact + type
`whatsapp` + `metadata.source = 'dm'` + Israel day, as `whatsappMerge.js` does). Item:
`{ text, due_date, done, source: 'whatsapp', message_date }`. The rest of the row's
metadata is preserved (read fresh, then update).

**Admin task** → a new `interactions` row on the admin contact (the row with
`custom_fields.is_admin_row`; the backend looks it up and skips admin tasks with a
logged warning if it doesn't exist — it isn't created from the backend):
- `type: 'journal'`, `created_at`: `message_date` at 12:00 Israel time
- `content`: `משימה מהתכתבות וואטסאפ עם <teacher name>`
- `metadata`: `{ source: 'whatsapp', whatsapp_contact_id, whatsapp_contact_name,
  message_date, action_items: [{ text, due_date, done, source: 'whatsapp', message_date }] }`

One admin row per task, so editing or deleting one in "המשימות שלי" never touches
another.

**Dedup safety net** (in code, after Claude): a task is skipped if its normalized text
is ≥ 0.9 similar (`similarity` / `normalizeText`, exported from `whatsappDedup.js`) to
an existing WhatsApp-sourced task with the same assignee for this teacher.

### 3. Hooking into the sync

In `POST /messages` (`backend/src/routes/whatsappSync.js`):
- `mergeWhatsAppMessages` returns, in addition to its counts, `savedMessages` — the
  messages it actually inserted (not duplicates, not voice replacements).
- After `res.json(...)`, if `source === 'dm'` and `savedMessages.length > 0`, call
  `extractAndSaveWhatsAppTasks(...)` without awaiting the response path; errors are
  caught and logged as `[whatsapp-sync/tasks]`. The sync's own result never depends on
  it.
- On success, the touched day rows get `metadata.tasks_analyzed_at` (ISO now). Nothing
  reads it yet; it's there so a later retry job can find unanalyzed rows.

A re-sync of messages that are already stored saves nothing new → no Claude call.

### 4. Frontend

- **Dashboard open-task indicator** (`loadPendingTasks` in `Contacts.jsx`): read
  `type IN ('phone_call', 'whatsapp')` instead of only `phone_call`.
- **Contact page** (`ContactDetail.jsx`): WhatsApp rows already render
  `metadata.action_items` as "משימות המשך" with checkboxes. Add a small
  `💬 <message_date>` next to an item whose `source === 'whatsapp'`.
- **`toggleActionItem`** (`ContactDetail.jsx`): re-read the row's metadata from the DB
  before writing, instead of writing page-load state back. Otherwise ticking a task can
  wipe messages a sync added since the page loaded (same class of bug as the
  `saveContact()` cursor clobber fixed in #56).
- **"המשימות שלי"** (`AdminTasksPanel.jsx`): for a row with `source === 'whatsapp'`,
  label `💬 וואטסאפ · <whatsapp_contact_name> · <message_date>` instead of the default
  `🎙 הוקלט`. `fetchAdminTasks` passes `whatsapp_contact_name` and `message_date`
  through.

### 5. Out of scope

Groups; Google Calendar events; an approval queue; retrying failed analyses (the
`tasks_analyzed_at` marker leaves room for it); re-analyzing conversations synced
before this ships (they can be re-synced by clearing the cursor and deleting the rows).

## Testing

1. **Dry run first:** a script that runs `analyzeWhatsAppTasks` on Dudi's and Anat's
   already-stored messages and prints the tasks without saving. The owner checks the
   teacher/admin split and the `done` judgments before saving is switched on.
2. **End to end:** clear one teacher's cursor and WhatsApp rows, sync, then verify in
   the DB that teacher tasks sit on the right day rows and admin tasks on admin rows,
   and in the UI (contact page, dashboard indicator, "המשימות שלי").
3. **Re-sync:** sync the same teacher again without clearing — no Claude call, no new
   tasks.
4. **Toggle race:** open a contact page, sync new messages for that teacher, tick a
   task on the stale page — the new messages must survive.
