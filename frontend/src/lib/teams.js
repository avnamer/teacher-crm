// A teacher's competition teams ("נבחרות") and which school each one belongs to.
//
// Stored on the teacher's own contact row — custom_fields.teams, an array of up to
// MAX_TEAMS { grade, students, school? } — and edited only on the teacher's page
// (components/TeamsCard.jsx). The Schools page reads it from there; nothing is copied.
//
// A team's school: most teachers teach in one school, so a team normally has no school
// of its own and belongs to the teacher's primary school (contacts.school). Only when
// custom_fields.teaches_other_school is set does a team's own `school` count — a teacher
// who teaches in two schools stays one contact, and each of her teams is tagged with the
// school it plays for. Teachers without `teams` at all simply have no teams.

export const MAX_TEAMS = 3

export const DEFAULT_GRADES = ["ז'", "ח'", "ט'"]

// School order of the grades, for sorting the grade picker. A custom grade typed in by
// hand (not in this list) sorts after all of these, alphabetically.
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

/** "ז' (12 תלמידים)" — or just "ז'" when no student count was entered. */
export function formatTeam(team) {
  const grade = team?.grade || 'ללא שכבה'
  const n = studentCount(team)
  if (!n) return grade
  return `${grade} (${n === 1 ? 'תלמיד אחד' : `${n} תלמידים`})`
}

/** Grade picker options: the defaults plus any grade already used on some teacher. */
export function gradeOptions(contacts) {
  const grades = new Set(DEFAULT_GRADES)
  for (const c of contacts || []) for (const team of teamsOf(c)) if (team.grade) grades.add(team.grade)
  return sortGrades(grades)
}

/** Every school name in use — teachers' primary schools and their teams' schools. */
export function allSchools(contacts) {
  const schools = new Set()
  for (const c of contacts || []) for (const s of teacherSchools(c)) schools.add(s)
  return [...schools].sort((a, b) => a.localeCompare(b, 'he'))
}
