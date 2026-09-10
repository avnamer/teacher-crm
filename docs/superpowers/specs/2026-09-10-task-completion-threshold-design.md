# Design: Task Completion Threshold

Date: 2026-09-10
Source spec: `spec-task-completion-threshold.md` (user-provided, 2026-09-10)
Builds on: `2026-09-10-task-columns-monday-merge-design.md` (task columns feature, already
implemented as of commit `82f1c32` on `feature/mentors-page`)

## Context

The task-columns feature already lets Avner add checkbox-style columns to the teacher table
(`frontend/src/pages/Contacts.jsx`) — both general (`taskSource: 'general'`, created via
`ColumnManagerModal`) and Monday-sourced (`taskSource: 'monday'`, created via
`MondayColumnsModal`, e.g. `challenge1/2/3`). Each column's per-teacher value lives in
`contacts.custom_fields[key]`, and `isTaskDone(contact, col)` (lines 73-76) is the single source
of truth for whether a given teacher has completed a given task column.

This design adds a **completion threshold** on top of those existing task columns: an optional
per-column percentage that, once reached, auto-hides the column from the main table — while
keeping the underlying data and the ability to still see who's outstanding. Only Avner uses this
app; no teacher has login access, so every behavior below is admin-facing.

## 1. Column model: add `threshold` and `autoHidden`

Extend the column shape (only meaningful when `source === 'task'`):

```
{ ..., source: 'task', taskSource: 'general' | 'monday', threshold: number | null, autoHidden: boolean }
```

- `threshold`: percentage (0-100), optional. `null`/unset = no threshold behavior; the column
  behaves exactly as it does today (pure manual show/hide via the column manager).
- `autoHidden`: `false` by default. Set to `true` only by the system, when it auto-hides a column
  because its threshold was reached (see §2). Distinguishes "hidden by the threshold mechanism"
  from "hidden manually by Avner via the column manager," so the two don't fight each other.
- Both fields persist the same way every other column property does today — as part of the column
  object inside `settings.contacts_columns` (JSONB), via the existing `saveColumns`/
  `saveColumnsSilently` path. No new table, no schema migration.
- `DEFAULT_COLUMNS`' seeded Monday columns (`challenge1/2/3`) get `threshold: null, autoHidden:
  false` — unchanged behavior until Avner opts a column into a threshold.

## 2. Setting the threshold

- **General task columns**: `ColumnManagerModal`'s add-column form, when `newColType === 'task'`,
  gets an additional optional number input, "סף השלמה (%) — אופציונלי". Empty = `threshold: null`.
- **Monday task columns**: `MondayColumnsModal` gets the same optional field when adding a column.
- **Editing after creation**: both modals already list existing task columns for
  rename/reorder/remove; add an inline "✏️ סף" affordance next to each task-column row in that
  list to change or clear its threshold later. No separate settings screen.

## 3. Percentage calculation and auto-hide/show reactivity

For each task column with `threshold != null`:

```
percent = (teachers in myTeachers where isTaskDone(teacher, col)) / myTeachers.length * 100
```

`myTeachers` is the exact same Avner-filtered set `TaskStats` already uses (lines 360-372) — "the
teachers currently associated with Avner and shown on his page," per the spec.

A `useEffect` in `Contacts.jsx`, watching `[contacts, columns]`, recomputes `percent` for every
thresholded task column on every change and applies:

- `percent >= threshold && visible && !autoHidden` → set `{ visible: false, autoHidden: true }`.
- `percent < threshold && autoHidden` → set `{ visible: true, autoHidden: false }` (this is the
  spec's built-in debug/undo path: uncheck a teacher back to "not done," the column reappears).
- Any manual visibility toggle Avner makes himself in the column manager sets `autoHidden: false`
  regardless of current percent — a manual choice always wins immediately, and normal automatic
  behavior resumes only the next time percent actually crosses the threshold going forward.

This reuses `isTaskDone` and the existing `saveColumns` persistence path — no new save mechanism.
Because the effect only writes when the computed target state actually differs from the current
one, it does not loop.

## 4. Per-teacher open-tasks view (teacher detail page)

There is no teacher-facing to-do list anywhere in the app (teachers have no login). To satisfy
"a teacher who hasn't finished a thresholded task keeps surfacing somewhere, even after its column
is hidden from the main table," add a small "משימות פתוחות" section to
`frontend/src/pages/ContactDetail.jsx` (the single-teacher page), placed near the existing
interaction/journal history section.

- Lists every task column with `threshold != null` where `!isTaskDone(contact, col)` for this
  teacher — regardless of the column's current `visible`/`autoHidden` state.
- No new data: reads the same `contact.custom_fields` already loaded for that page. This is a
  read-only filtered view, not a new to-do subsystem.
- Empty state: section doesn't render at all if the teacher has no open thresholded tasks.

## 5. Notification badge for auto-hidden columns with outstanding teachers

Per the spec, this exists specifically to prevent losing visibility of unfinished teachers once a
column is auto-hidden (thresholds below 100% can still leave stragglers).

- Scope: only task columns where `autoHidden === true` (i.e., already hidden by the threshold
  mechanism — the moment this information would otherwise disappear from the main table). A
  column that's merely below its threshold and still visible already shows its stragglers directly
  in the table, so it's excluded here to avoid redundant noise.
- A small badge (icon + count), placed next to the existing `TaskStats` block, shows the count of
  **distinct teachers** (within `myTeachers`) who are incomplete on at least one auto-hidden
  thresholded column.
- Recomputed from the same reactive state as §3 — updates automatically as teachers complete
  tasks, and disappears entirely when the count reaches 0.
- Clicking the badge opens a modal listing, per outstanding teacher, which specific task(s)
  (column label + source) they haven't completed.

## Testing

- Setting/clearing a threshold on a general and a Monday task column.
- Crossing the threshold upward (column auto-hides, `autoHidden` becomes true) and back downward
  (column reappears, `autoHidden` clears) by toggling a teacher's checkbox.
- Manual show/hide via the column manager overriding `autoHidden`, and automatic behavior resuming
  on the next real threshold crossing.
- `ContactDetail.jsx` "משימות פתוחות" section: shows only thresholded+incomplete columns, empty
  when none, still shows entries for a column that's currently `autoHidden`.
- Badge count reflects distinct teachers across multiple auto-hidden columns (no double-count),
  updates live, and disappears at 0. Modal content matches the badge's underlying set.
