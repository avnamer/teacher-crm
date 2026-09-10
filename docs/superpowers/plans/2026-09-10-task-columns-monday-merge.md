# Task Columns + Monday Merge + WhatsApp Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add checkbox-style task columns to the unified teacher table, fold the standalone Monday
challenge page into that table, add a Monday-column management panel, add per-source task
counters, and add a per-teacher WhatsApp task composer.

**Architecture:** Everything lives in the existing single-table column system in
`frontend/src/pages/Contacts.jsx` (columns defined in `settings.contacts_columns`, values in
`contacts.custom_fields`). A new `source: 'task'` column type is added alongside the existing
`core`/`journal`/`custom` sources, tagged `taskSource: 'general' | 'monday'` to keep the two task
kinds distinguishable for stats and column management. No backend or database schema changes —
`custom_fields` is already JSONB and `settings.contacts_columns` is already a flexible JSON array.

**Tech Stack:** React (Vite), Supabase JS client, Tailwind CSS. No test framework exists in this
project (`frontend/package.json` has no test script, no test files anywhere) — verification steps
in this plan are manual (`npm run dev` + check in a browser), matching the project's existing
practice, not automated tests.

**Design doc:** `docs/superpowers/specs/2026-09-10-task-columns-monday-merge-design.md` — read
this first for the "why" behind each decision, especially the two corrections (no live Monday
API, no working WhatsApp send backend) that shape what's in and out of scope here.

---

## File Map

| File | Change |
|---|---|
| `frontend/src/pages/Contacts.jsx` | Core of every task below: column helpers, `DEFAULT_COLUMNS`, `ColumnManagerModal`, table rendering, new stats bar, new per-row/per-column WhatsApp buttons, new modals |
| `frontend/src/pages/WhatsApp.jsx` | `resolveMessage` gets `{{open_tasks}}` support; template variable hint list updated |
| `frontend/src/pages/MondayTasks.jsx` | Deleted (Task 4) |
| `frontend/src/App.jsx` | Remove `/monday` route + import |
| `frontend/src/components/Navbar.jsx` | Remove "משימות Monday" link |

No new files are created — task-specific modals are added as new components inside
`Contacts.jsx`, following the file's existing convention (it already defines `ColumnManagerModal`,
`AddContactModal`, `EditContactModal`, `AddMeetingModal`, `ContactStats`, `PendingTasksBanner` as
same-file components rather than splitting them out).

---

### Task 1: Add the `task` column type to the column-value helpers

**Files:**
- Modify: `frontend/src/pages/Contacts.jsx:44-56` (`getCellValue`, `getEditType`, `formatDisplay`)

- [ ] **Step 1: Add a `task` branch to `getEditType`**

Current code (`Contacts.jsx:49-56`):

```js
function getEditType(col) {
  if (col.source === 'journal') return 'journal'
  if (col.source === 'custom') return 'text'
  if (col.key === 'gender') return 'gender'
  if (col.key === 'hackathon_date' || col.key === 'birthday') return 'date'
  if (col.key === 'email') return 'email'
  return 'text'
}
```

Change to:

```js
function getEditType(col) {
  if (col.source === 'task') return 'task'
  if (col.source === 'journal') return 'journal'
  if (col.source === 'custom') return 'text'
  if (col.key === 'gender') return 'gender'
  if (col.key === 'hackathon_date' || col.key === 'birthday') return 'date'
  if (col.key === 'email') return 'email'
  return 'text'
}
```

- [ ] **Step 2: Make `getCellValue` read task values from `custom_fields`**

Current code (`Contacts.jsx:44-47`):

```js
function getCellValue(contact, col) {
  if (col.source === 'custom') return contact.custom_fields?.[col.key] ?? ''
  return contact[col.key] ?? ''
}
```

Change to:

```js
function getCellValue(contact, col) {
  if (col.source === 'custom' || col.source === 'task') return contact.custom_fields?.[col.key] ?? ''
  return contact[col.key] ?? ''
}
```

- [ ] **Step 3: Add task truthiness helper + `formatDisplay` branch**

Add this helper directly above `formatDisplay` (`Contacts.jsx:58`):

```js
// A task cell counts as "done" for any truthy, non-"לא הוגש" value — this keeps Monday's
// existing 'הוגש' / 'לא הוגש' strings working as the done/not-done signal for Monday task
// columns, while general task columns just store boolean true/false.
function isTaskDone(contact, col) {
  const value = contact.custom_fields?.[col.key]
  return Boolean(value) && value !== 'לא הוגש'
}
```

Then in `formatDisplay`, add a task branch before the journal branch (`Contacts.jsx:58-59`):

```js
function formatDisplay(contact, col, journalMap) {
  if (col.source === 'task') return isTaskDone(contact, col) ? '✓' : ''
  if (col.source === 'journal') {
```

- [ ] **Step 4: Manually verify no regression**

Run: `cd frontend && npm run dev`
Open http://localhost:5173/contacts — the table should render exactly as before (no task
columns exist yet, so `getEditType`/`getCellValue`/`formatDisplay` never hit the new branches).

- [ ] **Step 5: Commit**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" add frontend/src/pages/Contacts.jsx
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" commit -m "$(cat <<'EOF'
Add task column type to Contacts value helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Render task columns as checkboxes in the table body

**Files:**
- Modify: `frontend/src/pages/Contacts.jsx` (`EditableCell` function, currently `Contacts.jsx:657-745`)

- [ ] **Step 1: Add a checkbox branch to `EditableCell`**

`EditableCell` currently always goes through the edit/display toggle built for text-like cells.
Task cells should toggle immediately on click, no separate edit mode. Add this branch as the
**first** check inside the function body, right after the existing `const editType = getEditType(col)`
line (`Contacts.jsx:658`):

```js
function EditableCell({ contact, col, journalMap, isEditing, onStartEdit, onCancel, onSave }) {
  const editType = getEditType(col)

  if (editType === 'task') {
    const done = isTaskDone(contact, col)
    return (
      <button
        onClick={() => onSave(!done)}
        className="w-full flex items-center justify-center py-0.5"
        title={done ? 'לחץ לביטול סימון' : 'לחץ לסימון כבוצע'}
      >
        <span
          className={`w-5 h-5 rounded border flex items-center justify-center text-xs ${
            done ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 text-transparent'
          }`}
        >
          ✓
        </span>
      </button>
    )
  }

  // Journal cells always start blank — writing in them adds a new dated entry, it never edits the last one.
  const rawValue = editType === 'journal' ? '' : getCellValue(contact, col)
```

(The rest of the function is unchanged — `isEditing`/`onStartEdit`/`onCancel` are simply unused
for the task branch, which is fine since it returns early.)

- [ ] **Step 2: Confirm `saveCell` stores booleans correctly**

`saveCell` (`Contacts.jsx:297-315`) already branches on `col.source === 'custom'` to write into
`custom_fields[col.key]`. Task columns need the same branch. Current code:

```js
async function saveCell(contact, col, rawValue) {
  const payload = { custom_fields: { ...(contact.custom_fields || {}), _manual_edit: true } }
  if (col.source === 'custom') {
    payload.custom_fields[col.key] = rawValue
  } else {
    payload[col.key] = rawValue || null
  }
  ...
```

Change the condition to also cover `task`:

```js
  if (col.source === 'custom' || col.source === 'task') {
    payload.custom_fields[col.key] = rawValue
  } else {
```

- [ ] **Step 3: Manually verify**

With `npm run dev` running, temporarily add a task column via the browser once Task 3 below
lands column-manager support — this step is really validated together with Task 3's manual
check. For now, confirm the file still compiles with no console errors (`read_console_messages`
in the browser tool, or just watch the Vite terminal for a successful HMR update).

- [ ] **Step 4: Commit**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" add frontend/src/pages/Contacts.jsx
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" commit -m "$(cat <<'EOF'
Render task columns as checkboxes in the contacts table

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Let the Column Manager create general task columns (Feature 1)

**Files:**
- Modify: `frontend/src/pages/Contacts.jsx` (`ColumnManagerModal`, currently `Contacts.jsx:740-879`)

- [ ] **Step 1: Replace the journal-only checkbox with a 3-way type choice**

Current state in `ColumnManagerModal`: a single `newIsJournal` boolean plus an `addColumn()` that
does `source: newIsJournal ? 'journal' : 'custom'`. Replace with a `newColType` string state.

Replace this line (`Contacts.jsx:743`):

```js
  const [newIsJournal, setNewIsJournal] = useState(false)
```

with:

```js
  const [newColType, setNewColType] = useState('custom') // 'custom' | 'journal' | 'task'
```

- [ ] **Step 2: Update `addColumn`**

Current code (`Contacts.jsx:763-773`):

```js
  function addColumn() {
    const label = newLabel.trim()
    if (!label) return
    if (local.some(c => c.label === label)) {
      alert('כבר קיימת עמודה בשם הזה')
      return
    }
    setLocal([...local, { key: label, label, source: newIsJournal ? 'journal' : 'custom', visible: true, locked: false }])
    setNewLabel('')
    setNewIsJournal(false)
  }
```

Change to:

```js
  function addColumn() {
    const label = newLabel.trim()
    if (!label) return
    if (local.some(c => c.label === label)) {
      alert('כבר קיימת עמודה בשם הזה')
      return
    }
    const base = { key: label, label, visible: true, locked: false }
    const col = newColType === 'task'
      ? { ...base, source: 'task', taskSource: 'general' }
      : { ...base, source: newColType }
    setLocal([...local, col])
    setNewLabel('')
    setNewColType('custom')
  }
```

- [ ] **Step 3: Replace the journal checkbox UI with a 3-way radio group**

Current UI (`Contacts.jsx:853-861`):

```jsx
          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={newIsJournal}
              onChange={e => setNewIsJournal(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            עמודת יומן / אירועים — כל כתיבה נשמרת כרשומה חדשה עם תאריך ושעה, במקום להחליף את הקודמת
          </label>
```

Replace with:

```jsx
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input type="radio" name="newColType" checked={newColType === 'custom'}
                onChange={() => setNewColType('custom')} className="w-3.5 h-3.5" />
              טקסט רגיל
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
              <input type="radio" name="newColType" checked={newColType === 'journal'}
                onChange={() => setNewColType('journal')} className="w-3.5 h-3.5" />
              עמודת יומן / אירועים — כל כתיבה נשמרת כרשומה חדשה עם תאריך ושעה, במקום להחליף את הקודמת
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
              <input type="radio" name="newColType" checked={newColType === 'task'}
                onChange={() => setNewColType('task')} className="w-3.5 h-3.5" />
              עמודת משימה — תיבת סימון (✓) לכל מורה
            </label>
          </div>
```

- [ ] **Step 4: Show a "(משימה)" tag next to task columns in the column list**

In the existing list rendering (`Contacts.jsx:818-823`), add a task branch next to the existing
`custom`/`journal` tags:

```jsx
                {col.source === 'custom' && (
                  <span className="text-xs text-gray-400">(מותאם אישית)</span>
                )}
                {col.source === 'journal' && (
                  <span className="text-xs text-blue-400">(יומן/אירועים)</span>
                )}
                {col.source === 'task' && col.taskSource === 'general' && (
                  <span className="text-xs text-purple-400">(משימה)</span>
                )}
                {col.source === 'task' && col.taskSource === 'monday' && (
                  <span className="text-xs text-orange-400">(משימת Monday)</span>
                )}
```

- [ ] **Step 5: Allow removing task columns the same way as custom/journal**

Current remove-button condition (`Contacts.jsx:825`):

```jsx
              {(col.source === 'custom' || col.source === 'journal') && (
```

Change to:

```jsx
              {(col.source === 'custom' || col.source === 'journal' || col.source === 'task') && (
```

- [ ] **Step 6: Manually verify in the browser**

1. Start the app via the `run-teacher-crm` skill (or `npm run dev` in both `frontend/` and
   `backend/` if already running).
2. Open http://localhost:5173/contacts, click "⚙️ עמודות".
3. Type a label (e.g. "שלח מייל פתיחה"), select "עמודת משימה", click "+ הוסף", click "שמור".
4. Confirm a new column appears in the table header, and clicking a cell under it toggles a green
   checkmark, persisting after a page refresh.

- [ ] **Step 7: Commit**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" add frontend/src/pages/Contacts.jsx
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" commit -m "$(cat <<'EOF'
Let the column manager create general task columns

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Add Monday task columns to defaults, delete the standalone Monday page (Feature 2)

**Files:**
- Modify: `frontend/src/pages/Contacts.jsx` (`DEFAULT_COLUMNS`, `Contacts.jsx:10-20`)
- Delete: `frontend/src/pages/MondayTasks.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/Navbar.jsx`

- [ ] **Step 1: Add the 3 Monday task columns to `DEFAULT_COLUMNS`**

Current (`Contacts.jsx:10-20`):

```js
const DEFAULT_COLUMNS = [
  { key: 'name', label: 'שם', source: 'core', visible: true, locked: true, width: 180 },
  { key: 'phone', label: 'טלפון', source: 'core', visible: true, locked: false, width: 140 },
  { key: 'school', label: 'בית ספר', source: 'core', visible: true, locked: false, width: 240 },
  { key: 'gender', label: 'מגדר', source: 'core', visible: true, locked: false, width: 90 },
  { key: 'hackathon_date', label: 'מועד אקתון', source: 'core', visible: true, locked: false, width: 130 },
  { key: 'email', label: 'מייל', source: 'core', visible: false, locked: false, width: 200 },
  { key: 'class_name', label: 'כיתה', source: 'core', visible: false, locked: false, width: 90 },
  { key: 'birthday', label: 'יום הולדת', source: 'core', visible: false, locked: false, width: 130 },
  { key: 'last_contact_journal', label: 'יומן קשר אחרון', source: 'journal', visible: true, locked: false, width: 220 },
]
```

Add three entries at the end (keys match the existing `custom_fields.challenge1/2/3` used by
`MondayTasks.jsx` today, so existing data appears immediately with no migration):

```js
const DEFAULT_COLUMNS = [
  { key: 'name', label: 'שם', source: 'core', visible: true, locked: true, width: 180 },
  { key: 'phone', label: 'טלפון', source: 'core', visible: true, locked: false, width: 140 },
  { key: 'school', label: 'בית ספר', source: 'core', visible: true, locked: false, width: 240 },
  { key: 'gender', label: 'מגדר', source: 'core', visible: true, locked: false, width: 90 },
  { key: 'hackathon_date', label: 'מועד אקתון', source: 'core', visible: true, locked: false, width: 130 },
  { key: 'email', label: 'מייל', source: 'core', visible: false, locked: false, width: 200 },
  { key: 'class_name', label: 'כיתה', source: 'core', visible: false, locked: false, width: 90 },
  { key: 'birthday', label: 'יום הולדת', source: 'core', visible: false, locked: false, width: 130 },
  { key: 'last_contact_journal', label: 'יומן קשר אחרון', source: 'journal', visible: true, locked: false, width: 220 },
  { key: 'challenge1', label: 'אתגר 1', source: 'task', taskSource: 'monday', visible: true, locked: false, width: 90 },
  { key: 'challenge2', label: 'אתגר 2', source: 'task', taskSource: 'monday', visible: true, locked: false, width: 90 },
  { key: 'challenge3', label: 'אתגר 3', source: 'task', taskSource: 'monday', visible: true, locked: false, width: 90 },
]
```

`loadColumns()` (`Contacts.jsx:255-274`) already merges any `DEFAULT_COLUMNS` entry missing from
a saved `settings.contacts_columns` into the loaded list — no further change needed for existing
users to pick these up automatically.

- [ ] **Step 2: Delete the standalone Monday page**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" rm frontend/src/pages/MondayTasks.jsx
```

- [ ] **Step 3: Remove the route from `App.jsx`**

Remove line 12 (`import MondayTasks from './pages/MondayTasks.jsx'`) and line 33
(`<Route path="/monday" element={<MondayTasks />} />`) from `frontend/src/App.jsx`.

- [ ] **Step 4: Remove the nav link from `Navbar.jsx`**

Remove this line from the `links` array in `frontend/src/components/Navbar.jsx:12`:

```js
  { to: '/monday', label: 'משימות Monday', icon: '📋' },
```

- [ ] **Step 5: Confirm no other reference to `/monday` or `MondayTasks` remains**

```bash
grep -rn "MondayTasks\|/monday" "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm/frontend/src"
```

Expected: no output.

- [ ] **Step 6: Manually verify**

1. `npm run dev` (frontend), confirm the app builds with no import errors.
2. Confirm "/monday" is gone from the navbar (desktop and mobile).
3. Navigate to http://localhost:5173/monday directly — should hit the `NotFound` page.
4. On `/contacts`, confirm "אתגר 1/2/3" columns are visible with existing challenge data shown
   as checkmarks (for teachers who have `custom_fields.challenge1 === 'הוגש'` etc.).

- [ ] **Step 7: Commit**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" add -A frontend/src
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" commit -m "$(cat <<'EOF'
Merge Monday challenge page into the unified teacher table

Adds challenge1/2/3 as Monday task columns in the contacts table and
removes the standalone /monday page, route, and nav link.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Monday column management panel (Feature 3)

**Files:**
- Modify: `frontend/src/pages/Contacts.jsx` (new `MondayColumnsModal` component, toolbar button, state)

This panel manages **column metadata only** — no live Monday API call exists or is added (see
design doc). It lets the user add/rename/remove `taskSource: 'monday'` columns, and documents
the `custom_fields` key contract for future agent-run syncs.

- [ ] **Step 1: Add toolbar state and button**

In the `Contacts` component, add state next to `showColumnManager` (`Contacts.jsx:88`):

```js
  const [showColumnManager, setShowColumnManager] = useState(false)
  const [showMondayColumns, setShowMondayColumns] = useState(false)
```

Add a button next to the existing "⚙️ עמודות" button (`Contacts.jsx:353-358`):

```jsx
          <button
            onClick={() => setShowColumnManager(true)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors border border-gray-300"
          >
            ⚙️ עמודות
          </button>
          <button
            onClick={() => setShowMondayColumns(true)}
            className="px-4 py-2 bg-orange-50 text-orange-700 rounded-lg text-sm hover:bg-orange-100 transition-colors border border-orange-200"
          >
            🔄 עמודות Monday
          </button>
```

- [ ] **Step 2: Render the modal**

Next to the existing `ColumnManagerModal` render block (`Contacts.jsx:515-522`):

```jsx
      {showMondayColumns && (
        <MondayColumnsModal
          columns={columns}
          onClose={() => setShowMondayColumns(false)}
          onSave={saveColumns}
        />
      )}
```

- [ ] **Step 3: Implement `MondayColumnsModal`**

Add this component next to `ColumnManagerModal` in `Contacts.jsx`:

```jsx
function MondayColumnsModal({ columns, onClose, onSave }) {
  const [local, setLocal] = useState(columns)
  const [newLabel, setNewLabel] = useState('')
  const [saving, setSaving] = useState(false)

  const mondayCols = local.filter(c => c.source === 'task' && c.taskSource === 'monday')

  function slugify(label) {
    return label.trim().toLowerCase().replace(/\s+/g, '_')
  }

  function addColumn() {
    const label = newLabel.trim()
    if (!label) return
    const key = slugify(label)
    if (local.some(c => c.key === key)) {
      alert('כבר קיימת עמודת Monday עם המזהה הזה')
      return
    }
    setLocal([...local, { key, label, source: 'task', taskSource: 'monday', visible: true, locked: false }])
    setNewLabel('')
  }

  function renameColumn(key, label) {
    setLocal(local.map(c => (c.key === key ? { ...c, label } : c)))
  }

  function removeColumn(key) {
    if (!confirm('להסיר את עמודת ה-Monday? הנתונים הקיימים לא יימחקו, רק יוסתרו.')) return
    setLocal(local.filter(c => c.key !== key))
  }

  async function handleSave() {
    setSaving(true)
    await onSave(local)
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-2">עמודות Monday</h2>
        <p className="text-xs text-gray-500 mb-4">
          אין חיבור חי ל-API של Monday (אין הרשאת ניהול לבורד). כאן אפשר לנהל אילו עמודות Monday
          קיימות ומוצגות בטבלה. העדכון בפועל של הנתונים נעשה כשמבקשים מקלוד קוד להריץ סנכרון
          (סקיל monday-integration) — הוא כותב ישירות לתוך Supabase לפי המפתחות (keys) שמוגדרים
          כאן.
        </p>

        <div className="space-y-1 mb-6">
          {mondayCols.length === 0 && (
            <p className="text-xs text-gray-400 py-2">אין עמודות Monday מוגדרות</p>
          )}
          {mondayCols.map(col => (
            <div key={col.key} className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-100">
              <input
                value={col.label}
                onChange={e => renameColumn(col.key, e.target.value)}
                className="flex-1 px-2 py-1 border rounded text-sm outline-none"
              />
              <code className="text-xs text-gray-400" dir="ltr">{col.key}</code>
              <button onClick={() => removeColumn(col.key)} className="text-red-400 hover:text-red-600 text-xs">
                הסר
              </button>
            </div>
          ))}
        </div>

        <div className="mb-6 flex gap-2">
          <input
            placeholder="שם עמודת Monday חדשה"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addColumn()}
            className="flex-1 px-3 py-2 border rounded-lg outline-none text-sm"
          />
          <button onClick={addColumn} className="px-3 py-2 bg-orange-600 text-white rounded-lg text-sm hover:bg-orange-700">
            + הוסף
          </button>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'שומר...' : 'שמור'}
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
            ביטול
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Manually verify**

1. `npm run dev`, open `/contacts`, click "🔄 עמודות Monday".
2. Confirm the 3 existing challenge columns are listed.
3. Add a new one (e.g. label "אתגר 4"), save, confirm it appears (unchecked) as a new column in
   the table for every teacher.
4. Rename a column's label, save, confirm the table header updates.
5. Remove the newly added one, save, confirm it disappears from the table (data preserved —
   re-add a column with the same key to confirm old value still comes back, matching the
   existing "remove = hide" behavior other column types already have).

- [ ] **Step 5: Commit**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" add frontend/src/pages/Contacts.jsx
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" commit -m "$(cat <<'EOF'
Add Monday column management panel

Metadata-only panel (no live API) for adding/renaming/removing
Monday-sourced task columns; actual data still comes from agent-run
syncs via the monday-integration skill.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Per-source task counters (Feature 4)

**Files:**
- Modify: `frontend/src/pages/Contacts.jsx` (new `TaskStats` component + render call)

- [ ] **Step 1: Compute per-source totals in the `Contacts` component**

Add this right after the existing `myTeachers`/`buckets` computation (`Contacts.jsx:331-333`):

```js
  const myTeachers = contacts.filter(isMyTeacher)
  const buckets = { green: [], orange: [], red: [] }
  for (const t of myTeachers) buckets[contactBucket(t, lastContactMap)].push(t)

  const taskColumns = columns.filter(c => c.source === 'task')
  const taskStats = ['monday', 'general'].map(taskSource => {
    const cols = taskColumns.filter(c => c.taskSource === taskSource)
    let done = 0
    let total = 0
    for (const teacher of myTeachers) {
      for (const col of cols) {
        total += 1
        if (isTaskDone(teacher, col)) done += 1
      }
    }
    return { taskSource, done, total }
  })
```

- [ ] **Step 2: Render a `TaskStats` bar above the table**

Add the component call right after `<PendingTasksBanner ... />` (`Contacts.jsx:343-348`):

```jsx
      <PendingTasksBanner
        pendingTasksMap={pendingTasksMap}
        contacts={contacts}
        expanded={pendingTasksExpanded}
        onToggle={() => setPendingTasksExpanded(!pendingTasksExpanded)}
      />

      <TaskStats stats={taskStats} />
```

- [ ] **Step 3: Implement `TaskStats`**

Add next to `ContactStats` in `Contacts.jsx`:

```jsx
// ─── Per-source task counters ─────────────────────────────────────
const TASK_STAT_LABELS = { monday: 'משימות Monday', general: 'משימות כלליות' }

function TaskStats({ stats }) {
  const visible = stats.filter(s => s.total > 0)
  if (visible.length === 0) return null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {visible.map(s => {
        const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0
        return (
          <div key={s.taskSource} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-gray-700">{TASK_STAT_LABELS[s.taskSource]}</span>
              <span className="text-sm text-gray-500">{s.done} / {s.total}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Manually verify**

1. `npm run dev`, open `/contacts`.
2. Confirm a stats bar appears above the table showing "משימות Monday: X / Y" and
   "משימות כלליות: X / Y" (using the task columns from Tasks 3–4).
3. Toggle a checkbox in the table, confirm the corresponding counter updates immediately
   (state is already local `contacts` array updated by `saveCell`, so this should be automatic —
   verify it actually re-renders).

- [ ] **Step 5: Commit**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" add frontend/src/pages/Contacts.jsx
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" commit -m "$(cat <<'EOF'
Add per-source task counters above the contacts table

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `{{open_tasks}}` template placeholder (foundation for Feature 5)

**Files:**
- Modify: `frontend/src/pages/WhatsApp.jsx` (`resolveMessage`, template variable hint list)

- [ ] **Step 1: Extend `resolveMessage`**

Current (`WhatsApp.jsx:178-187`):

```js
function resolveMessage(body, contact) {
  const firstName = contact.name?.split(' ')[0] || ''
  return body
    .replace(/\{\{name\}\}/g, firstName)
    .replace(/\{\{school\}\}/g, contact.school || '')
    .replace(/\{\{class_name\}\}/g, contact.class_name || '')
    .replace(/\{\{hackathon_date\}\}/g, contact.hackathon_date
      ? new Date(contact.hackathon_date).toLocaleDateString('he-IL') : '')
    .replace(/\{\{phone\}\}/g, contact.phone || '')
}
```

Change to:

```js
function resolveMessage(body, contact) {
  const firstName = contact.name?.split(' ')[0] || ''
  return body
    .replace(/\{\{name\}\}/g, firstName)
    .replace(/\{\{school\}\}/g, contact.school || '')
    .replace(/\{\{class_name\}\}/g, contact.class_name || '')
    .replace(/\{\{hackathon_date\}\}/g, contact.hackathon_date
      ? new Date(contact.hackathon_date).toLocaleDateString('he-IL') : '')
    .replace(/\{\{phone\}\}/g, contact.phone || '')
    .replace(/\{\{open_tasks\}\}/g, contact._open_tasks_text || '')
}
```

`contact._open_tasks_text` is a transient field, set only on the single preset contact object
when the per-teacher composer (Task 8) opens `BulkSendModal` — it never touches the database.

- [ ] **Step 2: Export `resolveMessage` for reuse**

Currently `resolveMessage` is a private function in `WhatsApp.jsx`, used only inside that file.
Task 8 needs to build preview text from the same logic. Add it to the existing export line
(`WhatsApp.jsx:546`):

Current:

```js
export { BulkSendModal }
```

Change to:

```js
export { BulkSendModal, resolveMessage }
```

- [ ] **Step 3: Add `{{open_tasks}}` to the template variable hint list**

Current (`WhatsApp.jsx:151`):

```jsx
          {['{{name}}', '{{school}}', '{{class_name}}', '{{hackathon_date}}', '{{phone}}'].map(v => (
```

Change to:

```jsx
          {['{{name}}', '{{school}}', '{{class_name}}', '{{hackathon_date}}', '{{phone}}', '{{open_tasks}}'].map(v => (
```

- [ ] **Step 4: Manually verify**

1. `npm run dev`, open `/whatsapp`, confirm `{{open_tasks}}` now shows in the "משתנים זמינים
   בתבניות" list.
2. No behavior change yet for existing templates (empty string substitution when
   `_open_tasks_text` is undefined) — confirm existing bulk-send preview (step 3 of
   `BulkSendModal`) still renders unchanged for a template that doesn't use `{{open_tasks}}`.

- [ ] **Step 5: Commit**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" add frontend/src/pages/WhatsApp.jsx
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" commit -m "$(cat <<'EOF'
Add {{open_tasks}} template placeholder

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Per-teacher WhatsApp task composer (Feature 5, per-row)

**Files:**
- Modify: `frontend/src/pages/Contacts.jsx` (import `BulkSendModal`/`resolveMessage`, new
  `TaskComposerModal` component, per-row button, state)

- [ ] **Step 1: Import the pieces from `WhatsApp.jsx`**

Add to the top of `Contacts.jsx` (near the existing imports, `Contacts.jsx:1-3`):

```js
import { BulkSendModal } from './WhatsApp.jsx'
```

(`resolveMessage` from Task 7 is used inside the new `TaskComposerModal`, not directly in
`Contacts`, so only `BulkSendModal` needs importing at the top level.)

- [ ] **Step 2: Add composer state and load message templates**

Add state next to `showMondayColumns` (from Task 5):

```js
  const [taskComposerTeacher, setTaskComposerTeacher] = useState(null) // contact | null
  const [templates, setTemplates] = useState([])
```

Add a template-loading effect next to the existing `useEffect(() => { loadContacts(); loadColumns() }, [])` (`Contacts.jsx:97-100`):

```js
  useEffect(() => {
    supabase.from('message_templates').select('*').order('created_at', { ascending: false })
      .then(({ data }) => setTemplates(data || []))
  }, [])
```

- [ ] **Step 3: Add the "📲" button to each row's action cell**

Current action cell (`Contacts.jsx:487-506`):

```jsx
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <button
                        onClick={() => setEditContact(contact)}
                        className="text-blue-500 hover:text-blue-700 text-xs ml-2"
                      >
                        ערוך
                      </button>
                      <button
                        onClick={() => deleteContact(contact.id)}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >
                        מחק
                      </button>
                    </td>
```

Add the composer button:

```jsx
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <button
                        onClick={() => setTaskComposerTeacher(contact)}
                        className="text-green-600 hover:text-green-800 text-xs ml-2"
                        title="שלח תזכורת משימות ב-WhatsApp"
                      >
                        📲
                      </button>
                      <button
                        onClick={() => setEditContact(contact)}
                        className="text-blue-500 hover:text-blue-700 text-xs ml-2"
                      >
                        ערוך
                      </button>
                      <button
                        onClick={() => deleteContact(contact.id)}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >
                        מחק
                      </button>
                    </td>
```

- [ ] **Step 4: Render `TaskComposerModal`**

Add near the other modal renders, after the `MondayColumnsModal` block from Task 5:

```jsx
      {taskComposerTeacher && (
        <TaskComposerModal
          teacher={taskComposerTeacher}
          taskColumns={columns.filter(c => c.source === 'task')}
          templates={templates}
          onClose={() => setTaskComposerTeacher(null)}
        />
      )}
```

- [ ] **Step 5: Implement `TaskComposerModal`**

Add this component in `Contacts.jsx` (near `ColumnManagerModal`), importing `resolveMessage`:

First, update the Task 7 import at the top of the file to include it:

```js
import { BulkSendModal, resolveMessage } from './WhatsApp.jsx'
```

Then add:

```jsx
// ─── Per-teacher WhatsApp task composer ───────────────────────────
const TASK_SOURCE_LABEL = { monday: 'Monday', general: 'כללי' }

function TaskComposerModal({ teacher, taskColumns, templates, onClose }) {
  const openTasks = taskColumns.filter(col => !isTaskDone(teacher, col))
  const [selectedKeys, setSelectedKeys] = useState(() => new Set(openTasks.map(c => c.key)))
  const [sending, setSending] = useState(false)

  function toggle(key) {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectedLabels = taskColumns
    .filter(col => selectedKeys.has(col.key))
    .map(col => `${col.label} (${TASK_SOURCE_LABEL[col.taskSource]})`)

  const openTasksText = selectedLabels.length > 0
    ? selectedLabels.map(l => `- ${l}`).join('\n')
    : ''

  if (sending) {
    const presetContact = { ...teacher, _open_tasks_text: openTasksText }
    return (
      <TaskComposerSendStep
        teacher={presetContact}
        templates={templates}
        onClose={onClose}
      />
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-1">משימות פתוחות — {teacher.name}</h2>
        <p className="text-xs text-gray-500 mb-4">בחר אילו משימות לכלול בהודעת התזכורת</p>

        {openTasks.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">אין משימות פתוחות למורה זה 🎉</p>
        ) : (
          <div className="space-y-1 mb-6">
            {openTasks.map(col => (
              <label key={col.key} className="flex items-center gap-2 py-1.5 border-b border-gray-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedKeys.has(col.key)}
                  onChange={() => toggle(col.key)}
                  className="w-4 h-4"
                />
                <span className="text-sm">{col.label}</span>
                <span className="text-xs text-gray-400">({TASK_SOURCE_LABEL[col.taskSource]})</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button
            onClick={() => setSending(true)}
            disabled={selectedLabels.length === 0 || templates.length === 0}
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            title={templates.length === 0 ? 'צור תבנית הודעה תחילה בדף WhatsApp' : ''}
          >
            המשך לשליחה
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
            ביטול
          </button>
        </div>
      </div>
    </div>
  )
}

function TaskComposerSendStep({ teacher, templates, onClose }) {
  return (
    <BulkSendModalWithPresetContact
      contact={teacher}
      templates={templates}
      onClose={onClose}
    />
  )
}
```

`BulkSendModal` (imported from `WhatsApp.jsx`) loads its preset contacts by re-querying Supabase
with `.in('id', initialContactIds)` (`WhatsApp.jsx:227-242`), which would **lose** the transient
`_open_tasks_text` field we just attached client-side. Add one more small wrapper to carry it
through:

- [ ] **Step 6: Add `BulkSendModalWithPresetContact`**

```jsx
// BulkSendModal reloads preset contacts from Supabase by id, which would drop the transient
// _open_tasks_text field — this wrapper re-attaches it after that reload finishes, by patching
// the DOM-invisible resolveMessage call path via a monkey-patched contact list is not possible
// from outside, so instead we pass a single-contact array directly as `presetContacts` here.
function BulkSendModalWithPresetContact({ contact, templates, onClose }) {
  return (
    <BulkSendModal
      templates={templates}
      backendStatus="disconnected"
      initialContactIds={[contact.id]}
      presetContactOverride={contact}
      onClose={onClose}
    />
  )
}
```

This requires `BulkSendModal` itself to accept and apply a `presetContactOverride` prop — that's
Task 9's job (kept separate so this task's diff stays reviewable on its own). For now, wire it
through as a no-op prop; Task 9 makes it work.

- [ ] **Step 7: Manually verify (partial — full flow verified after Task 9)**

1. `npm run dev`, open `/contacts`.
2. Click "📲" on a teacher row with at least one open task.
3. Confirm the modal lists their open tasks (correctly excluding any already-checked ones),
   selection checkboxes work, and "המשך לשליחה" is disabled until at least one task is selected
   and at least one template exists.
4. Confirm clicking "ביטול" closes the modal without side effects.

- [ ] **Step 8: Commit**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" add frontend/src/pages/Contacts.jsx
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" commit -m "$(cat <<'EOF'
Add per-teacher WhatsApp task composer modal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Wire `presetContactOverride` into `BulkSendModal` + generalized bulk reminders (Feature 5, bulk)

**Files:**
- Modify: `frontend/src/pages/WhatsApp.jsx` (`BulkSendModal` accepts `presetContactOverride`)
- Modify: `frontend/src/pages/Contacts.jsx` (column-header bulk reminder button + state)

- [ ] **Step 1: Make `BulkSendModal` accept a preset contact override**

Current signature and preset-loading function (`WhatsApp.jsx:189, 227-242`):

```js
function BulkSendModal({ templates, backendStatus, onClose, initialContactIds = null }) {
  ...
  async function loadPresetContacts() {
    setLoadingContacts(true)
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .in('id', initialContactIds)
      if (error) throw error
      setAllContacts(data || [])
      setFilteredContacts(data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingContacts(false)
    }
  }
```

Change to:

```js
function BulkSendModal({ templates, backendStatus, onClose, initialContactIds = null, presetContactOverride = null }) {
  ...
  async function loadPresetContacts() {
    setLoadingContacts(true)
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .in('id', initialContactIds)
      if (error) throw error
      // presetContactOverride carries transient client-only fields (e.g. _open_tasks_text) that
      // don't exist in the database — merge it onto the matching loaded row so resolveMessage
      // can see them, without persisting anything.
      const merged = (data || []).map(c =>
        presetContactOverride && c.id === presetContactOverride.id ? { ...c, ...presetContactOverride } : c
      )
      setAllContacts(merged)
      setFilteredContacts(merged)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingContacts(false)
    }
  }
```

- [ ] **Step 2: Update `MondayTasks.jsx`'s old callers — N/A, already deleted in Task 4**

No action — `MondayTasks.jsx` no longer exists, so no other caller needs updating. The only
other `BulkSendModal` caller is `WhatsApp.jsx`'s own "📤 שלח לקבוצה" button, which passes no
`initialContactIds`/`presetContactOverride` and is unaffected.

- [ ] **Step 3: Add a generalized bulk-reminder button to every task column header**

In `Contacts.jsx`, add state for the bulk-reminder flow next to `taskComposerTeacher`:

```js
  const [bulkReminderCol, setBulkReminderCol] = useState(null) // column | null
```

In the table header rendering (`Contacts.jsx:431-444`), add a button for task columns:

Current:

```jsx
                  {visibleColumns.map(col => (
                    <th
                      key={col.key}
                      className="relative text-right px-4 py-3 font-medium text-gray-600 whitespace-nowrap overflow-hidden text-ellipsis"
                      style={{ width: col.width || DEFAULT_WIDTH }}
                    >
                      {col.label}
                      <span
                        onMouseDown={e => startResize(col.key, e)}
                        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400 active:bg-blue-500"
                        title="גרור לשינוי רוחב"
                      />
                    </th>
                  ))}
```

Change to:

```jsx
                  {visibleColumns.map(col => (
                    <th
                      key={col.key}
                      className="relative text-right px-4 py-3 font-medium text-gray-600 whitespace-nowrap overflow-hidden text-ellipsis"
                      style={{ width: col.width || DEFAULT_WIDTH }}
                    >
                      {col.label}
                      {col.source === 'task' && (
                        <button
                          onClick={() => setBulkReminderCol(col)}
                          className="mr-1 text-green-600 hover:text-green-800"
                          title="שלח תזכורת לכל מי שלא סימן"
                        >
                          📲
                        </button>
                      )}
                      <span
                        onMouseDown={e => startResize(col.key, e)}
                        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400 active:bg-blue-500"
                        title="גרור לשינוי רוחב"
                      />
                    </th>
                  ))}
```

- [ ] **Step 4: Render the bulk-reminder `BulkSendModal`**

Add near the other modal renders in `Contacts.jsx`:

```jsx
      {bulkReminderCol && (() => {
        const notDone = myTeachers.filter(t => !isTaskDone(t, bulkReminderCol)).map(t => t.id)
        if (notDone.length === 0) {
          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl p-8 text-center space-y-3 max-w-sm w-full">
                <p className="text-lg font-medium">🎉 כולם סימנו את "{bulkReminderCol.label}"</p>
                <button onClick={() => setBulkReminderCol(null)} className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm">
                  סגור
                </button>
              </div>
            </div>
          )
        }
        if (templates.length === 0) {
          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl p-8 text-center space-y-3 max-w-sm w-full">
                <p className="text-lg font-medium">אין תבניות הודעה</p>
                <p className="text-sm text-gray-500">צור תבנית תחילה בדף WhatsApp</p>
                <button onClick={() => setBulkReminderCol(null)} className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm">
                  סגור
                </button>
              </div>
            </div>
          )
        }
        return (
          <BulkSendModal
            templates={templates}
            backendStatus="disconnected"
            initialContactIds={notDone}
            onClose={() => setBulkReminderCol(null)}
          />
        )
      })()}
```

- [ ] **Step 5: Manually verify the full Feature 5 flow end to end**

1. `npm run dev`, open `/contacts`.
2. Click the "📲" in a task column header — confirm it opens `BulkSendModal` preset with exactly
   the teachers who haven't checked that column, and that step 3's preview renders correctly for
   each.
3. Click a teacher row's "📲" button, select some open tasks, click "המשך לשליחה" — confirm it
   opens `BulkSendModal` for just that teacher, and if the chosen template contains
   `{{open_tasks}}`, confirm the step-3 preview shows the selected task labels as a bulleted
   list. (Create a throwaway template containing `{{open_tasks}}` on `/whatsapp` first if none
   exists yet.)
4. Confirm clicking "שלח עכשיו" behaves exactly as it does today elsewhere in the app (i.e. it
   attempts the network call and fails/no-ops the same way, since the backend route doesn't
   exist — this is expected and out of scope per the design doc).

- [ ] **Step 6: Commit**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" add frontend/src/pages/WhatsApp.jsx frontend/src/pages/Contacts.jsx
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" commit -m "$(cat <<'EOF'
Wire preset-contact override and generalize bulk task reminders

Any task column (Monday or general) now gets a header button to
remind everyone who hasn't completed it, matching what the old
Monday-only challenge tiles used to do.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Final pass — remove now-dead code paths, full manual regression check

**Files:**
- Review: `frontend/src/pages/Contacts.jsx`, `frontend/src/pages/WhatsApp.jsx`

- [ ] **Step 1: Simplify `TaskComposerModal`/`TaskComposerSendStep`**

Task 8 introduced `TaskComposerSendStep` as a thin pass-through wrapper purely to keep that
task's diff self-contained. Now that Task 9 has made `presetContactOverride` real, inline it to
avoid an unnecessary extra component layer. In `Contacts.jsx`, replace:

```jsx
  if (sending) {
    const presetContact = { ...teacher, _open_tasks_text: openTasksText }
    return (
      <TaskComposerSendStep
        teacher={presetContact}
        templates={templates}
        onClose={onClose}
      />
    )
  }
```

with:

```jsx
  if (sending) {
    const presetContact = { ...teacher, _open_tasks_text: openTasksText }
    return (
      <BulkSendModal
        templates={templates}
        backendStatus="disconnected"
        initialContactIds={[presetContact.id]}
        presetContactOverride={presetContact}
        onClose={onClose}
      />
    )
  }
```

And delete the now-unused `TaskComposerSendStep` and `BulkSendModalWithPresetContact` component
definitions entirely.

- [ ] **Step 2: Confirm `resolveMessage` import is actually used**

`resolveMessage` was imported into `Contacts.jsx` in Task 8 but never directly called there (the
placeholder resolution happens inside `BulkSendModal`, in `WhatsApp.jsx`). Remove it from the
`Contacts.jsx` import line:

```js
import { BulkSendModal } from './WhatsApp.jsx'
```

- [ ] **Step 3: Run the linter**

```bash
cd "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm/frontend" && npm run lint
```

Fix any errors surfaced (expect none beyond what Steps 1–2 already cleaned up — unused-import
and unused-variable rules are the most likely ones to fire given the deleted wrapper components).

- [ ] **Step 4: Full manual regression pass**

Using the `run-teacher-crm` skill to start both servers, walk through:
1. `/contacts` — add a general task column, toggle it, confirm counters (Task 6) update.
2. `/contacts` — confirm the 3 Monday columns show existing data correctly.
3. `⚙️ עמודות` — confirm existing text/journal columns still add/reorder/resize/hide correctly
   (no regression from the 3-way radio change in Task 3).
4. `🔄 עמודות Monday` — add/rename/remove a Monday column.
5. Per-row `📲` and per-column-header `📲` — both open `BulkSendModal` with the right preset
   contacts.
6. `/whatsapp` — confirm the page itself (templates CRUD, "📤 שלח לקבוצה") is unaffected.
7. Confirm `/monday` 404s and no navbar link remains.

- [ ] **Step 5: Commit**

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" add frontend/src/pages/Contacts.jsx
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" commit -m "$(cat <<'EOF'
Clean up task-composer wrapper components after preset-override wiring

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** Feature 1 → Tasks 1–3. Feature 2 → Task 4. Feature 3 → Task 5. Feature 4 →
  Task 6. Feature 5 → Tasks 7–9 (placeholder, per-row composer, bulk header button). Cleanup →
  Task 10.
- **No placeholders:** every step above shows exact before/after code, not descriptions.
- **Type/name consistency check:** `isTaskDone(contact, col)` (defined Task 1) is used
  identically in Tasks 2, 6, 8, 9. `taskSource` values are `'general' | 'monday'` everywhere they
  appear (Tasks 1, 3, 4, 5, 6, 8, 9) — no drift. `_open_tasks_text` is the one transient field
  name, used consistently in Tasks 7–10.
