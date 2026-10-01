// Service worker. The only part of this extension that talks to the CRM
// backend — content.js (running on web.whatsapp.com) never does, both so its
// requests get the host_permissions CORS exemption reliably (extension pages
// get it unambiguously; content-script fetches are murkier across Chrome
// versions) and so the extension token never has to exist in the page context
// of a site we don't control.
//
// No chrome.alarms schedule ever opens or reads WhatsApp Web on its own here —
// per the go-ahead for this feature, sync only runs when a human asks for it
// (the popup button, or a request row created from the CRM, possibly from a
// phone). The two alarms below (heartbeat, request polling) never touch
// WhatsApp Web themselves; they only ping the backend.

const HEARTBEAT_ALARM = 'wa-sync-heartbeat'
const POLL_ALARM = 'wa-sync-poll-requests'

chrome.runtime.onInstalled.addListener(() => {
  // 1 minute is Chrome's enforced minimum alarm period — close enough to the
  // spec's "every minute" heartbeat and "every 30–60s" request poll.
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 })
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 })
})

async function getSettings() {
  const { backendUrl, extensionToken } = await chrome.storage.local.get(['backendUrl', 'extensionToken'])
  return {
    backendUrl: backendUrl || 'http://localhost:3001',
    extensionToken: extensionToken || '',
  }
}

async function callBackend(path, options = {}) {
  const { backendUrl, extensionToken } = await getSettings()
  if (!extensionToken) throw new Error('טוקן החיבור לא מוגדר — פתחו את הגדרות התוסף')
  const res = await fetch(`${backendUrl}/api/whatsapp-sync${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Extension-Token': extensionToken,
      ...options.headers,
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.message || `שגיאת שרת (${res.status})`)
  return body
}

async function getWhatsAppTab() {
  const [tab] = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' })
  return tab || null
}

function sendToContentScript(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
      resolve(response)
    })
  })
}

let syncing = false
let failedCountThisRun = 0

const DEFAULT_COUNTRY_CODE = '972' // Israel — mirrors frontend/src/lib/whatsapp.js's normalizePhone
function normalizePhoneForSearch(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    return digits.slice(DEFAULT_COUNTRY_CODE.length).length === 9 ? digits : null
  }
  if (digits.startsWith('0')) {
    const national = digits.slice(1)
    return national.length === 9 ? DEFAULT_COUNTRY_CODE + national : null
  }
  if (digits.length === 9) return DEFAULT_COUNTRY_CODE + digits
  return digits.length >= 10 && digits.length <= 15 ? digits : null
}

// Resolves once the tab finishes loading (or after timeoutMs regardless, so a
// missed/coalesced onUpdated event can't hang the sync forever).
function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise(resolve => {
    let done = false
    function finish() {
      if (done) return
      done = true
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish()
    }
    chrome.tabs.onUpdated.addListener(listener)
    setTimeout(finish, timeoutMs)
  })
}

function humanDelay() {
  return new Promise(r => setTimeout(r, 2000 + Math.random() * 2000))
}

// ─── Real input via chrome.debugger (CDP) ──────────────────────────────────
// Confirmed live (2026-09-29): WhatsApp Web's virtualized message list only
// responds to genuinely-trusted click/scroll input. event.isTrusted is false
// for anything dispatched via element.dispatchEvent() — no matter how the
// synthetic event's properties were tuned (full pointerdown/mousedown/up/
// click sequences, wheel events with real deltas, retries), it sometimes did
// nothing at all. chrome.debugger — the same CDP mechanism browser automation
// tools like Playwright/Puppeteer use — dispatches input the browser treats
// as trusted, and that's what reliably worked in testing. This needs the
// "debugger" permission and shows Chrome's "<ext> is debugging this browser"
// infobar while attached (only during an actual sync run); attaching also
// fails if DevTools is manually open on the same tab (only one debugger
// client at a time) — see the extension README for that tradeoff.
const CDP_VERSION = '1.3'
let debuggerTabId = null

async function attachDebugger(tabId) {
  if (debuggerTabId === tabId) return
  await chrome.debugger.attach({ tabId }, CDP_VERSION)
  debuggerTabId = tabId
}

async function detachDebugger() {
  if (debuggerTabId === null) return
  try {
    await chrome.debugger.detach({ tabId: debuggerTabId })
  } catch { /* already gone (e.g. tab closed, or DevTools took over) — fine */ }
  debuggerTabId = null
}

async function dispatchRealClick(tabId, x, y) {
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1,
  })
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
  })
}

// Input.synthesizeScrollGesture instead of a raw dispatchMouseEvent
// mouseWheel — CDP's purpose-built scroll simulation, more likely to be
// treated as a real scroll than one manually-constructed wheel event (which
// still hadn't reliably worked as of the previous attempt). yDistance
// negative = scroll up (toward older messages), matching deltaY's sign here.
async function dispatchRealScroll(tabId, x, y, deltaY) {
  await chrome.debugger.sendCommand({ tabId }, 'Input.synthesizeScrollGesture', {
    x, y, xDistance: 0, yDistance: deltaY, gestureSourceType: 'mouse', speed: 3000,
  })
}

// ─── Voice message audio capture via chrome.tabCapture ─────────────────────
// Confirmed live (2026-09-29): playing a WhatsApp Web voice note produces
// real, audible sound, but NEVER goes through any JS-observable audio path —
// no <audio>/<video> element, no Audio(), no HTMLMediaElement.play, no
// AudioContext method (incl. audioWorklet), no WebCodecs, no Worker. Tested
// exhaustively (~20 hook strategies) including on a single-message, fully
// controlled test chat. WhatsApp most likely captured a native API reference
// before any hook could attach (a common anti-automation trick). The only
// remaining way to get the audio is to record the tab's actual output —
// chrome.tabCapture does this below the JS-API layer entirely, so it doesn't
// matter which internal mechanism produced the sound.
//
// OPEN QUESTION (untested as of this writing): chrome.tabCapture.getMediaStreamId
// may require a recent user gesture on the extension's own action. Manual
// sync (popup button / CRM button, same click that starts runSync) should
// satisfy that. The alarm-triggered poll path (POLL_ALARM picking up a
// pending request with no direct click) might not — if so, voice messages
// synced that way will fail per-message (existing failure isolation) rather
// than breaking the whole sync. Needs a live check.
async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'הקלטת שמע של הודעה קולית מ-WhatsApp Web לצורך תמלול',
  })
}

function sendToOffscreen(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ target: 'offscreen', ...message }, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
      if (response?.error) return reject(new Error(response.error))
      resolve(response)
    })
  })
}

// Outer safety net, independent of the offscreen document's own internal
// safety cap (maxMs inside waitForSpeechThenSilence) — confirmed live
// (2026-09-29) that a bug there (requestAnimationFrame never firing in an
// unpainted offscreen document) hung an entire sync run on the first voice
// message with nothing to unblock it. One voice message failing to
// transcribe must never be able to take the whole sync down with it.
function withTimeout(promise, ms, label) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} תקוע — עברו ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId))
}

// Sets up tab-capture recording (offscreen document + getMediaStreamId +
// starting the recorder) WITHOUT clicking anything. Split out from the click
// itself on purpose — confirmed live (2026-09-29): creating the offscreen
// document (only slow the first time) plus the getMediaStreamId/startRecording
// round trip is a variable, sometimes-large delay; when content.js computed
// the play button's click coordinates BEFORE this setup and background
// dispatched the click only after it finished, the page had often shifted
// by then and the click missed — matching exactly what was seen live: only
// the last couple of voice messages in a sync (by which point the offscreen
// document already existed, so setup was fast) actually got clicked/heard.
// content.js now calls this first, then re-queries the button fresh and
// clicks it itself via realClick — see resolveVoiceMessage there.
async function prepareVoiceCapture(tabId) {
  await ensureOffscreenDocument()
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId })
  await sendToOffscreen({ action: 'startRecording', streamId })
}

// Confirmed live (2026-09-29/30): a fixed capture duration produced
// mostly-silent clips (WhatsApp has some unknown delay before real audio
// starts) which Whisper then hallucinated plausible-sounding text for
// instead of erroring — voice-activity detection handles that. Stopping at
// the first silence GAP was then found to cut longer messages off
// mid-sentence (natural speech pauses exceed a short silence threshold), so
// the offscreen document now records for the message's own known
// durationMs once speech starts, not until it first goes quiet. maxMs is
// just the outer safety cap. Returns { audioBase64, mimeType } (webm/opus).
async function finishVoiceCapture(durationMs, maxMs) {
  return withTimeout(
    sendToOffscreen({ action: 'recordForDuration', durationMs, maxMs }),
    maxMs + 5000,
    'הקלטת הודעה קולית'
  )
}

// Confirmed live (2026-09-29): navigating straight to WhatsApp's own
// send?phone= deep link opens the right DM every single time — unlike a
// simulated click on a search result, which was flaky even with retries (see
// content.js's clickUntilChatOpens, still used for groups, which have no
// phone-based URL to navigate to instead). This is why DM sync is driven from
// here (background can navigate a tab) rather than from inside content.js.
async function navigateToPhone(tabId, phone) {
  await chrome.tabs.update(tabId, { url: `https://web.whatsapp.com/send?phone=${phone}` })
  await waitForTabLoad(tabId)
  // The browser's "load complete" fires before WhatsApp's own SPA has
  // finished mounting the chat — confirmed live, took ~10s total in one
  // observed run. content.js's own collectMessages has its own further
  // up-to-9s wait for the message pane, so this doesn't need to be exact —
  // just enough that readDM isn't called while the page is still blank.
  await new Promise(r => setTimeout(r, 4000))
}

async function runSync() {
  if (syncing) return { ok: false, error: 'סנכרון כבר רץ' }
  syncing = true
  failedCountThisRun = 0
  try {
    const tab = await getWhatsAppTab()
    if (!tab) {
      await callBackend('/sync/begin', { method: 'POST', body: JSON.stringify({ total: 0 }) })
      await callBackend('/sync/finish', {
        method: 'POST',
        body: JSON.stringify({ status: 'failed', error: 'WhatsApp Web לא פתוח במחשב' }),
      })
      return { ok: false, error: 'WhatsApp Web לא פתוח במחשב' }
    }

    try {
      await attachDebugger(tab.id)
    } catch (err) {
      const reason = /already attached|Another debugger/i.test(err.message)
        ? 'DevTools פתוח על הלשונית — סגרו אותו ונסו שוב'
        : err.message
      await callBackend('/sync/begin', { method: 'POST', body: JSON.stringify({ total: 0 }) })
      await callBackend('/sync/finish', { method: 'POST', body: JSON.stringify({ status: 'failed', error: reason }) })
      return { ok: false, error: reason }
    }

    const { teachers, groups } = await callBackend('/targets', { method: 'GET' })
    const total = teachers.length + groups.length
    let done = 0
    await callBackend('/sync/begin', { method: 'POST', body: JSON.stringify({ total }) })

    for (const teacher of teachers) {
      try {
        const phone = normalizePhoneForSearch(teacher.phone)
        if (!phone) throw new Error('אין מספר טלפון תקין')
        await navigateToPhone(tab.id, phone)
        const result = await sendToContentScript(tab.id, {
          action: 'readDM',
          contactId: teacher.id,
          teacherName: teacher.name,
          lastMessageAt: teacher.lastMessageAt,
        })
        if (!result?.ok) throw new Error(result?.error || 'קריאת ההודעות נכשלה')
      } catch (err) {
        console.error('[whatsapp-sync/background] DM sync failed for', teacher.name, err)
        failedCountThisRun++
        await callBackend('/failed', {
          method: 'POST',
          body: JSON.stringify({ teacherName: teacher.name, reason: err.message }),
        }).catch(() => {})
      }
      done++
      await callBackend('/sync/progress', { method: 'POST', body: JSON.stringify({ done, total }) }).catch(() => {})
      await humanDelay()
    }

    // Groups have no phone-style deep link, so they still go through
    // content.js's own search-and-click flow (see clickUntilChatOpens there) —
    // one message covers the whole group list, same shape as the old
    // content-script-driven loop.
    if (groups.length > 0) {
      try {
        const result = await sendToContentScript(tab.id, { action: 'runGroupSync', teachers, groups })
        if (!result?.ok) throw new Error(result?.error || 'סנכרון הקבוצות נכשל')
      } catch (err) {
        console.error('[whatsapp-sync/background] group sync failed:', err)
        failedCountThisRun++
        await callBackend('/failed', {
          method: 'POST',
          body: JSON.stringify({ teacherName: 'קבוצות', reason: err.message }),
        }).catch(() => {})
      }
      done += groups.length
      await callBackend('/sync/progress', { method: 'POST', body: JSON.stringify({ done, total }) }).catch(() => {})
    }

    await callBackend('/sync/finish', {
      method: 'POST',
      body: JSON.stringify({ status: failedCountThisRun > 0 ? 'partial' : 'success' }),
    })
    return { ok: true }
  } catch (err) {
    console.error('[whatsapp-sync/background] sync failed:', err)
    try {
      await callBackend('/sync/finish', { method: 'POST', body: JSON.stringify({ status: 'failed', error: err.message }) })
    } catch { /* backend unreachable — nothing more we can report */ }
    return { ok: false, error: err.message }
  } finally {
    await detachDebugger()
    syncing = false
  }
}

chrome.alarms.onAlarm.addListener(async alarm => {
  try {
    if (alarm.name === HEARTBEAT_ALARM) {
      await callBackend('/heartbeat', { method: 'POST', body: '{}' })
    }
    if (alarm.name === POLL_ALARM) {
      if (syncing) return
      const { request } = await callBackend('/pending-request', { method: 'GET' })
      if (!request) return
      const result = await runSync()
      await callBackend('/request-done', {
        method: 'POST',
        body: JSON.stringify({ requestId: request.id, status: result.ok ? 'done' : 'failed' }),
      })
    }
  } catch (err) {
    // Expected/frequent while the token isn't configured yet, or the backend
    // is asleep (Render free tier cold start) — not worth surfacing as an error.
    console.warn('[whatsapp-sync/background] alarm handler:', err.message)
  }
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message

  if (action === 'manualSync') {
    runSync().then(sendResponse)
    return true
  }
  if (action === 'debuggerClick') {
    dispatchRealClick(sender.tab.id, message.x, message.y)
      .then(() => sendResponse({ ok: true })).catch(err => sendResponse({ error: err.message }))
    return true
  }
  if (action === 'debuggerScroll') {
    dispatchRealScroll(sender.tab.id, message.x, message.y, message.deltaY)
      .then(() => sendResponse({ ok: true })).catch(err => sendResponse({ error: err.message }))
    return true
  }
  if (action === 'prepareVoiceCapture') {
    prepareVoiceCapture(sender.tab.id)
      .then(() => sendResponse({ ok: true })).catch(err => sendResponse({ error: err.message }))
    return true
  }
  if (action === 'finishVoiceCapture') {
    finishVoiceCapture(message.durationMs, message.maxMs)
      .then(sendResponse).catch(err => sendResponse({ error: err.message }))
    return true
  }
  if (action === 'saveMessages') {
    const { contactId, source, groupId, groupName, messages } = message
    callBackend('/messages', {
      method: 'POST',
      body: JSON.stringify({ contactId, source, groupId, groupName, messages }),
    }).then(sendResponse).catch(err => sendResponse({ error: err.message }))
    return true
  }
  if (action === 'transcribeVoice') {
    const { audioBase64, mimeType } = message
    callBackend('/voice-transcribe', {
      method: 'POST',
      body: JSON.stringify({ audioBase64, mimeType }),
    }).then(sendResponse).catch(err => sendResponse({ error: err.message }))
    return true
  }
  if (action === 'reportGroups') {
    callBackend('/groups', { method: 'POST', body: JSON.stringify({ groups: message.groups }) })
      .then(sendResponse).catch(err => sendResponse({ error: err.message }))
    return true
  }
  if (action === 'reportUnmatched') {
    callBackend('/unmatched', {
      method: 'POST',
      body: JSON.stringify({ senderName: message.senderName, groupName: message.groupName }),
    }).then(sendResponse).catch(err => sendResponse({ error: err.message }))
    return true
  }
  if (action === 'reportFailed') {
    failedCountThisRun++
    callBackend('/failed', {
      method: 'POST',
      body: JSON.stringify({ teacherName: message.teacherName, reason: message.reason }),
    }).then(sendResponse).catch(err => sendResponse({ error: err.message }))
    return true
  }
  return false
})
