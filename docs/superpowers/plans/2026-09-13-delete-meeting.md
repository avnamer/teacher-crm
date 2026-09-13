# Delete Meeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a delete action to the Meetings page's existing inline edit form, removing every attendee's row for the edited meeting at once.

**Architecture:** `MeetingEditForm` gains an `onDelete` prop and renders a red "מחק פגישה" button next to שמור/ביטול, with the confirmation dialog owned by the form itself (matching how it already owns save validation). A new `deleteMeetingGroup(rowIds)` function in the page component performs the delete and reload, mirroring `saveMeetingEdit`'s existing success path.

**Tech Stack:** React (Vite), Supabase JS client, Tailwind classes. No automated test framework exists in this repo; manual browser + database verification is the actual "test" here.

**Reference spec:** `docs/superpowers/specs/2026-09-13-delete-meeting-design.md`

---

## Before you start

Run the app locally with the `run-teacher-crm` skill. You're working in a dedicated git worktree on branch `feature/delete-meeting`, branched off `main` (which already has the meeting-editing feature merged in). Stage specific files only when committing — never `git add -A`.

---

### Task 1: Add a delete button to the meeting edit form

**Files:**
- Modify: `frontend/src/pages/Meetings.jsx`

- [ ] **Step 1: Add `onDelete` to `MeetingEditForm` and render the delete button**

Find this in `frontend/src/pages/Meetings.jsx`:

```jsx
function MeetingEditForm({ initialDate, initialContent, onSave, onCancel }) {
```

Change it to:

```jsx
function MeetingEditForm({ initialDate, initialContent, onSave, onCancel, onDelete }) {
```

Find this block (the button row at the end of the form):

```jsx
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'שומר...' : 'שמור'}
        </button>
        <button onClick={onCancel} disabled={saving}
          className="px-2 py-1 border rounded text-xs hover:bg-gray-100">
          ביטול
        </button>
      </div>
```

Replace it with:

```jsx
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'שומר...' : 'שמור'}
        </button>
        <button onClick={onCancel} disabled={saving}
          className="px-2 py-1 border rounded text-xs hover:bg-gray-100">
          ביטול
        </button>
        <button onClick={handleDelete} disabled={saving}
          className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200 disabled:opacity-50 mr-auto">
          מחק פגישה
        </button>
      </div>
```

Add a `handleDelete` function inside `MeetingEditForm`, right before its `return`:

```jsx
  function handleDelete() {
    if (!confirm('למחוק את הפגישה לצמיתות? הפעולה תמחק את הרשומה עבור כל המשתתפים.')) return
    onDelete()
  }
```

- [ ] **Step 2: Add `deleteMeetingGroup` to the page component**

Find this in `frontend/src/pages/Meetings.jsx` (right after `saveMeetingEdit`'s closing brace):

```jsx
  const contactsById = Object.fromEntries(contacts.map(c => [c.id, c]))
```

Insert a new function immediately before that line (after `saveMeetingEdit`'s closing `}`):

```jsx
  // Deletes every row belonging to one real-world meeting at once (all attendees),
  // mirroring saveMeetingEdit's own success path.
  async function deleteMeetingGroup(rowIds) {
    try {
      const { error } = await supabase.from('interactions').delete().in('id', rowIds)
      if (error) throw error
      setEditingGroupId(null)
      await loadAll()
    } catch (err) {
      alert('שגיאה במחיקת הפגישה: ' + err.message)
    }
  }

```

(Leave the `const contactsById = ...` line and everything after it exactly as it was — you're only inserting the new function above it.)

- [ ] **Step 3: Wire `onDelete` into the upcoming-meetings call site**

Find this in the `upcoming.map` block:

```jsx
                    <MeetingEditForm
                      initialDate={dateInputValue(g.date)}
                      initialContent={firstRowContent(g.rowIds, meetings)}
                      onSave={vals => saveMeetingEdit(g.rowIds, vals)}
                      onCancel={() => setEditingGroupId(null)}
                    />
```

Change it to:

```jsx
                    <MeetingEditForm
                      initialDate={dateInputValue(g.date)}
                      initialContent={firstRowContent(g.rowIds, meetings)}
                      onSave={vals => saveMeetingEdit(g.rowIds, vals)}
                      onCancel={() => setEditingGroupId(null)}
                      onDelete={() => deleteMeetingGroup(g.rowIds)}
                    />
```

- [ ] **Step 4: Wire `onDelete` into the past-meetings-by-school call site**

Find this in the `sortedRows.map` block:

```jsx
                                <MeetingEditForm
                                  initialDate={dateInputValue(row.created_at)}
                                  initialContent={row.content || ''}
                                  onSave={vals => saveMeetingEdit(rowIds, vals)}
                                  onCancel={() => setEditingGroupId(null)}
                                />
```

Change it to:

```jsx
                                <MeetingEditForm
                                  initialDate={dateInputValue(row.created_at)}
                                  initialContent={row.content || ''}
                                  onSave={vals => saveMeetingEdit(rowIds, vals)}
                                  onCancel={() => setEditingGroupId(null)}
                                  onDelete={() => deleteMeetingGroup(rowIds)}
                                />
```

- [ ] **Step 5: Manually verify deleting a single-attendee meeting**

1. Create a test meeting via "🤝 הוסף פגישה" with one attendee, today's date, real content.
2. On the Meetings page, expand that teacher's school, click ✏️ on the new row.
3. Confirm a red "מחק פגישה" button now appears alongside שמור/ביטול.
4. Click it. Confirm a browser confirm dialog appears with the exact text "למחוק את הפגישה לצמיתות? הפעולה תמחק את הרשומה עבור כל המשתתפים.".
5. Click Cancel on that dialog. Confirm nothing happened — the edit form is still open, the meeting still exists (query the database to confirm the row is still there).
6. Click "מחק פגישה" again, this time accept the confirm dialog. Confirm the row disappears from the school's list and the page reloads correctly. Query the database to confirm the row no longer exists.

- [ ] **Step 6: Manually verify deleting a multi-attendee meeting removes every attendee's row**

1. Create a test meeting via "🤝 הוסף פגישה" with two attendees (any two teachers), today's date, real content.
2. On the Meetings page, find one of the two rows (in either attendee's school section) and open its edit form.
3. Click "מחק פגישה" and confirm.
4. Confirm BOTH rows for this meeting are gone — check both attendees' school sections (or the same section if they share a school), and confirm via a direct database query that no `interactions` rows remain for either attendee's copy of this meeting (query by the shared `meeting_group_id` if you captured it, or by matching content/date).

- [ ] **Step 7: Manually verify deleting an upcoming (scheduled) meeting**

1. Create a test meeting via "🤝 הוסף פגישה" with a date several days in the future.
2. Confirm it appears in "פגישות עתידיות". Click its ✏️, then "מחק פגישה", confirm.
3. Confirm it disappears from "פגישות עתידיות" (not just visually reclassified — actually gone), and confirm via the database that the row(s) no longer exist.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Meetings.jsx
git commit -m "$(cat <<'EOF'
Add delete action to the Meetings page's inline edit form

A red "מחק פגישה" button in MeetingEditForm, alongside שמור/ביטול,
deletes every interactions row belonging to the edited meeting (all
attendees) after a confirmation dialog, then reloads — mirroring
saveMeetingEdit's own group-wide, reload-on-success pattern.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## After this plan

Push `feature/delete-meeting` and open a PR against `main`, per this repo's own `CLAUDE.md` conventions.
