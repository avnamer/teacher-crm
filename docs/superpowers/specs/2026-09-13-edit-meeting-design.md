# Edit Meeting Date/Content from the Meetings Page

## Problem

The Meetings page (built in a prior spec/plan, `2026-09-13-meetings-page-redesign-design.md`)
lists both past (completed) and upcoming (scheduled) meetings, but offers no way to
fix a mistake — a wrong date, a typo in the content — without leaving the page and
finding the right teacher's contact detail page to edit the underlying interaction
row by hand. For a multi-attendee meeting, that also only fixes one attendee's copy,
leaving the others out of sync.

## Goal

Let the mentor edit a meeting's date and content directly from the Meetings page,
for both past and upcoming meetings, with the edit applying consistently to every
attendee's own record at once.

## Behavior

**Where:** a ✏️ control on each row in the past-meetings-by-school list, and on each
entry in the "פגישות עתידיות" (upcoming) section. Clicking it turns that entry into an
inline form — a date input and a content textarea, pre-filled with the current
values — with שמור/ביטול buttons. This mirrors the inline-edit pattern already used
by the dashboard's scheduled-meeting banner (`ScheduledMeetingRow` in `Contacts.jsx`).

**Group-wide edit:** a meeting may have several `interactions` rows (one per
attendee) sharing one `metadata.meeting_group_id` (see the meetings-page-redesign
spec for why). Saving an edit updates `content` and `created_at` on **every row in
that group**, not just the row the edit was opened from — consistent with how the
meeting was created (identical content pushed to every attendee) and with the
group-wide semantics the dashboard banner's "עדכן שהתקיימה"/"לא התקיימה" actions
already use. A row with no `meeting_group_id` (a legacy or reclassified interaction)
is its own group of one, per the existing `groupMeetingsByGroupId` fallback.

**Date change affects status:** the new date determines the group's resulting
`metadata.meeting_status`, exactly like `AddMeetingModal`'s own create-time logic:

- New date is today or in the past → every row's `metadata.meeting_status` key is
  removed (the meeting is/becomes completed). Content is required.
- New date is in the future → every row's `metadata.meeting_status` is set to
  `'scheduled'`. Content is optional.

This means editing a completed meeting's date into the future re-schedules it — it
moves to "פגישות עתידיות", and once that new date passes, into the dashboard's
"needs an update" banner, same as if it had been scheduled that way from the start.
Editing an upcoming meeting's date into the past or today completes it immediately
(content becomes required to save, matching the symmetric rule above).

**Out of scope:** changing who attended (attendees are fixed at creation time — a
different flow would be needed to add/remove a row from a group), and anything to do
with `not_held` meetings (they aren't shown on this page, so there's nothing here to
edit into or out of that state).

## Implementation shape

- Reuse `groupMeetingsByGroupId` (already in `frontend/src/lib/meetings.js`) applied
  to the full `meetings` array (not just `completed` or just `scheduled` subsets,
  since an edit needs to find every sibling row regardless of which section the user
  opened the edit from) to resolve "all row ids in this meeting" from any single
  row's `id` or `meeting_group_id`.
- The edit form's save handler updates each row in the resolved group individually
  (`content`, `created_at`, `metadata` per row, preserving each row's own other
  metadata keys such as `attendees`) — the same per-row-loop approach already used by
  `ScheduledMeetingRow`'s `markHeld`/`markNotHeld` in `Contacts.jsx`, for consistency.
  Since `Meetings.jsx` already holds full row objects (including `metadata`) in its
  `meetings` state, the update can read each row's current metadata directly from
  that state rather than re-fetching from Supabase first (no benefit to re-fetching
  here — unlike the dashboard banner, which never carries metadata into its grouped
  view in the first place).
- On success, reload via the page's existing `loadAll()` — this is what
  `AddMeetingModal`'s own `onSaved` already does, and keeps the school-recency
  banner, upcoming list, and past list all consistently up to date after an edit
  that may have moved a meeting between those sections.
