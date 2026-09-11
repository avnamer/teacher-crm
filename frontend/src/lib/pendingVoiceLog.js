import { supabase } from './supabase.js'

export async function insertPendingVoiceLog(row) {
  const { error } = await supabase.from('pending_voice_logs').insert(row)
  if (error) throw error
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
