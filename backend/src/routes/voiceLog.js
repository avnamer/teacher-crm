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
