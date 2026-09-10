import { useCallback, useEffect, useRef, useState } from 'react'

// Isolated speech-to-text module. Swap this file's internals for a
// Whisper-based implementation later without touching any consumer —
// the returned interface (supported, listening, transcript, start, stop,
// reset, setTranscript, error) is the contract callers rely on.
// Note: setTranscript is for editing the transcript while NOT listening
// (e.g. a manual correction after stopping) — calling it mid-listen will be
// overwritten by the next speech result, since transcript is otherwise
// derived from the recognition engine's own accumulated output.
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
        const text = event.results[i][0].transcript.trim()
        if (event.results[i].isFinal && text) {
          const phrases = finalPhrasesRef.current
          const soFar = phrases.join(' ')
          if (text === phrases[phrases.length - 1]) {
            // Exact repeat of the last phrase — engine re-fired it, ignore.
          } else if (soFar && text.startsWith(soFar)) {
            // Engine restarted its session and echoed everything said so far
            // plus the new bit as one cumulative result — replace rather
            // than append, or the old part would appear twice.
            finalPhrasesRef.current = [text]
          } else {
            phrases.push(text)
          }
        } else if (!event.results[i].isFinal) {
          interim += text
        }
      }
      setTranscript((finalPhrasesRef.current.join(' ') + ' ' + interim).trim())
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
    if (!recognitionRef.current || listening) return
    setError(null)
    // Deliberately does not clear finalPhrasesRef/transcript: the browser's
    // SpeechRecognition can auto-stop after a silence timeout mid-call, and
    // pressing the mic button again should resume into the existing text,
    // not erase it. Callers that want a genuinely fresh recording clear
    // explicitly via reset() (see the "נקה" button and post-save reset).
    try {
      recognitionRef.current.start()
      setListening(true)
    } catch {
      // Native SpeechRecognition throws if start() is called while already running
      // (e.g. a double-click racing the onend callback) — ignore, state stays unchanged.
    }
  }, [listening])

  const stop = useCallback(() => {
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
