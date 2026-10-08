import { supabase } from './supabase.js'

// A task typed by hand and tagged "גם משימה מההנהלה": one management_tasks row aimed at me
// (audience 'me'), so it shows in the dashboard's management panel next to the ones the
// WhatsApp sync finds. No message_id/group — those only exist for synced tasks.
export async function addManagementTask({ text, due_date }) {
  const today = new Date()
  const message_date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const { error } = await supabase.from('management_tasks').insert({
    text: text.trim(),
    audience: 'me',
    sender_name: 'הוספה ידנית',
    message_date,
    due_date: due_date || null,
  })
  if (error) throw error
}
