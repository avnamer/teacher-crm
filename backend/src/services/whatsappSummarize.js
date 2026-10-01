import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// A recording this short reads fine in full — summarizing it would just paraphrase
// the same few words, so spec §3.2 skips the AI step entirely below this length
// and the frontend shows the full transcript instead (label "תמלול הקלטה").
const SHORT_RECORDING_WORD_COUNT = 25

const SYSTEM_PROMPT = `אתה מסכם תמלול של הודעה קולית בוואטסאפ בין מנטור למורה בבית ספר.
כתוב משפט אחד או שניים בעברית, בגוף שלישי, עם הנקודות המהותיות: מה נאמר, בקשות, תאריכים ומשימות.
החזר אך ורק את הסיכום עצמו — בלי מבוא, בלי גרשיים, בלי טקסט נוסף.`

/**
 * Summarizes a voice-message transcript, or returns null for a short recording
 * (caller then displays the full transcript instead — same UI treatment as a
 * summarization failure, so callers don't need to distinguish the two).
 */
export async function summarizeVoiceMessage(transcript) {
  const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length
  if (wordCount <= SHORT_RECORDING_WORD_COUNT) return null

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcript }],
  })
  const text = response.content?.find(block => block.type === 'text')?.text
  return text?.trim() || null
}
