// One-way sync: monday "Mentor Hub" board -> school_monday_days (the app only reads it).
//
//   node scripts/sync-monday-days.mjs <rows.json>           # dry run: prints what would change
//   node scripts/sync-monday-days.mjs <rows.json> --apply   # writes the changes
//
// rows.json = the board's current "ימי מאנדיי" as read by Claude (monday-integration skill):
//   [{ "school": "חט\"ב ב", "day_date": "2026-11-15", "status": "problem", "note": "…" }, …]
// status: approved | pending | problem | text. Schools in the DB but missing from rows.json are
// only reported, never deleted. Uses SUPABASE_SERVICE_KEY from backend/.env (bypasses RLS).
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
if (!file) { console.error('usage: node scripts/sync-monday-days.mjs <rows.json> [--apply]'); process.exit(1) }

const STATUSES = ['approved', 'pending', 'problem', 'text']
const rows = JSON.parse(fs.readFileSync(file, 'utf8')).map(r => ({
  school: r.school, day_date: r.day_date || null, status: r.status, note: r.note || null,
}))
for (const r of rows) if (!r.school || !STATUSES.includes(r.status)) { console.error('bad row:', r); process.exit(1) }

const headers = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' }
const url = `${env.SUPABASE_URL}/rest/v1/school_monday_days`
const res = await fetch(`${url}?select=school,day_date,status,note`, { headers })
if (!res.ok) { console.error('read failed:', res.status, await res.text()); process.exit(1) }
const current = Object.fromEntries((await res.json()).map(r => [r.school, r]))

const same = (a, b) => a.day_date === b.day_date && a.status === b.status && (a.note || null) === (b.note || null)
const added = rows.filter(r => !current[r.school])
const changed = rows.filter(r => current[r.school] && !same(current[r.school], r))
const missing = Object.keys(current).filter(s => !rows.some(r => r.school === s))
console.log(`חדשים: ${added.length}, השתנו: ${changed.length}, ללא שינוי: ${rows.length - added.length - changed.length}`)
for (const r of added) console.log('  + ', r.school, r.day_date, r.status, r.note || '')
for (const r of changed) console.log('  ~ ', r.school, JSON.stringify(current[r.school]), '→', JSON.stringify(r))
for (const s of missing) console.log('  ? לא בבורד יותר (לא נמחק):', s)

if (flag !== '--apply') { console.log('dry run — הוסף --apply כדי לכתוב'); process.exit(0) }
const todo = [...added, ...changed].map(r => ({ ...r, updated_at: new Date().toISOString() }))
if (!todo.length) { console.log('אין מה לעדכן'); process.exit(0) }
const w = await fetch(url, { method: 'POST', headers: { ...headers, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(todo) })
if (!w.ok) { console.error('write failed:', w.status, await w.text()); process.exit(1) }
console.log(`עודכנו ${todo.length} שורות`)
