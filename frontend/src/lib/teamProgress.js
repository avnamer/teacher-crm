import { buildProgress } from './schoolProgress.js'
import { teamsInSchool, studentCount } from './teams.js'

// Progress per competition team ("נבחרת") of one school, from school_team_progress.
// The LMS numbers its teams 1..n inside a school and gives only the teacher's first name (sometimes the last
// name), so each LMS team is matched to a CRM teacher of that school by name. Denominators follow the same rule as
// the school view — the CRM headcount — and fall back to the LMS "registered" count when the CRM has none.

const plain = s => String(s || '').replace(/['’‘׳`"״”“]/g, '').trim()

/** The single teacher of the school whose first name (else any part of the name) is `name`, or null. */
export function matchTeacher(name, teachers) {
  const wanted = plain(name)
  if (!wanted) return null
  const parts = t => plain(t.name).split(/\s+/)
  const first = teachers.filter(t => parts(t)[0] === wanted)
  if (first.length) return first.length === 1 ? first[0] : null
  const any = teachers.filter(t => parts(t).includes(wanted))
  return any.length === 1 ? any[0] : null
}

/**
 * CRM students for each of a teacher's LMS teams (ascending team numbers). The CRM doesn't number its teams, so
 * when both sides have the same number of teams they are paired by order; one LMS team gets all of the teacher's
 * students. null = no reliable CRM number.
 */
export function crmStudentsPerTeam(crmCounts, lmsTeamCount) {
  if (lmsTeamCount === 1) {
    const sum = crmCounts.reduce((a, b) => a + b, 0)
    return [sum > 0 ? sum : null]
  }
  if (crmCounts.length === lmsTeamCount) return crmCounts.map(n => (n > 0 ? n : null))
  return Array(lmsTeamCount).fill(null)
}

/** Adds up rows of several teams into one series per (snapshot, role, course, unit). */
function sumRows(rows) {
  const out = new Map()
  for (const r of rows) {
    const k = [r.as_of, r.role, r.challenge, r.unit].join('|')
    const sum = out.get(k)
    if (sum) { sum.entered += r.entered; sum.registered += r.registered }
    else out.set(k, { ...r })
  }
  return [...out.values()]
}

const maxRegistered = (rows, role) => rows.reduce((n, r) => (r.role === role ? Math.max(n, r.registered) : n), 0)

/**
 * `rows` = every snapshot of the school's team rows; `teachers` = the school's CRM teachers.
 * Returns { asOf, teams, multiTeamTeachers }.
 *   team: { number, teacherName, teacher, label, crmStudents, lmsStudents, totals, hasTeacherRows, progress }
 *   multiTeamTeachers: [{ label, numbers, totals, progress }] — the teams of one teacher added together.
 * Ticks only come from earlier by-team syncs. Teams are followed by their LMS number.
 */
export function buildTeams(rows, teachers, school) {
  const asOf = rows.map(r => r.as_of).sort().pop() || null
  const latest = rows.filter(r => r.as_of === asOf)
  const numbers = [...new Set(latest.map(r => r.team))].sort((a, b) => a - b)

  const teams = numbers.map(number => {
    const current = latest.filter(r => r.team === number)
    const teacherName = current.find(r => r.teacher_name)?.teacher_name || ''
    const teacher = matchTeacher(teacherName, teachers)
    return {
      number,
      teacherName,
      teacher,
      owner: teacher ? `id:${teacher.id}` : teacherName ? `name:${plain(teacherName)}` : `team:${number}`,
      label: teacher?.name || teacherName || 'מורה לא ידוע',
      rows: rows.filter(r => r.team === number),
      lmsStudents: maxRegistered(current, 'students'),
      teacherCount: maxRegistered(current, 'teachers'),
    }
  })

  const byOwner = new Map()
  for (const t of teams) byOwner.set(t.owner, [...(byOwner.get(t.owner) || []), t])

  for (const own of byOwner.values()) {
    const crmCounts = own[0].teacher ? teamsInSchool(own[0].teacher, school).map(studentCount) : []
    const crm = crmStudentsPerTeam(crmCounts, own.length)
    const crmTotal = crmCounts.reduce((a, b) => a + b, 0)
    own.forEach((t, i) => {
      t.crmTeacherTotal = crmTotal
      t.crmStudents = crm[i]
      t.totals = { students: crm[i] ?? t.lmsStudents, teachers: t.teacherCount }
      t.hasTeacherRows = t.teacherCount > 0
      t.progress = buildProgress(t.rows, t.totals)
    })
  }

  const multiTeamTeachers = [...byOwner.values()].filter(own => own.length > 1).map(own => {
    const totals = {
      // The CRM headcount wins whenever it exists, even if it couldn't be split between the teams.
      students: own[0].crmTeacherTotal || own.reduce((n, t) => n + t.totals.students, 0),
      teachers: own.reduce((n, t) => n + t.totals.teachers, 0),
    }
    return {
      owner: own[0].owner,
      label: own[0].label,
      numbers: own.map(t => t.number),
      totals,
      progress: buildProgress(sumRows(own.flatMap(t => t.rows)), totals),
    }
  })

  return { asOf, teams, multiTeamTeachers }
}

/** The challenge courses (newest first) that appear in any team. */
export function teamChallengeNames(teams) {
  const found = new Map()
  for (const t of teams) {
    for (const c of t.progress.challenges) if (c.number >= 0) found.set(c.name, c.number)
  }
  return [...found].sort((a, b) => b[1] - a[1]).map(([name]) => name)
}
