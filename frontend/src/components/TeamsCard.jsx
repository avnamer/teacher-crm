import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { isAdminRow } from '../lib/teachers.js'
import {
  MAX_TEAMS, teamsOf, teachesOtherSchool, teamSchool, formatTeam, gradeOptions, allSchools, sortGrades,
} from '../lib/teams.js'

// The teacher's teams ("נבחרות") on her page — the only place they're edited (see
// lib/teams.js for the stored shape). Has its own edit mode and save, separate from the
// contact-details form, and only ever writes custom_fields.teams / teaches_other_school.

const NEW_OPTION = '__new__'

export default function TeamsCard({ contact, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState([])
  const [otherSchool, setOtherSchool] = useState(false)
  const [grades, setGrades] = useState([])
  const [schools, setSchools] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const teams = teamsOf(contact)
  const multiSchool = teachesOtherSchool(contact)
  const teachesLabel = contact.gender === 'male' ? 'מלמד' : 'מלמדת'

  async function startEdit() {
    setRows(teams.map(t => ({
      grade: t.grade || '',
      students: t.students ?? '',
      school: (multiSchool && t.school) || '', // '' = the primary school
    })))
    setOtherSchool(multiSchool)
    setError('')
    setEditing(true)
    // Picker options come from every teacher, so a grade or school added on one teacher
    // is offered on the next one with the exact same spelling.
    const { data, error: loadErr } = await supabase.from('contacts').select('school, custom_fields')
    if (loadErr) { console.error('Error loading grade/school options:', loadErr); return }
    const others = (data || []).filter(c => !isAdminRow(c))
    setGrades(gradeOptions([...others, contact]))
    setSchools(allSchools([...others, contact]))
  }

  function updateRow(i, patch) {
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  function pickGrade(i, value) {
    if (value !== NEW_OPTION) return updateRow(i, { grade: value })
    const typed = prompt('שם השכבה החדשה (למשל: ו\' או י\'):')?.trim()
    if (!typed) return
    setGrades(prev => (prev.includes(typed) ? prev : sortGrades([...prev, typed])))
    updateRow(i, { grade: typed })
  }

  function pickSchool(i, value) {
    if (value !== NEW_OPTION) return updateRow(i, { school: value })
    const typed = prompt('שם בית הספר החדש (כדאי לבדוק שהוא לא קיים כבר ברשימה בכתיב אחר):')?.trim()
    if (!typed) return
    setSchools(prev => (prev.includes(typed) ? prev : [...prev, typed].sort((a, b) => a.localeCompare(b, 'he'))))
    updateRow(i, { school: typed })
  }

  async function save() {
    if (rows.some(r => !r.grade)) return setError('יש לבחור שכבה לכל נבחרת')
    if (rows.some(r => r.students !== '' && (!Number.isInteger(Number(r.students)) || Number(r.students) < 0))) {
      return setError('מספר תלמידים צריך להיות מספר שלם')
    }
    const nextTeams = rows.map(r => ({
      grade: r.grade,
      students: r.students === '' ? null : Number(r.students),
      // A team in the primary school carries no school of its own — see lib/teams.js.
      ...(otherSchool && r.school && r.school !== contact.school && { school: r.school }),
    }))
    setSaving(true)
    setError('')
    try {
      // Fresh read, then merge only the two keys this card owns — the WhatsApp sync
      // writes its cursors into the same custom_fields (see ContactDetail saveContact).
      const { data: fresh, error: loadErr } = await supabase
        .from('contacts').select('custom_fields').eq('id', contact.id).single()
      if (loadErr) throw loadErr
      const custom_fields = {
        ...(fresh.custom_fields || {}),
        teams: nextTeams,
        teaches_other_school: otherSchool && nextTeams.some(t => t.school),
      }
      const { error: saveErr } = await supabase.from('contacts').update({ custom_fields }).eq('id', contact.id)
      if (saveErr) throw saveErr
      onSaved(custom_fields)
      setEditing(false)
    } catch (err) {
      setError('שגיאה בשמירה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-800">🏆 נבחרות</h2>
        {!editing && (
          <button onClick={startEdit}
            className="px-3 py-1 border rounded-lg text-sm text-gray-700 hover:bg-gray-50">
            ערוך
          </button>
        )}
      </div>

      {!editing ? (
        teams.length === 0 ? (
          <p className="text-sm text-gray-500">לא הוגדרו נבחרות</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {teams.map((team, i) => (
              <li key={i} className="px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-sm text-amber-800">
                {formatTeam(team)}
                {multiSchool && <span className="text-amber-600"> · {teamSchool(contact, team) || 'ללא בית ספר'}</span>}
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={otherSchool} onChange={e => setOtherSchool(e.target.checked)} className="w-4 h-4" />
            {teachesLabel} גם בבית ספר נוסף
          </label>

          {rows.length === 0 && <p className="text-sm text-gray-500">אין נבחרות. אפשר להוסיף עד {MAX_TEAMS}.</p>}

          {rows.map((row, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 p-2 rounded-lg bg-gray-50">
              <div>
                <label className="block text-xs text-gray-500">שכבה</label>
                <select value={row.grade} onChange={e => pickGrade(i, e.target.value)}
                  className="px-2 py-1.5 border rounded-lg text-sm bg-white">
                  <option value="">בחר…</option>
                  {[...new Set([...grades, ...(row.grade ? [row.grade] : [])])].map(g => <option key={g} value={g}>{g}</option>)}
                  <option value={NEW_OPTION}>+ שכבה אחרת</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500">מספר תלמידים</label>
                <input type="number" min="0" inputMode="numeric" value={row.students}
                  onChange={e => updateRow(i, { students: e.target.value })}
                  className="w-24 px-2 py-1.5 border rounded-lg text-sm" />
              </div>
              {otherSchool && (
                <div className="flex-1 min-w-[10rem]">
                  <label className="block text-xs text-gray-500">בית ספר</label>
                  <select value={row.school} onChange={e => pickSchool(i, e.target.value)}
                    className="w-full px-2 py-1.5 border rounded-lg text-sm bg-white">
                    <option value="">{contact.school ? `${contact.school} (ראשי)` : 'בחר…'}</option>
                    {[...new Set([...schools, ...(row.school ? [row.school] : [])])]
                      .filter(s => s !== contact.school)
                      .map(s => <option key={s} value={s}>{s}</option>)}
                    <option value={NEW_OPTION}>+ בית ספר חדש</option>
                  </select>
                </div>
              )}
              <button onClick={() => setRows(prev => prev.filter((_, idx) => idx !== i))}
                className="px-2 py-1.5 text-sm text-gray-400 hover:text-red-600" title="מחק נבחרת">
                🗑️
              </button>
            </div>
          ))}

          {rows.length < MAX_TEAMS && (
            <button onClick={() => setRows(prev => [...prev, { grade: '', students: '', school: '' }])}
              className="text-sm text-blue-600 hover:underline">
              + הוסף נבחרת
            </button>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'שומר…' : 'שמור'}
            </button>
            <button onClick={() => setEditing(false)} disabled={saving}
              className="px-3 py-1 border rounded-lg text-sm hover:bg-gray-50">
              ביטול
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
