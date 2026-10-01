import { supabase } from './supabase.js'
import { ensureAdminContact } from './voiceLogActions.js'

// Personal tasks of the system admin ("מנהל המערכת").
//
// There is no separate table: an approved "משימה אישית לי" voice log is an ordinary
// interactions row on the hidden admin pseudo-contact (see ensureAdminContact), and each
// entry in its metadata.action_items is one task — the same { text, due_date, done }
// shape ContactDetail already toggles for teachers. A recording the AI found no action
// items in is shown as a single task made of its summary; the first edit writes that
// task into action_items so from then on every row is handled the same way.
//
// Recurring tasks (monthly, on a fixed day of the month) carry
// recurrence: { type: 'monthly', day: 1-31 } on the item. Marking one done keeps it as
// a done record and creates the next occurrence as a new row with the next due date —
// so the done list doubles as a history of when each month's instance was done.

/** 'YYYY-MM-DD' of the next monthly occurrence after `due`, on `day` (clamped to the month's length). */
export function nextMonthlyDue(due, day) {
  const [y, m] = due.split('-').map(Number) // m is 1-based
  const nextY = m === 12 ? y + 1 : y
  const nextM = m === 12 ? 1 : m + 1
  const lastDay = new Date(nextY, nextM, 0).getDate()
  const d = Math.min(day, lastDay)
  return `${nextY}-${String(nextM).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function normalizeRecurrence(recurrence, due_date) {
  if (recurrence?.type !== 'monthly' || !due_date) return null
  return { type: 'monthly', day: Number(due_date.slice(8, 10)) }
}

// Rows typed in this panel (or spawned by a recurring task) hold nothing but their task,
// so removing the last task can delete the row. Anything else — a recorded voice log —
// keeps its content and summary; only its tasks are cleared.
const PANEL_ONLY_SOURCES = new Set(['admin_panel', 'recurring'])

function itemsOf(row) {
  if (row.metadata?.tasks_cleared) return []
  const items = row.metadata?.action_items
  if (Array.isArray(items) && items.length > 0) return items
  const text = (row.content || '').trim()
  return text ? [{ text, due_date: null, done: false }] : []
}

/** Flat list of tasks, one per action item, each pointing back at its row + index. */
export async function fetchAdminTasks(adminContactId) {
  if (!adminContactId) return []
  const { data, error } = await supabase
    .from('interactions')
    .select('id, content, metadata, created_at')
    .eq('contact_id', adminContactId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).flatMap(row =>
    itemsOf(row).map((item, index) => ({
      key: `${row.id}:${index}`,
      rowId: row.id,
      contactId: adminContactId,
      index,
      text: item.text || '',
      // stored as 'YYYY-MM-DD'; trim defensively in case a full timestamp slipped in
      due_date: item.due_date ? String(item.due_date).slice(0, 10) : null,
      done: !!item.done,
      done_at: item.done_at || null,
      recurrence: item.recurrence || null,
      next_row_id: item.next_row_id || null,
      created_at: row.created_at,
      source: row.metadata?.source || null,
      whatsapp_contact_name: row.metadata?.whatsapp_contact_name || null,
    }))
  )
}

// Read-modify-write on a fresh copy of the row, so a change made elsewhere in the
// meantime (another tab, the phone) isn't overwritten with a stale metadata object.
async function updateItems(rowId, mutate) {
  const { data: row, error: loadErr } = await supabase
    .from('interactions')
    .select('id, content, metadata')
    .eq('id', rowId)
    .single()
  if (loadErr) throw loadErr
  const items = mutate(itemsOf(row).map(i => ({ ...i })))

  // Last task of the row removed. A panel-only row has nothing else in it — drop it. A
  // recording is kept (with its content) and flagged, so its summary doesn't come back
  // as a task via the itemsOf fallback.
  if (items.length === 0 && PANEL_ONLY_SOURCES.has(row.metadata?.source)) {
    const { error } = await supabase.from('interactions').delete().eq('id', rowId)
    if (error) throw error
    return
  }
  const { error } = await supabase
    .from('interactions')
    .update({
      metadata: { ...(row.metadata || {}), action_items: items, ...(items.length === 0 && { tasks_cleared: true }) },
    })
    .eq('id', rowId)
  if (error) throw error
}

export async function setAdminTaskDone(task, done) {
  if (done && task.recurrence && task.due_date) {
    // Create the next occurrence first, then mark this one done pointing at it — if the
    // second step fails the worst case is a visible extra task, never a lost month.
    const next_due = nextMonthlyDue(task.due_date, task.recurrence.day)
    const next_row_id = await insertTaskRow({
      contactId: task.contactId,
      text: task.text,
      due_date: next_due,
      recurrence: task.recurrence,
      source: 'recurring',
    })
    return updateItems(task.rowId, items => {
      if (!items[task.index]) return items
      items[task.index] = { ...items[task.index], done: true, done_at: new Date().toISOString(), next_row_id }
      return items
    })
  }

  if (!done && task.next_row_id) {
    // Undoing a recurring task: the occurrence it spawned would now be a duplicate. Remove
    // it — but only if it's still untouched (not done itself), so no history is lost.
    const { data: nextRow } = await supabase
      .from('interactions')
      .select('id, metadata')
      .eq('id', task.next_row_id)
      .maybeSingle()
    const nextItems = nextRow?.metadata?.action_items || []
    if (nextRow && !nextItems.some(i => i.done)) {
      const { error } = await supabase.from('interactions').delete().eq('id', nextRow.id)
      if (error) throw error
    }
  }

  return updateItems(task.rowId, items => {
    if (!items[task.index]) return items
    const { next_row_id: _next, ...rest } = items[task.index]
    items[task.index] = { ...rest, done, done_at: done ? new Date().toISOString() : null }
    return items
  })
}

export function editAdminTask(task, { text, due_date, recurrence }) {
  return updateItems(task.rowId, items => {
    if (!items[task.index]) return items
    const { recurrence: old, ...rest } = items[task.index]
    // Due date untouched → keep the stored day, so a "31st" task currently due on the
    // 30th (a short month) doesn't silently become a "30th" task just by editing its text.
    const rec = old && recurrence && rest.due_date === (due_date || null)
      ? old
      : normalizeRecurrence(recurrence, due_date)
    items[task.index] = { ...rest, text: text.trim(), due_date: due_date || null, ...(rec && { recurrence: rec }) }
    return items
  })
}

export function deleteAdminTask(task) {
  return updateItems(task.rowId, items => items.filter((_, i) => i !== task.index))
}

async function insertTaskRow({ contactId, text, due_date, recurrence, source }) {
  const clean = text.trim()
  const rec = normalizeRecurrence(recurrence, due_date)
  const { data, error } = await supabase.from('interactions').insert({
    contact_id: contactId,
    // Same type the voice-log admin_task route uses (see PendingApprovalAccordion).
    type: 'correspondence',
    content: clean,
    metadata: {
      action_items: [{ text: clean, due_date: due_date || null, done: false, ...(rec && { recurrence: rec }) }],
      source: source || 'admin_panel',
      route: 'admin_task',
    },
  }).select('id').single()
  if (error) throw error
  return data.id
}

/** A task typed by hand in the dashboard panel — one interactions row with one item. */
export async function addAdminTask({ text, due_date, recurrence }) {
  const contactId = await ensureAdminContact()
  if (!contactId) throw new Error('רשומת מנהל המערכת לא נמצאה — נסה לרענן את העמוד')
  await insertTaskRow({ contactId, text, due_date, recurrence, source: 'admin_panel' })
  return contactId
}
