# WhatsApp Task Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When WhatsApp sync saves new DM messages, have Claude find the tasks in them and file each one under the teacher (on the WhatsApp day row) or under Avner (a new row on the admin pseudo-contact), marked as coming from WhatsApp with the message date.

**Architecture:** `POST /api/whatsapp-sync/messages` already merges a batch into day rows. `mergeWhatsAppMessages` will also return the messages it actually inserted; after the route responds, it fires `extractAndSaveWhatsAppTasks` (new `services/whatsappTasks.js`) in the background, which calls a new `analyzeWhatsAppTasks` (in `services/claudeAnalyze.js`) and writes the results. The frontend only changes how tasks are counted and labeled, plus a stale-write fix in `toggleActionItem`.

**Tech Stack:** Node/Express (ESM), `@supabase/supabase-js` (service key), `@anthropic-ai/sdk` (`claude-sonnet-5`), React + Vite.

**Spec:** [`docs/superpowers/specs/2026-10-01-whatsapp-task-extraction-design.md`](../specs/2026-10-01-whatsapp-task-extraction-design.md)

**Working directory:** `C:\Users\Avner\teacher-crm-worktrees\whatsapp-sync`, branch `feature/whatsapp-task-extraction`. Never `git add -A` (stage named files). Don't push mid-work (Netlify credits; see `CLAUDE.md`).

**Testing approach:** the repo has no test framework, and adding one is out of scope. Pure functions are checked with `node -e` + `node:assert`; anything touching Supabase/Claude is checked with a script run from `backend/` (needed so `@supabase/supabase-js` and `dotenv` resolve, and `.env` loads). The backend dev server is plain `node server.js` — restart it after backend changes (verify the PID on port 3001 belongs to this worktree before stopping it).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `backend/src/services/whatsappDedup.js` | Modify | Export `normalizeText` and `similarity` (reused for task dedup) |
| `backend/src/services/claudeAnalyze.js` | Modify | `analyzeWhatsAppTasks()` + pure `normalizeWhatsAppTasks()` |
| `backend/src/services/whatsappTasks.js` | Create | Format messages for the prompt, load existing tasks, dedup, write teacher/admin tasks |
| `backend/src/services/whatsappMerge.js` | Modify | Also return `savedMessages` |
| `backend/src/routes/whatsappSync.js` | Modify | Fire task extraction after responding (DM only) |
| `backend/scripts/whatsapp-tasks-dry-run.mjs` | Create | Print tasks for a contact's stored DM messages, no writes |
| `frontend/src/pages/ContactDetail.jsx` | Modify | Fresh-read in `toggleActionItem`; `💬 date` marker on WhatsApp tasks |
| `frontend/src/pages/Contacts.jsx` | Modify | Dashboard open-task indicator also reads `whatsapp` rows |
| `frontend/src/lib/adminTasks.js` | Modify | Pass `whatsapp_contact_name` through |
| `frontend/src/components/AdminTasksPanel.jsx` | Modify | `💬 וואטסאפ · <name>` source label |

---

### Task 1: Export the text-similarity helpers

**Files:**
- Modify: `backend/src/services/whatsappDedup.js:13` and `:36`

- [ ] **Step 1: Verify they are not exported yet**

Run (from `backend/`):
```bash
node -e "import('./src/services/whatsappDedup.js').then(m => console.log(typeof m.normalizeText, typeof m.similarity))"
```
Expected: `undefined undefined`

- [ ] **Step 2: Export them**

In `backend/src/services/whatsappDedup.js` change `function normalizeText(str) {` to `export function normalizeText(str) {` and `function similarity(a, b) {` to `export function similarity(a, b) {`. No other change.

- [ ] **Step 3: Verify**

```bash
node -e "import('./src/services/whatsappDedup.js').then(m => { const a = require('node:assert'); a.equal(m.similarity(m.normalizeText('לשלוח טופס!'), m.normalizeText('לשלוח טופס')), 1); console.log('OK') })"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/whatsappDedup.js
git commit -m "WhatsApp dedup: export normalizeText/similarity for reuse"
```

---

### Task 2: `analyzeWhatsAppTasks` + `normalizeWhatsAppTasks`

**Files:**
- Modify: `backend/src/services/claudeAnalyze.js` (append at end of file)

- [ ] **Step 1: Write the failing check**

From `backend/`:
```bash
node -e "import('dotenv/config').then(() => import('./src/services/claudeAnalyze.js')).then(m => console.log(typeof m.normalizeWhatsAppTasks, typeof m.analyzeWhatsAppTasks))"
```
Expected: `undefined undefined`

- [ ] **Step 2: Append the implementation**

Append to `backend/src/services/claudeAnalyze.js`:

```js
// ─── Tasks inside a synced WhatsApp DM ─────────────────────────────────────
// WhatsApp sync (routes/whatsappSync.js) hands over the messages it just saved
// for one teacher; services/whatsappTasks.js files each returned task under the
// teacher or under the admin. No approval queue (spec 2026-10-01), so the prompt
// errs toward fewer, concrete tasks.
const WHATSAPP_TASKS_PROMPT = `אתה עוזר שמנתח התכתבות וואטסאפ בין אבנר (מנטור של מורים) לבין מורה אחד/ת, ומחלץ ממנה משימות.

משימה היא התחייבות או בקשה קונקרטית לעשות משהו: לשלוח קובץ, למלא טופס, להגיע לפגישה, לבדוק משהו, לחזור עם תשובה. ברכות, תודות, שיחת חולין ומידע כללי אינם משימות.

- "assignee": "teacher" — משהו שהמורה התבקש/ה לעשות או התחייב/ה לעשות.
- "assignee": "admin" — משהו שאבנר התבקש לעשות או התחייב לעשות.
- "message_date" — התאריך (YYYY-MM-DD) של ההודעה שממנה עלתה המשימה, כפי שמופיע בסוגריים בתחילת השורה.
- "due_date" — רק אם הוזכר תאריך או תאריך יחסי (חשב יחסית ל-message_date), אחרת null.
- "done": true רק אם הודעה מאוחרת יותר בהתכתבות מראה במפורש שהמשימה בוצעה (למשל "שלחתי", "קיבלתי, תודה"). אחרת false.
- נסח כל משימה קצר וברור, בעברית, בלי שם המבצע בתחילתה.
- אל תחזיר משימה שכבר מופיעה ברשימת "משימות שכבר קיימות".

החזר אך ורק JSON תקני בפורמט הבא, בלי שום טקסט נוסף לפניו או אחריו:
{ "tasks": [ { "assignee": "teacher" | "admin", "text": "תיאור המשימה", "message_date": "YYYY-MM-DD", "due_date": "YYYY-MM-DD" | null, "done": false } ] }
אם אין משימות, החזר { "tasks": [] }.`

const VALID_ASSIGNEES = new Set(['teacher', 'admin'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Pure: keeps only well-formed tasks whose message_date is one of `allowedDates`. */
export function normalizeWhatsAppTasks(parsed, allowedDates) {
  const allowed = new Set(allowedDates)
  return (Array.isArray(parsed?.tasks) ? parsed.tasks : [])
    .filter(t => VALID_ASSIGNEES.has(t?.assignee))
    .filter(t => typeof t.text === 'string' && t.text.trim())
    .filter(t => allowed.has(t.message_date))
    .map(t => ({
      assignee: t.assignee,
      text: t.text.trim(),
      message_date: t.message_date,
      due_date: ISO_DATE.test(t.due_date || '') ? t.due_date : null,
      done: t.done === true,
    }))
}

/**
 * conversation: prompt-ready lines, oldest first (see formatMessagesForPrompt in
 * services/whatsappTasks.js). existingTasks: [{ assignee, text, done }].
 * messageDates: the Israel dates the conversation lines carry.
 */
export async function analyzeWhatsAppTasks({ teacherName, conversation, existingTasks, messageDates }) {
  const existing = existingTasks.length
    ? existingTasks.map(t => `- [${t.assignee === 'admin' ? 'אבנר' : teacherName}] ${t.text}${t.done ? ' (בוצעה)' : ''}`).join('\n')
    : '(אין)'
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: MAX_TOKENS,
    system: WHATSAPP_TASKS_PROMPT,
    messages: [{
      role: 'user',
      content: `שם המורה: ${teacherName}\n\nמשימות שכבר קיימות — אל תחזיר אותן שוב:\n${existing}\n\nההתכתבות:\n${conversation}`,
    }],
  })

  const text = responseText(response)

  let parsed
  try {
    parsed = JSON.parse(extractJson(text))
  } catch {
    throw new Error('התשובה מ-Claude לא הייתה JSON תקני')
  }
  return normalizeWhatsAppTasks(parsed, messageDates)
}
```

- [ ] **Step 3: Verify the pure normalizer**

```bash
node -e "
import('dotenv/config').then(() => import('./src/services/claudeAnalyze.js')).then(m => {
  const a = require('node:assert')
  const out = m.normalizeWhatsAppTasks({ tasks: [
    { assignee: 'teacher', text: ' לשלוח טופס ', message_date: '2026-09-24', due_date: '2026-09-28', done: false },
    { assignee: 'admin', text: 'להגיע לבית הספר', message_date: '2026-09-24', due_date: 'next week', done: 'yes' },
    { assignee: 'someone', text: 'x', message_date: '2026-09-24' },
    { assignee: 'teacher', text: '', message_date: '2026-09-24' },
    { assignee: 'teacher', text: 'y', message_date: '2026-01-01' },
  ] }, ['2026-09-24'])
  a.deepEqual(out, [
    { assignee: 'teacher', text: 'לשלוח טופס', message_date: '2026-09-24', due_date: '2026-09-28', done: false },
    { assignee: 'admin', text: 'להגיע לבית הספר', message_date: '2026-09-24', due_date: null, done: false },
  ])
  a.deepEqual(m.normalizeWhatsAppTasks(null, []), [])
  console.log('OK')
})"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/claudeAnalyze.js
git commit -m "Add analyzeWhatsAppTasks: Claude task extraction for a WhatsApp DM"
```

---

### Task 3: `whatsappTasks.js` — prompt formatting (pure part)

**Files:**
- Create: `backend/src/services/whatsappTasks.js`

- [ ] **Step 1: Create the file with the pure helpers**

```js
import { createClient } from '@supabase/supabase-js'
import { analyzeWhatsAppTasks } from './claudeAnalyze.js'
import { israelDateStr, normalizeText, similarity, SIMILARITY_THRESHOLD } from './whatsappDedup.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Files the tasks Claude finds in newly synced WhatsApp DM messages (spec
// 2026-10-01-whatsapp-task-extraction): a teacher's task goes into
// metadata.action_items of that teacher's WhatsApp day row; Avner's task becomes
// its own row on the admin pseudo-contact, so "המשימות שלי" shows it.

const israelTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
})

function messageBody(m) {
  if (m.kind === 'voice') return m.transcript ? `🎤 ${m.transcript}` : ''
  if (m.kind === 'media') return [m.mediaLabel, m.text].filter(Boolean).join(' ')
  return m.text || ''
}

/** Pure: prompt lines "[YYYY-MM-DD HH:MM] name: text", oldest first, empty messages dropped. */
export function formatMessagesForPrompt(messages, teacherName) {
  const lines = []
  const dates = new Set()
  for (const m of [...messages].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))) {
    const body = messageBody(m).trim()
    if (!body) continue
    const day = israelDateStr(m.timestamp)
    dates.add(day)
    const who = m.sender === 'me' ? 'אבנר' : teacherName
    lines.push(`[${day} ${israelTime.format(new Date(m.timestamp))}] ${who}: ${body}`)
  }
  return { conversation: lines.join('\n'), messageDates: [...dates] }
}

/** Pure: is `task` ≥ SIMILARITY_THRESHOLD similar to an existing task with the same assignee? */
export function isDuplicateTask(task, existingTasks) {
  const key = normalizeText(task.text)
  return existingTasks.some(e =>
    e.assignee === task.assignee && similarity(key, normalizeText(e.text)) >= SIMILARITY_THRESHOLD
  )
}
```

- [ ] **Step 2: Verify the pure helpers**

From `backend/`:
```bash
node -e "
import('dotenv/config').then(() => import('./src/services/whatsappTasks.js')).then(m => {
  const a = require('node:assert')
  const { conversation, messageDates } = m.formatMessagesForPrompt([
    { timestamp: '2026-09-24T12:11:00.000Z', sender: 'teacher', kind: 'voice', transcript: 'תשלח לי את הטופס' },
    { timestamp: '2026-09-24T12:08:00.000Z', sender: 'teacher', kind: 'text', text: 'מה נשמע?' },
    { timestamp: '2026-09-30T14:26:00.000Z', sender: 'me', kind: 'voice', transcript: '' },
    { timestamp: '2026-09-30T15:56:00.000Z', sender: 'me', kind: 'text', text: 'שלחתי' },
  ], 'דודי יעקב')
  a.equal(conversation, '[2026-09-24 15:08] דודי יעקב: מה נשמע?\n[2026-09-24 15:11] דודי יעקב: 🎤 תשלח לי את הטופס\n[2026-09-30 18:56] אבנר: שלחתי')
  a.deepEqual(messageDates, ['2026-09-24', '2026-09-30'])
  a.equal(m.isDuplicateTask({ assignee: 'teacher', text: 'לשלוח את הטופס.' }, [{ assignee: 'teacher', text: 'לשלוח את הטופס' }]), true)
  a.equal(m.isDuplicateTask({ assignee: 'admin', text: 'לשלוח את הטופס' }, [{ assignee: 'teacher', text: 'לשלוח את הטופס' }]), false)
  console.log('OK')
})"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/whatsappTasks.js
git commit -m "whatsappTasks: prompt formatting and task dedup helpers"
```

---

### Task 4: Dry-run script (owner checks the output before anything is saved)

**Files:**
- Create: `backend/scripts/whatsapp-tasks-dry-run.mjs`

- [ ] **Step 1: Create the script**

```js
// Dry run for WhatsApp task extraction: prints the tasks Claude finds in a
// contact's already-stored WhatsApp DM messages. Writes nothing.
// Run from backend/:  node scripts/whatsapp-tasks-dry-run.mjs <contact-id> [<contact-id> ...]
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { analyzeWhatsAppTasks } from '../src/services/claudeAnalyze.js'
import { formatMessagesForPrompt } from '../src/services/whatsappTasks.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

for (const contactId of process.argv.slice(2)) {
  const { data: contact, error: cErr } = await supabase.from('contacts').select('name').eq('id', contactId).single()
  if (cErr) { console.error(contactId, cErr.message); continue }
  const { data: rows, error } = await supabase
    .from('interactions').select('metadata')
    .eq('contact_id', contactId).eq('type', 'whatsapp').contains('metadata', { source: 'dm' })
  if (error) { console.error(contact.name, error.message); continue }
  const messages = rows.flatMap(r => r.metadata?.messages || [])
  const { conversation, messageDates } = formatMessagesForPrompt(messages, contact.name)
  console.log(`\n=== ${contact.name}: ${messages.length} messages ===`)
  if (!conversation) { console.log('(no text)'); continue }
  const tasks = await analyzeWhatsAppTasks({ teacherName: contact.name, conversation, existingTasks: [], messageDates })
  for (const t of tasks) {
    console.log(`${t.assignee === 'admin' ? 'אבנר ' : 'מורה '} [${t.message_date}]${t.done ? ' ✓ בוצעה' : ''}${t.due_date ? ` (עד ${t.due_date})` : ''} ${t.text}`)
  }
  if (tasks.length === 0) console.log('(no tasks)')
}
```

- [ ] **Step 2: Run it on Dudi and Anat**

From `backend/`:
```bash
node scripts/whatsapp-tasks-dry-run.mjs b3abe592-cfe9-4044-aabe-d3e3aaaaead6 2dd29d4c-873d-495d-a465-55b86c5aa825
```
Expected: a `=== <name> ===` block per contact listing tasks with `מורה`/`אבנר`, a message date, and `✓ בוצעה` where the chat shows completion. (Anat may have no DM rows if the owner deleted them; then it prints `0 messages` / `(no text)` — use any contact whose rows exist.)

- [ ] **Step 3: STOP — owner review**

Show the output to the owner. Continue only once they confirm the teacher/admin split and the `done` judgments look right. If they don't, adjust `WHATSAPP_TASKS_PROMPT` (Task 2) and re-run Step 2 — commit prompt changes with the script.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/whatsapp-tasks-dry-run.mjs
git commit -m "Add dry-run script for WhatsApp task extraction"
```

---

### Task 5: `extractAndSaveWhatsAppTasks` — load, analyze, write

**Files:**
- Modify: `backend/src/services/whatsappTasks.js` (append)

- [ ] **Step 1: Append the DB part**

```js
// The DM day row(s) for `day` (Israel date) — same window + re-check as whatsappMerge.js.
async function findDmDayRow(contactId, day) {
  const dayStartUtc = new Date(`${day}T00:00:00Z`).getTime()
  const { data, error } = await supabase
    .from('interactions')
    .select('id, metadata, created_at')
    .eq('contact_id', contactId)
    .eq('type', 'whatsapp')
    .gte('created_at', new Date(dayStartUtc - 24 * 3600 * 1000).toISOString())
    .lte('created_at', new Date(dayStartUtc + 48 * 3600 * 1000).toISOString())
  if (error) throw error
  return (data || []).find(r => israelDateStr(r.created_at) === day && r.metadata?.source !== 'group') || null
}

async function findAdminContactId() {
  const { data, error } = await supabase
    .from('contacts').select('id').contains('custom_fields', { is_admin_row: true }).maybeSingle()
  if (error) throw error
  return data?.id || null
}

// Existing WhatsApp-sourced tasks for this teacher, both assignees — fed to Claude
// ("don't return these") and to isDuplicateTask.
async function loadExistingTasks(contactId, adminId) {
  const { data: teacherRows, error: tErr } = await supabase
    .from('interactions').select('metadata')
    .eq('contact_id', contactId).eq('type', 'whatsapp')
  if (tErr) throw tErr
  const teacherTasks = (teacherRows || [])
    .flatMap(r => r.metadata?.action_items || [])
    .filter(i => i.source === 'whatsapp')
    .map(i => ({ assignee: 'teacher', text: i.text, done: !!i.done }))

  let adminTasks = []
  if (adminId) {
    const { data: adminRows, error: aErr } = await supabase
      .from('interactions').select('metadata')
      .eq('contact_id', adminId)
      .contains('metadata', { source: 'whatsapp', whatsapp_contact_id: contactId })
    if (aErr) throw aErr
    adminTasks = (adminRows || [])
      .flatMap(r => r.metadata?.action_items || [])
      .map(i => ({ assignee: 'admin', text: i.text, done: !!i.done }))
  }
  return [...teacherTasks, ...adminTasks]
}

function actionItem(task) {
  return { text: task.text, due_date: task.due_date, done: task.done, source: 'whatsapp', message_date: task.message_date }
}

/**
 * Runs after POST /messages has responded (DM batches only). `savedMessages` are
 * the messages mergeWhatsAppMessages actually inserted. Throws on failure — the
 * caller logs it; the sync itself has already succeeded.
 */
export async function extractAndSaveWhatsAppTasks({ contactId, savedMessages }) {
  const { data: contact, error: cErr } = await supabase.from('contacts').select('name').eq('id', contactId).single()
  if (cErr) throw cErr
  const { conversation, messageDates } = formatMessagesForPrompt(savedMessages, contact.name)
  if (!conversation) return { teacherTasks: 0, adminTasks: 0 }

  const adminId = await findAdminContactId()
  const existingTasks = await loadExistingTasks(contactId, adminId)
  const found = await analyzeWhatsAppTasks({ teacherName: contact.name, conversation, existingTasks, messageDates })

  const accepted = []
  for (const task of found) {
    if (isDuplicateTask(task, [...existingTasks, ...accepted])) continue
    accepted.push(task)
  }

  let teacherTasks = 0
  let adminTasks = 0
  const now = new Date().toISOString()

  // Teacher tasks: append to that day's DM row (read fresh, keep everything else).
  // Also stamp tasks_analyzed_at on every day this batch touched.
  for (const day of messageDates) {
    const row = await findDmDayRow(contactId, day)
    if (!row) continue
    const newItems = accepted.filter(t => t.assignee === 'teacher' && t.message_date === day).map(actionItem)
    const { error } = await supabase
      .from('interactions')
      .update({
        metadata: {
          ...row.metadata,
          action_items: [...(row.metadata?.action_items || []), ...newItems],
          tasks_analyzed_at: now,
        },
      })
      .eq('id', row.id)
    if (error) throw error
    teacherTasks += newItems.length
  }

  // Admin tasks: one row each on the admin pseudo-contact.
  const forAdmin = accepted.filter(t => t.assignee === 'admin')
  if (forAdmin.length && !adminId) {
    console.warn('[whatsapp-sync/tasks] no is_admin_row contact — skipped', forAdmin.length, 'admin task(s)')
  } else {
    for (const task of forAdmin) {
      const { error } = await supabase.from('interactions').insert({
        contact_id: adminId,
        type: 'journal',
        // Noon-ish Israel time on the message's day (10:00Z = 12:00/13:00 Israel), so
        // the row — and "המשימות שלי" — show the conversation's date, not the sync's.
        created_at: `${task.message_date}T10:00:00.000Z`,
        content: `משימה מהתכתבות וואטסאפ עם ${contact.name}`,
        metadata: {
          source: 'whatsapp',
          whatsapp_contact_id: contactId,
          whatsapp_contact_name: contact.name,
          message_date: task.message_date,
          action_items: [actionItem(task)],
        },
      })
      if (error) throw error
      adminTasks++
    }
  }

  return { teacherTasks, adminTasks }
}
```

- [ ] **Step 2: Syntax + import check**

From `backend/`:
```bash
node -e "import('dotenv/config').then(() => import('./src/services/whatsappTasks.js')).then(m => console.log(typeof m.extractAndSaveWhatsAppTasks))"
```
Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/whatsappTasks.js
git commit -m "whatsappTasks: save extracted tasks to teacher day rows and admin rows"
```

---

### Task 6: Return `savedMessages` from the merge and fire extraction from the route

**Files:**
- Modify: `backend/src/services/whatsappMerge.js` (`mergeWhatsAppMessages`)
- Modify: `backend/src/routes/whatsappSync.js` (imports; `POST /messages`)

- [ ] **Step 1: Collect inserted messages in `mergeWhatsAppMessages`**

In `backend/src/services/whatsappMerge.js`:

1. Change the early return
   `if (!messages?.length) return { saved: 0, duplicatesSkipped: 0 }`
   to
   `if (!messages?.length) return { saved: 0, duplicatesSkipped: 0, savedMessages: [] }`
2. Next to `let duplicatesSkipped = 0` add:
   ```js
   const savedMessages = []
   ```
3. Replace `saved += acceptedNow.length` with:
   ```js
   saved += acceptedNow.length
   savedMessages.push(...acceptedNow)
   ```
4. Replace the final `return { saved, duplicatesSkipped }` with `return { saved, duplicatesSkipped, savedMessages }`, and add to the JSDoc above the function: `savedMessages` = the messages actually inserted (not duplicates, not voice replacements) — used to trigger task extraction.

- [ ] **Step 2: Fire extraction in the route**

In `backend/src/routes/whatsappSync.js`:

1. Add the import next to the other service imports:
   ```js
   import { extractAndSaveWhatsAppTasks } from '../services/whatsappTasks.js'
   ```
2. In `POST /messages`, change
   `const { saved, duplicatesSkipped } = await mergeWhatsAppMessages(...)`
   to
   `const { saved, duplicatesSkipped, savedMessages } = await mergeWhatsAppMessages(...)` (same arguments).
3. Replace `res.json({ saved, duplicatesSkipped })` with:
   ```js
   res.json({ saved, duplicatesSkipped })

   // Task extraction (spec 2026-10-01) runs after responding, so a Claude
   // failure or slowness never fails or delays the sync. DM only; a batch that
   // saved nothing new (a re-sync) costs no Claude call.
   if (source === 'dm' && savedMessages.length > 0) {
     extractAndSaveWhatsAppTasks({ contactId, savedMessages })
       .then(r => console.log('[whatsapp-sync/tasks]', contactId, r))
       .catch(err => console.error('[whatsapp-sync/tasks]', contactId, err))
   }
   ```

- [ ] **Step 3: Syntax check**

From `backend/`:
```bash
node --check src/services/whatsappMerge.js && node --check src/routes/whatsappSync.js && echo OK
```
Expected: `OK`

- [ ] **Step 4: Restart the backend and smoke-test**

Stop the process on port 3001 only after confirming its parent command line contains `teacher-crm-worktrees/whatsapp-sync/backend`, then start `node server.js` from `backend/` in the background. Check:
```bash
curl -s http://localhost:3001/api/health
```
Expected: `{"ok":true}`

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/whatsappMerge.js backend/src/routes/whatsappSync.js
git commit -m "WhatsApp sync: extract tasks from newly saved DM messages after responding"
```

---

### Task 7: Contact page — fresh-read toggle + WhatsApp marker

**Files:**
- Modify: `frontend/src/pages/ContactDetail.jsx` (`toggleActionItem` ~line 135; action-item `<li>` ~line 378)

- [ ] **Step 1: Make `toggleActionItem` read fresh metadata**

Replace the whole `toggleActionItem` function with:

```jsx
  async function toggleActionItem(interaction, itemIndex) {
    try {
      // Read the row fresh: a WhatsApp sync may have added messages or tasks to it
      // since this page loaded, and writing page-load metadata back would wipe them.
      const { data: fresh, error: loadErr } = await supabase
        .from('interactions')
        .select('metadata')
        .eq('id', interaction.id)
        .single()
      if (loadErr) throw loadErr
      const items = (fresh.metadata?.action_items || []).map((item, idx) =>
        idx === itemIndex ? { ...item, done: !item.done } : item
      )
      const newMetadata = { ...fresh.metadata, action_items: items }
      const { error } = await supabase
        .from('interactions')
        .update({ metadata: newMetadata })
        .eq('id', interaction.id)
      if (error) throw error
      setInteractions(prev => prev.map(x => (x.id === interaction.id ? { ...x, metadata: newMetadata } : x)))
    } catch (err) {
      alert('שגיאה בעדכון משימה: ' + err.message)
    }
  }
```

- [ ] **Step 2: Add the `💬 date` marker**

In the action-items list, right after the `{item.due_date && ( ... )}` span block inside the `<li>`, add:

```jsx
                                {item.source === 'whatsapp' && item.message_date && (
                                  <span className="text-xs text-gray-400" title="נשאבה מהתכתבות וואטסאפ">
                                    💬 {new Date(item.message_date).toLocaleDateString('he-IL')}
                                  </span>
                                )}
```

- [ ] **Step 3: Build check**

From `frontend/`:
```bash
npx vite build --logLevel error && echo BUILD_OK
```
Expected: `BUILD_OK`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ContactDetail.jsx
git commit -m "Contact page: fresh-read before toggling a task; mark WhatsApp-sourced tasks"
```

---

### Task 8: Dashboard indicator + "המשימות שלי" label

**Files:**
- Modify: `frontend/src/pages/Contacts.jsx` (`loadPendingTasks` ~line 248)
- Modify: `frontend/src/lib/adminTasks.js` (`fetchAdminTasks` mapping ~line 60)
- Modify: `frontend/src/components/AdminTasksPanel.jsx` (~line 270)

- [ ] **Step 1: Count WhatsApp tasks on the dashboard**

In `loadPendingTasks` in `Contacts.jsx`, replace `.eq('type', 'phone_call')` with `.in('type', ['phone_call', 'whatsapp'])`, and change the comment above the function to:
`// Unresolved action items from phone-call voice logs and synced WhatsApp chats — surfaced as a follow-up indicator.`

- [ ] **Step 2: Pass the WhatsApp contact name through `fetchAdminTasks`**

In `frontend/src/lib/adminTasks.js`, in the object built per task (next to `source: row.metadata?.source || null,`), add:

```js
      whatsapp_contact_name: row.metadata?.whatsapp_contact_name || null,
```

- [ ] **Step 3: Label WhatsApp tasks in the panel**

In `AdminTasksPanel.jsx`, replace

```jsx
            {SOURCE_LABEL[task.source] || '🎙 הוקלט'} {new Date(task.created_at).toLocaleDateString('he-IL')}
```

with

```jsx
            {task.source === 'whatsapp'
              ? `💬 וואטסאפ · ${task.whatsapp_contact_name || ''}`
              : (SOURCE_LABEL[task.source] || '🎙 הוקלט')}{' '}
            {new Date(task.created_at).toLocaleDateString('he-IL')}
```

(`created_at` of a WhatsApp admin row is the message date — Task 5.)

- [ ] **Step 4: Build check**

From `frontend/`:
```bash
npx vite build --logLevel error && echo BUILD_OK
```
Expected: `BUILD_OK`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Contacts.jsx frontend/src/lib/adminTasks.js frontend/src/components/AdminTasksPanel.jsx
git commit -m "Dashboard and admin panel: show WhatsApp-sourced tasks"
```

---

### Task 9: End-to-end verification with the owner

No code. Uses the running dev servers (backend restarted in Task 6; Vite picks up frontend changes).

- [ ] **Step 1: Pick a teacher and reset them**

Ask the owner which teacher. Clear that contact's `custom_fields.whatsappLastMessageAt` (clear-cursor script pattern from `docs/history/2026-09-30-whatsapp-voice-sync-handoff.md`) and confirm `lastMessageAt: null` via `GET /api/whatsapp-sync/targets`. The owner deletes that teacher's existing WhatsApp rows from the CRM journal.

- [ ] **Step 2: Owner runs the sync; verify in the DB**

After the sync, the backend log must show `[whatsapp-sync/tasks] <contactId> { teacherTasks: N, adminTasks: M }` (no error). Then, with a script from `backend/`, check:
- the teacher's `whatsapp` DM rows: `metadata.action_items` entries with `source: 'whatsapp'` and a `message_date` equal to the row's Israel day; `tasks_analyzed_at` set on every row the batch touched;
- admin rows: `contains('metadata', { source: 'whatsapp', whatsapp_contact_id: <id> })`, `type: 'journal'`, `created_at` on the message date, one task each.

- [ ] **Step 3: Verify in the UI** (owner, in their logged-in browser)

Contact page shows the tasks under "משימות המשך" with `💬 <date>`; the dashboard shows the open-task indicator for that teacher; "המשימות שלי" shows Avner's tasks labeled `💬 וואטסאפ · <name>` with the message date.

- [ ] **Step 4: Re-sync without clearing**

Owner syncs the same teacher again. Expected: backend log shows the batch with `saved 0` and **no** `[whatsapp-sync/tasks]` line; no new tasks in the DB.

- [ ] **Step 5: Toggle race**

Owner opens the teacher's contact page; clear the cursor and have the owner sync again so messages are re-merged while the page stays open (or send the teacher a new message first); owner ticks a task on the stale page. Verify with a script that the row still holds all its messages and the tick was saved.

- [ ] **Step 6: Report**

Summarize the counts and any wrong teacher/admin assignments the owner spots; prompt tweaks go back to Task 2 (re-run Task 4's dry run).
