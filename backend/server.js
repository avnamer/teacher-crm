import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import googleRouter from './src/routes/google.js'
import voiceLogRouter from './src/routes/voiceLog.js'
import whatsappRouter from './src/routes/whatsapp.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

app.use('/api/google', googleRouter)
app.use('/api/voice-log', voiceLogRouter)
app.use('/api/whatsapp', whatsappRouter)

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
})
