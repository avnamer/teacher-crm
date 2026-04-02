import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { backendFetch } from '../lib/api.js'

export default function WhatsApp() {
  const [templates, setTemplates] = useState([])
  const [showEditor, setShowEditor] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [backendStatus, setBackendStatus] = useState('disconnected')
  const [showBulkSend, setShowBulkSend] = useState(false)

  useEffect(() => {
    loadTemplates()
    checkBackendStatus()
  }, [])

  async function loadTemplates() {
    try {
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      setTemplates(data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function checkBackendStatus() {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'
      const res = await fetch(`${backendUrl}/api/whatsapp/status`)
      const data = await res.json()
      setBackendStatus(data.status || 'disconnected')
    } catch {
      setBackendStatus('disconnected')
    }
  }

  async function deleteTemplate(id) {
    if (!confirm('למחוק את התבנית?')) return
    const { error } = await supabase.from('message_templates').delete().eq('id', id)
    if (!error) setTemplates(templates.filter(t => t.id !== id))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">WhatsApp</h1>
        <button
          onClick={() => setShowBulkSend(true)}
          disabled={templates.length === 0}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          📤 שלח לקבוצה
        </button>
      </div>

      {/* Connection status */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              backendStatus === 'connected' ? 'bg-green-500' :
              backendStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
              'bg-red-500'
            }`} />
            <span className="font-medium">
              {backendStatus === 'connected' ? 'מחובר ל-WhatsApp' :
               backendStatus === 'connecting' ? 'מתחבר...' :
               'לא מחובר'}
            </span>
          </div>
          <button
            onClick={checkBackendStatus}
            className="px-3 py-1 text-sm border rounded-lg hover:bg-gray-50"
          >
            רענן סטטוס
          </button>
        </div>
        {backendStatus === 'disconnected' && (
          <p className="text-sm text-gray-500 mt-2">
            שרת ה-Backend לא פעיל. הפעל אותו כדי לשלוח הודעות WhatsApp.
          </p>
        )}
      </div>

      {/* Templates */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">תבניות הודעה</h2>
          <button
            onClick={() => { setEditingTemplate(null); setShowEditor(true) }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            + תבנית חדשה
          </button>
        </div>

        {loading ? (
          <p className="text-gray-500 text-center py-4">טוען...</p>
        ) : templates.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            אין תבניות הודעה. צור תבנית חדשה כדי להתחיל.
          </p>
        ) : (
          <div className="space-y-3">
            {templates.map(t => (
              <div key={t.id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-gray-800">{t.name}</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setEditingTemplate(t); setShowEditor(true) }}
                      className="text-blue-600 text-sm hover:underline"
                    >
                      ערוך
                    </button>
                    <button
                      onClick={() => deleteTemplate(t.id)}
                      className="text-red-500 text-sm hover:underline"
                    >
                      מחק
                    </button>
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">הודעה לזכר:</span>
                    <p className="text-gray-700 bg-blue-50 rounded p-2 mt-1">{t.body_male}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">הודעה לנקבה:</span>
                    <p className="text-gray-700 bg-pink-50 rounded p-2 mt-1">{t.body_female}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Template variables help */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
        <h3 className="font-medium text-gray-700 mb-2">משתנים זמינים בתבניות:</h3>
        <div className="flex flex-wrap gap-2 text-sm">
          {['{{name}}', '{{school}}', '{{class_name}}', '{{hackathon_date}}', '{{phone}}'].map(v => (
            <code key={v} className="bg-white px-2 py-1 rounded border text-gray-600">{v}</code>
          ))}
        </div>
      </div>

      {/* Template editor modal */}
      {showEditor && (
        <TemplateEditor
          template={editingTemplate}
          onClose={() => setShowEditor(false)}
          onSaved={() => { setShowEditor(false); loadTemplates() }}
        />
      )}

      {/* Bulk send modal */}
      {showBulkSend && (
        <BulkSendModal
          templates={templates}
          backendStatus={backendStatus}
          onClose={() => setShowBulkSend(false)}
        />
      )}
    </div>
  )
}

function resolveMessage(body, contact) {
  const firstName = contact.name?.split(' ')[0] || ''
  return body
    .replace(/\{\{name\}\}/g, firstName)
    .replace(/\{\{school\}\}/g, contact.school || '')
    .replace(/\{\{class_name\}\}/g, contact.class_name || '')
    .replace(/\{\{hackathon_date\}\}/g, contact.hackathon_date
      ? new Date(contact.hackathon_date).toLocaleDateString('he-IL') : '')
    .replace(/\{\{phone\}\}/g, contact.phone || '')
}

function BulkSendModal({ templates, backendStatus, onClose, initialContactIds = null }) {
  const [step, setStep] = useState(1)
  const [selectedTemplate, setSelectedTemplate] = useState(templates[0] || null)
  const [filters, setFilters] = useState({ name: '', gender: 'all', school: '', dateFrom: '', dateTo: '' })
  const [allContacts, setAllContacts] = useState([])
  const [filteredContacts, setFilteredContacts] = useState([])
  const [loadingContacts, setLoadingContacts] = useState(false)
  const [saving, setSaving] = useState(false)

  // If initialContactIds provided (from Monday page), skip filter step
  const hasPresetContacts = initialContactIds !== null

  useEffect(() => {
    if (hasPresetContacts) {
      loadPresetContacts()
    } else {
      loadContacts()
    }
  }, [])

  useEffect(() => {
    if (!hasPresetContacts) applyFilters()
  }, [filters, allContacts])

  async function loadContacts() {
    setLoadingContacts(true)
    try {
      const { data, error } = await supabase.from('contacts').select('*').order('name')
      if (error) throw error
      setAllContacts(data || [])
      setFilteredContacts(data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingContacts(false)
    }
  }

  async function loadPresetContacts() {
    setLoadingContacts(true)
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .in('id', initialContactIds)
      if (error) throw error
      setAllContacts(data || [])
      setFilteredContacts(data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingContacts(false)
    }
  }

  function applyFilters() {
    let result = allContacts
    if (filters.name) {
      const q = filters.name.toLowerCase()
      result = result.filter(c => c.name?.toLowerCase().includes(q))
    }
    if (filters.gender !== 'all') {
      result = result.filter(c => c.gender === filters.gender)
    }
    if (filters.school) {
      const q = filters.school.toLowerCase()
      result = result.filter(c => c.school?.toLowerCase().includes(q))
    }
    if (filters.dateFrom) {
      result = result.filter(c => c.hackathon_date && c.hackathon_date >= filters.dateFrom)
    }
    if (filters.dateTo) {
      result = result.filter(c => c.hackathon_date && c.hackathon_date <= filters.dateTo)
    }
    setFilteredContacts(result)
  }

  async function handleSavePending() {
    if (filteredContacts.length === 0) return
    setSaving(true)
    try {
      const { error } = await supabase.from('scheduled_messages').insert({
        template_id: selectedTemplate.id,
        filter_criteria: {
          contact_ids: filteredContacts.map(c => c.id),
          filter: filters,
        },
        scheduled_for: new Date().toISOString(),
        status: 'pending',
      })
      if (error) throw error
      alert(`נשמר! ${filteredContacts.length} הודעות ממתינות לשליחה.`)
      onClose()
    } catch (err) {
      alert('שגיאה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSendNow() {
    if (filteredContacts.length === 0) return
    setSaving(true)
    try {
      await backendFetch('/api/whatsapp/bulk-send', {
        method: 'POST',
        body: JSON.stringify({
          template_id: selectedTemplate.id,
          contact_ids: filteredContacts.map(c => c.id),
        }),
      })
      alert(`שליחה החלה! ${filteredContacts.length} הודעות בתור.`)
      onClose()
    } catch (err) {
      alert('שגיאה בשליחה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const previewContacts = filteredContacts.slice(0, 3)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold">📤 שליחה מרובה</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {/* Step indicators */}
        <div className="flex px-6 pt-4 gap-2">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium ${
                step === s ? 'bg-blue-600 text-white' :
                step > s ? 'bg-green-500 text-white' :
                'bg-gray-200 text-gray-500'
              }`}>{step > s ? '✓' : s}</div>
              <span className="text-sm text-gray-600">
                {s === 1 ? 'תבנית' : s === 2 ? 'נמענים' : 'אישור'}
              </span>
              {s < 3 && <div className="w-8 h-px bg-gray-300 mx-1" />}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">

          {/* Step 1: Select template */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">בחר תבנית הודעה לשליחה:</p>
              <div className="space-y-2">
                {templates.map(t => (
                  <label key={t.id} className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedTemplate?.id === t.id ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'
                  }`}>
                    <input
                      type="radio"
                      name="template"
                      checked={selectedTemplate?.id === t.id}
                      onChange={() => setSelectedTemplate(t)}
                      className="mt-1"
                    />
                    <div>
                      <p className="font-medium text-gray-800">{t.name}</p>
                      <p className="text-sm text-gray-500 mt-1">{t.body_male.slice(0, 80)}...</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Filter recipients */}
          {step === 2 && (
            <div className="space-y-4">
              {hasPresetContacts ? (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
                  נבחרו {filteredContacts.length} אנשי קשר מראש
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-600">סנן את הנמענים:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">חיפוש לפי שם</label>
                      <input
                        value={filters.name}
                        onChange={e => setFilters({ ...filters, name: e.target.value })}
                        placeholder="הקלד שם..."
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">מגדר</label>
                      <select
                        value={filters.gender}
                        onChange={e => setFilters({ ...filters, gender: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        <option value="all">כולם</option>
                        <option value="male">זכר</option>
                        <option value="female">נקבה</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">בית ספר</label>
                      <input
                        value={filters.school}
                        onChange={e => setFilters({ ...filters, school: e.target.value })}
                        placeholder="שם בית הספר..."
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">אקתון מ-</label>
                        <input
                          type="date"
                          value={filters.dateFrom}
                          onChange={e => setFilters({ ...filters, dateFrom: e.target.value })}
                          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">עד-</label>
                        <input
                          type="date"
                          value={filters.dateTo}
                          onChange={e => setFilters({ ...filters, dateTo: e.target.value })}
                          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Results */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 flex items-center justify-between border-b">
                  <span className="text-sm font-medium text-gray-700">
                    {loadingContacts ? 'טוען...' : `${filteredContacts.length} אנשי קשר נבחרו`}
                  </span>
                  {filteredContacts.length === 0 && !loadingContacts && (
                    <span className="text-xs text-red-500">אין תוצאות</span>
                  )}
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredContacts.slice(0, 50).map(c => (
                    <div key={c.id} className="flex items-center gap-3 px-3 py-2 border-b last:border-0 text-sm">
                      <span className="text-gray-800">{c.name}</span>
                      <span className="text-gray-400 text-xs">{c.school}</span>
                      <span className={`mr-auto text-xs px-2 py-0.5 rounded-full ${
                        c.gender === 'male' ? 'bg-blue-100 text-blue-600' : 'bg-pink-100 text-pink-600'
                      }`}>{c.gender === 'male' ? 'זכר' : 'נקבה'}</span>
                    </div>
                  ))}
                  {filteredContacts.length > 50 && (
                    <div className="px-3 py-2 text-xs text-gray-400 text-center">
                      ועוד {filteredContacts.length - 50} נוספים...
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-1">תבנית:</p>
                <p className="font-medium">{selectedTemplate?.name}</p>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-1">נמענים:</p>
                <p className="font-medium text-2xl">{filteredContacts.length}</p>
                <p className="text-xs text-gray-500">אנשי קשר יקבלו הודעה</p>
              </div>

              {previewContacts.length > 0 && selectedTemplate && (
                <div>
                  <p className="text-sm text-gray-600 mb-2">תצוגה מקדימה (3 הודעות ראשונות):</p>
                  <div className="space-y-2">
                    {previewContacts.map(c => {
                      const body = c.gender === 'female' ? selectedTemplate.body_female : selectedTemplate.body_male
                      return (
                        <div key={c.id} className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                          <p className="text-xs text-gray-500 mb-1">→ {c.name} ({c.phone})</p>
                          <p className="text-gray-800 whitespace-pre-wrap">{resolveMessage(body, c)}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-6 border-t">
          {step > 1 && (
            <button
              onClick={() => setStep(s => s - 1)}
              className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm"
            >
              ← חזור
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm">
            ביטול
          </button>
          <div className="flex-1" />

          {step < 3 && (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={(step === 1 && !selectedTemplate) || (step === 2 && filteredContacts.length === 0)}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40"
            >
              הבא →
            </button>
          )}

          {step === 3 && (
            <div className="flex gap-2">
              <button
                onClick={handleSavePending}
                disabled={saving || filteredContacts.length === 0}
                className="px-4 py-2 bg-gray-700 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-40"
              >
                {saving ? 'שומר...' : '💾 שמור בתור ממתין'}
              </button>
              {backendStatus === 'connected' && (
                <button
                  onClick={handleSendNow}
                  disabled={saving || filteredContacts.length === 0}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-40"
                >
                  {saving ? 'שולח...' : '🚀 שלח עכשיו'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export { BulkSendModal }

function TemplateEditor({ template, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: template?.name || '',
    body_male: template?.body_male || '',
    body_female: template?.body_female || '',
    media_url: template?.media_url || '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name || !form.body_male || !form.body_female) {
      alert('מלא את כל השדות הנדרשים')
      return
    }
    setSaving(true)
    try {
      if (template) {
        const { error } = await supabase
          .from('message_templates')
          .update(form)
          .eq('id', template.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('message_templates').insert(form)
        if (error) throw error
      }
      onSaved()
    } catch (err) {
      alert('שגיאה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg p-6">
        <h2 className="text-xl font-bold mb-4">
          {template ? 'ערוך תבנית' : 'תבנית חדשה'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-gray-600">שם התבנית</label>
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
              placeholder="למשל: הזמנה לאקתון"
              className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-sm text-gray-600">הודעה לזכר</label>
            <textarea value={form.body_male} onChange={e => setForm({...form, body_male: e.target.value})}
              rows={3} placeholder="שלום {{name}}, ..."
              className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-sm text-gray-600">הודעה לנקבה</label>
            <textarea value={form.body_female} onChange={e => setForm({...form, body_female: e.target.value})}
              rows={3} placeholder="שלום {{name}}, ..."
              className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-sm text-gray-600">קישור למדיה (אופציונלי)</label>
            <input value={form.media_url} onChange={e => setForm({...form, media_url: e.target.value})}
              placeholder="https://..." dir="ltr"
              className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'שומר...' : 'שמור'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 border rounded-lg hover:bg-gray-50">
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
