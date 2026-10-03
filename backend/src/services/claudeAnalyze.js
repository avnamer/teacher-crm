import Anthropic from '@anthropic-ai/sdk'
import { normalizeText } from './whatsappDedup.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `אתה עוזר שמנתח תמלול של הקלטה קולית שמבצע מנטור של מורים בבית ספר, ומזהה לאיזה מתוך 3 סוגי תיעוד הכוונה מתאימה:

1. route "teacher_call" — שיחה עם מורה ספציפי: המדבר מתאר שיחה או פגישה עם מורה מסוים, ומזכיר את שמה/ו.
2. route "admin_task" — משימה אישית למנהל המערכת (המנטור עצמו), לא קשורה למורה ספציפי.
3. route "new_task_column" — משימה שחלה על כל המורים ברשימה (מעקב/משימה שצריך לבדוק מול כל מורה).

אם אין די מידע כדי להחליט בבירור בין השלושה, החזר route "unclear".

עבור route "teacher_call" בלבד, זהה גם את ערוץ התקשורת שתואר, בשדה "communication_type":
- "phone_call" — שיחת טלפון (למשל "התקשרתי אליה", "דיברנו בטלפון")
- "message_sent" — המדבר שלח הודעת טקסט/וואטסאפ אך לא תיאר תגובה מהמורה (למשל "שלחתי לה הודעה", "כתבתי לה ולא ענתה")
- "correspondence" — חילופי הודעות דו-כיווניים (למשל "התכתבנו", "היא ענתה לי בהודעה")
- "meeting" — פגישה פנים אל פנים (למשל "נפגשנו בבית הספר", "הייתה לנו פגישה", "ביקרתי אצלה בכיתה", "עברתי אצלה")
אם לא ניתן לקבוע בבירור איזה מארבעת הערוצים תואר, החזר "communication_type": null — אל תנחש ואל תבחר ברירת מחדל. עבור routes אחרים החזר "communication_type": null.

החזר אך ורק JSON תקני בפורמט הבא, בלי שום טקסט נוסף לפניו או אחריו:
{
  "route": "teacher_call" | "admin_task" | "new_task_column" | "unclear",
  "teacher_name_spoken": "השם שנאמר עבור המורה (רלוונטי רק ל-teacher_call), אחרת null",
  "communication_type": "phone_call" | "message_sent" | "correspondence" | "meeting" | null,
  "summary": "סיכום קצר של התוכן, 2-3 משפטים (לא רלוונטי ל-new_task_column)",
  "action_items": [ { "text": "תיאור המטלה", "due_date": "YYYY-MM-DD או null אם לא הוזכר תאריך" } ],
  "mentioned_dates": ["YYYY-MM-DD"],
  "column_label": "כותרת קצרה ותמציתית (2-5 מילים) לעמודת המשימה — רק ל-new_task_column, אחרת null"
}
אם לא הוזכר שם מורה, החזר "teacher_name_spoken": null. אם אין מטלות המשך, החזר "action_items": [].`

const VALID_ROUTES = new Set(['teacher_call', 'admin_task', 'new_task_column', 'unclear'])
const VALID_COMMUNICATION_TYPES = new Set(['phone_call', 'message_sent', 'correspondence', 'meeting'])

// claude-sonnet-5 thinks (adaptive) by default, and thinking tokens count against
// max_tokens. With a long transcript, a small cap was used up entirely by thinking,
// leaving no text block at all ("תשובה ריקה"). Keep this generous.
const MAX_TOKENS = 16000

function responseText(response) {
  const text = response.content?.find(block => block.type === 'text')?.text
  if (!text) {
    if (response.stop_reason === 'max_tokens') throw new Error('התשובה מ-Claude נקטעה (ארוכה מדי) — נסה לקצר את הטקסט')
    if (response.stop_reason === 'refusal') throw new Error('Claude סירב לנתח את הטקסט')
    throw new Error('תשובה ריקה מ-Claude')
  }
  return text
}

function extractJson(text) {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  return fenced ? fenced[1].trim() : trimmed
}

export async function analyzeCallTranscript(transcript) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcript }],
  })

  // claude-sonnet-5 can return a leading `thinking` block before the `text`
  // block, so the text isn't reliably at content[0] — find it by type instead.
  const text = responseText(response)

  let parsed
  try {
    parsed = JSON.parse(extractJson(text))
  } catch {
    throw new Error('התשובה מ-Claude לא הייתה JSON תקני')
  }

  const route = VALID_ROUTES.has(parsed.route) ? parsed.route : 'unclear'
  return {
    route,
    teacher_name_spoken: parsed.teacher_name_spoken ?? null,
    communication_type: route === 'teacher_call'
      ? (VALID_COMMUNICATION_TYPES.has(parsed.communication_type) ? parsed.communication_type : null)
      : null,
    summary: parsed.summary ?? '',
    action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
    mentioned_dates: Array.isArray(parsed.mentioned_dates) ? parsed.mentioned_dates : [],
    column_label: parsed.column_label ?? null,
  }
}

// ─── Manually typed meeting notes ──────────────────────────────────────────
// A meeting the admin typed in (AddMeetingModal / Meetings edit / dashboard "held"
// confirmation) is already known to be a meeting with known attendees, so there is no
// routing or teacher-matching here — only the same summary + follow-up extraction a
// voice-logged meeting gets.
const MEETING_NOTES_PROMPT = `אתה עוזר שמנתח תיעוד כתוב של פגישה שקיים מנטור של מורים בבית ספר עם מורה אחד או יותר.

החזר אך ורק JSON תקני בפורמט הבא, בלי שום טקסט נוסף לפניו או אחריו:
{
  "summary": "סיכום קצר של הפגישה, 2-3 משפטים",
  "action_items": [ { "text": "תיאור המטלה", "due_date": "YYYY-MM-DD או null אם לא הוזכר תאריך" } ],
  "mentioned_dates": ["YYYY-MM-DD"]
}
תאריכים יחסיים (למשל "בשבוע הבא", "ביום ראשון") חשב לפי תאריך הפגישה שיצוין. אם אין מטלות המשך, החזר "action_items": [].`

export async function analyzeMeetingNotes(content, meetingDate) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: MAX_TOKENS,
    system: MEETING_NOTES_PROMPT,
    messages: [{ role: 'user', content: `תאריך הפגישה: ${meetingDate}\n\n${content}` }],
  })

  const text = responseText(response)

  let parsed
  try {
    parsed = JSON.parse(extractJson(text))
  } catch {
    throw new Error('התשובה מ-Claude לא הייתה JSON תקני')
  }

  return {
    summary: parsed.summary ?? '',
    action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
    mentioned_dates: Array.isArray(parsed.mentioned_dates) ? parsed.mentioned_dates : [],
  }
}

// ─── Several records of the same meeting ───────────────────────────────────
// The same real-world meeting can get logged more than once on the same day (typed in
// twice, typed and also voice-logged, typed and later updated as a new entry). The
// Meetings page merges those into one meeting; this consolidates their notes.
const MERGE_MEETINGS_PROMPT = `אתה עוזר שמאחד כמה רשומות תיעוד של אותה פגישה שקיים מנטור של מורים בבית ספר. הרשומות נכתבו באותו יום, חלקן כפולות וחלקן מוסיפות או מעדכנות פרטים.

הרשומות מסודרות מהישנה לחדשה. כשיש סתירה בין רשומות — הפרט ברשומה המאוחרת יותר הוא הנכון. אל תשמיט שום מידע ייחודי שמופיע רק ברשומה אחת, ואל תחזור על אותו מידע פעמיים.

החזר אך ורק JSON תקני בפורמט הבא, בלי שום טקסט נוסף לפניו או אחריו:
{
  "content": "תיעוד מאוחד ומלא של הפגישה, בגוף ראשון כמו הרשומות המקוריות, מחולק לפסקאות לפי נושא",
  "summary": "סיכום קצר של הפגישה, 2-3 משפטים",
  "action_items": [ { "text": "תיאור המטלה", "due_date": "YYYY-MM-DD או null אם לא הוזכר תאריך" } ],
  "mentioned_dates": ["YYYY-MM-DD"],
  "sources": [ { "record": 1, "taken": "משפט או שניים: איזה מידע מהרשומה הזו נכנס לתיעוד המאוחד, ומה ממנה הוחלף בפרט מעודכן מרשומה מאוחרת יותר (אם בכלל)" } ]
}
ב-"sources" החזר פריט אחד לכל רשומה, לפי המספר שלה. אם רשומה לא תרמה שום מידע חדש, כתוב זאת במפורש.
תאריכים יחסיים (למשל "בשבוע הבא", "ביום ראשון") חשב לפי תאריך הפגישה שיצוין. אם אין מטלות המשך, החזר "action_items": [].`

export async function mergeMeetingNotes(notes, meetingDate) {
  const numbered = notes.map((note, i) => `רשומה ${i + 1}:\n${note}`).join('\n\n---\n\n')
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: MAX_TOKENS,
    system: MERGE_MEETINGS_PROMPT,
    messages: [{ role: 'user', content: `תאריך הפגישה: ${meetingDate}\n\n${numbered}` }],
  })

  const text = responseText(response)

  let parsed
  try {
    parsed = JSON.parse(extractJson(text))
  } catch {
    throw new Error('התשובה מ-Claude לא הייתה JSON תקני')
  }
  if (!parsed.content?.trim()) throw new Error('Claude לא החזיר תיעוד מאוחד')

  return {
    content: parsed.content.trim(),
    summary: parsed.summary ?? '',
    action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
    mentioned_dates: Array.isArray(parsed.mentioned_dates) ? parsed.mentioned_dates : [],
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
  }
}

// ─── Tasks inside a synced WhatsApp DM ─────────────────────────────────────
// WhatsApp sync (routes/whatsappSync.js) hands over the messages it just saved
// for one teacher; services/whatsappTasks.js files each returned task under the
// teacher or under the admin. No approval queue (spec 2026-10-01): small talk is
// left out, but an open problem the conversation never confirms as solved is kept
// (owner decision 2026-10-02 — "לא ברור אם זה בוצע ואם היא הצליחה, לכן זו משימה").
const WHATSAPP_TASKS_PROMPT = `אתה עוזר שמנתח התכתבות וואטסאפ בין אבנר (מנטור של מורים) לבין מורה אחד/ת, ומחלץ ממנה משימות.

משימה היא התחייבות או בקשה קונקרטית לעשות משהו: לשלוח קובץ, למלא טופס, להגיע לפגישה, לבדוק משהו, לחזור עם תשובה. ברכות, תודות, שיחת חולין ומידע כללי אינם משימות.

גם אלה משימות:
- הצעה או הנחיה של אבנר למורה לעשות משהו (למשל "תסתכלי בסרטון", "תנסי להיכנס דרך האתר") — משימה של המורה.
- שאלה או בעיה שהמורה העלתה, ושבהמשך ההתכתבות אין אישור מפורש שהיא נפתרה (למשל המורה לא כתבה "הצלחתי" או "הסתדרתי") — משימה פתוחה: של המורה לבצע את מה שהוצע לה, או של אבנר אם הוא התחייב לבדוק או לחזור אליה.

אבל שאלה שקיבלה תשובה מלאה (מידע או הסבר שעונה עליה, בלי פעולה שנשארה פתוחה) — אינה משימה, גם אם המורה לא אישרה שקיבלה.

- "assignee": "teacher" — משהו שהמורה התבקש/ה לעשות או התחייב/ה לעשות.
- "assignee": "admin" — משהו שאבנר התבקש לעשות או התחייב לעשות.
- "message_date" — התאריך (YYYY-MM-DD) של ההודעה שממנה עלתה המשימה, כפי שמופיע בסוגריים בתחילת השורה (אחריו מופיעים היום בשבוע והשעה).
- "due_date" — רק אם הוזכר תאריך או תאריך יחסי (חשב יחסית ל-message_date, והיעזר ביום בשבוע שמופיע בשורה עבור ביטויים כמו "ביום שלישי"), אחרת null.
- "done": true רק אם הודעה מאוחרת יותר בהתכתבות מראה במפורש שהמשימה בוצעה (למשל "שלחתי", "קיבלתי, תודה"). אחרת false.
- "🎤" בתחילת הודעה = תמלול של הודעה קולית; טקסט כמו [תמונה] או [מסמך: ...] = קובץ או מדיה שנשלחו.
- נסח כל משימה קצר וברור, בעברית, בלי שם המבצע בתחילתה.
- אל תחזיר משימה שכבר מופיעה ברשימת "משימות שכבר קיימות".

החזר אך ורק JSON תקני בפורמט הבא, בלי שום טקסט נוסף לפניו או אחריו:
{ "tasks": [ { "assignee": "teacher" | "admin", "text": "תיאור המשימה", "message_date": "YYYY-MM-DD", "due_date": "YYYY-MM-DD" | null, "done": true | false } ] }
אם אין משימות, החזר { "tasks": [] }.`

const VALID_ASSIGNEES = new Set(['teacher', 'admin'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Pure: keeps only well-formed tasks whose message_date is one of `allowedDates`. */
export function normalizeWhatsAppTasks(parsed, allowedDates) {
  const allowed = new Set(allowedDates)
  return (Array.isArray(parsed?.tasks) ? parsed.tasks : [])
    .filter(t => VALID_ASSIGNEES.has(t?.assignee))
    .filter(t => typeof t.text === 'string' && normalizeText(t.text)) // drops emoji/punctuation-only text
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

// ─── Voice-dictated tasks for the admin ────────────────────────────────────
// A recording that opens with "משימה לעצמי" / "משימה למנהל המערכת" (or that the user
// saved with the "שמור כמשימה" button) is known to be a task list for Avner himself —
// no teacher, no interaction type, no approval queue. Only the split into separate
// tasks and their due dates is left for Claude.
const ADMIN_TASKS_PROMPT = `אתה עוזר שמקבל תמלול של הודעה קולית שהקליט אבנר (מנטור של מורים) כדי לרשום משימות לעצמו.

פצל את ההודעה למשימות נפרדות — כל פעולה עצמאית שצריך לעשות היא משימה נפרדת (למשל "להתקשר לרינה ולשלוח דוח" = שתי משימות). אם יש רק דבר אחד לעשות, החזר משימה אחת.

- נסח כל משימה קצר וברור, בעברית, בלשון ציווי או שם פועל (למשל "להתקשר לרינה"). השמט את משפט הפתיחה ("משימה לעצמי", "משימה למנהל המערכת" וכדומה) ומילות מילוי.
- שמור על כל פרט חשוב שנאמר (שמות, מספרים, מה בדיוק לשלוח או לבדוק).
- "due_date" — רק אם הוזכר תאריך או תאריך יחסי (למשל "מחר", "ביום ראשון", "עד סוף החודש"); חשב אותו יחסית לתאריך היום שיצוין. אחרת null. תאריך שהוזכר חל רק על המשימה שהוא נאמר עליה, אלא אם ברור שהוא חל על כולן.
- "monthly": true רק אם נאמר במפורש שהמשימה חוזרת כל חודש (למשל "כל חודש ב-1 לחודש"); אז "due_date" הוא המופע הקרוב. אחרת false.

החזר אך ורק JSON תקני בפורמט הבא, בלי שום טקסט נוסף לפניו או אחריו:
{ "tasks": [ { "text": "תיאור המשימה", "due_date": "YYYY-MM-DD" | null, "monthly": true | false } ] }`

/** Pure: keeps only well-formed tasks; a monthly flag without a due date is dropped. */
export function normalizeAdminTasks(parsed) {
  return (Array.isArray(parsed?.tasks) ? parsed.tasks : [])
    .filter(t => typeof t?.text === 'string' && normalizeText(t.text))
    .map(t => {
      const due_date = ISO_DATE.test(t.due_date || '') ? t.due_date : null
      return { text: t.text.trim(), due_date, monthly: t.monthly === true && !!due_date }
    })
}

/** today: 'YYYY-MM-DD' (Israel); weekday: e.g. "יום ה׳" — for resolving "ביום שלישי". */
export async function analyzeAdminTasks(transcript, today, weekday) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: MAX_TOKENS,
    system: ADMIN_TASKS_PROMPT,
    messages: [{ role: 'user', content: `תאריך היום: ${today} (${weekday})\n\nההודעה:\n${transcript}` }],
  })

  const text = responseText(response)

  let parsed
  try {
    parsed = JSON.parse(extractJson(text))
  } catch {
    throw new Error('התשובה מ-Claude לא הייתה JSON תקני')
  }
  return normalizeAdminTasks(parsed)
}
