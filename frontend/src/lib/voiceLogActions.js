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

// Mirrors INTERACTION_TYPES in ContactDetail.jsx — kept in sync manually since the two
// pages don't share a module today.
export const COMMUNICATION_TYPES = [
  { value: 'phone_call', label: 'שיחת טלפון', icon: '📞' },
  { value: 'message_sent', label: 'הודעה', icon: '😞' },
  { value: 'correspondence', label: 'התכתבות', icon: '📜' },
  { value: 'meeting', label: 'פגישה', icon: '🤝' },
]

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
