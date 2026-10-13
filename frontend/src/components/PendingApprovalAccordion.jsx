import { useState, useEffect } from 'react'
import {
  CATEGORIES,
  categoryOf,
  fixStaleYear,
  findOption,
  createScheduledMeeting,
  saveTeacherTask,
  ADMIN_ROW_NAME,
  ensureAdminContact,
  addCustomColumnFromVoice,
  saveInteractionRow,
  createCalendarEventsForActionItems,
  findScheduledMeetingGroupContactIds,
  mergeOrCreateMeeting,
} from '../lib/voiceLogActions.js'
import { deletePendingVoiceLog } from '../lib/pendingVoiceLog.js'
import { createAdminMeeting } from '../lib/adminMeetings.js'
import { addManagementTask } from '../lib/managementTasks.js'
import { ASSIGNEE_LABEL } from '../lib/interactions.js'
import { matchTeacher } from '../lib/teacherMatch.js'

function formatRecordedAt(iso) {
  return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
}

function PendingVoiceLogCard({ item: rawItem, teachers, onApproved, onDeleted }) {
  const item = {
    ...rawItem,
    action_items: (rawItem.action_items || []).map(a => ({ ...a, due_date: fixStaleYear(a.due_date, rawItem.created_at) })),
  }
  const matchResult = matchTeacher(item.teacher_name_spoken, teachers)
  const [route, setRoute] = useState(item.route)
  const [teacherId, setTeacherId] = useState(item.matched_contact_id)
  const [overrideMatch, setOverrideMatch] = useState(!item.matched_contact_id && matchResult.candidates.length === 0)
  const [manualSearch, setManualSearch] = useState('')
  const [communicationType, setCommunicationType] = useState(item.communication_type)
  const [category, setCategory] = useState(categoryOf(item.route, item.communication_type))
  const extra = item.extra || {}
  const [meetingDate, setMeetingDate] = useState(extra.meeting_date || '') // future_meeting / admin_trip
  const [destination, setDestination] = useState(extra.destination || '')
  const [distanceKm, setDistanceKm] = useState(extra.distance_km ?? '')
  const [summary, setSummary] = useState(item.summary || '')
  const [columnLabel, setColumnLabel] = useState(item.column_label || '')
  const [alsoManagement, setAlsoManagement] = useState(false) // admin_task only: also a "משימה מההנהלה"
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const isMeeting = route === 'teacher_call' && communicationType === 'meeting'
  const isFutureMeeting = route === 'future_meeting'
  const needsAttendees = isMeeting || isFutureMeeting
  const hasSummary = ['teacher_call', 'admin_task', 'teacher_task', 'management_task', 'future_meeting', 'admin_trip'].includes(route)
  const hasActionItems = ['teacher_call', 'admin_task', 'teacher_task', 'management_task'].includes(route)
  const needsSingleTeacher = (route === 'teacher_call' && !isMeeting) || route === 'teacher_task'
  const activeOption = findOption(route, communicationType)?.option
  const todayStr = new Date().toISOString().split('T')[0]
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

  // A future meeting starts with the teacher the AI recognized, if any.
  useEffect(() => {
    if (!isFutureMeeting) return
    const primaryId = matchResult.certain?.id ?? teacherId
    if (primaryId) setSelectedMeetingTeacherIds(prev => (prev.size ? prev : new Set([primaryId])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFutureMeeting])

  function pickCategory(value) {
    setCategory(value)
    // Keep the selection only if it also belongs to the new category (a held meeting is in two).
    const inNewCategory = CATEGORIES.find(c => c.value === value).options.some(o => o.key === activeOption?.key)
    if (!inNewCategory) setRoute(null)
  }

  function pickOption(option) {
    setRoute(option.route)
    if (option.communicationTypes) {
      if (!option.communicationTypes.includes(communicationType)) setCommunicationType(option.communicationTypes[0])
    } else {
      setCommunicationType(null)
    }
    if (option.route === 'admin_trip' && !meetingDate) setMeetingDate(item.created_at.slice(0, 10))
  }

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
    if (needsSingleTeacher && !teacherId) return alert('יש לבחור מורה לפני האישור')
    if (isMeeting && selectedMeetingTeacherIds.size === 0) return alert('יש לבחור לפחות מורה אחת שהשתתפה בפגישה')
    if (route === 'new_task_column' && !columnLabel.trim()) return alert('יש להזין כותרת לעמודה')
    const taskItems = (item.action_items || []).filter(a => a.text)
    const tasksToSave = taskItems.length > 0 ? taskItems : (summary.trim() ? [{ text: summary.trim(), due_date: null }] : [])
    if ((route === 'teacher_task' || route === 'management_task') && tasksToSave.length === 0) return alert('לא זוהתה משימה — יש לכתוב אותה בשדה הסיכום')
    if (isFutureMeeting) {
      if (selectedMeetingTeacherIds.size === 0) return alert('יש לבחור לפחות מורה אחת לפגישה')
      if (!meetingDate) return alert('יש להזין תאריך לפגישה')
      if (meetingDate < todayStr) return alert('תאריך הפגישה כבר עבר — לפגישה שהתקיימה יש לבחור "תיעוד תוכן פגישה"')
    }
    if (route === 'admin_trip') {
      if (!meetingDate) return alert('יש להזין תאריך לנסיעה')
      if (!destination.trim()) return alert('יש להזין יעד לנסיעה')
    }

    setSaving(true)
    setError(null)
    try {
      if (route === 'new_task_column') {
        await addCustomColumnFromVoice(columnLabel)
      } else if (isFutureMeeting) {
        const teachersById = Object.fromEntries(teachers.map(t => [t.id, t]))
        await createScheduledMeeting({
          teacherIds: [...selectedMeetingTeacherIds],
          teachersById,
          date: meetingDate,
          content: summary,
        })
      } else if (route === 'admin_trip') {
        await createAdminMeeting({ date: meetingDate, destination, purpose: summary, distanceKm })
      } else if (route === 'management_task') {
        for (const t of tasksToSave) {
          await addManagementTask({ text: t.text, due_date: t.due_date, sender_name: 'הקלטה קולית' })
        }
      } else if (route === 'teacher_task') {
        await saveTeacherTask({
          contactId: teacherId,
          items: tasksToSave,
          content: summary,
          metadata: {
            transcript: item.transcript,
            teacher_name_spoken: item.teacher_name_spoken,
            confirmed_by_user: true,
            source: 'voice_pwa',
            route,
          },
          createdAt: item.created_at,
        })
        const calendarWarning = await createCalendarEventsForActionItems(
          tasksToSave, teachers.find(t => t.id === teacherId)?.name || '', summary)
        if (calendarWarning) alert(calendarWarning)
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
            saved_at: new Date().toISOString(),
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
        if (route === 'admin_task' && alsoManagement) {
          // One management task per follow-up item; with none, the summary itself is the task.
          const items = (item.action_items || []).filter(a => a.text)
          const tasks = items.length > 0 ? items : [{ text: summary, due_date: null }]
          for (const t of tasks) {
            await addManagementTask({ text: t.text, due_date: t.due_date, sender_name: 'הקלטה קולית' })
          }
        }
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
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              type="button"
              disabled={saving}
              onClick={() => pickCategory(c.value)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors disabled:opacity-60 ${
                category === c.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        {!category && (
          <p className="text-orange-600 text-xs mt-1">לא זוהתה כוונה ברורה מההקלטה — יש לבחור ידנית</p>
        )}
      </div>

      {category && (
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">מה לשמור</label>
          <div className="flex gap-2 flex-wrap">
            {CATEGORIES.find(c => c.value === category).options.map(o => (
              <button
                key={o.key}
                type="button"
                disabled={saving}
                onClick={() => pickOption(o)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors disabled:opacity-60 ${
                  activeOption?.key === o.key
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {!route && (
            <p className="text-orange-600 text-xs mt-1">יש לבחור מה לשמור</p>
          )}
          {route === 'teacher_call' && !communicationType && (
            <p className="text-orange-600 text-xs mt-1">לא זוהה סוג אינטראקציה ברור מההקלטה — יש לבחור ידנית</p>
          )}
        </div>
      )}

      {isFutureMeeting && (
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">תאריך הפגישה</label>
          <input
            type="date"
            value={meetingDate}
            min={todayStr}
            onChange={(e) => setMeetingDate(e.target.value)}
            disabled={saving}
            className="w-full border border-gray-300 rounded-lg p-2 disabled:opacity-60"
          />
          {!meetingDate && <p className="text-orange-600 text-xs mt-1">לא זוהה תאריך מההקלטה — יש להזין ידנית</p>}
        </div>
      )}

      {route === 'admin_trip' && (
        <div className="space-y-2">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">תאריך הנסיעה</label>
            <input
              type="date"
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              disabled={saving}
              className="w-full border border-gray-300 rounded-lg p-2 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">יעד / מקום</label>
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              disabled={saving}
              className="w-full border border-gray-300 rounded-lg p-2 text-right disabled:opacity-60"
              dir="rtl"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">מרחק בק״מ</label>
            <input
              type="number" min="0" step="0.1" inputMode="decimal"
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
              disabled={saving}
              className="w-full border border-gray-300 rounded-lg p-2 disabled:opacity-60"
            />
          </div>
        </div>
      )}

      {needsAttendees && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-600">{isFutureMeeting ? 'מורים בפגישה' : 'מורים שהשתתפו בפגישה'}</label>
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

      {needsSingleTeacher && (
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

      {hasSummary && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              {route === 'admin_trip' ? 'מטרת הנסיעה' : isFutureMeeting ? 'נושא הפגישה' : (route === 'teacher_task' || route === 'management_task') ? 'סיכום / המשימה' : 'סיכום'}
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              disabled={saving}
              className="w-full border border-gray-300 rounded-lg p-2 text-right disabled:opacity-60"
              dir="rtl"
            />
          </div>

          {hasActionItems && (item.action_items || []).length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">מטלות המשך</label>
              <ul className="space-y-1">
                {item.action_items.map((actionItem, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">{actionItem.text}</span>
                    {route === 'teacher_call' && ASSIGNEE_LABEL[actionItem.assignee] && (
                      <span className="text-xs text-gray-500">{ASSIGNEE_LABEL[actionItem.assignee]}</span>
                    )}
                    {actionItem.due_date && <span className="text-gray-500">📅 {actionItem.due_date}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {route === 'admin_task' && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={alsoManagement} disabled={saving}
            onChange={(e) => setAlsoManagement(e.target.checked)} className="w-4 h-4" />
          🏢 משימה מהנהלת טק סקול
        </label>
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
