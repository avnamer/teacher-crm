import { supabase } from './supabase.js'
import { ensureAdminContact } from './voiceLogActions.js'

// "פגישה מנהלית" — a work trip that isn't tied to a school or a teacher (a visit to the
// offices, picking up equipment). There is no separate table: it is an ordinary
// interactions row of type 'meeting' on the hidden admin pseudo-contact (the same one
// admin tasks hang off), flagged with metadata.admin_meeting. Every other meeting query
// is scoped to the teachers' contact ids, so these rows never leak into teacher
// recency, the dashboard banners or the Schools page.
//
// metadata: { admin_meeting: true, destination, distance_km (number|null), saved_at }
// content = the purpose / description of the trip.

export function isAdminMeeting(row) {
  return row.metadata?.admin_meeting === true
}

/** 'YYYY-MM' of an ISO timestamp, in local time — the key the month filter compares. */
export function monthKey(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function parseKm(value) {
  const n = parseFloat(String(value ?? '').replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}

function buildMetadata({ destination, distanceKm }, previous = {}) {
  return {
    ...previous,
    admin_meeting: true,
    destination: destination.trim(),
    distance_km: parseKm(distanceKm),
    saved_at: new Date().toISOString(),
  }
}

export async function createAdminMeeting({ date, destination, purpose, distanceKm }) {
  const contactId = await ensureAdminContact()
  if (!contactId) throw new Error('לא נמצאה רשומת מנהל המערכת')
  const { error } = await supabase.from('interactions').insert({
    contact_id: contactId,
    type: 'meeting',
    content: purpose?.trim() || null,
    created_at: new Date(`${date}T12:00:00`).toISOString(),
    metadata: buildMetadata({ destination, distanceKm }),
  })
  if (error) throw error
}

export async function updateAdminMeeting(row, { date, destination, purpose, distanceKm }) {
  const { error } = await supabase
    .from('interactions')
    .update({
      content: purpose?.trim() || null,
      created_at: new Date(`${date}T12:00:00`).toISOString(),
      metadata: buildMetadata({ destination, distanceKm }, row.metadata),
    })
    .eq('id', row.id)
  if (error) throw error
}

export async function deleteAdminMeeting(id) {
  const { error } = await supabase.from('interactions').delete().eq('id', id)
  if (error) throw error
}
