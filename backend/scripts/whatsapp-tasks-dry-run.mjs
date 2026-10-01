// Dry run for WhatsApp task extraction: prints the tasks Claude finds in a
// contact's already-stored WhatsApp DM messages. Writes nothing.
// Run from backend/:  node scripts/whatsapp-tasks-dry-run.mjs <contact-id> [<contact-id> ...]
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { analyzeWhatsAppTasks } from '../src/services/claudeAnalyze.js'
import { formatMessagesForPrompt } from '../src/services/whatsappTasks.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

for (const contactId of process.argv.slice(2)) {
  const { data: contact, error: cErr } = await supabase.from('contacts').select('name').eq('id', contactId).single()
  if (cErr) { console.error(contactId, cErr.message); continue }
  const { data: rows, error } = await supabase
    .from('interactions').select('metadata')
    .eq('contact_id', contactId).eq('type', 'whatsapp').contains('metadata', { source: 'dm' })
  if (error) { console.error(contact.name, error.message); continue }
  const messages = rows.flatMap(r => r.metadata?.messages || [])
  const { conversation, messageDates } = formatMessagesForPrompt(messages, contact.name)
  console.log(`\n=== ${contact.name}: ${messages.length} messages ===`)
  if (!conversation) { console.log('(no text)'); continue }
  const tasks = await analyzeWhatsAppTasks({ teacherName: contact.name, conversation, existingTasks: [], messageDates })
  for (const t of tasks) {
    console.log(`${t.assignee === 'admin' ? 'אבנר ' : 'מורה '} [${t.message_date}]${t.done ? ' ✓ בוצעה' : ''}${t.due_date ? ` (עד ${t.due_date})` : ''} ${t.text}`)
  }
  if (tasks.length === 0) console.log('(no tasks)')
}
