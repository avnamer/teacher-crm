import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { isSuccessFresh, isExtensionConnected, relativeTimeLabel, requestManualSync } from '../lib/whatsappSync.js'

// Status + manual trigger for the WhatsApp sync, spec §3.4. No polling/realtime
// (this codebase doesn't use either anywhere yet) — a manual refresh button
// matches house style, same as every other "reload" affordance in this app.
export default function WhatsAppSyncBanner() {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)
  const [detailExpanded, setDetailExpanded] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('whatsapp_sync_state').select('*').eq('id', 'global').single()
      if (error) throw error
      setState(data)
    } catch (err) {
      console.error('Error loading whatsapp_sync_state:', err)
      // Most likely cause: the migration in supabase-setup.sql hasn't been run
      // yet against this Supabase project. Treat as "feature not set up" rather
      // than crashing the whole dashboard.
      setState(null)
    } finally {
      setLoading(false)
    }
  }

  async function handleSyncClick() {
    setRequesting(true)
    try {
      await requestManualSync(supabase)
      alert('בקשת הסנכרון נשלחה. התוסף יאסוף אותה בתוך דקה (אם המחשב דלוק ו-Chrome פתוח).')
      await load()
    } catch (err) {
      alert('שליחת בקשת הסנכרון נכשלה: ' + err.message)
    } finally {
      setRequesting(false)
    }
  }

  if (loading) return null
  if (!state) return null // feature not configured in this database yet

  const running = state.last_status === 'running'
  const connected = isExtensionConnected(state.extension_heartbeat_at)
  const fresh = isSuccessFresh(state.last_success_at)
  const failedTeachers = state.failed_teachers || []
  const unmatched = state.unmatched_group_senders || []
  const hasDetail = failedTeachers.length > 0 || unmatched.length > 0

  return (
    <div className={`rounded-xl border p-4 ${running ? 'bg-blue-50 border-blue-200' : fresh ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">💬</span>
          <div>
            <p className="text-sm font-medium text-gray-800">
              {running
                ? `מסנכרן וואטסאפ... ${state.progress_done} מתוך ${state.progress_total}`
                : state.last_success_at
                  ? <>{fresh ? '🟢' : '🔴'} סנכרון אחרון מוצלח: {relativeTimeLabel(state.last_success_at)}</>
                  : 'עדיין לא בוצע סנכרון וואטסאפ'}
            </p>
            {!connected && (
              <p className="text-xs text-gray-500 mt-0.5">⚠️ התוסף לא מחובר כרגע</p>
            )}
            {!running && state.last_status === 'failed' && state.last_error && (
              <p className="text-xs text-red-700 mt-0.5">{state.last_error}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/whatsapp-groups"
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors">
            קבוצות מסונכרנות
          </Link>
          {hasDetail && (
            <button onClick={() => setDetailExpanded(v => !v)}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors">
              {detailExpanded ? '▲ הסתר פירוט' : '▼ הצג פירוט'}
            </button>
          )}
          <button onClick={load}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors">
            🔄 רענן סטטוס
          </button>
          <button onClick={handleSyncClick} disabled={running || requesting}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {running ? 'מסנכרן...' : 'סנכרן וואטסאפ'}
          </button>
        </div>
      </div>

      {detailExpanded && hasDetail && (
        <div className="mt-3 space-y-2 text-sm">
          {failedTeachers.length > 0 && (
            <div>
              <p className="text-xs font-medium text-red-700 mb-1">מורים שנכשלו בסנכרון האחרון:</p>
              <ul className="space-y-0.5">
                {failedTeachers.map((f, idx) => (
                  <li key={idx} className="text-xs text-gray-600">{f.teacherName} — {f.reason}</li>
                ))}
              </ul>
            </div>
          )}
          {unmatched.length > 0 && (
            <div>
              <p className="text-xs font-medium text-amber-700 mb-1">
                נמצאו {unmatched.length} שולחים לא מזוהים בקבוצות — יש לשייך אותם ידנית בכרטיס המורה:
              </p>
              <ul className="space-y-0.5">
                {unmatched.map((u, idx) => (
                  <li key={idx} className="text-xs text-gray-600">"{u.senderName}" בקבוצה "{u.groupName}"</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
