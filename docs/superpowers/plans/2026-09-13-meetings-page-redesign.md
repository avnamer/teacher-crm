# Meetings Page Redesign + Scheduled Meetings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Meetings page around the same `interactions`/`type='meeting'` data the rest of the app already uses, and add the ability to schedule a future meeting with a dashboard prompt once its date has passed.

**Architecture:** `AddMeetingModal` moves out of `Contacts.jsx` into a shared component so both the dashboard and the Meetings page use the exact same "add meeting" flow, extended to accept future dates. A new `lib/meetings.js` module holds the scheduling-state predicates and the group-by-meeting helper shared between the dashboard's new "needs an update" banner and the rewritten Meetings page. No database schema change — scheduling state lives in the existing `interactions.metadata` jsonb column.

**Tech Stack:** React (Vite), Supabase JS client, Tailwind classes (no CSS files) — matches the rest of the frontend.

**No automated test framework exists in this repo** (confirmed: no `.test.`/`.spec.` files, no test script in `package.json`, no vitest/jest config). Every "verify" step in this plan is a concrete manual check performed with the app running locally (`run-teacher-crm` skill) and driven through a browser — the same verification method used throughout this project's history. Steps give exact URLs, exact actions, and exact expected results; there is nothing vague to interpret.

**Reference spec:** `docs/superpowers/specs/2026-09-13-meetings-page-redesign-design.md`

---

## Before you start

Run the app locally with the `run-teacher-crm` skill (or manually: `npm run dev` in both `frontend/` and `backend/`, per that skill's instructions) and keep it running for every verification step below. This plan assumes you're working in a dedicated git worktree on branch `feature/meetings-page` (already created) — do not switch branches in the shared checkout at `C:\Users\Avner\teacher-crm`, per that repo's `CLAUDE.md`.

Every commit in this plan stages **specific files only** — never `git add -A` — per the same `CLAUDE.md`.

---

### Task 1: Extract `AddMeetingModal` into a shared component (pure refactor)

**Files:**
- Create: `frontend/src/components/AddMeetingModal.jsx`
- Modify: `frontend/src/pages/Contacts.jsx`

No behavior change in this task — just moving code so both pages can use it. Behavior changes come in Task 2.

- [ ] **Step 1: Create the new component file with the exact code currently in `Contacts.jsx`**

Create `frontend/src/components/AddMeetingModal.jsx`:

```jsx
import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function AddMeetingModal({ teachers, onClose, onSaved }) {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  function toggleTeacher(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds(selectedIds.size === teachers.length ? new Set() : new Set(teachers.map(t => t.id)))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (selectedIds.size === 0) {
      alert('יש לבחור לפחות מורה אחד')
      return
    }
    if (!content.trim()) {
      alert('יש למלא את תוכן הפגישה')
      return
    }
    setSaving(true)
    try {
      const selected = teachers.filter(t => selectedIds.has(t.id))
      const createdAt = new Date(`${date}T12:00:00`).toISOString()
      const rows = selected.map(t => ({
        contact_id: t.id,
        type: 'meeting',
        content: content.trim(),
        created_at: createdAt,
        metadata: { attendees: selected.filter(o => o.id !== t.id).map(o => o.name) },
      }))
      const { error } = await supabase.from('interactions').insert(rows)
      if (error) throw error
      onSaved()
    } catch (err) {
      alert('שגיאה בשמירת הפגישה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">הוסף פגישה</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-sm text-gray-500 mb-1 block">תאריך הפגישה</label>
            <input
              type="date"
              required
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-gray-500">מורים שהשתתפו *</label>
              <button type="button" onClick={toggleSelectAll} className="text-xs text-blue-600 hover:underline">
                {selectedIds.size === teachers.length ? 'נקה הכל' : 'בחר הכל'}
              </button>
            </div>
            <div className="border rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-100">
              {teachers.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">אין מורים</p>
              ) : (
                teachers.map(t => (
                  <label key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(t.id)}
                      onChange={() => toggleTeacher(t.id)}
                      className="w-4 h-4"
                    />
                    {t.name}
                  </label>
                ))
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">{selectedIds.size} נבחרו</p>
          </div>

          <div>
            <label className="text-sm text-gray-500 mb-1 block">תוכן הפגישה *</label>
            <textarea
              required
              rows={4}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="על מה דיברתם בפגישה?"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'שומר...' : 'שמור'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Remove the old definition from `Contacts.jsx` and import the new one**

In `frontend/src/pages/Contacts.jsx`, find the line `function AddMeetingModal({ teachers, onClose, onSaved }) {` (around line 1399) and delete the entire function through its closing `}` on its own line — the very next line after it is `function AddContactModal({ onClose, onSaved }) {` (around line 1520), which stays untouched.

Add the import near the top of the file, alongside the other relative imports:

```jsx
import AddMeetingModal from '../components/AddMeetingModal.jsx'
```

(Place it next to `import PendingApprovalAccordion from '../components/PendingApprovalAccordion.jsx'` — same directory, same style.)

- [ ] **Step 3: Manually verify the dashboard's "Add Meeting" button still works identically**

With the app running:
1. Open `http://localhost:5173/contacts`.
2. Click "🤝 הוסף פגישה".
3. Confirm the modal opens with a date field (defaulted to today), a teacher checklist, and a required content textarea — visually identical to before.
4. Pick today's date, check one teacher, type "בדיקת ריפקטור" in the content field, click "שמור".
5. Confirm the modal closes and the dashboard's "יומן קשר אחרון" column for that teacher now shows `🤝 (היום) בדיקת ריפקטור`.
6. Open that teacher's contact detail page and confirm the meeting appears in their interaction history with the 🤝 icon.

If all six checks pass, the refactor introduced no behavior change.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AddMeetingModal.jsx frontend/src/pages/Contacts.jsx
git commit -m "$(cat <<'EOF'
Extract AddMeetingModal into a shared component

No behavior change — moves the modal out of Contacts.jsx so the
upcoming Meetings page rebuild can reuse the exact same "add
meeting" flow instead of duplicating it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add future-date scheduling to `AddMeetingModal`

**Files:**
- Modify: `frontend/src/components/AddMeetingModal.jsx`

- [ ] **Step 1: Replace the component with the scheduling-aware version**

Replace the full contents of `frontend/src/components/AddMeetingModal.jsx` with:

```jsx
import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export default function AddMeetingModal({ teachers, onClose, onSaved }) {
  const [date, setDate] = useState(todayStr)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  // String comparison works here because both sides are 'YYYY-MM-DD'.
  const isFuture = date > todayStr()
  const selectedTeachers = teachers.filter(t => selectedIds.has(t.id))
  const schools = [...new Set(selectedTeachers.map(t => t.school).filter(Boolean))]

  function toggleTeacher(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds(selectedIds.size === teachers.length ? new Set() : new Set(teachers.map(t => t.id)))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (selectedIds.size === 0) {
      alert('יש לבחור לפחות מורה אחד')
      return
    }
    if (!isFuture && !content.trim()) {
      alert('יש למלא את תוכן הפגישה')
      return
    }
    setSaving(true)
    try {
      const selected = teachers.filter(t => selectedIds.has(t.id))
      const createdAt = new Date(`${date}T12:00:00`).toISOString()
      // Ties multi-attendee rows back to one real-world meeting. created_at alone
      // can't do this reliably — two unrelated meetings scheduled for the same day
      // would collide, since the time portion is always fixed at noon.
      const meetingGroupId = crypto.randomUUID()
      const rows = selected.map(t => ({
        contact_id: t.id,
        type: 'meeting',
        content: content.trim() || null,
        created_at: createdAt,
        metadata: {
          attendees: selected.filter(o => o.id !== t.id).map(o => o.name),
          meeting_group_id: meetingGroupId,
          ...(isFuture ? { meeting_status: 'scheduled' } : {}),
        },
      }))
      const { error } = await supabase.from('interactions').insert(rows)
      if (error) throw error
      onSaved()
    } catch (err) {
      alert('שגיאה בשמירת הפגישה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">הוסף פגישה</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-sm text-gray-500 mb-1 block">תאריך הפגישה</label>
            <input
              type="date"
              required
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
            {isFuture && (
              <p className="text-xs text-purple-600 mt-1">
                פגישה עתידית — ניתן להשלים את התוכן אחרי שהיא מתקיימת
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-gray-500">מורים שהשתתפו *</label>
              <button type="button" onClick={toggleSelectAll} className="text-xs text-blue-600 hover:underline">
                {selectedIds.size === teachers.length ? 'נקה הכל' : 'בחר הכל'}
              </button>
            </div>
            <div className="border rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-100">
              {teachers.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">אין מורים</p>
              ) : (
                teachers.map(t => (
                  <label key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(t.id)}
                      onChange={() => toggleTeacher(t.id)}
                      className="w-4 h-4"
                    />
                    {t.name}
                  </label>
                ))
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">{selectedIds.size} נבחרו</p>
            {schools.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {schools.length === 1 ? `בית ספר: ${schools[0]}` : `בתי ספר: ${schools.join(', ')}`}
              </p>
            )}
          </div>

          <div>
            <label className="text-sm text-gray-500 mb-1 block">
              תוכן הפגישה{isFuture ? '' : ' *'}
            </label>
            <textarea
              required={!isFuture}
              rows={4}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={isFuture ? 'ניתן להשאיר ריק ולהשלים אחרי הפגישה' : 'על מה דיברתם בפגישה?'}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'שומר...' : 'שמור'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Manually verify past-dated meetings are unaffected**

1. Open `http://localhost:5173/contacts`, click "🤝 הוסף פגישה".
2. Leave the date as today, select a teacher, leave content **empty**, click "שמור".
3. Confirm the alert "יש למלא את תוכן הפגישה" still appears (content is still required for today/past dates).
4. Fill in content, submit successfully, confirm it appears in the teacher's history exactly as in Task 1's verification.

- [ ] **Step 3: Manually verify future-dated meetings**

1. Open the modal again. Change the date to 7 days from today.
2. Confirm the purple hint text "פגישה עתידית — ניתן להשלים..." appears, and the content label no longer shows a `*`.
3. Select two teachers **from the same school** (check your data — most schools in this dataset have multiple teachers; if not, two different schools is fine for this check).
4. Confirm the line under the checklist shows "בית ספר: X" (or "בתי ספר: X, Y" if you picked two schools) matching the selected teachers' schools.
5. Leave content empty, click "שמור". Confirm it saves successfully (no alert) and the modal closes.
6. Query the database directly to confirm the row shape — run this against the Supabase SQL editor or via `curl` against the REST API with the service key (see `backend/.env` for `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`):
   ```sql
   select id, contact_id, content, metadata, created_at
   from interactions
   where type = 'meeting'
   order by created_at desc
   limit 5;
   ```
   Confirm the two new rows share the same `metadata->>'meeting_group_id'` value, both have `metadata->>'meeting_status' = 'scheduled'`, `content` is `null`, and `created_at` is 7 days out.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AddMeetingModal.jsx
git commit -m "$(cat <<'EOF'
Allow scheduling a future meeting from AddMeetingModal

A future date makes content optional and stamps
metadata.meeting_status='scheduled' instead of treating the meeting
as already having happened. Every submission (scheduled or not) now
also stamps a shared meeting_group_id so multi-attendee rows can be
reliably tied back to one real-world meeting later.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Shared meeting-state helpers + dashboard "needs an update" banner

**Files:**
- Create: `frontend/src/lib/meetings.js`
- Modify: `frontend/src/pages/Contacts.jsx`

- [ ] **Step 1: Create the shared helpers module**

Create `frontend/src/lib/meetings.js`:

```jsx
// Shared helpers for interactions/type='meeting' rows — used by both the dashboard's
// "meetings needing an update" banner and the Meetings page, so a scheduled meeting
// means exactly the same thing in both places.

/** A future meeting that hasn't been confirmed as having happened yet. */
export function isScheduledMeeting(row) {
  return row.metadata?.meeting_status === 'scheduled'
}

/** A scheduled meeting explicitly marked as not having happened. */
export function isNotHeldMeeting(row) {
  return row.metadata?.meeting_status === 'not_held'
}

/** Already happened — either logged directly, or a scheduled meeting since confirmed. */
export function isCompletedMeeting(row) {
  return !isScheduledMeeting(row) && !isNotHeldMeeting(row)
}

/**
 * Groups meeting rows created in the same AddMeetingModal submission back together.
 * `meeting_group_id` is what ties multi-attendee rows to one real-world meeting —
 * `created_at` alone can't, since two unrelated meetings scheduled the same day would
 * collide (the time portion is always fixed at noon).
 *
 * Rows with no `meeting_group_id` (interactions reclassified to `meeting` from the
 * contact detail page, rather than created via the modal) each form their own
 * single-row group — correct, since they weren't created as part of a group meeting.
 */
export function groupMeetingsByGroupId(rows, contactsById) {
  const groups = {}
  for (const row of rows) {
    const groupId = row.metadata?.meeting_group_id || row.id
    groups[groupId] ??= { groupId, date: row.created_at, rowIds: [], contactNames: [], schools: new Set() }
    groups[groupId].rowIds.push(row.id)
    const contact = contactsById[row.contact_id]
    if (contact) {
      groups[groupId].contactNames.push(contact.name)
      if (contact.school) groups[groupId].schools.add(contact.school)
    }
  }
  return Object.values(groups).map(g => ({ ...g, schools: [...g.schools] }))
}
```

- [ ] **Step 2: Add state and a loader for overdue scheduled meetings in `Contacts.jsx`**

Near the other `useState` declarations (next to `pendingVoiceLogs`/`pendingVoiceLogsExpanded`), add:

```jsx
const [scheduledMeetings, setScheduledMeetings] = useState([]) // overdue interactions/meeting rows still marked 'scheduled'
const [scheduledMeetingsExpanded, setScheduledMeetingsExpanded] = useState(false)
```

Near `loadPendingTasks` (same file), add a new function:

```jsx
// Scheduled meetings whose date has passed — the mentor needs to confirm what happened.
async function loadScheduledMeetings(contactIds) {
  if (contactIds.length === 0) return
  try {
    const { data, error } = await supabase
      .from('interactions')
      .select('id, contact_id, content, metadata, created_at')
      .eq('type', 'meeting')
      .in('contact_id', contactIds)
    if (error) throw error
    const now = new Date()
    const overdue = (data || []).filter(row =>
      row.metadata?.meeting_status === 'scheduled' && new Date(row.created_at) <= now
    )
    setScheduledMeetings(overdue)
  } catch (err) {
    console.error('Error loading scheduled meetings:', err)
  }
}
```

In `loadContacts`, change:

```jsx
      await Promise.all([loadJournalEntries(ids), loadLastContactDates(ids), loadPendingTasks(ids)])
```

to:

```jsx
      await Promise.all([loadJournalEntries(ids), loadLastContactDates(ids), loadPendingTasks(ids), loadScheduledMeetings(ids)])
```

- [ ] **Step 3: Add the banner component**

Near `PendingTasksBanner`'s definition in `Contacts.jsx`, add:

```jsx
// ─── Meetings needing an update (scheduled meetings whose date has passed) ──
function ScheduledMeetingRow({ group, onResolved }) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  async function markHeld() {
    if (!content.trim()) {
      alert('יש למלא מה קרה בפגישה')
      return
    }
    setSaving(true)
    try {
      const { data: rows, error: fetchErr } = await supabase
        .from('interactions')
        .select('id, metadata')
        .in('id', group.rowIds)
      if (fetchErr) throw fetchErr
      for (const row of rows) {
        const { meeting_status, ...rest } = row.metadata || {}
        const { error } = await supabase
          .from('interactions')
          .update({ content: content.trim(), metadata: rest })
          .eq('id', row.id)
        if (error) throw error
      }
      onResolved(group.groupId)
    } catch (err) {
      alert('שגיאה בעדכון הפגישה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function markNotHeld() {
    setSaving(true)
    try {
      const { data: rows, error: fetchErr } = await supabase
        .from('interactions')
        .select('id, metadata')
        .in('id', group.rowIds)
      if (fetchErr) throw fetchErr
      for (const row of rows) {
        const { error } = await supabase
          .from('interactions')
          .update({ metadata: { ...row.metadata, meeting_status: 'not_held' } })
          .eq('id', row.id)
        if (error) throw error
      }
      onResolved(group.groupId)
    } catch (err) {
      alert('שגיאה בעדכון הפגישה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="text-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="font-medium text-amber-800">{group.contactNames.join(', ')}</span>
          {group.schools.length > 0 && (
            <span className="text-xs text-amber-600 mr-2">{group.schools.join(', ')}</span>
          )}
          <span className="text-xs text-amber-600 mr-2">
            {new Date(group.date).toLocaleDateString('he-IL')}
          </span>
        </div>
        {!editing && (
          <div className="flex gap-2">
            <button onClick={() => setEditing(true)} disabled={saving}
              className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200 disabled:opacity-50">
              עדכן שהתקיימה
            </button>
            <button onClick={markNotHeld} disabled={saving}
              className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200 disabled:opacity-50">
              לא התקיימה
            </button>
          </div>
        )}
      </div>
      {editing && (
        <div className="mt-2 space-y-2">
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={2}
            placeholder="מה קרה בפגישה?"
            className="w-full px-2 py-1 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div className="flex gap-2">
            <button onClick={markHeld} disabled={saving}
              className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'שומר...' : 'שמור'}
            </button>
            <button onClick={() => setEditing(false)} disabled={saving}
              className="px-2 py-1 border rounded text-xs hover:bg-gray-100">
              ביטול
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function ScheduledMeetingsBanner({ rows, contacts, expanded, onToggle, onResolved }) {
  const contactsById = Object.fromEntries(contacts.map(c => [c.id, c]))
  const groups = groupMeetingsByGroupId(rows, contactsById)
  if (groups.length === 0) return null

  return (
    <div className="rounded-xl border p-4 bg-amber-50 border-amber-200">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">❗</span>
          <span className="text-sm font-medium text-amber-800">
            יש לעדכן {groups.length} פגישות שהתקיימו
          </span>
        </div>
        <button
          onClick={onToggle}
          className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors"
        >
          {expanded ? '▲ הסתר פירוט' : '▼ הצג פירוט'}
        </button>
      </div>

      {expanded && (
        <ul className="mt-3 space-y-3">
          {groups.map(g => (
            <ScheduledMeetingRow key={g.groupId} group={g} onResolved={onResolved} />
          ))}
        </ul>
      )}
    </div>
  )
}
```

Add the import at the top of `Contacts.jsx`, next to the other `lib/` imports:

```jsx
import { groupMeetingsByGroupId } from '../lib/meetings.js'
```

- [ ] **Step 4: Render the banner**

In the main render, add `<ScheduledMeetingsBanner .../>` right after `<PendingTasksBanner .../>`:

```jsx
<ScheduledMeetingsBanner
  rows={scheduledMeetings}
  contacts={contacts}
  expanded={scheduledMeetingsExpanded}
  onToggle={() => setScheduledMeetingsExpanded(v => !v)}
  onResolved={groupId => setScheduledMeetings(prev =>
    prev.filter(r => (r.metadata?.meeting_group_id || r.id) !== groupId)
  )}
/>
```

- [ ] **Step 5: Manually verify the banner**

1. Using the Supabase SQL editor (or REST API with the service key), insert a test row directly so you have a *guaranteed* overdue scheduled meeting without waiting for real time to pass:
   ```sql
   insert into interactions (contact_id, type, content, created_at, metadata)
   values (
     '<pick a real teacher id from your contacts table>',
     'meeting',
     null,
     now() - interval '2 days',
     '{"meeting_status": "scheduled", "meeting_group_id": "11111111-1111-1111-1111-111111111111", "attendees": []}'
   );
   ```
2. Open `http://localhost:5173/contacts`. Confirm a new amber banner appears reading "❗ יש לעדכן 1 פגישות שהתקיימו", positioned right after the existing "משימות פתוחות" banner.
3. Click "▼ הצג פירוט". Confirm the teacher's name, school, and the date (2 days ago) are shown, with two buttons: "עדכן שהתקיימה" and "לא התקיימה".
4. Click "עדכן שהתקיימה", type "פגישה בדיקה - התקיימה", click the inner "שמור". Confirm the row disappears from the banner and the banner's count updates (or the banner disappears entirely if it was the only item).
5. Query the database again to confirm that row's `metadata` no longer has a `meeting_status` key, and `content` is now the text you typed.
6. Repeat steps 1–3 with a fresh test row, this time clicking "לא התקיימה" instead. Confirm the row disappears from the banner, and confirm in the database that `metadata->>'meeting_status'` is now `'not_held'`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/meetings.js frontend/src/pages/Contacts.jsx
git commit -m "$(cat <<'EOF'
Add dashboard indicator for scheduled meetings needing an update

Once a scheduled meeting's date passes, an amber banner (matching
the existing pending-tasks banner style) prompts the mentor to
either fill in what happened or mark it as not held. Multi-attendee
meetings are grouped by meeting_group_id so the prompt appears once
per meeting, not once per attendee.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Rebuild the Meetings page

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

  const contactsById = Object.fromEntries(contacts.map(c => [c.id, c]))
  const completed = meetings.filter(isCompletedMeeting)
  const now = new Date()
  const upcoming = groupMeetingsByGroupId(
    meetings.filter(row => isScheduledMeeting(row) && new Date(row.created_at) > now),
    contactsById
  ).sort((a, b) => new Date(a.date) - new Date(b.date))

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
                <div key={g.groupId} className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-gray-800">{g.contactNames.join(', ')}</span>
                    {g.schools.length > 0 && (
                      <span className="text-xs text-gray-500 mr-2">{g.schools.join(', ')}</span>
                    )}
                  </div>
                  <span className="text-sm text-purple-700">
                    {new Date(g.date).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
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
                        {sortedRows.map(row => (
                          <div key={row.id} className="px-4 py-3 bg-white">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-blue-600">{row.teacherName}</span>
                              <span className="text-xs text-gray-400">
                                {new Date(row.created_at).toLocaleDateString('he-IL')}
                              </span>
                            </div>
                            {row.content && <p className="text-sm text-gray-600 mt-1">{row.content}</p>}
                          </div>
                        ))}
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

- [ ] **Step 2: Manually verify the school-recency banner**

1. Open `http://localhost:5173/meetings`.
2. Confirm three tiles render: green ("נפגשנו בחודש האחרון"), orange ("נפגשנו לפני 1–3 חודשים"), red ("לא נפגשנו מעל 3 חודשים / אין פגישה מתועדת") — same visual style as the dashboard's contact-recency tiles.
3. Click the red tile. Confirm it expands to a list of school names (not teacher names) — every school with no completed meeting logged should appear here initially, since none exist yet in a fresh dataset.
4. Log a completed meeting for a teacher via "🤝 הוסף פגישה" (today's date, real content). Reload the page. Confirm that teacher's school moved from the red tile's list into the green tile's list, and the counts on both tiles updated.

- [ ] **Step 3: Manually verify the upcoming section**

1. From the test row you inserted in Task 3 Step 5 that's still in the future (if you didn't create one, insert one now with `created_at = now() + interval '5 days'` and `meeting_status: 'scheduled'`).
2. Reload `http://localhost:5173/meetings`. Confirm a "פגישות עתידיות" heading appears above the school list, showing that teacher's name, school, and the future date spelled out (e.g. "יום שלישי, 20 בספטמבר 2026").
3. Confirm this same row does **not** also appear anywhere in the past-meetings-by-school section below.

- [ ] **Step 4: Manually verify the past-meetings-by-school section**

1. Log two completed meetings via "🤝 הוסף פגישה" for two different teachers at the **same** school, on different dates.
2. Reload the page. Confirm that school appears once in the list (not twice), with a badge reading "2 פגישות".
3. Click to expand it. Confirm both meetings are listed, most-recent first, each showing the correct teacher name, date, and content.
4. Confirm the "לא התקיימה" test row from Task 3 (if you created one) does **not** appear anywhere on this page.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Meetings.jsx
git commit -m "$(cat <<'EOF'
Rebuild Meetings page around interactions/type=meeting

Replaces the old Google-Calendar-only meetings table view with a
school-recency banner (mirroring the dashboard's contact-recency
banner), an upcoming-meetings section for scheduled-but-not-yet-held
meetings, and a past-meetings list grouped by school. Reuses the
shared AddMeetingModal so meetings logged here behave identically to
ones logged from the dashboard.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: End-to-end verification pass

**Files:** none (verification only, plus any fixes discovered)

- [ ] **Step 1: Verify the two cross-page invariants from the spec**

1. On the dashboard, log a meeting via "🤝 הוסף פגישה" with **two** attendees from the same school, today's date, real content.
2. Open each of those two teachers' own contact detail pages. Confirm the meeting appears in **both** of their individual interaction histories (not just one) — this is the "every attendee gets their own record" invariant.
3. Open `http://localhost:5173/meetings`. Confirm that same meeting now appears under their shared school's section, with **two** separate rows (one per teacher) inside it.
4. Go to one of those teachers' contact detail pages, find a different, older interaction (e.g. a `phone_call`), and use the existing type-reclassification dropdown (built in a previous session) to change its type to "פגישה". Reload the Meetings page and confirm this reclassified interaction now also appears in that teacher's school's section — this is the "any type='meeting' row surfaces here regardless of origin" invariant.

- [ ] **Step 2: Clean up test data**

Delete any SQL-inserted test rows from Task 3/Task 4 verification steps that don't represent real meetings, via the Supabase SQL editor:

```sql
delete from interactions
where type = 'meeting'
  and metadata->>'meeting_group_id' = '11111111-1111-1111-1111-111111111111';
```

(Adjust the `meeting_group_id` filter, or delete by `id`, to match whatever test rows you actually created — check first with a `select` before deleting.)

- [ ] **Step 3: Full regression pass on the dashboard**

Since `Contacts.jsx` was touched in Task 1 and Task 3, re-check unrelated dashboard features still work:
1. The existing contact-recency banner (green/orange/red by teacher) still renders and expands correctly.
2. The existing "משימות פתוחות" pending-tasks banner still renders and expands correctly.
3. Adding a new contact via "+ הוסף איש קשר" still works.
4. The task-column checkboxes in the main table still toggle correctly.

- [ ] **Step 4: Final commit (if Step 2/3 required any fixes)**

Only if verification surfaced a bug requiring a code fix — stage exactly the files touched:

```bash
git add <specific files fixed>
git commit -m "$(cat <<'EOF'
Fix issue found during meetings-page end-to-end verification

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

If nothing needed fixing, skip this step — there's nothing to commit.

---

## After this plan

This branch (`feature/meetings-page`) is ready for a PR against `main` once all tasks are checked off and verified. Per this repo's `CLAUDE.md`: merging is the user's own action (Claude Code's safety classifier blocks agents from merging PRs), and a merge to `main` is the one deploy in this whole plan that should actually cost Netlify credits — make sure everything above is verified working before asking for that merge.
