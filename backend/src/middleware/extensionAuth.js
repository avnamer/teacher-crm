// Gates every /api/whatsapp-sync/* route behind a fixed shared token.
//
// The Chrome extension has no Supabase session — every table's RLS is locked to
// the single logged-in owner (see docs/ARCHITECTURE.md), so a Chrome extension
// with only the anon key could not write here even if it tried. That's also why
// this route group goes through the backend's service key instead of talking to
// Supabase directly. This token is the only thing standing between the internet
// and that service-key access, so treat WHATSAPP_EXTENSION_TOKEN like a secret
// (backend/.env only, never committed, never logged).
export function requireExtensionToken(req, res, next) {
  const expected = process.env.WHATSAPP_EXTENSION_TOKEN
  if (!expected) {
    return res.status(503).json({ message: 'סנכרון וואטסאפ לא מוגדר בשרת (חסר WHATSAPP_EXTENSION_TOKEN)' })
  }
  const provided = req.get('X-Extension-Token')
  if (provided !== expected) {
    return res.status(401).json({ message: 'טוקן לא תקין' })
  }
  next()
}
