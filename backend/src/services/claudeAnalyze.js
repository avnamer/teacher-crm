import Anthropic from '@anthropic-ai/sdk'

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

function extractJson(text) {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  return fenced ? fenced[1].trim() : trimmed
}

export async function analyzeCallTranscript(transcript) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcript }],
  })

  // claude-sonnet-5 can return a leading `thinking` block before the `text`
  // block, so the text isn't reliably at content[0] — find it by type instead.
  const text = response.content?.find(block => block.type === 'text')?.text
  if (!text) throw new Error('תשובה ריקה מ-Claude')

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
