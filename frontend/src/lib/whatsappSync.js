// Shared helpers for the WhatsApp sync status banner and groups page.
//
// Everything here reads/writes Supabase directly (whatsapp_sync_state,
// whatsapp_groups, whatsapp_sync_requests) — same as every other page in this
// app (e.g. Settings.jsx reading `settings`). Only the Chrome extension talks to
// the backend for this feature, because it has no Supabase session to write
// with; the CRM frontend already does, via the owner's own RLS-gated login.

const DAY_MS = 24 * 3600 * 1000
const HEARTBEAT_STALE_MS = 5 * 60 * 1000

/** Spec §3.4: green if a sync succeeded within the last 24h, red otherwise. */
export function isSuccessFresh(lastSuccessAt) {
  return !!lastSuccessAt && Date.now() - new Date(lastSuccessAt).getTime() < DAY_MS
}

/** Spec §3.4: "התוסף לא מחובר כרגע" if no heartbeat in the last 5 minutes. */
export function isExtensionConnected(heartbeatAt) {
  return !!heartbeatAt && Date.now() - new Date(heartbeatAt).getTime() < HEARTBEAT_STALE_MS
}

/** "היום, 08:02" for a sync that ran today, otherwise "לפני 3 ימים" (spec §3.4). */
export function relativeTimeLabel(iso) {
  if (!iso) return null
  const date = new Date(iso)
  const days = Math.floor((Date.now() - date.getTime()) / DAY_MS)
  const time = date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  if (days <= 0) return `היום, ${time}`
  if (days === 1) return 'אתמול'
  return `לפני ${days} ימים`
}

/** Creates a manual sync request row the extension's poll loop picks up (spec §3.4). */
export async function requestManualSync(supabase) {
  const { error } = await supabase.from('whatsapp_sync_requests').insert({ source: 'manual' })
  if (error) throw error
}
