import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `אתה עוזר שמנתח תמרול של שיחת טלפון בין מורה מנטור לבין מורה בבית ספר.
החזר אך ורק JSON תקני בפורמט הבא, בלי שום טקסט נוסף לפניו או אחריו:
{
  "teacher_name_spoken": "השם שנאמר עבור המורה, כפי שנשמע בתמלול",
  "summary": "סיכום קצר של השיחה, 2-3 משפטים",
  "action_items": [ { "text": "תיאור המטלה", "due_date": "YYYY-MM-DD או null אם לא הוזכר תאריך" } ],
  "mentioned_dates": ["YYYY-MM-DD"]
}
אם לא הוזכר שם מורה, החזר "teacher_name_spoken": null. אם אין מטלות המשך, החזר "action_items": [].`

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

  const text = response.content?.[0]?.text
  if (!text) throw new Error('תשובה ריקה מ-Claude')

  let parsed
  try {
    parsed = JSON.parse(extractJson(text))
  } catch {
    throw new Error('התשובה מ-Claude לא הייתה JSON תקני')
  }

  return {
    teacher_name_spoken: parsed.teacher_name_spoken ?? null,
    summary: parsed.summary ?? '',
    action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
    mentioned_dates: Array.isArray(parsed.mentioned_dates) ? parsed.mentioned_dates : [],
  }
}
