import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { INTERACTION_TYPES, interactionIcon, interactionLabel, isSentMessage } from '../lib/interactions.js'
import WhatsAppMessageList from '../components/WhatsAppMessageList.jsx'
import { isTaskDone, loadTaskColumns, TASK_SOURCE_LABEL } from '../lib/teachers.js'

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function dateWithDaysAgo(dateStr) {
  const days = daysSince(dateStr)
  const dateLabel = new Date(dateStr).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })
  // A negative days-since is a future date (e.g. a scheduled meeting) — "לפני -X ימים"
  // reads as nonsense, so a future date gets its own "בעוד" (in X days) phrasing.
  const daysLabel =
    days === 0 ? 'היום' :
    days === 1 ? 'לפני יום' :
    days === -1 ? 'בעוד יום' :
    days < 0 ? `בעוד ${-days} ימים` :
    `לפני ${days} ימים`
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
  const [editType, setEditType] = useState('')
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  const [infoOpen, setInfoOpen] = useState(false)
  const [taskColumns, setTaskColumns] = useState([])
  const [savingTaskKey, setSavingTaskKey] = useState(null)
  const [showDoneJournalTasks, setShowDoneJournalTasks] = useState(false)

  useEffect(() => {
    loadContact()
  }, [id])

  async function loadContact() {
    try {
      const [contactRes, interactionsRes, meetingsRes, taskCols] = await Promise.all([
        supabase.from('contacts').select('*').eq('id', id).single(),
        supabase.from('interactions').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
        supabase.from('meetings').select('*').eq('contact_id', id).order('scheduled_at', { ascending: false }),
        loadTaskColumns(supabase),
      ])
      if (contactRes.error) throw contactRes.error
      setTaskColumns(taskCols)
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
      // Confirmed live (2026-09-29/30): this form only ever edits whatsappSync
      // and whatsappGroupAliases within custom_fields. Spreading the whole of
      // form.custom_fields (loaded once at page mount) blindly overwrote
      // fields an entirely separate process manages out-of-band — specifically
      // the sync's own whatsappLastMessageAt/whatsappLastGroupMessageAt
      // cursors, which the backend advances server-side during a sync. If the
      // contact page had been open (even just sitting there) since before a
      // sync ran, saving ANY edit reverted those cursors to their stale
      // page-load value, silently making the sync think old messages were
      // never read. Re-fetching custom_fields fresh right before merging in
      // just the two fields this form actually edits avoids clobbering
      // anything else, known or not.
      const { data: freshContact, error: fetchErr } = await supabase
        .from('contacts')
        .select('custom_fields')
        .eq('id', id)
        .single()
      if (fetchErr) throw fetchErr
      const custom_fields = {
        ...(freshContact.custom_fields || {}),
        whatsappSync: form.custom_fields?.whatsappSync,
        whatsappGroupAliases: form.custom_fields?.whatsappGroupAliases,
        _manual_edit: true,
      }
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
          custom_fields,
        })
        .eq('id', id)
      if (error) throw error
      setContact({ ...form, custom_fields })
      setEditing(false)
    } catch (err) {
      alert('שגיאה בשמירה: ' + err.message)
    }
  }

  // Same write as the dashboard's task cell (Contacts.jsx saveCell): a plain boolean in
  // custom_fields, with _manual_edit so a later Monday sync doesn't overwrite the mark.
  async function toggleDashboardTask(col) {
    if (savingTaskKey) return
    setSavingTaskKey(col.key)
    const customFields = { ...(contact.custom_fields || {}), [col.key]: !isTaskDone(contact, col), _manual_edit: true }
    try {
      const { data, error } = await supabase
        .from('contacts')
        .update({ custom_fields: customFields })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      setContact(data)
      setForm(data)
    } catch (err) {
      alert('שגיאה בעדכון משימה: ' + err.message)
    } finally {
      setSavingTaskKey(null)
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
    // Journal entries aren't a selectable target type (only a real communication type
    // makes sense to classify *into*) — '' means "leave as journal", so saving without
    // touching the dropdown never silently reclassifies it as whatever option is first.
    setEditType(i.type === 'journal' ? '' : i.type)
  }

  function cancelEditInteraction() {
    setEditingInteractionId(null)
    setEditContent('')
    setEditType('')
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

  // Marks whether a sent message/mailing actually got a response — only then does it count
  // toward the "last contact" recency indicators on the dashboard (see countsTowardRecency).
  async function toggleResponded(interaction) {
    const newMetadata = { ...interaction.metadata, responded: !interaction.metadata?.responded }
    try {
      const { error } = await supabase
        .from('interactions')
        .update({ metadata: newMetadata })
        .eq('id', interaction.id)
      if (error) throw error
      setInteractions(prev => prev.map(x => (x.id === interaction.id ? { ...x, metadata: newMetadata } : x)))
    } catch (err) {
      alert('שגיאה בעדכון: ' + err.message)
    }
  }

  async function deleteInteraction(i) {
    if (!confirm('למחוק את האינטראקציה לצמיתות?')) return
    try {
      const { error } = await supabase.from('interactions').delete().eq('id', i.id)
      if (error) throw error
      setInteractions(prev => prev.filter(x => x.id !== i.id))
      if (editingInteractionId === i.id) cancelEditInteraction()
      // A whatsapp row's own cursor (whatsappLastMessageAt / per-group cursor)
      // stays on the contact after the row is gone — confirmed live: without
      // clearing it, the next sync thinks everything up to that timestamp is
      // already saved and never re-reads the messages that were just deleted.
      if (i.type === 'whatsapp') await clearWhatsAppCursor(i.metadata)
    } catch (err) {
      alert('שגיאה במחיקה: ' + err.message)
    }
  }

  async function clearWhatsAppCursor(metadata) {
    const fields = contact.custom_fields || {}
    let nextFields
    if (metadata?.source === 'group' && metadata?.group_id) {
      const { [metadata.group_id]: _removed, ...restGroupCursors } = fields.whatsappLastGroupMessageAt || {}
      nextFields = { ...fields, whatsappLastGroupMessageAt: restGroupCursors }
    } else {
      const { whatsappLastMessageAt: _removed, ...rest } = fields
      nextFields = rest
    }
    const { error } = await supabase.from('contacts').update({ custom_fields: nextFields }).eq('id', contact.id)
    if (error) { console.error('Error clearing whatsapp cursor:', error); return }
    setContact(prev => ({ ...prev, custom_fields: nextFields }))
  }

  async function saveInteractionContent(i) {
    try {
      const updates = { content: editContent, ...(editType ? { type: editType } : {}) }
      const { error } = await supabase
        .from('interactions')
        .update(updates)
        .eq('id', i.id)
      if (error) throw error
      setInteractions(prev => prev.map(x => (x.id === i.id ? { ...x, ...updates } : x)))
      setEditingInteractionId(null)
      setEditContent('')
      setEditType('')
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

      {/* Contact info card — collapsed by default (accordion), forced open while editing */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <button onClick={() => setInfoOpen(!infoOpen)} disabled={editing}
            className="flex items-center gap-2 text-right" title={infoOpen ? 'הסתר פרטים' : 'הצג פרטים'}>
            <span className={`text-gray-400 text-sm transition-transform ${infoOpen || editing ? '-rotate-90' : ''}`}>◀</span>
            <h1 className="text-2xl font-bold text-gray-800">{contact.name}</h1>
            {!(infoOpen || editing) && (
              <span className="text-sm text-gray-400 font-normal">פרטי קשר</span>
            )}
          </button>
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
              <button onClick={() => { setEditing(true); setInfoOpen(true) }}
                className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                ערוך
              </button>
            )}
          </div>
        </div>

        {editing ? (
          <div className="grid md:grid-cols-2 gap-4 mt-4">
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
            <div className="md:col-span-2 border-t pt-3 space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={!!form.custom_fields?.whatsappSync}
                  onChange={e => setForm({...form, custom_fields: {...form.custom_fields, whatsappSync: e.target.checked}})}
                  className="w-4 h-4" />
                💬 סנכרן וואטסאפ
              </label>
              {form.custom_fields?.whatsappSync && (
                <div>
                  <label className="text-sm text-gray-500">שם/כינוי בקבוצות וואטסאפ</label>
                  <input value={form.custom_fields?.whatsappGroupAliases || ''}
                    onChange={e => setForm({...form, custom_fields: {...form.custom_fields, whatsappGroupAliases: e.target.value}})}
                    placeholder="אם ריק — משתמשים בשם המורה. אפשר כמה כינויים מופרדים בפסיק"
                    className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
            </div>
          </div>
        ) : infoOpen && (
          <div className="grid md:grid-cols-2 gap-4 mt-4">
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

      {/* Dashboard task columns — done vs. not done for this teacher */}
      <DashboardTasksCard
        contact={contact}
        taskColumns={taskColumns}
        savingKey={savingTaskKey}
        onToggle={toggleDashboardTask}
      />

      {/* Follow-up tasks the system extracted into journal/interaction records */}
      <JournalTasksCard
        interactions={interactions}
        showDone={showDoneJournalTasks}
        onToggleShowDone={() => setShowDoneJournalTasks(!showDoneJournalTasks)}
        onToggleItem={toggleActionItem}
      />

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
                    <span className="text-lg shrink-0" title={interactionLabel(i)}>{interactionIcon(i)}</span>
                    <span className="text-sm font-medium text-gray-700 shrink-0 whitespace-nowrap">{title}</span>
                    {pendingCount > 0 && (
                      <span className="shrink-0 text-amber-500" title={`${pendingCount} משימות פתוחות`}>❗</span>
                    )}
                    {i.content ? (
                      <span className="flex-1 min-w-0 truncate text-sm text-gray-400">{i.content}</span>
                    ) : (
                      <span className="flex-1" />
                    )}
                    {isSentMessage(i) && (
                      <label className="flex items-center gap-1 text-xs text-gray-500 shrink-0 whitespace-nowrap"
                        title="סמן אם התקבלה תגובה מהמורה להודעה הזו">
                        <input type="checkbox" checked={!!i.metadata?.responded}
                          onChange={() => toggleResponded(i)}
                          className="w-4 h-4" />
                        הייתה תגובה
                      </label>
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
                      {i.metadata?.summary && (
                        <p className="text-sm text-gray-600 bg-blue-50 rounded p-2 mb-2">
                          <span className="text-xs font-medium text-blue-700">סיכום AI: </span>
                          {i.metadata.summary}
                        </p>
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
                          <select value={editType} onChange={e => setEditType(e.target.value)}
                            className="px-2 py-1 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
                            {editType === '' && <option value="">📝 רשומת יומן (ללא סיווג)</option>}
                            {INTERACTION_TYPES.map(t => (
                              <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                            ))}
                          </select>
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
                      ) : i.type === 'whatsapp' && i.metadata?.messages?.length > 0 ? (
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <WhatsAppMessageList metadata={i.metadata} />
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => deleteInteraction(i)}
                              className="text-xs text-gray-400 hover:text-red-600" title="מחק אינטראקציה">
                              🗑️
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

function DashboardTasksCard({ contact, taskColumns, savingKey, onToggle }) {
  const open = taskColumns.filter(col => !isTaskDone(contact, col))
  const done = taskColumns.filter(col => isTaskDone(contact, col))
  const renderItem = col => {
    const isDone = isTaskDone(contact, col)
    return (
      <li key={col.key}>
        <button onClick={() => onToggle(col)} disabled={savingKey !== null}
          className="w-full flex items-center gap-2 text-sm text-right px-2 py-1.5 rounded-lg hover:bg-white disabled:opacity-50"
          title={isDone ? 'לחץ לביטול סימון' : 'לחץ לסימון כבוצע'}>
          <span className={`w-5 h-5 shrink-0 rounded border flex items-center justify-center text-xs ${
            isDone ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 bg-white text-transparent'
          }`}>✓</span>
          <span className={isDone ? 'text-gray-500' : 'text-gray-800'}>{col.label}</span>
          <span className={`text-xs ${col.taskSource === 'monday' ? 'text-orange-400' : 'text-purple-400'}`}>
            ({TASK_SOURCE_LABEL[col.taskSource] || col.taskSource})
          </span>
        </button>
      </li>
    )
  }
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">משימות מהדשבורד</h2>
        {taskColumns.length > 0 && (
          <span className="text-sm text-gray-500">{done.length}/{taskColumns.length} טופלו</span>
        )}
      </div>
      {taskColumns.length === 0 ? (
        <p className="text-gray-500 text-center py-4">אין עמודות משימה בדשבורד</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-red-100 bg-red-50 p-3">
            <p className="text-sm font-medium text-red-700 mb-2">לא טופל ({open.length})</p>
            {open.length === 0
              ? <p className="text-xs text-gray-400 px-2">הכל טופל 🎉</p>
              : <ul className="space-y-0.5">{open.map(renderItem)}</ul>}
          </div>
          <div className="rounded-lg border border-green-100 bg-green-50 p-3">
            <p className="text-sm font-medium text-green-700 mb-2">טופל ({done.length})</p>
            {done.length === 0
              ? <p className="text-xs text-gray-400 px-2">עדיין לא טופלו משימות</p>
              : <ul className="space-y-0.5">{done.map(renderItem)}</ul>}
          </div>
        </div>
      )}
    </div>
  )
}

function JournalTasksCard({ interactions, showDone, onToggleShowDone, onToggleItem }) {
  // Flatten every interaction's action_items, keeping a pointer back to its source record
  // so closing one writes to the right interaction (same toggle as inside the history list).
  const all = []
  for (const i of interactions) {
    (i.metadata?.action_items || []).forEach((item, idx) => all.push({ interaction: i, item, idx }))
  }
  const open = all.filter(t => !t.item.done)
  const done = all.filter(t => t.item.done)
  const renderItem = ({ interaction, item, idx }) => (
    <li key={`${interaction.id}-${idx}`} className="flex items-start gap-2 p-2 rounded-lg bg-white">
      <input type="checkbox" checked={!!item.done} onChange={() => onToggleItem(interaction, idx)}
        className="w-4 h-4 mt-0.5 shrink-0" title={item.done ? 'פתח מחדש' : 'סמן כבוצע'} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${item.done ? 'line-through text-gray-400' : 'text-gray-800'}`}>{item.text}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {interactionIcon(interaction)} {interactionLabel(interaction)} · {new Date(interaction.created_at).toLocaleDateString('he-IL')}
          {item.due_date && <> · 📅 יעד: {new Date(item.due_date).toLocaleDateString('he-IL')}</>}
        </p>
      </div>
    </li>
  )
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">משימות מיומן האירועים</h2>
        {all.length > 0 && <span className="text-sm text-gray-500">{open.length} פתוחות</span>}
      </div>
      {all.length === 0 ? (
        <p className="text-gray-500 text-center py-4">לא תועדו משימות ביומן</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-red-100 bg-red-50 p-3">
            <p className="text-sm font-medium text-red-700 mb-2">לא טופל ({open.length})</p>
            {open.length === 0
              ? <p className="text-xs text-gray-400 px-2">הכל טופל 🎉</p>
              : <ul className="space-y-2">{open.map(renderItem)}</ul>}
          </div>
          {/* Handled tasks stay collapsed — the list only grows over the year */}
          <div className="rounded-lg border border-green-100 bg-green-50">
            <button onClick={onToggleShowDone} disabled={done.length === 0}
              className="w-full flex items-center gap-2 p-3 text-sm font-medium text-green-700 text-right disabled:cursor-default">
              <span className={`text-xs transition-transform ${showDone ? '-rotate-90' : ''}`}>◀</span>
              טופל
              <span className="px-2 py-0.5 rounded-full bg-green-100 text-xs">{done.length}</span>
            </button>
            {showDone && <ul className="space-y-2 px-3 pb-3">{done.map(renderItem)}</ul>}
          </div>
        </div>
      )}
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



function typeLabel(type, metadata) {
  if (type === 'journal') return metadata?.column_label || 'רשומת יומן'
  return INTERACTION_TYPES.find(t => t.value === type)?.label || type
}
function statusColor(s) {
  return { scheduled: 'bg-blue-100 text-blue-700', completed: 'bg-green-100 text-green-700', cancelled: 'bg-gray-100 text-gray-600', no_show: 'bg-red-100 text-red-700' }[s] || ''
}
function statusLabel(s) {
  return { scheduled: 'מתוזמנת', completed: 'הושלמה', cancelled: 'בוטלה', no_show: 'לא הגיע' }[s] || s
}
