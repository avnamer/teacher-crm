import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function dateWithDaysAgo(dateStr) {
  const days = daysSince(dateStr)
  const dateLabel = new Date(dateStr).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })
  const daysLabel = days === 0 ? 'היום' : days === 1 ? 'לפני יום' : `לפני ${days} ימים`
  return `${dateLabel} (${daysLabel})`
}

export default function ContactDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [contact, setContact] = useState(null)
  const [interactions, setInteractions] = useState([])
  const [meetings, setMeetings] = useState([])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [loading, setLoading] = useState(true)
  const [editingInteractionId, setEditingInteractionId] = useState(null)
  const [editContent, setEditContent] = useState('')
  const [expandedIds, setExpandedIds] = useState(() => new Set())

  useEffect(() => {
    loadContact()
  }, [id])

  async function loadContact() {
    try {
      const [contactRes, interactionsRes, meetingsRes] = await Promise.all([
        supabase.from('contacts').select('*').eq('id', id).single(),
        supabase.from('interactions').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
        supabase.from('meetings').select('*').eq('contact_id', id).order('scheduled_at', { ascending: false }),
      ])
      if (contactRes.error) throw contactRes.error
      setContact(contactRes.data)
      setForm(contactRes.data)
      setInteractions(interactionsRes.data || [])
      setMeetings(meetingsRes.data || [])
    } catch (err) {
      console.error(err)
      alert('שגיאה בטעינת איש קשר')
    } finally {
      setLoading(false)
    }
  }

  async function saveContact() {
    try {
      const { error } = await supabase
        .from('contacts')
        .update({
          name: form.name,
          email: form.email,
          phone: form.phone,
          school: form.school,
          class_name: form.class_name,
          gender: form.gender,
          hackathon_date: form.hackathon_date || null,
          birthday: form.birthday || null,
          custom_fields: { ...(form.custom_fields || {}), _manual_edit: true },
        })
        .eq('id', id)
      if (error) throw error
      setContact(form)
      setEditing(false)
    } catch (err) {
      alert('שגיאה בשמירה: ' + err.message)
    }
  }

  function toggleExpand(id) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function startEditInteraction(i) {
    setEditingInteractionId(i.id)
    setEditContent(i.content || '')
  }

  function cancelEditInteraction() {
    setEditingInteractionId(null)
    setEditContent('')
  }

  async function toggleActionItem(interaction, itemIndex) {
    const items = interaction.metadata.action_items.map((item, idx) =>
      idx === itemIndex ? { ...item, done: !item.done } : item
    )
    const newMetadata = { ...interaction.metadata, action_items: items }
    try {
      const { error } = await supabase
        .from('interactions')
        .update({ metadata: newMetadata })
        .eq('id', interaction.id)
      if (error) throw error
      setInteractions(prev => prev.map(x => (x.id === interaction.id ? { ...x, metadata: newMetadata } : x)))
    } catch (err) {
      alert('שגיאה בעדכון משימה: ' + err.message)
    }
  }

  async function deleteInteraction(i) {
    if (!confirm('למחוק את האינטראקציה לצמיתות?')) return
    try {
      const { error } = await supabase.from('interactions').delete().eq('id', i.id)
      if (error) throw error
      setInteractions(prev => prev.filter(x => x.id !== i.id))
      if (editingInteractionId === i.id) cancelEditInteraction()
    } catch (err) {
      alert('שגיאה במחיקה: ' + err.message)
    }
  }

  async function saveInteractionContent(i) {
    try {
      const { error } = await supabase
        .from('interactions')
        .update({ content: editContent })
        .eq('id', i.id)
      if (error) throw error
      setInteractions(prev => prev.map(x => (x.id === i.id ? { ...x, content: editContent } : x)))
      setEditingInteractionId(null)
      setEditContent('')
    } catch (err) {
      alert('שגיאה בשמירה: ' + err.message)
    }
  }

  async function deleteContact() {
    if (!confirm('האם למחוק את איש הקשר לצמיתות?')) return
    const { error } = await supabase.from('contacts').delete().eq('id', id)
    if (error) {
      alert('שגיאה במחיקה')
    } else {
      navigate('/contacts')
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">טוען...</div>
  }

  if (!contact) {
    return <div className="text-center py-12 text-gray-500">איש קשר לא נמצא</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/contacts" className="hover:text-blue-600">אנשי קשר</Link>
        <span>←</span>
        <span>{contact.name}</span>
      </div>

      {/* Contact info card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-start justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-800">{contact.name}</h1>
          <div className="flex gap-2">
            {editing ? (
              <>
                <button onClick={saveContact}
                  className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                  שמור
                </button>
                <button onClick={() => { setEditing(false); setForm(contact) }}
                  className="px-3 py-1 border rounded-lg text-sm hover:bg-gray-50">
                  ביטול
                </button>
              </>
            ) : (
              <button onClick={() => setEditing(true)}
                className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                ערוך
              </button>
            )}
          </div>
        </div>

        {editing ? (
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="שם" value={form.name} onChange={v => setForm({...form, name: v})} />
            <Field label="טלפון" value={form.phone} onChange={v => setForm({...form, phone: v})} dir="ltr" />
            <Field label="מייל" value={form.email} onChange={v => setForm({...form, email: v})} dir="ltr" />
            <Field label="בית ספר" value={form.school} onChange={v => setForm({...form, school: v})} />
            <Field label="כיתה" value={form.class_name} onChange={v => setForm({...form, class_name: v})} />
            <div>
              <label className="text-sm text-gray-500">מגדר</label>
              <select value={form.gender} onChange={e => setForm({...form, gender: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg outline-none">
                <option value="male">זכר</option>
                <option value="female">נקבה</option>
              </select>
            </div>
            <Field label="מועד אקתון" value={form.hackathon_date?.split('T')[0] || ''}
              onChange={v => setForm({...form, hackathon_date: v})} type="date" />
            <Field label="יום הולדת" value={form.birthday?.split('T')[0] || ''}
              onChange={v => setForm({...form, birthday: v})} type="date" />
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <InfoRow label="טלפון" value={contact.phone} dir="ltr" />
            <InfoRow label="מייל" value={contact.email} dir="ltr" />
            <InfoRow label="בית ספר" value={contact.school} />
            <InfoRow label="כיתה" value={contact.class_name} />
            <InfoRow label="מגדר" value={contact.gender === 'male' ? 'זכר' : 'נקבה'} />
            <InfoRow label="מועד אקתון" value={contact.hackathon_date ? new Date(contact.hackathon_date).toLocaleDateString('he-IL') : null} />
            <InfoRow label="יום הולדת" value={contact.birthday ? new Date(contact.birthday).toLocaleDateString('he-IL') : null} />
          </div>
        )}
      </div>

      {/* Interaction history */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">היסטוריית אינטראקציות ויומן</h2>
        {interactions.length === 0 ? (
          <p className="text-gray-500 text-center py-4">אין אינטראקציות</p>
        ) : (
          <div className="space-y-2">
            {interactions.map(i => {
              const expanded = expandedIds.has(i.id)
              const dateBased = i.type === 'journal' || i.type === 'meeting'
              const title = dateBased ? dateWithDaysAgo(i.created_at) : typeLabel(i.type, i.metadata)
              const timeLabel = dateBased
                ? new Date(i.created_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
                : new Date(i.created_at).toLocaleString('he-IL')
              const attendees = i.metadata?.attendees
              const actionItems = i.metadata?.action_items || []
              const pendingCount = actionItems.filter(item => !item.done).length
              return (
                <div key={i.id} className="rounded-lg bg-gray-50 overflow-hidden">
                  <div className="flex items-center gap-2 p-3">
                    <span className="text-lg shrink-0">{typeIcon(i.type)}</span>
                    <span className="text-sm font-medium text-gray-700 shrink-0 whitespace-nowrap">{title}</span>
                    {pendingCount > 0 && (
                      <span className="shrink-0 text-amber-500" title={`${pendingCount} משימות פתוחות`}>❗</span>
                    )}
                    {i.content ? (
                      <span className="flex-1 min-w-0 truncate text-sm text-gray-400">{i.content}</span>
                    ) : (
                      <span className="flex-1" />
                    )}
                    <span className="text-xs text-gray-400 shrink-0 whitespace-nowrap">{timeLabel}</span>
                    <button onClick={() => toggleExpand(i.id)}
                      className="text-xs text-blue-600 hover:underline shrink-0 whitespace-nowrap">
                      {expanded ? 'הצג פחות' : 'המשך קריאה'}
                    </button>
                  </div>
                  {expanded && (
                    <div className="px-3 pb-3">
                      {attendees?.length > 0 && (
                        <p className="text-xs text-gray-400 mb-1">השתתפו גם: {attendees.join(', ')}</p>
                      )}
                      {actionItems.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs font-medium text-amber-700 mb-1">משימות המשך:</p>
                          <ul className="space-y-1">
                            {actionItems.map((item, idx) => (
                              <li key={idx} className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={!!item.done}
                                  onChange={() => toggleActionItem(i, idx)}
                                  className="w-4 h-4" />
                                <span className={item.done ? 'line-through text-gray-400' : 'text-gray-700'}>
                                  {item.text}
                                </span>
                                {item.due_date && (
                                  <span className="text-xs text-gray-400">
                                    📅 {new Date(item.due_date).toLocaleDateString('he-IL')}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {editingInteractionId === i.id ? (
                        <div className="space-y-2">
                          <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                            rows={3}
                            className="w-full px-2 py-1 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-blue-500 whitespace-pre-wrap" />
                          <div className="flex gap-2">
                            <button onClick={() => saveInteractionContent(i)}
                              className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
                              שמור
                            </button>
                            <button onClick={cancelEditInteraction}
                              className="px-2 py-1 border rounded text-xs hover:bg-gray-100">
                              ביטול
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-gray-600 whitespace-pre-wrap flex-1">{i.content}</p>
                          <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => startEditInteraction(i)}
                              className="text-xs text-gray-400 hover:text-blue-600" title="ערוך תוכן">
                              ✏️
                            </button>
                            <button onClick={() => deleteInteraction(i)}
                              className="text-xs text-gray-400 hover:text-red-600" title="מחק אינטראקציה">
                              🗑️
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Meetings */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">פגישות</h2>
        {meetings.length === 0 ? (
          <p className="text-gray-500 text-center py-4">אין פגישות</p>
        ) : (
          <div className="space-y-2">
            {meetings.map(m => (
              <div key={m.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                <div>
                  <span className="text-sm font-medium">{new Date(m.scheduled_at).toLocaleString('he-IL')}</span>
                  <span className="text-xs text-gray-500 mr-2">{m.duration_minutes} דקות</span>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${statusColor(m.status)}`}>
                  {statusLabel(m.status)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Danger zone — kept at the bottom, away from the "ערוך" button, to avoid accidental deletion */}
      <div className="bg-white rounded-xl shadow-sm border border-red-200 p-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800">מחיקת איש קשר</p>
          <p className="text-xs text-gray-500">פעולה זו תמחק את איש הקשר לצמיתות, כולל כל ההיסטוריה שלו</p>
        </div>
        <button onClick={deleteContact}
          className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 shrink-0">
          מחק איש קשר
        </button>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', dir }) {
  return (
    <div>
      <label className="text-sm text-gray-500">{label}</label>
      <input type={type} value={value || ''} dir={dir}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  )
}

function InfoRow({ label, value, dir }) {
  return (
    <div>
      <span className="text-sm text-gray-500">{label}: </span>
      <span className="text-gray-800" dir={dir}>{value || '-'}</span>
    </div>
  )
}

function typeIcon(type) {
  return { whatsapp_sent: '📤', whatsapp_received: '📥', meeting: '🤝', phone_call: '📞', journal: '📝' }[type] || '📋'
}
function typeLabel(type, metadata) {
  if (type === 'journal') return metadata?.column_label || 'רשומת יומן'
  return { whatsapp_sent: 'הודעה נשלחה', whatsapp_received: 'הודעה התקבלה', meeting: 'פגישה', phone_call: 'שיחת טלפון' }[type] || type
}
function statusColor(s) {
  return { scheduled: 'bg-blue-100 text-blue-700', completed: 'bg-green-100 text-green-700', cancelled: 'bg-gray-100 text-gray-600', no_show: 'bg-red-100 text-red-700' }[s] || ''
}
function statusLabel(s) {
  return { scheduled: 'מתוזמנת', completed: 'הושלמה', cancelled: 'בוטלה', no_show: 'לא הגיע' }[s] || s
}
