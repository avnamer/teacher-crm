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

function itemsOf(row) {
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
      index,
      text: item.text || '',
      // stored as 'YYYY-MM-DD'; trim defensively in case a full timestamp slipped in
      due_date: item.due_date ? String(item.due_date).slice(0, 10) : null,
      done: !!item.done,
      done_at: item.done_at || null,
      created_at: row.created_at,
      source: row.metadata?.source || null,
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

  // Last task of the row removed — the row has nothing left to show, drop it entirely.
  if (items.length === 0) {
    const { error } = await supabase.from('interactions').delete().eq('id', rowId)
    if (error) throw error
    return
  }
  const { error } = await supabase
    .from('interactions')
    .update({ metadata: { ...(row.metadata || {}), action_items: items } })
    .eq('id', rowId)
  if (error) throw error
}

export function setAdminTaskDone(task, done) {
  return updateItems(task.rowId, items => {
    if (!items[task.index]) return items
    items[task.index] = { ...items[task.index], done, done_at: done ? new Date().toISOString() : null }
    return items
  })
}

export function editAdminTask(task, { text, due_date }) {
  return updateItems(task.rowId, items => {
    if (!items[task.index]) return items
    items[task.index] = { ...items[task.index], text: text.trim(), due_date: due_date || null }
    return items
  })
}

export function deleteAdminTask(task) {
  return updateItems(task.rowId, items => items.filter((_, i) => i !== task.index))
}

/** A task typed by hand in the dashboard panel — one interactions row with one item. */
export async function addAdminTask({ text, due_date }) {
  const contactId = await ensureAdminContact()
  if (!contactId) throw new Error('רשומת מנהל המערכת לא נמצאה — נסה לרענן את העמוד')
  const clean = text.trim()
  const { error } = await supabase.from('interactions').insert({
    contact_id: contactId,
    // Same type the voice-log admin_task route uses (see PendingApprovalAccordion).
    type: 'correspondence',
    content: clean,
    metadata: {
      action_items: [{ text: clean, due_date: due_date || null, done: false }],
      source: 'admin_panel',
      route: 'admin_task',
    },
  })
  if (error) throw error
  return contactId
}
