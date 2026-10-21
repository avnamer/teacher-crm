// Runs on the CRM site itself (localhost:5173 + the Netlify domain) and relays between
// the CRM page and this extension's service worker, for "guided send":
// the CRM hands over a list of { id, phone, text }, the extension opens each chat in
// WhatsApp Web with the text already in the composer, and reports back when the
// human-pressed Enter produced a sent message.
//
// The extension never presses send and never types into the composer — the text rides
// in on WhatsApp's own /send?phone=&text= link, exactly like the old wa.me flow.

const CHANNEL = 'teacher-crm-wa'

function toPage(payload) {
  window.postMessage({ channel: CHANNEL, from: 'extension', ...payload }, window.location.origin)
}

window.addEventListener('message', event => {
  if (event.source !== window) return
  const data = event.data
  if (!data || data.channel !== CHANNEL || data.from !== 'page') return

  if (data.type === 'ping') {
    toPage({ type: 'ready', version: chrome.runtime.getManifest().version })
    return
  }
  if (data.type === 'start' || data.type === 'skip' || data.type === 'cancel') {
    chrome.runtime.sendMessage({ action: 'guidedSend', type: data.type, items: data.items }, response => {
      if (chrome.runtime.lastError) {
        toPage({ type: 'error', reason: chrome.runtime.lastError.message })
      } else if (response?.error) {
        toPage({ type: 'error', reason: response.error })
      }
    })
  }
})

chrome.runtime.onMessage.addListener(message => {
  if (message.action === 'guidedSendEvent') toPage(message.event)
  return false
})

// Tell a page that was already waiting for us that the bridge is up.
toPage({ type: 'ready', version: chrome.runtime.getManifest().version })
