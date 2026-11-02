import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabase.js'

// "משימה חדשה" marker for tasks that arrived by themselves (WhatsApp sync, voice logs).
// Per panel we keep one "seen up to" timestamp: tasks created after it are new, and the
// first time the panel is expanded they are highlighted and the timestamp moves past them.
// The timestamp lives in management_settings.new_tasks_seen ({ scope: ISO }) so phone and PC
// agree; localStorage is the fallback when that column doesn't exist yet (migration not run)
// or the request fails. First ever load sets it to "now", so old tasks don't light up.

const LOCAL_KEY = 'newTasksSeenUpTo'

const later = (a, b) => (new Date(a) > new Date(b) ? a : b)

function readLocal(scope) {
  try { return localStorage.getItem(`${LOCAL_KEY}:${scope}`) } catch { return null }
}

function writeLocal(scope, ts) {
  try { localStorage.setItem(`${LOCAL_KEY}:${scope}`, ts) } catch { /* blocked — fallback just won't persist */ }
}

async function readRemote(scope) {
  const { data, error } = await supabase.from('management_settings').select('new_tasks_seen').eq('id', 'global').maybeSingle()
  if (error) throw error
  return data?.new_tasks_seen?.[scope] || null
}

async function writeRemote(scope, ts) {
  // read-modify-write so the other panel's timestamp isn't overwritten
  const { data, error } = await supabase.from('management_settings').select('new_tasks_seen').eq('id', 'global').maybeSingle()
  if (error) throw error
  const next = { ...(data?.new_tasks_seen || {}), [scope]: ts }
  const { error: upErr } = await supabase.from('management_settings').update({ new_tasks_seen: next }).eq('id', 'global')
  if (upErr) throw upErr
}

async function persist(scope, ts) {
  writeLocal(scope, ts)
  try { await writeRemote(scope, ts) } catch (err) { console.warn('new-tasks marker not saved to DB:', err.message) }
}

async function loadSeenUpTo(scope) {
  let remote = null
  try { remote = await readRemote(scope) } catch { /* column missing / offline — use local */ }
  const stored = remote || readLocal(scope)
  if (stored) {
    writeLocal(scope, stored)
    return stored
  }
  const now = new Date().toISOString()
  await persist(scope, now)
  return now
}

/**
 * scope: 'management' | 'admin'. candidates: [{ key, created_at }] — only tasks that can be
 * "new" (arrived via sync/voice, still open). Returns:
 *  - highlighted: Set of keys to mark "משימה חדשה" while the panel is open
 *  - badgeCount: new tasks to announce in the header (unseen while collapsed, highlighted while open)
 */
export function useNewTaskMarks(scope, expanded, candidates) {
  const [seenUpTo, setSeenUpTo] = useState(null) // null until loaded
  const [highlighted, setHighlighted] = useState(() => new Set())

  useEffect(() => {
    let cancelled = false
    loadSeenUpTo(scope).then(ts => { if (!cancelled) setSeenUpTo(ts) })
    return () => { cancelled = true }
  }, [scope])

  const unseen = useMemo(
    () => (seenUpTo ? candidates.filter(c => new Date(c.created_at) > new Date(seenUpTo)) : []),
    [candidates, seenUpTo],
  )

  useEffect(() => {
    if (!expanded) {
      setHighlighted(prev => (prev.size ? new Set() : prev))
      return
    }
    if (unseen.length === 0) return
    setHighlighted(prev => new Set([...prev, ...unseen.map(c => c.key)]))
    const upTo = unseen.map(c => c.created_at).reduce(later)
    setSeenUpTo(upTo)
    persist(scope, upTo)
  }, [expanded, unseen, scope])

  return { highlighted, badgeCount: expanded ? highlighted.size : unseen.length }
}
