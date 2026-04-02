import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

const FIELD_MAP = {
  'שם': 'name',
  'name': 'name',
  'מייל': 'email',
  'email': 'email',
  'טלפון': 'phone',
  'phone': 'phone',
  'בית ספר': 'school',
  'school': 'school',
  'כיתה': 'class_name',
  'class': 'class_name',
  'class_name': 'class_name',
  'מגדר': 'gender',
  'gender': 'gender',
  'מועד אקתון': 'hackathon_date',
  'hackathon_date': 'hackathon_date',
  'יום הולדת': 'birthday',
  'birthday': 'birthday',
  'תפקיד': 'custom_fields.role',
  'עיר': 'custom_fields.city',
  'הערות': 'custom_fields.notes',
}

const GENDER_MAP = {
  'זכר': 'male', 'male': 'male', 'm': 'male', 'M': 'male',
  'נקבה': 'female', 'female': 'female', 'f': 'female', 'F': 'female',
}

export default function ImportCSV() {
  const navigate = useNavigate()
  const [step, setStep] = useState('upload') // upload, preview, importing, done
  const [rows, setRows] = useState([])
  const [headers, setHeaders] = useState([])
  const [mapping, setMapping] = useState({})
  const [errors, setErrors] = useState([])
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: [] })

  function handleFileUpload(e) {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target.result
      const lines = text.split('\n').map(l => l.trim()).filter(l => l)
      if (lines.length < 2) {
        alert('הקובץ ריק או חסר שורות נתונים')
        return
      }

      const headerLine = lines[0]
      const parsedHeaders = parseCSVLine(headerLine)
      setHeaders(parsedHeaders)

      // Auto-map headers
      const autoMapping = {}
      parsedHeaders.forEach((h, i) => {
        const clean = h.trim().toLowerCase()
        for (const [key, val] of Object.entries(FIELD_MAP)) {
          if (key.toLowerCase() === clean) {
            autoMapping[i] = val
            break
          }
        }
      })
      setMapping(autoMapping)

      // Parse data rows
      const dataRows = lines.slice(1).map(line => parseCSVLine(line))
      setRows(dataRows)
      setStep('preview')
    }
    reader.readAsText(file, 'UTF-8')
  }

  function normalizePhone(phone) {
    if (!phone) return null
    let cleaned = phone.replace(/[\s\-\(\)]/g, '')
    if (cleaned.startsWith('+972')) cleaned = '0' + cleaned.slice(4)
    if (cleaned.startsWith('972')) cleaned = '0' + cleaned.slice(3)
    return cleaned
  }

  async function startImport() {
    setStep('importing')
    const importErrors = []
    const total = rows.length

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      try {
        const contact = { custom_fields: {} }

        Object.entries(mapping).forEach(([colIdx, field]) => {
          const value = row[parseInt(colIdx)]?.trim()
          if (!value) return

          if (field.startsWith('custom_fields.')) {
            const key = field.replace('custom_fields.', '')
            contact.custom_fields[key] = value
          } else if (field === 'gender') {
            contact.gender = GENDER_MAP[value] || 'male'
          } else if (field === 'phone') {
            contact.phone = normalizePhone(value)
          } else {
            contact[field] = value
          }
        })

        if (!contact.name || !contact.phone) {
          importErrors.push(`שורה ${i + 2}: חסר שם או טלפון`)
          continue
        }

        if (!contact.gender) contact.gender = 'male'

        const { error } = await supabase.from('contacts').upsert(contact, {
          onConflict: 'phone',
        })
        if (error) throw error
      } catch (err) {
        importErrors.push(`שורה ${i + 2}: ${err.message}`)
      }

      setProgress({ done: i + 1, total, errors: importErrors })
    }

    setErrors(importErrors)
    setStep('done')
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">ייבוא אנשי קשר מ-CSV</h1>

      {step === 'upload' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-5xl mb-4">📁</div>
          <p className="text-gray-600 mb-4">בחר קובץ CSV עם אנשי הקשר שלך</p>
          <p className="text-sm text-gray-400 mb-6">
            הקובץ צריך לכלול שורת כותרות ונתונים מופרדים בפסיקים.
            קידוד UTF-8.
          </p>
          <label className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors">
            בחר קובץ
            <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h2 className="text-lg font-semibold mb-3">מיפוי שדות</h2>
            <p className="text-sm text-gray-500 mb-4">בדוק שכל עמודה ממופה לשדה הנכון</p>
            <div className="grid md:grid-cols-2 gap-3">
              {headers.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm font-medium min-w-24">{h}</span>
                  <span className="text-gray-400">→</span>
                  <select
                    value={mapping[i] || ''}
                    onChange={e => setMapping({ ...mapping, [i]: e.target.value })}
                    className="flex-1 px-2 py-1 border rounded text-sm outline-none"
                  >
                    <option value="">-- דלג --</option>
                    <option value="name">שם</option>
                    <option value="email">מייל</option>
                    <option value="phone">טלפון</option>
                    <option value="school">בית ספר</option>
                    <option value="class_name">כיתה</option>
                    <option value="gender">מגדר</option>
                    <option value="hackathon_date">מועד אקתון</option>
                    <option value="birthday">יום הולדת</option>
                    <option value="custom_fields.role">תפקיד (שדה מותאם)</option>
                    <option value="custom_fields.city">עיר (שדה מותאם)</option>
                    <option value="custom_fields.notes">הערות (שדה מותאם)</option>
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h2 className="text-lg font-semibold mb-3">תצוגה מקדימה ({rows.length} שורות)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {headers.map((h, i) => (
                      <th key={i} className="text-right px-3 py-2 font-medium text-gray-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.slice(0, 5).map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-3 py-2 text-gray-700">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 5 && (
                <p className="text-sm text-gray-400 mt-2 text-center">
                  ...ועוד {rows.length - 5} שורות
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={startImport}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              התחל ייבוא ({rows.length} אנשי קשר)
            </button>
            <button onClick={() => setStep('upload')}
              className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
              בחר קובץ אחר
            </button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-4xl mb-4">⏳</div>
          <p className="text-lg font-medium mb-2">מייבא אנשי קשר...</p>
          <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
            <div
              className="bg-blue-600 h-3 rounded-full transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
          <p className="text-sm text-gray-500">
            {progress.done} / {progress.total}
          </p>
        </div>
      )}

      {step === 'done' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-5xl mb-4">{errors.length === 0 ? '✅' : '⚠️'}</div>
          <p className="text-lg font-medium mb-2">
            הייבוא הסתיים! {progress.total - errors.length} אנשי קשר יובאו בהצלחה.
          </p>
          {errors.length > 0 && (
            <div className="text-right mt-4 p-4 bg-red-50 rounded-lg">
              <p className="font-medium text-red-700 mb-2">{errors.length} שגיאות:</p>
              {errors.map((e, i) => (
                <p key={i} className="text-sm text-red-600">{e}</p>
              ))}
            </div>
          )}
          <div className="flex gap-3 justify-center mt-6">
            <button onClick={() => navigate('/contacts')}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              צפה באנשי קשר
            </button>
            <button onClick={() => { setStep('upload'); setRows([]); setErrors([]) }}
              className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
              ייבא קובץ נוסף
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}
