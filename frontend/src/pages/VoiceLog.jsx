import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { backendFetch } from '../lib/api.js'
import { useSpeechToText } from '../hooks/useSpeechToText.js'
import { matchTeacher } from '../lib/teacherMatch.js'

const MENTOR = 'אבנר'

export default function VoiceLog() {
  const { supported, listening, transcript, setTranscript, start, stop, reset, error: speechError } = useSpeechToText()
  const [teachers, setTeachers] = useState([])
  const [teachersError, setTeachersError] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState(null)
  const [analysis, setAnalysis] = useState(null) // { summary, action_items, mentioned_dates, teacher_name_spoken }
  const [selectedTeacherId, setSelectedTeacherId] = useState(null)
  const [manualSearch, setManualSearch] = useState('')
  const [overrideMatch, setOverrideMatch] = useState(false)

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
    try {
      const result = await backendFetch('/api/voice-log/analyze', {
        method: 'POST',
        body: JSON.stringify({ transcript }),
      })
      setAnalysis(result)
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
    setAnalysis({ summary: transcript, action_items: [], mentioned_dates: [], teacher_name_spoken: null })
    setSelectedTeacherId(null)
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
      <h1 className="text-2xl font-bold text-gray-800 text-center">תיעוד שיחת טלפון</h1>

      {teachersError && <p className="text-red-600 text-center">{teachersError}</p>}

      <div className="flex justify-center">
        <button
          onClick={listening ? stop : start}
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
                    className="w-full border border-gray-300 rounded-lg p-2"
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
                  className="w-full border border-gray-300 rounded-lg p-2 text-right"
                  dir="rtl"
                />
                {filteredManual.length > 0 && (
                  <select
                    value={selectedTeacherId ?? ''}
                    onChange={(e) => setSelectedTeacherId(e.target.value || null)}
                    className="w-full border border-gray-300 rounded-lg p-2"
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

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">סיכום</label>
            <textarea
              value={analysis.summary}
              onChange={(e) => setAnalysis({ ...analysis, summary: e.target.value })}
              rows={3}
              className="w-full border border-gray-300 rounded-lg p-2 text-right"
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
        </div>
      )}
    </div>
  )
}
