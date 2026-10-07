import { createClient } from '@supabase/supabase-js'
import { analyzeManagementTasks } from './claudeAnalyze.js'
import { israelDateStr, normalizeText, similarity, SIMILARITY_THRESHOLD } from './whatsappDedup.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Tasks from management WhatsApp groups ("משימות מההנהלה"). The extension sends the
// group's messages; only the task-givers' (Benny's / Mika's) are kept — everyone else
// in the group is noise and is dropped here, before any Claude call.

const israelTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
})
const israelWeekday = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'short' })

export function normName(s) {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function messageBody(m) {
  if (m.kind === 'voice') return m.transcript ? `🎤 ${m.transcript}` : ''
  if (m.kind === 'media') return [m.mediaLabel, m.text].filter(Boolean).join(' ')
  return m.text || ''
}

export function isGiver(message, givers) {
  return new Set(givers.map(normName).filter(Boolean)).has(normName(message.groupSenderName))
}

/**
 * Pure: messages worth analyzing — every message by a task-giver (exact name,
 * case/space-insensitive), plus a message by anyone else that mentions one of
 * `myNames` (a possible personal request to Avner). Everything else is noise.
 */
export function filterRelevantMessages(messages, givers, myNames = []) {
  const mine = myNames.map(normName).filter(Boolean)
  return messages.filter(m => {
    if (m.sender === 'me' || !m.messageId) return false
    const body = messageBody(m).trim()
    if (!body) return false
    return isGiver(m, givers) || mine.some(n => normName(body).includes(n))
  })
}

/** Pure: prompt lines, oldest first. */
export function formatManagementConversation(messages, givers = []) {
  return [...messages]
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map(m => {
      const at = new Date(m.timestamp)
      return `[${m.messageId}] [${israelDateStr(m.timestamp)} ${israelWeekday.format(at)} ${israelTime.format(at)}] ${m.groupSenderName}${isGiver(m, givers) ? ' (הנהלה)' : ''}: ${messageBody(m).trim()}`
    })
    .join('\n')
}

export async function loadManagementSettings() {
  const { data, error } = await supabase.from('management_settings').select('*').eq('id', 'global').maybeSingle()
  if (error) throw error
  return { taskGivers: data?.task_givers || [], myNames: data?.my_names || [], privateChats: data?.private_chats || [] }
}

/**
 * Extracts and saves tasks from a batch of a management group's messages.
 * Returns { scanned, saved }. Throws on failure — the sync itself is unaffected.
 */
export async function extractManagementTasks({ groupId, groupName, messages, extraGivers = [] }) {
  const settings = await loadManagementSettings()
  const { myNames } = settings
  const taskGivers = [...settings.taskGivers, ...extraGivers]
  if (taskGivers.length === 0) return { scanned: 0, saved: 0, reason: 'no task givers configured' }

  const mine = filterRelevantMessages(messages, taskGivers, myNames)
  if (mine.length === 0) return { scanned: 0, saved: 0 }

  // Messages already analyzed earlier (the same message re-read on a later sync).
  const ids = mine.map(m => m.messageId)
  const { data: seenRows, error: seenErr } = await supabase
    .from('management_tasks').select('message_id').in('message_id', ids)
  if (seenErr) throw seenErr
  const seen = new Set((seenRows || []).map(r => r.message_id))

  const { data: recent, error: recentErr } = await supabase
    .from('management_tasks').select('text').eq('group_id', groupId)
    .order('created_at', { ascending: false }).limit(60)
  if (recentErr) throw recentErr
  const existingTexts = (recent || []).map(r => r.text)

  const found = await analyzeManagementTasks({
    groupName, myNames,
    conversation: formatManagementConversation(mine, taskGivers),
    existingTasks: existingTexts,
    messageIds: ids,
  })

  const byId = new Map(mine.map(m => [m.messageId, m]))
  const accepted = []
  for (const t of found) {
    const key = normalizeText(t.text)
    if ([...existingTexts, ...accepted.map(a => a.text)].some(e => similarity(key, normalizeText(e)) >= SIMILARITY_THRESHOLD)) continue
    const m = byId.get(t.message_id)
    // "To all mentors" only counts from management; anyone else can only ask Avner personally.
    if (t.audience === 'all' && !isGiver(m, taskGivers)) continue
    accepted.push({
      text: t.text,
      audience: t.audience,
      sender_name: m.groupSenderName,
      group_id: groupId,
      group_name: groupName,
      message_id: t.message_id,
      message_text: messageBody(m).trim(),
      message_date: israelDateStr(m.timestamp),
      due_date: t.due_date,
    })
  }
  // A message that was already analyzed must not add tasks again (re-sync of the same text).
  const fresh = accepted.filter(a => !seen.has(a.message_id))
  if (fresh.length) {
    const { error } = await supabase.from('management_tasks').insert(fresh)
    if (error) throw error
  }
  return { scanned: mine.length, saved: fresh.length }
}

/**
 * A private chat with a task-giver. The chat's name stands in for the sender on every
 * message that isn't mine, and counts as a giver for this batch (it was listed in the
 * settings on purpose). The cursor is stored on the matching private_chats entry, and
 * only advances once Claude succeeded.
 */
export async function extractPrivateManagementTasks({ phone, name, messages }) {
  const asGiverMessages = messages.map(m => (m.sender === 'me' ? m : { ...m, groupSenderName: name }))
  const result = await extractManagementTasks({
    groupId: `dm:${phone}`, groupName: `${name} (שיחה פרטית)`, messages: asGiverMessages, extraGivers: [name],
  })
  const last = messages.length > 0 ? messages[messages.length - 1].timestamp : null
  if (last) {
    const { data, error } = await supabase.from('management_settings').select('private_chats').eq('id', 'global').maybeSingle()
    if (error) throw error
    const chats = (data?.private_chats || []).map(c => (c.phone === phone ? { ...c, last_message_at: last } : c))
    const { error: upErr } = await supabase.from('management_settings').update({ private_chats: chats }).eq('id', 'global')
    if (upErr) throw upErr
  }
  return result
}
