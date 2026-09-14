import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import googleRouter from './src/routes/google.js'
import voiceLogRouter from './src/routes/voiceLog.js'
import whatsappRouter from './src/routes/whatsapp.js'

const app = express()
const PORT = process.env.PORT || 3001

// Only the CRM's own front-ends may call this API from a browser. Set
// ALLOWED_ORIGINS (comma-separated) in the environment to override in prod.
// Note: CORS is enforced by the browser, so this blocks other *web pages* from
// calling the API with a victim's session — it is not a substitute for real
// auth against scripted (non-browser) requests. See docs/TODO.md.
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  'https://comforting-pegasus-780af0.netlify.app,http://localhost:5173'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients (no Origin header: curl, health checks,
      // server-to-server) and any explicitly allow-listed web origin. A
      // disallowed origin is refused by omitting the CORS headers (callback
      // with false, not an Error) — the browser then blocks it, and we avoid
      // throwing a 500 with a stack trace on every rejected request.
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
      return callback(null, false)
    },
  })
)
app.use(express.json())

app.use('/api/google', googleRouter)
app.use('/api/voice-log', voiceLogRouter)
app.use('/api/whatsapp', whatsappRouter)

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
})
