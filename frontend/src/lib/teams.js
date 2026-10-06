// A teacher's competition teams ("נבחרות") and which school each one belongs to.
//
// Stored on the teacher's own contact row — custom_fields.teams, an array of up to
// MAX_TEAMS { grades, students, school?, schedule?, prep? } — and edited only on the teacher's page
// (components/TeamsCard.jsx). The Schools page reads it from there; nothing is copied.
//
// A team's school: most teachers teach in one school, so a team normally has no school
// of its own and belongs to the teacher's primary school (contacts.school). Only when
// custom_fields.teaches_other_school is set does a team's own `school` count — a teacher
// who teaches in two schools stays one contact, and each of her teams is tagged with the
// school it plays for. Teachers without `teams` at all simply have no teams.

export const MAX_TEAMS = 3

// The grades a team can be marked with. A team can combine several (a mixed-age
// class), so `grades` is an array — toggle buttons on the teacher page, no free text.
export const GRADES = ["ז'", "ח'", "ט'"]

// School order of the grades, so a mixed class always reads "ז'+ח'", never "ח'+ז'".
const GRADE_ORDER = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ז'", "ח'", "ט'", "י'", 'י"א', 'י"ב']

function gradeRank(grade) {
  const i = GRADE_ORDER.indexOf(grade)
  return i === -1 ? GRADE_ORDER.length : i
}

export function sortGrades(grades) {
  return [...grades].sort((a, b) => gradeRank(a) - gradeRank(b) || a.localeCompare(b, 'he'))
}

/** The teacher's teams, always an array (older contacts have no `teams` field). */
export function teamsOf(contact) {
  const teams = contact?.custom_fields?.teams
  return Array.isArray(teams) ? teams.filter(t => t && typeof t === 'object') : []
}

export function teachesOtherSchool(contact) {
  return contact?.custom_fields?.teaches_other_school === true
}

/** The school a team plays for — its own school if the teacher teaches in several, else her primary one. */
export function teamSchool(contact, team) {
  return (teachesOtherSchool(contact) && team?.school) || contact?.school || ''
}

/** Every school the teacher is linked to: her primary school plus her teams' schools. */
export function teacherSchools(contact) {
  const schools = new Set()
  if (contact?.school) schools.add(contact.school)
  for (const team of teamsOf(contact)) {
    const school = teamSchool(contact, team)
    if (school) schools.add(school)
  }
  return [...schools]
}

export function teamsInSchool(contact, school) {
  return teamsOf(contact).filter(team => teamSchool(contact, team) === school)
}

export function studentCount(team) {
  const n = Number(team?.students)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** The team's grades in school order. Reads the single `grade` string of the first version too. */
export function gradesOf(team) {
  const grades = Array.isArray(team?.grades) ? team.grades : team?.grade ? [team.grade] : []
  return sortGrades(new Set(grades.filter(Boolean)))
}

/** "ז' (12 תלמידים)", "ז'+ח' (14 תלמידים)" — or just the grades when no student count was entered. */
export function formatTeam(team) {
  const grade = gradesOf(team).join('+') || 'ללא שכבה'
  const n = studentCount(team)
  if (!n) return grade
  return `${grade} (${n === 1 ? 'תלמיד אחד' : `${n} תלמידים`})`
}

/** Every school name in use — teachers' primary schools and their teams' schools. */
export function allSchools(contacts) {
  const schools = new Set()
  for (const c of contacts || []) for (const s of teacherSchools(c)) schools.add(s)
  return [...schools].sort((a, b) => a.localeCompare(b, 'he'))
}

// ── Teaching days ─────────────────────────────────────────────────────────────
// team.schedule (lessons) and team.prep (preparation lessons) are the same shape: an
// object { [dayIndex]: [periods] } — dayIndex 0 = Sunday … 5 = Friday, periods are the
// hour numbers 1..MAX_PERIOD ticked for that day. A day with no periods is simply absent.

export const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי']
export const MAX_PERIOD = 8
export const PERIODS = Array.from({ length: MAX_PERIOD }, (_, i) => i + 1)

/** Normalised plan: { [dayIndex]: sorted unique periods }, empty days dropped. Tolerates missing/garbage input. */
export function planOf(plan) {
  const out = {}
  if (!plan || typeof plan !== 'object') return out
  for (const [day, periods] of Object.entries(plan)) {
    if (!(Number(day) in DAYS) || !Array.isArray(periods)) continue
    const clean = [...new Set(periods.map(Number).filter(p => Number.isInteger(p) && p >= 1 && p <= MAX_PERIOD))].sort((a, b) => a - b)
    if (clean.length) out[Number(day)] = clean
  }
  return out
}

/** "2–3" for consecutive hours, "1, 3" otherwise — "שעות 2–3", "שעה 5". */
function formatPeriods(periods) {
  const runs = []
  for (const p of periods) {
    const last = runs[runs.length - 1]
    if (last && p === last[1] + 1) last[1] = p
    else runs.push([p, p])
  }
  const text = runs.map(([a, b]) => (a === b ? `${a}` : b === a + 1 ? `${a}, ${b}` : `${a}–${b}`)).join(', ')
  return `${periods.length === 1 ? 'שעה' : 'שעות'} ${text}`
}

/** "יום ב׳: שעות 2–3 · יום ד׳: שעה 5" — '' when nothing is marked. */
export function formatPlan(plan) {
  const p = planOf(plan)
  return Object.keys(p).map(Number).sort((a, b) => a - b)
    .map(d => `יום ${DAYS[d]}: ${formatPeriods(p[d])}`).join(' · ')
}
