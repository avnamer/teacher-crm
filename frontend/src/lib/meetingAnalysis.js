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

  // Another record of the same meeting already exists → one merged meeting, whose AI
  // analysis covers every record's notes, instead of analysing this one on its own.
  const merge = await mergeSameDayMeetings({ rowIds })
  if (merge.merged) return merge.warning

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
// new details. Held meetings on the same calendar day that share a school (or an
// attendee) with the one just saved are treated as that same meeting.

const groupKey = row => row.metadata?.meeting_group_id || row.id

async function findSameDayMeetingRows(ownRows) {
  const day = calendarDateStr(ownRows[0].created_at)
  const anchor = new Date(ownRows[0].created_at).getTime()
  const { data: dayRows, error } = await supabase
    .from('interactions')
    .select('id, contact_id, content, metadata, created_at')
    .eq('type', 'meeting')
    .gte('created_at', new Date(anchor - 36 * 3600000).toISOString())
    .lte('created_at', new Date(anchor + 36 * 3600000).toISOString())
  if (error) throw error
  const held = (dayRows || []).filter(r => calendarDateStr(r.created_at) === day && isCompletedMeeting(r))

  const { data: contacts, error: cErr } = await supabase
    .from('contacts')
    .select('id, name, school')
    .in('id', [...new Set([...held, ...ownRows].map(r => r.contact_id))])
  if (cErr) throw cErr
  const contactsById = Object.fromEntries((contacts || []).map(c => [c.id, c]))

  const ownKeys = new Set(ownRows.map(groupKey))
  const ownContactIds = new Set(ownRows.map(r => r.contact_id))
  const ownSchools = new Set(ownRows.map(r => contactsById[r.contact_id]?.school).filter(Boolean))
  const relatedKeys = new Set(
    held
      .filter(r => !ownKeys.has(groupKey(r)))
      .filter(r => ownContactIds.has(r.contact_id) || ownSchools.has(contactsById[r.contact_id]?.school))
      .map(groupKey)
  )
  const related = held.filter(r => relatedKeys.has(groupKey(r)))
  return { related, contactsById, day }
}

// Merges every same-day record of the meeting whose rows are `rowIds` into one meeting
// group: one row per attendee, with content/summary/tasks produced by the AI from all
// the records' notes (the original notes are kept in metadata.merged_sources). Never
// throws — returns { merged, warning }.
export async function mergeSameDayMeetings({ rowIds }) {
  if (!rowIds?.length) return { merged: false, warning: null }
  try {
    const { data: ownRows, error } = await supabase
      .from('interactions')
      .select('id, contact_id, content, metadata, created_at')
      .in('id', rowIds)
    if (error) throw error
    if (!ownRows?.length || !isCompletedMeeting(ownRows[0])) return { merged: false, warning: null }

    const { related, contactsById, day } = await findSameDayMeetingRows(ownRows)
    if (related.length === 0) return { merged: false, warning: null }

    const allRows = [...ownRows, ...related]
    const groups = {}
    for (const row of allRows) (groups[groupKey(row)] ??= []).push(row)
    // Oldest record first, the one just saved last — the AI treats later notes as the
    // up-to-date version when records conflict.
    const ownKey = groupKey(ownRows[0])
    const orderedKeys = Object.keys(groups)
      .filter(k => k !== ownKey)
      .sort((a, b) => new Date(groups[a][0].created_at) - new Date(groups[b][0].created_at))
    orderedKeys.push(ownKey)
    const notes = [...new Set(
      orderedKeys
        .map(k => groups[k].find(r => r.content?.trim())?.content.trim())
        .filter(Boolean)
    )]
    if (notes.length === 0) return { merged: false, warning: null }

    const result = await backendFetch('/api/meetings/merge', {
      method: 'POST',
      body: JSON.stringify({ notes, date: day }),
    })

    // Deterministic choice of which group and rows survive, so two merges of the same
    // meeting running at once (e.g. a double-clicked save) converge on the same rows
    // instead of each deleting the other's.
    const targetKey = Object.keys(groups).sort()[0]
    const targetCreatedAt = groups[targetKey][0].created_at
    const keptByContact = {}
    for (const row of [...allRows].sort((a, b) => a.id.localeCompare(b.id))) {
      const kept = keptByContact[row.contact_id]
      if (!kept || (groupKey(kept) !== targetKey && groupKey(row) === targetKey)) {
        keptByContact[row.contact_id] = row
      }
    }
    const keptRows = Object.values(keptByContact)
    const keptIds = new Set(keptRows.map(r => r.id))
    const deleteIds = allRows.filter(r => !keptIds.has(r.id)).map(r => r.id)

    const previousItems = allRows.flatMap(r => r.metadata?.action_items || [])
    const findPrevious = item => previousItems.find(p => p.text === item.text && p.due_date === item.due_date)
    const actionItems = result.action_items.map(item => (findPrevious(item)?.done ? { ...item, done: true } : item))
    const newItems = result.action_items.filter(item => !findPrevious(item))
    const names = keptRows.map(r => contactsById[r.contact_id]?.name).filter(Boolean)

    for (const row of keptRows) {
      const { error: updateErr } = await supabase
        .from('interactions')
        .update({
          content: result.content,
          created_at: targetCreatedAt,
          metadata: {
            ...row.metadata,
            meeting_group_id: targetKey,
            attendees: names.filter(n => n !== contactsById[row.contact_id]?.name),
            summary: result.summary,
            action_items: actionItems,
            mentioned_dates: result.mentioned_dates,
            ai_analyzed_content: result.content,
            merged_sources: notes,
          },
        })
        .eq('id', row.id)
      if (updateErr) throw updateErr
    }
    if (deleteIds.length > 0) {
      const { error: deleteErr } = await supabase.from('interactions').delete().in('id', deleteIds)
      if (deleteErr) throw deleteErr
    }

    const warning = await createCalendarEventsForActionItems(newItems, names.join(', '), result.summary)
    return { merged: true, warning }
  } catch (err) {
    console.error('[mergeSameDayMeetings]', err)
    return { merged: false, warning: 'הפגישה נשמרה, אך איחוד הפגישות מאותו יום נכשל: ' + err.message }
  }
}
