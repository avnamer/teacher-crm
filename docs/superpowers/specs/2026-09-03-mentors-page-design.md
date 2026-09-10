# Mentors Page — Design

## Purpose

Add a page to the Teacher CRM listing the mentors (מנטורים) who run the program, each with their coordinator (רכז), phone, and email — so the user can look up mentor contact info without going to Monday.com.

## Data model

New Supabase table `mentors`:

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID DEFAULT gen_random_uuid()` | primary key |
| `name` | `TEXT NOT NULL` | mentor's name |
| `coordinator` | `TEXT` | רכז — free text, no fixed list. Source: on Monday.com's "Open Call - January 2026" board, "רכז" is itself a free-text column (not a dropdown), so this table matches that shape. |
| `phone` | `TEXT NOT NULL` | required, matching the `contacts` table's convention |
| `email` | `TEXT` | optional |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ DEFAULT now()` | auto-updated via the existing `update_updated_at()` trigger function |

No RLS/auth complexity: the project has no login flow (the frontend Supabase client uses the anon key with no session — see `message_templates` and `scheduled_messages`, which use `FOR ALL USING (true) WITH CHECK (true)` for the same reason). `mentors` follows that same "public full access" pattern.

Migration is added to `supabase-setup.sql` (the project's single running setup script — new tables are appended there, matching tables 1–7 already in the file) rather than a separate migrations directory, since the project has none.

## Page: `/mentors`

New file `frontend/src/pages/Mentors.jsx`, following the same structure as the existing `Contacts.jsx`:

- **List/table** — columns: שם, רכז, טלפון, מייל, פעולות. Sorted by name ascending, loaded on mount via `supabase.from('mentors').select('*').order('name')`.
- **Search box** — filters client-side across name, coordinator, phone, email (same pattern as Contacts' `search` state).
- **"+ הוסף מנטור" button** — opens an `AddMentorModal`.
- **Edit / delete per row** — "ערוך" opens `EditMentorModal`; "מחק" confirms then deletes.
- **Coordinator field in both modals** — a plain text `<input>` paired with a `<datalist>` whose `<option>`s are the distinct `coordinator` values already present in the loaded `mentors` list (computed client-side, e.g. `[...new Set(mentors.map(m => m.coordinator).filter(Boolean))]`). This gives autocomplete against real values already in use without hardcoding a list or adding a library.
- Required fields: name + phone (mirrors Contacts' validation: `if (!form.name || !form.phone) { alert(...); return }`). Coordinator and email are optional.
- All reads/writes go directly to Supabase from the frontend, exactly like Contacts — no backend route needed.

## Navigation

- `frontend/src/components/Navbar.jsx`: add `{ to: '/mentors', label: 'מנטורים', icon: '🧑‍🏫' }` to the `links` array (both desktop and mobile nav render from this same array, so one addition covers both).
- `frontend/src/App.jsx`: add `<Route path="/mentors" element={<Mentors />} />` inside the existing `<Route element={<Layout />}>` block, alongside the other admin routes, and import `Mentors` at the top.

## Out of scope

- No import/export (CSV) for mentors — the existing `/import` flow is contacts-specific and isn't being extended.
- No linking between `mentors` and `contacts`/teachers — this is a standalone directory page, not a relational assignment feature.
- No validation restricting `coordinator` to a closed set — confirmed with the user that Monday.com's own "רכז" field is free text, so this table matches that.
