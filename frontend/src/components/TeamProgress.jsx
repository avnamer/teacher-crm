import { useMemo, useState } from 'react'
import { ProgressTrack, RoleColumn, progressText } from './ProgressBars.jsx'
import { buildTeams, teamChallengeNames } from '../lib/teamProgress.js'

// The per-team view of the challenge program: one table, a row per unit and a column per team, each cell with the
// same bar as the school view. `rows` = the school's school_team_progress rows (all syncs).

const challengeOf = (progress, name) => progress.challenges.find(c => c.name === name)

/** The rows of the table: the course itself first, then every unit any of the teams has, in course order. */
function tableRows(columns) {
  const units = new Set()
  for (const column of columns) for (const u of column.data?.units || []) units.add(u.label)
  return [
    { key: 'summary', label: 'נכנסו לאתגר', pick: data => data?.summary },
    ...[...units].map(label => ({ key: `unit:${label}`, label, pick: data => data?.units.find(u => u.label === label) })),
  ]
}

function StudentCounts({ column }) {
  const { crmStudents, lmsStudents, total } = column
  if (crmStudents === null) {
    return <span className="text-amber-700">אין מספר ב-CRM · לפי {lmsStudents} במערכת הלמידה</span>
  }
  return (
    <span>
      {total} ב-CRM{' '}
      <span className={crmStudents !== lmsStudents ? 'text-amber-700' : ''}>· {lmsStudents} במערכת הלמידה</span>
    </span>
  )
}

function Cell({ item, total }) {
  if (!item) return <span className="text-xs text-gray-300">—</span>
  return (
    <div className="pt-3 space-y-1">
      <ProgressTrack item={item} total={total} />
      <div className="text-xs text-gray-600">{progressText(item, total)}</div>
    </div>
  )
}

function UnitsTable({ columns }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full table-fixed text-sm border-collapse" style={{ minWidth: `${13 + columns.length * 11}rem` }}>
        <thead>
          <tr className="bg-gray-50 align-bottom">
            <th className="sticky right-0 z-10 bg-gray-50 w-52 p-2 text-right font-semibold text-gray-800 border-b border-gray-200">יחידה</th>
            {columns.map(c => (
              <th key={c.key} className="p-2 text-right border-b border-r border-gray-200">
                <div className="font-semibold text-gray-800">{c.title}</div>
                <div className="font-normal text-xs text-gray-600">{c.subtitle}</div>
                <div className="font-normal text-xs text-gray-500">{c.note}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows(columns).map(row => (
            <tr key={row.key} className="border-b border-gray-100 last:border-0">
              <th scope="row" className={`sticky right-0 z-10 bg-white p-2 text-right text-gray-700 ${row.key === 'summary' ? 'font-semibold' : 'font-normal'}`}>
                {row.label}
              </th>
              {columns.map(c => (
                <td key={c.key} className="px-3 py-2 align-bottom border-r border-gray-100">
                  <Cell item={row.pick(c.data)} total={c.barTotal} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Courses outside the אתגר program (lesson plans, teacher training…) show how much the teacher uses the system.
function TeacherExtras({ team }) {
  const extras = team.progress.challenges.filter(c => c.number < 0 && c.teachers)
  if (extras.length === 0) return null
  return (
    <details className="rounded-lg border border-gray-200 bg-white p-3">
      <summary className="cursor-pointer text-sm text-gray-700">
        קורסים למורה ותכנים נוספים — {team.label} · נבחרת {team.number} ({extras.length})
      </summary>
      <div className="mt-3 space-y-4">
        {extras.map(c => <RoleColumn key={c.name} title={c.name} data={c.teachers} total={team.totals.teachers} summaryLabel="כניסה לקורס"
          totalNote={`${c.teachers.units.filter(u => u.entered > 0).length} יחידות נפתחו מתוך ${c.teachers.units.length}`} />)}
      </div>
    </details>
  )
}

export default function TeamProgress({ rows, teachers, school, role }) {
  const { teams, multiTeamTeachers } = useMemo(() => buildTeams(rows, teachers, school), [rows, teachers, school])
  const courses = useMemo(() => teamChallengeNames(teams), [teams])
  const [picked, setPicked] = useState('')
  const course = courses.includes(picked) ? picked : courses[0]

  // The file has a teacher row only in one team of a teacher with several teams, so those teams get no column here.
  const shown = role === 'teachers' ? teams.filter(t => t.hasTeacherRows) : teams
  const columns = shown.map(t => ({
    key: t.number,
    title: t.label,
    subtitle: `נבחרת ${t.number}${t.teacher ? '' : ' · לא נמצא מורה מתאים ב-CRM'}`,
    note: role === 'students'
      ? <StudentCounts column={{ crmStudents: t.crmStudents, lmsStudents: t.lmsStudents, total: t.totals.students }} />
      : '1 = פתח את היחידה',
    data: challengeOf(t.progress, course)?.[role],
    barTotal: t.totals[role],
  }))
  const totalColumns = multiTeamTeachers.map(m => ({
    key: m.owner,
    title: m.label,
    subtitle: `סה״כ נבחרות ${m.numbers.join(', ')}`,
    note: `${m.totals.students} תלמידים`,
    data: challengeOf(m.progress, course)?.students,
    barTotal: m.totals.students,
  }))

  return (
    <div className="space-y-4">
      {courses.length > 1 && (
        <select value={course} onChange={e => setPicked(e.target.value)}
          className="w-full sm:w-96 px-3 py-2 border rounded-lg bg-white text-sm outline-none focus:ring-2 focus:ring-blue-500">
          {courses.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
      <UnitsTable columns={columns} />
      {role === 'students' && totalColumns.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-800">סיכום למורה עם כמה נבחרות</h4>
          <UnitsTable columns={totalColumns} />
        </div>
      )}
      {role === 'teachers' && shown.map(t => <TeacherExtras key={t.number} team={t} />)}
      <p className="text-xs text-gray-400">מספר הנבחרת ושם המורה מגיעים ממערכת הלמידה. אצל מורה עם כמה נבחרות, מספרי התלמידים מה-CRM מותאמים לפי הסדר.</p>
    </div>
  )
}
