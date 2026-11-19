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
    .from('school_challenge_progress').select('*').eq('school', school).order('position', { ascending: true })
  if (error) {
    if (isMissingTable(error)) throw new Error('טבלת school_challenge_progress עדיין לא קיימת — הרץ את בלוק ה-SQL האחרון מ-supabase-setup.sql')
    throw error
  }
  return data || []
}

const challengeNumber = name => {
  const m = /אתגר\s*0*(\d+)/.exec(name)
  return m ? Number(m[1]) : -1
}

export function percentOf(entered, total) {
  return total > 0 ? Math.round((entered / total) * 1000) / 10 : null
}

/**
 * Groups rows into challenges (newest first), each with its summary row and units.
 * `totals` = { students, teachers } — the denominators.
 * Returns { asOf, challenges: [{ name, number, students, teachers }] } where each of students/teachers is
 * { summary, units } of { label, entered, percent, passed }.
 */
export function buildProgress(rows, totals) {
  const asOf = rows.map(r => r.as_of).filter(Boolean).sort().pop() || null
  const byChallenge = new Map()
  for (const r of rows) {
    if (!byChallenge.has(r.challenge)) byChallenge.set(r.challenge, { name: r.challenge, number: challengeNumber(r.challenge), students: null, teachers: null })
    const c = byChallenge.get(r.challenge)
    const total = totals[r.role]
    const percent = percentOf(r.entered, total)
    const item = { label: r.unit, entered: r.entered, percent, passed: percent !== null && r.entered / total >= PASS_RATIO }
    c[r.role] ??= { summary: null, units: [] }
    if (r.unit === r.challenge) c[r.role].summary = item
    else c[r.role].units.push(item)
  }
  const challenges = [...byChallenge.values()].sort((a, b) => b.number - a.number)
  return { asOf, challenges }
}
