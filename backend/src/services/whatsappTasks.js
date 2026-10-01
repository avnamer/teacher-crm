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
