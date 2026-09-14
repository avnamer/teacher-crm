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
  // A WhatsApp message sent to several teachers at once through the bulk send queue
  // (as opposed to 'message_sent', which is one teacher). Also selectable by hand in
  // the interaction-type dropdown, for logging a mailing sent outside the system.
  { value: 'mailing_list', label: 'רשימת דיוור', icon: '✈️' },
]

export const BULK_SEND_LABEL = 'רשימת דיוור'
// Kept as an alias so existing imports of BULK_SEND_ICON keep working.
export const BULK_SEND_ICON = INTERACTION_TYPES.find(t => t.value === 'mailing_list').icon

/**
 * Was this interaction actually sent to several teachers at once? True for rows
 * tagged 'mailing_list' directly, and — for older rows recorded before that type
 * existed — for rows carrying the same signal in metadata.sent_via instead.
 *
 * Either way this also requires recipient_count > 1: the group-send screen sets
 * sent_via: 'bulk' just from being that screen, even when the filter it was given
 * happens to match only one teacher. A send that reached one person is "הודעה",
 * not "רשימת דיוור", no matter which screen sent it — the tag and icon should
 * describe what happened, not which button was clicked.
 */
export function isBulkSent(interaction) {
  const wasBulkFlow = interaction?.type === 'mailing_list' || interaction?.metadata?.sent_via === 'bulk'
  return wasBulkFlow && (interaction?.metadata?.recipient_count ?? 0) > 1
}

/** Is this a sent message (private or mailing-list), as opposed to a call/meeting/journal? */
export function isSentMessage(interaction) {
  return interaction?.type === 'message_sent' || interaction?.type === 'mailing_list'
}

/**
 * Whether an interaction should count toward the "last contact" recency indicators
 * (dashboard bucket coloring, "יומן קשר אחרון" column). Sending a message doesn't mean it
 * reached anyone — only once someone has marked "הייתה תגובה" on it does it count as real
 * contact. Every other interaction type (calls, meetings, journal entries) always counts.
 */
export function countsTowardRecency(interaction) {
  if (!isSentMessage(interaction)) return true
  return !!interaction?.metadata?.responded
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
