import { useState, useEffect, useCallback } from 'react'
import {
  fetchAdminTasks,
  setAdminTaskDone,
  editAdminTask,
  deleteAdminTask,
  addAdminTask,
} from '../lib/adminTasks.js'

// "המשימות שלי" — the system admin's personal tasks, at the top of the dashboard.
// Tasks come from approved "משימה אישית לי" voice logs (and from the quick-add box
// here). See lib/adminTasks.js for where they're stored.

const EXPANDED_KEY = 'adminTasksPanelExpanded'

function readExpanded() {
  try {
    return localStorage.getItem(EXPANDED_KEY) !== '0'
  } catch {
    return true
  }
}

function writeExpanded(value) {
  try {
    localStorage.setItem(EXPANDED_KEY, value ? '1' : '0')
  } catch {
    // storage unavailable (private mode etc.) — the panel just won't remember
  }
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDue(due) {
  // due is 'YYYY-MM-DD'; build a local date so it doesn't shift a day in UTC+ timezones
  const [y, m, d] = due.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })
}

function dueStatus(due) {
  if (!due) return null
  const today = todayStr()
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  return 'future'
}

// Open tasks: dated ones first (earliest due first), then undated (newest first).
function compareOpen(a, b) {
  if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
  if (a.due_date) return -1
  if (b.due_date) return 1
  return b.created_at.localeCompare(a.created_at)
}

function compareDone(a, b) {
  return (b.done_at || b.created_at).localeCompare(a.done_at || a.created_at)
}

function deleteConfirmText(task) {
  return task.recurrence && !task.done
    ? `למחוק את המשימה החוזרת "${task.text}"? היא לא תחזור יותר בחודשים הבאים.`
    : `למחוק את המשימה "${task.text}"?`
}

export default function AdminTasksPanel({ adminContactId, reloadKey, onAdminContactCreated }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(readExpanded)
  const [showDone, setShowDone] = useState(false)
  const [busyKey, setBusyKey] = useState(null)
  const [editingKey, setEditingKey] = useState(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      setTasks(await fetchAdminTasks(adminContactId))
      setError(null)
    } catch (err) {
      console.error('Error loading admin tasks:', err)
      setError('טעינת המשימות נכשלה')
    } finally {
      setLoading(false)
    }
  }, [adminContactId])

  useEffect(() => { load() }, [load, reloadKey])

  function toggleExpanded() {
    setExpanded(v => {
      writeExpanded(!v)
      return !v
    })
  }

  async function run(key, action) {
    setBusyKey(key)
    try {
      await action()
      await load()
    } catch (err) {
      alert('הפעולה נכשלה: ' + (err instanceof TypeError ? 'שגיאת רשת — יש לבדוק את החיבור' : err.message))
    } finally {
      setBusyKey(null)
    }
  }

  const open = tasks.filter(t => !t.done).sort(compareOpen)
  const done = tasks.filter(t => t.done).sort(compareDone)
  const overdueCount = open.filter(t => dueStatus(t.due_date) === 'overdue').length

  if (loading) return null

  return (
    <div className="rounded-xl border p-4 bg-indigo-50 border-indigo-200">
      <button onClick={toggleExpanded} className="w-full flex items-center justify-between gap-2 text-right">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-lg">📝</span>
          <span className="text-sm font-bold text-indigo-900">המשימות שלי</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
            {open.length} פתוחות
          </span>
          {overdueCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
              {overdueCount} באיחור
            </span>
          )}
        </div>
        <span className="text-xs text-indigo-700 shrink-0">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {error && <p className="text-sm text-red-600">{error}</p>}

          {adding ? (
            <TaskForm
              initialText=""
              initialDue=""
              initialRecurring={false}
              submitLabel="הוסף"
              busy={busyKey === 'new'}
              onCancel={() => setAdding(false)}
              onSubmit={values => run('new', async () => {
                const contactId = await addAdminTask(values)
                if (!adminContactId) onAdminContactCreated?.(contactId)
                setAdding(false)
              })}
            />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full py-2 rounded-lg border border-dashed border-indigo-300 text-sm text-indigo-700 hover:bg-indigo-100"
            >
              + משימה חדשה
            </button>
          )}

          {open.length === 0 && !adding && (
            <p className="text-sm text-indigo-700 text-center py-2">אין משימות פתוחות 🎉</p>
          )}

          <ul className="space-y-2">
            {open.map(task => (
              <TaskRow
                key={task.key}
                task={task}
                busy={busyKey === task.key}
                editing={editingKey === task.key}
                onStartEdit={() => setEditingKey(task.key)}
                onCancelEdit={() => setEditingKey(null)}
                onSave={values => run(task.key, async () => {
                  await editAdminTask(task, values)
                  setEditingKey(null)
                })}
                onToggle={() => run(task.key, () => setAdminTaskDone(task, true))}
                onDelete={() => {
                  if (confirm(deleteConfirmText(task))) run(task.key, () => deleteAdminTask(task))
                }}
              />
            ))}
          </ul>

          {done.length > 0 && (
            <div className="pt-1">
              <button onClick={() => setShowDone(v => !v)} className="text-xs text-indigo-700 hover:underline">
                {showDone ? '▲' : '▼'} בוצעו ({done.length})
              </button>
              {showDone && (
                <ul className="mt-2 space-y-2">
                  {done.map(task => (
                    <TaskRow
                      key={task.key}
                      task={task}
                      busy={busyKey === task.key}
                      editing={false}
                      onToggle={() => run(task.key, () => setAdminTaskDone(task, false))}
                      onDelete={() => {
                        if (confirm(deleteConfirmText(task))) run(task.key, () => deleteAdminTask(task))
                      }}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const SOURCE_LABEL = { admin_panel: 'נוסף', recurring: '🔁 נוצר', voice_task: '🎙 הוכתב' }

function TaskRow({ task, busy, editing, onStartEdit, onCancelEdit, onSave, onToggle, onDelete }) {
  if (editing) {
    return (
      <li>
        <TaskForm
          initialText={task.text}
          initialDue={task.due_date || ''}
          initialRecurring={!!task.recurrence}
          submitLabel="שמור"
          busy={busy}
          onCancel={onCancelEdit}
          onSubmit={onSave}
        />
      </li>
    )
  }

  const status = task.done ? null : dueStatus(task.due_date)
  const dueClass = {
    overdue: 'bg-red-100 text-red-700',
    today: 'bg-amber-100 text-amber-800',
    future: 'bg-gray-100 text-gray-600',
  }[status]

  return (
    <li className={`flex items-start gap-3 rounded-lg bg-white border border-indigo-100 p-3 ${busy ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={task.done}
        disabled={busy}
        onChange={onToggle}
        className="w-5 h-5 mt-0.5 shrink-0 accent-indigo-600"
        title={task.done ? 'החזר למשימות פתוחות' : 'סמן כבוצע'}
      />
      <div className="flex-1 min-w-0">
        <p className={`text-sm break-words ${task.done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
          {task.text}
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {task.due_date && (
            <span className={`text-xs px-2 py-0.5 rounded-full ${task.done ? 'bg-gray-100 text-gray-400' : dueClass}`}>
              {status === 'overdue' ? 'באיחור · ' : status === 'today' ? 'היום · ' : 'עד '}
              {formatDue(task.due_date)}
            </span>
          )}
          {task.recurrence && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
              🔁 כל חודש ב-{task.recurrence.day}
            </span>
          )}
          <span className="text-xs text-gray-400">
            {task.source === 'whatsapp'
              ? `💬 וואטסאפ · ${task.whatsapp_contact_name || ''}`
              : (SOURCE_LABEL[task.source] || '🎙 הוקלט')}{' '}
            {new Date(task.created_at).toLocaleDateString('he-IL')}
          </span>
        </div>
      </div>
      <div className="flex gap-1 shrink-0">
        {!task.done && onStartEdit && (
          <button onClick={onStartEdit} disabled={busy} title="עריכה"
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">✏️</button>
        )}
        <button onClick={onDelete} disabled={busy} title="מחיקה"
          className="p-1.5 rounded-lg text-gray-500 hover:bg-red-50">🗑️</button>
      </div>
    </li>
  )
}

function TaskForm({ initialText, initialDue, initialRecurring, submitLabel, busy, onCancel, onSubmit }) {
  const [text, setText] = useState(initialText)
  const [due, setDue] = useState(initialDue)
  const [recurring, setRecurring] = useState(initialRecurring)

  function submit(e) {
    e.preventDefault()
    if (!text.trim()) return alert('יש להזין את תוכן המשימה')
    if (recurring && !due) return alert('משימה חוזרת צריכה תאריך יעד — ממנו נקבע היום בחודש')
    onSubmit({ text, due_date: due || null, recurrence: recurring ? { type: 'monthly' } : null })
  }

  return (
    <form onSubmit={submit} className="rounded-lg bg-white border border-indigo-200 p-3 space-y-2">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={2}
        autoFocus
        placeholder="מה צריך לעשות?"
        className="w-full border border-gray-300 rounded-lg p-2 text-sm"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs text-gray-600 flex items-center gap-1">
          תאריך יעד:
          <input type="date" value={due} onChange={e => setDue(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
        </label>
        {due && (
          <button type="button" onClick={() => { setDue(''); setRecurring(false) }} className="text-xs text-gray-500 hover:underline">
            ללא תאריך
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <label className={`text-xs flex items-center gap-1.5 ${due ? 'text-gray-700' : 'text-gray-400'}`}
          title={due ? '' : 'יש לבחור תאריך יעד קודם'}>
          <input type="checkbox" checked={recurring} disabled={!due}
            onChange={e => setRecurring(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
          🔁 חוזר כל חודש{due ? ` ב-${Number(due.slice(8, 10))} לחודש` : ''}
        </label>
        <div className="flex gap-2 mr-auto">
          <button type="button" onClick={onCancel} disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-600 hover:bg-gray-50">
            ביטול
          </button>
          <button type="submit" disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? 'שומר...' : submitLabel}
          </button>
        </div>
      </div>
    </form>
  )
}
