import { supabase } from './supabase.js'

// Progress of a school's teachers and students in the 3D-center challenges. One-way: the CSV from
// the center is imported by scripts/import-school-progress.mjs into school_challenge_progress; the
// app only reads it (RLS is select-only). Percentages are NOT the CSV's — they are computed against
// the school's real headcount: students = sum of students in the school's teams (lib/teams.js),
// teachers = the school's teachers in the CRM. "Registered" in the CSV is not used as denominator.

export const PASS_RATIO = 0.33 // a unit/challenge counts as "passed" when this share of the school entered

const isMissingTable = error => error?.code === '42P01' || error?.code === 'PGRST205'

export async function loadSchoolProgress(school) {
  const { data, error } = await supabase
    .from('school_challenge_progress').select('*').eq('school', school)
    .order('as_of', { ascending: false }).order('position', { ascending: true }) // newest first: the row cap cuts old syncs
  if (error) {
    if (isMissingTable(error)) throw new Error('טבלת school_challenge_progress עדיין לא קיימת — הרץ את בלוק ה-SQL האחרון מ-supabase-setup.sql')
    throw error
  }
  return data || []
}

const PAGE = 1000 // Supabase returns at most this many rows per request; a school has hundreds of team rows per sync

/** Every sync of the school's per-team rows. [] until the table exists or a by-team file was imported. */
export async function loadTeamProgress(school) {
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('school_team_progress').select('*').eq('school', school)
      .order('as_of', { ascending: false }).order('team').order('role').order('position').order('challenge').order('unit')
      .range(from, from + PAGE - 1)
    if (error) {
      if (isMissingTable(error)) return []
      throw error
    }
    all.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  // buildProgress lists courses and units in row order.
  return all.sort((a, b) => a.position - b.position)
}

const challengeNumber = name => {
  const m = /אתגר\s*0*(\d+)/.exec(name)
  return m ? Number(m[1]) : -1
}

export function percentOf(entered, total) {
  return total > 0 ? Math.round((entered / total) * 1000) / 10 : null
}

export const MAX_PREVIOUS_SNAPSHOTS = 4 // how many earlier syncs are drawn as ticks on each bar

/**
 * Groups rows into challenges (newest first), each with its summary row and units.
 * `rows` holds ALL imported snapshots (one per as_of); the newest is "current" and the others are history.
 * `totals` = { students, teachers } — the denominators (same for every snapshot, so ticks are comparable).
 * Returns { asOf, challenges: [{ name, number, students, teachers }] } where each of students/teachers is
 * { summary, units } of { label, entered, percent, passed, previous }.
 * `previous` = ticks for earlier syncs, newest first: [{ asOf, entered, percent, rank }]. Ticks whose value equals the
 * current one are dropped, and equal values from several syncs collapse into one (labelled with the newest date).
 * rank 0 = the sync right before the current one; larger = older (drawn lighter).
 */
export function buildProgress(rows, totals) {
  const snapshots = [...new Set(rows.map(r => r.as_of).filter(Boolean))].sort().reverse()
  const asOf = snapshots[0] || null
  const earlier = snapshots.slice(1, 1 + MAX_PREVIOUS_SNAPSHOTS)
  const rankOf = new Map(earlier.map((d, i) => [d, i]))

  const history = new Map() // `${role}|${challenge}|${unit}` -> [{ asOf, entered }] (newest first)
  for (const r of rows) {
    if (!rankOf.has(r.as_of)) continue
    const k = `${r.role}|${r.challenge}|${r.unit}`
    if (!history.has(k)) history.set(k, [])
    history.get(k).push({ asOf: r.as_of, entered: r.entered, rank: rankOf.get(r.as_of) })
  }

  const byChallenge = new Map()
  for (const r of rows) {
    if (r.as_of !== asOf) continue
    if (!byChallenge.has(r.challenge)) byChallenge.set(r.challenge, { name: r.challenge, number: challengeNumber(r.challenge), students: null, teachers: null })
    const c = byChallenge.get(r.challenge)
    const total = totals[r.role]
    const percent = percentOf(r.entered, total)
    const seen = new Set([r.entered])
    const previous = (history.get(`${r.role}|${r.challenge}|${r.unit}`) || [])
      .sort((a, b) => a.rank - b.rank)
      .filter(h => !seen.has(h.entered) && seen.add(h.entered))
      .map(h => ({ ...h, percent: percentOf(h.entered, total) }))
    const item = { label: r.unit, entered: r.entered, percent, passed: percent !== null && r.entered / total >= PASS_RATIO, previous }
    c[r.role] ??= { summary: null, units: [] }
    if (r.unit === r.challenge) c[r.role].summary = item
    else c[r.role].units.push(item)
  }
  const challenges = [...byChallenge.values()].sort((a, b) => b.number - a.number)
  return { asOf, challenges }
}
