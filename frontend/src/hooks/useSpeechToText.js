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
  const finalTextRef = useRef('')

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
        const text = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTextRef.current += text + ' '
        } else {
          interim += text
        }
      }
      setTranscript((finalTextRef.current + interim).trim())
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
    finalTextRef.current = ''
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
    finalTextRef.current = ''
    setTranscript('')
    setError(null)
  }, [])

  return { supported, listening, transcript, setTranscript, start, stop, reset, error }
}
