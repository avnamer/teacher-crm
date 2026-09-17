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
  // Queue of in-flight/finished analyze jobs, newest first. Each job carries its own
  // transcript snapshot and status so a new recording (and the "סכם ושמור" click that
  // follows it) never has to wait for an earlier job's network round-trip to finish.
  const [jobs, setJobs] = useState([])

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

  useEffect(() => {
    loadMyTeachers()
  }, [])

  function updateJob(id, patch) {
    setJobs(prev => prev.map(j => (j.id === id ? { ...j, ...patch } : j)))
  }

  function removeJob(id) {
    setJobs(prev => prev.filter(j => j.id !== id))
  }

  function markDone(id) {
    updateJob(id, { status: 'done' })
    // Auto-clear the confirmation row after a bit rather than piling up checkmarks
    // while the mentor keeps dictating and saving more calls back to back.
    setTimeout(() => removeJob(id), 4000)
  }

  async function runAnalyze(id, jobTranscript) {
    try {
      const result = await backendFetch('/api/voice-log/analyze', {
        method: 'POST',
        body: JSON.stringify({ transcript: jobTranscript }),
      })
      const { certain } = matchTeacher(result.teacher_name_spoken, teachers)
      await insertPendingVoiceLog({
        mentor_name: MENTOR,
        transcript: jobTranscript,
        route: result.route === 'unclear' ? null : result.route,
        teacher_name_spoken: result.teacher_name_spoken || null,
        matched_contact_id: certain?.id ?? null,
        communication_type: result.communication_type || null,
        summary: result.summary || null,
        action_items: result.action_items || [],
        mentioned_dates: result.mentioned_dates || [],
        column_label: result.column_label || null,
      })
      markDone(id)
    } catch (err) {
      updateJob(id, {
        status: 'error',
        message: err instanceof TypeError ? 'שגיאת רשת — יש לבדוק את החיבור ולנסות שוב' : err.message,
      })
    }
  }

  // Fallback when /analyze itself fails (e.g. no connectivity while traveling) — the
  // raw transcript is still saved as pending, with every classification field left
  // null, so the admin classifies it manually during approval instead of losing it.
  async function saveJobAsPending(job) {
    updateJob(job.id, { status: 'processing', message: null })
    try {
      await insertPendingVoiceLog({
        mentor_name: MENTOR,
        transcript: job.transcript,
        route: null,
        teacher_name_spoken: null,
        matched_contact_id: null,
        communication_type: null,
        summary: null,
        action_items: [],
        mentioned_dates: [],
        column_label: null,
      })
      markDone(job.id)
    } catch (err) {
      updateJob(job.id, {
        status: 'error',
        message: 'שמירה נכשלה: ' + (err instanceof TypeError ? 'שגיאת רשת — יש לבדוק את החיבור ולנסות שוב' : err.message),
      })
    }
  }

  // Snapshots the current transcript into its own job and clears the live transcript
  // immediately (not after the network call resolves), so the mic is free to record
  // the next message right away — the analyze/save work for this one keeps running
  // in the background independently, and several jobs can be in flight at once.
  function analyze() {
    if (!transcript.trim()) return
    const jobTranscript = transcript
    stop()
    reset()
    const id = crypto.randomUUID()
    setJobs(prev => [{ id, transcript: jobTranscript, status: 'processing', message: null }, ...prev])
    runAnalyze(id, jobTranscript)
  }

  function startNewCall() {
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
          disabled={!transcript}
          className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
        >
          נקה
        </button>
        <button
          onClick={analyze}
          disabled={!transcript.trim()}
          className="px-6 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40"
        >
          סכם ושמור
        </button>
      </div>

      {jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map(job => (
            <div key={job.id} className="border border-gray-200 rounded-lg p-3 text-right" dir="rtl">
              <p className="text-sm text-gray-500 truncate">{job.transcript}</p>
              {job.status === 'processing' && <p className="text-blue-600">שומר...</p>}
              {job.status === 'done' && <p className="text-green-700">✓ נשמר, ממתין לאישור</p>}
              {job.status === 'error' && (
                <div className="space-y-2">
                  <p className="text-red-600">{job.message}</p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => {
                        updateJob(job.id, { status: 'processing', message: null })
                        runAnalyze(job.id, job.transcript)
                      }}
                      className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100"
                    >
                      נסה שוב
                    </button>
                    <button
                      onClick={() => saveJobAsPending(job)}
                      className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100"
                    >
                      שמור בלי סיכום
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
