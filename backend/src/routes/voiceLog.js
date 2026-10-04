import { Router } from 'express'
import { analyzeCallTranscript, analyzeAdminTasks } from '../services/claudeAnalyze.js'
import { israelDateStr } from '../services/whatsappDedup.js'

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

const israelWeekday = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long' })

// POST /api/voice-log/admin-tasks — splits a "משימה לעצמי" recording into tasks.
router.post('/admin-tasks', async (req, res) => {
  const { transcript } = req.body
  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ message: 'לא התקבל תמלול' })
  }
  try {
    const now = new Date()
    const tasks = await analyzeAdminTasks(transcript, israelDateStr(now), israelWeekday.format(now))
    res.json({ tasks })
  } catch (err) {
    console.error('[voice-log/admin-tasks]', err)
    res.status(500).json({ message: 'פיצול המשימות נכשל: ' + err.message })
  }
})

export default router
