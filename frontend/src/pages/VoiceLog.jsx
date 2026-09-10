import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { backendFetch } from '../lib/api.js'
import { useSpeechToText } from '../hooks/useSpeechToText.js'
import { matchTeacher } from '../lib/teacherMatch.js'

const MENTOR = 'אבנר'

// Fixed pseudo-teacher row representing the mentor themself, used as the
// documentation target for "admin_task" voice logs — reuses the exact same
// interactions-logging mechanism as a real teacher, just with a different target.
const ADMIN_ROW_NAME = 'מנהל המערכת'
const ADMIN_ROW_ROLE = 'מנהל מערכת'
const ADMIN_ROW_PHONE = '000-ADMIN'

const ROUTES = [
  { value: 'teacher_call', label: '👤 שיחה עם מורה' },
  { value: 'admin_task', label: '📝 משימה אישית לי' },
  { value: 'new_task_column', label: '📋 משימה לכל המורים' },
]

async function ensureAdminContact() {
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
      custom_fields: { is_admin_row: true, mentor_name: MENTOR },
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
async function addCustomColumnFromVoice(rawLabel) {
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

export default function VoiceLog() {
  const { supported, listening, transcript, setTranscript, start, stop, reset, error: speechError } = useSpeechToText()
  const [teachers, setTeachers] = useState([])
  const [teachersError, setTeachersError] = useState(null)
  const [adminContactId, setAdminContactId] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState(null)
  const [analysis, setAnalysis] = useState(null) // { route, summary, action_items, mentioned_dates, teacher_name_spoken, column_label }
  const [selectedRoute, setSelectedRoute] = useState(null)
  const [columnLabel, setColumnLabel] = useState('')
  const [selectedTeacherId, setSelectedTeacherId] = useState(null)
  const [manualSearch, setManualSearch] = useState('')
  const [overrideMatch, setOverrideMatch] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState(null) // { ok, calendarWarning?, columnLabel? } | { ok: false, message }

  useEffect(() => {
    loadMyTeachers()
    ensureAdminContact().then(setAdminContactId)
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
    if (analysis && !window.confirm('כבר יש כאן סיכום — לסכם מחדש ולאבד שינויים שערכת?')) return
    setAnalyzing(true)
    setAnalyzeError(null)
    try {
      const result = await backendFetch('/api/voice-log/analyze', {
        method: 'POST',
        body: JSON.stringify({ transcript }),
      })
      setAnalysis(result)
      setSelectedRoute(result.route === 'unclear' ? null : result.route)
      setColumnLabel(result.column_label || '')
      const { certain } = matchTeacher(result.teacher_name_spoken, teachers)
      setSelectedTeacherId(certain?.id ?? null)
      setOverrideMatch(false)
    } catch (err) {
      setAnalyzeError(err instanceof TypeError ? 'שגיאת רשת — יש לבדוק את החיבור ולנסות שוב' : err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  function saveWithoutSummary() {
    setAnalyzeError(null)
    setAnalysis({ route: 'teacher_call', summary: transcript, action_items: [], mentioned_dates: [], teacher_name_spoken: null, column_label: null })
    setSelectedRoute('teacher_call')
    setSelectedTeacherId(null)
  }

  async function saveInteraction(targetContactId, targetName) {
    const { error } = await supabase.from('interactions').insert({
      contact_id: targetContactId,
      type: 'phone_call',
      content: analysis.summary,
      metadata: {
        transcript,
        action_items: analysis.action_items,
        mentioned_dates: analysis.mentioned_dates,
        teacher_name_spoken: analysis.teacher_name_spoken,
        confirmed_by_user: true,
        source: 'voice_pwa',
        route: selectedRoute,
      },
    })
    if (error) throw error

    const datedItems = analysis.action_items.filter(item => item.due_date)
    const calendarFailureCount = (
      await Promise.allSettled(
        datedItems.map(item =>
          backendFetch('/api/google/create-event', {
            method: 'POST',
            body: JSON.stringify({
              title: `${item.text} — ${targetName}`,
              date: item.due_date,
              notes: analysis.summary,
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

  async function confirmAndSave() {
    if (!selectedRoute) {
      alert('יש לבחור סוג תיעוד לפני השמירה')
      return
    }
    if (selectedRoute === 'teacher_call' && !selectedTeacherId) {
      alert('יש לבחור מורה לפני השמירה')
      return
    }
    if (selectedRoute === 'admin_task' && !adminContactId) {
      alert('שגיאה: רשומת מנהל המערכת לא נמצאה — נסה לרענן את העמוד')
      return
    }
    if (selectedRoute === 'new_task_column' && !columnLabel.trim()) {
      alert('יש להזין כותרת לעמודה')
      return
    }

    setSaving(true)
    setSaveResult(null)
    try {
      if (selectedRoute === 'new_task_column') {
        const savedLabel = await addCustomColumnFromVoice(columnLabel)
        setSaveResult({ ok: true, columnLabel: savedLabel })
      } else {
        const targetContactId = selectedRoute === 'admin_task' ? adminContactId : selectedTeacherId
        const targetName = selectedRoute === 'admin_task'
          ? ADMIN_ROW_NAME
          : (teachers.find(t => t.id === selectedTeacherId)?.name || '')
        const calendarWarning = await saveInteraction(targetContactId, targetName)
        setSaveResult({ ok: true, calendarWarning })
      }
      reset()
      setAnalysis(null)
      setSelectedRoute(null)
      setColumnLabel('')
      setSelectedTeacherId(null)
      setManualSearch('')
    } catch (err) {
      setSaveResult({
        ok: false,
        message: 'שמירה נכשלה: ' + (err instanceof TypeError ? 'שגיאת רשת — יש לבדוק את החיבור ולנסות שוב' : err.message),
      })
    } finally {
      setSaving(false)
    }
  }

  function startNewCall() {
    setAnalysis(null)
    setAnalyzeError(null)
    setSaveResult(null)
    setSelectedRoute(null)
    setColumnLabel('')
    setSelectedTeacherId(null)
    setOverrideMatch(false)
    setManualSearch('')
    start()
  }

  const matchResult = analysis ? matchTeacher(analysis.teacher_name_spoken, teachers) : { certain: null, candidates: [] }
  const filteredManual = manualSearch.trim()
    ? teachers.filter(t => t.name.includes(manualSearch.trim()))
    : []

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
          {analyzing ? 'מסכם...' : 'סכם'}
        </button>
      </div>

      {analyzeError && (
        <div className="text-center space-y-2">
          <p className="text-red-600">{analyzeError}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={analyze} className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100">
              נסה שוב
            </button>
            <button onClick={saveWithoutSummary} className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100">
              שמור בלי סיכום
            </button>
          </div>
        </div>
      )}

      {analysis && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-4 bg-white shadow-sm">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">סוג התיעוד</label>
            <div className="flex gap-2 flex-wrap">
              {ROUTES.map(r => (
                <button
                  key={r.value}
                  type="button"
                  disabled={saving}
                  onClick={() => setSelectedRoute(r.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors disabled:opacity-60 ${
                    selectedRoute === r.value
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {!selectedRoute && (
              <p className="text-orange-600 text-xs mt-1">לא זוהתה כוונה ברורה מההקלטה — יש לבחור ידנית</p>
            )}
          </div>

          {selectedRoute === 'teacher_call' && (
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">מורה שזוהה</label>
              {matchResult.certain && selectedTeacherId === matchResult.certain.id && !overrideMatch ? (
                <div className="flex items-center gap-2">
                  <p className="text-green-700 font-medium">✓ {matchResult.certain.name}</p>
                  <button
                    type="button"
                    onClick={() => { setOverrideMatch(true); setSelectedTeacherId(null) }}
                    className="text-sm text-blue-600 underline"
                  >
                    לא נכון? החלף/י מורה
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {matchResult.candidates.length > 0 && (
                    <select
                      value={selectedTeacherId ?? ''}
                      onChange={(e) => setSelectedTeacherId(e.target.value || null)}
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
                      value={selectedTeacherId ?? ''}
                      onChange={(e) => setSelectedTeacherId(e.target.value || null)}
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

          {(selectedRoute === 'teacher_call' || selectedRoute === 'admin_task') && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">סיכום</label>
                <textarea
                  value={analysis.summary}
                  onChange={(e) => setAnalysis({ ...analysis, summary: e.target.value })}
                  rows={3}
                  disabled={saving}
                  className="w-full border border-gray-300 rounded-lg p-2 text-right disabled:opacity-60"
                  dir="rtl"
                />
              </div>

              {analysis.action_items.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">מטלות המשך</label>
                  <ul className="space-y-1">
                    {analysis.action_items.map((item, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <span className="flex-1">{item.text}</span>
                        {item.due_date && <span className="text-gray-500">📅 {item.due_date}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {selectedRoute === 'new_task_column' && (
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

          <button
            onClick={confirmAndSave}
            disabled={saving || !selectedRoute}
            className="w-full py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40"
          >
            {saving ? 'שומר...' : selectedRoute === 'new_task_column' ? 'הוסף עמודה' : 'אשר ושמור'}
          </button>
        </div>
      )}

      {saveResult?.ok && (
        <div className="text-center text-green-700 space-y-1">
          {saveResult.columnLabel
            ? <p>✓ העמודה "{saveResult.columnLabel}" נוספה לטבלת אנשי הקשר</p>
            : <p>✓ השיחה נשמרה בהצלחה</p>}
          {saveResult.calendarWarning && <p className="text-orange-600 text-sm">{saveResult.calendarWarning}</p>}
        </div>
      )}
      {saveResult && !saveResult.ok && (
        <p className="text-center text-red-600">{saveResult.message}</p>
      )}
    </div>
  )
}
