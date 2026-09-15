import { supabase } from './supabase.js'
import { backendFetch } from './api.js'

// Fixed pseudo-teacher row representing the mentor themself, used as the
// documentation target for "admin_task" voice logs — reuses the exact same
// interactions-logging mechanism as a real teacher, just with a different target.
export const ADMIN_ROW_NAME = 'מנהל המערכת'
const ADMIN_ROW_ROLE = 'מנהל מערכת'
const ADMIN_ROW_PHONE = '000-ADMIN'

export const ROUTES = [
  { value: 'teacher_call', label: '👤 שיחה עם מורה' },
  { value: 'admin_task', label: '📝 משימה אישית לי' },
  { value: 'new_task_column', label: '📋 משימה לכל המורים' },
]

import { INTERACTION_TYPES } from './interactions.js'

// The voice-log approval flow classifies a single recorded phone call — 'mailing_list'
// is a bulk WhatsApp send and never applies here, so it's left out of this picker even
// though it's a normal INTERACTION_TYPES entry everywhere else (dashboard icons, the
// ContactDetail tagging dropdown).
export const COMMUNICATION_TYPES = INTERACTION_TYPES.filter(t => t.value !== 'mailing_list')

export async function ensureAdminContact() {
  const { data: existing, error: findErr } = await supabase
    .from('contacts')
    .select('id')
    .contains('custom_fields', { is_admin_row: true })
    .maybeSingle()
  if (findErr) {
    console.error('שגיאה בבדיקת רשומת מנהל המערכת:', findErr)
    return null
  }
  if (existing) return existing.id

  const { data: created, error: createErr } = await supabase
    .from('contacts')
    .insert({
      name: ADMIN_ROW_NAME,
      phone: ADMIN_ROW_PHONE,
      role: ADMIN_ROW_ROLE,
      gender: 'male',
      custom_fields: { is_admin_row: true, mentor_name: 'אבנר' },
    })
    .select('id')
    .single()
  if (createErr) {
    console.error('שגיאה ביצירת רשומת מנהל המערכת:', createErr)
    return null
  }
  return created.id
}

// Adds a new task (checkbox) column to the shared contacts table config — the
// exact same mechanism as picking "עמודת משימה" in the Contacts column manager,
// just driven by an AI-authored label instead of manual typing.
export async function addCustomColumnFromVoice(rawLabel) {
  const baseLabel = (rawLabel || 'משימה חדשה').trim() || 'משימה חדשה'
  const { data: settings, error: loadErr } = await supabase
    .from('settings')
    .select('contacts_columns')
    .eq('id', 'global')
    .single()
  if (loadErr) throw loadErr
  const current = settings?.contacts_columns || []

  let label = baseLabel
  let n = 2
  while (current.some(c => c.label === label || c.key === label)) {
    label = `${baseLabel} (${n})`
    n++
  }

  const newColumn = { key: label, label, source: 'task', taskSource: 'general', visible: true, locked: false }
  const { error: saveErr } = await supabase
    .from('settings')
    .update({ contacts_columns: [...current, newColumn] })
    .eq('id', 'global')
  if (saveErr) throw saveErr
  return label
}

// Writes one interactions row. createdAt (ISO string), when given, overrides the
// default now() — used at approval time so the row lands at the original recording
// time rather than when the admin got around to approving it.
export async function saveInteractionRow({ contactId, type, content, metadata, createdAt }) {
  const insertData = { contact_id: contactId, type, content, metadata }
  if (createdAt) insertData.created_at = createdAt
  const { error } = await supabase.from('interactions').insert(insertData)
  if (error) throw error
}

export async function createCalendarEventsForActionItems(actionItems, targetName, summary) {
  const datedItems = (actionItems || []).filter(item => item.due_date)
  if (datedItems.length === 0) return null

  const calendarFailureCount = (
    await Promise.allSettled(
      datedItems.map(item =>
        backendFetch('/api/google/create-event', {
          method: 'POST',
          body: JSON.stringify({
            title: `${item.text} — ${targetName}`,
            date: item.due_date,
            notes: summary,
          }),
        })
      )
    )
  ).filter(r => r.status === 'rejected').length

  return calendarFailureCount === 0
    ? null
    : calendarFailureCount === datedItems.length
      ? 'השיחה נשמרה, אך יצירת האירועים ביומן נכשלה'
      : `השיחה נשמרה, אך ${calendarFailureCount} מתוך ${datedItems.length} אירועים ביומן לא נוצרו`
}

// ─── Voice-logged meeting merge ────────────────────────────────────────────

// Same-day comparison uses the calendar date each created_at's ISO string carries —
// consistent with the dateInputValue()-style helpers already used elsewhere in this
// app (e.g. Meetings.jsx) for turning a stored timestamp back into "which day is this".
function calendarDateStr(iso) {
  return new Date(iso).toISOString().split('T')[0]
}

// Scheduled-meeting interactions rows (metadata.meeting_status === 'scheduled') for
// the given contact ids, landing on the same calendar day as referenceIso. Used both
// to default-select attendees when a voice log is first classified as a meeting, and
// by mergeOrCreateMeeting to decide what to merge into.
export async function findScheduledMeetingRows(contactIds, referenceIso) {
  if (!contactIds?.length) return []
  const { data, error } = await supabase
    .from('interactions')
    .select('id, contact_id, metadata, created_at')
    .eq('type', 'meeting')
    .contains('metadata', { meeting_status: 'scheduled' })
    .in('contact_id', contactIds)
  if (error) throw error
  const day = calendarDateStr(referenceIso)
  return (data || []).filter(row => calendarDateStr(row.created_at) === day)
}

// Given the one teacher the AI recognized as the voice log's subject, and the day it
// was recorded, resolves every co-attendee of that teacher's pre-scheduled meeting
// (if any) on that same day — used to pre-check the meeting-approval picker.
export async function findScheduledMeetingGroupContactIds(teacherId, referenceIso) {
  if (!teacherId) return []
  const [ownRow] = await findScheduledMeetingRows([teacherId], referenceIso)
  if (!ownRow) return []
  const groupId = ownRow.metadata?.meeting_group_id
  if (!groupId) return [teacherId]
  const { data, error } = await supabase
    .from('interactions')
    .select('contact_id')
    .contains('metadata', { meeting_group_id: groupId })
  if (error) throw error
  return [...new Set((data || []).map(r => r.contact_id))]
}

// Completes a voice-logged meeting for every selected teacher at once. If any of
// them already has a scheduled-meeting row for the same calendar day, every selected
// teacher's row converges onto that scheduled meeting's group (marking it complete);
// teachers with no scheduled row yet get a fresh row added to that same group. If
// none of them has a scheduled row at all, a brand-new group is created for exactly
// this call — the same shape AddMeetingModal itself produces for a same-day meeting.
export async function mergeOrCreateMeeting({ teacherIds, teachersById, createdAt, content, metadata }) {
  const scheduledRows = await findScheduledMeetingRows(teacherIds, createdAt)
  const rowsByContact = Object.fromEntries(scheduledRows.map(r => [r.contact_id, r]))
  const targetGroupId = scheduledRows[0]?.metadata?.meeting_group_id || crypto.randomUUID()

  for (const id of teacherIds) {
    const attendees = teacherIds.filter(o => o !== id).map(o => teachersById[o]?.name).filter(Boolean)
    const existing = rowsByContact[id]
    if (existing) {
      const {
        meeting_status: _meetingStatus,
        meeting_group_id: _meetingGroupId,
        attendees: _oldAttendees,
        ...restMetadata
      } = existing.metadata || {}
      const { error } = await supabase
        .from('interactions')
        .update({
          content: content?.trim() || null,
          metadata: { ...restMetadata, ...metadata, meeting_group_id: targetGroupId, attendees },
        })
        .eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('interactions').insert({
        contact_id: id,
        type: 'meeting',
        content: content?.trim() || null,
        created_at: createdAt,
        metadata: { ...metadata, meeting_group_id: targetGroupId, attendees },
      })
      if (error) throw error
    }
  }
}
