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
  // by result index. Some Android Chrome builds re-emit the ENTIRE cumulative
  // final text as a new "final" result repeatedly (observed as the whole
  // transcript looping continuously without new speech) — each repeat can
  // land at a new result index, so index-based keying alone doesn't catch it.
  // Skipping a phrase identical to the last one recorded does.
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
        if (event.results[i].isFinal) {
          const phrases = finalPhrasesRef.current
          if (text && phrases[phrases.length - 1] !== text) {
            phrases.push(text)
          }
        } else {
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
    finalPhrasesRef.current = []
    setTranscript('')
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
