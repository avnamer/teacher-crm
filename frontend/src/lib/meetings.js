// Shared helpers for interactions/type='meeting' rows — used by both the dashboard's
// "meetings needing an update" banner and the Meetings page, so a scheduled meeting
// means exactly the same thing in both places.

/** A future meeting that hasn't been confirmed as having happened yet. */
export function isScheduledMeeting(row) {
  return row.metadata?.meeting_status === 'scheduled'
}

/** A scheduled meeting explicitly marked as not having happened. */
export function isNotHeldMeeting(row) {
  return row.metadata?.meeting_status === 'not_held'
}

/** Already happened — either logged directly, or a scheduled meeting since confirmed. */
export function isCompletedMeeting(row) {
  return !isScheduledMeeting(row) && !isNotHeldMeeting(row)
}

/**
 * Groups meeting rows created in the same AddMeetingModal submission back together.
 * `meeting_group_id` is what ties multi-attendee rows to one real-world meeting —
 * `created_at` alone can't, since two unrelated meetings scheduled the same day would
 * collide (the time portion is always fixed at noon).
 *
 * Rows with no `meeting_group_id` (interactions reclassified to `meeting` from the
 * contact detail page, rather than created via the modal) each form their own
 * single-row group — correct, since they weren't created as part of a group meeting.
 */
export function groupMeetingsByGroupId(rows, contactsById) {
  const groups = {}
  for (const row of rows) {
    const groupId = row.metadata?.meeting_group_id || row.id
    groups[groupId] ??= { groupId, date: row.created_at, rowIds: [], contactNames: [], schools: new Set() }
    groups[groupId].rowIds.push(row.id)
    const contact = contactsById[row.contact_id]
    if (contact) {
      groups[groupId].contactNames.push(contact.name)
      if (contact.school) groups[groupId].schools.add(contact.school)
    }
  }
  return Object.values(groups).map(g => ({ ...g, schools: [...g.schools] }))
}
