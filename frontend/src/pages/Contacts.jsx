import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

const MENTOR = 'אבנר'

const DEFAULT_WIDTH = 150
const MIN_WIDTH = 60

const DEFAULT_COLUMNS = [
  { key: 'name', label: 'שם', source: 'core', visible: true, locked: true, width: 180 },
  { key: 'phone', label: 'טלפון', source: 'core', visible: true, locked: false, width: 140 },
  { key: 'school', label: 'בית ספר', source: 'core', visible: true, locked: false, width: 240 },
  { key: 'gender', label: 'מגדר', source: 'core', visible: true, locked: false, width: 90 },
  { key: 'hackathon_date', label: 'מועד אקתון', source: 'core', visible: true, locked: false, width: 130 },
  { key: 'email', label: 'מייל', source: 'core', visible: false, locked: false, width: 200 },
  { key: 'class_name', label: 'כיתה', source: 'core', visible: false, locked: false, width: 90 },
  { key: 'birthday', label: 'יום הולדת', source: 'core', visible: false, locked: false, width: 130 },
  { key: 'last_contact_journal', label: 'יומן קשר אחרון', source: 'journal', visible: true, locked: false, width: 220 },
  // keys intentionally match the pre-existing custom_fields.challenge1/2/3 (from the old
  // standalone Monday page) so existing data renders immediately with no migration.
  { key: 'challenge1', label: 'אתגר 1', source: 'task', taskSource: 'monday', visible: true, locked: false, width: 90 },
  { key: 'challenge2', label: 'אתגר 2', source: 'task', taskSource: 'monday', visible: true, locked: false, width: 90 },
  { key: 'challenge3', label: 'אתגר 3', source: 'task', taskSource: 'monday', visible: true, locked: false, width: 90 },
]

// The pseudo-contact row representing "מנהל המערכת" (created by the voice-log
// admin_task route) — pinned to the top of the table and excluded from teacher stats.
function isAdminRow(contact) {
  return contact.custom_fields?.is_admin_row === true
}

// Show only Avner's teachers: mentor_name must match, and role must be a teacher role.
function isMyTeacher(contact) {
  if (contact.custom_fields?.mentor_name !== MENTOR) return false
  const { role } = contact
  if (!role) return true // mentor set but role not synced yet — include
  return role.includes('מורה')
}

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

// Bucket a teacher by days since their last logged contact (any interaction type).
function contactBucket(contact, lastContactMap) {
  const lastAt = lastContactMap[contact.id]
  if (!lastAt) return 'red'
  const days = daysSince(lastAt)
  if (days <= 7) return 'green'
  if (days <= 14) return 'orange'
  return 'red'
}

function getCellValue(contact, col) {
  if (col.source === 'custom' || col.source === 'task') return contact.custom_fields?.[col.key] ?? ''
  return contact[col.key] ?? ''
}

function getEditType(col) {
  if (col.source === 'task') return 'task'
  if (col.source === 'journal') return 'journal'
  if (col.source === 'custom') return 'text'
  if (col.key === 'gender') return 'gender'
  if (col.key === 'hackathon_date' || col.key === 'birthday') return 'date'
  if (col.key === 'email') return 'email'
  return 'text'
}

// A task cell counts as "done" for any truthy, non-"לא הוגש" value — this keeps Monday's
// existing 'הוגש' / 'לא הוגש' strings working as the done/not-done signal for Monday task
// columns, while general task columns just store boolean true/false.
function isTaskDone(contact, col) {
  const value = contact.custom_fields?.[col.key]
  return Boolean(value) && value !== 'לא הוגש'
}

function formatDisplay(contact, col, journalMap) {
  if (col.source === 'task') return isTaskDone(contact, col) ? '✓' : ''
  if (col.source === 'journal') {
    const entry = journalMap?.[contact.id]?.[col.key]
    if (!entry) return '-'
    const days = daysSince(entry.created_at)
    const dateStr = new Date(entry.created_at).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })
    const daysStr = days === 0 ? 'היום' : days === 1 ? 'לפני יום' : `לפני ${days} ימים`
    return `${dateStr} (${daysStr})`
  }
  const value = getCellValue(contact, col)
  if (col.source === 'core' && col.key === 'gender') {
    return value === 'male' ? 'זכר' : value === 'female' ? 'נקבה' : '-'
  }
  if (col.source === 'core' && (col.key === 'hackathon_date' || col.key === 'birthday')) {
    return value ? new Date(value).toLocaleDateString('he-IL') : '-'
  }
  return value || '-'
}

export default function Contacts() {
  const [contacts, setContacts] = useState([])
  const [columns, setColumns] = useState(DEFAULT_COLUMNS)
  const [columnsLoaded, setColumnsLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [genderFilter, setGenderFilter] = useState('all')
  const [showAll, setShowAll] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showAddMeetingModal, setShowAddMeetingModal] = useState(false)
  const [editContact, setEditContact] = useState(null)
  const [showColumnManager, setShowColumnManager] = useState(false)
  const [showMondayColumns, setShowMondayColumns] = useState(false)
  const [editingCell, setEditingCell] = useState(null) // { contactId, colKey } | null
  const [resizing, setResizing] = useState(null) // { key, startX, startWidth } | null
  const [journalMap, setJournalMap] = useState({}) // { [contactId]: { [colKey]: {content, created_at} } }
  const [lastContactMap, setLastContactMap] = useState({}) // { [contactId]: latest created_at across all interactions }
  const [statsExpanded, setStatsExpanded] = useState(false)
  const [pendingTasksMap, setPendingTasksMap] = useState({}) // { [contactId]: [{text, due_date}, ...] } — unresolved action items from phone-call logs
  const [pendingTasksExpanded, setPendingTasksExpanded] = useState(false)

  useEffect(() => {
    loadContacts()
    loadColumns()
  }, [])

  useEffect(() => {
    if (!resizing) return

    function onMove(e) {
      const delta = e.clientX - resizing.startX
      // RTL layout: the handle sits on the column's left border, so dragging
      // left (negative delta) should widen the column, and right should shrink it.
      const newWidth = Math.max(MIN_WIDTH, Math.round(resizing.startWidth - delta))
      setColumns(cols => cols.map(c => (c.key === resizing.key ? { ...c, width: newWidth } : c)))
    }

    function onUp() {
      setResizing(null)
      setColumns(cols => {
        saveColumnsSilently(cols)
        return cols
      })
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [resizing])

  async function saveColumnsSilently(next) {
    const { error } = await supabase
      .from('settings')
      .update({ contacts_columns: next })
      .eq('id', 'global')
    if (error) console.error('Error saving column widths:', error)
  }

  function startResize(key, e) {
    e.preventDefault()
    const col = columns.find(c => c.key === key)
    setResizing({ key, startX: e.clientX, startWidth: col?.width || DEFAULT_WIDTH })
  }

  async function loadContacts() {
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .order('name', { ascending: true })
      if (error) throw error
      setContacts(data || [])
      const ids = (data || []).map(c => c.id)
      await Promise.all([loadJournalEntries(ids), loadLastContactDates(ids), loadPendingTasks(ids)])
    } catch (err) {
      console.error('Error loading contacts:', err)
    } finally {
      setLoading(false)
    }
  }

  // Latest interaction of ANY type per contact — used for the "days since last contact" stats.
  async function loadLastContactDates(contactIds) {
    if (contactIds.length === 0) return
    try {
      const { data, error } = await supabase
        .from('interactions')
        .select('contact_id, created_at')
        .in('contact_id', contactIds)
        .order('created_at', { ascending: false })
      if (error) throw error
      const map = {}
      for (const row of data || []) {
        if (!map[row.contact_id]) map[row.contact_id] = row.created_at
      }
      setLastContactMap(map)
    } catch (err) {
      console.error('Error loading last-contact dates:', err)
    }
  }

  // Unresolved action items extracted from phone-call voice logs — surfaced as a follow-up indicator.
  async function loadPendingTasks(contactIds) {
    if (contactIds.length === 0) return
    try {
      const { data, error } = await supabase
        .from('interactions')
        .select('contact_id, metadata')
        .eq('type', 'phone_call')
        .in('contact_id', contactIds)
      if (error) throw error
      const map = {}
      for (const row of data || []) {
        const items = (row.metadata?.action_items || []).filter(item => !item.done)
        if (items.length === 0) continue
        map[row.contact_id] = [...(map[row.contact_id] || []), ...items]
      }
      setPendingTasksMap(map)
    } catch (err) {
      console.error('Error loading pending tasks:', err)
    }
  }

  async function loadJournalEntries(contactIds) {
    if (contactIds.length === 0) return
    try {
      const { data, error } = await supabase
        .from('interactions')
        .select('contact_id, content, metadata, created_at')
        .eq('type', 'journal')
        .in('contact_id', contactIds)
        .order('created_at', { ascending: false })
      if (error) throw error
      const map = {}
      for (const row of data || []) {
        const colKey = row.metadata?.column_key
        if (!colKey) continue
        map[row.contact_id] ??= {}
        // Rows arrive newest-first, so the first one seen per (contact, column) is the latest.
        if (!map[row.contact_id][colKey]) {
          map[row.contact_id][colKey] = { content: row.content, created_at: row.created_at }
        }
      }
      setJournalMap(map)
    } catch (err) {
      console.error('Error loading journal entries:', err)
    }
  }

  async function addJournalEntry(contact, col, text) {
    if (!text || !text.trim()) return
    const { data, error } = await supabase
      .from('interactions')
      .insert({
        contact_id: contact.id,
        type: 'journal',
        content: text.trim(),
        metadata: { column_key: col.key, column_label: col.label },
      })
      .select()
      .single()
    if (error) {
      alert('שגיאה בשמירת רשומת יומן: ' + error.message)
      return
    }
    setJournalMap(prev => ({
      ...prev,
      [contact.id]: { ...(prev[contact.id] || {}), [col.key]: { content: data.content, created_at: data.created_at } },
    }))
    setLastContactMap(prev => (
      !prev[contact.id] || new Date(data.created_at) > new Date(prev[contact.id])
        ? { ...prev, [contact.id]: data.created_at }
        : prev
    ))
  }

  async function loadColumns() {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('contacts_columns')
        .eq('id', 'global')
        .single()
      if (error) throw error
      if (data?.contacts_columns && data.contacts_columns.length > 0) {
        const saved = data.contacts_columns
        // Merge in any new built-in columns (e.g. added in a later version) that aren't in a saved config yet.
        const missing = DEFAULT_COLUMNS.filter(dc => !saved.some(sc => sc.key === dc.key))
        setColumns(missing.length > 0 ? [...saved, ...missing] : saved)
      }
    } catch (err) {
      console.error('Error loading column settings:', err)
    } finally {
      setColumnsLoaded(true)
    }
  }

  async function saveColumns(next) {
    setColumns(next)
    const { error } = await supabase
      .from('settings')
      .update({ contacts_columns: next })
      .eq('id', 'global')
    if (error) {
      alert('שגיאה בשמירת הגדרות העמודות: ' + error.message + '\n\nיתכן שצריך להריץ מיגרציה ב-Supabase (ראה supabase-setup.sql).')
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

  async function saveCell(contact, col, rawValue) {
    const payload = { custom_fields: { ...(contact.custom_fields || {}), _manual_edit: true } }
    if (col.source === 'custom' || col.source === 'task') {
      // For a Monday task column this replaces the legacy 'הוגש'/'לא הוגש' string with a plain
      // boolean — safe because _manual_edit above already opts this contact out of future
      // Monday syncs, and isTaskDone() treats both encodings as equivalent for display.
      payload.custom_fields[col.key] = rawValue
    } else {
      payload[col.key] = rawValue || null
    }
    const { data, error } = await supabase
      .from('contacts')
      .update(payload)
      .eq('id', contact.id)
      .select()
      .single()
    if (error) {
      alert('שגיאה בשמירה: ' + error.message)
      return
    }
    setContacts(contacts.map(c => (c.id === contact.id ? data : c)))
  }

  const visibleColumns = columns.filter(c => c.visible)

  const filtered = contacts.filter(c => {
    const matchSearch =
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.school?.toLowerCase().includes(search.toLowerCase()) ||
      c.phone?.includes(search) ||
      c.email?.toLowerCase().includes(search.toLowerCase())
    const matchGender = genderFilter === 'all' || c.gender === genderFilter
    const matchRole = showAll || isMyTeacher(c)
    return matchSearch && matchGender && matchRole
  }).sort((a, b) => (isAdminRow(b) ? 1 : 0) - (isAdminRow(a) ? 1 : 0)) // pin admin row to the top

  // Contact-recency stats — always over "my teachers", regardless of the search/gender/showAll filters above.
  const myTeachers = contacts.filter(isMyTeacher)
  const buckets = { green: [], orange: [], red: [] }
  for (const t of myTeachers) buckets[contactBucket(t, lastContactMap)].push(t)

  if (loading || !columnsLoaded) {
    return <div className="flex items-center justify-center h-64 text-gray-500">טוען...</div>
  }

  return (
    <div className="space-y-4">
      <ContactStats buckets={buckets} expanded={statsExpanded} onToggle={() => setStatsExpanded(!statsExpanded)} />

      <PendingTasksBanner
        pendingTasksMap={pendingTasksMap}
        contacts={contacts}
        expanded={pendingTasksExpanded}
        onToggle={() => setPendingTasksExpanded(!pendingTasksExpanded)}
      />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">אנשי קשר</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowColumnManager(true)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors border border-gray-300"
          >
            ⚙️ עמודות
          </button>
          <button
            onClick={() => setShowMondayColumns(true)}
            className="px-4 py-2 bg-orange-50 text-orange-700 rounded-lg text-sm hover:bg-orange-100 transition-colors border border-orange-200"
          >
            🔄 עמודות Monday
          </button>
          <Link
            to="/import"
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors"
          >
            📁 ייבוא CSV
          </Link>
          <button
            onClick={() => setShowAddMeetingModal(true)}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 transition-colors"
          >
            🤝 הוסף פגישה
          </button>
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
            <table className="text-sm" style={{ tableLayout: 'fixed', width: visibleColumns.reduce((sum, c) => sum + (c.width || DEFAULT_WIDTH), 0) + 120 }}>
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {visibleColumns.map(col => (
                    <th
                      key={col.key}
                      className="relative text-right px-4 py-3 font-medium text-gray-600 whitespace-nowrap overflow-hidden text-ellipsis"
                      style={{ width: col.width || DEFAULT_WIDTH }}
                    >
                      {col.label}
                      <span
                        onMouseDown={e => startResize(col.key, e)}
                        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400 active:bg-blue-500"
                        title="גרור לשינוי רוחב"
                      />
                    </th>
                  ))}
                  <th className="text-center px-4 py-3 font-medium text-gray-600" style={{ width: 120 }}>פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(contact => (
                  <tr key={contact.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map(col => (
                      <td key={col.key} className="px-4 py-3 text-gray-600 overflow-hidden text-ellipsis" style={{ width: col.width || DEFAULT_WIDTH }}>
                        {col.key === 'name' ? (
                          <>
                            <Link to={`/contacts/${contact.id}`} className="text-blue-600 hover:underline font-medium">
                              {contact.name}
                            </Link>
                            {pendingTasksMap[contact.id]?.length > 0 && (
                              <span
                                title={`${pendingTasksMap[contact.id].length} משימות פתוחות מתיעוד שיחה`}
                                className="mr-1 text-amber-500"
                              >
                                ❗
                              </span>
                            )}
                            {contact.custom_fields?._manual_edit && (
                              <span title="נערך ידנית — מוגן מסנכרון Monday" className="mr-1 text-xs text-gray-400">✏️</span>
                            )}
                          </>
                        ) : (
                          <EditableCell
                            contact={contact}
                            col={col}
                            journalMap={journalMap}
                            isEditing={editingCell?.contactId === contact.id && editingCell?.colKey === col.key}
                            onStartEdit={() => setEditingCell({ contactId: contact.id, colKey: col.key })}
                            onCancel={() => setEditingCell(null)}
                            onSave={async (val) => {
                              if (col.source === 'journal') await addJournalEntry(contact, col, val)
                              else await saveCell(contact, col, val)
                              setEditingCell(null)
                            }}
                          />
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center whitespace-nowrap">
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

      {/* Column Manager Modal */}
      {showColumnManager && (
        <ColumnManagerModal
          columns={columns}
          onClose={() => setShowColumnManager(false)}
          onSave={saveColumns}
        />
      )}

      {showMondayColumns && (
        <MondayColumnsModal
          columns={columns}
          onClose={() => setShowMondayColumns(false)}
          onSave={saveColumns}
        />
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

      {/* Add Meeting Modal */}
      {showAddMeetingModal && (
        <AddMeetingModal
          teachers={myTeachers}
          onClose={() => setShowAddMeetingModal(false)}
          onSaved={() => { setShowAddMeetingModal(false); loadContacts() }}
        />
      )}
    </div>
  )
}

// ─── Contact-recency stats ─────────────────────────────────────────
const STAT_TILES = [
  { key: 'green', label: 'יצרתי קשר ב-7 הימים האחרונים', bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', dot: 'bg-green-500' },
  { key: 'orange', label: 'לא דיברתי 8–14 ימים', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', dot: 'bg-orange-400' },
  { key: 'red', label: 'לא דיברתי מעל שבועיים / אין קשר מתועד', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', dot: 'bg-red-500' },
]

function ContactStats({ buckets, expanded, onToggle }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {STAT_TILES.map(tile => (
          <div key={tile.key} className={`rounded-xl border p-4 ${tile.bg} ${tile.border}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2.5 h-2.5 rounded-full ${tile.dot}`} />
              <span className={`text-sm font-medium ${tile.text}`}>{tile.label}</span>
            </div>
            <div className={`text-3xl font-black ${tile.text}`}>{buckets[tile.key].length}</div>
          </div>
        ))}
      </div>

      <button
        onClick={onToggle}
        className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
      >
        {expanded ? '▲ הסתר שמות' : '▼ הצג שמות מורים לפי קטגוריה'}
      </button>

      {expanded && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {STAT_TILES.map(tile => (
            <div key={tile.key} className={`rounded-xl border p-3 ${tile.bg} ${tile.border}`}>
              {buckets[tile.key].length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-2">—</p>
              ) : (
                <ul className="space-y-1">
                  {buckets[tile.key].map(c => (
                    <li key={c.id}>
                      <Link to={`/contacts/${c.id}`} className={`text-sm hover:underline ${tile.text}`}>
                        {c.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Pending follow-up tasks banner (from voice-logged phone calls) ──
function PendingTasksBanner({ pendingTasksMap, contacts, expanded, onToggle }) {
  const entries = Object.entries(pendingTasksMap).filter(([, items]) => items.length > 0)
  if (entries.length === 0) return null

  return (
    <div className="rounded-xl border p-4 bg-amber-50 border-amber-200">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">❗</span>
          <span className="text-sm font-medium text-amber-800">
            {entries.length} מורים עם משימות פתוחות מתיעוד שיחות טלפון
          </span>
        </div>
        <button
          onClick={onToggle}
          className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors"
        >
          {expanded ? '▲ הסתר פירוט' : '▼ הצג פירוט'}
        </button>
      </div>

      {expanded && (
        <ul className="mt-3 space-y-2">
          {entries.map(([contactId, items]) => {
            const contact = contacts.find(c => c.id === contactId)
            if (!contact) return null
            return (
              <li key={contactId} className="text-sm">
                <Link to={`/contacts/${contactId}`} className="font-medium text-amber-800 hover:underline">
                  {contact.name}
                </Link>
                <ul className="mr-4 list-disc text-amber-700">
                  {items.map((item, i) => (
                    <li key={i}>
                      {item.text}
                      {item.due_date && ` (עד ${new Date(item.due_date).toLocaleDateString('he-IL')})`}
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ─── Editable table cell ──────────────────────────────────────────
function EditableCell({ contact, col, journalMap, isEditing, onStartEdit, onCancel, onSave }) {
  const editType = getEditType(col)
  const [savingTask, setSavingTask] = useState(false)

  if (editType === 'task') {
    const done = isTaskDone(contact, col)
    async function handleTaskClick() {
      if (savingTask) return
      setSavingTask(true)
      try {
        await onSave(!done)
      } finally {
        setSavingTask(false)
      }
    }
    return (
      <button
        onClick={handleTaskClick}
        disabled={savingTask}
        className="w-full flex items-center justify-center py-0.5 disabled:opacity-50"
        title={done ? 'לחץ לביטול סימון' : 'לחץ לסימון כבוצע'}
      >
        <span
          className={`w-5 h-5 rounded border flex items-center justify-center text-xs ${
            done ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 text-transparent'
          }`}
        >
          ✓
        </span>
      </button>
    )
  }

  // Journal cells always start blank — writing in them adds a new dated entry, it never edits the last one.
  const rawValue = editType === 'journal' ? '' : getCellValue(contact, col)
  const [value, setValue] = useState(rawValue)

  useEffect(() => { setValue(rawValue) }, [isEditing])

  if (!isEditing) {
    const display = formatDisplay(contact, col, journalMap)
    return (
      <button
        onClick={onStartEdit}
        className="w-full text-right hover:bg-blue-50 rounded px-1 py-0.5 -mx-1 transition-colors truncate block"
        title={editType === 'journal' ? (journalMap?.[contact.id]?.[col.key]?.content || 'לחץ להוספת רשומה חדשה') : 'לחץ לעריכה'}
      >
        {display}
      </button>
    )
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !(editType === 'journal' && e.shiftKey)) {
      e.preventDefault()
      onSave(value)
    }
    if (e.key === 'Escape') onCancel()
  }

  if (editType === 'journal') {
    return (
      <textarea
        autoFocus
        rows={2}
        value={value}
        placeholder="מה היה? (Enter לשמירה, Shift+Enter לשורה חדשה)"
        onChange={e => setValue(e.target.value)}
        onBlur={() => onSave(value)}
        onKeyDown={handleKeyDown}
        className="w-full px-2 py-1 border border-blue-400 rounded outline-none text-sm resize-none"
      />
    )
  }

  if (editType === 'gender') {
    return (
      <select
        autoFocus
        value={value || 'male'}
        onChange={e => setValue(e.target.value)}
        onBlur={() => onSave(value)}
        onKeyDown={handleKeyDown}
        className="w-full px-2 py-1 border border-blue-400 rounded outline-none text-sm"
      >
        <option value="male">זכר</option>
        <option value="female">נקבה</option>
      </select>
    )
  }

  if (editType === 'date') {
    return (
      <input
        autoFocus
        type="date"
        value={value ? value.split('T')[0] : ''}
        onChange={e => setValue(e.target.value)}
        onBlur={() => onSave(value)}
        onKeyDown={handleKeyDown}
        className="w-full px-2 py-1 border border-blue-400 rounded outline-none text-sm"
      />
    )
  }

  return (
    <input
      autoFocus
      type={editType === 'email' ? 'email' : 'text'}
      value={value || ''}
      dir={editType === 'email' ? 'ltr' : 'auto'}
      onChange={e => setValue(e.target.value)}
      onBlur={() => onSave(value)}
      onKeyDown={handleKeyDown}
      className="w-full px-2 py-1 border border-blue-400 rounded outline-none text-sm"
    />
  )
}

// ─── Column Manager ───────────────────────────────────────────────
function ColumnManagerModal({ columns, onClose, onSave }) {
  const [local, setLocal] = useState(columns)
  const [newLabel, setNewLabel] = useState('')
  const [newColType, setNewColType] = useState('custom') // 'custom' | 'journal' | 'task'
  const [saving, setSaving] = useState(false)

  function toggleVisible(key) {
    setLocal(local.map(c => (c.key === key ? { ...c, visible: !c.visible } : c)))
  }

  function moveColumn(index, direction) {
    const target = index + direction
    if (target < 0 || target >= local.length) return
    const next = [...local]
    ;[next[index], next[target]] = [next[target], next[index]]
    setLocal(next)
  }

  function removeColumn(key) {
    if (!confirm('להסיר את העמודה? הנתונים הקיימים בעמודה לא יימחקו, רק יוסתרו.')) return
    setLocal(local.filter(c => c.key !== key))
  }

  function addColumn() {
    const label = newLabel.trim()
    if (!label) return
    // Check both label and key: this column's key equals its label, but a Monday column
    // (created via the separate Monday-columns panel) gets a slugified key that could
    // coincidentally match a label typed here — guard against silently sharing storage.
    if (local.some(c => c.label === label || c.key === label)) {
      alert('כבר קיימת עמודה בשם הזה')
      return
    }
    const base = { key: label, label, visible: true, locked: false }
    const col = newColType === 'task'
      ? { ...base, source: 'task', taskSource: 'general' }
      : { ...base, source: newColType }
    setLocal([...local, col])
    setNewLabel('')
    setNewColType('custom')
  }

  async function handleSave() {
    setSaving(true)
    await onSave(local)
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">ניהול עמודות</h2>

        <p className="text-xs text-gray-400 mb-2">השתמש בחצים כדי לשנות את סדר העמודות בטבלה</p>
        <div className="space-y-1 mb-6">
          {local.map((col, i) => (
            <div key={col.key} className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-100">
              <div className="flex flex-col -my-1">
                <button
                  onClick={() => moveColumn(i, -1)}
                  disabled={i === 0}
                  className="text-gray-400 hover:text-gray-700 disabled:opacity-20 disabled:hover:text-gray-400 leading-none text-xs px-1"
                  title="הזז למעלה"
                >
                  ▲
                </button>
                <button
                  onClick={() => moveColumn(i, 1)}
                  disabled={i === local.length - 1}
                  className="text-gray-400 hover:text-gray-700 disabled:opacity-20 disabled:hover:text-gray-400 leading-none text-xs px-1"
                  title="הזז למטה"
                >
                  ▼
                </button>
              </div>
              <label className="flex items-center gap-2 flex-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={col.visible}
                  disabled={col.locked}
                  onChange={() => toggleVisible(col.key)}
                  className="w-4 h-4"
                />
                <span className={col.locked ? 'text-gray-400' : ''}>{col.label}</span>
                {col.source === 'custom' && (
                  <span className="text-xs text-gray-400">(מותאם אישית)</span>
                )}
                {col.source === 'journal' && (
                  <span className="text-xs text-blue-400">(יומן/אירועים)</span>
                )}
                {col.source === 'task' && col.taskSource === 'general' && (
                  <span className="text-xs text-purple-400">(משימה)</span>
                )}
                {col.source === 'task' && col.taskSource === 'monday' && (
                  <span className="text-xs text-orange-400">(משימת Monday)</span>
                )}
              </label>
              {(col.source === 'custom' || col.source === 'journal' || col.source === 'task') && (
                <button
                  onClick={() => removeColumn(col.key)}
                  className="text-red-400 hover:text-red-600 text-xs"
                >
                  הסר
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="mb-6 space-y-2">
          <div className="flex gap-2">
            <input
              placeholder="שם עמודה חדשה"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addColumn()}
              className="flex-1 px-3 py-2 border rounded-lg outline-none text-sm"
            />
            <button
              onClick={addColumn}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
            >
              + הוסף
            </button>
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input type="radio" name="newColType" checked={newColType === 'custom'}
                onChange={() => setNewColType('custom')} className="w-3.5 h-3.5" />
              טקסט רגיל
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
              <input type="radio" name="newColType" checked={newColType === 'journal'}
                onChange={() => setNewColType('journal')} className="w-3.5 h-3.5" />
              עמודת יומן / אירועים — כל כתיבה נשמרת כרשומה חדשה עם תאריך ושעה, במקום להחליף את הקודמת
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
              <input type="radio" name="newColType" checked={newColType === 'task'}
                onChange={() => setNewColType('task')} className="w-3.5 h-3.5" />
              עמודת משימה — תיבת סימון (✓) לכל מורה
            </label>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'שומר...' : 'שמור'}
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
            ביטול
          </button>
        </div>
      </div>
    </div>
  )
}

function MondayColumnsModal({ columns, onClose, onSave }) {
  const [local, setLocal] = useState(columns)
  const [newLabel, setNewLabel] = useState('')
  const [saving, setSaving] = useState(false)

  const mondayCols = local.filter(c => c.source === 'task' && c.taskSource === 'monday')

  function slugify(label) {
    return label.trim().toLowerCase().replace(/\s+/g, '_')
  }

  function addColumn() {
    const label = newLabel.trim()
    if (!label) return
    const key = slugify(label)
    if (local.some(c => c.key === key)) {
      alert('כבר קיימת עמודה עם המזהה הזה (ייתכן שזו עמודה כללית עם שם דומה)')
      return
    }
    setLocal([...local, { key, label, source: 'task', taskSource: 'monday', visible: true, locked: false }])
    setNewLabel('')
  }

  function renameColumn(key, label) {
    setLocal(local.map(c => (c.key === key ? { ...c, label } : c)))
  }

  function removeColumn(key) {
    if (!confirm('להסיר את עמודת ה-Monday? הנתונים הקיימים לא יימחקו, רק יוסתרו.')) return
    setLocal(local.filter(c => c.key !== key))
  }

  async function handleSave() {
    setSaving(true)
    await onSave(local)
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-2">עמודות Monday</h2>
        <p className="text-xs text-gray-500 mb-4">
          אין חיבור חי ל-API של Monday (אין הרשאת ניהול לבורד). כאן אפשר לנהל אילו עמודות Monday
          קיימות ומוצגות בטבלה. העדכון בפועל של הנתונים נעשה כשמבקשים מקלוד קוד להריץ סנכרון
          (סקיל monday-integration) — הוא כותב ישירות לתוך Supabase לפי המפתחות (keys) שמוגדרים
          כאן.
        </p>

        <div className="space-y-1 mb-6">
          {mondayCols.length === 0 && (
            <p className="text-xs text-gray-400 py-2">אין עמודות Monday מוגדרות</p>
          )}
          {mondayCols.map(col => (
            <div key={col.key} className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-100">
              <input
                value={col.label}
                onChange={e => renameColumn(col.key, e.target.value)}
                className="flex-1 px-2 py-1 border rounded text-sm outline-none"
              />
              <code className="text-xs text-gray-400" dir="ltr">{col.key}</code>
              <button onClick={() => removeColumn(col.key)} className="text-red-400 hover:text-red-600 text-xs">
                הסר
              </button>
            </div>
          ))}
        </div>

        <div className="mb-6 flex gap-2">
          <input
            placeholder="שם עמודת Monday חדשה"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addColumn()}
            className="flex-1 px-3 py-2 border rounded-lg outline-none text-sm"
          />
          <button onClick={addColumn} className="px-3 py-2 bg-orange-600 text-white rounded-lg text-sm hover:bg-orange-700">
            + הוסף
          </button>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'שומר...' : 'שמור'}
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
            ביטול
          </button>
        </div>
      </div>
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

function AddMeetingModal({ teachers, onClose, onSaved }) {
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
