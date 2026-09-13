import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export default function AddMeetingModal({ teachers, onClose, onSaved }) {
  const [date, setDate] = useState(todayStr)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  // String comparison works here because both sides are 'YYYY-MM-DD'.
  const isFuture = date > todayStr()
  const selectedTeachers = teachers.filter(t => selectedIds.has(t.id))
  const schools = [...new Set(selectedTeachers.map(t => t.school).filter(Boolean))]

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
    if (!isFuture && !content.trim()) {
      alert('יש למלא את תוכן הפגישה')
      return
    }
    setSaving(true)
    try {
      const selected = teachers.filter(t => selectedIds.has(t.id))
      const createdAt = new Date(`${date}T12:00:00`).toISOString()
      // Ties multi-attendee rows back to one real-world meeting. created_at alone
      // can't do this reliably — two unrelated meetings scheduled for the same day
      // would collide, since the time portion is always fixed at noon.
      const meetingGroupId = crypto.randomUUID()
      const rows = selected.map(t => ({
        contact_id: t.id,
        type: 'meeting',
        content: content.trim() || null,
        created_at: createdAt,
        metadata: {
          attendees: selected.filter(o => o.id !== t.id).map(o => o.name),
          meeting_group_id: meetingGroupId,
          ...(isFuture ? { meeting_status: 'scheduled' } : {}),
        },
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
            {isFuture && (
              <p className="text-xs text-purple-600 mt-1">
                פגישה עתידית — ניתן להשלים את התוכן אחרי שהיא מתקיימת
              </p>
            )}
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
            {schools.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {schools.length === 1 ? `בית ספר: ${schools[0]}` : `בתי ספר: ${schools.join(', ')}`}
              </p>
            )}
          </div>

          <div>
            <label className="text-sm text-gray-500 mb-1 block">
              תוכן הפגישה{isFuture ? '' : ' *'}
            </label>
            <textarea
              required={!isFuture}
              rows={4}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={isFuture ? 'ניתן להשאיר ריק ולהשלים אחרי הפגישה' : 'על מה דיברתם בפגישה?'}
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
