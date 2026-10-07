import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

// "קבוצות וואטסאפ מסונכרנות" (spec §3.1.2). The group list itself comes from
// the extension (POST /api/whatsapp-sync/groups upserts into whatsapp_groups
// as it sees groups in WhatsApp Web) — this page only toggles sync_enabled,
// which the extension never overwrites.
//
// "אילו מורים שייכים אליה" is shown from what has actually been matched and
// synced so far (real 'whatsapp' interaction rows for that group), not a guess
// at group membership — WhatsApp Web doesn't give the extension a member list,
// only messages as they're read, so there's nothing to preview before a first
// sync has run for that group.
export default function WhatsAppGroups() {
  const [groups, setGroups] = useState([])
  const [matchedByGroup, setMatchedByGroup] = useState({}) // { [groupId]: Set<contactName> }
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [adding, setAdding] = useState(false)
  const [taskGivers, setTaskGivers] = useState('')
  const [myNames, setMyNames] = useState('')
  const [mgmtSaving, setMgmtSaving] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [groupsRes, contactsRes, interactionsRes] = await Promise.all([
        supabase.from('whatsapp_groups').select('*').order('name'),
        supabase.from('contacts').select('id, name'),
        supabase.from('interactions').select('contact_id, metadata').eq('type', 'whatsapp'),
      ])
      if (groupsRes.error) throw groupsRes.error
      setGroups(groupsRes.data || [])

      const contactsById = Object.fromEntries((contactsRes.data || []).map(c => [c.id, c.name]))
      const byGroup = {}
      for (const row of interactionsRes.data || []) {
        const gid = row.metadata?.group_id
        if (!gid) continue
        const name = contactsById[row.contact_id]
        if (!name) continue
        if (!byGroup[gid]) byGroup[gid] = new Set()
        byGroup[gid].add(name)
      }
      setMatchedByGroup(byGroup)

      const mgmt = await supabase.from('management_settings').select('*').eq('id', 'global').maybeSingle()
      setTaskGivers((mgmt.data?.task_givers || []).join(', '))
      setMyNames((mgmt.data?.my_names || []).join(', '))
    } catch (err) {
      console.error('Error loading whatsapp groups:', err)
    } finally {
      setLoading(false)
    }
  }

  async function toggleGroup(group) {
    setSavingId(group.id)
    try {
      const { error } = await supabase
        .from('whatsapp_groups')
        .update({ sync_enabled: !group.sync_enabled })
        .eq('id', group.id)
      if (error) throw error
      setGroups(prev => prev.map(g => (g.id === group.id ? { ...g, sync_enabled: !g.sync_enabled } : g)))
    } catch (err) {
      alert('שגיאה בעדכון הקבוצה: ' + err.message)
    } finally {
      setSavingId(null)
    }
  }

  async function toggleManagement(group) {
    setSavingId(group.id)
    try {
      const { error } = await supabase
        .from('whatsapp_groups')
        .update({ is_management: !group.is_management })
        .eq('id', group.id)
      if (error) throw error
      setGroups(prev => prev.map(g => (g.id === group.id ? { ...g, is_management: !g.is_management } : g)))
    } catch (err) {
      alert('שגיאה בעדכון הקבוצה: ' + err.message)
    } finally {
      setSavingId(null)
    }
  }

  async function saveMgmt(e) {
    e.preventDefault()
    setMgmtSaving(true)
    try {
      const split = str => str.split(',').map(s => s.trim()).filter(Boolean)
      const { error } = await supabase.from('management_settings')
        .update({ task_givers: split(taskGivers), my_names: split(myNames) }).eq('id', 'global')
      if (error) throw error
      alert('נשמר')
    } catch (err) {
      alert('שגיאה בשמירה: ' + err.message)
    } finally {
      setMgmtSaving(false)
    }
  }

  async function addGroupManually(e) {
    e.preventDefault()
    const name = newGroupName.trim()
    if (!name) return
    setAdding(true)
    try {
      // group_id falls back to the exact name when WhatsApp Web doesn't expose a
      // real JID in the DOM (it currently doesn't — see the comment above). The
      // extension's own auto-discovery falls back to the same convention, so a
      // group added here and one the extension later reports line up as the
      // same row instead of duplicating.
      const { error } = await supabase
        .from('whatsapp_groups')
        .insert({ group_id: name, name, sync_enabled: true })
      if (error) throw error
      setNewGroupName('')
      await load()
    } catch (err) {
      alert('שגיאה בהוספת הקבוצה: ' + err.message)
    } finally {
      setAdding(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">טוען...</div>
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-800">קבוצות וואטסאפ מסונכרנות</h1>
      <p className="text-sm text-gray-500">
        קבוצות שהתוסף מזהה אוטומטית בסנכרון יופיעו כאן, אבל אפשר גם להוסיף קבוצה ידנית
        לפי השם המדויק שלה (בדיוק כמו שהיא מופיעה ב-WhatsApp). הודעות ייקלטו רק מהמורים
        שסימנתם ל"סנכרן וואטסאפ" ושכתבו בקבוצה, לפי שם/כינוי (ראו כרטיס מורה).
      </p>

      <form onSubmit={saveMgmt} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-3">
        <h2 className="font-semibold text-gray-800">משימות מההנהלה</h2>
        <p className="text-xs text-gray-500">
          סמנו קבוצה כ"קבוצת הנהלה" למטה. מהקבוצות האלה המערכת תקרא רק הודעות של מי שרשום כאן,
          ותציג בדשבורד את המשימות שלכל המנטורים או שמופנות אליכם. שמות מופרדים בפסיק.
        </p>
        <label className="block text-sm text-gray-700">
          מי נותן משימות (השם המדויק כפי שמופיע בוואטסאפ בקבוצה)
          <input value={taskGivers} onChange={e => setTaskGivers(e.target.value)}
            placeholder="בני ..., מיקה ..."
            className="mt-1 w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
        </label>
        <label className="block text-sm text-gray-700">
          איך פונים אליכם (שם / כינויים)
          <input value={myNames} onChange={e => setMyNames(e.target.value)}
            placeholder="אבנר, אבי"
            className="mt-1 w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
        </label>
        <button type="submit" disabled={mgmtSaving}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
          {mgmtSaving ? 'שומר...' : 'שמור'}
        </button>
      </form>

      <form onSubmit={addGroupManually} className="flex gap-2">
        <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
          placeholder='שם הקבוצה המדויק, למשל "כיתה ג׳2"'
          className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
        <button type="submit" disabled={adding || !newGroupName.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 shrink-0">
          {adding ? 'מוסיף...' : '+ הוסף קבוצה'}
        </button>
      </form>

      {groups.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center text-gray-500 text-sm">
          אין עדיין קבוצות. הוסיפו אחת למעלה, או המתינו לסנכרון הראשון של התוסף.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 divide-y">
          {groups.map(g => {
            const matched = [...(matchedByGroup[g.group_id] || [])]
            return (
              <div key={g.id} className="p-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-gray-800 truncate">{g.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {matched.length > 0
                      ? `מורים שזוהו בקבוצה: ${matched.join(', ')}`
                      : 'עדיין לא זוהו הודעות ממורים בקבוצה זו'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                <label className="flex items-center gap-2 text-sm text-gray-600" title="קבוצת הנהלה: נקראות רק הודעות של נותני המשימות, ונשמרות רק משימות">
                  <input type="checkbox" checked={!!g.is_management} disabled={savingId === g.id}
                    onChange={() => toggleManagement(g)} className="w-4 h-4" />
                  קבוצת הנהלה
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input type="checkbox" checked={g.sync_enabled} disabled={savingId === g.id}
                    onChange={() => toggleGroup(g)}
                    className="w-4 h-4" />
                  סנכרן
                </label>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
