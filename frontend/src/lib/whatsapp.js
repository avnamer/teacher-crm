// ─── WhatsApp sending — shared helpers ────────────────────────────
//
// Sending is driver-based so the mechanism can change without touching the UI:
//
//   'manual'    — click-to-chat. We open a wa.me link with the message pre-filled
//                 and the user presses send inside WhatsApp. No backend needed, no
//                 automation, so there is nothing for Meta to flag. This is the
//                 default and it keeps working even when the backend is offline.
//   'cloud_api' — official WhatsApp Cloud API (planned). Sends unattended from the
//                 backend. Needs the number onboarded to Cloud API via Coexistence
//                 so messages still come from Avner's own number.
//
// Drivers are reported by GET /api/whatsapp/status. If the backend is unreachable
// we fall back to 'manual' rather than failing — an offline backend must never be
// the reason a message can't go out.

const DEFAULT_COUNTRY_CODE = '972' // Israel

/**
 * What we assume when the backend can't be reached.
 *
 * Click-to-chat needs no server at all, so an offline (or not-yet-deployed)
 * backend should degrade to manual sending rather than disabling the feature —
 * this is also what the Netlify-hosted frontend gets when no backend URL is
 * configured for it.
 */
export const MANUAL_DRIVER = {
  status: 'manual',
  driver: 'manual',
  capabilities: { autoSend: false, scheduling: false, media: false },
}

/** Ask the backend which driver is active; fall back to manual when it isn't there. */
export async function fetchDriver() {
  try {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'
    const res = await fetch(`${backendUrl}/api/whatsapp/status`)
    if (!res.ok) return MANUAL_DRIVER
    const data = await res.json()
    return {
      status: data.status || 'manual',
      driver: data.driver || 'manual',
      capabilities: { ...MANUAL_DRIVER.capabilities, ...(data.capabilities || {}) },
    }
  } catch {
    return MANUAL_DRIVER
  }
}

/**
 * Normalise a stored phone number to bare E.164 digits (no '+'), which is the
 * format wa.me expects.
 *
 * Handles the shapes that actually show up in the contacts table: '050-1234567',
 * '0501234567', '+972501234567', '972 50 123 4567', and bare '501234567'.
 * Returns null when the number can't be understood, so callers can flag the
 * contact instead of opening a chat with a wrong or empty recipient.
 */
export function normalizePhone(raw) {
  if (!raw) return null

  let digits = String(raw).replace(/\D/g, '')
  if (!digits) return null

  // Already international (972...). Israeli subscriber numbers are 9 digits, so a
  // well-formed international number is 12 digits total.
  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    const national = digits.slice(DEFAULT_COUNTRY_CODE.length)
    return national.length === 9 ? digits : null
  }

  // Local format with trunk prefix: 0501234567 -> 972501234567
  if (digits.startsWith('0')) {
    const national = digits.slice(1)
    return national.length === 9 ? DEFAULT_COUNTRY_CODE + national : null
  }

  // Bare national number: 501234567 -> 972501234567
  if (digits.length === 9) return DEFAULT_COUNTRY_CODE + digits

  // Anything else (a foreign number stored in full, a truncated entry) we don't
  // try to guess at — guessing here means messaging a stranger.
  return digits.length >= 10 && digits.length <= 15 ? digits : null
}

/** Human-readable reason a contact can't be messaged, or null when it can. */
export function phoneProblem(contact) {
  if (!contact?.phone) return 'אין מספר טלפון'
  if (!normalizePhone(contact.phone)) return 'מספר טלפון לא תקין'
  return null
}

/**
 * Fill a template body with a contact's details.
 *
 * `_open_tasks_text` is a transient client-only field set by the per-teacher task
 * composer; it never exists on a row loaded from the database.
 */
export function resolveMessage(body, contact) {
  if (!body) return ''
  const firstName = contact.name?.split(' ')[0] || ''
  return body
    .replace(/\{\{name\}\}/g, firstName)
    .replace(/\{\{school\}\}/g, contact.school || '')
    .replace(/\{\{class_name\}\}/g, contact.class_name || '')
    .replace(/\{\{hackathon_date\}\}/g, contact.hackathon_date
      ? new Date(contact.hackathon_date).toLocaleDateString('he-IL') : '')
    .replace(/\{\{phone\}\}/g, contact.phone || '')
    .replace(/\{\{open_tasks\}\}/g, contact._open_tasks_text || '')
}

/** Pick the gendered body for a contact, falling back to the male body. */
export function bodyForContact(template, contact) {
  if (!template) return ''
  return contact.gender === 'female'
    ? (template.body_female || template.body_male)
    : (template.body_male || template.body_female)
}

/** The fully resolved message a contact will receive. */
export function messageForContact(template, contact) {
  return resolveMessage(bodyForContact(template, contact), contact)
}

/**
 * Build a click-to-chat URL with the message pre-filled.
 *
 * wa.me is the official click-to-chat endpoint and routes itself to the desktop
 * app or WhatsApp Web depending on what the machine has — preferable to linking
 * web.whatsapp.com directly, which forces the browser client.
 */
export function buildChatUrl(contact, text) {
  const phone = normalizePhone(contact?.phone)
  if (!phone) return null
  return `https://wa.me/${phone}?text=${encodeURIComponent(text || '')}`
}
