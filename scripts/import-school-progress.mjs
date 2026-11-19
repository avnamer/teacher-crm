// Import the 3D-center progress CSV -> school_challenge_progress (the app only reads it).
//
//   node scripts/import-school-progress.mjs <file.csv>           # dry run
//   node scripts/import-school-progress.mjs <file.csv> --apply   # replaces the table's content
//
// CSV columns: נכון ל, בית ספר, תפקיד, רשומים, קורס, יחידה, נכנסו ליחידה, אחוז מהרשומים, עבר 33%
// The CSV's percent columns are ignored — the app recomputes from the school's total students.
// School names are mapped to CRM names via scripts/school-progress-aliases.json (unknown names abort).
// Uses SUPABASE_SERVICE_KEY from backend/.env (bypasses RLS).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, 'backend', '.env'), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const [file, flag] = process.argv.slice(2)
if (!file) { console.error('usage: node scripts/import-school-progress.mjs <file.csv> [--apply]'); process.exit(1) }
const aliases = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'school-progress-aliases.json'), 'utf8'))

function parseCsv(text) {
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(c => c.trim())) rows.push(row)
      row = []
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); if (row.some(c => c.trim())) rows.push(row) }
  return rows
}

// "12.11.2026 12:25" (Israel time) -> ISO
function parseAsOf(s) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) throw new Error(`תאריך לא תקין: ${s}`)
  const [, d, mo, y, h, mi] = m.map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const offset = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(guess)).find(p => p.type === 'timeZoneName').value.replace('GMT', '').replace('+', '') || 0)
  return new Date(guess - offset * 3600000).toISOString()
}

const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
const [, ...lines] = parseCsv(text)
const ROLE = { 'תלמידים': 'students', 'מורים': 'teachers' }
const position = {}
const out = []
const unknown = new Set()
for (const [asOf, csvSchool, role, registered, challenge, unit, entered] of lines) {
  const school = aliases[csvSchool.trim()]
  if (!school) { unknown.add(csvSchool.trim()); continue }
  if (!ROLE[role.trim()]) { console.error('תפקיד לא מוכר:', role); process.exit(1) }
  const k = `${school}|${role}|${challenge}`
  position[k] = (position[k] ?? -1) + 1
  out.push({
    school, csv_school: csvSchool.trim(), role: ROLE[role.trim()], challenge: challenge.trim(), unit: unit.trim(),
    position: position[k], registered: Number(registered), entered: Number(entered), as_of: parseAsOf(asOf),
  })
}
if (unknown.size) { console.error('בתי ספר שאינם ב-school-progress-aliases.json:', [...unknown]); process.exit(1) }
console.log(`${out.length} שורות, ${new Set(out.map(r => r.school)).size} בתי ספר, נכון ל-${out[0]?.as_of}`)
if (flag !== '--apply') { console.log('dry run — הוסף --apply כדי לכתוב'); process.exit(0) }

const headers = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' }
const url = `${env.SUPABASE_URL}/rest/v1/school_challenge_progress`
const del = await fetch(`${url}?school=neq.__none__`, { method: 'DELETE', headers })
if (!del.ok) { console.error('delete failed:', del.status, await del.text()); process.exit(1) }
const w = await fetch(url, { method: 'POST', headers, body: JSON.stringify(out) })
if (!w.ok) { console.error('write failed:', w.status, await w.text()); process.exit(1) }
console.log('הנתונים עודכנו')
