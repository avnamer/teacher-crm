import { supabase } from './supabase.js'
import { backendFetch } from './api.js'

// A school's pinned location, pasted as a Google Maps link on the Schools page. The
// backend turns the (short) link into coordinates; one row per school name in
// school_locations (see supabase-setup.sql). The monday-trips-sync skill uses the
// coordinates to price the drive.

// Table missing (migration not run yet) vs. a real error.
const isMissingTable = error => error?.code === '42P01' || error?.code === 'PGRST205'

export async function loadSchoolLocation(school) {
  const { data, error } = await supabase.from('school_locations').select('*').eq('school', school).maybeSingle()
  if (error) {
    if (isMissingTable(error)) throw new Error('טבלת school_locations עדיין לא קיימת — הרץ את בלוק ה-SQL האחרון מ-supabase-setup.sql')
    throw error
  }
  return data
}

export async function saveSchoolLocation(school, link) {
  const resolved = await backendFetch('/api/school-location/resolve', { method: 'POST', body: JSON.stringify({ url: link }) })
  const row = { school, maps_url: resolved.url, lat: resolved.lat, lng: resolved.lng, label: resolved.label, updated_at: new Date().toISOString() }
  const { error } = await supabase.from('school_locations').upsert(row)
  if (error) throw error
  return row
}

export async function clearSchoolLocation(school) {
  const { error } = await supabase.from('school_locations').delete().eq('school', school)
  if (error) throw error
}

/** Link that opens the pin in Google Maps. */
export const mapsPinUrl = loc => `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`
