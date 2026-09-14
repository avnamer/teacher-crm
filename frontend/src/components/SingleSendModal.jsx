import { useState } from 'react'
import SendQueueModal from './SendQueueModal.jsx'
import { messageForContact, phoneProblem } from '../lib/whatsapp.js'

// One-teacher WhatsApp send, opened from the dashboard row icon.
//
// The recipient is already known, so the only choice left is the template. Once
// picked, it hands off to SendQueueModal with a single contact — that is what opens
// the chat, waits for the human "sent" confirmation, and logs the interaction. It is
// logged as sent_via 'single' so the history shows it as a plain "הודעה" rather than
// with the bulk-send icon.

export function WhatsAppIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#25D366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" />
      <path
        fill="#fff"
        d="M9.2 7.5c-.2-.5-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.3 5.1 4.5 2.5 1 3 .8 3.6.7.5-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.4l-2-1c-.3-.1-.5-.2-.7.1l-.9 1.2c-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.5-.5.3-.5c.1-.2 0-.4 0-.5l-.9-2.3z"
      />
    </svg>
  )
}

export default function SingleSendModal({ contact, templates, onClose, onSent }) {
  const [selectedTemplate, setSelectedTemplate] = useState(templates[0] || null)
  const [started, setStarted] = useState(false)
  const problem = phoneProblem(contact)

  if (started) {
    return (
      <SendQueueModal
        template={selectedTemplate}
        contacts={[contact]}
        sentVia="single"
        onClose={() => { onSent?.(); onClose() }}
      />
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-2">
            <WhatsAppIcon className="w-6 h-6" />
            <div>
              <h2 className="text-xl font-bold">הודעה ל{contact.name}</h2>
              <p className="text-xs text-gray-500" dir="ltr">{contact.phone}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {problem && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              ⚠ אי אפשר לשלוח: {problem}
            </div>
          )}

          {templates.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">
              אין תבניות הודעה. צור תבנית תחילה בדף WhatsApp.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-600">בחר תבנית:</p>
              <div className="space-y-2">
                {templates.map(t => (
                  <label key={t.id} className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedTemplate?.id === t.id ? 'border-green-500 bg-green-50' : 'hover:bg-gray-50'
                  }`}>
                    <input
                      type="radio"
                      name="single-template"
                      checked={selectedTemplate?.id === t.id}
                      onChange={() => setSelectedTemplate(t)}
                      className="mt-1"
                    />
                    <span className="font-medium text-gray-800">{t.name}</span>
                  </label>
                ))}
              </div>

              {selectedTemplate && (
                <div>
                  <p className="text-sm text-gray-600 mb-2">תצוגה מקדימה:</p>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-gray-800 whitespace-pre-wrap">
                    {messageForContact(selectedTemplate, contact)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 p-6 border-t">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm">
            ביטול
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setStarted(true)}
            disabled={!selectedTemplate || !!problem}
            className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-40"
          >
            המשך לשליחה ←
          </button>
        </div>
      </div>
    </div>
  )
}
