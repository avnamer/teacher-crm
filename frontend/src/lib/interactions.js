// Interaction types and their icons — the single source for both the dashboard's
// "יומן קשר אחרון" column and the contact detail page's interaction history.
//
// These lists previously existed in three places (ContactDetail.jsx, Contacts.jsx and
// voiceLogActions.js, the last of which carried a comment noting it was kept in sync
// by hand). An icon that means one thing on the dashboard and another on the detail
// page is worse than no icon, so they share one definition now.

export const INTERACTION_TYPES = [
  { value: 'phone_call', label: 'שיחת טלפון', icon: '📞' },
  { value: 'message_sent', label: 'הודעה', icon: '😞' },
  { value: 'correspondence', label: 'התכתבות', icon: '📜' },
  { value: 'meeting', label: 'פגישה', icon: '🤝' },
]

/**
 * Messages sent through the WhatsApp send queue get their own icon, so a message the
 * system sent is distinguishable at a glance from one logged by hand after the fact.
 *
 * Unicode has no paper-plane emoji (it is a well-known gap), so this is the closest
 * single character that reads as "flew out from here". Changing it is a one-line edit
 * and every surface picks it up.
 */
export const BULK_SEND_ICON = '✈️'
export const BULK_SEND_LABEL = 'הודעה שנשלחה דרך המערכת'

/** Was this interaction sent through the WhatsApp send queue? */
export function isBulkSent(interaction) {
  return interaction?.metadata?.sent_via === 'bulk'
}

/** Icon for a whole interaction row — accounts for how it was sent, not just its type. */
export function interactionIcon(interaction) {
  if (isBulkSent(interaction)) return BULK_SEND_ICON
  return typeIcon(interaction?.type)
}

/** Icon for a bare type, where no interaction row is available (e.g. a type dropdown). */
export function typeIcon(type) {
  return INTERACTION_TYPES.find(t => t.value === type)?.icon || '📋'
}

export function typeLabel(type) {
  return INTERACTION_TYPES.find(t => t.value === type)?.label || type
}

/** Human-readable description of an interaction, for tooltips. */
export function interactionLabel(interaction) {
  const base = typeLabel(interaction?.type)
  if (!isBulkSent(interaction)) return base
  const count = interaction?.metadata?.recipient_count
  return count > 1 ? `${BULK_SEND_LABEL} (${count} נמענים)` : BULK_SEND_LABEL
}
