import { supabase } from './supabase.js'
import { backendFetch } from './api.js'
import { createCalendarEventsForActionItems } from './voiceLogActions.js'

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
