import { supabase } from './supabase.js'
import { backendFetch } from './api.js'
import { createCalendarEventsForActionItems, calendarDateStr } from './voiceLogActions.js'
import { isCompletedMeeting } from './meetings.js'

// Whether a held meeting's rows should be (re-)analysed after being saved with
// `content`. Voice-logged meetings arrive already analysed (their content *is* the
// AI summary), so they're only re-analysed if the admin actually rewrites the text;
// a manually typed meeting is analysed whenever its text differs from what was last
// analysed — including older meetings saved before this analysis existed.
export function needsMeetingAnalysis(existingRow, content) {
  const text = content?.trim()
  if (!text) return false
  const metadata = existingRow?.metadata || {}
  if (metadata.ai_analyzed_content !== undefined) return metadata.ai_analyzed_content !== text
  if (metadata.source === 'voice_pwa') return (existingRow.content || '').trim() !== text
  return true
}

// Gives a manually typed meeting the same AI treatment a voice-logged one gets:
// summary, follow-up tasks (metadata.action_items — picked up by the dashboard's
// pending-tasks banner and the contact page) and calendar events for dated tasks.
// The meeting itself is already saved by the time this runs, so it never throws —
// it returns a warning string for the caller to show, or null.
export async function analyzeManualMeeting({ rowIds, content, date, attendeeNames }) {
  const text = content?.trim()
  if (!text || !rowIds?.length) return null

  let result
  try {
    result = await backendFetch('/api/meetings/analyze', {
      method: 'POST',
      body: JSON.stringify({ content: text, date }),
    })
  } catch (err) {
    console.error('[analyzeManualMeeting]', err)
    return 'הפגישה נשמרה, אך ניתוח ה-AI (סיכום ומשימות) נכשל: ' + err.message
  }

  try {
    const { data: rows, error } = await supabase
      .from('interactions')
      .select('id, metadata')
      .in('id', rowIds)
    if (error) throw error

    // Re-analysing an edited meeting keeps the "done" tick on tasks that survived the
    // edit, and only creates calendar events for tasks that weren't there before.
    const previousItems = rows[0]?.metadata?.action_items || []
    const findPrevious = item => previousItems.find(p => p.text === item.text && p.due_date === item.due_date)
    const actionItems = result.action_items.map(item => {
      const prev = findPrevious(item)
      return prev?.done ? { ...item, done: true } : item
    })
    const newItems = result.action_items.filter(item => !findPrevious(item))

    for (const row of rows) {
      const { error: updateErr } = await supabase
        .from('interactions')
        .update({
          metadata: {
            ...row.metadata,
            summary: result.summary,
            action_items: actionItems,
            mentioned_dates: result.mentioned_dates,
            ai_analyzed_content: text,
          },
        })
        .eq('id', row.id)
      if (updateErr) throw updateErr
    }

    return await createCalendarEventsForActionItems(newItems, attendeeNames.join(', '), result.summary)
  } catch (err) {
    console.error('[analyzeManualMeeting]', err)
    return 'הפגישה נשמרה, אך שמירת ניתוח ה-AI נכשלה: ' + err.message
  }
}

// ─── Merging several records of the same meeting ───────────────────────────
// The same real-world meeting can end up recorded more than once on the same day —
// typed in twice, typed and also voice-logged, or "updated" by adding it again with
// new details. Held meetings on the same calendar day that share a school or an
// attendee are proposed as one meeting; nothing is merged until the admin approves
// the proposal (dashboard banner / Meetings page), and a rejected proposal is
// remembered in metadata.not_duplicate_of so it isn't raised again.

const groupKey = row => row.metadata?.meeting_group_id || row.id

// When a record was last saved — metadata.saved_at is stamped on every meeting save;
// older rows fall back to created_at (the meeting date, noon for typed-in meetings).
const savedAt = row => row.metadata?.saved_at || row.created_at

/**
 * Groups of held meeting groups that look like the same meeting (same calendar day,
 * sharing a school or an attendee, not rejected before). Each cluster's groups are
 * ordered oldest save first.
 */
export function findDuplicateMeetingClusters(rows, contactsById) {
  const groups = {}
  for (const row of rows.filter(isCompletedMeeting)) {
    const key = groupKey(row)
    groups[key] ??= { groupId: key, day: calendarDateStr(row.created_at), rows: [] }
    groups[key].rows.push(row)
  }
  const list = Object.values(groups).map(g => ({
    ...g,
    rowIds: g.rows.map(r => r.id),
    contactNames: g.rows.map(r => contactsById[r.contact_id]?.name).filter(Boolean),
    contactIds: new Set(g.rows.map(r => r.contact_id)),
    schools: new Set(g.rows.map(r => contactsById[r.contact_id]?.school).filter(Boolean)),
    content: g.rows.find(r => r.content?.trim())?.content.trim() || '',
    savedAt: g.rows.map(savedAt).sort().at(-1),
    declined: new Set(g.rows.flatMap(r => r.metadata?.not_duplicate_of || [])),
  }))

  const related = (a, b) =>
    a.day === b.day &&
    !a.declined.has(b.groupId) && !b.declined.has(a.groupId) &&
    ([...a.contactIds].some(id => b.contactIds.has(id)) || [...a.schools].some(s => b.schools.has(s)))

  // Union-find over related pairs, so A~B and B~C land in one cluster.
  const parent = Object.fromEntries(list.map(g => [g.groupId, g.groupId]))
  const find = k => (parent[k] === k ? k : (parent[k] = find(parent[k])))
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (related(list[i], list[j])) parent[find(list[i].groupId)] = find(list[j].groupId)
    }
  }
  const clusters = {}
  for (const g of list) (clusters[find(g.groupId)] ??= []).push(g)
  return Object.values(clusters)
    .filter(c => c.length > 1)
    .map(c => {
      const ordered = c.sort((a, b) => new Date(a.savedAt) - new Date(b.savedAt))
      return { key: ordered.map(g => g.groupId).sort().join('|'), day: ordered[0].day, groups: ordered }
    })
}

/**
 * Asks the AI for the merged meeting without saving anything. Identical notes are sent
 * once; each group gets `taken` (what the AI took from its notes) or `duplicateOf`.
 */
export async function previewMeetingMerge(cluster) {
  const notes = []
  const noteIndexByGroup = {}
  for (const g of cluster.groups) {
    if (!g.content) continue
    let idx = notes.indexOf(g.content)
    if (idx === -1) idx = notes.push(g.content) - 1
    noteIndexByGroup[g.groupId] = idx
  }
  if (notes.length === 0) throw new Error('אין תוכן לאחד')

  const result = await backendFetch('/api/meetings/merge', {
    method: 'POST',
    body: JSON.stringify({ notes, date: cluster.day }),
  })
  const firstGroupForNote = {}
  const groupSources = cluster.groups.map(g => {
    const idx = noteIndexByGroup[g.groupId]
    if (idx === undefined) return { groupId: g.groupId, taken: 'רשומה ריקה, אין בה תוכן' }
    if (firstGroupForNote[idx]) return { groupId: g.groupId, duplicateOf: firstGroupForNote[idx] }
    firstGroupForNote[idx] = g.groupId
    const source = result.sources?.find(src => Number(src.record) === idx + 1)
    return { groupId: g.groupId, taken: source?.taken || '' }
  })
  return { ...result, notes, groupSources }
}

/**
 * Saves an approved merge: one row per attendee in one group, holding the preview's
 * content/summary/tasks (original notes kept in metadata.merged_sources). Returns a
 * calendar warning or null; throws on failure.
 */
export async function applyMeetingMerge(cluster, preview) {
  const { data: allRows, error } = await supabase
    .from('interactions')
    .select('id, contact_id, content, metadata, created_at')
    .in('id', cluster.groups.flatMap(g => g.rowIds))
  if (error) throw error
  if (!allRows?.length) throw new Error('הפגישות לא נמצאו, ייתכן שכבר אוחדו')
  const { data: contacts, error: cErr } = await supabase
    .from('contacts')
    .select('id, name')
    .in('id', [...new Set(allRows.map(r => r.contact_id))])
  if (cErr) throw cErr
  const namesById = Object.fromEntries(contacts.map(c => [c.id, c.name]))

  // The oldest group survives, keeping one row per attendee (its own row if it has one).
  const targetKey = cluster.groups.map(g => g.groupId).find(k => allRows.some(r => groupKey(r) === k))
  const targetCreatedAt = allRows.find(r => groupKey(r) === targetKey).created_at
  const keptByContact = {}
  for (const row of allRows) {
    const kept = keptByContact[row.contact_id]
    if (!kept || (groupKey(kept) !== targetKey && groupKey(row) === targetKey)) keptByContact[row.contact_id] = row
  }
  const keptRows = Object.values(keptByContact)
  const keptIds = new Set(keptRows.map(r => r.id))
  const deleteIds = allRows.filter(r => !keptIds.has(r.id)).map(r => r.id)

  const previousItems = allRows.flatMap(r => r.metadata?.action_items || [])
  const findPrevious = item => previousItems.find(p => p.text === item.text && p.due_date === item.due_date)
  const actionItems = preview.action_items.map(item => (findPrevious(item)?.done ? { ...item, done: true } : item))
  const newItems = preview.action_items.filter(item => !findPrevious(item))
  const names = keptRows.map(r => namesById[r.contact_id]).filter(Boolean)
  const declined = [...new Set(allRows.flatMap(r => r.metadata?.not_duplicate_of || []))]

  for (const row of keptRows) {
    const { error: updateErr } = await supabase
      .from('interactions')
      .update({
        content: preview.content,
        created_at: targetCreatedAt,
        metadata: {
          ...row.metadata,
          meeting_group_id: targetKey,
          attendees: names.filter(n => n !== namesById[row.contact_id]),
          summary: preview.summary,
          action_items: actionItems,
          mentioned_dates: preview.mentioned_dates,
          ai_analyzed_content: preview.content,
          merged_sources: preview.notes,
          saved_at: new Date().toISOString(),
          ...(declined.length ? { not_duplicate_of: declined } : {}),
        },
      })
      .eq('id', row.id)
    if (updateErr) throw updateErr
  }
  if (deleteIds.length > 0) {
    const { error: deleteErr } = await supabase.from('interactions').delete().in('id', deleteIds)
    if (deleteErr) throw deleteErr
  }

  return await createCalendarEventsForActionItems(newItems, names.join(', '), preview.summary)
}

/** Remembers that the cluster's groups are separate meetings, so it isn't proposed again. */
export async function declineMeetingMerge(cluster) {
  const allKeys = cluster.groups.map(g => g.groupId)
  for (const g of cluster.groups) {
    const others = allKeys.filter(k => k !== g.groupId)
    for (const row of g.rows) {
      const { error } = await supabase
        .from('interactions')
        .update({
          metadata: {
            ...row.metadata,
            not_duplicate_of: [...new Set([...(row.metadata?.not_duplicate_of || []), ...others])],
          },
        })
        .eq('id', row.id)
      if (error) throw error
    }
  }
}
