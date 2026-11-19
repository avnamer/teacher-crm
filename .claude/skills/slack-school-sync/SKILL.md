---
name: slack-school-sync
description: Use when the user wants to sync school learning-platform progress from the Slack bot Gaya (monday agent, channel tech-school-lms) into the Teacher CRM — phrases like "סנכרן בתי ספר מ-Slack", "תבקש מגאיה עדכון", "עדכן התקדמות בתי ספר", "sync school progress", "refresh from Gaya". Asks Gaya for the CSV in Slack via Chrome, downloads it, dry-runs the import, and applies it after the user's OK.
---

# Sync school progress: Gaya (Slack) → CRM

Gaya is a **monday agent bot**, not an MCP. She answers only when tagged (`@Gaya`) in the channel
`tech-school-lms` or inside one of its threads. Her data refreshes **about once a week**, so
asking more often returns the same "נכון ל" timestamp — that is expected, not a failure.

- Channel: https://app.slack.com/client/T0CK48SJB3Q/C0CGYPS2EAZ
- Existing thread with the CSV conversation: the 12:08 message "אני רוצה לדעת בבתי הספר השונים שלי להיכן הם הגיעו…" (open its replies).
- Import script: `scripts/import-school-progress.mjs` (dry run by default; `--apply` saves the file as a snapshot keyed by its "נכון ל" date and KEEPS older snapshots, so the Schools page can draw trend ticks; re-importing the same date replaces only that snapshot). Name mapping: `scripts/school-progress-aliases.json` (unknown names abort).
- Reply in Hebrew, short, no jargon.

## Permissions (user approved the *flow* on 2026-11-19; keep these rules)
- Sending the request to Gaya = a message on the user's behalf. The user authorized sending
  the standard prompt below when they ask for this sync. Don't send anything else/different without asking.
- Downloading the CSV from Gaya's link = authorized for this flow; say file name + size afterwards.
- `--apply` only after showing the dry-run summary and getting a yes **in this chat** (unless the
  user's request already said "ייבא"/"תעדכן את המערכת").
- Send in the **thread only** — leave "Also send to tech-school-lms" unchecked.

## Steps
1. Load the Chrome tools in ONE ToolSearch call (`tabs_context_mcp`, `tabs_create_mcp`/`navigate`,
   `computer`, `find`, `read_page`, `get_page_text`, `browser_batch`). Open the channel in a new tab
   (it is already signed in). If Slack asks for sign-in, stop and ask the user.
2. Open the thread (click "N replies" under the 12:08 school-progress message).
3. In the thread reply box type `@Gaya`, wait for autocomplete, press Enter to pick **Gaya (APP)**,
   then type the rest of the prompt. Use `shift+Return` for line breaks (plain Enter sends).
   Send with Enter. Prompt (after the mention):

   > צרי לי קובץ CSV עם נתוני ההתקדמות של התלמידים והמורים בבתי הספר שלי. תוכנית: תלת מימד, ליגת מרכז. בתי הספר: אולפנית מבשרת ברוך, אל-בירוני גת, בית ספר למחוננים בקה, התיכון ב' טירה, אבן אל-הית'ם בקה, עמל טייבה, אל-אנדלוס בקה, אל-נג'אח טייבה, תיכון חטיבה חדרה, אמית נתיבות דרור. קורסים: אתגר 00, אתגר 01. בנוסף אם אתגר 2 או 3 או 4 גם נפתחו אז שלחי לי גם את המידע עליהם. כל היחידות. לכל בית ספר, תפקיד (תלמידים ומורים) ויחידה: כמה רשומים, כמה נכנסו ליחידה, אחוז מהרשומים, והאם עברו 33%. תוסיפי עמודה "נכון ל" עם תאריך ושעת הנתונים. תשלחי קישור להורדה שעובד ישירות מסלאק, ולצידו שתי טבלאות סיכום: אחת לתלמידים ואחת למורים, עם היחידה הרחוקה ביותר שעברה 33% בכל בית ספר.
   >
   > אם הקישור לא נפתח, כתוב "הקישור לא נפתח" ואשלח חדש.

4. Wait for her reply (~1–3 min; poll with `wait` 10s ×N + screenshot). Find her newest message with
   `find`/`read_page` and take the link "להורדת school_progress_3d_center.csv" (`href` on
   files.monday.com, a presigned URL valid ~1 hour). If the link fails, reply in the thread
   "הקישור לא נפתח" and wait for a new one.
5. Download into a **new empty folder in the scratchpad** with `curl -sS --fail -o <dir>/school_progress_3d_center.csv "<url>"`.
   Check size / `wc -l` / header: `נכון ל,בית ספר,תפקיד,רשומים,קורס,יחידה,נכנסו ליחידה,אחוז מהרשומים,עבר 33%`.
6. Dry run: `node scripts/import-school-progress.mjs <csv>`. Report rows, school count and the "נכון ל" date.
   - If "נכון ל" equals the date of the last import → tell the user nothing is new (Gaya refreshes weekly) and stop unless they want it anyway.
   - Unknown school name → script aborts; add the alias to `scripts/school-progress-aliases.json` (CRM name is the target) after confirming the match with the user, then re-run.
   - Note Gaya has hallucinated a school name before ("התיכון הטכנולוגי חדרה" instead of "תיכון חטיבה חדרה"); the CRM name is the source of truth.
7. After approval: `node scripts/import-school-progress.mjs <csv> --apply` → expect "הסנכרון נשמר".
8. Close the Chrome tab you opened. Tell the user: rows imported, "נכון ל" date, and that the app
   (Schools page) reads the table — nothing to deploy (data only, no code change, no Netlify credits).

## Notes
- Needs `backend/.env` with `SUPABASE_SERVICE_KEY`; the script bypasses RLS and adds a snapshot (needs the PK-with-`as_of` migration from the end of `supabase-setup.sql`, run once in the Supabase SQL editor).
- Gaya cannot be scheduled from here; a fully automatic sync would need her owner (גיא מזרחי) to
  grant API/MCP access, or a Slack app token — out of scope for this skill.
- Slack's MCP connector (plugin:finance:slack) needs `/mcp` authorization; until then this skill uses Chrome.
- Don't commit the downloaded CSV (contains school data); it lives in the scratchpad only.
