import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
}

// Tokens are stored in Supabase (settings.google_calendar_tokens) rather than
// on local disk — Render's free tier filesystem is ephemeral and wipes local
// files on every restart/redeploy, which was silently breaking Calendar auth.
export async function saveTokens(tokens) {
  const { error } = await supabase
    .from('settings')
    .update({ google_calendar_tokens: tokens })
    .eq('id', 'global')
  if (error) throw new Error('שגיאה בשמירת טוקן Google: ' + error.message)
}

export async function loadTokens() {
  const { data, error } = await supabase
    .from('settings')
    .select('google_calendar_tokens')
    .eq('id', 'global')
    .single()
  if (error) return null
  return data?.google_calendar_tokens ?? null
}

// ─── Matching logic ────────────────────────────────────────────────────────

const POSITIVE_KEYWORDS = ['פגישה', 'שיחה', 'ביקור', 'זום', 'zoom', 'meeting', 'לפגוש', 'פגש', 'מפגש']
const PERSONAL_CONTEXT = ['בעבודה', 'הופעה', 'יומולדת', 'חדר בריחה', 'דייט', 'בירה', 'ארוחה', 'חתונה', 'בר מצוה']
const START_DATE = '2025-09-01'

function wordIn(word, text) {
  if (!word || !text) return false
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[\\s,.()])${escaped}($|[\\s,.()])`).test(text)
}

function findMatchingTeacher(event, teachers) {
  const summary = event.summary || ''
  const isAllDay = Boolean(event.start?.date && !event.start?.dateTime)

  for (const teacher of teachers) {
    const nameParts = teacher.name.split(' ')
    const firstName = nameParts[0]
    const lastName = nameParts.slice(1).join(' ')
    const school = teacher.school || ''

    // Condition 1: first + (last or school)
    if (
      wordIn(firstName, summary) &&
      ((lastName && summary.includes(lastName)) || (school && summary.includes(school)))
    ) return teacher

    // Condition 2: keyword + first name
    const hasKeyword = POSITIVE_KEYWORDS.some(kw => summary.includes(kw))
    if (hasKeyword && wordIn(firstName, summary)) return teacher

    // Condition 3: standalone first name (timed events only, no personal context)
    const hasPersonal = PERSONAL_CONTEXT.some(pc => summary.includes(pc))
    if (!isAllDay && !hasPersonal && firstName.length >= 3 && wordIn(firstName, summary)) return teacher
  }
  return null
}

// ─── Main sync ─────────────────────────────────────────────────────────────

export async function syncCalendarMeetings() {
  const tokens = await loadTokens()
  if (!tokens) throw new Error('לא נמצאו טוקנים של Google — בצע אימות תחילה')

  const auth = getOAuth2Client()
  auth.setCredentials(tokens)

  // Refresh token if needed
  if (tokens.expiry_date && Date.now() > tokens.expiry_date - 60000) {
    const { credentials } = await auth.refreshAccessToken()
    await saveTokens(credentials)
    auth.setCredentials(credentials)
  }

  const calendar = google.calendar({ version: 'v3', auth })

  // Load all contacts
  const { data: teachers, error: tErr } = await supabase.from('contacts').select('*').eq('role', 'מורה מוביל/ה').contains('custom_fields', { mentor_name: 'אבנר' })
  if (tErr) throw new Error('שגיאה בטעינת אנשי קשר: ' + tErr.message)

  // Load existing google_event_ids to prevent duplicates
  const { data: existingMeetings } = await supabase
    .from('meetings')
    .select('google_event_id')
    .not('google_event_id', 'is', null)
  const existingIds = new Set((existingMeetings || []).map(m => m.google_event_id))

  // Fetch events from all calendars
  const { data: calList } = await calendar.calendarList.list()
  const calendarIds = (calList.items || []).map(c => c.id)

  let added = 0
  let skipped = 0
  const unmatched = []

  for (const calId of calendarIds) {
    let pageToken = null
    do {
      const { data } = await calendar.events.list({
        calendarId: calId,
        timeMin: new Date(START_DATE).toISOString(),
        timeMax: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        maxResults: 250,
        singleEvents: true,
        orderBy: 'startTime',
        pageToken: pageToken || undefined,
      })

      for (const event of data.items || []) {
        if (event.status === 'cancelled') continue
        const summary = event.summary || ''
        if (!summary.trim()) continue

        if (existingIds.has(event.id)) {
          skipped++
          continue
        }

        const teacher = findMatchingTeacher(event, teachers)

        if (!teacher) {
          const hasKeyword = POSITIVE_KEYWORDS.some(kw => summary.includes(kw))
          if (hasKeyword) {
            unmatched.push(summary)
            console.log(`[לא זוהה מורה] "${summary}"`)
          }
          continue
        }

        const scheduledAt = event.start.dateTime
          ? event.start.dateTime
          : `${event.start.date}T09:00:00`

        const { error } = await supabase.from('meetings').insert({
          contact_id: teacher.id,
          scheduled_at: scheduledAt,
          duration_minutes: event.start.dateTime && event.end.dateTime
            ? Math.round((new Date(event.end.dateTime) - new Date(event.start.dateTime)) / 60000)
            : 30,
          status: new Date(scheduledAt) < new Date() ? 'completed' : 'scheduled',
          google_event_id: event.id,
          notes: event.description || null,
        })

        if (error) {
          console.error(`[שגיאה] ${summary}:`, error.message)
        } else {
          console.log(`[נוסף] ${summary} → ${teacher.name}`)
          existingIds.add(event.id)
          added++
        }
      }

      pageToken = data.nextPageToken
    } while (pageToken)
  }

  return { added, skipped, unmatched }
}

// ─── Create a calendar event for a call-log action item ───────────────────

export async function createCalendarEvent({ title, date, notes }) {
  const tokens = await loadTokens()
  if (!tokens) {
    const err = new Error('לא נמצאו טוקנים של Google — בצע אימות תחילה')
    err.code = 'NO_TOKENS'
    throw err
  }
  if (!tokens.scope || !tokens.scope.includes('calendar.events')) {
    const err = new Error('אין הרשאת כתיבה ליומן — יש להתחבר מחדש ל-Google')
    err.code = 'MISSING_SCOPE'
    throw err
  }

  const auth = getOAuth2Client()
  auth.setCredentials(tokens)

  if (tokens.expiry_date && Date.now() > tokens.expiry_date - 60000) {
    const { credentials } = await auth.refreshAccessToken()
    await saveTokens(credentials)
    auth.setCredentials(credentials)
  }

  const calendar = google.calendar({ version: 'v3', auth })
  const nextDay = new Date(date)
  nextDay.setDate(nextDay.getDate() + 1)
  const endDate = nextDay.toISOString().slice(0, 10)

  const { data } = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      description: notes || '',
      start: { date },
      end: { date: endDate },
    },
  })

  return { eventId: data.id }
}
