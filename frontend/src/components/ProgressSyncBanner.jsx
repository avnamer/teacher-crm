import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { isSuccessFresh, relativeTimeLabel } from '../lib/whatsappSync.js'

// Status of the school-progress data (school_challenge_progress, imported from the
// 3D-center CSV). Same look and rule as the WhatsApp sync banner: green while the data
// is at most a week old, red after that.
export default function ProgressSyncBanner() {
  const [asOf, setAsOf] = useState(undefined) // undefined = loading, null = never imported

  useEffect(() => {
    let cancelled = false
    supabase.from('school_challenge_progress').select('as_of').order('as_of', { ascending: false }).limit(1)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { console.error('Error loading school progress date:', error); setAsOf(undefined); return }
        setAsOf(data?.[0]?.as_of || null)
      })
    return () => { cancelled = true }
  }, [])

  if (asOf === undefined) return null // loading, or the table doesn't exist yet

  const fresh = isSuccessFresh(asOf)
  return (
    <div className={`rounded-xl border p-4 ${fresh ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">🚀</span>
          <div>
            <p className="text-sm font-medium text-gray-800">
              {asOf
                ? <>{fresh ? '🟢' : '🔴'} עדכון אחרון של נתוני ההתקדמות בתוכנית האתגרים: {relativeTimeLabel(asOf)}</>
                : '🔴 עדיין לא יובאו נתוני התקדמות בתוכנית האתגרים'}
            </p>
            {!fresh && <p className="text-xs text-gray-500 mt-0.5">עבר יותר משבוע — כדאי לבקש קובץ חדש ולייבא אותו</p>}
          </div>
        </div>
        <Link to="/schools"
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors">
          לעמוד בתי הספר
        </Link>
      </div>
    </div>
  )
}
