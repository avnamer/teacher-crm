// Runs on web.whatsapp.com. Reads what's already displayed by the official web
// client — never sends messages, never talks to WhatsApp's servers directly,
// never uses an unofficial protocol library. All backend calls go through the
// background service worker via chrome.runtime.sendMessage (see background.js
// for why: CORS/host_permissions reliability, and this content script has no
// API token of its own).
//
// NOTE for whoever picks this up after a real test run: WhatsApp Web's DOM
// changes periodically. The selectors in selectors.js are this file's single
// point of adjustment — if sync starts failing, check there first. The
// data-pre-plain-text timestamp parser (parsePrePlainText below) is the most
// locale-sensitive part; it was written to the documented format but not
// verified against a live account.

// Bump this string on every edit to this file. Log it loudly on load so a
// "still seeing the old error" report can be checked in 2 seconds instead of
// guessing whether the extension+tab reload actually picked up the latest
// code (this has been the actual cause more than once during testing).
const CONTENT_JS_BUILD = '2026-10-07-33'
console.log(`%c[whatsapp-sync] content.js loaded — build ${CONTENT_JS_BUILD}`, 'color: #2563eb; font-weight: bold')

// Confirmed live (2026-09-29): WhatsApp's virtualized list only responds to
// genuinely-trusted input — no synthetic dispatchEvent() sequence (even a
// full pointerdown/mousedown/up/click set) reliably worked; it sometimes
// silently did nothing. realClick asks background.js to dispatch the click
// via chrome.debugger (CDP), which the browser treats as trusted, same as
// real hardware input — see the comment on dispatchRealClick there.
// Confirmed live (2026-09-29): a real crash, not just a bad click — clicking
// an element currently scrolled out of view (getBoundingClientRect returns
// coordinates outside the viewport, e.g. negative, for anything above/below
// what's currently visible) makes CDP reject the command outright
// (code -32602 "Position out of bounds"), and that error wasn't being caught
// anywhere local to the click — it escaped all the way up and killed the
// ENTIRE group/DM sync partway through, not just the one row being clicked.
// scrollIntoView first so the element is guaranteed on-screen before its
// rect is read; the clamp below is just a last-resort safety net on top.
async function realClick(el) {
  el.scrollIntoView({ block: 'center', inline: 'center' })
  await sleep(50) // let the scroll's layout/reflow settle before reading the rect
  const rect = el.getBoundingClientRect()
  const x = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1)
  const y = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1)
  await toBackground('debuggerClick', { x, y })
}

// Same trust requirement applies to scrolling — see the loop in
// collectMessages below for why this matters (loading older history). Same
// out-of-bounds clamp as realClick, as a safety net.
async function realScrollAt(el, deltaY) {
  const rect = el.getBoundingClientRect()
  const x = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1)
  const y = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1)
  await toBackground('debuggerScroll', { x, y, deltaY })
}

const HUMAN_DELAY_MIN_MS = 2000
const HUMAN_DELAY_MAX_MS = 4000
const FIRST_SYNC_BACKFILL_DAYS = 30
const MAX_SCROLL_ATTEMPTS = 400 // hard stop so a selector miss can't scroll forever

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function humanDelay() {
  return sleep(HUMAN_DELAY_MIN_MS + Math.random() * (HUMAN_DELAY_MAX_MS - HUMAN_DELAY_MIN_MS))
}

function toBackground(action, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, ...payload }, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
      if (response?.error) return reject(new Error(response.error))
      resolve(response)
    })
  })
}

// ─── Timestamp / sender parsing ────────────────────────────────────────────

// data-pre-plain-text looks like "[17:00, 9/15/2026] " for a DM, or
// "[17:00, 9/15/2026] אבנר פיפרברג: " for a group message (WhatsApp includes
// the sender's own name here even for messages I sent myself, in a group).
// Confirmed live (2026-09-27) on a Hebrew-UI, Israel-region account: 24h
// clock, and — despite the Hebrew UI — US-style MONTH/DAY/YEAR ordering, not
// day/month. Handles a 12h AM/PM variant too in case another account's locale
// differs, but month/day/year is the confirmed real case.
function parsePrePlainText(str) {
  const match = str?.match(/\[(\d{1,2}):(\d{2})(?:\s*(AM|PM|am|pm))?,\s*(\d{1,4})[./](\d{1,2})[./](\d{1,4})\]\s*(.*?):?\s*$/)
  if (!match) return null
  let [, hh, mm, ampm, d1, d2, d3, sender] = match
  let hour = parseInt(hh, 10)
  if (ampm) {
    const isPM = ampm.toLowerCase() === 'pm'
    if (isPM && hour < 12) hour += 12
    if (!isPM && hour === 12) hour = 0
  }
  // Figure out which of d1/d2/d3 is the 4-digit year; the other two are
  // month/day in that order (confirmed), falling back to a 2-digit year in
  // the unlikely case neither is 4 digits.
  let year, month, day
  if (d3.length === 4) { year = +d3; month = +d1; day = +d2 }
  else if (d1.length === 4) { year = +d1; month = +d2; day = +d3 }
  else { year = 2000 + (+d3); month = +d1; day = +d2 }
  const date = new Date(year, month - 1, day, hour, +mm)
  if (Number.isNaN(date.getTime())) return null
  return { timestamp: date.toISOString(), sender: (sender || '').trim() || null }
}

// Confirmed live (2026-09-29): the duration text ("0:12") sits in a plain
// leaf <div> with no distinguishing attribute at all — no testid, no
// aria-label — unlike everything else in this row. It's found by shape
// instead: the only leaf div whose whole text is exactly "M:SS". The row's
// OWN message time (e.g. "17:43") is in a <span>, not a <div>, so this
// doesn't collide with it.
function findVoiceDurationText(row) {
  const candidate = [...row.querySelectorAll('div')].find(el =>
    el.children.length === 0 && /^\d{1,2}:\d{2}$/.test((el.textContent || '').trim())
  )
  return candidate?.textContent || null
}

function parseDuration(text) {
  const m = text?.match(/(\d+):(\d{2})/)
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

function parseTimeOnly(text) {
  const m = text?.match(/(\d{1,2}):(\d{2})/)
  if (!m) return null
  return { hour: parseInt(m[1], 10), minute: parseInt(m[2], 10) }
}

// Finds the date ("M/D/YYYY") shown by the nearest date-divider that appears
// BEFORE `row` in document order — the fallback date source for a row with no
// data-pre-plain-text at all (voice messages — see extractMessage). The
// divider is a plain leaf <span> with no stable class/testid found, so it's
// matched by its text shape instead.
// Confirmed live bug (2026-09-30): a message sent today or yesterday sits
// under a "Today"/"Yesterday" divider, not a literal M/D/YYYY date — this
// regex only ever matched the literal-date form, so nearestDividerDate
// silently returned null for anything under a relative-date divider
// (dropping today's/yesterday's voice messages entirely, since that's the
// only timestamp source they have). Covers the Hebrew UI's own wording too.
//
// Confirmed live bug (2026-09-30), found on a DIFFERENT contact: WhatsApp
// uses a THIRD divider form for the last ~week — a bare day-of-week name
// ("Thursday"), neither a literal date nor "Today"/"Yesterday". That form
// wasn't recognized either, and being excluded from the divider candidate
// list entirely (not just unparseable) meant nearestDividerDate silently
// skipped past it to whatever OLDER divider it could recognize instead —
// mis-filing that day's voice messages under a completely wrong, much
// earlier date rather than just dropping them.
const WEEKDAY_NAMES_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const WEEKDAY_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

function weekdayIndexOf(text) {
  const i = WEEKDAY_NAMES_EN.indexOf(text.toLowerCase())
  if (i >= 0) return i
  return WEEKDAY_NAMES_HE.indexOf(text)
}

function isDividerText(text) {
  return /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)
    || /^(today|yesterday|היום|אתמול)$/i.test(text)
    || weekdayIndexOf(text) >= 0
}

function nearestDividerDate(row, pane) {
  const dividers = [...pane.querySelectorAll('span')].filter(el =>
    el.children.length === 0 && isDividerText((el.textContent || '').trim())
  )
  let found = null
  for (const div of dividers) {
    if (div.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) found = div.textContent.trim()
  }
  return found
}

// Same month/day/year convention confirmed for parsePrePlainText above, plus
// "Today"/"Yesterday" (see isDividerText above).
function combineDateAndTime(dateStr, time) {
  if (!time || !dateStr) return null
  let year, month, day
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    month = +m[1]; day = +m[2]; year = +m[3]
  } else if (/^(today|היום)$/i.test(dateStr)) {
    const now = new Date()
    year = now.getFullYear(); month = now.getMonth() + 1; day = now.getDate()
  } else if (/^(yesterday|אתמול)$/i.test(dateStr)) {
    const y = new Date(Date.now() - 24 * 3600 * 1000)
    year = y.getFullYear(); month = y.getMonth() + 1; day = y.getDate()
  } else if (weekdayIndexOf(dateStr) >= 0) {
    // WhatsApp only uses a bare weekday name for the last ~week, never for
    // today/yesterday (those get their own divider, handled above) — so the
    // right occurrence is always the most recent PAST one, 2–6 days back.
    const now = new Date()
    const diff = ((now.getDay() - weekdayIndexOf(dateStr) + 7) % 7) || 7
    const d = new Date(now.getTime() - diff * 24 * 3600 * 1000)
    year = d.getFullYear(); month = d.getMonth() + 1; day = d.getDate()
  } else {
    return null
  }
  const date = new Date(year, month - 1, day, time.hour, time.minute)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

// ─── Message extraction ────────────────────────────────────────────────────

function messageKindOf(row) {
  if (queryFirst(WA_SELECTORS.voiceNode, row)) return 'voice'
  if (
    queryFirst(WA_SELECTORS.imageNode, row) ||
    queryFirst(WA_SELECTORS.documentNode, row) ||
    queryFirst(WA_SELECTORS.stickerNode, row) ||
    queryFirst(WA_SELECTORS.videoNode, row)
  ) return 'media'
  return 'text'
}

function mediaLabelOf(row) {
  if (queryFirst(WA_SELECTORS.imageNode, row)) return '[תמונה]'
  if (queryFirst(WA_SELECTORS.stickerNode, row)) return '[סטיקר]'
  if (queryFirst(WA_SELECTORS.videoNode, row)) return '[וידאו]'
  const doc = queryFirst(WA_SELECTORS.documentNode, row)
  if (doc) {
    const nameNode = queryFirst(WA_SELECTORS.documentFilename, row)
    return `[מסמך${nameNode?.textContent ? ': ' + nameNode.textContent.trim() : ''}]`
  }
  return '[קובץ מצורף]'
}

// Confirmed live bug (2026-09-29): a message with bold-formatted runs (e.g. a
// forwarded list with "*Label:* value" lines) splits into SEVERAL separate
// span[data-testid="selectable-text"] elements — one per bold run — with the
// plain paragraph text in between belonging to none of them. Reading just the
// first match (the old messageTextNode approach) silently truncated the
// message down to a single line. The pre-plain-text container itself
// (preNode) reliably has the FULL text as descendant text — including, for a
// forwarded/media message, decorative junk from nested icons (SVG <title>
// text) and labels ("Forwarded", the attachment's own duration badge) that
// need stripping first.
function extractFullText(preNode) {
  if (!preNode) return ''
  const clone = preNode.cloneNode(true)
  clone.querySelectorAll('svg').forEach(el => el.remove())
  return (clone.textContent || '')
    .replace(/^Forwarded/, '')
    .replace(/^הועבר/, '')
    .replace(/^\s*\d{1,2}:\d{2}\s*/, '') // a leading video/doc duration badge
    .replace(/(\d{1,2}:\d{2})+$/, '') // the message's own timestamp, doubled up
    .trim()
}

// Extracts everything we can read synchronously from one message row. Voice
// audio itself (which needs an async fetch + backend round trip) is filled
// in separately by resolveVoiceMessage() before the message is sent for
// saving.
//
// Confirmed live regression (2026-09-30): a retry-with-delay mechanism was
// added here to work around confirmed WhatsApp DOM instability (the exact
// same live query for "rows shaped like a voice message" returned 3 matches,
// then moments later — nothing scrolled — returned 0). It backfired badly:
// a WHOLE conversation that previously captured in full (just with a few
// wrong dates on some voice messages) collapsed to capturing a single
// message, text included, once retries were added. Whatever the retries
// were reacting to, re-querying the row after a delay made things worse, not
// better, for ordinary text messages too — not just the voice edge case it
// was meant to fix. Back to synchronous, no retries; debug logging (harmless)
// kept for the still-open voice-classification mystery.
function extractMessage(row, pane, fallbackTimestamp) {
  // TEMP DEBUG (2026-09-30, remove once the silently-dropped-voice-message
  // mystery is fully closed out): a shape-matched duration text identifies a
  // voice row independent of messageId/timestamp parsing succeeding, so we
  // can log a row that LOOKS like a voice message even if it fails the
  // normal voice-handling checks below.
  const debugDuration = [...row.querySelectorAll('div')].find(
    el => el.children.length === 0 && /^\d{1,2}:\d{2}$/.test((el.textContent || '').trim())
  )?.textContent

  // Confirmed live: data-id sits on a descendant of the row, not the row
  // itself and not an ancestor.
  const messageId = row.querySelector('[data-id]')?.getAttribute('data-id')
  if (!messageId) {
    if (debugDuration) console.log('[whatsapp-sync] DEBUG: row with duration', debugDuration, 'has NO messageId — dropped')
    return null
  }

  const preNode = queryFirst(WA_SELECTORS.prePlainTextNode, row)
  let parsed = parsePrePlainText(preNode?.getAttribute('data-pre-plain-text'))
  if (!parsed) {
    // Confirmed live (2026-09-29): a voice-message row carries NO
    // data-pre-plain-text anywhere (there's no "copyable text" for WhatsApp
    // to hang it on) — without this fallback, every voice message was
    // silently dropped right here, before messageKindOf even ran. Fall back
    // to msg-meta's time-only text plus the nearest preceding date divider.
    const metaNode = queryFirst(WA_SELECTORS.messageMetaNode, row)
    const time = parseTimeOnly(metaNode?.textContent)
    const dividerDate = time ? nearestDividerDate(row, pane) : null
    let timestamp = dividerDate ? combineDateAndTime(dividerDate, time) : null
    // Confirmed live bug (2026-09-30): a synthetic "moment after the
    // previous message" timestamp was meant ONLY for a confirmed voice
    // message WhatsApp visually groups without its own msg-meta — but
    // applying it here, before messageKindOf has even run, fired for ANY
    // row that failed real timestamp parsing for whatever reason. That
    // fabricated a chain of fake sequential timestamps for unrelated rows —
    // including re-dating a real message from a completely different day
    // into today's bucket under a false time. Restricting it to a
    // pre-checked voice row only — messageKindOf itself doesn't need a
    // timestamp, so it's safe to call early just for this check.
    if (!timestamp && fallbackTimestamp && messageKindOf(row) === 'voice') {
      timestamp = new Date(new Date(fallbackTimestamp).getTime() + 1000).toISOString()
    }
    if (!timestamp) {
      if (debugDuration) {
        console.log(
          '[whatsapp-sync] DEBUG: messageId', messageId, 'duration', debugDuration, 'has NO timestamp — dropped.',
          'metaNode found:', !!metaNode, 'metaText:', JSON.stringify(metaNode?.textContent),
          'time parsed:', JSON.stringify(time), 'dividerDate:', dividerDate, 'fallbackTimestamp:', fallbackTimestamp
        )
      }
      return null
    }
    // TEMP DEBUG (2026-09-30, remove alongside the above): success path too —
    // need to see which divider actually got picked, not just failures,
    // since a wrong-but-non-null divider silently mis-files a message under
    // the wrong day instead of dropping it.
    if (debugDuration) {
      console.log(
        '[whatsapp-sync] DEBUG: messageId', messageId, 'duration', debugDuration,
        'metaText:', JSON.stringify(metaNode?.textContent), 'time parsed:', JSON.stringify(time),
        'dividerDate USED:', dividerDate, 'final timestamp:', timestamp
      )
    }
    parsed = { timestamp, sender: null }
  }

  // Two independent-ish signals for "did I send this" — see the comment on
  // outgoingTailNode in selectors.js for the known risk (may not hold for
  // every message in a consecutive run from the same sender).
  const sender = (queryFirst(WA_SELECTORS.outgoingTailNode, row) || queryFirst(WA_SELECTORS.outgoingAriaNode, row))
    ? 'me' : 'teacher'
  const kind = messageKindOf(row)
  // Diagnostic only (see top-of-function comment on why no retry lives here
  // or anywhere else in this function anymore).
  if (debugDuration && kind !== 'voice') {
    console.log('[whatsapp-sync] DEBUG: messageId', messageId, 'has duration', debugDuration, 'but messageKindOf() said kind=', kind, '(not voice)')
  }

  const base = { messageId, timestamp: parsed.timestamp, sender, kind, groupSenderName: parsed.sender }

  if (kind === 'voice') {
    const durationSec = parseDuration(findVoiceDurationText(row))
    console.log('[whatsapp-sync] extracted voice message', messageId, 'durationSec=', durationSec, 'timestamp=', parsed.timestamp)
    return { ...base, durationSec, _row: row }
  }
  if (kind === 'media') {
    return { ...base, mediaLabel: mediaLabelOf(row), text: extractFullText(preNode) || null }
  }
  return { ...base, text: extractFullText(preNode) }
}

// Voice messages need their real audio captured then sent to the backend for
// Whisper transcription. Confirmed live (2026-09-29): reading an <audio>
// element's src (the old approach) never works — WhatsApp Web's voice-note
// playback doesn't go through any JS-observable API at all, even though real
// sound does come out of the speakers. captureVoicePlayback (background.js)
// records the tab's actual audio output via chrome.tabCapture while this
// clicks play, which works regardless of WhatsApp's internal mechanism.
// Mutates and returns `message`.
async function resolveVoiceMessage(message) {
  const row = message._row
  delete message._row
  try {
    // Confirmed live (2026-09-30): WhatsApp Web auto-plays the NEXT voice
    // message once the current one finishes on its own — a side effect of
    // letting messages play their full real length. If this row is already
    // mid-autoplay by the time we reach it, pause it first so our own click
    // below starts a clean, known-position capture from the beginning
    // instead of grabbing only whatever's left of an already-in-progress
    // (and position-wise unknown) playback.
    const pauseBtn = queryFirst(WA_SELECTORS.voicePauseButton, row)
    if (pauseBtn) {
      await realClick(pauseBtn)
      await sleep(300)
    }
    let playBtn = queryFirst(WA_SELECTORS.voicePlayButton, row)
    if (!playBtn) {
      // Confirmed live (2026-09-29): a voice note WhatsApp hasn't locally
      // cached yet only shows a "Download voice message" button — clicking
      // it fetches the encrypted media, then WhatsApp swaps the button to
      // "Play voice message" once it's ready.
      const downloadBtn = queryFirst(WA_SELECTORS.voiceDownloadButton, row)
      if (downloadBtn) {
        await realClick(downloadBtn)
        for (let i = 0; i < 25 && !playBtn; i++) {
          await sleep(200)
          playBtn = queryFirst(WA_SELECTORS.voicePlayButton, row)
        }
      }
    }
    if (!playBtn) {
      message.transcriptionStatus = 'failed'
      return message
    }
    // Confirmed live (2026-09-30): the offscreen document waits for real
    // speech to start (unknown delay before WhatsApp's playback actually
    // begins), then records for the message's own known length — durationSec
    // read straight from the DOM's "0:26" label is ground truth, not a
    // guess, so a small buffer for rounding is enough (a silence-gap-based
    // stop was tried first and cut longer messages off mid-sentence, since
    // natural speech pauses exceed any short silence threshold). maxMs is
    // just the outer safety cap so a stuck stream can't hang the sync.
    // Re-read the duration fresh here rather than trusting message.durationSec
    // (read at extraction time, possibly while this row was still mid-
    // autoplay from the pause-button case above) — while auto-playing,
    // WhatsApp shows a ticking elapsed-time counter in that same spot
    // instead of the true total length, which would size the capture window
    // far too short.
    const freshDurationSec = parseDuration(findVoiceDurationText(row))
    if (freshDurationSec) message.durationSec = freshDurationSec // keep what gets saved accurate too
    const durationMs = Math.round((freshDurationSec || message.durationSec || 3) * 1000) + 1000
    const maxMs = Math.min(45000, durationMs + 15000)
    // prepareVoiceCapture (offscreen doc creation + getMediaStreamId +
    // starting the recorder) takes a variable, sometimes large amount of
    // time — confirmed live (2026-09-29) that clicking with coordinates
    // computed BEFORE this setup often missed, because the page had shifted
    // by the time background actually dispatched the click. Re-query the
    // button fresh right before clicking instead of trusting an earlier rect.
    await toBackground('prepareVoiceCapture', {})
    const freshPlayBtn = queryFirst(WA_SELECTORS.voicePlayButton, row) || playBtn
    await realClick(freshPlayBtn)
    const { audioBase64, mimeType } = await toBackground('finishVoiceCapture', { durationMs, maxMs })
    const result = await toBackground('transcribeVoice', { audioBase64, mimeType })
    message.transcript = result.transcript
    message.summary = result.summary
    message.transcriptionStatus = result.transcriptionStatus
    message.transcriptionRetries = (message.transcriptionRetries || 0) + (result.transcriptionStatus === 'failed' ? 1 : 0)
  } catch (err) {
    console.error('[whatsapp-sync] voice resolve failed:', err)
    message.transcriptionStatus = 'failed'
    message.transcriptionRetries = (message.transcriptionRetries || 0) + 1
  }
  return message
}

// ─── Chat navigation + scroll collection ───────────────────────────────────

// execCommand('insertText', ...) inserts at the cursor — it does NOT replace
// existing content on its own. Without selectAll first, a second search
// (e.g. a group name right after a phone number) lands appended to the
// previous search's leftover text instead of replacing it, producing one
// long garbled query neither search matches anything against.
function clearAndType(searchBox, text) {
  searchBox.focus()
  document.execCommand('selectAll')
  document.execCommand('insertText', false, text)
  searchBox.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

// Re-queries the search box fresh (WhatsApp may have swapped in a new node
// after navigating into a chat) rather than reusing a possibly-stale
// reference, and never throws — this is a courtesy cleanup, not something
// worth failing a whole sync run over.
function clearSearchBoxSafely() {
  try {
    const fresh = queryFirst(WA_SELECTORS.chatSearchBox, document)
    if (fresh) clearAndType(fresh, '')
  } catch { /* best-effort */ }
}

// The id of whatever message is currently first in the DOM, or null if none —
// used as a fingerprint of "which chat is currently open" (data-ids are
// globally unique across all chats, so a change here reliably means the
// panel switched to a different conversation).
function currentFirstMessageId() {
  const row = queryFirst(WA_SELECTORS.messageRow, document)
  return row?.querySelector('[data-id]')?.getAttribute('data-id') || null
}

// Confirmed live bug (2026-09-28): right after clicking a search result, the
// PREVIOUS chat's messages can still be the ones in the DOM for a beat before
// WhatsApp swaps the panel — reading immediately attributed one teacher's
// messages to a different teacher's contact card. This waits for the visible
// message set to actually change (or times out and returns false, since a
// genuinely identical case — e.g. a chat with zero messages — would otherwise
// hang forever).
async function waitForChatSwitch(previousFirstId) {
  for (let i = 0; i < 20; i++) {
    if (currentFirstMessageId() !== previousFirstId) return true
    await sleep(150)
  }
  return false
}

// realClick (trusted, via chrome.debugger) should work on the first try —
// kept as a short retry loop anyway since real-world timing still varies.
async function clickUntilChatOpens(item, previousFirstId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await realClick(item)
    if (await waitForChatSwitch(previousFirstId)) return true
  }
  return false
}

// DMs no longer open via search+click here at all — confirmed live
// (2026-09-29) that even clickUntilChatOpens's retries could land on the
// wrong chat (a stale click resolving against whatever was previously open).
// background.js now navigates the tab straight to
// web.whatsapp.com/send?phone=..., which reliably opens the right DM every
// time, then messages this file (see the 'readDM' handler below) once the
// correct chat is already on screen. Groups have no such deep link, so they
// still go through search+click, immediately below.

async function openChatByName(name) {
  const searchBox = requireFirst(WA_SELECTORS.chatSearchBox, document, 'תיבת חיפוש')
  const before = currentFirstMessageId()
  clearAndType(searchBox, name)
  // Confirmed live (2026-09-28): results are present in the DOM well before
  // a click on them actually navigates — 800ms wasn't enough real settle time.
  await sleep(1800)
  const items = queryAllFirst(WA_SELECTORS.chatListItem, document)
  const match = items.find(item => {
    const title = queryFirst(WA_SELECTORS.chatListItemTitle, item)
    return title?.textContent?.trim() === name
  })
  if (!match) return false
  const switched = await clickUntilChatOpens(match, before)
  clearSearchBoxSafely()
  return switched
}

// Finds the actual scrollable ancestor of a message row by walking up the DOM
// and checking real scroll geometry (scrollHeight > clientHeight + an
// overflow-y that allows scrolling), instead of guessing a class/testid for
// it. WhatsApp's wrapper class names are auto-generated (see selectors.js's
// comment on the search box) and churn far more than the underlying
// scrolling behavior does, so this is more durable than a hardcoded selector
// — it was written this way specifically because that selector couldn't be
// confirmed live before this file needed to keep working unattended.
function findScrollableAncestor(el) {
  let node = el?.parentElement
  while (node && node !== document.body) {
    const style = getComputedStyle(node)
    if (node.scrollHeight > node.clientHeight + 10 && /(auto|scroll)/.test(style.overflowY)) {
      return node
    }
    node = node.parentElement
  }
  return null
}

// Waits for at least one message row to exist in the DOM (there's a brief
// render delay right after opening a chat), then resolves the pane to scroll
// from its ancestry. Falls back to #main if no scrollable ancestor is found —
// still lets a short/empty chat's messages (already all on screen, nothing to
// scroll) get read even if the walk-up comes back empty.
async function waitForMessagePane() {
  // Confirmed live (2026-09-28): a chat opened via a programmatic search-click
  // can take well over 3s to actually mount its message list (media-heavy
  // chats especially — voice notes, forwards) even though the click itself
  // succeeded. 20×150ms=3s was too short and threw "no messages" on a chat
  // that plainly had messages a moment later. 60×150ms=9s gives real room.
  let row = null
  for (let i = 0; i < 60 && !row; i++) {
    row = queryFirst(WA_SELECTORS.messageRow, document)
    if (!row) await sleep(150)
  }
  if (!row) return requireFirst(WA_SELECTORS.messagePane, document, 'חלונית ההודעות (אין הודעות בצ\'אט?)')
  return findScrollableAncestor(row) || requireFirst(WA_SELECTORS.messagePane, document, 'חלונית ההודעות')
}

// Scrolls the open chat upward, collecting messages until either the given
// cursor message id is reached (subsequent syncs) or the 30-day backfill
// limit is hit (first sync for this chat) — spec §4.3.
async function collectMessages(sinceMessageId, lastMessageAt) {
  const pane = await waitForMessagePane()
  const cutoffTime = lastMessageAt
    ? new Date(lastMessageAt).getTime()
    : Date.now() - FIRST_SYNC_BACKFILL_DAYS * 24 * 3600 * 1000

  const seen = new Map() // messageId -> message, de-duplicated as the DOM re-renders while scrolling
  let attempts = 0
  let reachedCutoff = false
  // DOM order here is chronological (oldest row at top) — the previous
  // row's timestamp is exactly the right fallback anchor for a row whose own
  // timestamp can't be read (see extractMessage's fallbackTimestamp param).
  let lastTimestamp = null

  while (attempts < MAX_SCROLL_ATTEMPTS && !reachedCutoff) {
    const rows = queryAllFirst(WA_SELECTORS.messageRow, pane)
    // TEMP DEBUG (2026-10-01): whole conversation still collapses to 1
    // message even after the retry revert — log every row of every pass and
    // exactly which row (if any) trips the cutoff break.
    console.log('[whatsapp-sync] DEBUG pass', attempts, 'rows=', rows.length, 'cutoff=', new Date(cutoffTime).toISOString(), 'seen so far=', seen.size)
    for (const [i, row] of rows.entries()) {
      const msg = extractMessage(row, pane, lastTimestamp)
      if (!msg) {
        console.log('[whatsapp-sync] DEBUG   row', i, '-> null', JSON.stringify((row.textContent || '').slice(0, 50)))
        continue
      }
      console.log('[whatsapp-sync] DEBUG   row', i, '->', msg.timestamp, msg.kind, msg.messageId?.slice(0, 12), JSON.stringify((msg.text || '').slice(0, 30)))
      lastTimestamp = msg.timestamp
      // Confirmed live bug (2026-10-01): rows here are oldest-first, so an
      // at-or-before-cutoff row means "skip this one and stop scrolling
      // further back" — NOT "stop reading this pass". Breaking here threw
      // away every NEWER row after it in the same pass: a single July
      // message rendered near the top of Dudi's chat cut the whole recent
      // conversation (texts and all 3 voice messages) down to 1 message.
      if (msg.messageId === sinceMessageId) { console.log('[whatsapp-sync] DEBUG   SKIP: sinceMessageId'); reachedCutoff = true; continue }
      if (new Date(msg.timestamp).getTime() <= cutoffTime) { console.log('[whatsapp-sync] DEBUG   SKIP: row older than cutoff'); reachedCutoff = true; continue }
      if (!seen.has(msg.messageId)) {
        // Confirmed live bug (2026-09-29): resolving voice audio was deferred
        // to a pass over all collected messages AFTER the whole scroll loop
        // finished — by then we'd scrolled well past this row, WhatsApp had
        // virtualized it back out (data-virtualized="true", no children), and
        // there was no <audio>/play button left to read. Every voice message
        // failed transcription this way. Resolving right here, while the row
        // just came from a live queryAllFirst() and is guaranteed mounted,
        // fixes that. The `seen.has` guard also stops it from re-resolving
        // (and re-billing Whisper for) the same message on a later loop
        // iteration that re-scans this same still-visible row.
        if (msg.kind === 'voice') {
          console.log('[whatsapp-sync] about to resolve voice message', msg.messageId)
          await resolveVoiceMessage(msg)
          console.log('[whatsapp-sync] resolved voice message', msg.messageId, 'status=', msg.transcriptionStatus)
        }
        seen.set(msg.messageId, msg)
      }
    }
    if (reachedCutoff) break

    // Confirmed live (2026-09-29): plain (synthetic) scrolling does NOT load
    // older history at all — WhatsApp's virtualized list needs a genuinely-
    // trusted wheel event (realScrollAt, via chrome.debugger) to respond.
    // Once the locally-cached window is exhausted, WhatsApp also replaces
    // the top of the pane with an explicit button — "Click here to get older
    // messages from your phone" — that must itself be really-clicked; this
    // combination (untrusted scroll + the button) is what caused voice
    // messages (further back in this account's history) to go missing
    // entirely. The button's classes are as unstable as everything else
    // here, so it's matched by its text, in whichever language the account's
    // WhatsApp Web happens to show it.
    const loadOlderBtn = [...pane.querySelectorAll('button')]
      .find(b => /older messages|הודעות ישנות יותר/.test(b.textContent || ''))
    if (loadOlderBtn) {
      await realClick(loadOlderBtn)
      await sleep(4000) // this is a real network round trip to the phone, not a render
    } else {
      const beforeScrollHeight = pane.scrollHeight
      let grew = false
      // One scroll + one 700ms check was too impatient — confirmed live
      // (2026-09-29): a run gave up after a single attempt and only ever
      // captured the one message already on screen before any scrolling.
      // Several real scrolls with real waiting in between, checking for
      // either new content OR the "load older" button appearing, before
      // concluding there's genuinely nothing more.
      for (let i = 0; i < 5 && !grew; i++) {
        await realScrollAt(pane, -800) // negative = toward older messages
        await sleep(800)
        if (pane.scrollHeight !== beforeScrollHeight) grew = true
        if ([...pane.querySelectorAll('button')].some(b => /older messages|הודעות ישנות יותר/.test(b.textContent || ''))) grew = true
      }
      if (!grew) break // genuinely at the top — several real scrolls changed nothing
    }
    attempts++
  }

  // Voice messages are already fully resolved above, inline, while their rows
  // were still mounted — nothing left to do here but order them.
  console.log('[whatsapp-sync] DEBUG collect done: passes=', attempts, 'reachedCutoff=', reachedCutoff, 'collected=', seen.size)
  return [...seen.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
}

// ─── Group discovery + sender matching ─────────────────────────────────────

function discoverGroups() {
  const items = queryAllFirst(WA_SELECTORS.chatListItem, document)
  const groups = []
  for (const item of items) {
    if (!queryFirst(WA_SELECTORS.groupIcon, item)) continue
    const titleNode = queryFirst(WA_SELECTORS.chatListItemTitle, item)
    const name = titleNode?.textContent?.trim()
    // The chat-list row's own data-id (or its closest ancestor's) is WhatsApp's
    // JID for the chat (e.g. 1203xxxx@g.us) when present; falling back to the
    // name keeps groups usable even if that attribute isn't where expected,
    // at the cost of merging two same-named groups into one.
    const groupId = item.getAttribute('data-id') || item.closest('[data-id]')?.getAttribute('data-id') || name
    if (name && groupId) groups.push({ groupId, name })
  }
  return groups
}

function normalizeName(str) {
  return (str || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

// Exact (not fuzzy), case/whitespace-insensitive match against a teacher's
// name or any of their group aliases — spec §3.1.1 is explicit that this must
// NOT be fuzzy, to avoid mis-attributing one teacher's message to another.
function matchGroupSender(senderName, teachers) {
  const normalized = normalizeName(senderName)
  if (!normalized) return { matched: null, ambiguous: false }
  const candidates = teachers.filter(t => {
    const names = [t.name, ...(t.groupAliases || [])].map(normalizeName)
    return names.includes(normalized)
  })
  if (candidates.length === 1) return { matched: candidates[0], ambiguous: false }
  if (candidates.length > 1) return { matched: null, ambiguous: true }
  return { matched: null, ambiguous: false }
}

// ─── Sync orchestration ────────────────────────────────────────────────────

// Confirmed live bug (2026-09-29): background.js navigates the tab and just
// waits a fixed delay before calling readDM — with no check that navigation
// actually landed on the RIGHT chat. When it silently didn't (observed: still
// on a previous/default chat), this used to read and save wrong data with no
// error at all. Waits for the header to show the expected teacher's name
// (WhatsApp's own saved contact name commonly has extra text appended, e.g.
// "ענת נקש טק סקול" for a CRM contact named "ענת נקש" — a substring check).
async function waitForChatHeader(expectedNameSubstr) {
  for (let i = 0; i < 30; i++) {
    const header = queryFirst(WA_SELECTORS.chatHeaderName, document)?.textContent || ''
    if (header && header.includes(expectedNameSubstr)) return true
    await sleep(500)
  }
  return false
}

// Called after background.js has already navigated this tab to the right
// DM via web.whatsapp.com/send?phone=... — the chat is expected to already
// be open (or opening); this just waits for it to settle and reads it.
async function readCurrentDM(contactId, teacherName, lastMessageAt) {
  if (!queryFirst(WA_SELECTORS.appLoaded, document)) {
    throw new Error('WhatsApp Web לא פתוח או לא מחובר במחשב')
  }
  if (!(await waitForChatHeader(teacherName))) {
    throw new Error(`הניווט לא נחת על השיחה של ${teacherName} (בדקו את מספר הטלפון שלה/שלו ב-CRM)`)
  }
  const messages = await collectMessages(null, lastMessageAt)
  if (messages.length > 0) {
    await toBackground('saveMessages', { contactId, source: 'dm', messages })
  }
}

// A management group ("קבוצת הנהלה"): every message goes to the backend with its sender
// name; the backend keeps only the task-givers' and extracts tasks. No teacher matching.
async function syncManagementGroup(group) {
  const rawMessages = await collectMessages(null, group.lastMessageAt)
  if (rawMessages.length === 0) return
  await toBackground('saveManagementMessages', {
    groupId: group.groupId, groupName: group.name, messages: rawMessages,
  })
}

async function syncGroup(group, teachers) {
  const opened = await openChatByName(group.name)
  if (!opened) throw new Error('לא נמצאה הקבוצה "' + group.name + '"')
  if (group.isManagement) return syncManagementGroup(group)

  // Every group message needs its own sender resolved (spec §3.1.1), and my own
  // messages only count when they're a reply to an already-matched teacher.
  const pane = requireFirst(WA_SELECTORS.messagePane, document, 'חלונית ההודעות')
  const rawMessages = await collectMessages(null, group.lastMessageAt)

  const byContact = new Map() // contactId -> messages[]
  const lastKnownSenderIdByRowOrder = new Map() // messageId -> contactId, for reply lookups

  for (const msg of rawMessages) {
    if (msg.sender === 'teacher') {
      const { matched, ambiguous } = matchGroupSender(msg.groupSenderName, teachers)
      if (ambiguous) {
        await toBackground('reportUnmatched', { senderName: msg.groupSenderName, groupName: group.name })
        continue
      }
      if (!matched) {
        if (msg.groupSenderName) {
          await toBackground('reportUnmatched', { senderName: msg.groupSenderName, groupName: group.name })
        }
        continue
      }
      lastKnownSenderIdByRowOrder.set(msg.messageId, matched.id)
      if (!byContact.has(matched.id)) byContact.set(matched.id, [])
      byContact.get(matched.id).push(msg)
    } else {
      // My message: only counts if it's a reply (quote) to a matched teacher's
      // message (spec §3.1.1) — a general message to the group is skipped.
      const row = queryAllFirst(WA_SELECTORS.messageRow, pane)
        .find(r => r.querySelector('[data-id]')?.getAttribute('data-id') === msg.messageId)
      const quoted = row && queryFirst(WA_SELECTORS.quotedMessageNode, row)
      const quotedId = quoted?.getAttribute('data-quoted-mesage-id') || quoted?.getAttribute('data-quoted-message-id')
      const targetContactId = quotedId && lastKnownSenderIdByRowOrder.get(quotedId)
      if (!targetContactId) continue
      if (!byContact.has(targetContactId)) byContact.set(targetContactId, [])
      byContact.get(targetContactId).push(msg)
    }
  }

  for (const [contactId, messages] of byContact) {
    await toBackground('saveMessages', {
      contactId, source: 'group', groupId: group.groupId, groupName: group.name, messages,
    })
  }
}

// Runs the whole group list in one go (background.js calls this once, after
// it's finished driving the DM loop itself via navigation). Discovers groups
// visible in the sidebar and reports them first (best-effort — see the
// known-unreliable groupIcon selector in selectors.js; the CRM's manual
// "add group" form is the supported path, this is a bonus when it works).
async function runGroupSync(teachers, groups) {
  if (!queryFirst(WA_SELECTORS.appLoaded, document)) {
    throw new Error('WhatsApp Web לא פתוח או לא מחובר במחשב')
  }

  const discovered = discoverGroups()
  if (discovered.length > 0) await toBackground('reportGroups', { groups: discovered })

  for (const group of groups) {
    try {
      await syncGroup(group, teachers)
    } catch (err) {
      console.error('[whatsapp-sync] group sync failed for', group.name, err)
      await toBackground('reportFailed', { teacherName: `קבוצה: ${group.name}`, reason: err.message })
    }
    await humanDelay()
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ build: CONTENT_JS_BUILD })
    return false // synchronous response
  }
  if (message.action === 'readDM') {
    readCurrentDM(message.contactId, message.teacherName, message.lastMessageAt)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }))
    return true // async response
  }
  if (message.action === 'runGroupSync') {
    runGroupSync(message.teachers, message.groups)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }))
    return true // async response
  }
  return false
})
