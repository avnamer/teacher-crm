import { useCallback, useEffect, useRef, useState } from 'react'

// Isolated speech-to-text module. Swap this file's internals for a
// Whisper-based implementation later without touching any consumer —
// the returned interface (supported, listening, transcript, start, stop,
// reset, setTranscript, error) is the contract callers rely on.
// Note: setTranscript is for editing the transcript while NOT listening
// (e.g. a manual correction after stopping) — calling it mid-listen will be
// overwritten by the next speech result, since transcript is otherwise
// derived from the recognition engine's own accumulated output.
// Appends a newly finalized phrase to the text so far without duplicating
// anything the engine echoed back. After a silent session restart, Android
// Chrome may report a "final" result that repeats the tail of what was already
// said (or all of it) plus the new bit, so we find the longest word overlap
// between the end of `soFar` and the start of `text` and add only the rest.
function mergeFinal(soFar, text) {
  if (!soFar) return text
  if (soFar.includes(text)) return soFar
  const a = soFar.split(/\s+/)
  const b = text.split(/\s+/)
  for (let k = Math.min(a.length, b.length); k >= 1; k--) {
    // A single overlapping word is only trusted when it is the whole new text
    // (otherwise a legitimately repeated word like "כן כן" would be swallowed).
    if (k === 1 && b.length > 1) break
    if (a.slice(-k).join(' ') === b.slice(0, k).join(' ')) {
      return [...a, ...b.slice(k)].join(' ')
    }
  }
  return soFar + ' ' + text
}

export function useSpeechToText({ lang = 'he-IL' } = {}) {
  const [supported] = useState(() => Boolean(
    typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
  ))
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState(null)
  const recognitionRef = useRef(null)
  // A list of distinct finalized phrases, deduplicated by content rather than
  // by result index — some Android Chrome builds silently restart their
  // recognition session between sentences (after a pause) and, on restart,
  // report the ENTIRE text spoken so far plus the new bit as a single
  // cumulative "final" result rather than just the new part. Comparing
  // against accumulated content (not the browser's result index, which
  // resets on restart) is what catches both that and simple re-fired repeats.
  const finalPhrasesRef = useRef([])
  // After stop(), the engine can still fire one more onresult for audio it had
  // already buffered (finalizing whatever was mid-utterance) — that event arrives
  // asynchronously, after stop()'s caller has moved on, and would otherwise re-append
  // the just-finished sentence. Ignore all results until start() is called again.
  const stoppedRef = useRef(true)

  useEffect(() => {
    if (!supported) return
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.lang = lang
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (event) => {
      if (stoppedRef.current) return
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.trim()
        if (event.results[i].isFinal && text) {
          finalPhrasesRef.current = [mergeFinal(finalPhrasesRef.current.join(' '), text)]
        } else if (!event.results[i].isFinal) {
          interim += text
        }
      }
      setTranscript((finalPhrasesRef.current.join(' ') + ' ' + interim).trim())
    }

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture') {
        // Fatal — don't let onend auto-restart into the same error forever.
        stoppedRef.current = true
        setError(event.error === 'audio-capture'
          ? 'לא נמצא מיקרופון זמין'
          : 'הגישה למיקרופון נחסמה — יש לאפשר הרשאת מיקרופון בהגדרות הדפדפן')
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError('שגיאת הכתבה: ' + event.error)
      }
    }

    // Browsers end a recognition session on their own after a pause in speech or
    // a max session length (~60s in Chrome), even with continuous = true. Until the
    // user actually presses stop, restart transparently so a long recording doesn't
    // need the mic button pressed again. finalPhrasesRef is content-deduplicated, so
    // the new session's results append correctly.
    recognition.onend = () => {
      if (!stoppedRef.current) {
        try {
          recognition.start()
          return
        } catch {
          // fall through to stopped state
        }
      }
      stoppedRef.current = true
      setListening(false)
    }

    recognitionRef.current = recognition
    return () => {
      stoppedRef.current = true
      recognition.stop()
    }
  }, [supported, lang])

  const start = useCallback(() => {
    if (!recognitionRef.current || listening) return
    setError(null)
    // Deliberately does not clear finalPhrasesRef/transcript: the browser's
    // SpeechRecognition can auto-stop after a silence timeout mid-call, and
    // pressing the mic button again should resume into the existing text,
    // not erase it. Callers that want a genuinely fresh recording clear
    // explicitly via reset() (see the "נקה" button and post-save reset).
    try {
      recognitionRef.current.start()
      stoppedRef.current = false
      setListening(true)
    } catch {
      // Native SpeechRecognition throws if start() is called while already running
      // (e.g. a double-click racing the onend callback) — ignore, state stays unchanged.
    }
  }, [listening])

  const stop = useCallback(() => {
    stoppedRef.current = true
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  const reset = useCallback(() => {
    finalPhrasesRef.current = []
    setTranscript('')
    setError(null)
  }, [])

  return { supported, listening, transcript, setTranscript, start, stop, reset, error }
}
