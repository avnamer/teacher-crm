# Design: Task Columns + Monday Merge + WhatsApp Task Composer

Date: 2026-09-10
Source spec: `spec-teacher-crm-features.md` (user-provided, 2026-09-10)

## Context

The Contacts page (`frontend/src/pages/Contacts.jsx`) is the unified teacher table. It already
supports a column manager (`ColumnManagerModal`) with three column sources: `core` (built-in
fields), `journal` (append-only timestamped notes), and `custom` (free-text, stored in
`contacts.custom_fields[key]`). Columns are ordered/sized/shown-or-hidden via
`settings.contacts_columns` (JSONB on the single `settings` row, id='global').

There is a separate `MondayTasks` page (`/monday`) that displays "challenge" submission status
per teacher, reading `custom_fields.challenge1/2/3` (values `'הוגש'` / `'לא הוגש'` / unset) and
`custom_fields.mentor_name`. **Important finding from code review:** despite the name, this page
and the rest of the app contain no live Monday.com API integration — the `monday_board_id` /
`monday_api_token` fields in Settings are stored but never read by any fetch call, in frontend or
backend. The actual "Monday sync" today is Claude Code (via the `monday-integration` skill)
reading the board on request and writing values directly into `contacts.custom_fields` in
Supabase. This will **continue to be true after this change** — confirmed with the user, who does
not have admin API access to the board. Nothing in this design adds a live in-app Monday
connection.

Similarly, the WhatsApp send flow (`frontend/src/pages/WhatsApp.jsx`) does not use `wa.me` links
(spec's assumption was stale) — it sends through a real backend (`backendFetch('/api/whatsapp/bulk-send')`)
using stored `message_templates` with `{{placeholder}}` substitution (`resolveMessage`). This
design reuses that pipeline unchanged, per the user's own instruction ("no need to change the
send mechanism, just feed in content").

## 1. Column model: new `task` column source

Extend the column definition shape used throughout `Contacts.jsx` and `ColumnManagerModal`:

```
{ key, label, source: 'task', taskSource: 'general' | 'monday', visible, locked, width }
```

- Value storage: `contacts.custom_fields[key]`, boolean (`true` = done). Same storage mechanism
  as existing `custom` columns — no schema migration needed (`custom_fields` is JSONB).
- Cell rendering: a centered checkbox instead of a text field. Click toggles the value directly
  (no separate edit/save step) via the existing `saveCell` path, which already sets
  `custom_fields._manual_edit = true` — this is what already protects a contact's fields from
  being silently overwritten by a future agent-run Monday sync, and applies unchanged to
  Monday-sourced task columns too.
- `getCellValue`, `getEditType`, `formatDisplay` in `Contacts.jsx` get a `task` branch.

User-added columns (via `ColumnManagerModal`'s "+ הוסף" flow) are always `taskSource: 'general'`.
This is what makes the general task set "one fixed list for everyone" — it's the same guarantee
every other column in this table already has (one column definition, one value per row).
Monday-sourced task columns are created only through the Feature 3 panel (below), never through
the generic add-column box — this keeps the two kinds of task columns clearly separated at
creation time, not just by a flag.

## 2. Feature 1 — General task columns

- `ColumnManagerModal`'s current journal/text toggle becomes a 3-way choice: טקסט רגיל / יומן /
  משימה (task). Selecting "משימה" adds `{ source: 'task', taskSource: 'general' }`.
- Table renders these as checkboxes per teacher, as described above.
- Removable/hideable the same way `custom`/`journal` columns are today (existing data in
  `custom_fields` is preserved on hide, per the existing "הנתונים הקיימים... לא יימחקו" confirm
  dialog).

## 3. Feature 2 — Merge Monday page into the teacher table

- Delete `frontend/src/pages/MondayTasks.jsx`.
- Remove the `/monday` route from `App.jsx` and the "משימות Monday" entry from `Navbar.jsx`.
- Add 3 default columns to `DEFAULT_COLUMNS` in `Contacts.jsx`:
  `{ key: 'challenge1', label: 'אתגר 1', source: 'task', taskSource: 'monday', visible: true, ... }`
  (and challenge2/challenge3). These reuse the exact `custom_fields` keys the data already lives
  under, so no data migration script is needed — existing values show up immediately.
- `loadColumns()` already merges any `DEFAULT_COLUMNS` entries missing from a saved
  `settings.contacts_columns` into the saved list; this covers rollout to the existing saved
  config automatically.
- `BulkSendModal` is imported by `MondayTasks.jsx` today; after deletion, `WhatsApp.jsx` must
  keep exporting it (it's already used by `WhatsApp.jsx` itself, and will now also be used by the
  new per-column and per-teacher reminder flows in Feature 5).
- Binary checkbox vs. today's 3-state ("הוגש" / "לא הוגש" / unknown) stats: the cell itself shows
  checked only for `'הוגש'`; anything else (including unset/unknown) shows unchecked. The
  three-way distinction is preserved only in aggregate stats (Feature 4), not in the per-cell
  checkbox — the spec's checkbox requirement is inherently binary.

## 4. Feature 3 — Monday "sync management" panel

A new small panel (button next to "⚙️ עמודות" in the Contacts page toolbar, e.g. "🔄 עמודות
Monday") that manages **only column metadata**, not a live sync:

- Add a Monday-sourced task column: user enters a label and a `custom_fields` key (or the key is
  derived from the label, editable) — creates `{ source: 'task', taskSource: 'monday' }`.
- Rename / remove existing Monday-sourced task columns (same remove semantics as other columns:
  hides, doesn't delete underlying data).
- No "sync now" button, no API call — there is nothing to call. A short static note in the panel
  explains that data updates happen when the user asks Claude Code to run a sync.
- **Key contract documented here for future syncs:** any Monday-sourced task column's checkbox
  state is driven by writing a truthy/falsy-ish value (matching today's convention, e.g.
  `'הוגש'`/other) into `contacts.custom_fields[<that column's key>]` for the matching contact,
  skipping contacts where `custom_fields._manual_edit === true`. Future sync sessions (via the
  `monday-integration` skill) should read the current column list from
  `settings.contacts_columns` (filter `taskSource === 'monday'`) to know which keys to write,
  rather than hardcoding `challenge1/2/3`.

## 5. Feature 4 — Separate per-source counters

- A new stats bar on the Contacts page (same visual pattern as the existing `ContactStats`
  component: a compact summary row, expandable to a breakdown), showing two independent tallies
  computed over currently-visible teachers (`isMyTeacher` filter, matching existing stats scope):
  - Monday tasks: done/total across all `taskSource: 'monday'` columns.
  - General tasks: done/total across all `taskSource: 'general'` columns.
- These are aggregate counts (X done out of Y possible, where Y = teachers × task columns of that
  source), not per-teacher rows — per-teacher detail is already visible directly in the table via
  the checkboxes themselves, so no redundant per-row counter is added.

## 6. Feature 5 — WhatsApp task composer

- **Per-teacher composer:** a "📲" icon button added to each row's action cell (next to today's
  "ערוך"/"מחק"). Opens a modal listing that teacher's currently-unchecked task columns from both
  sources (each labeled with its source, e.g. "Monday: אתגר 2"), with a checkbox per task to
  include. Confirming:
  - Builds message text listing the selected task labels (e.g. "היי {name}: המשימות שעדיין לא
    ביצעת הן: ...").
  - Sends via the existing pipeline: opens `BulkSendModal` preset with
    `initialContactIds: [thatTeacherId]`, matching today's `MondayTasks` → `BulkSendModal` pattern.
    The composed open-tasks text is made available to `resolveMessage` as a new `{{open_tasks}}`
    placeholder usable inside `message_templates`, so the existing template+send infrastructure
    handles delivery unchanged — only the content is new, as requested.
- **Generalized bulk reminder:** every task column header (general or Monday) gets the same
  "📲 remind everyone who hasn't done X" button that today's Monday challenge tiles have,
  reusing `BulkSendModal` with `initialContactIds` = teachers where that column is unchecked.

## Migration / cleanup checklist

- [ ] Delete `MondayTasks.jsx`, its route in `App.jsx`, its Navbar entry.
- [ ] Confirm `BulkSendModal` stays exported from `WhatsApp.jsx` after `MondayTasks.jsx` is gone.
- [ ] Search the app for any other link/reference to `/monday` before deleting (spec's own
      requirement) — currently only `App.jsx` (route) and `Navbar.jsx` (link) reference it.
- [ ] Add `challenge1/2/3` to `DEFAULT_COLUMNS` as Monday task columns (no data migration script
      needed — same keys, same table).

## Out of scope (explicitly, per user confirmation)

- No live Monday.com API call anywhere in the app (no admin board access available).
- No change to the WhatsApp backend send mechanism — only new content sources feed into the
  existing template/placeholder system.
- **Correction after further code review:** `backend/server.js` has no `/api/whatsapp/*` routes
  at all (it only defines `/api/health`) — the "existing send pipeline" referenced above is UI +
  database scaffolding (`message_templates`, `scheduled_messages`, `BulkSendModal`) with no
  working backend behind it today. This is a pre-existing gap unrelated to this spec. Per user
  confirmation, this plan does **not** build that backend — Feature 5 wires into the same
  UI/flow that exists today (`BulkSendModal` + `backendFetch`), which will not actually deliver
  messages until a WhatsApp backend is built separately, exactly as it doesn't today.
