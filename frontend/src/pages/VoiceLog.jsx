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
