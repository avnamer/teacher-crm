# Checkpoint: v1.0

**Date:** 2026-09-08
**Branch:** `feature/mentors-page`
**Purpose:** A known-good snapshot to roll back to if later development gets stuck or breaks something. If that happens:

```bash
git -C "/c/Users/Avner/Pictures/.claude/worktrees/affectionate-pare/teacher-crm" checkout v1.0
```

(or `git reset --hard v1.0` on the working branch, if you want to discard everything after it).

---

## What's in this checkpoint

### Contacts page (`frontend/src/pages/Contacts.jsx`)

- **Column manager** ("⚙️ עמודות" button): show/hide any column, add custom columns, remove custom columns.
- **Column reordering**: ▲/▼ arrows in the column manager move a column up/down; the table follows.
- **Column resizing**: drag the thin handle on a column header's edge to resize it.
- **Inline cell editing**: click any cell (except name) to edit it directly in the table — text, gender dropdown, or date picker depending on the column. Manual edits set `custom_fields._manual_edit = true` to protect against being overwritten by a future Monday sync.
- **Journal / log columns**: a special column type where every write appends a new timestamped entry (via the `interactions` table, `type = 'journal'`) instead of overwriting the last one. The cell shows the latest entry; the contact's detail page shows the full history. A default column "יומן קשר אחרון" ships enabled. New journal columns can be added via the column manager's checkbox.
- **Contact-recency stats bar** (top of page): three tiles — 🟢 contacted in the last 7 days, 🟠 8–14 days since last contact, 🔴 14+ days or never contacted — computed from the `interactions` table across **all** interaction types (journal, WhatsApp, calls, meetings), always over "my teachers" regardless of the search/filter UI. A toggle button expands each tile into the list of teacher names in that bucket, linking to their detail pages.
- All column config (visibility, order, width, custom/journal columns) is stored in `settings.contacts_columns` (JSONB) — shared across every device/browser, not per-user localStorage.

### Contact detail page (`frontend/src/pages/ContactDetail.jsx`)

- "היסטוריית אינטראקציות ויומן" section now also renders `journal`-type interactions (📝 icon, labeled with the originating column's name from `metadata.column_label`).

### Database (`supabase-setup.sql`)

- `settings.contacts_columns` (JSONB) — new column manager state.
- `interactions.type` check constraint extended to allow `'journal'`.
- **RLS fixes** (this app has no login/auth — everything runs on the anon key): added `Public can update settings` and `Public full access to interactions` policies. Before this, writes to `settings` and `interactions` silently succeeded (no error) but never actually persisted, since only an `authenticated`-role policy existed. This affected the Settings page (Monday board ID, working hours, etc.) even before today's feature work — it's fixed now, not just for the new features.
- 9 new teachers added directly to `contacts` (see below).

### Data

- Read the "פרטי נבחרות תלת מימד - ai" column on the Monday.com board ("Open Call - January 2026", 3D Mentors Check view) and added 9 teachers not previously in the CRM: בלסם מגאדלה, עביר שאמיה, גדיר ראס, אסראא, מוחמד גבארה, נור מסארוה, חנדקלו דועאא, ענבוסי רואן, רותם רייס. Tagged with `role = 'מורה מוביל/ה'` and `custom_fields.mentor_name = 'אבנר'` to match existing records.

## Known gaps / things to revisit later

- **נסרין חאן יחיא** (existing contact, school "חט"ב אחווה עמל טייבה") doesn't match either teacher Monday currently lists for that school (מוחמד גבארה / נור מסארוה) — possibly stale, not touched.
- **WhatsApp backend** is not implemented in this branch (`backend/server.js` only has `/api/google` + `/api/health`) — the WhatsApp page always shows "disconnected". Not something today's work touched or broke.
- **Google Calendar tokens** (`backend/.google-tokens.json`) are stored on local disk — fine for local dev, but won't survive a redeploy on most hosting platforms. Worth revisiting before going online (see "Online deployment" below).
- **Online deployment** (frontend on Netlify — `frontend/netlify.toml` already exists — backend on a small Node host) was requested but not yet done; picking this back up is the natural next step.
- **Minor cleanup from voice-call-logging code review (non-blocking):** `createCalendarEvent` in `backend/src/services/calendarSync.js` duplicates the token-refresh logic from `syncCalendarMeetings` verbatim, and its all-day-event end-date math mixes UTC parsing with local-time `Date` methods (safe in practice for a single-timezone personal tool, but worth switching to explicit UTC methods if this ever runs on a different host/TZ). Also: `/api/google/sync-meetings` returns `{error}` while `/api/google/create-event` returns `{message}` — worth picking one convention.- **Voice call logging (`frontend/src/pages/VoiceLog.jsx`) follow-ups, non-blocking:** two simultaneous `<select>` dropdowns can render at once (fuzzy candidates + manual search results) for the same teacher choice — confusing but not broken; `matchResult` recomputes a full fuzzy-match pass on every render (e.g. every summary-textarea keystroke) instead of being `useMemo`'d — fine at "my teachers" list size but worth fixing if the list grows. Consider extracting the confirmation-card JSX into its own component before Task 7 (save/calendar) adds more state to this file.
- **PWA icon (`frontend/public/pwa-icon.svg`) follow-up, non-blocking:** the `purpose: "any maskable"` manifest icon has its emoji roughly centered but not deliberately inset to the ~80% "safe zone" maskable icons are expected to keep content within — low risk since the background is a solid full-bleed color (circular crop is seamless), but worth verifying/adjusting if the icon is ever art-directed further. Also: `apple-touch-icon` points at the same SVG, which iOS Safari doesn't reliably rasterize — fine for now since this is an Android-first tool, but would need a PNG fallback for iOS home-screen use.
- **WhatsApp Desktop scanning (future idea, not scoped yet):** scan WhatsApp conversations on the computer to auto-log past correspondence with teachers into the CRM. Not designed yet — needs its own brainstorm (WhatsApp Desktop has no official API; would likely need either WhatsApp Web automation/scraping or manual export). Raised 2026-09-08 alongside the voice call logging feature.

## Next feature: voice call logging (PWA)

Planning doc for the next phase — logging phone calls with teachers via voice-to-text on mobile, auto-summarized and matched to the right teacher — is at [VOICE-CRM-PLAN.md](VOICE-CRM-PLAN.md). It maps cleanly onto the existing `contacts` + `interactions` tables (no schema changes needed; `interactions.type = 'phone_call'` already exists).

## Monday.com skill note

`monday-integration` skill was updated this session to (1) always be used for any Monday.com task instead of calling APIs/browser directly, and (2) sign in with "Sign in with Google" when a login screen appears. See `C:\Users\Avner\.claude\skills\monday-integration\SKILL.md`.
