# Meetings Page Redesign + Scheduled Meetings

## Problem

The current Meetings page (`frontend/src/pages/Meetings.jsx`) reads from a
`meetings` table that is populated only by Google Calendar sync. This is
disconnected from how meetings actually get logged in practice: the
dashboard's "🤝 הוסף פגישה" button writes to `interactions` with
`type = 'meeting'` instead. A meeting logged from the dashboard never shows
up on the Meetings page, and the page's calendar-sync button writes to a
table nothing else reads. There is also no way to schedule a meeting in
advance — every meeting is logged after the fact, with content describing
what already happened.

## Goal

Rebuild the Meetings page around `interactions`/`type='meeting'` — the same
data source as the rest of the app — and add the ability to schedule a
future meeting (date + attending teachers, no content required yet). Once a
scheduled meeting's date has passed, a dashboard indicator prompts the
mentor to record what happened or mark it as not held.

## Data model

No schema migration. A new key inside the existing `interactions.metadata`
jsonb column represents scheduling state for `type='meeting'` rows:

| `metadata.meeting_status` | meaning |
|---|---|
| absent (existing rows, and any meeting logged for today/the past) | already happened — today's behavior, unchanged |
| `'scheduled'` | a future meeting — `content` may be null/empty until updated |
| `'not_held'` | was scheduled but marked as not having happened |

`created_at` continues to serve as the meeting's date, whether past
(happened) or future (scheduled) — no separate date column needed.

A scheduled meeting still gets one `interactions` row per attending teacher,
exactly like today's `AddMeetingModal` insert — `metadata.attendees` keeps
listing the other teachers in the same meeting, so a school-wide session
logs identically whether scheduled ahead or recorded after the fact.

**Invariant — every attendee gets their own record.** Because
`AddMeetingModal` inserts one row per selected teacher (today's behavior,
unchanged), a meeting with several teachers automatically shows up in each
of their individual interaction histories on their own contact page — not
just in the aggregated views this spec adds. Nothing extra is needed for
this; it falls out of the existing insert shape.

**Invariant — any `type='meeting'` row surfaces on the Meetings page,
regardless of how it was created.** The page's past-meetings query is
simply "`interactions` where `type='meeting'` and `meeting_status` absent" —
it does not care whether the row came from `AddMeetingModal` or from
reclassifying an existing interaction to `meeting` via the type dropdown on
the contact detail page (built in a previous session). Reclassifying an
interaction to `meeting` there requires no separate sync step to make it
appear here; it already has no `meeting_status` key, so it's treated as a
completed meeting exactly like one logged through the modal. The only gap:
a reclassified single interaction has no `meeting_group_id`, so it won't be
part of a multi-attendee group elsewhere — it stands alone, which is correct
since it wasn't created as part of a group meeting.

**New:** every insert from `AddMeetingModal` (scheduled or not) also stamps
a client-generated `metadata.meeting_group_id` (random UUID), shared by all
rows created in that one submission. `created_at` alone can't reliably tie
multi-attendee rows back together — two unrelated meetings scheduled for the
same day would collide, since the time portion is always fixed at noon.
`meeting_group_id` is what the dashboard indicator and the upcoming-meetings
list group by, so updating or marking one meeting doesn't touch an unrelated
same-day one.

## `AddMeetingModal` (extracted to a shared component)

Currently defined only inside `Contacts.jsx` (lines ~1399–onward), so the
Meetings page can't reuse it. Move it to
`frontend/src/components/AddMeetingModal.jsx`, imported by both
`Contacts.jsx` and `Meetings.jsx`. No behavior change from extraction alone.

Behavior change — the date field now accepts future dates:

- **Date is today or in the past** (today's existing behavior): content is
  required, row(s) inserted with no `meeting_status` key (= already
  happened).
- **Date is in the future**: content becomes optional. Row(s) inserted with
  `metadata.meeting_status = 'scheduled'`. Under the teacher checklist, show
  the distinct school name(s) among selected teachers as a confirmation line
  ("בית ספר: X" or "בתי ספר: X, Y" if they span more than one) — read-only,
  derived from `contact.school`, not a field the user fills in.

## Dashboard indicator: meetings needing an update

New alert bar in `Contacts.jsx`, visually matching the existing
`PendingTasksBanner` pattern (amber, ❗ icon, ▼/▲ expand toggle):

- Query: `interactions` rows where `type='meeting'`,
  `metadata.meeting_status = 'scheduled'`, and `created_at` is in the past,
  for this mentor's teachers.
- Collapsed: "❗ יש לעדכן N פגישות שהתקיימו".
- Expanded: one line per overdue scheduled meeting — teacher name(s), school,
  and the scheduled date — with two actions:
  - **"עדכן שהתקיימה"** — inline textarea to fill in what happened; saving
    sets `content` and removes `meeting_status` from metadata (transitions
    to "already happened").
  - **"לא התקיימה"** — sets `metadata.meeting_status = 'not_held'`
    immediately, no confirmation dialog needed beyond the button itself.
- A meeting with multiple attendees (one row per teacher, same
  `meeting_group_id`) is grouped into a single list entry — updating or
  marking-not-held applies to all rows in that group together, so the
  mentor isn't asked about the same meeting once per attendee.

## Meetings page rebuild

Four sections, top to bottom:

### 1. "🤝 הוסף פגישה" button
Same shared `AddMeetingModal`, same placement convention as the dashboard
(top of the page, next to the title).

### 2. School-recency banner
Mirrors `Contacts.jsx`'s existing `ContactStats` component exactly (same
tile/expand-list interaction pattern), but bucketing **schools** instead of
teachers, based only on **completed** meetings (`meeting_status` absent):

| Bucket | Rule |
|---|---|
| 🟢 green | most recent completed meeting ≤ 1 month ago |
| 🟠 orange | most recent completed meeting 1–3 months ago |
| 🔴 red | most recent completed meeting > 3 months ago, or no completed meeting ever |

A school's bucket is driven by the single most recent completed meeting
across any of its teachers. Clicking a tile expands a list of school names
in that bucket (not teacher names).

### 3. "פגישות עתידיות" (upcoming) — shown only if non-empty
Scheduled meetings (`meeting_status='scheduled'`) whose date hasn't passed
yet, grouped by `meeting_group_id` (one entry per meeting, not per
attendee), soonest first. Overdue scheduled ones — already covered by the
dashboard indicator — do not additionally appear here; this section is
upcoming-only.

### 4. Past meetings, grouped by school
Completed meetings only (`meeting_status` absent). Grouped by school,
sections ordered most-overdue-school-first (same convention the current
page already uses: `groups.sort((a,b) => db - da)` on days-since-last, just
applied per-school instead of per-teacher). Within a school's section,
meetings sorted most-recent-first, each row showing teacher name, date, and
content. No status badges — a completed meeting always represents something
that already happened, there's nothing left to distinguish.

`not_held` meetings are not shown anywhere on this page (their purpose — the
dashboard prompt — is already resolved once marked).

## Out of scope

- Editing or deleting an already-completed meeting from this page (already
  possible from the teacher's own contact detail page).
- Any change to the old `meetings` table or the Google Calendar sync
  button/endpoint — both are simply no longer used by this page. Neither is
  deleted; reviving calendar sync elsewhere is a separate future feature.
