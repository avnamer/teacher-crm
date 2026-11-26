// Import a 3D-center progress CSV (the app only reads these tables).
//
//   node scripts/import-school-progress.mjs <file.csv>           # dry run
//   node scripts/import-school-progress.mjs <file.csv> --apply   # adds this file as a snapshot
//
// Each file is one snapshot, keyed by its "נכון ל" timestamp (as_of). Older snapshots are KEPT so the app
// can show trends; re-importing a file with the same as_of replaces only that snapshot (safe to repeat).
//
// Two file formats, told apart by the header (columns are read by NAME, order doesn't matter):
//   * by team  (has "נבחרת"): all rows -> school_team_progress, and the sum of each school's teams for the
//     אתגר courses only -> school_challenge_progress (the school-level view and its history).
//   * by school (older): -> school_challenge_progress only.
// The CSV's percent columns are ignored — the app recomputes from the CRM headcount.
// School names are mapped to CRM names via scripts/school-progress-aliases.json: either an alias key, or
// a CRM name (alias target) that differs only in quote characters. Unknown names abort.
// Needs the migrations at the end of supabase-setup.sql. Uses SUPABASE_SERVICE_KEY from backend/.env (bypasses RLS).
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

const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '')
const [header, ...lines] = parseCsv(text)
const columns = header.map(h => h.trim())
const findColumn = prefix => columns.findIndex(h => h.startsWith(prefix))
const COL = {
  school: findColumn('בית ספר'), team: findColumn('נבחרת'), teacher: findColumn('שם המורה'), role: findColumn('תפקיד'),
  course: findColumn('קורס'), unit: findColumn('יחידה'), registered: findColumn('רשומים'), entered: findColumn('נכנסו'),
  asOf: findColumn('נכון ל'),
}
const byTeam = COL.team !== -1
const optional = byTeam ? [] : ['team', 'teacher']
const missing = Object.keys(COL).filter(name => COL[name] === -1 && !optional.includes(name))
if (missing.length) { console.error('עמודות חסרות בקובץ:', missing, columns); process.exit(1) }

// Hebrew school names arrive with ״ / " / '' and ' / ’ / ׳ used interchangeably.
const normalize = s => s.trim().replace(/''|[״“”]/g, '"').replace(/[’‘׳]/g, "'").replace(/\s+/g, ' ')
const schoolByName = new Map()
for (const [alias, crmName] of Object.entries(aliases)) {
  schoolByName.set(normalize(crmName), crmName)
  schoolByName.set(normalize(alias), crmName)
}

const ROLE = { 'תלמידים': 'students', 'מורים': 'teachers' }
const isChallenge = course => /אתגר\s*\d/.test(course)
function toCount(value, what) {
  const n = Number(value)
  if (value === '' || !Number.isInteger(n) || n < 0) { console.error(`${what} לא תקין:`, value); process.exit(1) }
  return n
}

const position = {}
const rows = []
const unknown = new Set()
for (const line of lines) {
  const cell = name => (line[COL[name]] ?? '').trim()
  const csvSchool = cell('school')
  const school = schoolByName.get(normalize(csvSchool))
  if (!school) { unknown.add(csvSchool); continue }
  const role = ROLE[cell('role')]
  if (!role) { console.error('תפקיד לא מוכר:', cell('role')); process.exit(1) }
  const team = byTeam ? toCount(cell('team'), 'מספר נבחרת') : 0
  const k = `${school}|${team}|${role}|${cell('course')}`
  position[k] = (position[k] ?? -1) + 1
  rows.push({
    school, csv_school: csvSchool, team, teacher_name: byTeam ? cell('teacher') : null, role,
    challenge: cell('course'), unit: cell('unit'), position: position[k],
    registered: toCount(cell('registered'), 'רשומים'), entered: toCount(cell('entered'), 'נכנסו'),
    as_of: parseAsOf(cell('asOf')),
  })
}
if (unknown.size) { console.error('בתי ספר שאינם ב-school-progress-aliases.json:', [...unknown]); process.exit(1) }
const snapshots = [...new Set(rows.map(r => r.as_of))]
if (snapshots.length !== 1) { console.error('הקובץ חייב להכיל "נכון ל" אחד בלבד, נמצאו:', snapshots); process.exit(1) }
const keys = rows.map(r => [r.school, r.team, r.role, r.challenge, r.unit].join('|'))
if (new Set(keys).size !== keys.length) { console.error('יש שורות כפולות בקובץ'); process.exit(1) }

// School level: one row per (school, role, course, unit). For a by-team file it is the sum of the teams,
// limited to the אתגר courses (the others are teacher material, shown only per team).
const schoolRows = new Map()
for (const { team: _team, teacher_name: _teacher, ...r } of rows) {
  if (byTeam && !isChallenge(r.challenge)) continue
  const k = [r.school, r.role, r.challenge, r.unit].join('|')
  const sum = schoolRows.get(k)
  if (sum) { sum.registered += r.registered; sum.entered += r.entered }
  else schoolRows.set(k, { ...r })
}
const schoolOut = [...schoolRows.values()]
const teamOut = byTeam ? rows : []

const schoolCount = new Set(rows.map(r => r.school)).size
const teamCount = new Set(teamOut.map(r => `${r.school}|${r.team}`)).size
console.log(`${rows.length} שורות, ${schoolCount} בתי ספר${byTeam ? `, ${teamCount} נבחרות` : ''}, נכון ל-${snapshots[0]}`)
console.log(`ייכתבו: ${schoolOut.length} שורות ברמת בית ספר${byTeam ? `, ${teamOut.length} שורות ברמת נבחרת` : ''}`)
if (flag !== '--apply') { console.log('dry run — הוסף --apply כדי לכתוב'); process.exit(0) }

const headers = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' }
async function replaceSnapshot(table, out) {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}`
  const del = await fetch(`${url}?as_of=eq.${encodeURIComponent(snapshots[0])}`, { method: 'DELETE', headers })
  if (!del.ok) { console.error(`${table}: delete failed:`, del.status, await del.text()); process.exit(1) }
  const w = await fetch(url, { method: 'POST', headers, body: JSON.stringify(out) })
  if (!w.ok) {
    console.error(`${table}: write failed:`, w.status, await w.text())
    console.error('ודא שבלוקי ה-SQL שבסוף supabase-setup.sql הורצו')
    process.exit(1)
  }
}
// Team table first: if it is missing, nothing else has been touched yet.
if (byTeam) await replaceSnapshot('school_team_progress', teamOut)
await replaceSnapshot('school_challenge_progress', schoolOut)
console.log('הסנכרון נשמר (סנכרונים קודמים נשמרו)')
