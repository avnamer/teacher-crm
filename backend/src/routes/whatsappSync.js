import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireExtensionToken } from '../middleware/extensionAuth.js'
import { mergeWhatsAppMessages, findRetryCandidates } from '../services/whatsappMerge.js'
import { extractAndSaveWhatsAppTasks } from '../services/whatsappTasks.js'
import { extractManagementTasks, loadManagementSettings, extractPrivateManagementTasks } from '../services/managementTasks.js'
import { transcribeAudio } from '../services/transcribeAudio.js'
import { summarizeVoiceMessage } from '../services/whatsappSummarize.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const router = Router()
router.use(requireExtensionToken)

async function loadState() {
  const { data, error } = await supabase.from('whatsapp_sync_state').select('*').eq('id', 'global').single()
  if (error) throw error
  return data
}

async function patchState(patch) {
  const { error } = await supabase.from('whatsapp_sync_state').update(patch).eq('id', 'global')
  if (error) throw error
}

// GET /api/whatsapp-sync/targets
//
// Who/what the extension should sync this run: teachers flagged for sync
// (custom_fields.whatsappSync) with their phone + group aliases, and the
// groups the owner has enabled from the CRM's "קבוצות וואטסאפ מסונכרנות" screen.
router.get('/targets', async (_req, res) => {
  try {
    const [contactsRes, groupsRes] = await Promise.all([
      supabase.from('contacts').select('id, name, phone, custom_fields').contains('custom_fields', { whatsappSync: true }),
      supabase.from('whatsapp_groups').select('group_id, name, is_management, last_message_at').eq('sync_enabled', true),
    ])
    if (contactsRes.error) throw contactsRes.error
    if (groupsRes.error) throw groupsRes.error

    const teachers = (contactsRes.data || []).map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      groupAliases: (c.custom_fields?.whatsappGroupAliases || '')
        .split(',').map(s => s.trim()).filter(Boolean),
      lastMessageAt: c.custom_fields?.whatsappLastMessageAt || null,
      lastGroupMessageAt: c.custom_fields?.whatsappLastGroupMessageAt || {},
    }))
    const groups = (groupsRes.data || []).map(g => ({
      groupId: g.group_id, name: g.name, isManagement: !!g.is_management, lastMessageAt: g.last_message_at || null,
    }))
    const { privateChats } = await loadManagementSettings()
    res.json({ teachers, groups, privateChats })
  } catch (err) {
    console.error('[whatsapp-sync/targets]', err)
    res.status(500).json({ message: 'טעינת יעדי הסנכרון נכשלה: ' + err.message })
  }
})

// POST /api/whatsapp-sync/groups  { groups: [{ groupId, name }] }
//
// The extension reports every group it can see in WhatsApp Web. New ones are
// inserted disabled by default; sync_enabled is only ever changed from the CRM
// (the owner's own choice, spec §3.1.2) — never overwritten here.
router.post('/groups', async (req, res) => {
  const { groups } = req.body
  if (!Array.isArray(groups)) return res.status(400).json({ message: 'groups חסר' })
  try {
    for (const g of groups) {
      if (!g.groupId || !g.name) continue
      const { data: existing } = await supabase
        .from('whatsapp_groups').select('id').eq('group_id', g.groupId).maybeSingle()
      if (existing) {
        await supabase.from('whatsapp_groups').update({ name: g.name }).eq('id', existing.id)
      } else {
        await supabase.from('whatsapp_groups').insert({ group_id: g.groupId, name: g.name, sync_enabled: false })
      }
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('[whatsapp-sync/groups]', err)
    res.status(500).json({ message: 'עדכון רשימת הקבוצות נכשל: ' + err.message })
  }
})

// POST /api/whatsapp-sync/messages
// { contactId, source: 'dm'|'group', groupId?, groupName?, messages: [...] }
router.post('/messages', async (req, res) => {
  const { contactId, source, groupId, groupName, messages } = req.body
  if (!contactId || !source || !Array.isArray(messages)) {
    return res.status(400).json({ message: 'contactId / source / messages חסרים' })
  }
  try {
    const { saved, duplicatesSkipped, savedMessages } = await mergeWhatsAppMessages({ contactId, source, groupId, groupName, messages })

    // Confirmed live (2026-09-30): advancing the cursor to the batch's last
    // message regardless of whether an earlier voice message in that SAME
    // batch is still pending/failed meant the next sync's cutoff would skip
    // right past it — a voice message that didn't finish resolving on this
    // attempt could then never be retried again. Don't advance the cursor
    // past the earliest still-retriable voice message; if there is one, stop
    // just before it (or don't advance at all, if it's the very first
    // message) so the next sync re-reaches it.
    const firstUnresolvedVoice = messages.find(
      m => m.kind === 'voice' && m.transcriptionStatus !== 'done' && (m.transcriptionRetries || 0) < 3
    )
    const cursorTimestamp = firstUnresolvedVoice
      ? (messages.indexOf(firstUnresolvedVoice) > 0 ? messages[messages.indexOf(firstUnresolvedVoice) - 1].timestamp : null)
      : (messages.length > 0 ? messages[messages.length - 1].timestamp : null)
    // TEMP DEBUG (2026-09-30, remove once the cursor-not-stopping-before-a-
    // failed-voice-message mystery is solved):
    console.log('[whatsapp-sync/messages] DEBUG received', messages.length, 'messages, saved', saved, 'dupSkipped', duplicatesSkipped,
      messages.map(m => `${m.timestamp}|${m.kind}`))
    console.log('[whatsapp-sync/messages] DEBUG voice statuses:',
      messages.filter(m => m.kind === 'voice').map(m => ({ id: m.messageId?.slice(0, 10), status: m.transcriptionStatus, retries: m.transcriptionRetries })))
    console.log('[whatsapp-sync/messages] DEBUG cursorTimestamp=', cursorTimestamp, 'firstUnresolvedVoice=', firstUnresolvedVoice?.messageId?.slice(0, 10))

    if (cursorTimestamp) {
      const { data: contact } = await supabase.from('contacts').select('custom_fields').eq('id', contactId).single()
      const customFields = contact?.custom_fields || {}
      if (source === 'dm') {
        customFields.whatsappLastMessageAt = cursorTimestamp
      } else {
        customFields.whatsappLastGroupMessageAt = { ...(customFields.whatsappLastGroupMessageAt || {}), [groupId]: cursorTimestamp }
      }
      await supabase.from('contacts').update({ custom_fields: customFields }).eq('id', contactId)
    }

    if (duplicatesSkipped > 0) {
      const state = await loadState()
      await patchState({ duplicates_skipped: (state.duplicates_skipped || 0) + duplicatesSkipped })
    }
    res.json({ saved, duplicatesSkipped })

    // Task extraction (spec 2026-10-01) runs after responding, so a Claude
    // failure or slowness never fails or delays the sync. DM only; a batch that
    // saved nothing new (a re-sync) costs no Claude call.
    if (source === 'dm' && savedMessages.length > 0) {
      extractAndSaveWhatsAppTasks({ contactId, savedMessages })
        .then(r => console.log('[whatsapp-sync/tasks]', contactId, r))
        .catch(err => console.error('[whatsapp-sync/tasks]', contactId, err))
    }
  } catch (err) {
    console.error('[whatsapp-sync/messages]', err)
    res.status(500).json({ message: 'שמירת ההודעות נכשלה: ' + err.message })
  }
})

// POST /api/whatsapp-sync/management-messages
// { groupId, groupName, messages: [...] }
//
// A management group (whatsapp_groups.is_management): the extension sends every message
// it read, with its sender name. Only the task-givers' messages are analyzed; the cursor
// advances over the whole batch so the next sync reads only what's new.
router.post('/management-messages', async (req, res) => {
  const { groupId, groupName, messages } = req.body
  if (!groupId || !Array.isArray(messages)) return res.status(400).json({ message: 'groupId / messages חסרים' })
  try {
    // Extract first: if Claude fails, the cursor stays and the next sync retries the same messages.
    const result = await extractManagementTasks({ groupId, groupName: groupName || groupId, messages })
    const last = messages.length > 0 ? messages[messages.length - 1].timestamp : null
    if (last) {
      await supabase.from('whatsapp_groups').update({ last_message_at: last }).eq('group_id', groupId)
    }
    console.log('[whatsapp-sync/management]', groupName, result)
    res.json(result)
  } catch (err) {
    console.error('[whatsapp-sync/management-messages]', err)
    res.status(500).json({ message: 'עיבוד הודעות ההנהלה נכשל: ' + err.message })
  }
})

// POST /api/whatsapp-sync/management-private
// { phone, name, messages: [...] }
//
// A private chat with a task-giver (management_settings.private_chats): every message of
// theirs in the chat is a candidate. The cursor lives on that private_chats entry.
router.post('/management-private', async (req, res) => {
  const { phone, name, messages } = req.body
  if (!phone || !name || !Array.isArray(messages)) return res.status(400).json({ message: 'phone / name / messages חסרים' })
  try {
    const result = await extractPrivateManagementTasks({ phone, name, messages })
    console.log('[whatsapp-sync/management-private]', name, result)
    res.json(result)
  } catch (err) {
    console.error('[whatsapp-sync/management-private]', err)
    res.status(500).json({ message: 'עיבוד שיחה פרטית עם ההנהלה נכשל: ' + err.message })
  }
})

// POST /api/whatsapp-sync/voice-transcribe
// { audioBase64, mimeType, durationSec }
// Audio never touches Supabase — only the transcript/summary text does (spec §3.2).
router.post('/voice-transcribe', async (req, res) => {
  const { audioBase64, mimeType } = req.body
  if (!audioBase64) return res.status(400).json({ message: 'audioBase64 חסר' })
  try {
    const buffer = Buffer.from(audioBase64, 'base64')
    const transcript = await transcribeAudio(buffer, mimeType)
    if (!transcript) {
      return res.json({ transcript: null, summary: null, transcriptionStatus: 'failed' })
    }
    let summary = null
    try {
      summary = await summarizeVoiceMessage(transcript)
    } catch (err) {
      console.error('[whatsapp-sync/voice-transcribe] summary failed, keeping full transcript:', err)
    }
    res.json({ transcript, summary, transcriptionStatus: 'done' })
  } catch (err) {
    console.error('[whatsapp-sync/voice-transcribe]', err)
    res.json({ transcript: null, summary: null, transcriptionStatus: 'failed' })
  }
})

// GET /api/whatsapp-sync/retry-candidates
router.get('/retry-candidates', async (_req, res) => {
  try {
    res.json({ candidates: await findRetryCandidates() })
  } catch (err) {
    console.error('[whatsapp-sync/retry-candidates]', err)
    res.status(500).json({ message: 'טעינת רשימת התמלולים לניסיון חוזר נכשלה: ' + err.message })
  }
})

// POST /api/whatsapp-sync/heartbeat — the extension calls this ~every minute
// while alive, so the CRM can tell "extension not connected" apart from "no
// sync ran today yet" (spec §3.4).
router.post('/heartbeat', async (_req, res) => {
  try {
    await patchState({ extension_heartbeat_at: new Date().toISOString() })
    res.json({ ok: true })
  } catch (err) {
    console.error('[whatsapp-sync/heartbeat]', err)
    res.status(500).json({ message: 'heartbeat נכשל: ' + err.message })
  }
})

// POST /api/whatsapp-sync/sync/begin  { total }
router.post('/sync/begin', async (req, res) => {
  try {
    await patchState({
      last_attempt_at: new Date().toISOString(),
      last_status: 'running',
      last_error: null,
      failed_teachers: [],
      unmatched_group_senders: [],
      progress_done: 0,
      progress_total: req.body?.total || 0,
      duplicates_skipped: 0,
    })
    res.json({ ok: true })
  } catch (err) {
    console.error('[whatsapp-sync/sync/begin]', err)
    res.status(500).json({ message: 'התחלת הסנכרון נכשלה: ' + err.message })
  }
})

// POST /api/whatsapp-sync/sync/progress  { done, total }
router.post('/sync/progress', async (req, res) => {
  try {
    await patchState({ progress_done: req.body?.done ?? 0, progress_total: req.body?.total ?? 0 })
    res.json({ ok: true })
  } catch (err) {
    console.error('[whatsapp-sync/sync/progress]', err)
    res.status(500).json({ message: 'עדכון התקדמות נכשל: ' + err.message })
  }
})

// POST /api/whatsapp-sync/sync/finish  { status: 'success'|'partial'|'failed', error? }
router.post('/sync/finish', async (req, res) => {
  const { status, error } = req.body
  if (!['success', 'partial', 'failed'].includes(status)) {
    return res.status(400).json({ message: 'status לא תקין' })
  }
  try {
    const patch = { last_status: status, last_error: error || null }
    // A run that saved anything (even partially) still counts as a "last success"
    // for the 24h freshness indicator (spec §3.4) — only a total failure doesn't.
    if (status !== 'failed') patch.last_success_at = new Date().toISOString()
    await patchState(patch)
    res.json({ ok: true })
  } catch (err) {
    console.error('[whatsapp-sync/sync/finish]', err)
    res.status(500).json({ message: 'סיום הסנכרון נכשל: ' + err.message })
  }
})

// POST /api/whatsapp-sync/unmatched  { senderName, groupName, at }
router.post('/unmatched', async (req, res) => {
  const { senderName, groupName, at } = req.body
  if (!senderName || !groupName) return res.status(400).json({ message: 'senderName / groupName חסרים' })
  try {
    const state = await loadState()
    const list = state.unmatched_group_senders || []
    if (!list.some(u => u.senderName === senderName && u.groupName === groupName)) {
      list.push({ senderName, groupName, at: at || new Date().toISOString() })
    }
    await patchState({ unmatched_group_senders: list })
    res.json({ ok: true })
  } catch (err) {
    console.error('[whatsapp-sync/unmatched]', err)
    res.status(500).json({ message: 'רישום שולח לא מזוהה נכשל: ' + err.message })
  }
})

// POST /api/whatsapp-sync/failed  { teacherName, reason }
router.post('/failed', async (req, res) => {
  const { teacherName, reason } = req.body
  if (!teacherName) return res.status(400).json({ message: 'teacherName חסר' })
  try {
    const state = await loadState()
    const list = state.failed_teachers || []
    list.push({ teacherName, reason: reason || 'שגיאה לא ידועה', at: new Date().toISOString() })
    await patchState({ failed_teachers: list })
    res.json({ ok: true })
  } catch (err) {
    console.error('[whatsapp-sync/failed]', err)
    res.status(500).json({ message: 'רישום כישלון נכשל: ' + err.message })
  }
})

// GET /api/whatsapp-sync/pending-request
//
// Atomically claims the oldest pending manual-sync request (from the CRM's
// button, possibly pressed from a phone) so the extension's poll loop and a
// concurrent manual click can't both pick up the same request.
router.get('/pending-request', async (_req, res) => {
  try {
    const { data: pending, error: findErr } = await supabase
      .from('whatsapp_sync_requests')
      .select('id')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (findErr) throw findErr
    if (!pending) return res.json({ request: null })

    const { data: claimed, error: claimErr } = await supabase
      .from('whatsapp_sync_requests')
      .update({ status: 'running' })
      .eq('id', pending.id)
      .eq('status', 'pending') // loses the race harmlessly if another poll got there first
      .select('id')
      .maybeSingle()
    if (claimErr) throw claimErr
    res.json({ request: claimed ? { id: claimed.id } : null })
  } catch (err) {
    console.error('[whatsapp-sync/pending-request]', err)
    res.status(500).json({ message: 'בדיקת בקשות סנכרון נכשלה: ' + err.message })
  }
})

// POST /api/whatsapp-sync/request-done  { requestId, status: 'done'|'failed' }
router.post('/request-done', async (req, res) => {
  const { requestId, status } = req.body
  if (!requestId || !['done', 'failed'].includes(status)) {
    return res.status(400).json({ message: 'requestId / status לא תקינים' })
  }
  try {
    const { error } = await supabase.from('whatsapp_sync_requests').update({ status }).eq('id', requestId)
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    console.error('[whatsapp-sync/request-done]', err)
    res.status(500).json({ message: 'עדכון בקשת הסנכרון נכשל: ' + err.message })
  }
})

export default router
