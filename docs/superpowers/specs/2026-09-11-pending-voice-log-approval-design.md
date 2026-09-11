# Pending Voice Log Approval

## Problem

Today, saving a voice-logged instruction requires the recording user to review
an AI-generated analysis card (route, matched teacher, communication type,
summary, action items) and press "אשר ושמור" before anything is saved. This
confirmation step is impractical while driving/traveling — the primary
scenario this feature exists for.

## Goal

Recording an instruction while traveling should require no post-recording
interaction beyond pressing "סכם" (summarize). The AI analysis still runs
immediately, but the result is saved automatically as a **pending** item
instead of requiring confirmation. A mentor's own admin dashboard shows an
accordion of that mentor's pending items; opening it reveals each one as an
editable card (matching today's confirmation-card UI). Approving a card saves
it to its permanent destination — exactly as if the recorder had confirmed it
at record time — using the *original recording timestamp*, not the approval
time. A delete button lets the admin discard bad recordings.

## Data model

New table `pending_voice_logs`:

| column | type | notes |
|---|---|---|
| `id` | uuid, pk | |
| `mentor_name` | text | matches the mentor scoping already used elsewhere (`contacts.custom_fields.mentor_name`) — pending items are only ever visible to the mentor who recorded them |
| `transcript` | text | raw or edited transcript |
| `route` | text, nullable | `'teacher_call' \| 'admin_task' \| 'new_task_column'`, null if analysis failed |
| `teacher_name_spoken` | text, nullable | |
| `matched_contact_id` | uuid, nullable | best-guess match from `teacherMatch.js`; admin can override at approval time |
| `communication_type` | text, nullable | one of the existing `interactions.type` values |
| `summary` | text, nullable | |
| `action_items` | jsonb | `[]` if analysis failed |
| `mentioned_dates` | jsonb | `[]` if analysis failed |
| `column_label` | text, nullable | used only for the `new_task_column` route |
| `created_at` | timestamptz | the actual recording time — carried forward to the permanent record on approval |

No `status` column — a row's existence *is* the pending state. Approval or
deletion removes the row.

This is a new, isolated table rather than a `status` flag on `interactions`
because at save time the teacher match, type, and even the route itself are
unconfirmed, and the `new_task_column` route doesn't produce an `interactions`
row at all today. Keeping drafts out of `interactions` avoids adding
`status = 'confirmed'` filters to every existing query against that table.

## Recording flow changes (`frontend/src/pages/VoiceLog.jsx`)

- Recording, live transcript, and manual transcript editing are unchanged.
- Pressing "סכם" still calls `POST /api/voice-log/analyze` immediately.
- **Changed:** the result is inserted into `pending_voice_logs` (via the
  Supabase client, same pattern as the current `saveInteraction`) instead of
  rendering the confirmation card. `created_at` is set to the moment
  recording finished.
- The screen shows a brief toast ("נשמר, ממתין לאישור") and resets for the
  next recording. No card, no required interaction.
- If the `/analyze` call fails, the raw transcript is still inserted into
  `pending_voice_logs` with `route`, `communication_type`,
  `matched_contact_id` left null and `action_items`/`mentioned_dates` as
  `[]`, so nothing recorded on the road is ever lost — it just needs manual
  classification at approval time.
- The existing confirmation-card JSX/logic (route picker, teacher
  match/override, communication-type buttons, editable summary + action
  items) is relocated into a shared component reused by the approval UI
  (section below) rather than deleted.

## Approval UI (dashboard)

- New component `PendingApprovalAccordion`, mounted in
  `frontend/src/pages/Contacts.jsx` at the top of the existing `space-y-4`
  block, above `ContactStats`. Rendered only when the current mentor has ≥1
  row in `pending_voice_logs`.
- Collapsed: header bar in the same visual style as the existing
  `PendingTasksBanner` (`Contacts.jsx:788-833`), reading "🎙️ N הודעות קוליות
  מחכות לאישור" with a ▼/▲ toggle, same interaction pattern.
- Expanded: each pending row renders as its own edit-mode card, stacked
  newest-first, reusing the confirmation-card component from `VoiceLog.jsx`
  pre-filled from that row (blank fields where analysis failed). Each card
  has its own "אשר ושמור" and "מחק" buttons — these are per-item actions, not
  one global submit.
- Approving or deleting a card removes it from the list optimistically *after*
  the corresponding Supabase call succeeds (not before — see error handling),
  and the collapsed-header counter updates accordingly.
- Query for the accordion's data is scoped by `mentor_name`, matching how the
  rest of the dashboard already scopes teachers/interactions per mentor.

## Approve / delete flow

- **Approve** reuses the exact save logic already in `VoiceLog.jsx` for each
  route:
  - `teacher_call` / `admin_task` → `saveInteraction`-equivalent insert into
    `interactions`, with `metadata` carrying the same shape as today
    (`transcript`, `action_items`, `mentioned_dates`, `teacher_name_spoken`,
    `confirmed_by_user: true`, `source: 'voice_pwa'`, `route`).
  - `new_task_column` → `addCustomColumnFromVoice`-equivalent update to
    `settings.contacts_columns`.
  - `admin_task` also uses `ensureAdminContact` as today.
  - **`created_at` on the `interactions` insert is explicitly set to the
    pending row's original `created_at`** (not left to default to "now"),
    so the interaction lands at the time it actually happened.
  - Dated action items still trigger `POST /api/google/create-event` as
    today, using the admin's edited/corrected values.
  - On success, the `pending_voice_logs` row is deleted.
- **Delete** just deletes the `pending_voice_logs` row. No `interactions` row
  is ever created. No confirmation dialog beyond the button itself.

## Error handling

- Analysis failure at record time → transcript still saved to
  `pending_voice_logs` (see above) — nothing is lost.
- Teacher match ambiguity/wrong match on approval → same override control
  from the existing confirm card; no new UI needed.
- Network failure during approve/delete → show an inline error on that card
  and leave it in the list; only remove it optimistically after the Supabase
  call actually succeeds.
- Double-click on approve/delete → button disabled immediately on first
  click for that card.

## Out of scope

- Editing the recording's audio/transcript retroactively beyond what the
  existing confirm-card fields already allow.
- Cross-mentor visibility of pending items (each mentor only ever sees their
  own, matching existing dashboard scoping) — no "admin sees everyone's
  pending items" mode.
- Notifications/push alerts when a new pending item arrives — the admin
  discovers it by opening the dashboard.

## Testing (manual — no existing automated suite for this feature)

- Record a voice note locally (`run-teacher-crm`); confirm it lands in
  `pending_voice_logs` and not in `interactions`.
- Confirm the dashboard accordion appears for the recording mentor, with the
  correct count, and the edit card is pre-filled correctly.
- Approve one item per route (`teacher_call`, `admin_task`,
  `new_task_column`); confirm each lands in its correct destination with the
  original recording timestamp preserved.
- Delete a pending item; confirm it disappears with no side effects.
- Temporarily break the `/analyze` endpoint and confirm the raw-transcript
  fallback still reaches `pending_voice_logs` with null classification
  fields, and that the approval card handles blank fields correctly.
