import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'

// "משימות מההנהלה" — tasks Benny / Mika gave in the management WhatsApp groups, found
// by the sync (backend/src/services/managementTasks.js) and stored in management_tasks.
// audience 'all' = to all mentors (Avner included), 'me' = to Avner by name.

const EXPANDED_KEY = 'managementTasksPanelExpanded'

function readExpanded() {
  try { return localStorage.getItem(EXPANDED_KEY) !== '0' } catch { return true }
}
function writeExpanded(v) {
  try { localStorage.setItem(EXPANDED_KEY, v ? '1' : '0') } catch { /* storage unavailable */ }
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDay(str) {
  if (!str) return ''
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })
}

// Open tasks: dated ones first (earliest due first), then undated, newest message first.
function compareOpen(a, b) {
  if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
  if (a.due_date) return -1
  if (b.due_date) return 1
  return (b.message_date || '').localeCompare(a.message_date || '')
}

export default function ManagementTasksPanel({ reloadKey = 0 }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(readExpanded)
  const [showDone, setShowDone] = useState(false)
  const [openId, setOpenId] = useState(null) // task whose original message is shown
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    try {
      const { data, error: err } = await supabase.from('management_tasks').select('*')
      if (err) throw err
      setTasks(data || [])
      setError(null)
    } catch (err) {
      console.error('Error loading management tasks:', err)
      setError('טעינת המשימות מההנהלה נכשלה (האם הורצה המיגרציה ב-Supabase?)')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load, reloadKey])

  async function setDone(task, done) {
    setBusyId(task.id)
    try {
      const { error: err } = await supabase.from('management_tasks')
        .update({ done, done_at: done ? new Date().toISOString() : null }).eq('id', task.id)
      if (err) throw err
      await load()
    } catch (err) {
      alert('הפעולה נכשלה: ' + err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function remove(task) {
    if (!confirm(`למחוק את המשימה "${task.text}"?`)) return
    setBusyId(task.id)
    try {
      const { error: err } = await supabase.from('management_tasks').delete().eq('id', task.id)
      if (err) throw err
      await load()
    } catch (err) {
      alert('המחיקה נכשלה: ' + err.message)
    } finally {
      setBusyId(null)
    }
  }

  const open = tasks.filter(t => !t.done).sort(compareOpen)
  const done = tasks.filter(t => t.done)
    .sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''))
  const today = todayStr()

  // Nothing to show and nothing wrong → stay out of the way until the first task arrives.
  if (!loading && !error && tasks.length === 0) return null

  function row(t) {
    const overdue = !t.done && t.due_date && t.due_date < today
    return (
      <li key={t.id} className="px-4 py-2.5">
        <div className="flex items-start gap-3">
          <input type="checkbox" checked={t.done} disabled={busyId === t.id}
            onChange={() => setDone(t, !t.done)} className="w-4 h-4 mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className={`text-sm ${t.done ? 'line-through text-gray-400' : 'text-gray-800'}`}>{t.text}</p>
            <p className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-x-2 items-center">
              <span className={`px-1.5 rounded ${t.audience === 'me' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                {t.audience === 'me' ? 'אליי' : 'לכל המנטורים'}
              </span>
              <span>{t.sender_name}</span>
              {t.group_name && <span>· {t.group_name}</span>}
              {t.message_date && <span>· {formatDay(t.message_date)}</span>}
              {t.due_date && (
                <span className={overdue ? 'text-red-600 font-medium' : 'text-gray-600'}>
                  · עד {formatDay(t.due_date)}{overdue ? ' (באיחור)' : ''}
                </span>
              )}
              {t.message_text && (
                <button onClick={() => setOpenId(openId === t.id ? null : t.id)}
                  className="text-blue-600 hover:underline">
                  {openId === t.id ? 'הסתר הודעה' : 'ההודעה המקורית'}
                </button>
              )}
            </p>
            {openId === t.id && (
              <p className="mt-1.5 text-xs text-gray-600 bg-gray-50 border rounded p-2 whitespace-pre-wrap">{t.message_text}</p>
            )}
          </div>
          <button onClick={() => remove(t)} disabled={busyId === t.id} title="מחק"
            className="text-gray-300 hover:text-red-500 text-sm shrink-0">✕</button>
        </div>
      </li>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      <button onClick={() => setExpanded(v => { writeExpanded(!v); return !v })}
        className="w-full flex items-center justify-between px-4 py-3 text-right">
        <span className="font-semibold text-gray-800">
          משימות מההנהלה {open.length > 0 && <span className="text-sm font-normal text-gray-500">({open.length} פתוחות)</span>}
        </span>
        <span className="text-gray-400 text-sm">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="border-t">
          {loading && <p className="p-4 text-sm text-gray-500">טוען...</p>}
          {error && <p className="p-4 text-sm text-red-600">{error}</p>}
          {!loading && !error && open.length === 0 && (
            <p className="p-4 text-sm text-gray-500">אין משימות פתוחות מההנהלה 🎉</p>
          )}
          <ul className="divide-y">{open.map(row)}</ul>
          {done.length > 0 && (
            <div className="border-t">
              <button onClick={() => setShowDone(v => !v)} className="w-full text-right px-4 py-2 text-xs text-gray-500 hover:bg-gray-50">
                {showDone ? 'הסתר' : 'הצג'} בוצעו ({done.length})
              </button>
              {showDone && <ul className="divide-y">{done.map(row)}</ul>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
