# Mentors Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/mentors` page to the Teacher CRM listing mentors (name, coordinator/רכז, phone, email) with add/edit/delete, backed by a new Supabase `mentors` table.

**Architecture:** Follows the existing `Contacts.jsx` pattern — a single page component that talks directly to Supabase from the frontend (no backend route), with a shared `MentorModal` component (driven by `title`/`initial`/`onSubmit` props) in the same file, used for both add and edit. New nav entry and route wire it into the existing `Layout`.

**Tech Stack:** React 19 + react-router-dom 7, Supabase JS client (anon key, no auth), Tailwind CSS. No test framework exists in this project (no jest/vitest, no existing test files) — verification steps in this plan are manual (dev server + browser + Supabase check), matching the codebase's existing convention.

**Spec:** `docs/superpowers/specs/2026-09-03-mentors-page-design.md`

---

## File Structure

- **Modify:** `supabase-setup.sql` — append the new `mentors` table, its `updated_at` trigger, and its RLS policy (table 8, following the numbering already used for tables 1–7).
- **Create:** `frontend/src/pages/Mentors.jsx` — the page component (list, search, add/edit modals, delete), mirroring `frontend/src/pages/Contacts.jsx`.
- **Modify:** `frontend/src/App.jsx` — import `Mentors` and add its route.
- **Modify:** `frontend/src/components/Navbar.jsx` — add the `/mentors` nav link.

---

### Task 1: Add the `mentors` table to the database

**Files:**
- Modify: `supabase-setup.sql`

- [ ] **Step 1: Append the new table, trigger, and policy**

Open `supabase-setup.sql` and add this block after table 7 (`scheduled_messages`, ends at the line before `-- אינדקסים`), i.e. insert it right before the `-- אינדקסים` comment:

```sql
-- 8. טבלת מנטורים
CREATE TABLE mentors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  coordinator TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

Then add an index alongside the other indexes (right after `CREATE INDEX idx_scheduled_messages_scheduled_for ...`):

```sql
CREATE INDEX idx_mentors_name ON mentors(name);
```

Then add a trigger alongside the other `updated_at` triggers (right after the `message_templates_updated_at` trigger):

```sql
CREATE TRIGGER mentors_updated_at
  BEFORE UPDATE ON mentors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

Then enable RLS and add a public-access policy alongside the other RLS statements (right after `ALTER TABLE scheduled_messages ENABLE ROW LEVEL SECURITY;`):

```sql
ALTER TABLE mentors ENABLE ROW LEVEL SECURITY;
```

And alongside the "no auth in project" policies (right after the `scheduled_messages` public policy):

```sql
CREATE POLICY "Public full access to mentors" ON mentors FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Run the new SQL against the live database**

Open the Supabase SQL Editor for project `ltfguyjrwrcghllvrixu` (`https://supabase.com/dashboard/project/ltfguyjrwrcghllvrixu/sql/new`) and run just the new statements added in Step 1 (the `CREATE TABLE mentors`, the new index, the new trigger, `ALTER TABLE mentors ENABLE ROW LEVEL SECURITY`, and the new policy) — not the whole file, since tables 1–7 already exist.

- [ ] **Step 3: Verify the table exists**

In the same SQL Editor, run:

```sql
select column_name, data_type, is_nullable from information_schema.columns where table_name = 'mentors' order by ordinal_position;
```

Expected: 6 rows — `id` (uuid, NO), `name` (text, NO), `coordinator` (text, YES), `phone` (text, NO), `email` (text, YES), `created_at` (timestamp with time zone, YES), `updated_at` (timestamp with time zone, YES).

- [ ] **Step 4: Commit**

```bash
git add supabase-setup.sql
git commit -m "Add mentors table to database setup script"
```

---

### Task 2: Build the Mentors page component

**Files:**
- Create: `frontend/src/pages/Mentors.jsx`

- [ ] **Step 1: Write the full page component**

Create `frontend/src/pages/Mentors.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

export default function Mentors() {
  const [mentors, setMentors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [editMentor, setEditMentor] = useState(null)

  useEffect(() => {
    loadMentors()
  }, [])

  async function loadMentors() {
    try {
      const { data, error } = await supabase
        .from('mentors')
        .select('*')
        .order('name', { ascending: true })
      if (error) throw error
      setMentors(data || [])
    } catch (err) {
      console.error('Error loading mentors:', err)
    } finally {
      setLoading(false)
    }
  }

  async function deleteMentor(id) {
    if (!confirm('האם למחוק את המנטור?')) return
    const { error } = await supabase.from('mentors').delete().eq('id', id)
    if (error) {
      alert('שגיאה במחיקה: ' + error.message)
    } else {
      setMentors(mentors.filter(m => m.id !== id))
    }
  }

  const coordinatorOptions = [...new Set(mentors.map(m => m.coordinator).filter(Boolean))]

  const filtered = mentors.filter(m => {
    const q = search.toLowerCase()
    return (
      m.name?.toLowerCase().includes(q) ||
      m.coordinator?.toLowerCase().includes(q) ||
      m.phone?.includes(search) ||
      m.email?.toLowerCase().includes(q)
    )
  })

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">טוען...</div>
  }

  return (
    <div className="space-y-4">
      <datalist id="coordinator-list">
        {coordinatorOptions.map(c => <option key={c} value={c} />)}
      </datalist>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">מנטורים</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
        >
          + הוסף מנטור
        </button>
      </div>

      <input
        type="text"
        placeholder="חפש לפי שם, רכז, טלפון, מייל..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
      />

      <div className="text-sm text-gray-500">
        {filtered.length} מנטורים {search ? '(מסונן)' : ''}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {mentors.length === 0 ? 'אין מנטורים עדיין' : 'לא נמצאו תוצאות'}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">שם</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">רכז</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">טלפון</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600 hidden md:table-cell">מייל</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(mentor => (
                  <tr key={mentor.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800">{mentor.name}</td>
                    <td className="px-4 py-3 text-gray-600">{mentor.coordinator || '-'}</td>
                    <td className="px-4 py-3 text-gray-600" dir="ltr">{mentor.phone}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell" dir="ltr">{mentor.email || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setEditMentor(mentor)}
                        className="text-blue-500 hover:text-blue-700 text-xs ml-2"
                      >
                        ערוך
                      </button>
                      <button
                        onClick={() => deleteMentor(mentor.id)}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >
                        מחק
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAddModal && (
        <MentorModal
          title="הוסף מנטור"
          initial={{ name: '', coordinator: '', phone: '', email: '' }}
          onClose={() => setShowAddModal(false)}
          onSaved={() => { setShowAddModal(false); loadMentors() }}
          onSubmit={form => supabase.from('mentors').insert(form)}
        />
      )}

      {editMentor && (
        <MentorModal
          title="ערוך מנטור"
          initial={{
            name: editMentor.name || '',
            coordinator: editMentor.coordinator || '',
            phone: editMentor.phone || '',
            email: editMentor.email || '',
          }}
          onClose={() => setEditMentor(null)}
          onSaved={() => { setEditMentor(null); loadMentors() }}
          onSubmit={form => supabase.from('mentors').update(form).eq('id', editMentor.id)}
        />
      )}
    </div>
  )
}

function MentorModal({ title, initial, onClose, onSaved, onSubmit }) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name || !form.phone) {
      alert('שם וטלפון הם שדות חובה')
      return
    }
    setSaving(true)
    try {
      const { error } = await onSubmit(form)
      if (error) throw error
      onSaved()
    } catch (err) {
      alert('שגיאה בשמירה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold mb-4">{title}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input placeholder="שם *" required value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <input placeholder="רכז" value={form.coordinator} list="coordinator-list"
            onChange={e => setForm({ ...form, coordinator: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <input placeholder="טלפון *" required value={form.phone} dir="ltr"
            onChange={e => setForm({ ...form, phone: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <input placeholder="מייל" type="email" value={form.email} dir="ltr"
            onChange={e => setForm({ ...form, email: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'שומר...' : 'שמור'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/Mentors.jsx
git commit -m "Add Mentors page component"
```

---

### Task 3: Wire the route into App.jsx

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Import the new page**

In `frontend/src/App.jsx`, add this import after the `import ContactDetail from './pages/ContactDetail.jsx'` line:

```jsx
import Mentors from './pages/Mentors.jsx'
```

- [ ] **Step 2: Add the route**

Add this route inside the `<Route element={<Layout />}>` block, after the `<Route path="/contacts/:id" element={<ContactDetail />} />` line:

```jsx
        <Route path="/mentors" element={<Mentors />} />
```

The full `<Routes>` block in `App.jsx` should now read (only the two new lines are additions):

```jsx
    <Routes>
      {/* Public route - no layout */}
      <Route path="/book/:contactId" element={<BookMeeting />} />

      {/* Admin routes with layout */}
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/contacts/:id" element={<ContactDetail />} />
        <Route path="/mentors" element={<Mentors />} />
        <Route path="/import" element={<ImportCSV />} />
        <Route path="/whatsapp" element={<WhatsApp />} />
        <Route path="/meetings" element={<Meetings />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/monday" element={<MondayTasks />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "Wire up /mentors route"
```

---

### Task 4: Add the nav link

**Files:**
- Modify: `frontend/src/components/Navbar.jsx`

- [ ] **Step 1: Add the link to the `links` array**

In `frontend/src/components/Navbar.jsx`, add this entry to the `links` array, after the `{ to: '/contacts', label: 'אנשי קשר', icon: '👥' }` line:

```jsx
  { to: '/mentors', label: 'מנטורים', icon: '🧑‍🏫' },
```

The full `links` array should now read:

```jsx
const links = [
  { to: '/', label: 'דשבורד', icon: '📊' },
  { to: '/contacts', label: 'אנשי קשר', icon: '👥' },
  { to: '/mentors', label: 'מנטורים', icon: '🧑‍🏫' },
  { to: '/import', label: 'ייבוא CSV', icon: '📁' },
  { to: '/whatsapp', label: 'WhatsApp', icon: '💬' },
  { to: '/meetings', label: 'פגישות', icon: '📅' },
  { to: '/monday', label: 'משימות Monday', icon: '📋' },
  { to: '/settings', label: 'הגדרות', icon: '⚙️' },
]
```

Both the desktop and mobile nav already render from this single array (see the two `links.map(...)` blocks later in the file), so no other change is needed for the link to appear in both.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Navbar.jsx
git commit -m "Add Mentors link to navigation"
```

---

### Task 5: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start both dev servers**

```bash
cd frontend && npm run dev
```
```bash
cd backend && npm run dev
```

(Or reuse already-running servers from a prior session — check `http://localhost:3001/api/health` returns `{"ok":true}` first.)

- [ ] **Step 2: Open the app and navigate to Mentors**

Open `http://localhost:5173` in a browser, click "מנטורים" in the top nav (desktop) — confirm the URL becomes `http://localhost:5173/mentors` and the page shows "אין מנטורים עדיין" (empty state) if the table has no rows yet.

- [ ] **Step 3: Add a mentor**

Click "+ הוסף מנטור". Fill in:
- שם: `בדיקה בדיקה`
- רכז: `בני`
- טלפון: `050-0000000`
- מייל: `test@example.com`

Click "שמור". Expected: modal closes, the new row appears in the table with all four values shown correctly (טלפון and מייל rendered LTR).

- [ ] **Step 4: Verify autocomplete**

Click "+ הוסף מנטור" again, click into the "רכז" field, and start typing "ב". Expected: the browser's native autocomplete suggests "בני" (the value entered in Step 3).

Close the modal without saving (click "ביטול").

- [ ] **Step 5: Edit the mentor**

Click "ערוך" on the row from Step 3, change the phone number to `050-1111111`, click "שמור". Expected: modal closes, the row now shows the updated phone number.

- [ ] **Step 6: Search**

Type "בני" into the search box. Expected: the row from Step 3 still shows (since "בני" is now its coordinator value) and the results count updates to reflect the filter.

Clear the search box.

- [ ] **Step 7: Delete the mentor**

Click "מחק" on the row, confirm the browser `confirm()` dialog. Expected: the row disappears and the page shows "אין מנטורים עדיין" again (assuming it was the only row).

- [ ] **Step 8: Verify in Supabase directly**

In the Supabase SQL Editor, run:

```sql
select count(*) from mentors;
```

Expected: `0` (confirming the delete in Step 7 actually persisted, not just removed from local state).

---

## Notes for the implementing engineer

- This project has no automated test suite (no jest/vitest configured, no `*.test.*` files anywhere in the repo). Task 5's manual verification is the only check — don't add a test framework as part of this plan, that would be a separate, unrelated change.
- The Supabase project (`ltfguyjrwrcghllvrixu`) is on the free tier and auto-pauses after inactivity — if Task 1 Step 2 or Task 5 fails with a connection/DNS error, the project may need to be resumed first via the dashboard (see the `run-teacher-crm` skill's step 0 for the exact procedure).
