import { Router } from 'express'
import { analyzeMeetingNotes, mergeMeetingNotes, summarizeForHistory } from '../services/claudeAnalyze.js'

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

// POST /api/meetings/merge — one consolidated record from several records of the same meeting
router.post('/merge', async (req, res) => {
  const { notes, date } = req.body
  const texts = Array.isArray(notes) ? notes.map(n => String(n || '').trim()).filter(Boolean) : []
  if (texts.length === 0) {
    return res.status(400).json({ message: 'לא התקבל תוכן פגישה' })
  }
  try {
    const result = await mergeMeetingNotes(texts, date || new Date().toISOString().split('T')[0])
    res.json(result)
  } catch (err) {
    console.error('[meetings/merge]', err)
    res.status(500).json({ message: 'איחוד הפגישות נכשל: ' + err.message })
  }
})

// POST /api/meetings/short-summary — 2-3 line summary of one history record (Schools page)
router.post('/short-summary', async (req, res) => {
  const text = String(req.body?.text || '').trim()
  if (!text) {
    return res.status(400).json({ message: 'לא התקבל תוכן לסיכום' })
  }
  try {
    const summary = await summarizeForHistory(text)
    res.json({ summary })
  } catch (err) {
    console.error('[meetings/short-summary]', err)
    res.status(500).json({ message: 'יצירת הסיכום נכשלה: ' + err.message })
  }
})

export default router
