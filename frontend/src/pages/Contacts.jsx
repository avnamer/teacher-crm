import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

const MENTOR = 'אבנר'

// Show only Avner's teachers: mentor_name must match, and role must be a teacher role.
function isMyTeacher(contact) {
  if (contact.custom_fields?.mentor_name !== MENTOR) return false
  const { role } = contact
  if (!role) return true // mentor set but role not synced yet — include
  return role.includes('מורה')
}

export default function Contacts() {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [genderFilter, setGenderFilter] = useState('all')
  const [showAll, setShowAll] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editContact, setEditContact] = useState(null)

  useEffect(() => {
    loadContacts()
  }, [])

  async function loadContacts() {
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .order('name', { ascending: true })
      if (error) throw error
      setContacts(data || [])
    } catch (err) {
      console.error('Error loading contacts:', err)
    } finally {
      setLoading(false)
    }
  }

  async function deleteContact(id) {
    if (!confirm('האם למחוק את איש הקשר?')) return
    const { error } = await supabase.from('contacts').delete().eq('id', id)
    if (error) {
      alert('שגיאה במחיקה: ' + error.message)
    } else {
      setContacts(contacts.filter(c => c.id !== id))
    }
  }

  const filtered = contacts.filter(c => {
    const matchSearch =
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.school?.toLowerCase().includes(search.toLowerCase()) ||
      c.phone?.includes(search) ||
      c.email?.toLowerCase().includes(search.toLowerCase())
    const matchGender = genderFilter === 'all' || c.gender === genderFilter
    const matchRole = showAll || isMyTeacher(c)
    return matchSearch && matchGender && matchRole
  })

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">טוען...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">אנשי קשר</h1>
        <div className="flex gap-2">
          <Link
            to="/import"
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors"
          >
            📁 ייבוא CSV
          </Link>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
          >
            + הוסף איש קשר
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="חפש לפי שם, בית ספר, טלפון..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
        <select
          value={genderFilter}
          onChange={e => setGenderFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="all">כל המגדרים</option>
          <option value="male">זכר</option>
          <option value="female">נקבה</option>
        </select>
      </div>

      {/* Results count + managers toggle */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {filtered.length} אנשי קשר {(search || genderFilter !== 'all' || !showAll) ? '(מסונן)' : ''}
        </div>
        <button
          onClick={() => setShowAll(!showAll)}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${showAll ? 'bg-gray-100 text-gray-600 border-gray-300' : 'bg-blue-50 text-blue-600 border-blue-200'}`}
        >
          {showAll ? 'הצג מורים בלבד' : 'הצג את כולם'}
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {contacts.length === 0 ? (
            <>
              אין אנשי קשר.{' '}
              <Link to="/import" className="text-blue-600 hover:underline">ייבא קובץ CSV</Link>
            </>
          ) : (
            'לא נמצאו תוצאות'
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">שם</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">טלפון</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600 hidden md:table-cell">בית ספר</th>

                  <th className="text-right px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">מגדר</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">מועד אקתון</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(contact => (
                  <tr key={contact.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/contacts/${contact.id}`} className="text-blue-600 hover:underline font-medium">
                        {contact.name}
                      </Link>
                      {contact.custom_fields?._manual_edit && (
                        <span title="נערך ידנית — מוגן מסנכרון Monday" className="mr-1 text-xs text-gray-400">✏️</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600" dir="ltr">{contact.phone}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{contact.school || '-'}</td>

                    <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                      {contact.gender === 'male' ? 'זכר' : 'נקבה'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                      {contact.hackathon_date
                        ? new Date(contact.hackathon_date).toLocaleDateString('he-IL')
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setEditContact(contact)}
                        className="text-blue-500 hover:text-blue-700 text-xs ml-2"
                      >
                        ערוך
                      </button>
                      <button
                        onClick={() => deleteContact(contact.id)}
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

      {/* Add Contact Modal */}
      {showAddModal && (
        <AddContactModal
          onClose={() => setShowAddModal(false)}
          onSaved={() => { setShowAddModal(false); loadContacts() }}
        />
      )}

      {/* Edit Contact Modal */}
      {editContact && (
        <EditContactModal
          contact={editContact}
          onClose={() => setEditContact(null)}
          onSaved={() => { setEditContact(null); loadContacts() }}
        />
      )}
    </div>
  )
}

function EditContactModal({ contact, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: contact.name || '',
    email: contact.email || '',
    phone: contact.phone || '',
    school: contact.school || '',
    class_name: contact.class_name || '',
    gender: contact.gender || 'male',
    hackathon_date: contact.hackathon_date?.split('T')[0] || '',
    birthday: contact.birthday?.split('T')[0] || '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name || !form.phone) {
      alert('שם וטלפון הם שדות חובה')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase
        .from('contacts')
        .update({
          ...form,
          hackathon_date: form.hackathon_date || null,
          birthday: form.birthday || null,
          custom_fields: { ...(contact.custom_fields || {}), _manual_edit: true },
        })
        .eq('id', contact.id)
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
        <h2 className="text-xl font-bold mb-4">ערוך איש קשר</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input placeholder="שם *" required value={form.name}
            onChange={e => setForm({...form, name: e.target.value})}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <input placeholder="טלפון *" required value={form.phone} dir="ltr"
            onChange={e => setForm({...form, phone: e.target.value})}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <input placeholder="מייל" type="email" value={form.email} dir="ltr"
            onChange={e => setForm({...form, email: e.target.value})}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <input placeholder="בית ספר" value={form.school}
            onChange={e => setForm({...form, school: e.target.value})}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <input placeholder="כיתה" value={form.class_name}
            onChange={e => setForm({...form, class_name: e.target.value})}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <select value={form.gender} onChange={e => setForm({...form, gender: e.target.value})}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
            <option value="male">זכר</option>
            <option value="female">נקבה</option>
          </select>
          <div>
            <label className="text-sm text-gray-500">מועד אקתון</label>
            <input type="date" value={form.hackathon_date}
              onChange={e => setForm({...form, hackathon_date: e.target.value})}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="text-sm text-gray-500">יום הולדת</label>
            <input type="date" value={form.birthday}
              onChange={e => setForm({...form, birthday: e.target.value})}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
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

function AddContactModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', school: '', class_name: '',
    gender: 'male', hackathon_date: '', birthday: '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name || !form.phone) {
      alert('שם וטלפון הם שדות חובה')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('contacts').insert({
        ...form,
        hackathon_date: form.hackathon_date || null,
        birthday: form.birthday || null,
      })
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
        <h2 className="text-xl font-bold mb-4">הוסף איש קשר</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input placeholder="שם *" required value={form.name}
            onChange={e => setForm({...form, name: e.target.value})}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <input placeholder="טלפון *" required value={form.phone} dir="ltr"
            onChange={e => setForm({...form, phone: e.target.value})}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <input placeholder="מייל" type="email" value={form.email} dir="ltr"
            onChange={e => setForm({...form, email: e.target.value})}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <input placeholder="בית ספר" value={form.school}
            onChange={e => setForm({...form, school: e.target.value})}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <input placeholder="כיתה" value={form.class_name}
            onChange={e => setForm({...form, class_name: e.target.value})}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <select value={form.gender} onChange={e => setForm({...form, gender: e.target.value})}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
            <option value="male">זכר</option>
            <option value="female">נקבה</option>
          </select>
          <div>
            <label className="text-sm text-gray-500">מועד אקתון</label>
            <input type="date" value={form.hackathon_date}
              onChange={e => setForm({...form, hackathon_date: e.target.value})}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="text-sm text-gray-500">יום הולדת</label>
            <input type="date" value={form.birthday}
              onChange={e => setForm({...form, birthday: e.target.value})}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
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
