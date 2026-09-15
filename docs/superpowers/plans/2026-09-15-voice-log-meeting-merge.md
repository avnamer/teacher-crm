# Merge Voice-Logged Meetings into Scheduled Meetings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approving a voice-logged "meeting" merges into any pre-existing scheduled meeting for the same teachers on the same day, so every attendee ends up with one completed record instead of a leftover empty scheduled row plus a disconnected new one.

**Architecture:** A new `mergeOrCreateMeeting` function in `frontend/src/lib/voiceLogActions.js` finds scheduled-meeting `interactions` rows (same calendar day, overlapping teachers) and either updates them in place or creates a fresh multi-attendee group — the same shape `AddMeetingModal` already produces. `PendingApprovalAccordion.jsx`'s meeting case switches from a single-teacher dropdown to a multi-select checkbox list (pre-checked from any matching scheduled meeting), and calls this new function instead of `saveInteractionRow` on approve.

**Tech Stack:** React (Vite), Supabase JS client, Tailwind classes — matches the rest of the frontend. No automated test framework exists in this repo; manual browser + database verification is the actual "test" here, same as prior meetings-related plans in this project.

**Reference spec:** `docs/superpowers/specs/2026-09-15-voice-log-meeting-merge-design.md`

---

## Before you start

From `main`, create and switch to a new branch:

```bash
cd /c/Users/Avner/teacher-crm
git checkout main
git pull
git checkout -b feature/voice-log-meeting-merge
```

Run the app locally with the `run-teacher-crm` skill and keep it running for the verification steps below. This repo may have other Claude Code sessions working in it concurrently — stage specific files only when committing, never `git add -A`.

You'll need at least two teacher contacts that belong to mentor "אבנר" to test with (check via the Contacts page); the verification steps below assume you can create test meetings and pending voice logs freely and clean them up after.

---

### Task 1: Add meeting-merge helpers to voiceLogActions.js

**Files:**
- Modify: `frontend/src/lib/voiceLogActions.js`

- [ ] **Step 1: Append the new functions**

Add this to the end of `frontend/src/lib/voiceLogActions.js` (after the existing `createCalendarEventsForActionItems` function):

```js

// ─── Voice-logged meeting merge ────────────────────────────────────────────

// Same-day comparison uses the calendar date each created_at's ISO string carries —
// consistent with the dateInputValue()-style helpers already used elsewhere in this
// app (e.g. Meetings.jsx) for turning a stored timestamp back into "which day is this".
function calendarDateStr(iso) {
  return new Date(iso).toISOString().split('T')[0]
}

// Scheduled-meeting interactions rows (metadata.meeting_status === 'scheduled') for
// the given contact ids, landing on the same calendar day as referenceIso. Used both
// to default-select attendees when a voice log is first classified as a meeting, and
// by mergeOrCreateMeeting to decide what to merge into.
export async function findScheduledMeetingRows(contactIds, referenceIso) {
  if (!contactIds?.length) return []
  const { data, error } = await supabase
    .from('interactions')
    .select('id, contact_id, metadata, created_at')
    .eq('type', 'meeting')
    .contains('metadata', { meeting_status: 'scheduled' })
    .in('contact_id', contactIds)
  if (error) throw error
  const day = calendarDateStr(referenceIso)
  return (data || []).filter(row => calendarDateStr(row.created_at) === day)
}

// Given the one teacher the AI recognized as the voice log's subject, and the day it
// was recorded, resolves every co-attendee of that teacher's pre-scheduled meeting
// (if any) on that same day — used to pre-check the meeting-approval picker.
export async function findScheduledMeetingGroupContactIds(teacherId, referenceIso) {
  if (!teacherId) return []
  const [ownRow] = await findScheduledMeetingRows([teacherId], referenceIso)
  if (!ownRow) return []
  const groupId = ownRow.metadata?.meeting_group_id
  if (!groupId) return [teacherId]
  const { data, error } = await supabase
    .from('interactions')
    .select('contact_id')
    .contains('metadata', { meeting_group_id: groupId })
  if (error) throw error
  return [...new Set((data || []).map(r => r.contact_id))]
}

// Completes a voice-logged meeting for every selected teacher at once. If any of
// them already has a scheduled-meeting row for the same calendar day, every selected
// teacher's row converges onto that scheduled meeting's group (marking it complete);
// teachers with no scheduled row yet get a fresh row added to that same group. If
// none of them has a scheduled row at all, a brand-new group is created for exactly
// this call — the same shape AddMeetingModal itself produces for a same-day meeting.
export async function mergeOrCreateMeeting({ teacherIds, teachersById, createdAt, content, metadata }) {
  const scheduledRows = await findScheduledMeetingRows(teacherIds, createdAt)
  const rowsByContact = Object.fromEntries(scheduledRows.map(r => [r.contact_id, r]))
  const targetGroupId = scheduledRows[0]?.metadata?.meeting_group_id || crypto.randomUUID()

  for (const id of teacherIds) {
    const attendees = teacherIds.filter(o => o !== id).map(o => teachersById[o]?.name).filter(Boolean)
    const existing = rowsByContact[id]
    if (existing) {
      const {
        meeting_status: _meetingStatus,
        meeting_group_id: _meetingGroupId,
        attendees: _oldAttendees,
        ...restMetadata
      } = existing.metadata || {}
      const { error } = await supabase
        .from('interactions')
        .update({
          content: content?.trim() || null,
          metadata: { ...restMetadata, ...metadata, meeting_group_id: targetGroupId, attendees },
        })
        .eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('interactions').insert({
        contact_id: id,
        type: 'meeting',
        content: content?.trim() || null,
        created_at: createdAt,
        metadata: { ...metadata, meeting_group_id: targetGroupId, attendees },
      })
      if (error) throw error
    }
  }
}
```

- [ ] **Step 2: Lint the file**

Run: `cd frontend && npm run lint -- src/lib/voiceLogActions.js`
Expected: no errors (if you see a pre-existing unrelated warning elsewhere in the repo from a broader lint run, that's fine — this command scopes to the one file).

- [ ] **Step 3: Commit**

```bash
cd /c/Users/Avner/teacher-crm
git add frontend/src/lib/voiceLogActions.js
git commit -m "$(cat <<'EOF'
Add meeting-merge helpers to voiceLogActions

findScheduledMeetingRows/findScheduledMeetingGroupContactIds locate a
same-day scheduled meeting for one or more teachers; mergeOrCreateMeeting
folds a voice-logged meeting into that scheduled meeting's
interactions rows (or creates a fresh multi-attendee group if none
exists) instead of writing a disconnected standalone row. Not yet
wired into the approval UI.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Multi-teacher picker and merge on approve in PendingApprovalAccordion

**Files:**
- Modify (full rewrite): `frontend/src/components/PendingApprovalAccordion.jsx`

- [ ] **Step 1: Replace the entire file**

Replace the full contents of `frontend/src/components/PendingApprovalAccordion.jsx` with:

```jsx
import { useState, useEffect } from 'react'
import {
  ROUTES,
  COMMUNICATION_TYPES,
  ADMIN_ROW_NAME,
  ensureAdminContact,
  addCustomColumnFromVoice,
  saveInteractionRow,
  createCalendarEventsForActionItems,
  findScheduledMeetingGroupContactIds,
  mergeOrCreateMeeting,
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

  const isMeeting = route === 'teacher_call' && communicationType === 'meeting'
  const [selectedMeetingTeacherIds, setSelectedMeetingTeacherIds] = useState(() => new Set())
  const [loadingMeetingDefaults, setLoadingMeetingDefaults] = useState(false)

  // When the log is first classified (or reclassified) as a meeting, pre-check the
  // AI-recognized teacher plus every co-attendee of any scheduled meeting they have
  // on the same day this was recorded. The admin can still add/remove teachers below.
  useEffect(() => {
    if (!isMeeting) return
    let cancelled = false
    const primaryId = matchResult.certain?.id ?? teacherId
    if (!primaryId) return
    setLoadingMeetingDefaults(true)
    findScheduledMeetingGroupContactIds(primaryId, item.created_at)
      .then(groupIds => {
        if (cancelled) return
        setSelectedMeetingTeacherIds(new Set(groupIds.length ? groupIds : [primaryId]))
      })
      .catch(err => console.error('שגיאה בטעינת פגישה מתוכננת תואמת:', err))
      .finally(() => { if (!cancelled) setLoadingMeetingDefaults(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMeeting])

  function toggleMeetingTeacher(id) {
    setSelectedMeetingTeacherIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filteredManual = manualSearch.trim()
    ? teachers.filter(t => t.name.includes(manualSearch.trim()))
    : []

  async function handleApprove() {
    if (!route) return alert('יש לבחור סוג תיעוד לפני האישור')
    if (route === 'teacher_call' && !communicationType) return alert('יש לבחור סוג אינטראקציה לפני האישור')
    if (route === 'teacher_call' && !isMeeting && !teacherId) return alert('יש לבחור מורה לפני האישור')
    if (isMeeting && selectedMeetingTeacherIds.size === 0) return alert('יש לבחור לפחות מורה אחת שהשתתפה בפגישה')
    if (route === 'new_task_column' && !columnLabel.trim()) return alert('יש להזין כותרת לעמודה')

    setSaving(true)
    setError(null)
    try {
      if (route === 'new_task_column') {
        await addCustomColumnFromVoice(columnLabel)
      } else if (isMeeting) {
        const teachersById = Object.fromEntries(teachers.map(t => [t.id, t]))
        const teacherIds = [...selectedMeetingTeacherIds]
        await mergeOrCreateMeeting({
          teacherIds,
          teachersById,
          createdAt: item.created_at,
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
        })
        const targetName = teacherIds.map(id => teachersById[id]?.name).filter(Boolean).join(', ')
        const calendarWarning = await createCalendarEventsForActionItems(item.action_items, targetName, summary)
        if (calendarWarning) alert(calendarWarning)
      } else {
        const targetContactId = route === 'admin_task' ? await ensureAdminContact() : teacherId
        if (route === 'admin_task' && !targetContactId) throw new Error('רשומת מנהל המערכת לא נמצאה — נסה לרענן את העמוד')
        const targetName = route === 'admin_task'
          ? ADMIN_ROW_NAME
          : (teachers.find(t => t.id === teacherId)?.name || '')
        await saveInteractionRow({
          contactId: targetContactId,
          // admin_task has no interaction-type picker (there's no "call/message/meeting"
          // to classify for a personal task) — 'correspondence' is the closest existing
          // type and keeps the not-null "type" column satisfied.
          type: route === 'admin_task' ? 'correspondence' : communicationType,
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
    } catch (err) {
      setError('אישור נכשל: ' + (err instanceof TypeError ? 'שגיאת רשת — יש לבדוק את החיבור ולנסות שוב' : err.message))
      setSaving(false)
      return
    }

    // The actual write succeeded at this point. Deleting the now-redundant pending row is
    // best-effort cleanup — if it fails (e.g. a transient network blip), retrying the whole
    // approval would re-run the write above and create a duplicate interaction/calendar event,
    // which is worse than leaving one harmless orphaned row in pending_voice_logs.
    try {
      await deletePendingVoiceLog(item.id)
    } catch (cleanupErr) {
      console.error('אושר בהצלחה אך מחיקת הפריט הממתין נכשלה:', cleanupErr)
    }
    onApproved(item.id)
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

      {isMeeting && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-600">מורים שהשתתפו בפגישה</label>
            {loadingMeetingDefaults && <span className="text-xs text-gray-400">טוען פגישה מתוכננת...</span>}
          </div>
          <div className="border rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-100">
            {teachers.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">אין מורים</p>
            ) : (
              teachers.map(t => (
                <label key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedMeetingTeacherIds.has(t.id)}
                    onChange={() => toggleMeetingTeacher(t.id)}
                    disabled={saving}
                    className="w-4 h-4"
                  />
                  {t.name}
                </label>
              ))
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">{selectedMeetingTeacherIds.size} נבחרו</p>
        </div>
      )}

      {route === 'teacher_call' && !isMeeting && (
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

- [ ] **Step 2: Lint the file**

Run: `cd frontend && npm run lint -- src/components/PendingApprovalAccordion.jsx`
Expected: no errors.

- [ ] **Step 3: Manually verify merging into a pre-scheduled meeting**

1. On the Contacts page, use "🤝 הוסף פגישה" (via the Meetings page) to schedule a **future** meeting for **two** teachers (call them Teacher A and Teacher B), dated today (use today's date — not actually future — so it's a same-day "scheduled" meeting; if the form requires content for non-future dates, note that `AddMeetingModal` only requires content when `isFuture` is false — pick tomorrow's date instead if today is rejected as non-future, then edit the row's `created_at` back to today directly in Supabase before continuing, OR simplest: pick a date a few minutes from now isn't possible via a date input, so just use **today's date** and if the form demands content, type a placeholder like "טרם התקיימה" — this keeps `meeting_status: scheduled` since the isFuture check in `AddMeetingModal` is `date > todayStr()`, i.e. today is NOT future, so today's date meetings require content and are NOT marked scheduled. To get a same-day **scheduled** row, you must create it as a future date (tomorrow) and then, via the Supabase table editor, edit that row's `created_at` back to today for both teachers' rows — keep `meeting_status: scheduled` in metadata as-is.
2. Confirm in the Meetings page that Teacher A and Teacher B now show an empty upcoming/duplicate-looking meeting for today (this reproduces the exact bug reported).
3. Go to the voice-log recording page (`/voice-log` or wherever `VoiceLog.jsx` is routed), and record/type a transcript describing a meeting that happened today with Teacher A, e.g. "נפגשתי היום עם [Teacher A's first name] בבית הספר, דיברנו על ההתקדמות שלה החודש". Submit it ("סכם ושמור").
4. Go to the Contacts page's pending-approval accordion, expand it, find the new pending item. Confirm: route is "שיחה עם מורה", communication type auto-selects "🤝 פגישה" (if the AI correctly classified it — if not, click the פגישה button yourself), and confirm the "מורים שהשתתפו בפגישה" checkbox list appears (not a single dropdown) with **both** Teacher A and Teacher B pre-checked (may show "טוען פגישה מתוכננת..." briefly first).
5. Adjust the summary text if you want, then click "אשר ושמור".
6. Go to the Meetings page and confirm: there is now exactly **one** completed meeting entry for today shared by Teacher A and Teacher B (not two, not an extra empty one), with the summary content visible under both, and the old "scheduled" duplicate is gone (because it became this same row).
7. Query the `interactions` table in Supabase directly (table editor or SQL) to confirm exactly two rows exist for this meeting (one per teacher), both sharing the same `metadata.meeting_group_id`, both with `content` set to the summary, both with no `meeting_status` key in `metadata`, and each row's `metadata.attendees` array containing the other teacher's name.

- [ ] **Step 4: Manually verify a spontaneous (never-scheduled) multi-teacher meeting**

1. Record a new voice log describing a meeting today with two teachers who have **no** scheduled meeting today, e.g. "נפגשתי היום עם [Teacher C] ו[Teacher D] בבית הספר, דיברנו על התוכנית לשנה הבאה."
2. In the pending-approval accordion, set the route/communication type to פגישה if not auto-detected. Confirm the checkbox list appears with only the AI-matched teacher (if any) pre-checked, or none pre-checked if no teacher was recognized — either way, manually check Teacher C and Teacher D.
3. Approve. Confirm on the Meetings page that a new completed meeting appears for today, shared by Teacher C and Teacher D, with the summary content.
4. Query `interactions` to confirm both new rows share one `meeting_group_id` (a freshly generated one, not equal to any pre-existing scheduled meeting's group), both have the correct `attendees`, and neither has a `meeting_status` key.

- [ ] **Step 5: Manually verify adding an extra teacher not originally scheduled**

1. Repeat Step 3's setup: schedule a meeting for Teacher A only (single-attendee), same-day trick as before (create as tomorrow, then edit `created_at` back to today in Supabase, keep `meeting_status: scheduled`).
2. Record a voice log about today's meeting mentioning Teacher A, approve as before — in the picker, confirm only Teacher A is pre-checked (since the scheduled meeting had just her) — now **manually check** Teacher B too (representing "a teacher who joined that wasn't originally scheduled"), then approve.
3. Confirm on the Meetings page both Teacher A and Teacher B now show this meeting as completed with the same content, and that Teacher A's `attendees` metadata includes Teacher B's name and vice versa.

- [ ] **Step 6: Manually verify calendar events for action items use all attendee names**

1. Record a voice log describing a meeting with two teachers that includes a follow-up task with a due date, e.g. "נפגשתי היום עם [Teacher A] ו[Teacher B], וצריך לשלוח להן תזכורת ב-1 באוקטובר לגבי הטופס."
2. Approve it with both teachers selected.
3. If Google Calendar is connected (per `docs/ARCHITECTURE.md`), confirm one calendar event was created for the due date, titled with **both** teacher names joined (not two separate events, not just one teacher's name). If Calendar isn't connected in your local setup, confirm instead that the approval still completes successfully and shows the "יצירת האירועים ביומן נכשלה" warning exactly once (not once per teacher) — check via a `console.log` or network tab inspection that `createCalendarEventsForActionItems` was invoked once, not per-teacher.

- [ ] **Step 7: Clean up test data**

Delete every test `interactions` row and any test-only contacts created for Steps 3–6 directly via the Supabase table editor, following this repo's existing query-before-delete discipline.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Avner/teacher-crm
git add frontend/src/components/PendingApprovalAccordion.jsx
git commit -m "$(cat <<'EOF'
Merge voice-logged meetings into scheduled ones on approval

When a voice log is classified as a meeting, the approval card now
shows a multi-teacher checkbox picker instead of a single dropdown,
pre-checked from any pre-scheduled meeting the recognized teacher has
on the same day. Approving calls mergeOrCreateMeeting, which folds
the log into that scheduled meeting's interactions rows for every
selected teacher (or creates a fresh group if none was scheduled) —
so every tagged teacher ends up with one completed record showing the
full attendee list, instead of a leftover empty scheduled row plus a
disconnected new one.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## After this plan

Push `feature/voice-log-meeting-merge` and open a PR against `main`, per this repo's own `CLAUDE.md` conventions (merging is the user's own action — Claude Code's safety classifier blocks agents from merging PRs directly). Note in the PR description that this only merges meetings recorded on the *same calendar day* as the scheduled one (per the design spec's stated scope), and that the AI still only recognizes one teacher's name per transcript — additional attendees rely on the scheduled-meeting lookup or manual selection, not on the model parsing multiple names out of speech.
