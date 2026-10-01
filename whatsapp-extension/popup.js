const btn = document.getElementById('syncBtn')
const status = document.getElementById('status')
const tabStatus = document.getElementById('tabStatus')

chrome.storage.local.get(['extensionToken'], ({ extensionToken }) => {
  if (!extensionToken) {
    status.textContent = 'יש להגדיר את התוסף לפני הסנכרון הראשון (לחצו על "הגדרות התוסף" למטה).'
    status.className = 'error'
    btn.disabled = true
  }
})

// Answers "is the extension actually up to date in this tab?" directly in the
// one place already known to be easy to find — no DevTools/console needed.
// A stale content script (reloaded the extension but not this tab, or vice
// versa) is the single most common cause of "same error as before" reports.
checkContentScriptBuild()

function checkContentScriptBuild() {
  chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, tabs => {
    const tab = tabs[0]
    if (!tab) {
      tabStatus.textContent = 'לא נמצאה לשונית של web.whatsapp.com פתוחה.'
      tabStatus.className = 'error'
      return
    }
    chrome.tabs.sendMessage(tab.id, { action: 'ping' }, response => {
      if (chrome.runtime.lastError || !response?.build) {
        tabStatus.textContent = '⚠️ התוסף לא טעון בלשונית הזו — סגרו ופתחו אותה מחדש (אחרי שהתוסף עצמו רוענן).'
        tabStatus.className = 'error'
        return
      }
      tabStatus.textContent = `✓ מחובר ללשונית, גרסת קוד: ${response.build}`
      tabStatus.className = 'ok'
    })
  })
}

btn.addEventListener('click', () => {
  btn.disabled = true
  status.textContent = 'מסנכרן...'
  status.className = ''
  chrome.runtime.sendMessage({ action: 'manualSync' }, response => {
    btn.disabled = false
    if (chrome.runtime.lastError) {
      status.textContent = 'שגיאה: ' + chrome.runtime.lastError.message
      status.className = 'error'
      return
    }
    if (response?.ok) {
      status.textContent = 'הסנכרון הושלם בהצלחה.'
      status.className = 'ok'
    } else {
      status.textContent = 'הסנכרון נכשל: ' + (response?.error || 'שגיאה לא ידועה')
      status.className = 'error'
    }
  })
})
