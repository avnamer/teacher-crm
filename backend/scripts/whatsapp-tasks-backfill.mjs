// Backfill for WhatsApp task extraction (#66): DM day rows synced before task
// extraction shipped (or whose extraction failed) have no metadata.tasks_analyzed_at.
// Two steps, so the owner approves exactly what gets saved:
//
//   node scripts/whatsapp-tasks-backfill.mjs            preview: calls Claude, prints the
//                                                       tasks, writes them to a plan file
//   node scripts/whatsapp-tasks-backfill.mjs --save     saves that plan file as-is
//                                                       (no Claude call, duplicates re-checked)
//
// Run from backend/. Optional last argument: the plan file path.
import 'dotenv/config'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { findWhatsAppTasks, saveWhatsAppTasks } from '../src/services/whatsappTasks.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const args = process.argv.slice(2)
const save = args.includes('--save')
const planFile = args.find(a => !a.startsWith('--')) || path.join(os.tmpdir(), 'whatsapp-tasks-backfill.json')

function printTasks(name, tasks) {
  console.log(`\n=== ${name}: ${tasks.length} task(s) ===`)
  for (const t of tasks) {
    console.log(`${t.assignee === 'admin' ? 'אבנר ' : 'מורה '} [${t.message_date}]${t.done ? ' ✓ בוצעה' : ''}${t.due_date ? ` (עד ${t.due_date})` : ''} ${t.text}`)
  }
}

if (save) {
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'))
  for (const entry of plan) {
    const result = await saveWhatsAppTasks(entry)
    console.log(`${entry.contactName}: saved ${result.teacherTasks} teacher + ${result.adminTasks} admin task(s), ${entry.messageDates.length} day row(s) marked analyzed`)
  }
} else {
  const { data: rows, error } = await supabase
    .from('interactions')
    .select('contact_id, metadata')
    .eq('type', 'whatsapp')
    .contains('metadata', { source: 'dm' })
  if (error) throw error

  const byContact = new Map()
  for (const row of rows) {
    if (row.metadata?.tasks_analyzed_at) continue
    if (!byContact.has(row.contact_id)) byContact.set(row.contact_id, [])
    byContact.get(row.contact_id).push(...(row.metadata?.messages || []))
  }

  const plan = []
  for (const [contactId, savedMessages] of byContact) {
    const found = await findWhatsAppTasks({ contactId, savedMessages })
    if (!found) continue // no text to analyze (e.g. only a sticker) — nothing to save or mark
    printTasks(found.contactName, found.tasks)
    plan.push({ contactId, ...found })
  }
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2))
  console.log(`\n${plan.length} teacher(s). Plan written to ${planFile} — run again with --save to save it.`)
}
