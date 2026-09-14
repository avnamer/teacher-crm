# Delete Meeting from the Meetings Page

## Problem

The just-shipped inline meeting editor (`docs/superpowers/specs/2026-09-13-edit-meeting-design.md`)
lets a mentor fix a meeting's date and content, but offers no way to remove a meeting
logged by mistake (e.g. a duplicate, or a test entry) without leaving the page.

## Goal

Add a delete action to the same inline edit flow already on the Meetings page.

## Behavior

A red **"מחק פגישה"** button appears inside `MeetingEditForm` (the same inline form
opened via ✏️), alongside the existing שמור/ביטול buttons. Clicking it shows a
confirmation dialog:

> למחוק את הפגישה לצמיתות? הפעולה תמחק את הרשומה עבור כל המשתתפים.

(matching the wording style of the existing delete-confirmation on the contact detail
page — `confirm('למחוק את האינטראקציה לצמיתות?')` in `ContactDetail.jsx`).

On confirm, every `interactions` row belonging to the meeting's group (all
attendees — the same `meeting_group_id`-based resolution the edit feature already
uses) is deleted, and the page reloads via the existing `loadAll()`. On cancel,
nothing happens and the form stays open.

**Group-wide, matching edit's behavior:** for a multi-attendee meeting, deleting
removes every attendee's row, not just the one whose row the delete was triggered
from — consistent with editing already applying to the whole group.

## Implementation shape

- `MeetingEditForm` gains one more prop, `onDelete`, called with no arguments (the
  form itself owns the confirmation dialog, matching how it already owns save
  validation).
- Both call sites (`upcoming` and the past-by-school list) already compute the
  group's row ids (`g.rowIds` / `rowIds` respectively) for `onSave` — the same value
  is passed to a new `onDelete={() => deleteMeetingGroup(rowIds)}` handler.
- `deleteMeetingGroup(rowIds)` in the page component: `supabase.from('interactions').delete().in('id', rowIds)`,
  then `setEditingGroupId(null)` and `await loadAll()`, mirroring `saveMeetingEdit`'s
  own success path. Errors surface via the same `alert()` convention used everywhere
  else on this page.
