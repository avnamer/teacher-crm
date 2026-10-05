import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { isAdminRow, isMyTeacher, isTaskDone, loadTaskColumns, TASK_SOURCE_LABEL } from '../lib/teachers.js'
import { fetchAdminTasks, setAdminTaskDone } from '../lib/adminTasks.js'
import { interactionIcon, typeLabel } from '../lib/interactions.js'
import { allSchools, teacherSchools, teamsInSchool, studentCount, formatTeam } from '../lib/teams.js'
import {
  schoolTeachers, similarSchoolNames, openTeacherTasks, closeTeacherTask, adminTasksForSchool, TASK_SOURCE,
  loadInteractions, buildHistory, storedSummary, generateHistorySummary, historyText,
} from '../lib/schools.js'
import WhatsAppMessageList from '../components/WhatsAppMessageList.jsx'

// One school on one screen: its teachers and their teams, the dashboard tasks they
// haven't done, their open small tasks (and the admin's tasks about them), and the
// meeting history. Reads existing data only — see lib/schools.js.

const HISTORY_PAGE = 10

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''
}

async function loadBase() {
  const [contactsRes, taskColumns] = await Promise.all([
    supabase.from('contacts').select('*').order('name', { ascending: true }),
    loadTaskColumns(supabase),
  ])
  if (contactsRes.error) throw contactsRes.error
  const contacts = contactsRes.data || []
  const adminId = contacts.find(isAdminRow)?.id
  const adminTasks = await fetchAdminTasks(adminId)
  return { contacts, taskColumns, adminTasks }
}

export default function Schools() {
  const [searchParams, setSearchParams] = useSearchParams()
  const school = searchParams.get('school') || ''
  const [base, setBase] = useState(null) // { contacts, taskColumns, adminTasks }
  const [baseError, setBaseError] = useState('')
  const [showAll, setShowAll] = useState(false)
  // Interactions of the selected school's teachers, tagged with the school they were loaded for.
  const [loaded, setLoaded] = useState({ school: null, rows: [], error: '' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadBase()
      .then(data => { if (!cancelled) setBase(data) })
      .catch(err => { console.error('Error loading schools page:', err); if (!cancelled) setBaseError(err.message) })
    return () => { cancelled = true }
  }, [reloadKey])

  const contacts = useMemo(() => base?.contacts || [], [base])
  const pool = useMemo(
    () => contacts.filter(c => !isAdminRow(c) && (showAll || isMyTeacher(c))),
    [contacts, showAll]
  )
  const schools = useMemo(() => allSchools(pool), [pool])
  const similar = useMemo(() => similarSchoolNames(schools), [schools])
  const teachers = useMemo(() => (school ? schoolTeachers(pool, school) : []), [pool, school])
  const teacherIdsKey = teachers.map(t => t.id).join(',')

  useEffect(() => {
    if (!school || !teacherIdsKey) return
    let cancelled = false
    loadInteractions(teacherIdsKey.split(','))
      .then(rows => { if (!cancelled) setLoaded({ school, rows, error: '' }) })
      .catch(err => {
        console.error('Error loading school interactions:', err)
        if (!cancelled) setLoaded({ school, rows: [], error: err.message })
      })
    return () => { cancelled = true }
  }, [school, teacherIdsKey, reloadKey])

  const rowsReady = loaded.school === school
  const rows = useMemo(() => (rowsReady ? loaded.rows : []), [rowsReady, loaded])

  function pickSchool(value) {
    setSearchParams(value ? { school: value } : {})
  }

  if (baseError) return <p className="text-center py-12 text-red-600">שגיאה בטעינה: {baseError}</p>
  if (!base) return <div className="flex items-center justify-center h-64 text-gray-500">טוען...</div>

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 space-y-3">
        <h1 className="text-2xl font-bold text-gray-800">🏫 בתי ספר</h1>
        <select value={school} onChange={e => pickSchool(e.target.value)}
          className="w-full sm:w-96 px-3 py-2 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">בחר בית ספר…</option>
          {school && !schools.includes(school) && <option value={school}>{school}</option>}
          {schools.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="w-4 h-4" />
          כולל אנשי קשר שאינם המורים שלי
        </label>
        {similar.length > 0 && (
          <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="font-medium">ייתכן שאותו בית ספר כתוב בכמה צורות — כדאי לאחד את הכתיב בכרטיסי המורים:</p>
            <ul className="list-disc pr-5 mt-1">
              {similar.map(names => <li key={names.join('|')}>{names.join(' / ')}</li>)}
            </ul>
          </div>
        )}
      </div>

      {!school ? (
        <p className="text-center text-gray-500 py-8">בחר בית ספר מהרשימה כדי לראות את המורים, המשימות והפגישות שלו.</p>
      ) : teachers.length === 0 ? (
        <p className="text-center text-gray-500 py-8">לא נמצאו מורים בבית הספר הזה{showAll ? '' : ' (נסה לסמן "כולל אנשי קשר שאינם המורים שלי")'}.</p>
      ) : (
        <>
          <TeachersSection school={school} teachers={teachers} />
          <MainTasksSection teachers={teachers} taskColumns={base.taskColumns} />
          {!rowsReady ? (
            <p className="text-center text-gray-500 py-6">טוען משימות ופגישות…</p>
          ) : loaded.error ? (
            <p className="text-center text-red-600 py-6">שגיאה בטעינת היומנים: {loaded.error}</p>
          ) : (
            <>
              <SmallTasksSection
                school={school}
                teachers={teachers}
                pool={pool}
                rows={rows}
                adminTasks={base.adminTasks}
                onChanged={() => setReloadKey(k => k + 1)}
              />
              <HistorySection key={school} school={school} rows={rows} contacts={contacts} pool={pool} />
            </>
          )}
        </>
      )}
    </div>
  )
}

function Card({ title, aside, children }) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

// ─── א. Teachers ────────────────────────────────────────────────────────────

function TeachersSection({ school, teachers }) {
  const teamCount = teachers.reduce((n, t) => n + teamsInSchool(t, school).length, 0)
  const students = teachers.reduce((n, t) => n + teamsInSchool(t, school).reduce((m, team) => m + studentCount(team), 0), 0)
  return (
    <Card
      title={`👩‍🏫 מורי בית הספר (${teachers.length})`}
      aside={
        <div className="flex gap-2 text-sm">
          <span className="px-3 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">🏆 {teamCount} נבחרות</span>
          <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-800 border border-blue-200">🎓 {students} תלמידים</span>
        </div>
      }
    >
      <ul className="divide-y divide-gray-100">
        {teachers.map(t => {
          const teams = teamsInSchool(t, school)
          const otherSchools = teacherSchools(t).filter(s => s !== school)
          return (
            <li key={t.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
              <div className="flex items-center gap-2 sm:w-56 shrink-0">
                <Link to={`/contacts/${t.id}`} className="font-medium text-blue-700 hover:underline">{t.name}</Link>
              </div>
              {t.phone && (
                <a href={`tel:${t.phone}`} dir="ltr" className="text-sm text-gray-600 hover:text-blue-600 sm:w-32 shrink-0 text-right">{t.phone}</a>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                {teams.length === 0
                  ? <span className="text-xs text-gray-400">אין נבחרות</span>
                  : teams.map((team, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-xs text-amber-800">{formatTeam(team)}</span>
                  ))}
                {otherSchools.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-purple-50 border border-purple-200 text-xs text-purple-700">
                    {t.gender === 'male' ? 'מלמד' : 'מלמדת'} גם ב{otherSchools.join(', ')}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

// ─── ב. Main (dashboard) tasks not done ─────────────────────────────────────

function MainTasksSection({ teachers, taskColumns }) {
  const withOpen = teachers
    .map(t => ({ teacher: t, open: taskColumns.filter(col => !isTaskDone(t, col)) }))
    .filter(x => x.open.length > 0)
  const allDone = teachers.filter(t => !withOpen.some(x => x.teacher.id === t.id))
  return (
    <Card title="📋 משימות ראשיות שלא בוצעו">
      {taskColumns.length === 0 ? (
        <p className="text-sm text-gray-500">אין עמודות משימה בדשבורד</p>
      ) : (
        <div className="space-y-3">
          {withOpen.length === 0 && <p className="text-sm text-green-700">כל המורים השלימו את כל המשימות הראשיות 🎉</p>}
          {withOpen.map(({ teacher, open }) => (
            <div key={teacher.id} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4">
              <Link to={`/contacts/${teacher.id}`} className="font-medium text-gray-800 hover:text-blue-700 sm:w-56 shrink-0">
                {teacher.name}
              </Link>
              <div className="flex flex-wrap gap-1.5">
                {open.map(col => (
                  <span key={col.key} title={TASK_SOURCE_LABEL[col.taskSource] || ''}
                    className={`px-2 py-0.5 rounded-full text-xs border ${
                      col.taskSource === 'monday' ? 'bg-orange-50 border-orange-200 text-orange-800' : 'bg-purple-50 border-purple-200 text-purple-800'
                    }`}>
                    {col.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {allDone.length > 0 && withOpen.length > 0 && (
            <p className="text-sm text-green-700 pt-2 border-t border-gray-100">✅ הכול הושלם: {allDone.map(t => t.name).join(', ')}</p>
          )}
        </div>
      )}
    </Card>
  )
}

// ─── ג. Small open tasks ────────────────────────────────────────────────────

function SmallTasksSection({ school, teachers, pool, rows, adminTasks, onChanged }) {
  const [closing, setClosing] = useState(null) // task key being closed
  const [closedKeys, setClosedKeys] = useState(() => new Set())
  const teacherById = Object.fromEntries(teachers.map(t => [t.id, t]))

  const teacherTasks = openTeacherTasks(rows).filter(t => !closedKeys.has(t.key))
  const adminItems = adminTasksForSchool(adminTasks, { school, teachers, allTeachers: pool })
    .filter(x => !closedKeys.has(x.task.key))

  async function close(key, run) {
    if (closing) return
    setClosing(key)
    try {
      await run()
      setClosedKeys(prev => new Set(prev).add(key))
      onChanged()
    } catch (err) {
      alert('שגיאה בסגירת המשימה: ' + err.message)
    } finally {
      setClosing(null)
    }
  }

  const renderTask = ({ key, text, who, date, due, source, note, onClose }) => (
    <li key={key} className="flex items-start gap-2 p-2 rounded-lg bg-gray-50">
      <input type="checkbox" checked={false} disabled={closing !== null} onChange={onClose}
        className="w-4 h-4 mt-1 shrink-0" title="סמן כבוצע" />
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${closing === key ? 'text-gray-400' : 'text-gray-800'}`}>{text}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {who} · {formatDate(date)} · {TASK_SOURCE[source].icon} {TASK_SOURCE[source].label}
          {due && <> · 📅 יעד: {formatDate(due)}</>}
          {note && <span className="text-gray-400"> · {note}</span>}
        </p>
      </div>
    </li>
  )

  return (
    <Card title="📝 משימות קטנות פתוחות">
      <div className="grid lg:grid-cols-2 gap-4">
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">משימות של המורים ({teacherTasks.length})</h3>
          {teacherTasks.length === 0 ? <p className="text-sm text-gray-400">אין משימות פתוחות</p> : (
            <ul className="space-y-1.5">
              {teacherTasks.map(t => renderTask({
                key: t.key,
                text: t.text,
                who: t.teacherIds.map(id => teacherById[id]?.name).filter(Boolean).join(', '),
                date: t.created_at,
                due: t.due_date,
                source: t.source,
                onClose: () => close(t.key, () => closeTeacherTask(t)),
              }))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">משימות של מנהל המערכת ({adminItems.length})</h3>
          {adminItems.length === 0 ? <p className="text-sm text-gray-400">אין משימות פתוחות שקשורות לבית הספר</p> : (
            <ul className="space-y-1.5">
              {adminItems.map(({ task, teacherNames, matchedBy, source }) => renderTask({
                key: task.key,
                text: task.text,
                who: `מנהל המערכת${teacherNames.length ? ` (${teacherNames.join(', ')})` : ''}`,
                date: task.created_at,
                due: task.due_date,
                source,
                note: matchedBy === 'text' ? 'שויכה לפי הטקסט' : null,
                onClose: () => close(task.key, () => setAdminTaskDone(task, true)),
              }))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  )
}

// ─── ד. Meeting history ─────────────────────────────────────────────────────

function HistorySection({ school, rows, contacts, pool }) {
  const [visible, setVisible] = useState(HISTORY_PAGE)
  const [expanded, setExpanded] = useState(() => new Set())
  const [generated, setGenerated] = useState({}) // item key → summary | { error }
  const inFlight = useRef(new Set())

  const contactsById = useMemo(() => Object.fromEntries(contacts.map(c => [c.id, c])), [contacts])
  const contactsByName = useMemo(() => Object.fromEntries(pool.map(c => [c.name, c])), [pool])
  const items = useMemo(
    () => buildHistory(rows, { school, contactsById, contactsByName }),
    [rows, school, contactsById, contactsByName]
  )
  const shown = useMemo(() => items.slice(0, visible), [items, visible])

  // Missing short summaries of the entries on screen are generated one at a time and
  // stored on the record (lib/schools.js generateHistorySummary), so the next visit
  // reads them instead of asking the AI again.
  useEffect(() => {
    const missing = shown.filter(item => storedSummary(item) === null && !inFlight.current.has(item.key))
    if (missing.length === 0) return
    missing.forEach(item => inFlight.current.add(item.key))
    ;(async () => {
      for (const item of missing) {
        try {
          const summary = await generateHistorySummary(item)
          setGenerated(prev => ({ ...prev, [item.key]: summary }))
        } catch (err) {
          console.error('[history summary]', err)
          setGenerated(prev => ({ ...prev, [item.key]: { error: err.message } }))
        }
      }
    })()
  }, [shown])

  function toggle(key) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <Card title="🤝 היסטוריית פגישות" aside={<span className="text-sm text-gray-500">{items.length} רשומות</span>}>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">אין עדיין פגישות, שיחות או התכתבויות מתועדות</p>
      ) : (
        <>
          <ul className="space-y-2">
            {shown.map(item => {
              const [first] = item.rows
              const names = item.teacherIds.map(id => contactsById[id]?.name).filter(Boolean)
              const stored = storedSummary(item)
              const gen = generated[item.key]
              const summary = stored ?? (typeof gen === 'string' ? gen : null)
              const isOpen = expanded.has(item.key)
              return (
                <li key={item.key} className="rounded-lg bg-gray-50 overflow-hidden">
                  <button onClick={() => toggle(item.key)} className="w-full text-right p-3 hover:bg-gray-100">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                      <span className="text-lg" title={typeLabel(first.type)}>{interactionIcon(first)}</span>
                      <span className="font-medium text-gray-800">{formatDate(item.date)}</span>
                      <span className="text-gray-500">{typeLabel(first.type)}{first.type === 'whatsapp' ? ' (סיכום יום)' : ''}</span>
                      <span className="text-gray-700">· עם {names.length ? names.join(', ') : 'בית הספר'}</span>
                      <span className={`mr-auto text-xs text-gray-400 transition-transform ${isOpen ? '-rotate-90' : ''}`}>◀</span>
                    </div>
                    <p className={`text-sm text-gray-600 mt-1 whitespace-pre-wrap ${isOpen ? '' : 'line-clamp-3'}`}>
                      {summary !== null
                        ? (summary || <span className="text-gray-400">(ללא תיעוד)</span>)
                        : gen?.error
                          ? <span className="text-red-500">לא ניתן היה ליצור סיכום ({gen.error})</span>
                          : <span className="text-gray-400">⏳ מכין סיכום…</span>}
                    </p>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3 border-t border-gray-200 pt-2">
                      <p className="text-xs font-medium text-gray-500 mb-1">התוכן המלא:</p>
                      {first.type === 'whatsapp'
                        ? <WhatsAppMessageList metadata={first.metadata} />
                        : <p className="text-sm text-gray-700 whitespace-pre-wrap">{historyText(item) || 'אין תוכן כתוב'}</p>}
                      <div className="flex flex-wrap gap-3 mt-2 text-xs">
                        {item.teacherIds.map(id => contactsById[id] && (
                          <Link key={id} to={`/contacts/${id}`} className="text-blue-600 hover:underline">לכרטיס של {contactsById[id].name}</Link>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {items.length > visible && (
            <button onClick={() => setVisible(v => v + HISTORY_PAGE)}
              className="mt-3 w-full py-2 rounded-lg border border-gray-200 text-sm text-blue-700 hover:bg-gray-50">
              הצג עוד ({items.length - visible} נוספות)
            </button>
          )}
        </>
      )}
    </Card>
  )
}
