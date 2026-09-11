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
