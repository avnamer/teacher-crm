import OpenAI from 'openai'

// Constructed lazily, not at module load: the OpenAI SDK throws immediately if
// apiKey is empty, and this file is imported (transitively, via the route) from
// server.js — an eager throw here would crash the *entire* backend (voice-log,
// calendar sync, WhatsApp sending, everything) just because OPENAI_API_KEY isn't
// configured yet. Deferring construction means a missing key only fails this one
// transcription call, exactly like any other transcription failure (spec §3.2).
let openai = null
function client() {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return openai
}

/**
 * Transcribes a WhatsApp voice message to Hebrew text via OpenAI's speech-to-text
 * API. `buffer` is the raw audio file bytes as downloaded from WhatsApp Web
 * (voice notes are typically Opus-in-Ogg). Throws on failure — the route
 * decides how to record that (spec §3.2: mark transcriptionStatus 'failed',
 * retry later).
 *
 * Model: gpt-4o-transcribe, not the older whisper-1 — OpenAI reports lower
 * word-error-rates across languages including Hebrew, same API shape, no
 * extra integration cost. If Hebrew accuracy still isn't good enough in
 * practice, the next step up is a Hebrew-finetuned Whisper (e.g. ivrit.ai),
 * but that's a self-hosted GPU model, not a drop-in API swap like this one.
 */
export async function transcribeAudio(buffer, mimeType) {
  const ext = mimeType?.includes('mp4') ? 'mp4'
    : mimeType?.includes('mpeg') ? 'mp3'
    : mimeType?.includes('webm') ? 'webm' // chrome.tabCapture recordings (extension voice-note capture)
    : 'ogg'
  const file = await OpenAI.toFile(buffer, `voice.${ext}`, { type: mimeType || 'audio/ogg' })
  const result = await client().audio.transcriptions.create({
    file,
    model: 'gpt-4o-transcribe',
    language: 'he',
  })
  return (result.text || '').trim()
}
