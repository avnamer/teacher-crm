// Minimal service worker — required for "Add to Home Screen" installability.
// No offline caching: every request passes straight through to the network.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
