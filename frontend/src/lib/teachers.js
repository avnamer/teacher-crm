// Shared teacher / task-column predicates.
//
// These were previously private to Contacts.jsx, but the WhatsApp bulk-send flow
// needs the same definitions to filter recipients by task completion. Keeping one
// copy matters: if "done" meant something different on the dashboard than it does
// when picking who to message, the reminder would go to the wrong people.

export const MENTOR = 'אבנר'

/**
 * The pseudo-contact row representing "מנהל המערכת", created by the voice-log
 * admin_task route to hang admin tasks off. It is not a person and must never be
 * messaged.
 */
export function isAdminRow(contact) {
  return contact?.custom_fields?.is_admin_row === true
}

/** Only Avner's teachers: mentor must match, and the role must be a teacher role. */
export function isMyTeacher(contact) {
  if (contact?.custom_fields?.mentor_name !== MENTOR) return false
  const { role } = contact
  if (!role) return true // mentor set but role not synced yet — include
  return role.includes('מורה')
}

/**
 * Whether a contact has completed a task column.
 *
 * 'לא הוגש' is a real stored value meaning "explicitly not submitted", so it has to
 * be treated as not-done rather than as truthy content.
 */
export function isTaskDone(contact, col) {
  const value = contact?.custom_fields?.[col.key]
  return Boolean(value) && value !== 'לא הוגש'
}

/** The task columns out of a full column config. */
export function taskColumnsFrom(columns) {
  return (columns || []).filter(c => c.source === 'task')
}

export const TASK_SOURCE_LABEL = { monday: 'Monday', general: 'כללי' }

// Keys intentionally match the pre-existing custom_fields.challenge1/2/3 (from the old
// standalone Monday page) so existing data renders with no migration.
export const DEFAULT_TASK_COLUMNS = [
  { key: 'challenge1', label: 'אתגר 1', source: 'task', taskSource: 'monday', visible: true, locked: false, width: 90 },
  { key: 'challenge2', label: 'אתגר 2', source: 'task', taskSource: 'monday', visible: true, locked: false, width: 90 },
  { key: 'challenge3', label: 'אתגר 3', source: 'task', taskSource: 'monday', visible: true, locked: false, width: 90 },
]

/**
 * The task columns as currently configured, for callers that need them without
 * owning the whole column config (the WhatsApp recipient filter).
 *
 * Falls back to the defaults when settings has no saved config yet, matching what
 * the dashboard would render in the same situation.
 */
export async function loadTaskColumns(supabase) {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('contacts_columns')
      .eq('id', 'global')
      .single()
    if (error) throw error
    const saved = data?.contacts_columns
    if (!saved || saved.length === 0) return DEFAULT_TASK_COLUMNS
    // The dashboard appends any built-in column a saved config predates, so a config
    // written before challenge1/2/3 existed still renders them. Mirror that here or
    // the task picker would silently omit tasks the table clearly shows.
    const missing = DEFAULT_TASK_COLUMNS.filter(d => !saved.some(s => s.key === d.key))
    return taskColumnsFrom([...saved, ...missing])
  } catch (err) {
    console.error('Error loading task columns:', err)
    return DEFAULT_TASK_COLUMNS
  }
}
