import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import { buildChatUrl, messageForContact, phoneProblem } from '../lib/whatsapp.js'

// Click-to-chat send queue.
//
// Walks the recipients one at a time: open the chat with the message already
// filled in, Avner presses send inside WhatsApp, then confirms here. Confirming
// is what advances the queue, so a message is only ever logged as sent because a
// human said it went out — nothing is inferred from the fact that a tab opened.
//
// Each confirmed send is written to `interactions` as 'message_sent' (the
// one-way type), which is what feeds the dashboard's contact-recency colours.

const STATUS = {
  pending: { label: 'ממתין', cls: 'bg-gray-100 text-gray-500' },
  opened: { label: 'נפתח', cls: 'bg-yellow-100 text-yellow-700' },
  sent: { label: 'נשלח', cls: 'bg-green-100 text-green-700' },
  skipped: { label: 'דולג', cls: 'bg-gray-200 text-gray-600' },
  invalid: { label: 'לא תקין', cls: 'bg-red-100 text-red-700' },
}

export default function SendQueueModal({ template, contacts, onClose }) {
  // Contacts with an unusable phone can't be messaged at all, so they start in a
  // terminal 'invalid' state rather than blocking the queue when reached.
  const [statuses, setStatuses] = useState(() => {
    const initial = {}
    for (const c of contacts) initial[c.id] = phoneProblem(c) ? 'invalid' : 'pending'
    return initial
  })
  const [index, setIndex] = useState(() => contacts.findIndex(c => !phoneProblem(c)))
  const [logError, setLogError] = useState(null)

  const messages = useMemo(() => {
    const map = {}
    for (const c of contacts) map[c.id] = messageForContact(template, c)
    return map
  }, [contacts, template])

  const counts = useMemo(() => {
    const c = { sent: 0, skipped: 0, invalid: 0, remaining: 0 }
    for (const id of Object.keys(statuses)) {
      if (statuses[id] === 'sent') c.sent++
      else if (statuses[id] === 'skipped') c.skipped++
      else if (statuses[id] === 'invalid') c.invalid++
      else c.remaining++
    }
    return c
  }, [statuses])

  const current = index >= 0 && index < contacts.length ? contacts[index] : null
  const done = counts.remaining === 0

  function setStatus(id, status) {
    setStatuses(prev => ({ ...prev, [id]: status }))
  }

  /** Advance to the next contact that still needs a decision. */
  function advance(from) {
    for (let i = from + 1; i < contacts.length; i++) {
      const s = statuses[contacts[i].id]
      if (s === 'pending' || s === 'opened') return setIndex(i)
    }
    // Nothing after this one — look for anything still open earlier in the list.
    for (let i = 0; i < contacts.length; i++) {
      if (i === from) continue
      const s = statuses[contacts[i].id]
      if (s === 'pending' || s === 'opened') return setIndex(i)
    }
    setIndex(-1)
  }

  function handleOpen() {
    if (!current) return
    const url = buildChatUrl(current, messages[current.id])
    if (!url) return setStatus(current.id, 'invalid')
    // noopener: the opened tab must not get a handle back to the CRM window.
    window.open(url, '_blank', 'noopener,noreferrer')
    setStatus(current.id, 'opened')
  }

  async function handleConfirmSent() {
    if (!current) return
    const contact = current
    setStatus(contact.id, 'sent')
    advance(index)

    const { error } = await supabase.from('interactions').insert({
      contact_id: contact.id,
      type: 'message_sent',
      content: messages[contact.id],
      metadata: {
        channel: 'whatsapp',
        driver: 'manual',
        template_id: template?.id || null,
        template_name: template?.name || null,
      },
    })
    // A failed log doesn't un-send the message, so don't roll the row back —
    // just surface it, because the dashboard's recency colour will be stale.
    if (error) setLogError(`ההודעה נשלחה אך לא נרשמה ביומן (${contact.name}): ${error.message}`)
  }

  function handleSkip() {
    if (!current) return
    setStatus(current.id, 'skipped')
    advance(index)
  }

  const progressPct = contacts.length
    ? ((contacts.length - counts.remaining) / contacts.length) * 100
    : 0

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-xl font-bold">📤 שליחה ב-WhatsApp</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {template?.name} · {contacts.length} נמענים
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {/* Progress */}
        <div className="px-6 pt-4">
          <div className="flex items-center gap-3 text-sm mb-2">
            <span className="text-green-600 font-medium">✓ {counts.sent} נשלחו</span>
            {counts.skipped > 0 && <span className="text-gray-500">⤻ {counts.skipped} דולגו</span>}
            {counts.invalid > 0 && <span className="text-red-500">⚠ {counts.invalid} ללא מספר תקין</span>}
            <span className="mr-auto text-gray-400">{counts.remaining} נותרו</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {logError && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">
              {logError}
            </div>
          )}

          {done ? (
            <div className="text-center py-8">
              <p className="text-4xl mb-3">🎉</p>
              <p className="font-medium text-gray-800">הסבב הושלם</p>
              <p className="text-sm text-gray-500 mt-1">
                {counts.sent} הודעות נשלחו ונרשמו ביומן הקשר
              </p>
            </div>
          ) : current ? (
            <div className="border-2 border-green-500 rounded-xl p-4 bg-green-50/40">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-semibold text-gray-800">{current.name}</p>
                  <p className="text-xs text-gray-500" dir="ltr">{current.phone}</p>
                </div>
                <span className="text-xs text-gray-400">
                  {index + 1} מתוך {contacts.length}
                </span>
              </div>

              <div className="bg-white border rounded-lg p-3 text-sm text-gray-800 whitespace-pre-wrap mb-4">
                {messages[current.id]}
              </div>

              {statuses[current.id] === 'opened' ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-600">
                    ההודעה נפתחה ב-WhatsApp עם הטקסט מוכן. לחץ Enter שם כדי לשלוח, ואז אשר כאן.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleConfirmSent}
                      className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
                    >
                      ✓ נשלח — הבא
                    </button>
                    <button onClick={handleOpen} className="px-4 py-2.5 border rounded-lg text-sm hover:bg-white">
                      פתח שוב
                    </button>
                    <button onClick={handleSkip} className="px-4 py-2.5 border rounded-lg text-sm hover:bg-white">
                      דלג
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={handleOpen}
                    className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
                  >
                    פתח ב-WhatsApp ושלח
                  </button>
                  <button onClick={handleSkip} className="px-4 py-2.5 border rounded-lg text-sm hover:bg-white">
                    דלג
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {/* Full list */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600 border-b">
              כל הנמענים
            </div>
            <div className="max-h-52 overflow-y-auto">
              {contacts.map((c, i) => {
                const st = statuses[c.id]
                const problem = phoneProblem(c)
                return (
                  <button
                    key={c.id}
                    onClick={() => { if (!problem) setIndex(i) }}
                    disabled={!!problem}
                    className={`w-full flex items-center gap-3 px-3 py-2 border-b last:border-0 text-sm text-right ${
                      i === index ? 'bg-green-50' : 'hover:bg-gray-50'
                    } ${problem ? 'cursor-not-allowed opacity-70' : ''}`}
                  >
                    <span className="text-gray-800">{c.name}</span>
                    {problem && <span className="text-xs text-red-500">{problem}</span>}
                    <span className={`mr-auto text-xs px-2 py-0.5 rounded-full ${STATUS[st]?.cls}`}>
                      {STATUS[st]?.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex gap-2 p-6 border-t">
          <div className="flex-1" />
          <button onClick={onClose} className="px-5 py-2 border rounded-lg text-sm hover:bg-gray-50">
            {done ? 'סגור' : 'סיים כאן'}
          </button>
        </div>
      </div>
    </div>
  )
}
