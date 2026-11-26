import { useMemo, useState } from 'react'
import { ProgressBar, RoleColumn } from './ProgressBars.jsx'
import { buildTeams, teamChallengeNames } from '../lib/teamProgress.js'

// The per-team view of the challenge program: first the teams one under the other on the same bar (to compare
// teachers), then each team's units. `rows` = the school's school_team_progress rows (all syncs).

const ROLE_TITLE = { students: '🎓 תלמידים', teachers: '👩‍🏫 מורה' }

const challengeOf = (progress, name) => progress.challenges.find(c => c.name === name)

/** The last unit of the course that passed the 33% line. */
const furthestPassed = data => [...(data?.units || [])].reverse().find(u => u.passed)?.label

const studentsNote = team => (team.crmStudents === null
  ? `אין מספר תלמידים ב-CRM, האחוזים לפי ${team.lmsStudents} הרשומים במערכת הלמידה`
  : `${team.crmStudents} תלמידים ב-CRM (ממנו האחוזים) · ${team.lmsStudents} רשומים במערכת הלמידה`)

function CompareRow({ label, data, total, showPeak }) {
  const reached = furthestPassed(data)
  // The bar is the course's own row (the intro). Students can enter a later unit more than the intro, so also show the peak.
  const peak = Math.max(0, ...(data?.units || []).map(u => u.entered))
  return (
    <div>
      {data?.summary
        ? <ProgressBar item={{ ...data.summary, label }} total={total} />
        : <p className="text-sm text-gray-500">{label} · אין נתונים</p>}
      {data && <p className="text-xs text-gray-400">{reached ? `עברו 33% עד: ${reached}` : 'אף יחידה אחרי המבוא לא עברה 33%'}{showPeak && ` · הכי הרבה כניסות ליחידה: ${peak}`}</p>}
    </div>
  )
}

function TeamDetails({ team, role, course }) {
  const data = challengeOf(team.progress, course)?.[role]
  // Courses outside the אתגר program (lesson plans, teacher training…) show how much the teacher uses the system.
  const extras = role === 'teachers' ? team.progress.challenges.filter(c => c.number < 0 && c.teachers) : []
  return (
    <details className="border-t border-gray-200 pt-3">
      <summary className="cursor-pointer text-sm font-medium text-gray-700">
        {team.label} · נבחרת {team.number}
        {!team.teacher && <span className="font-normal text-amber-700"> · לא נמצא מורה מתאים ב-CRM</span>}
      </summary>
      <div className="mt-3 space-y-3">
        {role === 'teachers' && !team.hasTeacherRows ? (
          <p className="text-sm text-gray-500">בקובץ אין שורת מורה לנבחרת הזו. כשאותו מורה מלמד כמה נבחרות, הנתונים שלו מופיעים באחת מהן.</p>
        ) : (
          <RoleColumn title={ROLE_TITLE[role]} data={data} total={team.totals[role]}
            totalNote={role === 'students' ? studentsNote(team) : '1 = פתח את היחידה'} />
        )}
        {extras.length > 0 && (
          <details className="rounded-lg border border-gray-200 bg-white p-3">
            <summary className="cursor-pointer text-sm text-gray-700">קורסים למורה ותכנים נוספים ({extras.length})</summary>
            <div className="mt-3 space-y-4">
              {extras.map(c => <RoleColumn key={c.name} title={c.name} data={c.teachers} total={team.totals.teachers} summaryLabel="כניסה לקורס"
                totalNote={`${c.teachers.units.filter(u => u.entered > 0).length} יחידות נפתחו מתוך ${c.teachers.units.length}`} />)}
            </div>
          </details>
        )}
      </div>
    </details>
  )
}

export default function TeamProgress({ rows, teachers, school, role }) {
  const { teams, multiTeamTeachers } = useMemo(() => buildTeams(rows, teachers, school), [rows, teachers, school])
  const courses = useMemo(() => teamChallengeNames(teams), [teams])
  const [picked, setPicked] = useState('')
  const course = courses.includes(picked) ? picked : courses[0]

  const summaryPercent = team => challengeOf(team.progress, course)?.[role]?.summary?.percent ?? -1
  const compared = role === 'teachers' ? teams.filter(t => t.hasTeacherRows) : teams
  const ranked = [...compared].sort((a, b) => summaryPercent(b) - summaryPercent(a))

  return (
    <div className="space-y-4">
      {courses.length > 1 && (
        <select value={course} onChange={e => setPicked(e.target.value)}
          className="w-full sm:w-96 px-3 py-2 border rounded-lg bg-white text-sm outline-none focus:ring-2 focus:ring-blue-500">
          {courses.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-gray-800">השוואה בין נבחרות: נכנסו לאתגר (יחידת המבוא)</h4>
        {ranked.map(t => (
          <CompareRow key={t.number} label={`${t.label} · נבחרת ${t.number}`}
            data={challengeOf(t.progress, course)?.[role]} total={t.totals[role]} showPeak={role === 'students'} />
        ))}
      </div>
      {role === 'students' && multiTeamTeachers.length > 0 && (
        <div className="space-y-3 border-t border-gray-200 pt-3">
          <h4 className="text-sm font-semibold text-gray-800">סיכום למורה עם כמה נבחרות</h4>
          {multiTeamTeachers.map(m => (
            <CompareRow key={m.owner} label={`${m.label} · נבחרות ${m.numbers.join(', ')}`}
              data={challengeOf(m.progress, course)?.students} total={m.totals.students} showPeak />
          ))}
        </div>
      )}
      {teams.map(t => <TeamDetails key={t.number} team={t} role={role} course={course} />)}
      <p className="text-xs text-gray-400">מספר הנבחרת ושם המורה מגיעים ממערכת הלמידה. אצל מורה עם כמה נבחרות, מספרי התלמידים מה-CRM מותאמים לפי הסדר.</p>
    </div>
  )
}
