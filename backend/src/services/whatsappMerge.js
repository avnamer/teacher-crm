import { createClient } from '@supabase/supabase-js'
import { israelDateStr, isDuplicate } from './whatsappDedup.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

function previewLine(messages) {
  const last = messages[messages.length - 1]
  if (!last) return ''
  const who = last.sender === 'me' ? 'אני' : 'המורה'
  const text = last.kind === 'voice'
    ? (last.summary || last.transcript || '🎤 הודעה קולית')
    : (last.text || last.mediaLabel || '')
  return `${who}: ${text}`.slice(0, 200)
}

function sourceKeyOf(metadata) {
  return metadata?.source === 'group' ? `group:${metadata.group_id}` : 'dm'
}

// Confirmed live (2026-10-01): a WhatsApp message sent FROM the CRM is already
// logged at send time as its own message_sent / mailing_list row — the sync
// then read the very same message back out of the chat and logged it a second
// time inside the day's whatsapp row. Returns those CRM-sent texts as
// pseudo-messages keyed by Israel day, so isDuplicate's text-similarity check
// can match them. Only channel 'whatsapp' (or older rows with no channel
// recorded) — an email send of the same text is a different message.
async function crmSentMessagesByDay(contactId, messages) {
  const times = messages.map(m => new Date(m.timestamp).getTime())
  const { data, error } = await supabase
    .from('interactions')
    .select('content, created_at, metadata')
    .eq('contact_id', contactId)
    .in('type', ['message_sent', 'mailing_list'])
    .gte('created_at', new Date(Math.min(...times) - 24 * 3600 * 1000).toISOString())
    .lte('created_at', new Date(Math.max(...times) + 24 * 3600 * 1000).toISOString())
  if (error) throw error

  const byDay = new Map()
  for (const row of data || []) {
    const channel = row.metadata?.channel
    if (channel && channel !== 'whatsapp') continue
    if (!row.content) continue
    const day = israelDateStr(row.created_at)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push({ sender: 'me', kind: 'text', text: row.content })
  }
  return byDay
}

/**
 * Merges a batch of newly-read WhatsApp messages for one contact into that
 * day's interactions row(s), applying spec §3.2/§3.3: one row per contact per
 * calendar day *per source* (a DM row and a group row on the same day stay
 * separate, tagged by source — see the acceptance test in spec §5), duplicates
 * skipped per §3.3, only the earliest kept.
 *
 * `source` is 'dm' or 'group'; group batches also carry groupId/groupName.
 * Returns how many messages were actually saved vs skipped as duplicates, so
 * the route can roll the skip count into whatsapp_sync_state.
 * `savedMessages` = the messages actually inserted, plus voice messages whose
 * transcript was completed on this sync (not duplicates) — used to trigger task extraction.
 */
export async function mergeWhatsAppMessages({ contactId, source, groupId, groupName, messages }) {
  if (!messages?.length) return { saved: 0, duplicatesSkipped: 0, savedMessages: [] }

  const byDay = new Map()
  for (const m of messages) {
    const day = israelDateStr(m.timestamp)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(m)
  }

  let saved = 0
  let duplicatesSkipped = 0
  const savedMessages = []
  const sourceKey = source === 'group' ? `group:${groupId}` : 'dm'
  // CRM sends only ever go to the teacher's own DM, never into a group.
  const crmSentByDay = source === 'dm' ? await crmSentMessagesByDay(contactId, messages) : new Map()

  for (const [day, dayMessages] of byDay) {
    const dayStartUtc = new Date(`${day}T00:00:00Z`).getTime()
    // A 24h/48h UTC pad around midnight comfortably covers Israel's +2/+3 offset
    // either direction; the exact match is re-checked in JS just below.
    const { data: candidateRows, error: fetchErr } = await supabase
      .from('interactions')
      .select('id, metadata, created_at')
      .eq('contact_id', contactId)
      .eq('type', 'whatsapp')
      .gte('created_at', new Date(dayStartUtc - 24 * 3600 * 1000).toISOString())
      .lte('created_at', new Date(dayStartUtc + 48 * 3600 * 1000).toISOString())
    if (fetchErr) throw fetchErr

    const rowsForDay = (candidateRows || []).filter(r => israelDateStr(r.created_at) === day)
    const allExistingMessages = rowsForDay.flatMap(r => r.metadata?.messages || [])
    const targetRow = rowsForDay.find(r => sourceKeyOf(r.metadata) === sourceKey)

    const acceptedNow = []
    const replacements = []
    for (const m of dayMessages) {
      const existingMatch = allExistingMessages.find(e => e.messageId === m.messageId)
      if (existingMatch) {
        // A voice message whose earlier transcription attempt didn't reach
        // 'done' (still pending, or failed and cleared for retry) must be
        // REPLACED by a fresh resolve, not silently skipped as a duplicate —
        // otherwise a bad transcript (e.g. Whisper hallucinating text for
        // near-silent audio, confirmed live 2026-09-29) could never be
        // corrected by a later, fixed sync. A message already 'done' is left
        // alone (the normal messageId-dedup path, just inlined here since we
        // already found the match).
        if (m.kind === 'voice' && existingMatch.transcriptionStatus !== 'done') {
          replacements.push(m)
        }
        continue
      }
      if (isDuplicate(m, [...allExistingMessages, ...(crmSentByDay.get(day) || []), ...acceptedNow])) {
        duplicatesSkipped++
        continue
      }
      acceptedNow.push(m)
    }
    if (acceptedNow.length === 0 && replacements.length === 0) continue

    if (targetRow) {
      let merged = [...(targetRow.metadata.messages || []), ...acceptedNow]
      for (const r of replacements) {
        merged = merged.map(existing => (existing.messageId === r.messageId ? r : existing))
      }
      merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      const { error } = await supabase
        .from('interactions')
        .update({ content: previewLine(merged), metadata: { ...targetRow.metadata, messages: merged } })
        .eq('id', targetRow.id)
      if (error) throw error
    } else {
      const sorted = [...acceptedNow].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      const { error } = await supabase.from('interactions').insert({
        contact_id: contactId,
        type: 'whatsapp',
        content: previewLine(sorted),
        created_at: sorted[0].timestamp,
        metadata: {
          source,
          group_id: source === 'group' ? groupId : null,
          group_name: source === 'group' ? groupName : null,
          messages: sorted,
        },
      })
      if (error) throw error
    }
    saved += acceptedNow.length
    savedMessages.push(...acceptedNow)
    // A voice message whose transcript only arrived on this retry is new text too —
    // without this, a task said in it would never be extracted.
    savedMessages.push(...replacements.filter(r => r.transcriptionStatus === 'done'))
  }

  return { saved, duplicatesSkipped, savedMessages }
}

/**
 * Voice messages still needing a transcription retry (spec §3.2: "אחרי 3
 * ניסיונות כושלים מפסיקים לנסות"), scoped to the last 35 days (the sync's own
 * 30-day backfill window plus slack) so this stays a bounded scan rather than
 * reading the whole table. Returns one entry per still-pending message with
 * enough context for the extension to find it again in the DOM.
 */
export async function findRetryCandidates() {
  const since = new Date(Date.now() - 35 * 24 * 3600 * 1000).toISOString()
  const { data, error } = await supabase
    .from('interactions')
    .select('contact_id, metadata')
    .eq('type', 'whatsapp')
    .gte('created_at', since)
  if (error) throw error

  const candidates = []
  for (const row of data || []) {
    const meta = row.metadata || {}
    for (const m of meta.messages || []) {
      if (m.kind !== 'voice') continue
      if (m.transcriptionStatus === 'done') continue
      if ((m.transcriptionRetries || 0) >= 3) continue
      candidates.push({
        contactId: row.contact_id,
        messageId: m.messageId,
        source: meta.source,
        groupId: meta.group_id || null,
        retries: m.transcriptionRetries || 0,
      })
    }
  }
  return candidates
}
