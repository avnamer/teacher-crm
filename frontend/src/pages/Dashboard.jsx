import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

export default function Dashboard() {
  const [contacts, setContacts] = useState([])
  const [meetings, setMeetings] = useState([])
  const [stats, setStats] = useState({ total: 0, male: 0, female: 0, upcoming: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    try {
      // Load contacts with their latest interaction
      const { data: contactsData, error: contactsError } = await supabase
        .from('contacts')
        .select('*')
        .order('updated_at', { ascending: false })

      if (contactsError) throw contactsError

      // Load latest interaction per contact
      const contactsWithInteraction = await Promise.all(
        (contactsData || []).map(async (contact) => {
          const { data: interactions } = await supabase
            .from('interactions')
            .select('*')
            .eq('contact_id', contact.id)
            .order('created_at', { ascending: false })
            .limit(1)
          return {
            ...contact,
            lastInteraction: interactions?.[0] || null,
          }
        })
      )

      // Load upcoming meetings
      const { data: meetingsData } = await supabase
        .from('meetings')
        .select('*, contacts(name, phone)')
        .eq('status', 'scheduled')
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(5)

      setContacts(contactsWithInteraction)
      setMeetings(meetingsData || [])
      setStats({
        total: contactsData?.length || 0,
        male: contactsData?.filter(c => c.gender === 'male').length || 0,
        female: contactsData?.filter(c => c.gender === 'female').length || 0,
        upcoming: meetingsData?.length || 0,
      })
    } catch (err) {
      console.error('Error loading dashboard:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 text-lg">טוען...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">דשבורד</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="סה״כ אנשי קשר" value={stats.total} color="blue" />
        <StatCard label="מורים" value={stats.male} color="indigo" />
        <StatCard label="מורות" value={stats.female} color="pink" />
        <StatCard label="פגישות קרובות" value={stats.upcoming} color="green" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent contacts */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">אנשי קשר אחרונים</h2>
            <Link to="/contacts" className="text-blue-600 text-sm hover:underline">
              הצג הכל
            </Link>
          </div>
          {contacts.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              אין אנשי קשר.{' '}
              <Link to="/import" className="text-blue-600 hover:underline">ייבא CSV</Link>
            </p>
          ) : (
            <div className="space-y-2">
              {contacts.slice(0, 5).map(contact => (
                <Link
                  key={contact.id}
                  to={`/contacts/${contact.id}`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <div className="font-medium text-gray-800">{contact.name}</div>
                    <div className="text-sm text-gray-500">{contact.school || 'ללא בית ספר'}</div>
                  </div>
                  <div className="text-left">
                    {contact.lastInteraction ? (
                      <div className="text-xs text-gray-400">
                        {formatInteractionType(contact.lastInteraction.type)}
                        {' · '}
                        {formatDate(contact.lastInteraction.created_at)}
                      </div>
                    ) : (
                      <span className="text-xs text-orange-500">אין אינטראקציה</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming meetings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">פגישות קרובות</h2>
            <Link to="/meetings" className="text-blue-600 text-sm hover:underline">
              הצג הכל
            </Link>
          </div>
          {meetings.length === 0 ? (
            <p className="text-gray-500 text-center py-8">אין פגישות מתוזמנות</p>
          ) : (
            <div className="space-y-2">
              {meetings.map(meeting => (
                <div
                  key={meeting.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-gray-50"
                >
                  <div>
                    <div className="font-medium text-gray-800">
                      {meeting.contacts?.name || 'לא ידוע'}
                    </div>
                    <div className="text-sm text-gray-500">
                      {meeting.duration_minutes} דקות
                    </div>
                  </div>
                  <div className="text-sm text-blue-600">
                    {formatDateTime(meeting.scheduled_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    pink: 'bg-pink-50 text-pink-700 border-pink-200',
    green: 'bg-green-50 text-green-700 border-green-200',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm mt-1">{label}</div>
    </div>
  )
}

function formatInteractionType(type) {
  const types = {
    whatsapp_sent: 'הודעה נשלחה',
    whatsapp_received: 'הודעה התקבלה',
    meeting: 'פגישה',
    phone_call: 'שיחת טלפון',
  }
  return types[type] || type
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('he-IL')
}

function formatDateTime(dateStr) {
  return new Date(dateStr).toLocaleString('he-IL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
