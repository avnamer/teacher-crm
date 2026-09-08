# Voice Call Logging (PWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user log a phone call with a teacher by voice on their phone — on-device transcription, Claude-powered summary/action-item extraction, teacher matching, save to the CRM, and dated action items pushed to Google Calendar.

**Architecture:** New Express routes (`/api/voice-log/analyze`, `/api/google/create-event`) added to the existing backend; a new `/voice-log` React page added to the existing frontend, using the browser's `SpeechRecognition` API for transcription and writing to the existing `interactions` table (no schema changes). A basic PWA manifest + service worker make the app installable as "Tech-School CRM".

**Tech Stack:** Express (existing), `@anthropic-ai/sdk` (new), `googleapis` (existing, extended scope), React 19 + Vite + Tailwind (existing), Web Speech API (browser-native, no new dependency).

**Spec:** [`docs/superpowers/specs/2026-09-08-voice-call-logging-design.md`](../specs/2026-09-08-voice-call-logging-design.md)

**Testing note:** This project has no automated test framework (no Jest/Vitest/Playwright installed anywhere in the repo). Consistent with that, every task below ends in a **manual verification step** (a `curl`/`node -e` command or a browser check) instead of an automated test suite.

---

### Task 1: Claude analysis endpoint (backend)

**Files:**
- Create: `backend/src/services/claudeAnalyze.js`
- Create: `backend/src/routes/voiceLog.js`
- Modify: `backend/server.js`
- Modify: `backend/package.json`
- Modify: `backend/.env`

- [ ] **Step 1: Add the Anthropic SDK dependency**

Run:
```bash
cd backend && npm install @anthropic-ai/sdk
```
Expected: `package.json` gains `"@anthropic-ai/sdk": "^0.x.x"` under `dependencies`, and `package-lock.json` updates.

- [ ] **Step 2: Add your Anthropic API key to `backend/.env`**

Open `backend/.env` and add this line (fill in your real key — this file is git-ignored, it will not be committed):
```
ANTHROPIC_API_KEY=sk-ant-your-real-key-here
```

- [ ] **Step 3: Write the analysis service**

Create `backend/src/services/claudeAnalyze.js`:
```js
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `אתה עוזר שמנתח תמרול של שיחת טלפון בין מורה מנטור לבין מורה בבית ספר.
החזר אך ורק JSON תקני בפורמט הבא, בלי שום טקסט נוסף לפניו או אחריו:
{
  "teacher_name_spoken": "השם שנאמר עבור המורה, כפי שנשמע בתמלול",
  "summary": "סיכום קצר של השיחה, 2-3 משפטים",
  "action_items": [ { "text": "תיאור המטלה", "due_date": "YYYY-MM-DD או null אם לא הוזכר תאריך" } ],
  "mentioned_dates": ["YYYY-MM-DD"]
}
אם לא הוזכר שם מורה, החזר "teacher_name_spoken": null. אם אין מטלות המשך, החזר "action_items": [].`

function extractJson(text) {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  return fenced ? fenced[1].trim() : trimmed
}

export async function analyzeCallTranscript(transcript) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcript }],
  })

  const text = response.content?.[0]?.text
  if (!text) throw new Error('תשובה ריקה מ-Claude')

  let parsed
  try {
    parsed = JSON.parse(extractJson(text))
  } catch {
    throw new Error('התשובה מ-Claude לא הייתה JSON תקני')
  }

  return {
    teacher_name_spoken: parsed.teacher_name_spoken ?? null,
    summary: parsed.summary ?? '',
    action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
    mentioned_dates: Array.isArray(parsed.mentioned_dates) ? parsed.mentioned_dates : [],
  }
}
```

- [ ] **Step 4: Write the route**

Create `backend/src/routes/voiceLog.js`:
```js
import { Router } from 'express'
import { analyzeCallTranscript } from '../services/claudeAnalyze.js'

const router = Router()

// POST /api/voice-log/analyze
router.post('/analyze', async (req, res) => {
  const { transcript } = req.body
  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ message: 'לא התקבל תמלול' })
  }
  try {
    const result = await analyzeCallTranscript(transcript)
    res.json(result)
  } catch (err) {
    console.error('[voice-log/analyze]', err)
    res.status(500).json({ message: 'ניתוח השיחה נכשל: ' + err.message })
  }
})

export default router
```

- [ ] **Step 5: Mount the route**

Modify `backend/server.js` — read the current file first, then add the import and mount line next to the existing `googleRouter` wiring:
```js
import voiceLogRouter from './src/routes/voiceLog.js'
```
```js
app.use('/api/voice-log', voiceLogRouter)
```

- [ ] **Step 6: Manual verification**

Run: `cd backend && npm run dev`
Then in another terminal:
```bash
curl -X POST http://localhost:3001/api/voice-log/analyze \
  -H "Content-Type: application/json" \
  -d '{"transcript":"שיחה עם רותי לוי. דיברנו על התלמידה שמתקשה במתמטיקה, היא תשלח לי דוח עד יום חמישי הקרוב."}'
```
Expected: a `200` JSON response with `teacher_name_spoken` ≈ "רותי לוי", a non-empty `summary`, and at least one `action_items` entry.

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/server.js backend/src/services/claudeAnalyze.js backend/src/routes/voiceLog.js
git commit -m "feat: add Claude-powered call transcript analysis endpoint"
```
(`backend/.env` is git-ignored — it will not appear in `git status`; that's expected.)

---

### Task 2: Google Calendar write access + create-event endpoint (backend)

**Files:**
- Modify: `backend/src/routes/google.js:9-12`
- Modify: `backend/src/services/calendarSync.js`

- [ ] **Step 1: Extend the OAuth scope to include calendar writes**

In `backend/src/routes/google.js`, change the `/auth` route's `scope` array from:
```js
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
```
to:
```js
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ],
```

- [ ] **Step 2: Add a `createCalendarEvent` function**

Modify `backend/src/services/calendarSync.js` — add this function after `syncCalendarMeetings` (keep everything else in the file unchanged):
```js
// ─── Create a calendar event for a call-log action item ───────────────────

export async function createCalendarEvent({ title, date, notes }) {
  const tokens = loadTokens()
  if (!tokens) {
    const err = new Error('לא נמצאו טוקנים של Google — בצע אימות תחילה')
    err.code = 'NO_TOKENS'
    throw err
  }
  if (!tokens.scope || !tokens.scope.includes('calendar.events')) {
    const err = new Error('אין הרשאת כתיבה ליומן — יש להתחבר מחדש ל-Google')
    err.code = 'MISSING_SCOPE'
    throw err
  }

  const auth = getOAuth2Client()
  auth.setCredentials(tokens)

  if (tokens.expiry_date && Date.now() > tokens.expiry_date - 60000) {
    const { credentials } = await auth.refreshAccessToken()
    saveTokens(credentials)
    auth.setCredentials(credentials)
  }

  const calendar = google.calendar({ version: 'v3', auth })
  const nextDay = new Date(date)
  nextDay.setDate(nextDay.getDate() + 1)
  const endDate = nextDay.toISOString().slice(0, 10)

  const { data } = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      description: notes || '',
      start: { date },
      end: { date: endDate },
    },
  })

  return { eventId: data.id }
}
```

- [ ] **Step 3: Add the route**

Modify `backend/src/routes/google.js` — add the import and route:
```js
import { getOAuth2Client, saveTokens, loadTokens, syncCalendarMeetings, createCalendarEvent } from '../services/calendarSync.js'
```
```js
// POST /api/google/create-event
router.post('/create-event', async (req, res) => {
  const { title, date, notes } = req.body
  if (!title || !date) {
    return res.status(400).json({ message: 'חסר כותרת או תאריך' })
  }
  try {
    const result = await createCalendarEvent({ title, date, notes })
    res.json(result)
  } catch (err) {
    console.error('[google/create-event]', err)
    res.status(err.code === 'NO_TOKENS' || err.code === 'MISSING_SCOPE' ? 401 : 500).json({ message: err.message })
  }
})
```

- [ ] **Step 4: Re-authorize with the new scope**

Run: `cd backend && npm run dev` (if not already running)
Open in a browser: `http://localhost:3001/api/google/auth`, sign in as `avnamer@gmail.com`, and grant the requested calendar access. Expected: "✅ אימות Google הושלם בהצלחה!" page. This overwrites `.google-tokens.json` with a token that now carries the `calendar.events` scope.

- [ ] **Step 5: Manual verification**

```bash
curl -X POST http://localhost:3001/api/google/create-event \
  -H "Content-Type: application/json" \
  -d '{"title":"בדיקה - למחוק","date":"2026-09-15","notes":"בדיקת יצירת אירוע"}'
```
Expected: `200` with `{"eventId": "..."}`. Check `avnamer@gmail.com`'s Google Calendar on 2026-09-15 for an all-day event "בדיקה - למחוק", then delete it manually from the calendar.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/google.js backend/src/services/calendarSync.js
git commit -m "feat: add write-scoped Google Calendar event creation"
```

---

### Task 3: Teacher fuzzy-matching module (frontend)

**Files:**
- Create: `frontend/src/lib/teacherMatch.js`

- [ ] **Step 1: Write the module**

Create `frontend/src/lib/teacherMatch.js`:
```js
function normalize(str) {
  return (str || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[m][n]
}

function similarity(a, b) {
  if (!a || !b) return 0
  const dist = levenshtein(a, b)
  const maxLen = Math.max(a.length, b.length) || 1
  return 1 - dist / maxLen
}

const CERTAIN_THRESHOLD = 0.75
const CANDIDATE_THRESHOLD = 0.5
const MAX_CANDIDATES = 5

// Matches a spoken name against a list of { id, name } teachers.
// Returns { certain: teacher|null, candidates: teacher[] }.
export function matchTeacher(spokenName, teachers) {
  const spoken = normalize(spokenName)
  if (!spoken || !teachers?.length) return { certain: null, candidates: [] }

  const scored = teachers
    .map(teacher => ({ teacher, score: similarity(spoken, normalize(teacher.name)) }))
    .sort((a, b) => b.score - a.score)

  const certain = scored.filter(s => s.score >= CERTAIN_THRESHOLD)
  if (certain.length === 1) {
    return { certain: certain[0].teacher, candidates: [] }
  }
  if (certain.length > 1) {
    return { certain: null, candidates: certain.map(s => s.teacher) }
  }

  const loose = scored.filter(s => s.score >= CANDIDATE_THRESHOLD).slice(0, MAX_CANDIDATES)
  return { certain: null, candidates: loose.map(s => s.teacher) }
}
```

- [ ] **Step 2: Manual verification**

Run from `frontend/`:
```bash
node -e "import('./src/lib/teacherMatch.js').then(m => {
  const teachers = [{ id: 1, name: 'רותי לוי' }, { id: 2, name: 'דנה כהן' }]
  console.log(JSON.stringify(m.matchTeacher('רותי לוי', teachers)))
  console.log(JSON.stringify(m.matchTeacher('רותי לוו', teachers)))
  console.log(JSON.stringify(m.matchTeacher('מישהי אחרת', teachers)))
})"
```
Expected: first call returns `certain` = the id-1 teacher; second call (typo) also returns `certain` = id-1 (similarity above 0.75); third call returns `certain: null` with an empty or low-relevance `candidates` list.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/teacherMatch.js
git commit -m "feat: add fuzzy teacher-name matching for voice call logging"
```

---

### Task 4: Speech-to-text hook (frontend)

**Files:**
- Create: `frontend/src/hooks/useSpeechToText.js`

- [ ] **Step 1: Write the hook**

Create `frontend/src/hooks/useSpeechToText.js`:
```js
import { useCallback, useEffect, useRef, useState } from 'react'

// Isolated speech-to-text module. Swap this file's internals for a
// Whisper-based implementation later without touching any consumer —
// the returned interface (supported, listening, transcript, start, stop,
// reset, setTranscript, error) is the contract callers rely on.
export function useSpeechToText({ lang = 'he-IL' } = {}) {
  const [supported] = useState(() => Boolean(
    typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
  ))
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState(null)
  const recognitionRef = useRef(null)
  const finalTextRef = useRef('')

  useEffect(() => {
    if (!supported) return
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.lang = lang
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTextRef.current += text + ' '
        } else {
          interim += text
        }
      }
      setTranscript((finalTextRef.current + interim).trim())
    }

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        setError('הגישה למיקרופון נחסמה — יש לאפשר הרשאת מיקרופון בהגדרות הדפדפן')
      } else if (event.error !== 'no-speech') {
        setError('שגיאת הכתבה: ' + event.error)
      }
    }

    recognition.onend = () => setListening(false)

    recognitionRef.current = recognition
    return () => recognition.stop()
  }, [supported, lang])

  const start = useCallback(() => {
    if (!recognitionRef.current) return
    setError(null)
    finalTextRef.current = ''
    setTranscript('')
    recognitionRef.current.start()
    setListening(true)
  }, [])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  const reset = useCallback(() => {
    finalTextRef.current = ''
    setTranscript('')
    setError(null)
  }, [])

  return { supported, listening, transcript, setTranscript, start, stop, reset, error }
}
```

- [ ] **Step 2: Manual verification**

This is browser-only (no Node equivalent for `SpeechRecognition`) — verified together with the page in Task 5. For now, confirm the file has no syntax errors:
```bash
cd frontend && node --check src/hooks/useSpeechToText.js
```
Expected: no output (exit code 0).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useSpeechToText.js
git commit -m "feat: add isolated Web Speech API transcription hook"
```

---

### Task 5: Voice Log page — recording and transcript editing

**Files:**
- Create: `frontend/src/pages/VoiceLog.jsx`

- [ ] **Step 1: Write the initial page (recording UI only)**

Create `frontend/src/pages/VoiceLog.jsx`:
```jsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useSpeechToText } from '../hooks/useSpeechToText.js'

const MENTOR = 'אבנר'

export default function VoiceLog() {
  const { supported, listening, transcript, setTranscript, start, stop, reset, error: speechError } = useSpeechToText()
  const [teachers, setTeachers] = useState([])

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
      return
    }
    setTeachers((data || []).filter(c => c.custom_fields?.mentor_name === MENTOR))
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
      <h1 className="text-2xl font-bold text-gray-800 text-center">תיעוד שיחת טלפון</h1>

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
          disabled={!transcript}
          className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
        >
          נקה
        </button>
      </div>
    </div>
  )
}
```

(Task 6 below replaces this whole file with a version that adds analysis on top of this same recording UI — `teachers` here is loaded correctly from the start so Task 6's diff is additive only.)

- [ ] **Step 2: Wire the route and nav link**

Modify `frontend/src/App.jsx` — add the import:
```js
import VoiceLog from './pages/VoiceLog.jsx'
```
and add the route inside the `<Route element={<Layout />}>` block, next to `/meetings`:
```jsx
        <Route path="/voice-log" element={<VoiceLog />} />
```

Modify `frontend/src/components/Navbar.jsx:4-13` — add an entry to the `links` array, after `/meetings`:
```js
  { to: '/voice-log', label: 'תיעוד שיחה', icon: '🎙' },
```

- [ ] **Step 3: Manual verification**

Run: `cd frontend && npm run dev`, open the app on an Android phone with Chrome (same Wi-Fi network, using the machine's LAN IP and Vite's dev server — or `npm run dev -- --host`), navigate to "תיעוד שיחה". Tap "🎙 דבר", speak a sentence in Hebrew, tap "⏹ עצור". Expected: the spoken text appears in the textarea; it can be edited by tapping into it.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/VoiceLog.jsx frontend/src/App.jsx frontend/src/components/Navbar.jsx
git commit -m "feat: add voice call recording page with live transcript"
```

---

### Task 6: Voice Log page — analyze, match, and confirm

**Files:**
- Modify: `frontend/src/pages/VoiceLog.jsx`

- [ ] **Step 1: Add analysis + matching state and the "סכם" flow**

Modify `frontend/src/pages/VoiceLog.jsx` — replace the full file with this version (adds analysis, matching, and a confirmation card below the transcript editor; the recording UI from Task 5 is unchanged):
```jsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { backendFetch } from '../lib/api.js'
import { useSpeechToText } from '../hooks/useSpeechToText.js'
import { matchTeacher } from '../lib/teacherMatch.js'

const MENTOR = 'אבנר'

export default function VoiceLog() {
  const { supported, listening, transcript, setTranscript, start, stop, reset, error: speechError } = useSpeechToText()
  const [teachers, setTeachers] = useState([])
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState(null)
  const [analysis, setAnalysis] = useState(null) // { summary, action_items, mentioned_dates, teacher_name_spoken }
  const [selectedTeacherId, setSelectedTeacherId] = useState(null)
  const [manualSearch, setManualSearch] = useState('')

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
    } catch (err) {
      setAnalyzeError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  function saveWithoutSummary() {
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
            {matchResult.certain && selectedTeacherId === matchResult.certain.id ? (
              <p className="text-green-700 font-medium">✓ {matchResult.certain.name}</p>
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
```

- [ ] **Step 2: Manual verification**

With `backend` and `frontend` dev servers running, on the phone: record a sentence like "שיחה עם [שם מורה קיימת אצלך במערכת]. דיברנו על X, היא תשלח לי דוח עד יום חמישי." Tap "סכם". Expected: after a few seconds, a card appears showing the matched teacher (or a picklist/search if ambiguous), an editable summary, and any action items with dates.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/VoiceLog.jsx
git commit -m "feat: add call analysis, teacher matching, and confirmation card"
```

---

### Task 7: Voice Log page — save to CRM and push to Google Calendar

**Files:**
- Modify: `frontend/src/pages/VoiceLog.jsx`

- [ ] **Step 1: Add the save handler and confirm button**

Modify `frontend/src/pages/VoiceLog.jsx` — add these two pieces of state near the top of the component, alongside the existing `useState` calls:
```js
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState(null) // { ok, calendarWarning? }
```

Add this function, near `saveWithoutSummary`:
```js
  async function confirmAndSave() {
    if (!selectedTeacherId) {
      alert('יש לבחור מורה לפני השמירה')
      return
    }
    setSaving(true)
    setSaveResult(null)
    try {
      const { error } = await supabase.from('interactions').insert({
        contact_id: selectedTeacherId,
        type: 'phone_call',
        content: analysis.summary,
        metadata: {
          transcript,
          action_items: analysis.action_items,
          mentioned_dates: analysis.mentioned_dates,
          teacher_name_spoken: analysis.teacher_name_spoken,
          confirmed_by_user: true,
          source: 'voice_pwa',
        },
      })
      if (error) throw error

      let calendarWarning = null
      const teacherName = teachers.find(t => t.id === selectedTeacherId)?.name || ''
      for (const item of analysis.action_items) {
        if (!item.due_date) continue
        try {
          await backendFetch('/api/google/create-event', {
            method: 'POST',
            body: JSON.stringify({
              title: `${item.text} — ${teacherName}`,
              date: item.due_date,
              notes: analysis.summary,
            }),
          })
        } catch (err) {
          calendarWarning = 'השיחה נשמרה, אך יצירת אירוע ביומן נכשלה: ' + err.message
        }
      }

      setSaveResult({ ok: true, calendarWarning })
      reset()
      setAnalysis(null)
      setSelectedTeacherId(null)
    } catch (err) {
      setSaveResult({ ok: false, message: 'שמירה נכשלה: ' + err.message })
    } finally {
      setSaving(false)
    }
  }
```

Add the confirm button and result banner at the end of the `{analysis && (...)}` card, right before its closing `</div>`:
```jsx
          <button
            onClick={confirmAndSave}
            disabled={saving || !selectedTeacherId}
            className="w-full py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40"
          >
            {saving ? 'שומר...' : 'אשר ושמור'}
          </button>
```

Add the result banner just below the closing `</div>` of the `{analysis && (...)}` block (still inside the outer page `<div>`):
```jsx
      {saveResult?.ok && (
        <div className="text-center text-green-700 space-y-1">
          <p>✓ השיחה נשמרה בהצלחה</p>
          {saveResult.calendarWarning && <p className="text-orange-600 text-sm">{saveResult.calendarWarning}</p>}
        </div>
      )}
      {saveResult && !saveResult.ok && (
        <p className="text-center text-red-600">{saveResult.message}</p>
      )}
```

- [ ] **Step 2: Manual verification**

Full end-to-end on the phone: record → סכם → confirm the matched teacher → אשר ושמור. Expected: "✓ השיחה נשמרה בהצלחה" appears; open that teacher's page (`/contacts/:id`) in the CRM and confirm the new `phone_call` interaction shows up in their history with the summary text. If the transcript mentioned a dated action item, check `avnamer@gmail.com`'s Google Calendar for the new event, then delete the test event and interaction row afterward if this was a test call.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/VoiceLog.jsx
git commit -m "feat: save voice call log to CRM and push action items to Google Calendar"
```

---

### Task 8: PWA installability ("Tech-School CRM")

**Files:**
- Create: `frontend/public/pwa-icon.svg`
- Create: `frontend/public/manifest.webmanifest`
- Create: `frontend/public/sw.js`
- Modify: `frontend/index.html`
- Modify: `frontend/src/main.jsx`

- [ ] **Step 1: Add an app icon**

Create `frontend/public/pwa-icon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
  <rect width="192" height="192" rx="32" fill="#2563eb"/>
  <text x="96" y="128" font-size="96" text-anchor="middle" dominant-baseline="middle">🎓</text>
</svg>
```

- [ ] **Step 2: Add the manifest**

Create `frontend/public/manifest.webmanifest`:
```json
{
  "name": "Tech-School CRM",
  "short_name": "Tech-School CRM",
  "description": "מערכת ניהול קשר עם מורים",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f9fafb",
  "theme_color": "#2563eb",
  "dir": "rtl",
  "lang": "he",
  "icons": [
    { "src": "/pwa-icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 3: Add a minimal service worker**

Create `frontend/public/sw.js`:
```js
// Minimal service worker — required for "Add to Home Screen" installability.
// No offline caching: every request passes straight through to the network.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
```

- [ ] **Step 4: Link the manifest and register the service worker**

Modify `frontend/index.html` — add these lines inside `<head>`, after the existing `<link rel="icon" ...>`:
```html
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#2563eb" />
    <link rel="apple-touch-icon" href="/pwa-icon.svg" />
```

Modify `frontend/src/main.jsx` — add this block at the end of the file:
```js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
  })
}
```

- [ ] **Step 5: Manual verification**

Run: `cd frontend && npm run build && npm run preview -- --host`
Open the preview URL on the Android phone over HTTPS or `localhost` (Chrome requires a secure context for service workers — `http://<lan-ip>` will **not** register the service worker; use `npm run preview` on the phone itself via port forwarding, or test this step against the deployed Netlify URL once available). Expected: Chrome's menu shows "Add to Home Screen" / "Install app", offering the name "Tech-School CRM" with the graduation-cap icon.

- [ ] **Step 6: Commit**

```bash
git add frontend/public/pwa-icon.svg frontend/public/manifest.webmanifest frontend/public/sw.js frontend/index.html frontend/src/main.jsx
git commit -m "feat: make the app installable as a PWA (Tech-School CRM)"
```

---

## Post-plan follow-ups (not part of this plan)

- Online deployment (Netlify + backend host) is a prerequisite for testing the service worker over a real HTTPS origin — see `docs/CHECKPOINT-v1.md`.
- WhatsApp Desktop conversation scanning remains an unscoped future idea (see `docs/CHECKPOINT-v1.md`).
