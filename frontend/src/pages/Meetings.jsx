import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import AddMeetingModal from '../components/AddMeetingModal.jsx'
import { isMyTeacher } from '../lib/teachers.js'
import { isCompletedMeeting, isScheduledMeeting, groupMeetingsByGroupId } from '../lib/meetings.js'

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function dateInputValue(iso) {
  return new Date(iso).toISOString().split('T')[0]
}

// 🟢 ≤1 month, 🟠 1–3 months, 🔴 >3 months or never met — a school-scale version of
// the dashboard's per-teacher contactBucket(), with month-scale thresholds appropriate
// for meetings rather than day-to-day contact.
function schoolBucket(lastMeetingAt) {
  if (!lastMeetingAt) return 'red'
  const days = daysSince(lastMeetingAt)
  if (days <= 30) return 'green'
  if (days <= 90) return 'orange'
  return 'red'
}

function groupCompletedBySchool(rows, contactsById) {
  const bySchool = {}
  for (const row of rows) {
    const contact = contactsById[row.contact_id]
    const school = contact?.school || 'ללא בית ספר'
    bySchool[school] ??= { school, rows: [], lastAt: null }
    bySchool[school].rows.push({ ...row, teacherName: contact?.name || 'לא ידוע' })
    if (!bySchool[school].lastAt || row.created_at > bySchool[school].lastAt) {
      bySchool[school].lastAt = row.created_at
    }
  }
  // Most-overdue school first — same convention this page already used for teachers.
  return Object.values(bySchool).sort((a, b) => daysSince(b.lastAt) - daysSince(a.lastAt))
}

// Content used to pre-fill an edit form for a meeting we only have as a group (the
// upcoming-meetings list, which doesn't carry per-row content) — every row in a
// group is expected to hold the same content, so the first one found is enough.
function firstRowContent(rowIds, meetings) {
  return meetings.find(m => rowIds.includes(m.id))?.content || ''
}

// ─── Inline edit form shared by both the past-meetings and upcoming-meetings lists ──
function MeetingEditForm({ initialDate, initialContent, onSave, onCancel }) {
  const [date, setDate] = useState(initialDate)
  const [content, setContent] = useState(initialContent)
  const [saving, setSaving] = useState(false)
  const isFuture = date > todayStr()

  async function handleSave() {
    if (!isFuture && !content.trim()) {
      alert('יש למלא את תוכן הפגישה')
      return
    }
    setSaving(true)
    try {
      await onSave({ date, content, isFuture })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <input
        type="date"
        value={date}
        onChange={e => setDate(e.target.value)}
        className="px-2 py-1 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-blue-400"
      />
      {isFuture && (
        <p className="text-xs text-purple-600">
          תאריך עתידי — הפגישה תסומן כמתוכננת
        </p>
      )}
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        rows={2}
        placeholder={isFuture ? 'ניתן להשאיר ריק ולהשלים אחרי הפגישה' : 'על מה דיברתם בפגישה?'}
        className="w-full px-2 py-1 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-blue-400"
      />
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'שומר...' : 'שמור'}
        </button>
        <button onClick={onCancel} disabled={saving}
          className="px-2 py-1 border rounded text-xs hover:bg-gray-100">
          ביטול
        </button>
      </div>
    </div>
  )
}

// ─── School-recency stats (mirrors Contacts.jsx's ContactStats, bucketed by school) ──
const SCHOOL_STAT_TILES = [
  { key: 'green', label: 'נפגשנו בחודש האחרון', bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', dot: 'bg-green-500' },
  { key: 'orange', label: 'נפגשנו לפני 1–3 חודשים', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', dot: 'bg-orange-400' },
  { key: 'red', label: 'לא נפגשנו מעל 3 חודשים / אין פגישה מתועדת', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', dot: 'bg-red-500' },
]

function SchoolStats({ buckets, expandedBucket, onToggleBucket }) {
  const activeTile = SCHOOL_STAT_TILES.find(t => t.key === expandedBucket)

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {SCHOOL_STAT_TILES.map(tile => (
          <button
            key={tile.key}
            type="button"
            onClick={() => onToggleBucket(tile.key)}
            className={`w-full text-right rounded-xl border p-4 transition-shadow hover:shadow-md ${tile.bg} ${tile.border} ${expandedBucket === tile.key ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2.5 h-2.5 rounded-full ${tile.dot}`} />
              <span className={`text-sm font-medium ${tile.text}`}>{tile.label}</span>
            </div>
            <div className={`text-3xl font-black ${tile.text}`}>{buckets[tile.key].length}</div>
          </button>
        ))}
      </div>

      {activeTile && (
        <div className={`rounded-xl border p-3 ${activeTile.bg} ${activeTile.border}`}>
          {buckets[activeTile.key].length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-2">—</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1">
              {buckets[activeTile.key].map(school => (
                <li key={school} className={`text-sm ${activeTile.text}`}>{school}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default function Meetings() {
  const [meetings, setMeetings] = useState([])
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddMeetingModal, setShowAddMeetingModal] = useState(false)
  const [expandedBucket, setExpandedBucket] = useState(null)
  const [openSchool, setOpenSchool] = useState(null)
  const [editingGroupId, setEditingGroupId] = useState(null)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const { data: contactsData, error: cErr } = await supabase
        .from('contacts')
        .select('id, name, school, custom_fields, role')
      if (cErr) throw cErr
      const myTeachers = (contactsData || []).filter(isMyTeacher)
      setContacts(myTeachers)

      const myTeacherIds = myTeachers.map(c => c.id)
      if (myTeacherIds.length === 0) {
        setMeetings([])
        return
      }

      const { data: meetingsData, error: mErr } = await supabase
        .from('interactions')
        .select('id, contact_id, content, metadata, created_at')
        .eq('type', 'meeting')
        .in('contact_id', myTeacherIds)
      if (mErr) throw mErr
      setMeetings(meetingsData || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // Updates every row belonging to one real-world meeting at once (content, date,
  // and — derived from the new date — whether it's scheduled or completed), then
  // reloads so the recency banner / upcoming list / past list all stay consistent
  // even when an edit moves a meeting between those sections.
  async function saveMeetingEdit(rowIds, { date, content, isFuture }) {
    const createdAt = new Date(`${date}T12:00:00`).toISOString()
    try {
      for (const rowId of rowIds) {
        const row = meetings.find(m => m.id === rowId)
        const { meeting_status, ...rest } = row?.metadata || {}
        const metadata = isFuture ? { ...rest, meeting_status: 'scheduled' } : rest
        const { error } = await supabase
          .from('interactions')
          .update({ content: content.trim() || null, created_at: createdAt, metadata })
          .eq('id', rowId)
        if (error) throw error
      }
      setEditingGroupId(null)
      await loadAll()
    } catch (err) {
      alert('שגיאה בעדכון הפגישה: ' + err.message)
    }
  }

  const contactsById = Object.fromEntries(contacts.map(c => [c.id, c]))
  const completed = meetings.filter(isCompletedMeeting)
  const now = new Date()
  const upcoming = groupMeetingsByGroupId(
    meetings.filter(row => isScheduledMeeting(row) && new Date(row.created_at) > now),
    contactsById
  ).sort((a, b) => new Date(a.date) - new Date(b.date))

  // Every meeting (any status), grouped by meeting_group_id — used only to resolve
  // "which row ids belong to this meeting" when an edit is opened, regardless of
  // which section (past or upcoming) it was opened from.
  const allGroups = groupMeetingsByGroupId(meetings, contactsById)
  const groupById = Object.fromEntries(allGroups.map(g => [g.groupId, g]))

  const bySchool = groupCompletedBySchool(completed, contactsById)
  const lastAtBySchool = Object.fromEntries(bySchool.map(g => [g.school, g.lastAt]))
  const allSchools = [...new Set(contacts.map(c => c.school).filter(Boolean))]
  const buckets = { green: [], orange: [], red: [] }
  for (const school of allSchools) {
    buckets[schoolBucket(lastAtBySchool[school])].push(school)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">פגישות</h1>
        <button
          onClick={() => setShowAddMeetingModal(true)}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 transition-colors"
        >
          🤝 הוסף פגישה
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">טוען...</div>
      ) : (
        <>
          <SchoolStats
            buckets={buckets}
            expandedBucket={expandedBucket}
            onToggleBucket={key => setExpandedBucket(prev => (prev === key ? null : key))}
          />

          {upcoming.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-gray-800">פגישות עתידיות</h2>
              {upcoming.map(g => (
                <div key={g.groupId} className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-3">
                  {editingGroupId === g.groupId ? (
                    <MeetingEditForm
                      initialDate={dateInputValue(g.date)}
                      initialContent={firstRowContent(g.rowIds, meetings)}
                      onSave={vals => saveMeetingEdit(g.rowIds, vals)}
                      onCancel={() => setEditingGroupId(null)}
                    />
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-gray-800">{g.contactNames.join(', ')}</span>
                        {g.schools.length > 0 && (
                          <span className="text-xs text-gray-500 mr-2">{g.schools.join(', ')}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-purple-700">
                          {new Date(g.date).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                        </span>
                        <button onClick={() => setEditingGroupId(g.groupId)}
                          className="text-xs text-gray-400 hover:text-blue-600" title="ערוך">
                          ✏️
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {bySchool.length === 0 ? (
              <p className="text-gray-500 text-center py-8">אין פגישות שתועדו</p>
            ) : (
              bySchool.map(group => {
                const days = daysSince(group.lastAt)
                const color = schoolBucket(group.lastAt)
                const isOpen = openSchool === group.school
                const sortedRows = [...group.rows].sort(
                  (a, b) => new Date(b.created_at) - new Date(a.created_at)
                )

                const borderClass =
                  color === 'red' ? 'border-red-300 bg-red-50' :
                  color === 'orange' ? 'border-orange-300 bg-orange-50' :
                  'border-green-200 bg-white'

                const dotClass =
                  color === 'red' ? 'bg-red-400' :
                  color === 'orange' ? 'bg-orange-400' :
                  'bg-green-400'

                return (
                  <div key={group.school} className={`rounded-xl border overflow-hidden ${borderClass}`}>
                    <button
                      onClick={() => setOpenSchool(isOpen ? null : group.school)}
                      className="w-full flex items-center justify-between px-4 py-3 text-right"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
                        <span className="font-medium text-gray-800">{group.school}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500">לפני {days} ימים</span>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          {group.rows.length} פגישות
                        </span>
                        <span className="text-gray-400 text-sm">{isOpen ? '▲' : '▼'}</span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t border-gray-200 divide-y divide-gray-100">
                        {sortedRows.map(row => {
                          const groupId = row.metadata?.meeting_group_id || row.id
                          const rowIds = groupById[groupId]?.rowIds || [row.id]
                          return (
                            <div key={row.id} className="px-4 py-3 bg-white">
                              {editingGroupId === groupId ? (
                                <MeetingEditForm
                                  initialDate={dateInputValue(row.created_at)}
                                  initialContent={row.content || ''}
                                  onSave={vals => saveMeetingEdit(rowIds, vals)}
                                  onCancel={() => setEditingGroupId(null)}
                                />
                              ) : (
                                <>
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-blue-600">{row.teacherName}</span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-gray-400">
                                        {new Date(row.created_at).toLocaleDateString('he-IL')}
                                      </span>
                                      <button onClick={() => setEditingGroupId(groupId)}
                                        className="text-xs text-gray-400 hover:text-blue-600" title="ערוך">
                                        ✏️
                                      </button>
                                    </div>
                                  </div>
                                  {row.content && <p className="text-sm text-gray-600 mt-1">{row.content}</p>}
                                </>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </>
      )}

      {showAddMeetingModal && (
        <AddMeetingModal
          teachers={contacts}
          onClose={() => setShowAddMeetingModal(false)}
          onSaved={() => { setShowAddMeetingModal(false); loadAll() }}
        />
      )}
    </div>
  )
}
