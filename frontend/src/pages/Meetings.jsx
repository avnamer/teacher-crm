import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { backendFetch } from '../lib/api.js'

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000)
}

function urgencyColor(days) {
  if (days > 60) return 'red'
  if (days > 30) return 'yellow'
  return 'none'
}

function groupByTeacher(meetings) {
  const map = {}
  for (const m of meetings) {
    const cid = m.contact_id
    if (!map[cid]) {
      map[cid] = {
        contact: m.contacts,
        meetings: [],
        lastPastDate: null,
      }
    }
    map[cid].meetings.push(m)
    const isPast = new Date(m.scheduled_at) <= new Date()
    if (isPast) {
      if (!map[cid].lastPastDate || m.scheduled_at > map[cid].lastPastDate) {
        map[cid].lastPastDate = m.scheduled_at
      }
    }
  }

  return Object.values(map).sort((a, b) => {
    // No past meetings → treat as very old (sort to top)
    const da = a.lastPastDate ? daysSince(a.lastPastDate) : 9999
    const db = b.lastPastDate ? daysSince(b.lastPastDate) : 9999
    return db - da
  })
}

export default function Meetings() {
  const [meetings, setMeetings] = useState([])
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [openTeacher, setOpenTeacher] = useState(null)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [{ data: meetingsData, error: mErr }, { data: contactsData, error: cErr }] = await Promise.all([
        supabase.from('meetings').select('*, contacts(name, phone, school, custom_fields)').order('scheduled_at', { ascending: false }).limit(500),
        supabase.from('contacts').select('id, name, school, phone, custom_fields').contains('custom_fields', { mentor_name: 'אבנר' }),
      ])
      const myTeacherIds = new Set((contactsData || []).map(c => c.id))
      if (mErr) throw mErr
      if (cErr) throw cErr
      setMeetings((meetingsData || []).filter(m => myTeacherIds.has(m.contact_id)))
      setContacts(contactsData || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function syncCalendar() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const status = await backendFetch('/api/google/status')
      if (!status.authorized) {
        window.open('http://localhost:3001/api/google/auth', '_blank')
        setSyncResult({ ok: false, message: 'יש לאשר גישה ל-Google Calendar בחלון שנפתח, ואז לנסות שוב.' })
        return
      }
      const result = await backendFetch('/api/google/sync-meetings', { method: 'POST' })
      if (result.error) {
        setSyncResult({ ok: false, message: result.error })
      } else {
        setSyncResult({ ok: true, added: result.added ?? 0, skipped: result.skipped ?? 0 })
        if ((result.added ?? 0) > 0) loadAll()
      }
    } catch (err) {
      setSyncResult({ ok: false, message: err.message })
    } finally {
      setSyncing(false)
    }
  }

  async function updateStatus(id, status) {
    const { error } = await supabase.from('meetings').update({ status }).eq('id', id)
    if (error) {
      alert('שגיאה בעדכון: ' + error.message)
    } else {
      loadAll()
    }
  }

  const groups = groupByTeacher(meetings)
  const contactsWithMeetings = new Set(groups.map(g => g.meetings[0]?.contact_id))
  const neverMet = contacts.filter(c => !contactsWithMeetings.has(c.id))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">פגישות</h1>
        <button
          onClick={syncCalendar}
          disabled={syncing}
          className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50"
        >
          {syncing ? 'מסנכרן...' : '↻ סנכרן מיומן'}
        </button>
      </div>

      {syncResult && (
        <div className={`rounded-xl p-3 text-sm ${syncResult.ok ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
          {syncResult.ok
            ? `סנכרון הושלם — נוספו ${syncResult.added} פגישות, דולגו ${syncResult.skipped} קיימות`
            : `שגיאה: ${syncResult.message}`}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">טוען...</div>
      ) : (
        <div className="space-y-2">
          {neverMet.map(contact => (
            <div key={contact.id} className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
                <div>
                  <span className="font-medium text-gray-800">{contact.name}</span>
                  {contact.school && <span className="text-xs text-gray-500 mr-2">{contact.school}</span>}
                </div>
              </div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">לא נפגשנו</span>
            </div>
          ))}

          {groups.map(group => {
            const cid = group.meetings[0]?.contact_id
            const days = group.lastPastDate ? daysSince(group.lastPastDate) : null
            const color = days !== null ? urgencyColor(days) : 'none'
            const isOpen = openTeacher === cid
            const sortedMeetings = [...group.meetings].sort(
              (a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at)
            )

            const borderClass =
              color === 'red' ? 'border-red-300 bg-red-50' :
              color === 'yellow' ? 'border-yellow-300 bg-yellow-50' :
              'border-gray-200 bg-white'

            const dotClass =
              color === 'red' ? 'bg-red-400' :
              color === 'yellow' ? 'bg-yellow-400' :
              'bg-green-400'

            return (
              <div key={cid} className={`rounded-xl border overflow-hidden ${borderClass}`}>
                <button
                  onClick={() => setOpenTeacher(isOpen ? null : cid)}
                  className="w-full flex items-center justify-between px-4 py-3 text-right"
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
                    <div>
                      <span className="font-medium text-gray-800">
                        {group.contact?.name || 'לא ידוע'}
                      </span>
                      {group.contact?.school && (
                        <span className="text-xs text-gray-500 mr-2">{group.contact.school}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {days !== null && (
                      <span className="text-xs text-gray-500">
                        לפני {days} ימים
                      </span>
                    )}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      color === 'red' ? 'bg-red-100 text-red-700' :
                      color === 'yellow' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {group.meetings.length} פגישות
                    </span>
                    <span className="text-gray-400 text-sm">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-200 divide-y divide-gray-100">
                    {sortedMeetings.map(m => (
                      <div key={m.id} className="px-4 py-3 bg-white">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium text-blue-600">
                            {new Date(m.scheduled_at).toLocaleString('he-IL', {
                              weekday: 'long',
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">{m.duration_minutes} דק׳</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              m.status === 'completed' ? 'bg-green-100 text-green-700' :
                              m.status === 'no_show' ? 'bg-red-100 text-red-700' :
                              m.status === 'cancelled' ? 'bg-gray-100 text-gray-500' :
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {m.status === 'completed' ? 'הושלמה' :
                               m.status === 'no_show' ? 'לא הגיע' :
                               m.status === 'cancelled' ? 'בוטלה' : 'מתוכננת'}
                            </span>
                          </div>
                        </div>
                        {m.notes && (
                          <p className="text-xs text-gray-500 mt-1">{m.notes}</p>
                        )}
                        {m.status === 'scheduled' && (
                          <div className="flex gap-2 mt-2">
                            <button onClick={() => updateStatus(m.id, 'completed')}
                              className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200">
                              הושלמה
                            </button>
                            <button onClick={() => updateStatus(m.id, 'no_show')}
                              className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200">
                              לא הגיע
                            </button>
                            <button onClick={() => updateStatus(m.id, 'cancelled')}
                              className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200">
                              ביטול
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
