import { useState, useEffect, useMemo } from 'react'

// "משימה חדשה" marker for tasks that arrived by themselves (WhatsApp sync, voice logs).
// A task is new until the panel showing it is first expanded; that view marks it seen.
// Kept per browser in localStorage — no schema change. Tasks created before this device
// first ran the code (the baseline) are never flagged, so existing tasks don't light up.

const BASELINE_KEY = 'newTasksBaseline'
const SEEN_KEY = 'newTasksSeen'
const MAX_SEEN = 1000

function readStorage(key) {
  try { return localStorage.getItem(key) } catch { return null }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, value) } catch { /* private mode / blocked — marker just won't persist */ }
}

function loadBaseline() {
  const stored = readStorage(BASELINE_KEY)
  if (stored) return stored
  const now = new Date().toISOString()
  writeStorage(BASELINE_KEY, now)
  return now
}

function loadSeen(scope) {
  try {
    const parsed = JSON.parse(readStorage(`${SEEN_KEY}:${scope}`) || '[]')
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

function saveSeen(scope, seen) {
  writeStorage(`${SEEN_KEY}:${scope}`, JSON.stringify([...seen].slice(-MAX_SEEN)))
}

/**
 * scope: storage namespace per panel. candidates: [{ key, created_at }] — only the tasks that
 * can be "new" (arrived via sync/voice, still open). Returns:
 *  - highlighted: Set of keys to mark "משימה חדשה" in the open panel
 *  - badgeCount: new tasks to announce in the header (unseen while collapsed, highlighted while open)
 */
export function useNewTaskMarks(scope, expanded, candidates) {
  const [baseline] = useState(loadBaseline)
  const [seen, setSeen] = useState(() => loadSeen(scope))
  const [highlighted, setHighlighted] = useState(() => new Set())

  const unseen = useMemo(
    () => candidates.filter(c => c.created_at > baseline && !seen.has(c.key)).map(c => c.key),
    [candidates, baseline, seen],
  )

  useEffect(() => {
    if (!expanded) {
      setHighlighted(prev => (prev.size ? new Set() : prev))
      return
    }
    if (unseen.length === 0) return
    setHighlighted(prev => new Set([...prev, ...unseen]))
    const next = new Set([...seen, ...unseen])
    setSeen(next)
    saveSeen(scope, next)
  }, [expanded, unseen, seen, scope])

  return { highlighted, badgeCount: expanded ? highlighted.size : unseen.length }
}
