import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import { phoneProblem } from '../lib/whatsapp.js'
import { isAdminRow } from '../lib/teachers.js'

// Hand-pick recipients from the contact list, independent of any task. The chosen ids
// go to BulkSendModal as its preset contacts (same path the Monday page uses), so the
// template step, preview and send queue are the existing ones.
export default function ContactPickerModal({ onClose, onConfirm }) {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() => new Set())

  useEffect(() => {
    supabase.from('contacts').select('*').order('name').then(({ data, error }) => {
      if (error) console.error(error)
      // The admin pseudo-row is a task container, not a person.
      setContacts((data || []).filter(c => !isAdminRow(c)))
      setLoading(false)
    })
  }, [])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.school?.toLowerCase().includes(q) ||
      c.phone?.includes(q)
    )
  }, [contacts, search])

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allVisibleSelected = visible.length > 0 && visible.every(c => selected.has(c.id))

  function toggleAllVisible() {
    setSelected(prev => {
      const next = new Set(prev)
      visible.forEach(c => (allVisibleSelected ? next.delete(c.id) : next.add(c.id)))
      return next
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold">👥 בחירת אנשי קשר לשליחה</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="p-4 border-b space-y-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם, בית ספר או טלפון..."
            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleAllVisible}
              className="w-4 h-4"
            />
            בחר את כל המוצגים ({visible.length})
          </label>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-gray-500 text-center py-8">טוען...</p>
          ) : visible.length === 0 ? (
            <p className="text-gray-500 text-center py-8">לא נמצאו אנשי קשר</p>
          ) : (
            visible.map(c => {
              const problem = phoneProblem(c)
              return (
                <label
                  key={c.id}
                  className={`flex items-center gap-3 px-4 py-2 border-b last:border-0 text-sm cursor-pointer hover:bg-gray-50 ${
                    selected.has(c.id) ? 'bg-green-50' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="w-4 h-4"
                  />
                  <span className="text-gray-800">{c.name}</span>
                  <span className="text-gray-400 text-xs">{c.school}</span>
                  {problem && <span className="mr-auto text-xs text-red-500">⚠ {problem}</span>}
                </label>
              )
            })
          )}
        </div>

        <div className="flex gap-2 p-6 border-t items-center">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm">
            ביטול
          </button>
          <span className="text-sm text-gray-600 mr-2">{selected.size} נבחרו</span>
          <div className="flex-1" />
          <button
            onClick={() => onConfirm([...selected])}
            disabled={selected.size === 0}
            className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-40"
          >
            המשך לבחירת הודעה ←
          </button>
        </div>
      </div>
    </div>
  )
}
