import { supabase } from './supabase.js'

// A school's "monday day" (the school's visit to monday's office): a date plus a status. One row per
// school name in school_monday_days (see supabase-setup.sql). One-way: the monday Mentor Hub board is the
// source, scripts/sync-monday-days.mjs writes it; the app only reads (Schools page card + two read-only
// columns in the Contacts table). The table's RLS policy is select-only, so the app cannot edit it.

export const MONDAY_STATUSES = [
  { value: 'approved', label: 'אושרו' },
  { value: 'pending', label: 'טרם אושרו' },
  { value: 'problem', label: 'יש בעיה' },
  { value: 'text', label: 'טקסט חופשי' },
]

const isMissingTable = error => error?.code === '42P01' || error?.code === 'PGRST205'

function wrapError(error) {
  if (isMissingTable(error)) return new Error('טבלת school_monday_days עדיין לא קיימת — הרץ את בלוק ה-SQL האחרון מ-supabase-setup.sql')
  return error
}

export async function loadMondayDay(school) {
  const { data, error } = await supabase.from('school_monday_days').select('*').eq('school', school).maybeSingle()
  if (error) throw wrapError(error)
  return data
}

/** Every school's monday day, keyed by school name (empty if the table is missing). */
export async function loadMondayDays() {
  const { data, error } = await supabase.from('school_monday_days').select('*')
  if (error) {
    if (isMissingTable(error)) return {}
    throw error
  }
  return Object.fromEntries((data || []).map(r => [r.school, r]))
}

/** The monday-day row for a teacher: their primary school's, else the first of their schools that has one. */
export function mondayDayOf(contact, mondayDays, schoolsOf) {
  if (contact?.school && mondayDays[contact.school]) return mondayDays[contact.school]
  for (const s of schoolsOf(contact)) if (mondayDays[s]) return mondayDays[s]
  return null
}

export function formatMondayDate(row) {
  return row?.day_date ? new Date(row.day_date).toLocaleDateString('he-IL') : ''
}

/** Text for the teacher's "אישרו הגעה" column. */
export function formatArrivalStatus(row) {
  if (!row) return ''
  if (row.status === 'approved') return 'אושרו'
  if (row.status === 'pending') return 'טרם אושרו'
  if (row.status === 'problem') return row.note ? `יש בעיה: ${row.note}` : 'יש בעיה'
  return row.note || ''
}
