import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function AddMeetingModal({ teachers, onClose, onSaved }) {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  function toggleTeacher(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds(selectedIds.size === teachers.length ? new Set() : new Set(teachers.map(t => t.id)))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (selectedIds.size === 0) {
      alert('יש לבחור לפחות מורה אחד')
      return
    }
    if (!content.trim()) {
      alert('יש למלא את תוכן הפגישה')
      return
    }
    setSaving(true)
    try {
      const selected = teachers.filter(t => selectedIds.has(t.id))
      const createdAt = new Date(`${date}T12:00:00`).toISOString()
      const rows = selected.map(t => ({
        contact_id: t.id,
        type: 'meeting',
        content: content.trim(),
        created_at: createdAt,
        metadata: { attendees: selected.filter(o => o.id !== t.id).map(o => o.name) },
      }))
      const { error } = await supabase.from('interactions').insert(rows)
      if (error) throw error
      onSaved()
    } catch (err) {
      alert('שגיאה בשמירת הפגישה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">הוסף פגישה</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-sm text-gray-500 mb-1 block">תאריך הפגישה</label>
            <input
              type="date"
              required
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-gray-500">מורים שהשתתפו *</label>
              <button type="button" onClick={toggleSelectAll} className="text-xs text-blue-600 hover:underline">
                {selectedIds.size === teachers.length ? 'נקה הכל' : 'בחר הכל'}
              </button>
            </div>
            <div className="border rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-100">
              {teachers.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">אין מורים</p>
              ) : (
                teachers.map(t => (
                  <label key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(t.id)}
                      onChange={() => toggleTeacher(t.id)}
                      className="w-4 h-4"
                    />
                    {t.name}
                  </label>
                ))
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">{selectedIds.size} נבחרו</p>
          </div>

          <div>
            <label className="text-sm text-gray-500 mb-1 block">תוכן הפגישה *</label>
            <textarea
              required
              rows={4}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="על מה דיברתם בפגישה?"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'שומר...' : 'שמור'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
