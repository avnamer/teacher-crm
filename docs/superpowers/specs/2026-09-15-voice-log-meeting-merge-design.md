# Merge Voice-Logged Meetings into Scheduled Meetings

## Problem

A meeting can exist as a `interactions` row (type `meeting`) two different ways:
scheduled ahead of time via `AddMeetingModal` (one row per attendee, sharing a
`meeting_group_id`, `metadata.meeting_status: 'scheduled'`, content usually empty),
or logged after the fact via the voice-log approval flow (`PendingApprovalAccordion.jsx`
→ `saveInteractionRow`), which always inserts a single, ungrouped row for exactly one
teacher — the one identified by `matched_contact_id` / `teacherId`.

These two paths never talk to each other. When a meeting that was scheduled in
advance for several teachers actually happens and gets voice-logged, approval creates
a brand-new standalone row for whichever single teacher the AI recognized, while the
original scheduled (empty, `meeting_status: scheduled`) rows for every attendee —
including the one just logged — are left untouched. The result observed in
production: the recognized teacher (נור) ends up with two rows for the same
real-world meeting (an empty scheduled one and a new logged one), and every other
attendee (חנין) is left with only the empty scheduled row and no record the meeting
happened or who else was there.

## Goal

Approving a voice log classified as a meeting should, when a matching scheduled
meeting exists, complete that meeting in place for every one of its attendees —
one merged record, visible in every attendee's history, carrying the full content and
the complete attendee list — rather than creating a disconnected duplicate.

## Behavior

**Multi-teacher picker replaces the single dropdown, for meetings only.** In
`PendingApprovalAccordion.jsx`, when `route === 'teacher_call'` and
`communicationType === 'meeting'`, the "מורה שזוהה" single-select dropdown is
replaced by a multi-select checkbox list (same UI pattern as `AddMeetingModal`'s
attendee picker). For every other communication type, and for `admin_task`, nothing
changes — those stay single-target.

**Default selection.** When the picker first renders for a meeting:
1. The AI-matched teacher (`matched_contact_id` / `teacherId`, same matching logic as
   today) starts checked.
2. The system looks for existing `interactions` rows with
   `type = 'meeting'`, `metadata.meeting_status = 'scheduled'`, `contact_id` equal to
   the matched teacher, and `created_at` falling on the **same calendar day** as the
   voice log's `item.created_at` (the day the call was recorded). If found, every
   other attendee of that scheduled meeting (via its `meeting_group_id`) is checked
   too.
3. The admin can freely check/uncheck teachers before approving — covering both "the
   AI misidentified who was there" and "an extra teacher joined a meeting that wasn't
   originally scheduled with them."

**Merge logic on approve.** A new function, `mergeOrCreateMeeting`, replaces the
`saveInteractionRow` call for the meeting case. Given the final set of selected
teacher IDs, the call's content/metadata, and the call's date:

1. Query `interactions` for rows with `type = 'meeting'`,
   `metadata.meeting_status = 'scheduled'`, `contact_id in (selected teacher IDs)`,
   `created_at` on the same calendar day as the call.
2. If none found → **create**: insert one new row per selected teacher, all sharing a
   freshly generated `meeting_group_id`, mirroring exactly what `AddMeetingModal`
   does for a same-day (non-future) meeting — `metadata.attendees` per row is the
   other selected teachers' names, no `meeting_status` key (immediately completed).
3. If any found → **merge**: treat every distinct `meeting_group_id` among the found
   rows as one target (in the rare case selected teachers span two different
   scheduled groups on the same day, both groups collapse into one). Pick one
   existing `meeting_group_id` as the target id.
   - For each selected teacher who already has a row in one of those groups: update
     that row — set `content`, merge in the call's metadata (`transcript`,
     `action_items`, `mentioned_dates`, `teacher_name_spoken`, `confirmed_by_user`,
     `source`, `route`), remove the `meeting_status` key, and set
     `meeting_group_id` to the target id (a no-op unless its row came from a second,
     collapsing group).
   - For each selected teacher with no existing row in those groups: insert a new row
     with the target `meeting_group_id`, the same content/metadata, no
     `meeting_status`.
4. After all writes, recompute `metadata.attendees` on every row now in the target
   group (or the newly created group) to the current full teacher-name list minus
   each row's own teacher — so a manually-added teacher is correctly reflected in
   everyone else's attendee list, and vice versa.

This reuses the existing group-wide-update pattern already established for meetings
(`Meetings.jsx`'s `saveMeetingEdit`, the edit-meeting spec) rather than inventing a
new one.

**Calendar events for action items.** `createCalendarEventsForActionItems` is called
once per approval (unchanged call count), but `targetName` becomes the comma-joined
list of all selected teachers' names instead of a single name — one calendar event
per dated action item, titled with every attendee, not one event per teacher.

**Out of scope:**
- Non-meeting communication types keep today's single-teacher behavior.
- Matching window is strictly same calendar day — a meeting logged the day after it
  was scheduled for is treated as unmatched (spontaneous) rather than merged. Users
  hitting this can still merge manually by editing the resulting duplicate's date to
  align it, or by using the Meetings page's existing delete/edit tools.
- The AI prompt (`claudeAnalyze.js`) is not changed to extract multiple teacher
  names from the transcript — multi-attendee detection relies on the scheduled
  meeting's existing attendee list and/or manual selection, not on the model parsing
  several names out of speech.

## Implementation shape

- `frontend/src/lib/voiceLogActions.js`: add `mergeOrCreateMeeting({ teacherIds,
  createdAt, content, metadata })` implementing the query/merge/create logic above.
  Keep `saveInteractionRow` as-is for every non-(meeting) case.
- `frontend/src/lib/meetings.js` or `teacherMatch.js`: small helper to find
  same-calendar-day scheduled meeting rows for a set of contact IDs (used both to
  compute the approval screen's default selection and inside `mergeOrCreateMeeting`
  itself — same query, don't duplicate it).
- `frontend/src/components/PendingApprovalAccordion.jsx`: swap the meeting-case
  picker for the multi-select variant (conditioned on `communicationType ===
  'meeting'`), load the default-selection lookup on mount/when communicationType
  changes to `meeting`, and call `mergeOrCreateMeeting` instead of
  `saveInteractionRow` when approving a meeting.
- No backend or database schema changes — everything here is frontend logic over the
  existing `interactions` table and `metadata` shape.
