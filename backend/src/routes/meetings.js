import { Router } from 'express'
import { analyzeMeetingNotes } from '../services/claudeAnalyze.js'

const router = Router()

// POST /api/meetings/analyze — AI summary + follow-up tasks for a manually typed meeting
router.post('/analyze', async (req, res) => {
  const { content, date } = req.body
  if (!content || !content.trim()) {
    return res.status(400).json({ message: 'לא התקבל תוכן פגישה' })
  }
  try {
    const result = await analyzeMeetingNotes(content, date || new Date().toISOString().split('T')[0])
    res.json(result)
  } catch (err) {
    console.error('[meetings/analyze]', err)
    res.status(500).json({ message: 'ניתוח הפגישה נכשל: ' + err.message })
  }
})

export default router
