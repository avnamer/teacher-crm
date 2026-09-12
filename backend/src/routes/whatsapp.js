import express from 'express'

const router = express.Router()

// Which sending mechanism is active. Set WHATSAPP_DRIVER in backend/.env.
//
//   'manual'    — click-to-chat (default). The frontend opens a pre-filled wa.me
//                 link and Avner presses send. Nothing is sent from here, so this
//                 driver deliberately has no send endpoint.
//   'cloud_api' — official WhatsApp Cloud API. Not implemented yet; see the notes
//                 on bulk-send below for what it needs.
//
// Unofficial automation (whatsapp-web.js / Baileys) is intentionally NOT an option.
// Through 2025-26 Meta's ban waves have hit browser-based clients as hard as
// protocol ones, and the number at risk here is Avner's personal number — the same
// one every teacher already knows him by. Losing it costs far more than the manual
// send step saves.
const DRIVER = process.env.WHATSAPP_DRIVER || 'manual'

const CAPABILITIES = {
  manual: {
    autoSend: false,     // a human presses send inside WhatsApp
    scheduling: false,   // nothing can fire unattended
    media: false,        // click-to-chat can't attach files, text only
  },
  cloud_api: {
    autoSend: true,
    scheduling: true,
    media: true,
  },
}

/**
 * GET /api/whatsapp/status
 *
 * Tells the frontend which driver is active and what it can do, so the UI can
 * offer the right send button. The frontend treats an unreachable backend as
 * 'manual' — click-to-chat needs no server, and an offline backend must never
 * block a message from going out.
 */
router.get('/status', (_req, res) => {
  const capabilities = CAPABILITIES[DRIVER] || CAPABILITIES.manual

  res.json({
    // 'connected' here means "a driver is configured and ready", not "a WhatsApp
    // session is live" — the manual driver has no session to keep alive.
    status: DRIVER === 'cloud_api' ? 'connected' : 'manual',
    driver: DRIVER,
    capabilities,
  })
})

/**
 * POST /api/whatsapp/bulk-send
 *
 * Unattended sending. Only the cloud_api driver can do this.
 *
 * To implement the cloud_api driver later:
 *   1. Onboard the number via Coexistence (Business App Number Onboarding) so the
 *      WhatsApp Business App keeps working on the same number.
 *   2. Register each message_templates row as an approved Cloud API template
 *      (utility category) and store the returned template name + the positional
 *      mapping for its {{...}} variables.
 *   3. POST to /v<ver>/<phone_number_id>/messages per recipient, spacing sends by
 *      settings.message_send_delay_ms.
 *   4. Log each delivered message to interactions as type 'message_sent'.
 */
router.post('/bulk-send', (req, res) => {
  if (DRIVER !== 'cloud_api') {
    return res.status(501).json({
      message: 'שליחה אוטומטית אינה זמינה במצב הנוכחי. ההודעות נשלחות דרך WhatsApp במחשב.',
      driver: DRIVER,
      autoSend: false,
    })
  }

  return res.status(501).json({
    message: 'מנגנון Cloud API עדיין לא מומש.',
    driver: DRIVER,
    autoSend: false,
  })
})

export default router
