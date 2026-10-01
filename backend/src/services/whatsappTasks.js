import { createClient } from '@supabase/supabase-js'
import { analyzeWhatsAppTasks } from './claudeAnalyze.js'
import { israelDateStr, normalizeText, similarity, SIMILARITY_THRESHOLD } from './whatsappDedup.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Files the tasks Claude finds in newly synced WhatsApp DM messages (spec
// 2026-10-01-whatsapp-task-extraction): a teacher's task goes into
// metadata.action_items of that teacher's WhatsApp day row; Avner's task becomes
// its own row on the admin pseudo-contact, so "המשימות שלי" shows it.

const israelTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
})

// "יום ה׳" / "שבת" — lets Claude resolve "ביום שלישי" without computing weekdays from a bare date.
const israelWeekday = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'short' })

function messageBody(m) {
  if (m.kind === 'voice') return m.transcript ? `🎤 ${m.transcript}` : ''
  if (m.kind === 'media') return [m.mediaLabel, m.text].filter(Boolean).join(' ')
  return m.text || ''
}

/** Pure: prompt lines "[YYYY-MM-DD <weekday> HH:MM] name: text", oldest first, empty messages dropped. */
export function formatMessagesForPrompt(messages, teacherName) {
  const lines = []
  const dates = new Set()
  for (const m of [...messages].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))) {
    const body = messageBody(m).trim()
    if (!body) continue
    const day = israelDateStr(m.timestamp)
    dates.add(day)
    const who = m.sender === 'me' ? 'אבנר' : teacherName
    const at = new Date(m.timestamp)
    lines.push(`[${day} ${israelWeekday.format(at)} ${israelTime.format(at)}] ${who}: ${body}`)
  }
  return { conversation: lines.join('\n'), messageDates: [...dates] }
}

/** Pure: is `task` ≥ SIMILARITY_THRESHOLD similar to an existing task with the same assignee? */
export function isDuplicateTask(task, existingTasks) {
  const key = normalizeText(task.text)
  return existingTasks.some(e =>
    e.assignee === task.assignee && similarity(key, normalizeText(e.text)) >= SIMILARITY_THRESHOLD
  )
}

// The DM day row(s) for `day` (Israel date) — same window + re-check as whatsappMerge.js.
async function findDmDayRow(contactId, day) {
  const dayStartUtc = new Date(`${day}T00:00:00Z`).getTime()
  const { data, error } = await supabase
    .from('interactions')
    .select('id, metadata, created_at')
    .eq('contact_id', contactId)
    .eq('type', 'whatsapp')
    .gte('created_at', new Date(dayStartUtc - 24 * 3600 * 1000).toISOString())
    .lte('created_at', new Date(dayStartUtc + 48 * 3600 * 1000).toISOString())
  if (error) throw error
  return (data || []).find(r => israelDateStr(r.created_at) === day && r.metadata?.source !== 'group') || null
}

async function findAdminContactId() {
  const { data, error } = await supabase
    .from('contacts').select('id').contains('custom_fields', { is_admin_row: true }).maybeSingle()
  if (error) throw error
  return data?.id || null
}

// Existing WhatsApp-sourced tasks for this teacher, both assignees — fed to Claude
// ("don't return these") and to isDuplicateTask.
async function loadExistingTasks(contactId, adminId) {
  const { data: teacherRows, error: tErr } = await supabase
    .from('interactions').select('action_items:metadata->action_items') // just the tasks, not every message
    .eq('contact_id', contactId).eq('type', 'whatsapp')
  if (tErr) throw tErr
  const teacherTasks = (teacherRows || [])
    .flatMap(r => r.action_items || [])
    .filter(i => i.source === 'whatsapp')
    .map(i => ({ assignee: 'teacher', text: i.text, done: !!i.done }))

  let adminTasks = []
  if (adminId) {
    const { data: adminRows, error: aErr } = await supabase
      .from('interactions').select('action_items:metadata->action_items')
      .eq('contact_id', adminId)
      .contains('metadata', { source: 'whatsapp', whatsapp_contact_id: contactId })
    if (aErr) throw aErr
    adminTasks = (adminRows || [])
      .flatMap(r => r.action_items || [])
      .map(i => ({ assignee: 'admin', text: i.text, done: !!i.done }))
  }
  return [...teacherTasks, ...adminTasks]
}

function actionItem(task) {
  return { text: task.text, due_date: task.due_date, done: task.done, source: 'whatsapp', message_date: task.message_date }
}

/**
 * Runs after POST /messages has responded (DM batches only). `savedMessages` are
 * the messages mergeWhatsAppMessages actually inserted. Throws on failure — the
 * caller logs it; the sync itself has already succeeded.
 */
export async function extractAndSaveWhatsAppTasks({ contactId, savedMessages }) {
  const { data: contact, error: cErr } = await supabase.from('contacts').select('name').eq('id', contactId).single()
  if (cErr) throw cErr
  const { conversation, messageDates } = formatMessagesForPrompt(savedMessages, contact.name)
  if (!conversation) return { teacherTasks: 0, adminTasks: 0 }

  const adminId = await findAdminContactId()
  const existingTasks = await loadExistingTasks(contactId, adminId)
  const found = await analyzeWhatsAppTasks({ teacherName: contact.name, conversation, existingTasks, messageDates })

  const accepted = []
  for (const task of found) {
    if (isDuplicateTask(task, [...existingTasks, ...accepted])) continue
    accepted.push(task)
  }

  let teacherTasks = 0
  let adminTasks = 0
  const now = new Date().toISOString()

  // Teacher tasks: append to that day's DM row (read fresh, keep everything else).
  // Also stamp tasks_analyzed_at on every day this batch touched.
  for (const day of messageDates) {
    const row = await findDmDayRow(contactId, day)
    if (!row) continue
    const newItems = accepted.filter(t => t.assignee === 'teacher' && t.message_date === day).map(actionItem)
    const { error } = await supabase
      .from('interactions')
      .update({
        metadata: {
          ...row.metadata,
          action_items: [...(row.metadata?.action_items || []), ...newItems],
          tasks_analyzed_at: now,
        },
      })
      .eq('id', row.id)
    if (error) throw error
    teacherTasks += newItems.length
  }

  // Admin tasks: one row each on the admin pseudo-contact.
  const forAdmin = accepted.filter(t => t.assignee === 'admin')
  if (forAdmin.length && !adminId) {
    console.warn('[whatsapp-sync/tasks] no is_admin_row contact — skipped', forAdmin.length, 'admin task(s)')
  } else {
    for (const task of forAdmin) {
      const { error } = await supabase.from('interactions').insert({
        contact_id: adminId,
        type: 'journal',
        // Noon-ish Israel time on the message's day (10:00Z = 12:00/13:00 Israel), so
        // the row — and "המשימות שלי" — show the conversation's date, not the sync's.
        created_at: `${task.message_date}T10:00:00.000Z`,
        content: `משימה מהתכתבות וואטסאפ עם ${contact.name}`,
        metadata: {
          source: 'whatsapp',
          whatsapp_contact_id: contactId,
          whatsapp_contact_name: contact.name,
          message_date: task.message_date,
          action_items: [actionItem(task)],
        },
      })
      if (error) throw error
      adminTasks++
    }
  }

  return { teacherTasks, adminTasks }
}
