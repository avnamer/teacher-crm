import { PASS_RATIO } from '../lib/schoolProgress.js'

// The progress bars of the challenge program, shared by the school view (pages/Schools.jsx) and the
// per-team view (components/TeamProgress.jsx).

const shortDate = iso => new Date(iso).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit' }).replace(/\//g, '.')

// Black ticks on the bar = the value at earlier syncs (newest sync darkest). A tick that equals the current value is
// not drawn (buildProgress drops it), so an unchanged bar shows only its own end. A tick to the right of the bar's end
// means the number went DOWN since that sync (drawn red).
function PreviousTicks({ item, total }) {
  if (!item.previous?.length) return null
  let lastLabelAt = null
  return item.previous.map(p => {
    const pos = Math.min(100, p.percent ?? 0)
    const showLabel = lastLabelAt === null || Math.abs(pos - lastLabelAt) >= 9
    if (showLabel) lastLabelAt = pos
    const dropped = p.entered > item.entered
    const color = dropped ? 'bg-red-500' : p.rank === 0 ? 'bg-black' : 'bg-gray-500'
    return (
      <div key={p.asOf} className="absolute -top-3 bottom-0 pointer-events-none" style={{ right: `${pos}%` }}
        title={`${shortDate(p.asOf)}: ${p.entered}${total > 0 ? ` מתוך ${total}` : ''}${p.percent !== null ? ` · ${p.percent}%` : ''}`}>
        <div className={`absolute inset-y-0 w-0.5 ${color}`} />
        {showLabel && (
          <span className={`absolute top-0 text-[9px] leading-none whitespace-nowrap ${dropped ? 'text-red-600' : p.rank === 0 ? 'text-black' : 'text-gray-500'}`}
            style={{ transform: 'translateX(50%)', right: 0 }}>{shortDate(p.asOf)}</span>
        )}
      </div>
    )
  })
}

export function ProgressBar({ item, total }) {
  const pct = item.percent ?? 0
  const hasTicks = item.previous?.length > 0
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-sm ${hasTicks ? 'pt-3' : ''}`}>
      <span className="sm:w-72 shrink-0 text-gray-700 truncate" title={item.label}>{item.label}</span>
      <div className="relative flex-1 min-w-16 h-3">
        <div className="absolute inset-0 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${item.passed ? 'bg-green-500' : 'bg-blue-400'}`} style={{ width: `${Math.min(100, pct)}%` }} />
          <div className="absolute inset-y-0 w-px bg-gray-400" style={{ right: `${PASS_RATIO * 100}%` }} title="33%" />
        </div>
        <PreviousTicks item={item} total={total} />
      </div>
      <span className="sm:w-32 shrink-0 text-gray-600 text-xs">
        {item.entered}{total > 0 ? ` מתוך ${total}` : ''}{item.percent !== null && ` · ${item.percent}%`}
      </span>
    </div>
  )
}

export function RoleColumn({ title, data, total, totalNote, summaryLabel = 'נכנסו לאתגר' }) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-gray-800">
        {title} <span className="font-normal text-gray-500">({totalNote})</span>
      </h4>
      {!data ? <p className="text-sm text-gray-400">אין נתונים</p> : (
        <>
          {data.summary && (
            <div className="font-medium"><ProgressBar item={{ ...data.summary, label: summaryLabel }} total={total} /></div>
          )}
          {data.units.map(u => <ProgressBar key={u.label} item={u} total={total} />)}
        </>
      )}
    </div>
  )
}
