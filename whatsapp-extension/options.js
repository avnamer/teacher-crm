const backendUrlInput = document.getElementById('backendUrl')
const tokenInput = document.getElementById('token')
const saveBtn = document.getElementById('saveBtn')
const saved = document.getElementById('saved')

chrome.storage.local.get(['backendUrl', 'extensionToken'], ({ backendUrl, extensionToken }) => {
  backendUrlInput.value = backendUrl || 'https://teacher-crm-backend.onrender.com'
  tokenInput.value = extensionToken || ''
})

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set(
    { backendUrl: backendUrlInput.value.trim(), extensionToken: tokenInput.value.trim() },
    () => {
      saved.textContent = 'נשמר.'
      setTimeout(() => { saved.textContent = '' }, 2000)
    }
  )
})
