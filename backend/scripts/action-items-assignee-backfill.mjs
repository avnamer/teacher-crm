// Backfill for "whose task" on call/meeting action items saved before the analysis
// started tagging them (metadata.action_items[].assignee: 'admin' | 'teacher' | 'both').
// Tagged 'admin'/'both' items show up in the dashboard's "המשימות שלי" panel.
// Only open (not done) items without an assignee are classified; WhatsApp rows are
// skipped (their teacher-row items are the teacher's by construction).
// Two steps, so the owner approves exactly what gets saved:
//
//   node scripts/action-items-assignee-backfill.mjs          preview: calls Claude, prints
//                                                            each task with its owner, writes
//                                                            a plan file
//   node scripts/action-items-assignee-backfill.mjs --save   saves that plan file as-is
//                                                            (no Claude call)
//
// Run from backend/. Optional last argument: the plan file path. To correct a single
// task before saving, edit its "assignee" in the plan file.
import 'dotenv/config'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { classifyActionItemAssignees } from '../src/services/claudeAnalyze.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const args = process.argv.slice(2)
const save = args.includes('--save')
const planFile = args.find(a => !a.startsWith('--')) || path.join(os.tmpdir(), 'action-items-assignee-backfill.json')

const LABEL = { admin: 'אבנר  ', teacher: 'מורה  ', both: 'משותפת' }
const needsAssignee = item => item && !item.done && !item.assignee && typeof item.text === 'string' && item.text.trim()

if (save) {
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'))
  let saved = 0
  for (const entry of plan) {
    for (const rowId of entry.rowIds) {
      const { data: row, error } = await supabase.from('interactions').select('id, metadata').eq('id', rowId).maybeSingle()
      if (error) throw error
      if (!row) continue
      const items = (row.metadata?.action_items || []).map(item => {
        if (item.assignee) return item // tagged meanwhile — keep
        const planned = entry.tasks.find(t => t.text === item.text && t.assignee)
        return planned ? { ...item, assignee: planned.assignee } : item
      })
      const { error: updateErr } = await supabase
        .from('interactions')
        .update({ metadata: { ...row.metadata, action_items: items } })
        .eq('id', row.id)
      if (updateErr) throw updateErr
      saved++
    }
  }
  console.log(`Saved owners on ${saved} row(s).`)
} else {
  const { data: adminRow } = await supabase
    .from('contacts').select('id').contains('custom_fields', { is_admin_row: true }).maybeSingle()
  const { data: rows, error } = await supabase
    .from('interactions')
    .select('id, contact_id, type, content, metadata, created_at')
    .neq('type', 'whatsapp')
    .not('metadata->action_items', 'is', null)
  if (error) throw error
  const candidates = rows.filter(r =>
    r.contact_id !== adminRow?.id && (r.metadata?.action_items || []).some(needsAssignee)
  )

  const { data: contacts, error: cErr } = await supabase
    .from('contacts').select('id, name').in('id', [...new Set(candidates.map(r => r.contact_id))])
  if (cErr) throw cErr
  const nameById = Object.fromEntries((contacts || []).map(c => [c.id, c.name]))

  // A meeting has one row per attendee, each with a copy of the same tasks — classify once.
  const groups = {}
  for (const row of candidates) (groups[row.metadata?.meeting_group_id || row.id] ??= []).push(row)

  const plan = []
  for (const groupRows of Object.values(groups)) {
    const [first] = groupRows
    const texts = [...new Set(groupRows.flatMap(r => (r.metadata.action_items || []).filter(needsAssignee).map(i => i.text)))]
    const teacherNames = groupRows.map(r => nameById[r.contact_id]).filter(Boolean)
    const record = first.content || first.metadata?.summary || ''
    const assignees = await classifyActionItemAssignees({ record, teacherNames, items: texts })
    const tasks = texts.map((text, i) => ({ text, assignee: assignees[i] }))
    console.log(`\n=== ${teacherNames.join(', ')} · ${first.type} · ${new Date(first.created_at).toLocaleDateString('he-IL')} ===`)
    for (const t of tasks) console.log(`${LABEL[t.assignee] || '??    '} ${t.text}`)
    plan.push({ rowIds: groupRows.map(r => r.id), teacherNames, tasks })
  }
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2))
  const mine = plan.flatMap(p => p.tasks).filter(t => t.assignee === 'admin' || t.assignee === 'both').length
  console.log(`\n${plan.length} record(s), ${mine} task(s) will move into "המשימות שלי". Plan written to ${planFile} — run again with --save to save it.`)
}
