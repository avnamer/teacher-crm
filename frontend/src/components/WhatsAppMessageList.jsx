import { useState } from 'react'

// Renders one day's worth of synced WhatsApp messages inside a 'whatsapp'
// interaction row on the contact detail page (spec §3.2). Messages from me and
// from the teacher are visually distinguished (alignment + color), each line
// shows its own group name when the row is a group source (spec §3.1.1's
// rendering example), and voice messages get the summary/transcript treatment
// from spec §3.2's "הודעות קוליות" section.

function timeOf(iso) {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}

function VoiceMessageBody({ message }) {
  const [showFull, setShowFull] = useState(false)

  if (message.transcriptionStatus === 'failed') {
    return (
      <p className="text-sm text-gray-500">
        🎤 הודעה קולית ({formatDuration(message.durationSec)}), התמלול נכשל — ינוסה שוב בסנכרון הבא
      </p>
    )
  }
  if (message.transcriptionStatus === 'pending' || !message.transcript) {
    return <p className="text-sm text-gray-400">🎤 הודעה קולית ({formatDuration(message.durationSec)}) — ממתינה לתמלול</p>
  }

  // No summary means either a short recording or a failed summarization step —
  // both get the same treatment: show the full transcript, labeled as such
  // rather than as a summary (spec §3.2).
  if (!message.summary) {
    return (
      <div>
        <p className="text-xs italic text-gray-500 mb-1">🎤 תמלול הקלטה ({formatDuration(message.durationSec)}):</p>
        <p className="text-sm text-gray-700 whitespace-pre-wrap" dir="rtl">{message.transcript}</p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm italic text-gray-700">
        🎤 תקציר הקלטה ({formatDuration(message.durationSec)}): {message.summary}
      </p>
      <button onClick={() => setShowFull(v => !v)} className="text-xs text-blue-600 hover:underline mt-1">
        {showFull ? 'הסתר תמלול מלא' : 'הצג תמלול מלא'}
      </button>
      {showFull && (
        <div className="mt-1">
          <p className="text-xs text-gray-400 mb-1">תמלול מלא של ההקלטה:</p>
          <p className="text-sm text-gray-600 bg-gray-100 rounded-lg p-2 whitespace-pre-wrap" dir="rtl">
            {message.transcript}
          </p>
        </div>
      )}
    </div>
  )
}

function formatDuration(sec) {
  if (!sec && sec !== 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function MessageBody({ message }) {
  if (message.kind === 'voice') return <VoiceMessageBody message={message} />
  if (message.kind === 'media') {
    return (
      <p className="text-sm text-gray-700 whitespace-pre-wrap" dir="rtl">
        {message.mediaLabel}{message.text ? ` — ${message.text}` : ''}
      </p>
    )
  }
  return <p className="text-sm text-gray-700 whitespace-pre-wrap" dir="rtl">{message.text}</p>
}

export default function WhatsAppMessageList({ metadata }) {
  const messages = metadata?.messages || []
  if (messages.length === 0) return null

  return (
    <div className="space-y-2">
      {messages.map(m => (
        <div key={m.messageId} className={`flex ${m.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[85%] rounded-lg p-2 ${m.sender === 'me' ? 'bg-blue-50' : 'bg-white border border-gray-200'}`}>
            <p className="text-xs text-gray-400 mb-0.5">
              {timeOf(m.timestamp)}{' '}
              <span className="font-medium text-gray-500">{m.sender === 'me' ? 'אני' : 'המורה'}</span>
              {metadata.source === 'group' && metadata.group_name && (
                <span> (בקבוצה "{metadata.group_name}")</span>
              )}
            </p>
            <MessageBody message={m} />
          </div>
        </div>
      ))}
    </div>
  )
}
