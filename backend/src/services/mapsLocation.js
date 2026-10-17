// Turns a pasted Google Maps link (share link like https://maps.app.goo.gl/… or a full
// google.com/maps URL) into coordinates + the place name. Short links are followed by
// hand, one hop at a time, and only to Google hosts — so this can't be used to make the
// server fetch arbitrary URLs.

const ALLOWED_HOSTS = new Set([
  'maps.app.goo.gl', 'goo.gl', 'maps.google.com',
  'google.com', 'www.google.com', 'google.co.il', 'www.google.co.il',
])
const MAX_HOPS = 5

function isAllowed(url) {
  return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname)
}

const inRange = (lat, lng) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180

/** { lat, lng, label } from a (long) Google Maps URL, or null. Prefers the pin (!3d!4d) over the map center (@). */
export function parseMapsUrl(raw) {
  let decoded = raw
  try { decoded = decodeURIComponent(raw) } catch { /* keep raw */ }
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|ll|query|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
  ]
  for (const re of patterns) {
    const m = decoded.match(re)
    if (!m) continue
    const lat = Number(m[1]), lng = Number(m[2])
    if (!inRange(lat, lng)) continue
    const name = decoded.match(/\/maps\/place\/([^/@?]+)/)?.[1]
    return { lat, lng, label: name ? name.replace(/\+/g, ' ').trim() : null }
  }
  return null
}

export async function resolveMapsLink(input) {
  let url
  try { url = new URL(String(input || '').trim()) } catch { throw new Error('זה לא נראה כמו קישור') }
  if (!isAllowed(url)) throw new Error('נתמכים רק קישורים מ-Google Maps')

  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const parsed = parseMapsUrl(url.href)
    if (parsed) return { ...parsed, url: String(input).trim() }
    const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } })
    const location = res.headers.get('location')
    if (!location || res.status < 300 || res.status >= 400) break
    url = new URL(location, url)
    if (!isAllowed(url)) throw new Error('הקישור הפנה לאתר לא נתמך')
  }
  throw new Error('לא נמצאו קואורדינטות בקישור. הדבק קישור "שיתוף" של מקום מ-Google Maps')
}
