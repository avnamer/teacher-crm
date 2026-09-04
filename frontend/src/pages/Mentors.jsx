import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

export default function Mentors() {
  const [mentors, setMentors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [editMentor, setEditMentor] = useState(null)

  useEffect(() => {
    loadMentors()
  }, [])

  async function loadMentors() {
    try {
      const { data, error } = await supabase
        .from('mentors')
        .select('*')
        .order('name', { ascending: true })
      if (error) throw error
      setMentors(data || [])
    } catch (err) {
      console.error('Error loading mentors:', err)
    } finally {
      setLoading(false)
    }
  }

  async function deleteMentor(id) {
    if (!confirm('האם למחוק את המנטור?')) return
    const { error } = await supabase.from('mentors').delete().eq('id', id)
    if (error) {
      alert('שגיאה במחיקה: ' + error.message)
    } else {
      setMentors(mentors.filter(m => m.id !== id))
    }
  }

  const coordinatorOptions = [...new Set(mentors.map(m => m.coordinator).filter(Boolean))]

  const filtered = mentors.filter(m => {
    const q = search.toLowerCase()
    return (
      m.name?.toLowerCase().includes(q) ||
      m.coordinator?.toLowerCase().includes(q) ||
      m.phone?.includes(search) ||
      m.email?.toLowerCase().includes(q)
    )
  })

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">טוען...</div>
  }

  return (
    <div className="space-y-4">
      <datalist id="coordinator-list">
        {coordinatorOptions.map(c => <option key={c} value={c} />)}
      </datalist>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">מנטורים</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
        >
          + הוסף מנטור
        </button>
      </div>

      <input
        type="text"
        placeholder="חפש לפי שם, רכז, טלפון, מייל..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
      />

      <div className="text-sm text-gray-500">
        {filtered.length} מנטורים {search ? '(מסונן)' : ''}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {mentors.length === 0 ? 'אין מנטורים עדיין' : 'לא נמצאו תוצאות'}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">שם</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">רכז</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">טלפון</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600 hidden md:table-cell">מייל</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(mentor => (
                  <tr key={mentor.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800">{mentor.name}</td>
                    <td className="px-4 py-3 text-gray-600">{mentor.coordinator || '-'}</td>
                    <td className="px-4 py-3 text-gray-600" dir="ltr">{mentor.phone}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell" dir="ltr">{mentor.email || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setEditMentor(mentor)}
                        className="text-blue-500 hover:text-blue-700 text-xs ml-2"
                      >
                        ערוך
                      </button>
                      <button
                        onClick={() => deleteMentor(mentor.id)}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >
                        מחק
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAddModal && (
        <MentorModal
          title="הוסף מנטור"
          initial={{ name: '', coordinator: '', phone: '', email: '' }}
          onClose={() => setShowAddModal(false)}
          onSaved={() => { setShowAddModal(false); loadMentors() }}
          onSubmit={form => supabase.from('mentors').insert(form)}
        />
      )}

      {editMentor && (
        <MentorModal
          title="ערוך מנטור"
          initial={{
            name: editMentor.name || '',
            coordinator: editMentor.coordinator || '',
            phone: editMentor.phone || '',
            email: editMentor.email || '',
          }}
          onClose={() => setEditMentor(null)}
          onSaved={() => { setEditMentor(null); loadMentors() }}
          onSubmit={form => supabase.from('mentors').update(form).eq('id', editMentor.id)}
        />
      )}
    </div>
  )
}

function MentorModal({ title, initial, onClose, onSaved, onSubmit }) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name || !form.phone) {
      alert('שם וטלפון הם שדות חובה')
      return
    }
    setSaving(true)
    try {
      const { error } = await onSubmit(form)
      if (error) throw error
      onSaved()
    } catch (err) {
      alert('שגיאה בשמירה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold mb-4">{title}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input placeholder="שם *" required value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <input placeholder="רכז" value={form.coordinator} list="coordinator-list"
            onChange={e => setForm({ ...form, coordinator: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <input placeholder="טלפון *" required value={form.phone} dir="ltr"
            onChange={e => setForm({ ...form, phone: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <input placeholder="מייל" type="email" value={form.email} dir="ltr"
            onChange={e => setForm({ ...form, email: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
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
