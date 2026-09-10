function normalize(str) {
  return (str || '').trim().replace(/\s+/g, ' ').toLowerCase()
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
  if (!a || !b) return 0
  const dist = levenshtein(a, b)
  const maxLen = Math.max(a.length, b.length) || 1
  return 1 - dist / maxLen
}

const CERTAIN_THRESHOLD = 0.75
const CANDIDATE_THRESHOLD = 0.5
const MAX_CANDIDATES = 5

// Matches a spoken name against a list of { id, name } teachers.
// Returns { certain: teacher|null, candidates: teacher[] }.
export function matchTeacher(spokenName, teachers) {
  const spoken = normalize(spokenName)
  if (!spoken || !teachers?.length) return { certain: null, candidates: [] }

  const scored = teachers
    .map(teacher => ({ teacher, score: similarity(spoken, normalize(teacher.name)) }))
    .sort((a, b) => b.score - a.score)

  const certain = scored.filter(s => s.score >= CERTAIN_THRESHOLD)
  if (certain.length === 1) {
    return { certain: certain[0].teacher, candidates: [] }
  }
  if (certain.length > 1) {
    return { certain: null, candidates: certain.slice(0, MAX_CANDIDATES).map(s => s.teacher) }
  }

  const loose = scored.filter(s => s.score >= CANDIDATE_THRESHOLD).slice(0, MAX_CANDIDATES)
  return { certain: null, candidates: loose.map(s => s.teacher) }
}
