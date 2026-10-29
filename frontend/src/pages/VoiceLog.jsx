import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { backendFetch } from '../lib/api.js'
import { useSpeechToText } from '../hooks/useSpeechToText.js'
import { matchTeacher } from '../lib/teacherMatch.js'
import { insertPendingVoiceLog, fetchPendingVoiceLogs } from '../lib/pendingVoiceLog.js'
import { isCompletedMeeting } from '../lib/meetings.js'
import { isAdminTaskRecording, addAdminTasksFromVoice } from '../lib/adminTasks.js'

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
      .select('id, name, phone, custom_fields')
      .eq('role', 'מורה מוביל/ה')
    if (error) {
      console.error('שגיאה בטעינת מורות:', error)
      setTeachersError('שגיאה בטעינת רשימת המורות שלך')
      return
    }
    setTeachers((data || []).filter(c => c.custom_fields?.mentor_name === MENTOR))
  }

  // ── "Who to call next" (for the road) ──
  // lastContactMap: contactId -> ISO date of the latest phone call / held meeting / pending
  // voice log. handledIds: teachers already dealt with this session (didn't answer, or call saved).
  const [lastContactMap, setLastContactMap] = useState({})
  const [handledIds, setHandledIds] = useState(() => new Set())
  const [callPhase, setCallPhase] = useState(null) // null | 'called' | 'recording'
  const [callSaving, setCallSaving] = useState(false)
  const [callError, setCallError] = useState(null)

  async function loadLastContacts() {
    const map = {}
    const note = (id, at) => { if (id && at && (!map[id] || at > map[id])) map[id] = at }
    const { data, error } = await supabase
      .from('interactions')
      .select('contact_id, created_at, type, metadata')
      .in('type', ['phone_call', 'meeting'])
      .order('created_at', { ascending: false })
    if (error) { console.error('שגיאה בטעינת קשר אחרון:', error); return }
    for (const row of data || []) {
      if (row.metadata?.route?.startsWith?.('teacher_task')) continue
      if (row.type === 'phone_call' || isCompletedMeeting(row)) note(row.contact_id, row.created_at)
    }
    // A call that was just logged is still waiting for approval, not yet an interaction.
    try {
      for (const log of await fetchPendingVoiceLogs(MENTOR)) {
        if (log.communication_type && !log.route?.startsWith?.('teacher_task')) note(log.matched_contact_id, log.created_at)
      }
    } catch (err) {
      console.error('שגיאה בטעינת תיעודים ממתינים:', err)
    }
    setLastContactMap(map)
  }

  useEffect(() => {
    loadMyTeachers()
    loadLastContacts()
  }, [])

  // Longest time since a call/meeting first; teachers never spoken to come before everyone.
  const nextTeacher = teachers
    .filter(t => !handledIds.has(t.id) && t.phone)
    .sort((a, b) => (lastContactMap[a.id] || '').localeCompare(lastContactMap[b.id] || ''))[0] || null

  function daysSince(iso) {
    return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null
  }

  function advanceFrom(teacherId, at) {
    setHandledIds(prev => new Set(prev).add(teacherId))
    if (at) setLastContactMap(prev => ({ ...prev, [teacherId]: at }))
    setCallPhase(null)
    setCallError(null)
  }

  async function finishCallRecording() {
    const jobTranscript = transcript.trim()
    stop()
    if (!jobTranscript) { setCallPhase('called'); return }
    reset()
    setCallSaving(true)
    setCallError(null)
    const teacher = nextTeacher
    try {
      // Naming the teacher up front helps the analysis; the match itself is forced below.
      const ok = await runAnalyze(null, `שיחה עם ${teacher.name}. ${jobTranscript}`, teacher)
      if (ok) advanceFrom(teacher.id, new Date().toISOString())
      else setCallPhase('called')
    } finally {
      setCallSaving(false)
    }
  }

  function updateJob(id, patch) {
    setJobs(prev => prev.map(j => (j.id === id ? { ...j, ...patch } : j)))
  }

  function removeJob(id) {
    setJobs(prev => prev.filter(j => j.id !== id))
  }

  function markDone(id, doneMessage = '✓ נשמר, ממתין לאישור') {
    updateJob(id, { status: 'done', doneMessage })
    // Auto-clear the confirmation row after a bit rather than piling up checkmarks
    // while the mentor keeps dictating and saving more calls back to back.
    setTimeout(() => removeJob(id), 4000)
  }

  // forcedTeacher: the call flow already knows who was phoned, so no name matching is needed.
  // Without a job id the caller handles status itself; resolves true when saved.
  async function runAnalyze(id, jobTranscript, forcedTeacher = null) {
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
        matched_contact_id: forcedTeacher ? forcedTeacher.id : certain?.id ?? null,
        communication_type: result.communication_type || (forcedTeacher ? 'phone_call' : null),
        summary: result.summary || null,
        action_items: result.action_items || [],
        mentioned_dates: result.mentioned_dates || [],
        column_label: result.column_label || null,
        extra: {
          meeting_date: result.meeting_date || null,
          destination: result.destination || null,
          distance_km: result.distance_km ?? null,
          future_meetings: result.future_meetings || [],
        },
      })
      if (id) markDone(id)
      return true
    } catch (err) {
      if (id) updateJob(id, { status: 'error', message: errorMessage(err) })
      else setCallError(errorMessage(err))
      return false
    }
  }

  function errorMessage(err) {
    return err instanceof TypeError ? 'שגיאת רשת — יש לבדוק את החיבור ולנסות שוב' : err.message
  }

  function tasksSavedMessage(n) {
    return n === 1 ? '✓ נשמרה משימה ב"המשימות שלי"' : `✓ נשמרו ${n} משימות ב"המשימות שלי"`
  }

  // A task for the admin ("משימה לעצמי ..."): no teacher, no interaction type, no
  // approval queue — Claude only splits it into separate tasks (with due dates), and
  // they go straight to the dashboard's "המשימות שלי" panel.
  async function runAdminTasks(id, jobTranscript) {
    try {
      const { tasks } = await backendFetch('/api/voice-log/admin-tasks', {
        method: 'POST',
        body: JSON.stringify({ transcript: jobTranscript }),
      })
      // Nothing recognizable as a task — keep the whole recording as one, rather than drop it.
      const toSave = tasks.length > 0 ? tasks : [{ text: jobTranscript.trim(), due_date: null, monthly: false }]
      const n = await addAdminTasksFromVoice(toSave, jobTranscript)
      markDone(id, tasksSavedMessage(n))
    } catch (err) {
      updateJob(id, { status: 'error', message: errorMessage(err) })
    }
  }

  // Fallback when splitting fails (e.g. no connectivity) — the transcript is saved as is,
  // as a single task, to be edited in the panel later.
  async function saveJobAsSingleTask(job) {
    updateJob(job.id, { status: 'processing', message: null })
    try {
      await addAdminTasksFromVoice([{ text: job.transcript.trim(), due_date: null, monthly: false }], job.transcript)
      markDone(job.id, tasksSavedMessage(1))
    } catch (err) {
      updateJob(job.id, { status: 'error', message: 'שמירה נכשלה: ' + errorMessage(err) })
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
        message: 'שמירה נכשלה: ' + errorMessage(err),
      })
    }
  }

  // Snapshots the current transcript into its own job and clears the live transcript
  // immediately (not after the network call resolves), so the mic is free to record
  // the next message right away — the analyze/save work for this one keeps running
  // in the background independently, and several jobs can be in flight at once.
  // A recording that opens with "משימה לעצמי" / "משימה למנהל המערכת" is saved as tasks
  // instead of going to the approval queue.
  function analyze() {
    if (!transcript.trim()) return
    const jobTranscript = transcript
    stop()
    reset()
    const id = crypto.randomUUID()
    const kind = isAdminTaskRecording(jobTranscript) ? 'task' : 'log'
    setJobs(prev => [{ id, kind, transcript: jobTranscript, status: 'processing', message: null }, ...prev])
    if (kind === 'task') runAdminTasks(id, jobTranscript)
    else runAnalyze(id, jobTranscript)
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

      {nextTeacher && (
        <div className="border border-gray-200 rounded-lg p-3 space-y-3" dir="rtl">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[21px] font-semibold text-gray-800 flex-1 min-w-[40%]">{nextTeacher.name}</span>
            <span className="text-[21px] text-gray-500">
              {lastContactMap[nextTeacher.id]
                ? `לפני ${daysSince(lastContactMap[nextTeacher.id])} ימים`
                : 'עוד לא דיברנו'}
            </span>
            <a
              href={`tel:${nextTeacher.phone.replace(/[^\d+]/g, '')}`}
              onClick={() => { setCallPhase('called'); setCallError(null) }}
              className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700"
            >
              📞 התקשר
            </a>
          </div>
          {callPhase && (
            <div className="flex gap-3 justify-center flex-wrap">
              <button
                onClick={() => advanceFrom(nextTeacher.id)}
                disabled={callSaving || listening}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
              >
                המורה לא ענה
              </button>
              <button
                onClick={() => {
                  if (callPhase === 'recording') { finishCallRecording() } else { setCallPhase('recording'); start() }
                }}
                disabled={callSaving || (listening && callPhase !== 'recording')}
                className={`px-4 py-2 rounded-lg text-white disabled:opacity-40 ${
                  callPhase === 'recording' ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {callSaving ? 'שומר...' : callPhase === 'recording' ? '⏹ סיימתי, שמור' : '🎙 על מה דיברנו'}
              </button>
            </div>
          )}
          {callPhase === 'recording' && transcript && <p className="text-sm text-gray-600">{transcript}</p>}
          {callError && <p className="text-red-600 text-center">{callError}</p>}
        </div>
      )}

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
              {job.status === 'done' && <p className="text-green-700">{job.doneMessage}</p>}
              {job.status === 'error' && (
                <div className="space-y-2">
                  <p className="text-red-600">{job.message}</p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => {
                        updateJob(job.id, { status: 'processing', message: null })
                        if (job.kind === 'task') runAdminTasks(job.id, job.transcript)
                        else runAnalyze(job.id, job.transcript)
                      }}
                      className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100"
                    >
                      נסה שוב
                    </button>
                    <button
                      onClick={() => (job.kind === 'task' ? saveJobAsSingleTask(job) : saveJobAsPending(job))}
                      className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100"
                    >
                      {job.kind === 'task' ? 'שמור כמשימה אחת בלי פיצול' : 'שמור בלי סיכום'}
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
