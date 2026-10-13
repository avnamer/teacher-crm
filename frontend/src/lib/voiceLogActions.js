import { supabase } from './supabase.js'
import { backendFetch } from './api.js'

// Fixed pseudo-teacher row representing the mentor themself, used as the
// documentation target for "admin_task" voice logs — reuses the exact same
// interactions-logging mechanism as a real teacher, just with a different target.
export const ADMIN_ROW_NAME = 'מנהל המערכת'
const ADMIN_ROW_ROLE = 'מנהל מערכת'
const ADMIN_ROW_PHONE = '000-ADMIN'

import { INTERACTION_TYPES } from './interactions.js'

// The approval card's two-level menu: a category, then what exactly to save. Each option
// is a (route, communicationType) pair — `route` is what the AI classifies into
// (pending_voice_logs.route) and decides where the approved log is written;
// `communicationTypes` lists the stored types the option matches (a "WhatsApp message"
// is either a one-way 'message_sent' or a two-way 'correspondence'), the first being
// what clicking it stores.
export const CATEGORIES = [
  {
    value: 'interaction',
    label: '🧑‍🏫 אינטראקציה עם מורה',
    options: [
      { key: 'call', label: '📞 שיחה', route: 'teacher_call', communicationTypes: ['phone_call'] },
      { key: 'whatsapp', label: '💬 הודעת וואטסאפ', route: 'teacher_call', communicationTypes: ['correspondence', 'message_sent'] },
      { key: 'held_meeting', label: '🤝 תיעוד פגישה שהתקיימה', route: 'teacher_call', communicationTypes: ['meeting'] },
    ],
  },
  {
    value: 'task',
    label: '✅ הוספת משימה',
    options: [
      { key: 'mentor_task', label: '📝 משימה למנטור (לי)', route: 'admin_task' },
      { key: 'teacher_task', label: '🧑‍🏫 משימה למורה', route: 'teacher_task' },
      { key: 'management_task', label: '🏢 משימת הנהלה', route: 'management_task' },
      { key: 'all_teachers_task', label: '📋 משימה לכל המורים', route: 'new_task_column' },
    ],
  },
  {
    value: 'meetings',
    label: '🚗 פגישות ונסיעות',
    options: [
      { key: 'future_meeting', label: '📅 הוספת פגישה עתידית', route: 'future_meeting' },
      { key: 'held_meeting', label: '🤝 תיעוד תוכן פגישה', route: 'teacher_call', communicationTypes: ['meeting'] },
      { key: 'admin_trip', label: '🚗 נסיעה מנהלית', route: 'admin_trip' },
    ],
  },
]

/** The option matching a pending log's (route, communication_type), or undefined. */
export function findOption(route, communicationType) {
  for (const category of CATEGORIES) {
    for (const option of category.options) {
      if (option.route !== route) continue
      if (!option.communicationTypes || option.communicationTypes.includes(communicationType)) return { category, option }
    }
  }
  return undefined
}

/** The category of a pending log — its first matching one, or null when unclassified. */
export function categoryOf(route, communicationType) {
  return findOption(route, communicationType)?.category.value ?? null
}

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
export function calendarDateStr(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
    .eq('type', 'meeting')
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
// Returns the ids of the meeting's rows.
export async function mergeOrCreateMeeting({ teacherIds, teachersById, createdAt, content, metadata }) {
  const scheduledRows = await findScheduledMeetingRows(teacherIds, createdAt)
  const rowsByContact = Object.fromEntries(scheduledRows.map(r => [r.contact_id, r]))
  const targetGroupId = scheduledRows[0]?.metadata?.meeting_group_id || crypto.randomUUID()
  const rowIds = []

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
      rowIds.push(existing.id)
    } else {
      const { data: inserted, error } = await supabase.from('interactions').insert({
        contact_id: id,
        type: 'meeting',
        content: content?.trim() || null,
        created_at: createdAt,
        metadata: { ...metadata, meeting_group_id: targetGroupId, attendees },
      }).select('id').single()
      if (error) throw error
      rowIds.push(inserted.id)
    }
  }
  return rowIds
}

// ─── Future meeting ────────────────────────────────────────────────────────

// Schedules a meeting that hasn't happened yet: one 'scheduled' row per attendee, tied
// together by a shared meeting_group_id — the same shape AddMeetingModal writes for a
// future date, so the Meetings page and the dashboard pick it up unchanged.
export async function createScheduledMeeting({ teacherIds, teachersById, date, content }) {
  const createdAt = new Date(`${date}T12:00:00`).toISOString()
  const groupId = crypto.randomUUID()
  const rows = teacherIds.map(id => ({
    contact_id: id,
    type: 'meeting',
    content: content?.trim() || null,
    created_at: createdAt,
    metadata: {
      attendees: teacherIds.filter(o => o !== id).map(o => teachersById[o]?.name).filter(Boolean),
      meeting_group_id: groupId,
      saved_at: new Date().toISOString(),
      meeting_status: 'scheduled',
      source: 'voice_pwa',
    },
  }))
  const { error } = await supabase.from('interactions').insert(rows)
  if (error) throw error
}

// ─── Task for a teacher ────────────────────────────────────────────────────

// A task that the teacher has to do, said by voice without a call to document. It is a
// 'journal' row on the teacher (the type the table already has for notes that aren't a
// call/message/meeting — so it neither resets the teacher's "last contact" nor shows as
// one), carrying the tasks as action_items with assignee 'teacher'; the teacher's page
// and the dashboard's open-tasks banner list them like any other follow-up.
export async function saveTeacherTask({ contactId, items, content, metadata, createdAt }) {
  await saveInteractionRow({
    contactId,
    type: 'journal',
    content,
    metadata: {
      ...metadata,
      action_items: items.map(i => ({ text: i.text, due_date: i.due_date || null, done: false, assignee: 'teacher' })),
    },
    createdAt,
  })
}

// Future meetings a recording agreed on, to offer as "also schedule". The AI lists them
// (extra.future_meetings); for recordings analysed before it did, fall back to follow-up
// items that are about meeting and carry a date.
export function suggestFutureMeetings(extra, actionItems, refIso) {
  const fromAi = (extra?.future_meetings || []).filter(m => m?.date)
  const raw = fromAi.length > 0
    ? fromAi
    : (actionItems || [])
        .filter(a => a.due_date && /להיפגש|לפגוש|פגישה|להיפגש/.test(a.text || ''))
        .map(a => ({ date: a.due_date, topic: a.text }))
  return raw.map(m => ({ date: fixStaleYear(m.date, refIso), topic: m.topic || '' }))
}

// ─── Stale years in spoken dates ───────────────────────────────────────────

// "ב-1 באפריל" carries no year, and the AI sometimes picks an old one. A follow-up date
// more than 60 days before the recording is almost certainly that mistake, so move it to
// its next occurrence on/after the recording. refIso: the recording's created_at.
export function fixStaleYear(date, refIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return date
  const ref = new Date(refIso)
  const cutoff = new Date(ref.getTime() - 60 * 86400000)
  let d = new Date(`${date}T12:00:00`)
  if (d >= cutoff) return date
  while (d < cutoff) d = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate(), 12)
  return calendarDateStr(d.toISOString())
}
