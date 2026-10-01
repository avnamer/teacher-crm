// All WhatsApp Web DOM selectors, in one place (spec §4.4) — if WhatsApp changes
// its markup, this is the only file that needs updating. Every lookup goes
// through querySelectorFallback()/querySelectorAllFallback() below, which tries
// several known variants in order and throws a clearly-labeled error (never a
// silent crash / empty result) when none of them match anymore.
//
// These selectors reflect WhatsApp Web's structure as of this writing. WhatsApp
// changes its DOM/class names periodically without notice — if sync starts
// failing with "מבנה WhatsApp Web השתנה", this file is where to look first.

const WA_SELECTORS = {
  // The main "is WhatsApp Web loaded and logged in" signal.
  appLoaded: ['#app .two', '#app ._ak8j', '#app'],

  // The open conversation's header (contact/group name, top of #main).
  // Confirmed live (2026-09-29): plain "header" scoped to #main is reliable —
  // the chat-list sidebar has its own separate <header> outside of #main, so
  // this doesn't need to be more specific than that.
  chatHeaderName: ['#main header span[dir="auto"]'],

  // The search box at the top of the chat list, used to open a chat by phone
  // number. Confirmed live (2026-09-27): a plain <input>, not a contenteditable
  // div — WhatsApp has moved off the old div-based search box since this file
  // was first written. Confirmed live (2026-09-29): its aria-label is NOT
  // stable — it goes blank once the box has a value/a chat is open — so
  // data-tab="3" (stable in every state observed) is listed first now.
  chatSearchBox: [
    'input[data-tab="3"]',
    'input[aria-label="Search or start a new chat"]',
    'div[contenteditable="true"][data-tab="3"]',
    'div[contenteditable="true"][aria-label="חיפוש קלט טקסט"]',
    'div[contenteditable="true"][aria-label="Search input textbox"]',
    '[data-testid="chat-list-search"] input',
    '[data-testid="chat-list-search"] div[contenteditable="true"]',
  ],

  // Rows in the chat-list search results / the chat list itself. Confirmed
  // live: role="row" also matches these sidebar rows, which is why messageRow
  // below is scoped to #main — without that scope the two get conflated.
  chatListItem: ['div[data-testid="cell-frame-container"]', '#pane-side div[role="listitem"]'],
  chatListItemTitle: ['span[data-testid="cell-frame-title"]', 'span[dir="auto"][title]'],

  // The open conversation's scrollable message pane. content.js now finds this
  // dynamically at runtime (findScrollableAncestor — walks up from a message
  // row checking real scroll geometry) rather than relying on this selector,
  // since generated class names churn more than scroll behavior does. This
  // list is only the last-resort fallback if that walk-up ever comes back
  // empty. Confirmed live (2026-09-27): the real scrollable element carries
  // data-testid="conversation-panel-messages" — #main itself does NOT scroll
  // (it wraps the header, the message pane, and the composer as siblings).
  messagePane: [
    'div[data-testid="conversation-panel-messages"]',
    '#main .copyable-area',
    '#main',
  ],

  // One message row. Confirmed live (2026-09-27): role="row" inside #main,
  // NOT the old .message-in/.message-out classes (gone). `data-id` (WhatsApp's
  // own message id) sits on a CHILD of the row, not the row itself — hence
  // querySelector (descendant), not closest (ancestor), in content.js.
  // `data-pre-plain-text` format is confirmed "[H:MM, M/D/YYYY] Sender: "
  // (24h clock, US-style month/day order despite the Hebrew UI) — see
  // parsePrePlainText in content.js.
  messageRow: ['#main [role="row"]'],
  // Outgoing (sent by me) marker. The old `.message-out` class is gone;
  // confirmed live that a sent message carries a tail-out element. NOT
  // confirmed whether WhatsApp omits the tail on consecutive messages from
  // the same sender (a real risk) — the "You:" aria-label span is checked too
  // as a second, hopefully-independent signal. If sync starts misattributing
  // consecutive messages, this is the first place to re-check live.
  outgoingTailNode: ['[data-testid="tail-out"]'],
  outgoingAriaNode: ['span[aria-label="You:"]'],
  // NOTE: message text is read from prePlainTextNode's own textContent
  // (extractFullText in content.js), not from a dedicated text-node selector
  // — confirmed live (2026-09-29) that a formatted message (bold runs, e.g. a
  // forwarded list) splits across several separate
  // span[data-testid="selectable-text"] elements, one per bold run, with the
  // plain paragraph text belonging to none of them; reading just the first
  // such span silently truncated messages down to one line.
  prePlainTextNode: ['.copyable-text[data-pre-plain-text]', '[data-pre-plain-text]'],
  // Confirmed live (2026-09-29): a row with no text content at all (a voice
  // message, at least) carries NO data-pre-plain-text anywhere — this is the
  // fallback timestamp source for that case (time only, no date — see
  // nearestDividerDate in content.js for how the date gets filled in).
  messageMetaNode: ['[data-testid="msg-meta"]'],

  // Media captions / kind markers.
  imageNode: ['div[data-testid="image-thumb"]', 'img[data-testid="image-thumb"]'],
  documentNode: ['div[data-testid="document-thumb"]', 'a[data-testid="document-thumb"]'],
  documentFilename: ['div[data-testid="document-name"]', 'span[title]'],
  stickerNode: ['div[data-testid="sticker"]', 'img[data-testid="sticker"]'],
  videoNode: ['div[data-testid="video-thumb"]', 'video'],

  // Voice messages. The play button is confirmed live (2026-09-27,
  // aria-label="Play voice message") — put first since it's the one
  // confirmed-reliable marker for "this row is a voice message"; the rest
  // are still unconfirmed guesses. voiceAudioElement is unused as of
  // 2026-09-29 — confirmed live that voice-note playback never creates an
  // <audio> element at all (or touches any other JS-observable audio API);
  // content.js's resolveVoiceMessage captures the tab's real audio output
  // via chrome.tabCapture instead (see background.js's captureVoicePlayback).
  // Confirmed live bug (2026-09-29): a voice note WhatsApp hasn't locally
  // cached yet shows a DIFFERENT button — aria-label="Download voice
  // message", not "Play" — until clicked once. voiceNode didn't include this
  // at all, so every not-yet-downloaded voice note was silently
  // misclassified as an empty text message (no error, just missing).
  // voiceDownloadButton must be included in voiceNode so messageKindOf
  // catches these too.
  // Confirmed live bug (2026-09-30): WhatsApp Web auto-plays the NEXT voice
  // message once the current one finishes on its own — only became visible
  // once resolveVoiceMessage started letting messages play to their real
  // full length (the old premature-cutoff behavior never gave autoplay a
  // chance to kick in). By the time the scan reaches that next row, its
  // button has already flipped to "Pause voice message", which voiceNode
  // didn't recognize — so messageKindOf misclassified it as plain text and
  // silently dropped it, indistinguishable from never having been touched.
  voiceNode: [
    'button[aria-label="Play voice message"]',
    'button[aria-label="הפעל הודעה קולית"]',
    'button[aria-label="Download voice message"]',
    'button[aria-label="הורד הודעה קולית"]',
    'button[aria-label="Pause voice message"]',
    'button[aria-label="השהה הודעה קולית"]',
    'div[data-testid="audio-player"]',
    'audio',
  ],
  voiceAudioElement: ['audio'],
  voicePlayButton: ['button[aria-label="Play voice message"]', 'button[aria-label="הפעל הודעה קולית"]'],
  voiceDownloadButton: ['button[aria-label="Download voice message"]', 'button[aria-label="הורד הודעה קולית"]'],
  voicePauseButton: ['button[aria-label="Pause voice message"]', 'button[aria-label="השהה הודעה קולית"]'],
  // NOTE: the duration text has no stable attribute at all (not even a
  // testid) — confirmed live (2026-09-29) it's matched by shape instead, see
  // findVoiceDurationText in content.js.

  // Reply/quote block inside a message I sent, used to detect "this is a reply
  // to a specific teacher's message" in a group (spec §3.1.1).
  quotedMessageNode: ['div[data-testid="quoted-message"]', 'div.quoted-mention'],
  quotedMessageId: ['data-quoted-mesage-id', 'data-quoted-message-id'], // WhatsApp has shipped both spellings historically

  // Group-only: the sender name shown above/beside someone else's message.
  groupSenderNameNode: ['span[data-testid="author"]', 'div[aria-label] span[dir="auto"]'],

  // Group icon in the chat list, used to tell a group chat apart from a DM
  // while enumerating chats for the "discovered groups" report.
  groupIcon: ['span[data-testid="default-group"]', 'span[data-icon="default-group"]'],
}

/** First element under `root` matching any candidate in `selectorList`, or null. */
function queryFirst(selectorList, root = document) {
  for (const sel of selectorList) {
    const el = root.querySelector(sel)
    if (el) return el
  }
  return null
}

/** All elements under `root` matching the first candidate selector that finds anything. */
function queryAllFirst(selectorList, root = document) {
  for (const sel of selectorList) {
    const els = root.querySelectorAll(sel)
    if (els.length > 0) return [...els]
  }
  return []
}

// Thrown by the fallback helpers below; content.js catches this specific error
// to show "מבנה WhatsApp Web השתנה, התוסף צריך עדכון" instead of a silent
// failure or a generic crash (spec §4.4).
class WhatsAppStructureError extends Error {
  constructor(what) {
    super(`מבנה WhatsApp Web השתנה, התוסף צריך עדכון (לא נמצא: ${what})`)
    this.name = 'WhatsAppStructureError'
  }
}

/** Same as queryFirst, but throws WhatsAppStructureError instead of returning null. */
function requireFirst(selectorList, root, what) {
  const el = queryFirst(selectorList, root)
  if (!el) throw new WhatsAppStructureError(what)
  return el
}
