import { supabase } from './supabase.js'
import { backendFetch } from './api.js'
import { isAdminRow } from './teachers.js'
import { isCompletedMeeting } from './meetings.js'
import { teacherSchools, teachesOtherSchool } from './teams.js'

// Everything the Schools page (pages/Schools.jsx) derives from existing data. The page
// only reads: teachers and their teams from `contacts`, tasks and history from
// `interactions`. The only writes are closing a task (same fields every other task
// checkbox writes) and caching a generated short summary on the history record.

// ─── Teachers and school names ──────────────────────────────────────────────

/** Teachers linked to the school — by primary school or by one of their teams. */
export function schoolTeachers(contacts, school) {
  return contacts
    .filter(c => !isAdminRow(c) && teacherSchools(c).includes(school))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'))
}

function normalize(text) {
  return String(text || '').replace(/[״"׳'`]/g, '').replace(/\s+/g, ' ').trim()
}

// "בית ספר אבן אל הייתם" / "בי"ס אבן אל הייתם" / "אבן אל-הייתם" all reduce to the same core.
function schoolCore(name) {
  return normalize(name).replace(/-/g, ' ').replace(/^(בית הספר|בית ספר|ביה?ס)\s+/, '').trim()
}

/**
 * School names that look like the same school written differently — a school spelled
 * two ways shows up twice in the picker, and its teachers are split between the two.
 */
export function similarSchoolNames(schools) {
  const byCore = {}
  for (const s of schools) (byCore[schoolCore(s)] ??= []).push(s)
  return Object.values(byCore).filter(names => names.length > 1)
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whole-word mention, allowing the one-letter Hebrew prefixes ("לרינה", "ברינה", "ושרה"). */
function mentionsWord(text, word) {
  const w = normalize(word)
  if (w.length < 2) return false
  return new RegExp(`(^|[^\\u0590-\\u05FF])[ולבהמש]?${escapeRegExp(w)}($|[^\\u0590-\\u05FF])`).test(normalize(text))
}

function mentionsSchool(text, school) {
  const core = schoolCore(school)
  return core.length >= 3 && normalize(text).replace(/-/g, ' ').includes(core)
}

// ─── Section B: main (dashboard) tasks ──────────────────────────────────────
// Lives in the page itself — it's just isTaskDone over lib/teachers.js task columns.

// ─── Section C: small open tasks ────────────────────────────────────────────

export const TASK_SOURCE = {
  whatsapp: { label: 'וואטסאפ', icon: '💬' },
  recording: { label: 'הקלטה', icon: '🎙' },
  manual: { label: 'ידני', icon: '✍️' },
}

// 'admin' / 'both' action items are Avner's; they're listed with the admin's tasks
// (lib/adminTasks.js already gathers them), so the teacher list leaves them out.
const ADMIN_ASSIGNEES = new Set(['admin', 'both'])

function teacherTaskSource(row, item) {
  if (item.source === 'whatsapp' || row.type === 'whatsapp') return 'whatsapp'
  if (row.metadata?.source === 'voice_pwa') return 'recording'
  return 'manual'
}

/**
 * Open action items on the school's teachers' own records. A meeting has one row per
 * attendee, each with its own copy of the action items — copies are listed once and
 * closed together.
 */
export function openTeacherTasks(rows) {
  const tasks = new Map()
  for (const row of rows) {
    const items = row.metadata?.action_items
    if (!Array.isArray(items)) continue
    items.forEach((item, index) => {
      if (!item || item.done || ADMIN_ASSIGNEES.has(item.assignee) || !item.text?.trim()) return
      const groupId = row.type === 'meeting' && row.metadata?.meeting_group_id
      const key = groupId ? `g:${groupId}:${item.text}` : `r:${row.id}:${index}`
      if (!tasks.has(key)) {
        tasks.set(key, {
          key,
          text: item.text,
          created_at: item.message_date || row.created_at,
          due_date: item.due_date || null,
          source: teacherTaskSource(row, item),
          copies: [],
          teacherIds: [],
        })
      }
      const task = tasks.get(key)
      task.copies.push({ rowId: row.id, index, text: item.text })
      if (!task.teacherIds.includes(row.contact_id)) task.teacherIds.push(row.contact_id)
    })
  }
  return [...tasks.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

/** Marks every copy done. Reads each row fresh — a WhatsApp sync may have changed it since the page loaded. */
export async function closeTeacherTask(task) {
  let updated = 0
  for (const copy of task.copies) {
    const { data: row, error: loadErr } = await supabase
      .from('interactions').select('id, metadata').eq('id', copy.rowId).maybeSingle()
    if (loadErr) throw loadErr
    if (!row) continue
    const items = [...(row.metadata?.action_items || [])]
    const i = items[copy.index]?.text === copy.text
      ? copy.index
      : items.findIndex(item => item.text === copy.text && !item.done)
    if (i < 0) continue
    items[i] = { ...items[i], done: true, done_at: new Date().toISOString() }
    const { error } = await supabase
      .from('interactions').update({ metadata: { ...row.metadata, action_items: items } }).eq('id', row.id)
    if (error) throw error
    updated++
  }
  if (updated === 0) throw new Error('המשימה לא נמצאה — רענן את העמוד')
}

function adminTaskSource(task) {
  if (task.kind === 'teacher') {
    if (task.row_source === 'voice_pwa') return 'recording'
    return task.interaction_type === 'whatsapp' ? 'whatsapp' : 'manual'
  }
  if (task.source === 'whatsapp') return 'whatsapp'
  if (task.source === 'voice_pwa' || task.source === 'voice_task') return 'recording'
  return 'manual'
}

/**
 * The admin's open tasks (lib/adminTasks.js fetchAdminTasks) that concern this school.
 *
 * Admin tasks have no school field. Most are already tied to a teacher — a task from a
 * call or meeting sits on the teacher's own record, and a task from a WhatsApp chat
 * keeps the teacher it came from — so those follow that teacher's school. Only tasks
 * dictated straight to the admin ("משימה לעצמי") or typed into "המשימות שלי" carry no
 * link; they're matched by the school's name, or a teacher's name, in the task text.
 * A first name alone only counts if no other teacher shares it.
 *
 * Returns [{ task, teacherNames, matchedBy: 'link' | 'text', source }].
 */
export function adminTasksForSchool(tasks, { school, teachers, allTeachers }) {
  const teacherById = Object.fromEntries(teachers.map(t => [t.id, t]))
  const firstNameCount = {}
  for (const t of allTeachers) {
    const first = normalize(t.name).split(' ')[0]
    if (first) firstNameCount[first] = (firstNameCount[first] || 0) + 1
  }
  const namedIn = text => teachers.filter(t => {
    const full = normalize(t.name)
    const first = full.split(' ')[0]
    return (full && mentionsWord(text, full)) || (first && firstNameCount[first] === 1 && mentionsWord(text, first))
  })

  const result = []
  for (const task of tasks) {
    if (task.done) continue
    const source = adminTaskSource(task)
    if (task.kind === 'teacher') {
      const linked = (task.teachers || []).filter(t => teacherById[t.id])
      if (linked.length) result.push({ task, teacherNames: linked.map(t => t.name), matchedBy: 'link', source })
      continue
    }
    if (task.whatsapp_contact_id) {
      const t = teacherById[task.whatsapp_contact_id]
      if (t) result.push({ task, teacherNames: [t.name], matchedBy: 'link', source })
      continue
    }
    if (task.whatsapp_contact_name) {
      const t = teachers.find(x => normalize(x.name) === normalize(task.whatsapp_contact_name))
      if (t) result.push({ task, teacherNames: [t.name], matchedBy: 'link', source })
      continue
    }
    const named = namedIn(task.text)
    if (named.length || mentionsSchool(task.text, school)) {
      result.push({ task, teacherNames: named.map(t => t.name), matchedBy: 'text', source })
    }
  }
  return result.sort((a, b) => new Date(b.task.created_at) - new Date(a.task.created_at))
}

// ─── Section D: meeting history ─────────────────────────────────────────────
// A "meeting" here is any real conversation with the teacher: a held meeting
// (scheduled / not-held ones are left out), a phone call, a two-way correspondence,
// and a day of the teacher's private WhatsApp chat — the sync already stores one row
// per teacher per day, so a WhatsApp day is one entry, never one per message. Voice
// recordings are saved as one of these types, so they're included too. Left out: one-way
// sends (a message or mailing nobody answered), dashboard journal notes, and WhatsApp
// group chats (shared by teachers of several schools, and stored once per member).

const HISTORY_TYPES = new Set(['meeting', 'phone_call', 'correspondence', 'whatsapp'])

export function isHistoryRecord(row) {
  if (!HISTORY_TYPES.has(row.type)) return false
  if (row.type === 'meeting') return isCompletedMeeting(row)
  if (row.type === 'whatsapp') return row.metadata?.source !== 'group' && row.metadata?.messages?.length > 0
  return true
}

/** Every interaction of the given teachers, newest first (paged past the 1000-row API limit). */
export async function loadInteractions(contactIds) {
  if (contactIds.length === 0) return []
  const PAGE = 1000
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('interactions')
      .select('id, contact_id, type, content, metadata, created_at')
      .in('contact_id', contactIds)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < PAGE) return all
  }
}

function whatsAppText(metadata) {
  return (metadata?.messages || []).map(m => {
    const who = m.sender === 'me' ? 'אבנר' : 'המורה'
    const text = m.kind === 'voice' ? `🎤 ${m.transcript || m.summary || 'הודעה קולית'}` : (m.text || m.mediaLabel || '')
    return `${who}: ${text}`
  }).join('\n')
}

/** The record's full text — what the summary is made from. */
export function historyText(item) {
  const [first] = item.rows
  if (first.type === 'whatsapp') return whatsAppText(first.metadata)
  return item.rows.map(r => r.content?.trim()).find(Boolean) || ''
}

// Cheap content fingerprint: a cached summary is reused only while the text it was made
// from is unchanged (a WhatsApp day keeps growing during the day; a meeting can be edited).
export function fingerprint(text) {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return `${text.length}:${h.toString(36)}`
}

// A record this short reads fine in full; summarizing it would only paraphrase it.
const SHORT_TEXT_WORDS = 45

/**
 * The summary to show without calling the AI: the analysis summary saved with the
 * record, a summary this page generated before for the same text, or — for a short
 * record — the text itself. null = needs generating.
 */
export function storedSummary(item) {
  const text = historyText(item)
  for (const row of item.rows) {
    if (row.type !== 'whatsapp' && row.metadata?.summary?.trim()) return row.metadata.summary.trim()
  }
  const fp = fingerprint(text)
  for (const row of item.rows) {
    if (row.metadata?.history_summary && row.metadata.history_summary_of === fp) return row.metadata.history_summary
  }
  if (text.split(/\s+/).filter(Boolean).length <= SHORT_TEXT_WORDS) return text
  return null
}

/** Generates the short summary and stores it on every row of the record, so it's made once. */
export async function generateHistorySummary(item) {
  const text = historyText(item)
  const { summary } = await backendFetch('/api/meetings/short-summary', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
  const fp = fingerprint(text)
  for (const row of item.rows) {
    // Fresh read + merge of just these two keys — the sync may have added messages since.
    const { data: fresh, error: loadErr } = await supabase
      .from('interactions').select('metadata').eq('id', row.id).maybeSingle()
    if (loadErr || !fresh) { console.error('[history summary] load', loadErr); continue }
    const { error } = await supabase
      .from('interactions')
      .update({ metadata: { ...(fresh.metadata || {}), history_summary: summary, history_summary_of: fp } })
      .eq('id', row.id)
    if (error) console.error('[history summary] save', error)
  }
  return summary
}

/**
 * Which schools a record of a teacher who teaches in several schools belongs to, or
 * null if it can't be told. Evidence, in order: the other people at the meeting (their
 * schools), then a school's name in the text.
 */
function evidenceSchools(item, involved, contactsByName) {
  const candidates = new Set(involved.flatMap(teacherSchools))
  const evidence = new Set()
  for (const row of item.rows) {
    for (const name of row.metadata?.attendees || []) {
      for (const s of teacherSchools(contactsByName[name])) if (candidates.has(s)) evidence.add(s)
    }
  }
  if (evidence.size === 0) {
    const text = historyText(item)
    for (const s of candidates) if (mentionsSchool(text, s)) evidence.add(s)
  }
  return evidence.size ? evidence : null
}

/**
 * The school's history: one entry per real-world event (a meeting's per-attendee rows
 * grouped by meeting_group_id), newest first. A record whose only teachers here teach
 * in several schools is shown only in the school it can be tied to (see
 * evidenceSchools), and in all of their schools when it can't be.
 */
export function buildHistory(rows, { school, contactsById, contactsByName }) {
  const items = new Map()
  for (const row of rows) {
    if (!isHistoryRecord(row)) continue
    const key = (row.type === 'meeting' && row.metadata?.meeting_group_id) || row.id
    if (!items.has(key)) items.set(key, { key, type: row.type, date: row.created_at, rows: [], teacherIds: [] })
    const item = items.get(key)
    item.rows.push(row)
    if (!item.teacherIds.includes(row.contact_id)) item.teacherIds.push(row.contact_id)
  }

  return [...items.values()]
    .filter(item => {
      const involved = item.teacherIds.map(id => contactsById[id]).filter(Boolean)
      if (involved.some(c => !teachesOtherSchool(c))) return true
      const evidence = evidenceSchools(item, involved, contactsByName)
      return !evidence || evidence.has(school)
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
}
