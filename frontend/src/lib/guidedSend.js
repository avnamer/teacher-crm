import { useEffect, useRef, useState, useCallback } from 'react'

// Client side of "guided send": talks to the WhatsApp-sync Chrome extension through its
// crm-bridge.js content script (window.postMessage on the CRM page). The extension opens
// each chat in WhatsApp Web with the text already in the composer; the human presses
// Enter; the extension reports back `sent`. No backend or database involved, and the
// extension never sends anything itself.
//
// Events from the extension: ready, opened {id}, sent {id}, skipped {id},
// item-error {id, reason}, finished {error?}, error {reason}.

const CHANNEL = 'teacher-crm-wa'

function post(payload) {
  window.postMessage({ channel: CHANNEL, from: 'page', ...payload }, window.location.origin)
}

export function useGuidedSend(onEvent) {
  const [available, setAvailable] = useState(false)
  const handlerRef = useRef(onEvent)
  useEffect(() => { handlerRef.current = onEvent })

  useEffect(() => {
    function listener(event) {
      if (event.source !== window) return
      const data = event.data
      if (!data || data.channel !== CHANNEL || data.from !== 'extension') return
      if (data.type === 'ready') setAvailable(true)
      handlerRef.current?.(data)
    }
    window.addEventListener('message', listener)
    post({ type: 'ping' })
    return () => window.removeEventListener('message', listener)
  }, [])

  const start = useCallback(items => post({ type: 'start', items }), [])
  const skip = useCallback(() => post({ type: 'skip' }), [])
  const cancel = useCallback(() => post({ type: 'cancel' }), [])
  return { available, start, skip, cancel }
}
