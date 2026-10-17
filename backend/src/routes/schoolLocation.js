import { Router } from 'express'
import { resolveMapsLink } from '../services/mapsLocation.js'

const router = Router()

// POST /api/school-location/resolve — { url } → { lat, lng, label, url } from a pasted Google Maps link
router.post('/resolve', async (req, res) => {
  try {
    res.json(await resolveMapsLink(req.body?.url))
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

export default router
