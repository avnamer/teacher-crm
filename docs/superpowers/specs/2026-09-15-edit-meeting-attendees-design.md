# Edit Meeting Attendees

## Problem

A meeting's attendees (which teachers are tagged to it) are fixed at creation time —
whether created via `AddMeetingModal` or, as of the voice-log-meeting-merge feature,
via approving a voice log. The prior edit-meeting spec explicitly called this out as
out of scope: "changing who attended... a different flow would be needed." In
practice this matters because attendee tagging can be wrong from the start (a
teacher who was actually there gets missed) with no way to fix it short of manual
database edits — the exact situation this feature exists to fix.

## Goal

Let the mentor add or remove tagged teachers on an existing meeting directly from the
Meetings page's inline edit form, alongside the date/content editing that already
exists there — correcting attendee tagging the same way voice-log approval already
lets you correct which teacher the AI recognized.

## Behavior

**Where:** inside the existing `MeetingEditForm` (`frontend/src/pages/Meetings.jsx`),
which already renders inline (date input + content textarea + שמור/ביטול/מחק) when a
meeting's ✏️ is clicked, in both the past-meetings-by-school list and the
"פגישות עתידיות" (upcoming) list. A new attendee checkbox list is added to this same
form, using the identical pattern already established by `AddMeetingModal`'s
attendee picker and by the voice-log approval multi-select
(`PendingApprovalAccordion.jsx`): a scrollable bordered list of all of the mentor's
teachers, each with a checkbox, and an "N נבחרו" count below it. Teachers currently
tagged on the meeting being edited start checked; every other teacher starts
unchecked. This applies identically whether the form was opened from the past list
or the upcoming list — the same shared component, same save logic.

**Saving attendee changes.** `saveMeetingEdit` (in `Meetings.jsx`) already takes the
full set of `rowIds` belonging to the meeting group and applies date/content/status
to each. It's extended to also take the newly selected teacher-id set and reconcile
it against the group's current attendees:

- A teacher who **stays checked** (already had a row in the group): that row is
  updated exactly as today (content, `created_at`, `meeting_status` derived from the
  new date) — unchanged behavior.
- A teacher who is **newly checked** (no existing row in the group): a new
  `interactions` row is inserted for them, with the group's `meeting_group_id`, the
  same `content`/`created_at`/`meeting_status` being saved for everyone else — the
  same shape `AddMeetingModal` produces for a new attendee.
- A teacher who is **unchecked** (had a row in the group, now removed): that row is
  **deleted outright** — not just unlinked from the group. This mirrors the existing
  "מחק פגישה" control's own semantics (a hard delete of the interaction record), and
  matches the mental model of "she wasn't actually there" rather than "she attended
  something else."

**Recomputing attendees.** After the add/remove/update pass, `metadata.attendees` on
every row that remains in the group (both previously-existing and newly-added) is
recomputed to the current full tagged-teacher-name list minus each row's own
teacher — identical in spirit to how `mergeOrCreateMeeting`
(`frontend/src/lib/voiceLogActions.js`, from the voice-log-meeting-merge feature)
already does this recomputation, reused here for consistency rather than inventing a
second convention.

**Validation:** at least one teacher must remain checked to save (a meeting with zero
attendees doesn't make sense) — if the admin unchecks everyone, saving is blocked
with the same `alert()`-based pattern this form already uses for its date/content
validation, e.g. "יש לבחור לפחות מורה אחת שהשתתפה בפגישה" (matching the wording
already used for this exact validation in the voice-log approval picker).

**Out of scope:**
- No confirmation dialog before deleting an unchecked teacher's row beyond the
  existing "לבחור לפחות מורה אחת" validation — this mirrors how removing a row today
  already only asks for confirmation via the separate, explicit "מחק פגישה" button,
  not via checkbox changes. (If this turns out to be too easy to trigger by
  accident, a follow-up can add a lighter warning — not addressed here.)
- No "select all / clear all" shortcut for the attendee picker in this form (neither
  `AddMeetingModal` state carries over here, nor did the voice-log approval picker
  add one) — YAGNI unless a specific need for it comes up.
- No change to how attendees are chosen at *creation* time (`AddMeetingModal`) or via
  voice-log approval (`PendingApprovalAccordion.jsx`/`mergeOrCreateMeeting`) — this
  spec only adds editing to an *existing* meeting.

## Implementation shape

- `frontend/src/pages/Meetings.jsx`:
  - `MeetingEditForm` gains a `teachers` prop (the full list, same one already passed
    into `AddMeetingModal` elsewhere on this page) and an `initialAttendeeIds` prop
    (the meeting group's current teacher ids), and renders the checkbox picker using
    the same Tailwind classes as `AddMeetingModal`'s own picker for visual
    consistency.
  - `saveMeetingEdit(rowIds, { date, content, isFuture, teacherIds })` is extended to
    accept the final selected teacher-id set and perform the reconcile-and-recompute
    logic described above, reusing the existing `interactions` table directly (no new
    backend endpoint — everything here is a frontend Supabase call, consistent with
    the rest of this file).
  - Both call sites that render `MeetingEditForm` (past list, upcoming list) pass the
    full `contacts` array as `teachers` and derive `initialAttendeeIds` from the
    resolved group's row set (`groupById[...]`/`allGroups`, already computed in this
    file for other purposes).
- No changes to `frontend/src/components/AddMeetingModal.jsx` or
  `frontend/src/lib/voiceLogActions.js` — this is additive to `Meetings.jsx` only.
