// Duplicate detection for WhatsApp sync — spec §3.3.
//
// Two checks, in order: an exact `messageId` match (WhatsApp's own id — the
// same message can never legitimately appear twice), then a normalized-text
// similarity match within the same contact/day/sender/kind (catches the same
// message re-sent or re-read with tiny formatting differences). Only the
// earliest of a duplicate pair is kept — callers pass "already accepted"
// messages as part of `existing` so within-batch duplicates are caught too.

// One tunable constant, per spec §3.3.5 ("קל לשנות אותו").
export const SIMILARITY_THRESHOLD = 0.9

function normalizeText(str) {
  return (str || '')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '') // strip punctuation/emoji, per §3.3.2
    .trim()
    .toLowerCase()
}

function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[m][n]
}

function similarity(a, b) {
  if (!a || !b) return a === b ? 1 : 0
  const dist = levenshtein(a, b)
  const maxLen = Math.max(a.length, b.length) || 1
  return 1 - dist / maxLen
}

// What actually gets compared for a message: text content for a text message,
// the full transcript (not the summary) for a voice message per §3.2's last
// bullet, and label+caption for media.
function contentKey(msg) {
  if (msg.kind === 'voice') return normalizeText(msg.transcript || '')
  if (msg.kind === 'media') return normalizeText(`${msg.mediaLabel || ''} ${msg.text || ''}`)
  return normalizeText(msg.text || '')
}

export function israelDateStr(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

/** Is `candidate` a duplicate of any message in `existing`? Caller is responsible
 * for only passing messages from the same contact + calendar day. */
export function isDuplicate(candidate, existing) {
  if (candidate.messageId && existing.some(m => m.messageId === candidate.messageId)) {
    return true
  }
  const key = contentKey(candidate)
  if (!key) return false
  return existing.some(m => {
    if (m.sender !== candidate.sender || m.kind !== candidate.kind) return false
    const otherKey = contentKey(m)
    return otherKey && similarity(key, otherKey) >= SIMILARITY_THRESHOLD
  })
}
