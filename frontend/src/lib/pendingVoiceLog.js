import { supabase } from './supabase.js'

// row.extra ({ meeting_date, destination, distance_km }) needs the `extra` JSONB column
// (see supabase-setup.sql). If the migration hasn't been run yet, save the log without
// it rather than lose the recording — those fields only prefill the approval card.
export async function insertPendingVoiceLog(row) {
  const { error } = await supabase.from('pending_voice_logs').insert(row)
  if (!error) return
  if (row.extra !== undefined && /extra/.test(error.message || '')) {
    const { extra: _extra, ...withoutExtra } = row
    const retry = await supabase.from('pending_voice_logs').insert(withoutExtra)
    if (retry.error) throw retry.error
    return
  }
  throw error
}

export async function fetchPendingVoiceLogs(mentorName) {
  const { data, error } = await supabase
    .from('pending_voice_logs')
    .select('*')
    .eq('mentor_name', mentorName)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function deletePendingVoiceLog(id) {
  const { error } = await supabase.from('pending_voice_logs').delete().eq('id', id)
  if (error) throw error
}
