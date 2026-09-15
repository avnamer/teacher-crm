# Edit Meeting Attendees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the mentor add or remove tagged teachers on an existing meeting directly from the Meetings page's inline edit form.

**Architecture:** `MeetingEditForm` (in `frontend/src/pages/Meetings.jsx`) gains a teacher checkbox picker, pre-checked from the meeting's current attendees, matching the same visual pattern already used by `AddMeetingModal`'s own picker. Saving reconciles the selected teacher-id set against the group's existing `interactions` rows: teachers who stay checked get their row updated as today, newly-checked teachers get a new row inserted into the same `meeting_group_id`, and unchecked teachers have their row hard-deleted. `metadata.attendees` is recomputed on every surviving/new row from the final selected set.

**Tech Stack:** React (Vite), Supabase JS client, Tailwind classes — matches the rest of the frontend. No automated test framework exists in this repo; manual browser + database verification is the actual "test" here, same as every prior meetings-related plan in this project.

**Reference spec:** `docs/superpowers/specs/2026-09-15-edit-meeting-attendees-design.md`

---

## Before you start

You're working in a dedicated git worktree, already on branch `feature/edit-meeting-attendees` (created off `main`) at `C:\Users\Avner\teacher-crm-worktrees\edit-meeting-attendees`. This branch does NOT include the (separate, still-unmerged) voice-log-meeting-merge feature — don't assume `mergeOrCreateMeeting` or its helpers exist in `frontend/src/lib/voiceLogActions.js` on this branch; this plan's attendee-reconciliation logic is self-contained inside `Meetings.jsx` and doesn't import anything from that file.

Run the app locally to verify (see Task 1's verification step for exact instructions, including a Supabase Auth OAuth-redirect gotcha discovered in a prior session). Stage specific files only when committing — never `git add -A`, since this repo may have other Claude Code sessions working in it concurrently.

You'll need at least two teacher contacts belonging to mentor "אבנר" already in the database, plus the ability to create your own throwaway test contacts/meetings and delete them afterward.

---

### Task 1: Add attendee editing to MeetingEditForm

**Files:**
- Modify (full rewrite): `frontend/src/pages/Meetings.jsx`

- [ ] **Step 1: Replace the entire file**

Replace the full contents of `frontend/src/pages/Meetings.jsx` with:

```jsx
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import AddMeetingModal from '../components/AddMeetingModal.jsx'
import { isMyTeacher } from '../lib/teachers.js'
import { isCompletedMeeting, isScheduledMeeting, groupMeetingsByGroupId } from '../lib/meetings.js'

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function todayStr() {
  const d = new Date()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
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

// The contact ids currently tagged on a meeting group, derived from its row ids —
// used to pre-check the attendee picker regardless of which section (past or
// upcoming) the edit was opened from.
function attendeeIdsForRows(rowIds, meetings) {
  return rowIds
    .map(id => meetings.find(m => m.id === id)?.contact_id)
    .filter(Boolean)
}

// ─── Inline edit form shared by both the past-meetings and upcoming-meetings lists ──
function MeetingEditForm({ initialDate, initialContent, initialAttendeeIds, teachers, onSave, onCancel, onDelete }) {
  const [date, setDate] = useState(initialDate)
  const [content, setContent] = useState(initialContent)
  const [selectedTeacherIds, setSelectedTeacherIds] = useState(() => new Set(initialAttendeeIds))
  const [saving, setSaving] = useState(false)
  const isFuture = date > todayStr()

  function toggleTeacher(id) {
    setSelectedTeacherIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSave() {
    if (!isFuture && !content.trim()) {
      alert('יש למלא את תוכן הפגישה')
      return
    }
    if (selectedTeacherIds.size === 0) {
      alert('יש לבחור לפחות מורה אחת שהשתתפה בפגישה')
      return
    }
    setSaving(true)
    try {
      await onSave({ date, content, isFuture, teacherIds: [...selectedTeacherIds] })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm('למחוק את הפגישה לצמיתות? הפעולה תמחק את הרשומה עבור כל המשתתפים.')) return
    setSaving(true)
    try {
      await onDelete()
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
      <div>
        <p className="text-xs text-gray-500 mb-1">מורים שהשתתפו</p>
        <div className="border rounded-lg max-h-40 overflow-y-auto divide-y divide-gray-100">
          {teachers.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-2">אין מורים</p>
          ) : (
            teachers.map(t => (
              <label key={t.id} className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={selectedTeacherIds.has(t.id)}
                  onChange={() => toggleTeacher(t.id)}
                  disabled={saving}
                  className="w-3.5 h-3.5"
                />
                {t.name}
              </label>
            ))
          )}
        </div>
        <p className="text-xs text-gray-400 mt-1">{selectedTeacherIds.size} נבחרו</p>
      </div>
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'שומר...' : 'שמור'}
        </button>
        <button onClick={onCancel} disabled={saving}
          className="px-2 py-1 border rounded text-xs hover:bg-gray-100">
          ביטול
        </button>
        <button onClick={handleDelete} disabled={saving}
          className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200 disabled:opacity-50 mr-auto">
          מחק פגישה
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
  // status derived from the new date), reconciles the attendee list against the
  // group's current rows (add a row for a newly-checked teacher, hard-delete a row
  // for an unchecked one), and recomputes metadata.attendees on every surviving/new
  // row from the final selected set — then reloads so the recency banner / upcoming
  // list / past list all stay consistent.
  async function saveMeetingEdit(rowIds, { date, content, isFuture, teacherIds }) {
    const createdAt = new Date(`${date}T12:00:00`).toISOString()
    const trimmedContent = content.trim() || null
    try {
      const { data: rows, error: fetchErr } = await supabase
        .from('interactions')
        .select('id, contact_id, metadata')
        .in('id', rowIds)
      if (fetchErr) throw fetchErr

      const groupId = rows[0]?.metadata?.meeting_group_id || crypto.randomUUID()
      const rowsByContact = Object.fromEntries(rows.map(r => [r.contact_id, r]))
      const teachersById = Object.fromEntries(contacts.map(c => [c.id, c]))

      for (const contactId of teacherIds) {
        const attendees = teacherIds
          .filter(id => id !== contactId)
          .map(id => teachersById[id]?.name)
          .filter(Boolean)
        const existing = rowsByContact[contactId]
        if (existing) {
          const {
            meeting_status: _meetingStatus,
            meeting_group_id: _meetingGroupId,
            attendees: _oldAttendees,
            ...restMetadata
          } = existing.metadata || {}
          const metadata = {
            ...restMetadata,
            meeting_group_id: groupId,
            attendees,
            ...(isFuture ? { meeting_status: 'scheduled' } : {}),
          }
          const { error } = await supabase
            .from('interactions')
            .update({ content: trimmedContent, created_at: createdAt, metadata })
            .eq('id', existing.id)
          if (error) throw error
        } else {
          const metadata = {
            meeting_group_id: groupId,
            attendees,
            ...(isFuture ? { meeting_status: 'scheduled' } : {}),
          }
          const { error } = await supabase
            .from('interactions')
            .insert({ contact_id: contactId, type: 'meeting', content: trimmedContent, created_at: createdAt, metadata })
          if (error) throw error
        }
      }

      const removedRowIds = rows.filter(r => !teacherIds.includes(r.contact_id)).map(r => r.id)
      if (removedRowIds.length > 0) {
        const { error } = await supabase.from('interactions').delete().in('id', removedRowIds)
        if (error) throw error
      }

      setEditingGroupId(null)
      await loadAll()
    } catch (err) {
      alert('שגיאה בעדכון הפגישה: ' + err.message)
    }
  }

  // Deletes every row belonging to one real-world meeting at once (all attendees),
  // mirroring saveMeetingEdit's own success path.
  async function deleteMeetingGroup(rowIds) {
    try {
      const { error } = await supabase.from('interactions').delete().in('id', rowIds)
      if (error) throw error
      setEditingGroupId(null)
      await loadAll()
    } catch (err) {
      alert('שגיאה במחיקת הפגישה: ' + err.message)
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
                      initialAttendeeIds={attendeeIdsForRows(g.rowIds, meetings)}
                      teachers={contacts}
                      onSave={vals => saveMeetingEdit(g.rowIds, vals)}
                      onCancel={() => setEditingGroupId(null)}
                      onDelete={() => deleteMeetingGroup(g.rowIds)}
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
                                  initialAttendeeIds={attendeeIdsForRows(rowIds, meetings)}
                                  teachers={contacts}
                                  onSave={vals => saveMeetingEdit(rowIds, vals)}
                                  onCancel={() => setEditingGroupId(null)}
                                  onDelete={() => deleteMeetingGroup(rowIds)}
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
```

- [ ] **Step 2: Lint the file**

Run: `cd frontend && npx eslint src/pages/Meetings.jsx`
Expected: no errors. (The underscore-prefixed destructure names `_meetingStatus`/`_meetingGroupId`/`_oldAttendees` match this repo's `no-unused-vars` ignore pattern `^[A-Z_]` — already confirmed safe in a prior feature's lint check.)

- [ ] **Step 3: Manually verify in the browser + database**

**Environment setup (read this first — a prior session hit a real gotcha here):**

1. Copy the main checkout's env file into this worktree so Vite can reach Supabase: `cp /c/Users/Avner/teacher-crm/frontend/.env.local /c/Users/Avner/teacher-crm-worktrees/edit-meeting-attendees/frontend/.env.local`
2. Check what's currently running on port 5173 (`netstat -ano | grep ":5173 "` on Windows via the Bash tool, or equivalent) — if another Claude Code session's dev server is using it, do NOT kill it without asking the user first. If port 5173 is free, run the dev server from THIS worktree on port 5173 (`cd frontend && npx vite --port 5173`).
3. **Why port 5173 specifically:** this Supabase project's Auth redirect-URL allowlist only includes `http://localhost:5173` (and the production URL) — signing in via Google OAuth on any other port silently redirects to the *live production site* instead of back to your local dev server. Using a different port (e.g. 5174) will NOT work for testing the login-gated UI.
4. Open `http://localhost:5173` in a browser, sign in with Google (this requires a human — the app's only login path is real Google OAuth restricted to `avnamer@gmail.com`; don't attempt to script around it or use a service-role key to bypass Supabase's Row Level Security).
5. Once signed in, you can drive the rest of this verification either by clicking through the UI directly, or by running authenticated Supabase REST calls from the browser's own JS console/`javascript_tool` using the session already in `localStorage` (key `sb-ltfguyjrwrcghllvrixu-auth-token`) — the same technique used successfully in the prior voice-log-meeting-merge feature's verification. Either approach is fine; using the REST-call technique for setup/cleanup and the real UI for the actual save action is fastest.

**Scenario A — add a new attendee to an existing meeting:**
1. Create two temporary test teacher contacts (e.g. names ending in `__TEST__` so they're easy to find and clean up later), tagged `custom_fields.mentor_name: 'אבנר'`, `role: 'מורה מוביל/ה'`.
2. Create a single-attendee completed meeting for the first test teacher only: one `interactions` row, `type: 'meeting'`, `content` set to some test text, `created_at` today, `metadata: { meeting_group_id: <some uuid>, attendees: [] }` (no `meeting_status` key — it's completed).
3. Load the Meetings page, find this school's section, expand it, click ✏️ on this meeting. Confirm the attendee checkbox list appears with only the first test teacher checked.
4. Check the second test teacher's box too (now both checked), keep date/content as-is, click "שמור".
5. Confirm the page reloads and the meeting now appears under **both** test teachers (check both their schools' sections, or the same section if same school).
6. Query `interactions` directly: confirm there are now 2 rows sharing the same `meeting_group_id`, both with the same `content`/`created_at`, neither with a `meeting_status` key, and each row's `metadata.attendees` containing the *other* teacher's name.

**Scenario B — remove an attendee from an existing meeting:**
1. Using the same two-attendee meeting from Scenario A, open its edit form again (from either teacher's row — should resolve to the same group).
2. Uncheck the second test teacher, click "שמור".
3. Confirm the meeting now shows under only the first test teacher.
4. Query `interactions`: confirm the second teacher's row is **completely gone** (not just unlinked — an actual `DELETE`), and the first teacher's row now has `metadata.attendees: []` (recomputed, since they're now the only attendee).

**Scenario C — validation blocks removing every attendee:**
1. Open the edit form for the single-attendee meeting left over from Scenario B.
2. Uncheck the only checked teacher, click "שמור".
3. Confirm an alert appears ("יש לבחור לפחות מורה אחת שהשתתפה בפגישה") and the row is NOT deleted/changed — verify via a fresh query that the row is unchanged.

**Scenario D — works from the upcoming (scheduled) list too:**
1. Create a scheduled meeting (future date, `meeting_status: 'scheduled'`) for the first test teacher only.
2. In the "פגישות עתידיות" section, open its edit form, add the second test teacher, keep the date in the future, save.
3. Confirm both test teachers now show this meeting as upcoming, and query `interactions` to confirm the new row also has `meeting_status: 'scheduled'` and correct `attendees`.

- [ ] **Step 4: Clean up test data**

Delete every test `interactions` row and both test contacts created above, directly via Supabase, and stop any dev server processes you started for this verification.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Meetings.jsx
git commit -m "$(cat <<'EOF'
Let the mentor edit which teachers are tagged on a meeting

MeetingEditForm gains a teacher checkbox picker (matching
AddMeetingModal's own pattern), pre-checked from the meeting's current
attendees. Saving reconciles the selected set against the group's
existing rows: a newly-checked teacher gets a new row in the same
meeting_group_id, an unchecked teacher's row is hard-deleted, and
metadata.attendees is recomputed on every surviving/new row — fixing
attendee tagging that voice-recognition or manual entry got wrong at
creation time, the same way voice-log approval already lets you
correct which teacher the AI recognized.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## After this plan

Push `feature/edit-meeting-attendees` and open a PR against `main`, per this repo's own `CLAUDE.md` conventions (merging is the user's own action — Claude Code's safety classifier blocks agents from merging PRs directly).
