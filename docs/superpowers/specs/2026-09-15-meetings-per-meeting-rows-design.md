# One Row Per Meeting on the Meetings Page

## Problem

Inside an expanded school section on the Meetings page, the past-meetings list is
built from individual `interactions` rows — one per attendee, not one per real-world
meeting. For a meeting with several attendees, this means the same content is
duplicated once per attendee's row, and there is no single place that shows who else
was at a given meeting without opening every row's own edit form.

This also caused a confirmed (non-blocking) bug from a prior review: editing a
multi-attendee meeting renders the edit form once per attendee row simultaneously,
because `editingGroupId === groupId` is checked independently for every row inside
`sortedRows.map(...)`.

## Goal

Inside an expanded school section, show **one row per real-world meeting** (not one
per attendee), with the school name and every attendee's name visible together on
that row — without needing to click anything — and the meeting's content collapsed
by default, revealed once (not duplicated) when the row is clicked. Editing becomes a
single form per meeting instead of one per attendee.

## Behavior

**Grouping.** The existing `groupCompletedBySchool` (which buckets individual rows by
their contact's school) is replaced by a two-step grouping: first collapse all
completed rows into meeting groups via the existing `groupMeetingsByGroupId` helper
(same one already used for the upcoming-meetings list), each carrying `groupId`,
`date`, `rowIds`, `contactNames`, and `schools` (already computed by that helper —
it's the union of every attendee's school in that meeting, deduplicated). Then bucket
those *meeting groups* by school: a meeting appears once under every distinct school
represented among its attendees (in the ordinary single-school case, that's just one
bucket; the rare cross-school meeting appears once per school, each time showing the
meeting's full attendee list, not just that school's own attendees). This is a
one-line generalization of "one meeting, one or more schools" rather than "one row,
one school" as today.

**Per-meeting row (school section expanded).** Each row shows, on one line, in this
order: the school's own text style (`font-medium text-gray-800` — matching the
existing outer section header's class exactly, so the school name reads identically
wherever it appears) followed by the meeting's full attendee names joined with `, `
in the existing teacher-name style (`text-sm font-medium text-blue-600` — the class
already used for the single-teacher-name today), the meeting's date, and the existing
✏️ edit control. Fonts, sizes, and weights are unchanged from today for both
elements — they're simply rendered together on the same line instead of the school
name only appearing once in the section's own header above.

**Content collapsed by default, one copy on click.** The row itself is now also a
toggle (new `openMeetingId` state, single-select like the existing `openSchool`
state): clicking it shows/hides a `▲`/`▼` chevron and the meeting's `content` exactly
once below the row when open. This replaces today's always-visible
`{row.content && <p>...</p>}`, which was already being rendered once per attendee row
(the actual duplication this feature removes).

**Editing.** Opening edit (✏️) on a meeting row shows exactly one `MeetingEditForm`
for that meeting (already possible today for a single attendee row — the fix here is
that with one row per meeting instead of one row per attendee, there is naturally
only one place to click ✏️ per meeting, so the duplicate-form bug is resolved as a
side effect of the regrouping, not through a separate fix). Saving continues to call
the existing `saveMeetingEdit(rowIds, ...)` unchanged — it already updates every
attendee's row in the group at once.

**Out of scope:**
- The upcoming-meetings ("פגישות עתידיות") section already shows one row per meeting
  (via the same `groupMeetingsByGroupId` helper) and already shows attendee names —
  it is unaffected by this change.
- No change to `AddMeetingModal.jsx`, `saveMeetingEdit`'s reconciliation logic, or any
  Supabase schema/query — this is purely a rendering/grouping change in
  `Meetings.jsx`.
- No change to the school-level accordion (`openSchool`) or the top `SchoolStats`
  tiles — only the list rendered *inside* an expanded school section changes.

## Implementation shape

- `frontend/src/pages/Meetings.jsx`:
  - Replace `groupCompletedBySchool(rows, contactsById)` with a function that takes
    already-grouped meeting groups (from `groupMeetingsByGroupId(completed,
    contactsById)`) and buckets them by each group's own `schools` array (falling
    back to `'ללא בית ספר'` when a group's `schools` array is empty), tracking each
    school's most recent meeting date the same way `lastAt` is tracked today (now
    from the meeting group's `date` field instead of a raw row's `created_at`).
  - The per-school section's inner list (`sortedRows.map(...)`) becomes a map over
    that school's meeting groups instead of individual rows, sorted by `date` desc
    (same ordering as today, just on groups instead of rows).
  - New `openMeetingId` state (a single string id or `null`) controls which meeting's
    content is currently expanded within any open school section; toggled by
    clicking the row (excluding clicks on the ✏️ button itself, which continues to
    open the edit form instead, exactly as it does today for the ▲/▼ school toggle
    vs. its own controls).
  - `firstRowContent` (already used by the upcoming-meetings list to fetch a group's
    content since `groupMeetingsByGroupId` doesn't carry it) is reused here too,
    rather than duplicating that lookup.
