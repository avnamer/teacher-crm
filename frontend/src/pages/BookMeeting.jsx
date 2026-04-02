import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

export default function BookMeeting() {
  const { contactId } = useParams()
  const [contact, setContact] = useState(null)
  const [settings, setSettings] = useState(null)
  const [existingMeetings, setExistingMeetings] = useState([])
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [booking, setBooking] = useState(false)
  const [booked, setBooked] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadData()
  }, [contactId])

  async function loadData() {
    try {
      const [contactRes, settingsRes, meetingsRes] = await Promise.all([
        supabase.from('contacts').select('name, phone, school').eq('id', contactId).single(),
        supabase.from('settings').select('*').eq('id', 'global').single(),
        supabase.from('meetings').select('scheduled_at, duration_minutes')
          .eq('status', 'scheduled')
          .gte('scheduled_at', new Date().toISOString()),
      ])

      if (contactRes.error) {
        setError('לא נמצא איש קשר')
        return
      }

      setContact(contactRes.data)
      setSettings(settingsRes.data)
      setExistingMeetings(meetingsRes.data || [])
    } catch (err) {
      setError('שגיאה בטעינה')
    } finally {
      setLoading(false)
    }
  }

  function generateSlots() {
    if (!settings) return []
    const slots = []
    const now = new Date()
    const maxDate = new Date()
    maxDate.setDate(maxDate.getDate() + (settings.booking_window_weeks || 3) * 7)

    const [startH, startM] = (settings.working_hours_start || '09:00').split(':').map(Number)
    const [endH, endM] = (settings.working_hours_end || '17:00').split(':').map(Number)
    const slotDuration = settings.slot_duration_minutes || 30
    const availDays = settings.available_days || [0, 1, 4]

    const busyTimes = existingMeetings.map(m => ({
      start: new Date(m.scheduled_at).getTime(),
      end: new Date(m.scheduled_at).getTime() + m.duration_minutes * 60000,
    }))

    const current = new Date(now)
    current.setHours(0, 0, 0, 0)
    current.setDate(current.getDate() + 1) // start from tomorrow

    while (current <= maxDate) {
      if (availDays.includes(current.getDay())) {
        const slotTime = new Date(current)
        slotTime.setHours(startH, startM, 0, 0)

        const dayEnd = new Date(current)
        dayEnd.setHours(endH, endM, 0, 0)

        while (slotTime < dayEnd) {
          const slotStart = slotTime.getTime()
          const slotEnd = slotStart + slotDuration * 60000
          const isBusy = busyTimes.some(b => slotStart < b.end && slotEnd > b.start)

          if (!isBusy) {
            slots.push(new Date(slotStart))
          }
          slotTime.setMinutes(slotTime.getMinutes() + slotDuration)
        }
      }
      current.setDate(current.getDate() + 1)
    }

    return slots
  }

  async function bookSlot() {
    if (!selectedSlot) return
    setBooking(true)
    try {
      const { error } = await supabase.from('meetings').insert({
        contact_id: contactId,
        scheduled_at: selectedSlot.toISOString(),
        duration_minutes: settings?.slot_duration_minutes || 30,
        status: 'scheduled',
      })
      if (error) throw error
      setBooked(true)
    } catch (err) {
      alert('שגיאה בקביעת הפגישה: ' + err.message)
    } finally {
      setBooking(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">טוען...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl text-gray-600">{error}</p>
        </div>
      </div>
    )
  }

  if (booked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">הפגישה נקבעה!</h1>
          <p className="text-gray-600">
            {selectedSlot.toLocaleString('he-IL', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
          <p className="text-sm text-gray-500 mt-4">תקבל אישור ב-WhatsApp בקרוב</p>
        </div>
      </div>
    )
  }

  const slots = generateSlots()
  const slotsByDate = {}
  slots.forEach(s => {
    const key = s.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })
    if (!slotsByDate[key]) slotsByDate[key] = []
    slotsByDate[key].push(s)
  })

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-xl shadow-lg p-6 mb-4">
          <h1 className="text-2xl font-bold text-gray-800 mb-1">קביעת פגישה</h1>
          <p className="text-gray-600">
            שלום {contact?.name}, בחר מועד נוח לפגישה:
          </p>
        </div>

        {Object.keys(slotsByDate).length === 0 ? (
          <div className="bg-white rounded-xl shadow-lg p-6 text-center">
            <p className="text-gray-500">אין מועדים פנויים כרגע</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(slotsByDate).map(([date, daySlots]) => (
              <div key={date} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                <h3 className="font-medium text-gray-700 mb-3">{date}</h3>
                <div className="flex flex-wrap gap-2">
                  {daySlots.map((slot, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedSlot(slot)}
                      className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                        selectedSlot?.getTime() === slot.getTime()
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {slot.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {selectedSlot && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-blue-800 font-medium mb-3">
                  המועד שנבחר:{' '}
                  {selectedSlot.toLocaleString('he-IL', {
                    weekday: 'long', day: 'numeric', month: 'long',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </p>
                <button
                  onClick={bookSlot}
                  disabled={booking}
                  className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
                >
                  {booking ? 'קובע פגישה...' : 'אשר פגישה'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
