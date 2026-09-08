import { Router } from 'express'
import { getOAuth2Client, saveTokens, loadTokens, syncCalendarMeetings, createCalendarEvent } from '../services/calendarSync.js'

const router = Router()

// GET /api/google/auth — open in browser to authorize
router.get('/auth', (_req, res) => {
  const auth = getOAuth2Client()
  const url = auth.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    prompt: 'consent',
  })
  res.redirect(url)
})

// GET /api/google/callback — OAuth redirect
router.get('/callback', async (req, res) => {
  const { code, error } = req.query
  if (error) return res.status(400).send('שגיאת אימות: ' + error)
  try {
    const auth = getOAuth2Client()
    const { tokens } = await auth.getToken(code)
    saveTokens(tokens)
    res.send('<h2>✅ אימות Google הושלם בהצלחה!</h2><p>אפשר לסגור את הטאב הזה ולחזור ל-CRM.</p>')
  } catch (err) {
    res.status(500).send('שגיאה בקבלת טוקן: ' + err.message)
  }
})

// GET /api/google/status — check if authorized
router.get('/status', (_req, res) => {
  const tokens = loadTokens()
  res.json({ authorized: Boolean(tokens) })
})

// POST /api/google/sync-meetings
router.post('/sync-meetings', async (_req, res) => {
  try {
    const result = await syncCalendarMeetings()
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

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

export default router
