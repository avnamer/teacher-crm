import { useState, useEffect } from 'react'
import { previewMeetingMerge, applyMeetingMerge, declineMeetingMerge } from '../lib/meetingAnalysis.js'

function formatDay(day) {
  return new Date(`${day}T12:00:00`).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

// A proposal to merge several same-day records of one meeting (see
// findDuplicateMeetingClusters). Fetches the AI's merged version on mount, shows what
// it took from each record, and saves nothing until the admin approves or rejects.
export default function MeetingMergeProposal({ cluster, onDone }) {
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setError(null)
    previewMeetingMerge(cluster)
      .then(p => { if (!cancelled) setPreview(p) })
      .catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
    // Keyed on cluster.key: callers may rebuild an identical cluster object every
    // render, and each run of this effect is a paid AI call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster.key, attempt])

  const recordNumber = groupId => cluster.groups.findIndex(g => g.groupId === groupId) + 1

  async function approve() {
    setBusy(true)
    try {
      const warning = await applyMeetingMerge(cluster, preview)
      if (warning) alert(warning)
      onDone()
    } catch (err) {
      alert('שגיאה באיחוד הפגישות: ' + err.message)
      setBusy(false)
    }
  }

  async function decline() {
    setBusy(true)
    try {
      await declineMeetingMerge(cluster)
      onDone()
    } catch (err) {
      alert('שגיאה בשמירת ההחלטה: ' + err.message)
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-purple-200 bg-white p-3 space-y-3 text-sm">
      <p className="font-medium text-gray-800">
        {formatDay(cluster.day)}: {cluster.groups.length} רשומות שנראות כמו אותה פגישה
      </p>

      <ol className="space-y-2">
        {cluster.groups.map((g, i) => {
          const source = preview?.groupSources.find(s => s.groupId === g.groupId)
          return (
            <li key={g.groupId} className="rounded border border-gray-200 p-2 space-y-1">
              <div className="text-xs text-gray-500">
                רשומה {i + 1} · <span className="text-blue-600">{g.contactNames.join(', ')}</span>
              </div>
              <p className="text-gray-700 whitespace-pre-line line-clamp-4">{g.content || '—'}</p>
              {source && (
                <p className="text-xs text-purple-700 bg-purple-50 rounded px-2 py-1">
                  {source.duplicateOf
                    ? `זהה לרשומה ${recordNumber(source.duplicateOf)}, לא נוסף ממנה מידע`
                    : `מה נלקח: ${source.taken || '—'}`}
                </p>
              )}
            </li>
          )
        })}
      </ol>

      {!preview && !error && <p className="text-xs text-gray-500">Claude מכין הצעה לפגישה מאוחדת...</p>}

      {error && (
        <div className="text-xs text-red-700 bg-red-50 rounded px-2 py-1 flex items-center justify-between gap-2">
          <span>הכנת ההצעה נכשלה: {error}</span>
          <button onClick={() => setAttempt(a => a + 1)} className="underline">נסה שוב</button>
        </div>
      )}

      {preview && (
        <div className="rounded border border-green-200 bg-green-50 p-2 space-y-2">
          <p className="text-xs font-medium text-green-800">הפגישה המאוחדת</p>
          <p className="text-gray-800 whitespace-pre-line">{preview.content}</p>
          {preview.summary && (
            <p className="text-xs text-gray-600"><span className="font-medium">סיכום:</span> {preview.summary}</p>
          )}
          {preview.action_items.length > 0 && (
            <div className="text-xs text-gray-600">
              <span className="font-medium">משימות:</span>
              <ul className="list-disc pr-5">
                {preview.action_items.map((item, i) => (
                  <li key={i}>{item.text}{item.due_date ? ` (${item.due_date})` : ''}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button onClick={approve} disabled={!preview || busy}
          className="px-3 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50">
          {busy ? 'שומר...' : '✓ אשר איחוד'}
        </button>
        <button onClick={decline} disabled={busy}
          className="px-3 py-1.5 border rounded text-xs hover:bg-gray-100 disabled:opacity-50">
          ✗ לא לאחד, אלה פגישות נפרדות
        </button>
      </div>
    </div>
  )
}
