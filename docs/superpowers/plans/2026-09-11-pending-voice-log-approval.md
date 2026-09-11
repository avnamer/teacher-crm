# Pending Voice Log Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recording a voice instruction auto-saves it as a pending item (no confirmation step while traveling); the admin approves/edits/discards pending items later from an accordion at the top of the dashboard.

**Architecture:** A new Supabase table `pending_voice_logs` holds unconfirmed AI analyses. `VoiceLog.jsx` inserts into it instead of rendering a confirmation card. A new `PendingApprovalAccordion` component (mounted at the top of `Contacts.jsx`) renders one editable card per pending row, reusing extracted save/approve logic that used to live only in `VoiceLog.jsx`. Approving writes to `interactions`/`settings` exactly as the old confirm flow did, but with `created_at` forced to the original recording time; deleting just removes the pending row.

**Tech Stack:** React + Vite (frontend), Supabase JS client (direct DB access, no new backend routes needed), existing `backendFetch` helper for the untouched `/api/voice-log/analyze` and `/api/google/create-event` backend routes.

**No automated test suite exists for this project** (confirmed: `frontend/package.json` and `backend/package.json` have no test script). Every task's verification step is manual, using the `run-teacher-crm` skill to run the app locally and checking behavior in the browser + Supabase table editor, matching this project's existing testing convention.

---

### Task 1: Database migration — `pending_voice_logs` table

**Files:**
- Modify: `supabase-setup.sql` (append at end of file)

- [ ] **Step 1: Append the migration SQL**

Add this block to the end of `supabase-setup.sql`:

```sql
-- ─────────────────────────────────────────────────────────────
-- מיגרציה: טבלת פריטים ממתינים לאישור מהתיעוד הקולי (הרץ פעם אחת)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pending_voice_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mentor_name TEXT NOT NULL,
  transcript TEXT NOT NULL,
  route TEXT,
  teacher_name_spoken TEXT,
  matched_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  communication_type TEXT,
  summary TEXT,
  action_items JSONB DEFAULT '[]',
  mentioned_dates JSONB DEFAULT '[]',
  column_label TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_voice_logs_mentor_name ON pending_voice_logs(mentor_name);

ALTER TABLE pending_voice_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public full access to pending_voice_logs" ON pending_voice_logs FOR ALL USING (true) WITH CHECK (true);
```

This follows the exact pattern already used for `interactions`/`settings` in this file: no `auth` in this project, so RLS is enabled but the policy allows everything (`USING (true)`).

- [ ] **Step 2: Run the migration against the real Supabase project**

Open the Supabase SQL Editor for project ref `ltfguyjrwrcghllvrixu` (see `run-teacher-crm` skill for how to access/resume it) and run just the new block from Step 1 (the rest of `supabase-setup.sql` already exists in the live DB — do not re-run the whole file).

- [ ] **Step 3: Verify the table exists**

In the Supabase Table Editor, confirm `pending_voice_logs` appears with the columns listed above and 0 rows.

- [ ] **Step 4: Commit**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" add supabase-setup.sql
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" commit -m "$(cat <<'EOF'
Add pending_voice_logs table migration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `pendingVoiceLog.js` — CRUD helpers for the new table

**Files:**
- Create: `frontend/src/lib/pendingVoiceLog.js`

- [ ] **Step 1: Write the module**

```js
import { supabase } from './supabase.js'

export async function insertPendingVoiceLog(row) {
  const { error } = await supabase.from('pending_voice_logs').insert(row)
  if (error) throw error
}

export async function fetchPendingVoiceLogs(mentorName) {
  const { data, error } = await supabase
    .from('pending_voice_logs')
    .select('*')
    .eq('mentor_name', mentorName)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function deletePendingVoiceLog(id) {
  const { error } = await supabase.from('pending_voice_logs').delete().eq('id', id)
  if (error) throw error
}
```

- [ ] **Step 2: Manual verification**

Run `run-teacher-crm`, open the browser dev console on any page, and run:

```js
const { insertPendingVoiceLog, fetchPendingVoiceLogs, deletePendingVoiceLog } = await import('/src/lib/pendingVoiceLog.js')
await insertPendingVoiceLog({ mentor_name: 'טסט', transcript: 'בדיקה' })
const rows = await fetchPendingVoiceLogs('טסט')
console.log(rows.length === 1 && rows[0].transcript === 'בדיקה')
await deletePendingVoiceLog(rows[0].id)
console.log((await fetchPendingVoiceLogs('טסט')).length === 0)
```

Expected: both `console.log` calls print `true`.

- [ ] **Step 3: Commit**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" add frontend/src/lib/pendingVoiceLog.js
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" commit -m "$(cat <<'EOF'
Add pending_voice_logs CRUD helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `voiceLogActions.js` — extract shared constants + save/approve logic

This extracts logic that currently lives only in `frontend/src/pages/VoiceLog.jsx` (lines 12-88) so both `VoiceLog.jsx` and the new approval card can use it. Behavior is copied verbatim except `saveInteraction` is generalized to accept an explicit `createdAt` and calendar-event creation is split into its own function.

**Files:**
- Create: `frontend/src/lib/voiceLogActions.js`
- Modify: `frontend/src/pages/VoiceLog.jsx:9-88` (remove — done in Task 4, not here)

- [ ] **Step 1: Write the module**

```js
import { supabase } from './supabase.js'
import { backendFetch } from './api.js'

// Fixed pseudo-teacher row representing the mentor themself, used as the
// documentation target for "admin_task" voice logs — reuses the exact same
// interactions-logging mechanism as a real teacher, just with a different target.
export const ADMIN_ROW_NAME = 'מנהל המערכת'
const ADMIN_ROW_ROLE = 'מנהל מערכת'
const ADMIN_ROW_PHONE = '000-ADMIN'

export const ROUTES = [
  { value: 'teacher_call', label: '👤 שיחה עם מורה' },
  { value: 'admin_task', label: '📝 משימה אישית לי' },
  { value: 'new_task_column', label: '📋 משימה לכל המורים' },
]

// Mirrors INTERACTION_TYPES in ContactDetail.jsx — kept in sync manually since the two
// pages don't share a module today.
export const COMMUNICATION_TYPES = [
  { value: 'phone_call', label: 'שיחת טלפון', icon: '📞' },
  { value: 'message_sent', label: 'הודעה', icon: '😞' },
  { value: 'correspondence', label: 'התכתבות', icon: '📜' },
  { value: 'meeting', label: 'פגישה', icon: '🤝' },
]

export async function ensureAdminContact() {
  const { data: existing, error: findErr } = await supabase
    .from('contacts')
    .select('id')
    .contains('custom_fields', { is_admin_row: true })
    .maybeSingle()
  if (findErr) {
    console.error('שגיאה בבדיקת רשומת מנהל המערכת:', findErr)
    return null
  }
  if (existing) return existing.id

  const { data: created, error: createErr } = await supabase
    .from('contacts')
    .insert({
      name: ADMIN_ROW_NAME,
      phone: ADMIN_ROW_PHONE,
      role: ADMIN_ROW_ROLE,
      gender: 'male',
      custom_fields: { is_admin_row: true, mentor_name: 'אבנר' },
    })
    .select('id')
    .single()
  if (createErr) {
    console.error('שגיאה ביצירת רשומת מנהל המערכת:', createErr)
    return null
  }
  return created.id
}

// Adds a new task (checkbox) column to the shared contacts table config — the
// exact same mechanism as picking "עמודת משימה" in the Contacts column manager,
// just driven by an AI-authored label instead of manual typing.
export async function addCustomColumnFromVoice(rawLabel) {
  const baseLabel = (rawLabel || 'משימה חדשה').trim() || 'משימה חדשה'
  const { data: settings, error: loadErr } = await supabase
    .from('settings')
    .select('contacts_columns')
    .eq('id', 'global')
    .single()
  if (loadErr) throw loadErr
  const current = settings?.contacts_columns || []

  let label = baseLabel
  let n = 2
  while (current.some(c => c.label === label || c.key === label)) {
    label = `${baseLabel} (${n})`
    n++
  }

  const newColumn = { key: label, label, source: 'task', taskSource: 'general', visible: true, locked: false }
  const { error: saveErr } = await supabase
    .from('settings')
    .update({ contacts_columns: [...current, newColumn] })
    .eq('id', 'global')
  if (saveErr) throw saveErr
  return label
}

// Writes one interactions row. createdAt (ISO string), when given, overrides the
// default now() — used at approval time so the row lands at the original recording
// time rather than when the admin got around to approving it.
export async function saveInteractionRow({ contactId, type, content, metadata, createdAt }) {
  const insertData = { contact_id: contactId, type, content, metadata }
  if (createdAt) insertData.created_at = createdAt
  const { error } = await supabase.from('interactions').insert(insertData)
  if (error) throw error
}

export async function createCalendarEventsForActionItems(actionItems, targetName, summary) {
  const datedItems = (actionItems || []).filter(item => item.due_date)
  if (datedItems.length === 0) return null

  const calendarFailureCount = (
    await Promise.allSettled(
      datedItems.map(item =>
        backendFetch('/api/google/create-event', {
          method: 'POST',
          body: JSON.stringify({
            title: `${item.text} — ${targetName}`,
            date: item.due_date,
            notes: summary,
          }),
        })
      )
    )
  ).filter(r => r.status === 'rejected').length

  return calendarFailureCount === 0
    ? null
    : calendarFailureCount === datedItems.length
      ? 'השיחה נשמרה, אך יצירת האירועים ביומן נכשלה'
      : `השיחה נשמרה, אך ${calendarFailureCount} מתוך ${datedItems.length} אירועים ביומן לא נוצרו`
}
```

Note: `ensureAdminContact`'s hardcoded `mentor_name: 'אבנר'` matches the existing single-mentor constant already duplicated in both `VoiceLog.jsx` and `Contacts.jsx` — not changed here, just relocated.

- [ ] **Step 2: Commit**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" add frontend/src/lib/voiceLogActions.js
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" commit -m "$(cat <<'EOF'
Extract voice-log save/approve logic into a shared module

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(Verification happens as part of Task 4 and Task 5, since this module has no callers yet.)

---

### Task 4: Rewrite `VoiceLog.jsx` to auto-save as pending

**Files:**
- Modify: `frontend/src/pages/VoiceLog.jsx` (full rewrite)

- [ ] **Step 1: Replace the entire file**

```jsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { backendFetch } from '../lib/api.js'
import { useSpeechToText } from '../hooks/useSpeechToText.js'
import { matchTeacher } from '../lib/teacherMatch.js'
import { insertPendingVoiceLog } from '../lib/pendingVoiceLog.js'

const MENTOR = 'אבנר'

export default function VoiceLog() {
  const { supported, listening, transcript, setTranscript, start, stop, reset, error: speechError } = useSpeechToText()
  const [teachers, setTeachers] = useState([])
  const [teachersError, setTeachersError] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState(null)
  const [saveResult, setSaveResult] = useState(null) // { ok: true } | { ok: false, message }

  useEffect(() => {
    loadMyTeachers()
  }, [])

  async function loadMyTeachers() {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, name, custom_fields')
      .eq('role', 'מורה מוביל/ה')
    if (error) {
      console.error('שגיאה בטעינת מורות:', error)
      setTeachersError('שגיאה בטעינת רשימת המורות שלך')
      return
    }
    setTeachers((data || []).filter(c => c.custom_fields?.mentor_name === MENTOR))
  }

  async function analyze() {
    setAnalyzing(true)
    setAnalyzeError(null)
    setSaveResult(null)
    try {
      const result = await backendFetch('/api/voice-log/analyze', {
        method: 'POST',
        body: JSON.stringify({ transcript }),
      })
      const { certain } = matchTeacher(result.teacher_name_spoken, teachers)
      await insertPendingVoiceLog({
        mentor_name: MENTOR,
        transcript,
        route: result.route === 'unclear' ? null : result.route,
        teacher_name_spoken: result.teacher_name_spoken || null,
        matched_contact_id: certain?.id ?? null,
        communication_type: result.communication_type || null,
        summary: result.summary || null,
        action_items: result.action_items || [],
        mentioned_dates: result.mentioned_dates || [],
        column_label: result.column_label || null,
      })
      setSaveResult({ ok: true })
      reset()
    } catch (err) {
      setAnalyzeError(err instanceof TypeError ? 'שגיאת רשת — יש לבדוק את החיבור ולנסות שוב' : err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  // Fallback when /analyze itself fails (e.g. no connectivity while traveling) — the
  // raw transcript is still saved as pending, with every classification field left
  // null, so the admin classifies it manually during approval instead of losing it.
  async function saveTranscriptAsPending() {
    setAnalyzeError(null)
    try {
      await insertPendingVoiceLog({
        mentor_name: MENTOR,
        transcript,
        route: null,
        teacher_name_spoken: null,
        matched_contact_id: null,
        communication_type: null,
        summary: null,
        action_items: [],
        mentioned_dates: [],
        column_label: null,
      })
      setSaveResult({ ok: true })
      reset()
    } catch (err) {
      setSaveResult({
        ok: false,
        message: 'שמירה נכשלה: ' + (err instanceof TypeError ? 'שגיאת רשת — יש לבדוק את החיבור ולנסות שוב' : err.message),
      })
    }
  }

  function startNewCall() {
    setAnalyzeError(null)
    setSaveResult(null)
    start()
  }

  if (!supported) {
    return (
      <div className="max-w-xl mx-auto text-center py-16">
        <p className="text-lg text-gray-700">
          הדפדפן הזה לא תומך בהכתבה קולית. יש לפתוח את העמוד הזה ב-Chrome.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto py-8 space-y-6">
      <h1 className="text-2xl font-bold text-gray-800 text-center">תיעוד קולי</h1>

      {teachersError && <p className="text-red-600 text-center">{teachersError}</p>}

      <div className="flex justify-center">
        <button
          onClick={listening ? stop : startNewCall}
          className={`w-32 h-32 rounded-full text-white text-lg font-semibold shadow-lg transition-colors ${
            listening ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {listening ? '⏹ עצור' : '🎙 דבר'}
        </button>
      </div>

      {speechError && <p className="text-red-600 text-center">{speechError}</p>}

      <textarea
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        placeholder="הטקסט שתדבר יופיע כאן..."
        rows={8}
        className="w-full border border-gray-300 rounded-lg p-3 text-right"
        dir="rtl"
      />

      <div className="flex gap-3 justify-center">
        <button
          onClick={reset}
          disabled={!transcript || analyzing}
          className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
        >
          נקה
        </button>
        <button
          onClick={analyze}
          disabled={!transcript.trim() || analyzing}
          className="px-6 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40"
        >
          {analyzing ? 'שומר...' : 'סכם ושמור'}
        </button>
      </div>

      {analyzeError && (
        <div className="text-center space-y-2">
          <p className="text-red-600">{analyzeError}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={analyze} className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100">
              נסה שוב
            </button>
            <button onClick={saveTranscriptAsPending} className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100">
              שמור בלי סיכום
            </button>
          </div>
        </div>
      )}

      {saveResult?.ok && (
        <p className="text-center text-green-700">✓ נשמר, ממתין לאישור</p>
      )}
      {saveResult && !saveResult.ok && (
        <p className="text-center text-red-600">{saveResult.message}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Manual verification**

Run `run-teacher-crm`. On `/voice-log`:
1. Record or type a short transcript, press "סכם ושמור".
2. Expected: no confirmation card appears; a green "✓ נשמר, ממתין לאישור" message shows, and the transcript textarea clears.
3. In the Supabase Table Editor, open `pending_voice_logs` and confirm a new row exists with `transcript` matching what was said, and `route`/`teacher_name_spoken`/etc. populated from the AI analysis.
4. Confirm the `interactions` table did **not** get a new row from this action.
5. Temporarily rename the backend route path in `backend/src/routes/voiceLog.js` (or stop the backend) to simulate an analyze failure, click "סכם ושמור" again, confirm the red error + "נסה שוב"/"שמור בלי סיכום" buttons appear, click "שמור בלי סיכום", and confirm a `pending_voice_logs` row is created with `route`, `communication_type`, `matched_contact_id` all `null`. Revert the temporary change afterward.

- [ ] **Step 3: Commit**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" add frontend/src/pages/VoiceLog.jsx
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" commit -m "$(cat <<'EOF'
Auto-save voice-logged instructions as pending instead of requiring confirmation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `PendingApprovalAccordion.jsx` — admin approval UI

**Files:**
- Create: `frontend/src/components/PendingApprovalAccordion.jsx`

- [ ] **Step 1: Write the component**

```jsx
import { useState } from 'react'
import {
  ROUTES,
  COMMUNICATION_TYPES,
  ADMIN_ROW_NAME,
  ensureAdminContact,
  addCustomColumnFromVoice,
  saveInteractionRow,
  createCalendarEventsForActionItems,
} from '../lib/voiceLogActions.js'
import { deletePendingVoiceLog } from '../lib/pendingVoiceLog.js'
import { matchTeacher } from '../lib/teacherMatch.js'

function formatRecordedAt(iso) {
  return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
}

function PendingVoiceLogCard({ item, teachers, onApproved, onDeleted }) {
  const matchResult = matchTeacher(item.teacher_name_spoken, teachers)
  const [route, setRoute] = useState(item.route)
  const [teacherId, setTeacherId] = useState(item.matched_contact_id)
  const [overrideMatch, setOverrideMatch] = useState(!item.matched_contact_id && matchResult.candidates.length === 0)
  const [manualSearch, setManualSearch] = useState('')
  const [communicationType, setCommunicationType] = useState(item.communication_type)
  const [summary, setSummary] = useState(item.summary || '')
  const [columnLabel, setColumnLabel] = useState(item.column_label || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const filteredManual = manualSearch.trim()
    ? teachers.filter(t => t.name.includes(manualSearch.trim()))
    : []

  async function handleApprove() {
    if (!route) return alert('יש לבחור סוג תיעוד לפני האישור')
    if (route === 'teacher_call' && !teacherId) return alert('יש לבחור מורה לפני האישור')
    if (route === 'teacher_call' && !communicationType) return alert('יש לבחור סוג אינטראקציה לפני האישור')
    if (route === 'new_task_column' && !columnLabel.trim()) return alert('יש להזין כותרת לעמודה')

    setSaving(true)
    setError(null)
    try {
      if (route === 'new_task_column') {
        await addCustomColumnFromVoice(columnLabel)
      } else {
        const targetContactId = route === 'admin_task' ? await ensureAdminContact() : teacherId
        if (route === 'admin_task' && !targetContactId) throw new Error('רשומת מנהל המערכת לא נמצאה — נסה לרענן את העמוד')
        const targetName = route === 'admin_task'
          ? ADMIN_ROW_NAME
          : (teachers.find(t => t.id === teacherId)?.name || '')
        await saveInteractionRow({
          contactId: targetContactId,
          type: communicationType,
          content: summary,
          metadata: {
            transcript: item.transcript,
            action_items: item.action_items,
            mentioned_dates: item.mentioned_dates,
            teacher_name_spoken: item.teacher_name_spoken,
            confirmed_by_user: true,
            source: 'voice_pwa',
            route,
          },
          createdAt: item.created_at,
        })
        const calendarWarning = await createCalendarEventsForActionItems(item.action_items, targetName, summary)
        if (calendarWarning) alert(calendarWarning)
      }
      await deletePendingVoiceLog(item.id)
      onApproved(item.id)
    } catch (err) {
      setError('אישור נכשל: ' + (err instanceof TypeError ? 'שגיאת רשת — יש לבדוק את החיבור ולנסות שוב' : err.message))
      setSaving(false)
    }
  }

  async function handleDelete() {
    setSaving(true)
    setError(null)
    try {
      await deletePendingVoiceLog(item.id)
      onDeleted(item.id)
    } catch (err) {
      setError('מחיקה נכשלה: ' + err.message)
      setSaving(false)
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-4 bg-white shadow-sm">
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>הוקלט: {formatRecordedAt(item.created_at)}</span>
      </div>
      <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-2" dir="rtl">{item.transcript}</p>

      <div>
        <label className="block text-sm font-medium text-gray-600 mb-1">סוג התיעוד</label>
        <div className="flex gap-2 flex-wrap">
          {ROUTES.map(r => (
            <button
              key={r.value}
              type="button"
              disabled={saving}
              onClick={() => setRoute(r.value)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors disabled:opacity-60 ${
                route === r.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {!route && (
          <p className="text-orange-600 text-xs mt-1">לא זוהתה כוונה ברורה מההקלטה — יש לבחור ידנית</p>
        )}
      </div>

      {route === 'teacher_call' && (
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">מורה שזוהה</label>
          {matchResult.certain && teacherId === matchResult.certain.id && !overrideMatch ? (
            <div className="flex items-center gap-2">
              <p className="text-green-700 font-medium">✓ {matchResult.certain.name}</p>
              <button
                type="button"
                onClick={() => { setOverrideMatch(true); setTeacherId(null) }}
                className="text-sm text-blue-600 underline"
              >
                לא נכון? החלף/י מורה
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {matchResult.candidates.length > 0 && (
                <select
                  value={teacherId ?? ''}
                  onChange={(e) => setTeacherId(e.target.value || null)}
                  disabled={saving}
                  className="w-full border border-gray-300 rounded-lg p-2 disabled:opacity-60"
                >
                  <option value="">בחר/י מורה...</option>
                  {matchResult.candidates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}
              <input
                type="text"
                value={manualSearch}
                onChange={(e) => setManualSearch(e.target.value)}
                placeholder="חיפוש ידני לפי שם..."
                disabled={saving}
                className="w-full border border-gray-300 rounded-lg p-2 text-right disabled:opacity-60"
                dir="rtl"
              />
              {filteredManual.length > 0 && (
                <select
                  value={teacherId ?? ''}
                  onChange={(e) => setTeacherId(e.target.value || null)}
                  disabled={saving}
                  className="w-full border border-gray-300 rounded-lg p-2 disabled:opacity-60"
                >
                  <option value="">בחר/י מורה...</option>
                  {filteredManual.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      )}

      {route === 'teacher_call' && (
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">סוג האינטראקציה</label>
          <div className="flex gap-2 flex-wrap">
            {COMMUNICATION_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                disabled={saving}
                onClick={() => setCommunicationType(t.value)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors disabled:opacity-60 ${
                  communicationType === t.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          {!communicationType && (
            <p className="text-orange-600 text-xs mt-1">לא זוהה סוג אינטראקציה ברור מההקלטה — יש לבחור ידנית</p>
          )}
        </div>
      )}

      {(route === 'teacher_call' || route === 'admin_task') && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">סיכום</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              disabled={saving}
              className="w-full border border-gray-300 rounded-lg p-2 text-right disabled:opacity-60"
              dir="rtl"
            />
          </div>

          {(item.action_items || []).length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">מטלות המשך</label>
              <ul className="space-y-1">
                {item.action_items.map((actionItem, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">{actionItem.text}</span>
                    {actionItem.due_date && <span className="text-gray-500">📅 {actionItem.due_date}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {route === 'new_task_column' && (
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">כותרת עמודת המשימה (תיבת סימון שתתווסף לכל המורים בטבלת אנשי הקשר)</label>
          <input
            type="text"
            value={columnLabel}
            onChange={(e) => setColumnLabel(e.target.value)}
            disabled={saving}
            className="w-full border border-gray-300 rounded-lg p-2 text-right disabled:opacity-60"
            dir="rtl"
          />
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleApprove}
          disabled={saving || !route}
          className="flex-1 py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40"
        >
          {saving ? 'שומר...' : route === 'new_task_column' ? 'הוסף עמודה' : 'אשר ושמור'}
        </button>
        <button
          onClick={handleDelete}
          disabled={saving}
          className="px-4 py-3 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-40"
        >
          מחק
        </button>
      </div>
    </div>
  )
}

export default function PendingApprovalAccordion({ items, teachers, expanded, onToggle, onApproved, onDeleted }) {
  if (items.length === 0) return null

  return (
    <div className="rounded-xl border p-4 bg-amber-50 border-amber-200">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎙️</span>
          <span className="text-sm font-medium text-amber-800">
            {items.length} הודעות קוליות מחכות לאישור
          </span>
        </div>
        <button
          onClick={onToggle}
          className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors"
        >
          {expanded ? '▲ הסתר' : '▼ הצג לאישור'}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-4">
          {items.map(item => (
            <PendingVoiceLogCard
              key={item.id}
              item={item}
              teachers={teachers}
              onApproved={onApproved}
              onDeleted={onDeleted}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" add frontend/src/components/PendingApprovalAccordion.jsx
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" commit -m "$(cat <<'EOF'
Add PendingApprovalAccordion component for voice-log approval

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(Manual verification happens in Task 6, once it's mounted in the dashboard.)

---

### Task 6: Mount the accordion on the dashboard

**Files:**
- Modify: `frontend/src/pages/Contacts.jsx`

- [ ] **Step 1: Add imports**

At the top of `frontend/src/pages/Contacts.jsx`, after the existing `import { BulkSendModal } from './WhatsApp.jsx'` line (line 4):

```jsx
import PendingApprovalAccordion from '../components/PendingApprovalAccordion.jsx'
import { fetchPendingVoiceLogs } from '../lib/pendingVoiceLog.js'
```

- [ ] **Step 2: Add state**

After the existing `const [pendingTasksExpanded, setPendingTasksExpanded] = useState(false)` line (line 143):

```jsx
  const [pendingVoiceLogs, setPendingVoiceLogs] = useState([])
  const [pendingVoiceLogsExpanded, setPendingVoiceLogsExpanded] = useState(false)
```

- [ ] **Step 3: Load pending voice logs on mount**

After the existing mount effect (lines 145-148: `useEffect(() => { loadContacts(); loadColumns() }, [])`), add a new effect:

```jsx
  useEffect(() => {
    fetchPendingVoiceLogs(MENTOR)
      .then(setPendingVoiceLogs)
      .catch(err => console.error('Error loading pending voice logs:', err))
  }, [])
```

- [ ] **Step 4: Mount the accordion at the top of the dashboard**

In the render, right before the existing `<ContactStats ... />` (line 419), insert:

```jsx
      <PendingApprovalAccordion
        items={pendingVoiceLogs}
        teachers={myTeachers}
        expanded={pendingVoiceLogsExpanded}
        onToggle={() => setPendingVoiceLogsExpanded(v => !v)}
        onApproved={id => setPendingVoiceLogs(prev => prev.filter(p => p.id !== id))}
        onDeleted={id => setPendingVoiceLogs(prev => prev.filter(p => p.id !== id))}
      />

```

so the block reads:

```jsx
  return (
    <div className="space-y-4">
      <PendingApprovalAccordion
        items={pendingVoiceLogs}
        teachers={myTeachers}
        expanded={pendingVoiceLogsExpanded}
        onToggle={() => setPendingVoiceLogsExpanded(v => !v)}
        onApproved={id => setPendingVoiceLogs(prev => prev.filter(p => p.id !== id))}
        onDeleted={id => setPendingVoiceLogs(prev => prev.filter(p => p.id !== id))}
      />

      <ContactStats
        buckets={buckets}
        expandedBucket={expandedBucket}
        onToggleBucket={key => setExpandedBucket(prev => (prev === key ? null : key))}
      />

      <PendingTasksBanner
        pendingTasksMap={pendingTasksMap}
        contacts={contacts}
        expanded={pendingTasksExpanded}
        onToggle={() => setPendingTasksExpanded(!pendingTasksExpanded)}
      />
      ...
```

(`myTeachers` is already computed at line 392, above this return, so it's in scope.)

- [ ] **Step 5: Manual end-to-end verification**

Run `run-teacher-crm`. With at least one pending row in `pending_voice_logs` (from Task 4's verification, or insert one fresh via `/voice-log`):

1. Open the dashboard (`/contacts`). Confirm the amber "🎙️ N הודעות קוליות מחכות לאישור" bar appears at the very top, above the green/orange/red stat tiles.
2. Click "▼ הצג לאישור". Confirm it expands to show one edit card per pending row, pre-filled with the route/teacher/type/summary the AI produced (or blank fields for the analyze-failure fallback row from Task 4).
3. For a `teacher_call` item: change the matched teacher via "לא נכון? החלף/י מורה", pick a different communication type, edit the summary, click "אשר ושמור". Confirm: the card disappears from the accordion, the counter decrements, and a new row appears in `interactions` for the newly selected teacher with `created_at` equal to the pending row's original `created_at` (not the current time) and `content` equal to the edited summary.
4. For an `admin_task` item (or switch a pending item's route to it): approve it and confirm the interaction lands against the "מנהל המערכת" contact.
5. For a `new_task_column` item: approve it and confirm a new checkbox column appears in the Contacts table's column manager, applied to all teachers.
6. Create one more pending item and click "מחק" instead of approving. Confirm it disappears from the accordion and never appears in `interactions`.
7. Confirm that once all pending items are resolved, the accordion bar disappears entirely from the dashboard.

- [ ] **Step 6: Commit**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" add frontend/src/pages/Contacts.jsx
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" commit -m "$(cat <<'EOF'
Mount PendingApprovalAccordion at the top of the dashboard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Push and open the PR

**Files:** none (git only)

- [ ] **Step 1: Push the branch**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" push origin feature/pending-voice-log-approval
```

- [ ] **Step 2: Open a pull request**

```bash
gh pr create --repo avnamer/teacher-crm --title "Pending voice log approval" --body "$(cat <<'EOF'
## Summary
- Voice-logged instructions now auto-save as pending items instead of requiring on-the-spot confirmation (safe to use while traveling)
- New `PendingApprovalAccordion` on the dashboard lets the admin review, edit, approve, or delete each pending item — approval preserves the original recording timestamp

## Test plan
- [ ] Ran the migration in Task 1 against the live Supabase project
- [ ] Verified recording auto-saves to `pending_voice_logs` with no confirmation card (Task 4)
- [ ] Verified the accordion appears/expands correctly on the dashboard (Task 6)
- [ ] Verified approve for all three routes (teacher_call, admin_task, new_task_column) and delete (Task 6)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Per this project's `CLAUDE.md`, do not merge the PR — the user merges it themselves once they've verified it (merging is also the one deploy that costs Netlify credits, so it should only happen once this is fully tested).
