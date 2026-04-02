import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { BulkSendModal } from './WhatsApp.jsx'

const MENTOR = 'אבנר'

const CHALLENGES = [
  { key: 'challenge1', label: 'אתגר 1', icon: '1️⃣' },
  { key: 'challenge2', label: 'אתגר 2', icon: '2️⃣' },
  { key: 'challenge3', label: 'אתגר 3', icon: '3️⃣' },
]

export default function MondayTasks() {
  const [teachers, setTeachers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeChallenge, setActiveChallenge] = useState(null) // { key, label } | null
  const [bulkSend, setBulkSend] = useState(null) // { contactIds, label } | null
  const [templates, setTemplates] = useState([])
  const [templatesLoading, setTemplatesLoading] = useState(true)

  useEffect(() => { loadData() }, [])
  useEffect(() => {
    supabase.from('message_templates').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { setTemplates(data || []); setTemplatesLoading(false) })
  }, [])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('contacts')
        .select('id, name, phone, school, gender, custom_fields')
        .eq('role', 'מורה מוביל/ה')
        .order('name')
      if (err) throw err

      // Filter to Avner's teachers client-side (JSONB filter)
      const mine = (data || []).filter(c => c.custom_fields?.mentor_name === MENTOR)
      setTeachers(mine)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function openWhatsApp(contactIds, label) {
    if (contactIds.length === 0) { alert('אין מורים לשלוח'); return }
    setBulkSend({ contactIds, label })
  }

  // --- stats per challenge ---
  const stats = CHALLENGES.map(ch => {
    const submitted = teachers.filter(t => t.custom_fields?.[ch.key] === 'הוגש')
    const notSubmitted = teachers.filter(t => t.custom_fields?.[ch.key] === 'לא הוגש')
    const unknown = teachers.filter(t => !t.custom_fields?.[ch.key] || (t.custom_fields[ch.key] !== 'הוגש' && t.custom_fields[ch.key] !== 'לא הוגש'))
    return {
      ...ch,
      submitted,
      notSubmitted,
      unknown,
      total: teachers.length,
      pct: teachers.length > 0 ? Math.round(submitted.length / teachers.length * 100) : 0,
    }
  })

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">טוען...</div>
  )

  if (error) return (
    <div className="text-center py-16 space-y-3">
      <p className="text-2xl">⚠️</p>
      <p className="text-gray-700 text-sm">{error}</p>
      <button onClick={loadData} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">נסה שוב</button>
    </div>
  )

  return (
    <div className="space-y-6" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">דאשבורד אתגרים</h1>
          <p className="text-sm text-gray-500 mt-0.5">מנטור: {MENTOR} · {teachers.length} מורים</p>
        </div>
        <button onClick={loadData} className="text-sm px-3 py-1.5 border rounded-lg hover:bg-gray-50 text-gray-600">
          🔄 רענן
        </button>
      </div>

      {/* Challenge tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map(s => (
          <ChallengeTile
            key={s.key}
            stat={s}
            isActive={activeChallenge?.key === s.key}
            onOpen={() => setActiveChallenge(activeChallenge?.key === s.key ? null : s)}
            onWhatsApp={openWhatsApp}
            templatesReady={!templatesLoading}
          />
        ))}
      </div>

      {/* Teacher list for selected challenge */}
      {activeChallenge && (() => {
        const s = stats.find(x => x.key === activeChallenge.key)
        return (
          <TeacherList
            stat={s}
            onClose={() => setActiveChallenge(null)}
            onWhatsApp={openWhatsApp}
          />
        )
      })()}

      {/* WhatsApp modal */}
      {bulkSend && !templatesLoading && (
        templates.length === 0
          ? (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl p-8 text-center space-y-3 max-w-sm w-full">
                <p className="text-lg font-medium">אין תבניות הודעה</p>
                <p className="text-sm text-gray-500">צור תבנית תחילה בדף WhatsApp</p>
                <button onClick={() => setBulkSend(null)} className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm">סגור</button>
              </div>
            </div>
          )
          : (
            <BulkSendModal
              templates={templates}
              backendStatus="disconnected"
              initialContactIds={bulkSend.contactIds}
              onClose={() => setBulkSend(null)}
            />
          )
      )}
    </div>
  )
}

// ─── Challenge Tile ───────────────────────────────────────────────
function ChallengeTile({ stat, isActive, onOpen, onWhatsApp, templatesReady }) {
  const { label, icon, submitted, notSubmitted, total, pct } = stat

  const ringColor = pct === 100
    ? 'border-green-400'
    : pct >= 50
      ? 'border-blue-400'
      : 'border-orange-400'

  const barColor = pct === 100 ? 'bg-green-500' : pct >= 50 ? 'bg-blue-500' : 'bg-orange-400'

  return (
    <div className={`bg-white rounded-2xl shadow-sm border-2 transition-all ${isActive ? ringColor + ' shadow-md' : 'border-gray-100 hover:border-gray-300'}`}>

      {/* Clickable upper section */}
      <button className="w-full text-right p-5 space-y-3" onClick={onOpen}>
        <div className="flex items-center justify-between">
          <span className="text-3xl font-black text-gray-200">{icon}</span>
          <span className="text-lg font-bold text-gray-800">{label}</span>
        </div>

        {/* Big number */}
        <div className="flex items-end gap-1">
          <span className="text-4xl font-black text-gray-800">{submitted.length}</span>
          <span className="text-gray-400 text-sm mb-1">/ {total} הגישו</span>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>{notSubmitted.length} לא הגישו</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Status dots */}
        <div className="flex gap-3 text-xs">
          <span className="flex items-center gap-1 text-green-600">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            {submitted.length} הגישו
          </span>
          <span className="flex items-center gap-1 text-orange-600">
            <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />
            {notSubmitted.length} לא הגישו
          </span>
          {stat.unknown.length > 0 && (
            <span className="flex items-center gap-1 text-gray-400">
              <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />
              {stat.unknown.length} לא ידוע
            </span>
          )}
        </div>
      </button>

      {/* WhatsApp button */}
      {notSubmitted.length > 0 && (
        <div className="px-5 pb-4">
          <button
            onClick={() => onWhatsApp(notSubmitted.map(t => t.id), `תזכורת ${label} — לא הגישו`)}
            disabled={!templatesReady}
            className="w-full py-2 rounded-xl bg-green-500 hover:bg-green-600 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <span>📲</span>
            <span>שלח תזכורת ל-{notSubmitted.length} שלא הגישו</span>
          </button>
        </div>
      )}

      {pct === 100 && (
        <div className="px-5 pb-4">
          <div className="text-center text-sm text-green-600 font-medium py-2">
            🎉 כולם הגישו!
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Teacher list (inline, below tiles) ──────────────────────────
function TeacherList({ stat, onClose, onWhatsApp }) {
  const { label, submitted, notSubmitted, unknown } = stat

  const sections = [
    { title: 'הגישו', teachers: submitted, color: 'text-green-700', bg: 'bg-green-50', dot: 'bg-green-500' },
    { title: 'לא הגישו', teachers: notSubmitted, color: 'text-orange-700', bg: 'bg-orange-50', dot: 'bg-orange-400' },
    ...(unknown.length > 0 ? [{ title: 'לא ידוע', teachers: unknown, color: 'text-gray-500', bg: 'bg-gray-50', dot: 'bg-gray-300' }] : []),
  ]

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
        <h2 className="font-semibold text-gray-800">{label} — פירוט מורים</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1">×</button>
      </div>

      <div className="divide-y divide-gray-100">
        {sections.map(sec => (
          <div key={sec.title} className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className={`w-2.5 h-2.5 rounded-full ${sec.dot}`} />
              <span className={`text-sm font-semibold ${sec.color}`}>{sec.title} ({sec.teachers.length})</span>
              {sec.title === 'לא הגישו' && sec.teachers.length > 0 && (
                <button
                  onClick={() => onWhatsApp(sec.teachers.map(t => t.id), `תזכורת ${label} — לא הגישו`)}
                  className="mr-auto text-xs px-3 py-1 rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium"
                >
                  📲 שלח תזכורת
                </button>
              )}
            </div>
            {sec.teachers.length === 0
              ? <p className="text-xs text-gray-400 pr-4">—</p>
              : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pr-4">
                  {sec.teachers.map(t => (
                    <div key={t.id} className={`rounded-lg px-3 py-2 ${sec.bg} flex flex-col`}>
                      <span className="text-sm font-medium text-gray-800">{t.name}</span>
                      {t.school && <span className="text-xs text-gray-500 mt-0.5">{t.school}</span>}
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        ))}
      </div>
    </div>
  )
}
