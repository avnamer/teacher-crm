import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .eq('id', 'global')
        .single()
      if (error) throw error
      setSettings(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function saveSettings() {
    setSaving(true)
    setSaved(false)
    try {
      const { error } = await supabase
        .from('settings')
        .update(settings)
        .eq('id', 'global')
      if (error) throw error
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      alert('שגיאה בשמירה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  function toggleDay(day) {
    const days = settings.available_days || []
    if (days.includes(day)) {
      setSettings({ ...settings, available_days: days.filter(d => d !== day) })
    } else {
      setSettings({ ...settings, available_days: [...days, day].sort() })
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">טוען...</div>
  }

  if (!settings) {
    return <div className="text-center py-12 text-gray-500">שגיאה בטעינת הגדרות</div>
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-800">הגדרות</h1>

      {/* Meeting availability */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">זמינות לפגישות</h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-600 mb-2 block">ימים פנויים</label>
            <div className="flex flex-wrap gap-2">
              {DAY_NAMES.map((name, i) => (
                <button
                  key={i}
                  onClick={() => toggleDay(i)}
                  className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                    settings.available_days?.includes(i)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-600">שעת התחלה</label>
              <input type="time" value={settings.working_hours_start}
                onChange={e => setSettings({...settings, working_hours_start: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg outline-none" />
            </div>
            <div>
              <label className="text-sm text-gray-600">שעת סיום</label>
              <input type="time" value={settings.working_hours_end}
                onChange={e => setSettings({...settings, working_hours_end: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg outline-none" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-600">משך פגישה (דקות)</label>
              <input type="number" value={settings.slot_duration_minutes}
                onChange={e => setSettings({...settings, slot_duration_minutes: parseInt(e.target.value) || 30})}
                className="w-full px-3 py-2 border rounded-lg outline-none" />
            </div>
            <div>
              <label className="text-sm text-gray-600">חלון הזמנה (שבועות)</label>
              <input type="number" value={settings.booking_window_weeks}
                onChange={e => setSettings({...settings, booking_window_weeks: parseInt(e.target.value) || 3})}
                className="w-full px-3 py-2 border rounded-lg outline-none" />
            </div>
          </div>
        </div>
      </div>

      {/* WhatsApp settings */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">WhatsApp</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-600">השהיה בין הודעות (מילישניות)</label>
            <input type="number" value={settings.message_send_delay_ms}
              onChange={e => setSettings({...settings, message_send_delay_ms: parseInt(e.target.value) || 3000})}
              className="w-full px-3 py-2 border rounded-lg outline-none" />
            <p className="text-xs text-gray-400 mt-1">
              מומלץ לפחות 3000 (3 שניות) כדי למנוע חסימה
            </p>
          </div>
          <div>
            <label className="text-sm text-gray-600">קבוצת WhatsApp ליום הולדת (JID)</label>
            <input value={settings.birthday_group_jid || ''} dir="ltr"
              onChange={e => setSettings({...settings, birthday_group_jid: e.target.value})}
              placeholder="123456789@g.us"
              className="w-full px-3 py-2 border rounded-lg outline-none" />
          </div>
        </div>
      </div>

      {/* Alerts */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">התראות</h2>
        <div>
          <label className="text-sm text-gray-600">התראה על איש קשר רדום (ימים)</label>
          <input type="number" value={settings.meeting_alert_days}
            onChange={e => setSettings({...settings, meeting_alert_days: parseInt(e.target.value) || 30})}
            className="w-full px-3 py-2 border rounded-lg outline-none" />
          <p className="text-xs text-gray-400 mt-1">
            אם לא נפגשת עם איש קשר למשך X ימים, תקבל התראה
          </p>
        </div>
      </div>

      {/* Monday.com */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Monday.com</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-600">מזהה בורד (Board ID)</label>
            <input value={settings.monday_board_id || ''} dir="ltr"
              onChange={e => setSettings({...settings, monday_board_id: e.target.value})}
              placeholder="1234567890"
              className="w-full px-3 py-2 border rounded-lg outline-none" />
          </div>
          <div>
            <label className="text-sm text-gray-600">API Token של Monday</label>
            <input value={settings.monday_api_token || ''} dir="ltr" type="password"
              onChange={e => setSettings({...settings, monday_api_token: e.target.value})}
              placeholder="eyJhbGciOiJIUzI1NiJ9..."
              className="w-full px-3 py-2 border rounded-lg outline-none font-mono text-sm" />
            <p className="text-xs text-gray-400 mt-1">
              ניתן למצוא ב-Monday → פרופיל → Developers → API v2 Token
            </p>
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button onClick={saveSettings} disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'שומר...' : 'שמור הגדרות'}
        </button>
        {saved && <span className="text-green-600 text-sm">נשמר בהצלחה!</span>}
      </div>
    </div>
  )
}
