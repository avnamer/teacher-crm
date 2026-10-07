-- Teacher CRM - Supabase Tables Setup
-- הרץ את הסקריפט הזה ב-SQL Editor של Supabase

-- 1. טבלת אנשי קשר
CREATE TABLE contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT UNIQUE NOT NULL,
  school TEXT,
  class_name TEXT,
  gender TEXT CHECK (gender IN ('male', 'female')) NOT NULL,
  hackathon_date DATE,
  birthday DATE,
  custom_fields JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. טבלת אינטראקציות
CREATE TABLE interactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
  type TEXT CHECK (type IN ('message_sent', 'correspondence', 'meeting', 'phone_call', 'journal')) NOT NULL,
  content TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. טבלת פגישות
CREATE TABLE meetings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT DEFAULT 30,
  status TEXT CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')) DEFAULT 'scheduled',
  google_event_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. טבלת תבניות הודעה
CREATE TABLE message_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  body_male TEXT NOT NULL,
  body_female TEXT NOT NULL,
  media_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. טבלת הגדרות מערכת (שורה אחת)
CREATE TABLE settings (
  id TEXT DEFAULT 'global' PRIMARY KEY,
  available_days JSONB DEFAULT '[0, 1, 4]',
  slot_duration_minutes INT DEFAULT 30,
  booking_window_weeks INT DEFAULT 3,
  working_hours_start TEXT DEFAULT '09:00',
  working_hours_end TEXT DEFAULT '17:00',
  birthday_group_jid TEXT,
  meeting_alert_days INT DEFAULT 30,
  message_send_delay_ms INT DEFAULT 3000,
  monday_board_id TEXT,
  contacts_columns JSONB DEFAULT '[]',
  google_calendar_tokens JSONB
);

-- 6. טבלת WhatsApp Auth (Baileys session)
CREATE TABLE whatsapp_auth (
  id TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- 7. טבלת הודעות מתוזמנות
CREATE TABLE scheduled_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID REFERENCES message_templates(id),
  filter_criteria JSONB DEFAULT '{}',
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT CHECK (status IN ('pending', 'sending', 'completed', 'failed')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. טבלת מנטורים
CREATE TABLE mentors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  coordinator TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- אינדקסים
CREATE INDEX idx_contacts_phone ON contacts(phone);
CREATE INDEX idx_contacts_gender ON contacts(gender);
CREATE INDEX idx_contacts_hackathon_date ON contacts(hackathon_date);
CREATE INDEX idx_interactions_contact_id ON interactions(contact_id);
CREATE INDEX idx_interactions_created_at ON interactions(created_at DESC);
CREATE INDEX idx_meetings_contact_id ON meetings(contact_id);
CREATE INDEX idx_meetings_scheduled_at ON meetings(scheduled_at);
CREATE INDEX idx_meetings_status ON meetings(status);
CREATE INDEX idx_scheduled_messages_status ON scheduled_messages(status);
CREATE INDEX idx_scheduled_messages_scheduled_for ON scheduled_messages(scheduled_for);
CREATE INDEX idx_mentors_name ON mentors(name);

-- פונקציה לעדכון updated_at אוטומטי
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- טריגרים לעדכון אוטומטי
CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER meetings_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER message_templates_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER mentors_updated_at
  BEFORE UPDATE ON mentors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS (Row Level Security) - כרגע מאפשר הכל למשתמשים מאומתים
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_auth ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentors ENABLE ROW LEVEL SECURITY;

-- מדיניות: משתמש מאומת יכול לעשות הכל
CREATE POLICY "Authenticated users full access" ON contacts FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON interactions FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON meetings FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON message_templates FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON settings FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON whatsapp_auth FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON scheduled_messages FOR ALL USING (auth.role() = 'authenticated');

-- מדיניות ציבורית לדף הזמנת פגישות (meetings + contacts read-only)
CREATE POLICY "Public can read available meetings" ON meetings FOR SELECT USING (true);
CREATE POLICY "Public can insert meetings" ON meetings FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can read contacts by phone" ON contacts FOR SELECT USING (true);
CREATE POLICY "Public can read settings" ON settings FOR SELECT USING (true);

-- מדיניות ציבורית לתבניות הודעה ולהודעות מתוזמנות (אין auth בפרויקט)
CREATE POLICY "Public full access to message_templates" ON message_templates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access to scheduled_messages" ON scheduled_messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access to mentors" ON mentors FOR ALL USING (true) WITH CHECK (true);

-- מדיניות ציבורית לעדכון הגדרות (אין auth בפרויקט — בלי זה, כל שמירה בדף ההגדרות נכשלת בשקט)
CREATE POLICY "Public can update settings" ON settings FOR UPDATE USING (true) WITH CHECK (true);

-- מדיניות ציבורית לאינטראקציות (אין auth בפרויקט — נדרש לתאי יומן/אירועים בטבלת אנשי קשר)
CREATE POLICY "Public full access to interactions" ON interactions FOR ALL USING (true) WITH CHECK (true);

-- הכנס שורת הגדרות ברירת מחדל
INSERT INTO settings (id) VALUES ('global');

-- תבניות הודעה לדוגמה
INSERT INTO message_templates (name, body_male, body_female) VALUES
  ('הזמנה לאקתון', 'שלום {{name}}, אנחנו שמחים להזמין אותך לאקתון שיתקיים בתאריך {{hackathon_date}} בבית הספר {{school}}. נשמח לראותך!', 'שלום {{name}}, אנחנו שמחים להזמין אותך לאקתון שיתקיים בתאריך {{hackathon_date}} בבית הספר {{school}}. נשמח לראותך!'),
  ('תזכורת פגישה', 'היי {{name}}, רציתי להזכיר לך שיש לנו פגישה מחר. מחכה לראותך!', 'היי {{name}}, רציתי להזכיר לך שיש לנו פגישה מחר. מחכה לראותך!'),
  ('יום הולדת', 'יום הולדת שמח {{name}}! 🎂🎉 מאחל לך שנה מלאה בהצלחות!', 'יום הולדת שמח {{name}}! 🎂🎉 מאחלת לך שנה מלאה בהצלחות!');

-- ─────────────────────────────────────────────────────────────
-- מיגרציה: עמודות מותאמות אישית בדף אנשי קשר (הרץ פעם אחת אם הטבלה כבר קיימת)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE settings ADD COLUMN IF NOT EXISTS contacts_columns JSONB DEFAULT '[]';

-- ─────────────────────────────────────────────────────────────
-- מיגרציה: עמודת יומן/אירועים בדף אנשי קשר (הרץ פעם אחת אם הטבלה כבר קיימת)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE interactions DROP CONSTRAINT IF EXISTS interactions_type_check;
ALTER TABLE interactions ADD CONSTRAINT interactions_type_check
  CHECK (type IN ('whatsapp_sent', 'whatsapp_received', 'meeting', 'phone_call', 'journal'));

-- ─────────────────────────────────────────────────────────────
-- מיגרציה: אייקוני סוג אינטראקציה - הודעה חד-צדדית / התכתבות (הרץ פעם אחת אם הטבלה כבר קיימת)
-- מחליף whatsapp_sent/whatsapp_received (שמעולם לא נוצרו בפועל) ב-message_sent/correspondence
-- ─────────────────────────────────────────────────────────────
ALTER TABLE interactions DROP CONSTRAINT IF EXISTS interactions_type_check;
ALTER TABLE interactions ADD CONSTRAINT interactions_type_check
  CHECK (type IN ('message_sent', 'correspondence', 'meeting', 'phone_call', 'journal'));

-- ─────────────────────────────────────────────────────────────
-- מיגרציה: טבלת פריטים ממתינים לאישור מהתיעוד הקולי (הרץ פעם אחת)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pending_voice_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mentor_name TEXT NOT NULL,
  transcript TEXT NOT NULL,
  route TEXT,
  teacher_name_spoken TEXT,
  matched_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  communication_type TEXT,
  summary TEXT,
  action_items JSONB DEFAULT '[]',
  mentioned_dates JSONB DEFAULT '[]',
  column_label TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_voice_logs_mentor_name ON pending_voice_logs(mentor_name);

ALTER TABLE pending_voice_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public full access to pending_voice_logs" ON pending_voice_logs FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- Private secrets (2026-09-14) — Google OAuth tokens
-- ─────────────────────────────────────────────────────────────
-- Google Calendar tokens must never be reachable with the public anon key that
-- the browser frontend uses. `settings` is world-readable (see its SELECT
-- policy above), so tokens are moved here: RLS is ON and there is deliberately
-- NO policy, which means anon/authenticated roles get nothing. Only the
-- backend's service_role key (which bypasses RLS) can read or write this table.
CREATE TABLE IF NOT EXISTS app_private (
  id TEXT PRIMARY KEY,
  google_calendar_tokens JSONB
);

ALTER TABLE app_private ENABLE ROW LEVEL SECURITY;
-- (No CREATE POLICY on purpose. service_role bypasses RLS; everyone else is denied.)

-- One-time migration of any existing token value out of the public table.
INSERT INTO app_private (id, google_calendar_tokens)
SELECT 'global', google_calendar_tokens
FROM settings
WHERE id = 'global' AND google_calendar_tokens IS NOT NULL
ON CONFLICT (id) DO UPDATE SET google_calendar_tokens = EXCLUDED.google_calendar_tokens;

-- Remove the world-readable copy for good.
ALTER TABLE settings DROP COLUMN IF EXISTS google_calendar_tokens;

-- ─────────────────────────────────────────────────────────────
-- Single-user auth (2026-09-14) — BLOCK A: owner policies
-- Safe to run at any time. Additive only: grants the logged-in owner
-- access without changing existing public access. Run this, verify login
-- works, THEN run Block B (removes the public policies).
-- ─────────────────────────────────────────────────────────────
CREATE POLICY "Owner full access" ON contacts          FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON interactions       FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON meetings           FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON message_templates  FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON settings           FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON whatsapp_auth      FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON scheduled_messages FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON mentors            FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON pending_voice_logs FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');

-- ─────────────────────────────────────────────────────────────
-- Single-user auth (2026-09-14) — BLOCK B: remove public access (CUTOVER)
-- Run ONLY after production login is verified. Drops every world-open policy
-- and every any-authenticated policy, leaving only "Owner full access".
-- ─────────────────────────────────────────────────────────────
-- Any-authenticated policies (auth.role() = 'authenticated' — would let ANY signed-in user in)
DROP POLICY IF EXISTS "Authenticated users full access" ON contacts;
DROP POLICY IF EXISTS "Authenticated users full access" ON interactions;
DROP POLICY IF EXISTS "Authenticated users full access" ON meetings;
DROP POLICY IF EXISTS "Authenticated users full access" ON message_templates;
DROP POLICY IF EXISTS "Authenticated users full access" ON settings;
DROP POLICY IF EXISTS "Authenticated users full access" ON whatsapp_auth;
DROP POLICY IF EXISTS "Authenticated users full access" ON scheduled_messages;
-- Public (anon) policies
DROP POLICY IF EXISTS "Public can read contacts by phone" ON contacts;
DROP POLICY IF EXISTS "Public full access to interactions" ON interactions;
DROP POLICY IF EXISTS "Public can read available meetings" ON meetings;
DROP POLICY IF EXISTS "Public can insert meetings" ON meetings;
DROP POLICY IF EXISTS "Public full access to message_templates" ON message_templates;
DROP POLICY IF EXISTS "Public can read settings" ON settings;
DROP POLICY IF EXISTS "Public can update settings" ON settings;
DROP POLICY IF EXISTS "Public full access to scheduled_messages" ON scheduled_messages;
DROP POLICY IF EXISTS "Public full access to mentors" ON mentors;
DROP POLICY IF EXISTS "Public full access to pending_voice_logs" ON pending_voice_logs;

-- ─────────────────────────────────────────────────────────────
-- Single-user auth (2026-09-14) — BLOCK B2: close leftover public policies
-- The live DB had "Anon full access" policies (added via the dashboard, never
-- in this file) that Block B didn't know about: on contacts, and on two
-- orphan tables (monday_tasks, teacher_teams) not used by the app or defined
-- here. Drop the public access; lock the orphan tables (RLS on, no policy →
-- service-role only). contacts keeps only "Owner full access".
-- ─────────────────────────────────────────────────────────────
ALTER TABLE monday_tasks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon full access" ON contacts;
DROP POLICY IF EXISTS "Anon full access" ON monday_tasks;
DROP POLICY IF EXISTS "Anon full access" ON teacher_teams;

-- ─────────────────────────────────────────────────────────────
-- מיגרציה: הוספת 'mailing_list' לסוגי אינטראקציה (הרץ פעם אחת)
-- lib/interactions.js ו-SendQueueModal.jsx כותבים type: 'mailing_list' לכל שליחה
-- קבוצתית מאז ש"רשימת דיוור" נוסף כסוג נפרד, אבל האילוץ בטבלה מעולם לא עודכן —
-- כל שורת mailing_list נדחתה בשקט (הודעה נשלחה בפועל אך לא נרשמה ביומן).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE interactions DROP CONSTRAINT IF EXISTS interactions_type_check;
ALTER TABLE interactions ADD CONSTRAINT interactions_type_check
  CHECK (type IN ('message_sent', 'correspondence', 'meeting', 'phone_call', 'journal', 'mailing_list'));

-- ─────────────────────────────────────────────────────────────
-- מיגרציה: סנכרון הודעות וואטסאפ (2026-09-26, הרץ פעם אחת)
--
-- שדות התצורה למורה (whatsappSync, whatsappGroupAliases, whatsappLastMessageAt,
-- whatsappLastGroupMessageAt) לא מקבלים עמודות ייעודיות — הם נכנסים ל-
-- contacts.custom_fields, כמו mentor_name הקיים, כדי לא לגעת בסכימה של contacts.
--
-- התוסף (Chrome extension) לא מחזיק Supabase credentials בכלל: הוא מדבר רק עם
-- הבקאנד (טוקן קבוע ב-WHATSAPP_EXTENSION_TOKEN), שכותב דרך ה-service key. גם
-- אם היה מחזיק את מפתח ה-anon, ה-RLS "Owner full access" חוסם כתיבה בלי session
-- מאומת של הבעלים — כך שדרך הבקאנד היא לא רק נוחה אלא הכרחית.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE interactions DROP CONSTRAINT IF EXISTS interactions_type_check;
ALTER TABLE interactions ADD CONSTRAINT interactions_type_check
  CHECK (type IN ('message_sent', 'correspondence', 'meeting', 'phone_call', 'journal', 'mailing_list', 'whatsapp'));

CREATE TABLE IF NOT EXISTS whatsapp_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id TEXT UNIQUE NOT NULL, -- מזהה הקבוצה ב-WhatsApp (למשל 123456789@g.us)
  name TEXT NOT NULL,
  sync_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_sync_enabled ON whatsapp_groups(sync_enabled);
CREATE TRIGGER whatsapp_groups_updated_at
  BEFORE UPDATE ON whatsapp_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- שורה יחידה, בדיוק כמו settings — סטטוס הסנכרון המוצג בכפתור/שורת הסטטוס בעמוד המורים.
CREATE TABLE IF NOT EXISTS whatsapp_sync_state (
  id TEXT DEFAULT 'global' PRIMARY KEY,
  last_success_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_status TEXT CHECK (last_status IN ('success', 'partial', 'failed', 'running')),
  last_error TEXT,
  failed_teachers JSONB DEFAULT '[]',
  unmatched_group_senders JSONB DEFAULT '[]',
  progress_done INT DEFAULT 0,
  progress_total INT DEFAULT 0,
  duplicates_skipped INT DEFAULT 0,
  extension_heartbeat_at TIMESTAMPTZ
);
INSERT INTO whatsapp_sync_state (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;

-- בקשות סנכרון ידניות — נוצרות ע"י ה-CRM (מהמחשב או מהטלפון), נקלטות ע"י התוסף
-- דרך polling (GET /api/whatsapp-sync/pending-request), כי לתוסף אין session של Supabase.
CREATE TABLE IF NOT EXISTS whatsapp_sync_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requested_at TIMESTAMPTZ DEFAULT now(),
  source TEXT CHECK (source IN ('manual', 'auto')) DEFAULT 'manual',
  status TEXT CHECK (status IN ('pending', 'running', 'done', 'failed')) DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sync_requests_status ON whatsapp_sync_requests(status);

ALTER TABLE whatsapp_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_sync_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner full access" ON whatsapp_groups        FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON whatsapp_sync_state    FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON whatsapp_sync_requests FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');

-- ─────────────────────────────────────────────────────────────
-- מיגרציה: משימות מההנהלה (2026-10-07, הרץ פעם אחת ב-Supabase SQL Editor)
--
-- קבוצות וואטסאפ מסומנות "קבוצת הנהלה" (whatsapp_groups.is_management): הסנכרון קורא
-- בהן הודעות רק משמות ה"נותנים משימות" (בני, מיקה), ו-Claude מחלץ מהן משימות שמיועדות
-- לכל המנטורים או לאבנר בשמו. התוצאה נשמרת ב-management_tasks ומוצגת בדשבורד.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE whatsapp_groups ADD COLUMN IF NOT EXISTS is_management BOOLEAN DEFAULT false;
ALTER TABLE whatsapp_groups ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ; -- סמן קריאה לקבוצות הנהלה

-- שורה יחידה: מי נותן משימות, ובאילו שמות פונים אל אבנר.
CREATE TABLE IF NOT EXISTS management_settings (
  id TEXT DEFAULT 'global' PRIMARY KEY,
  task_givers TEXT[] DEFAULT '{}', -- שמות כפי שמופיעים בוואטסאפ, למשל {"בני כהן","מיקה לוי"}
  my_names TEXT[] DEFAULT '{}'     -- איך פונים אל אבנר ("אבנר", "אבי")
);
INSERT INTO management_settings (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS management_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  text TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('all', 'me')), -- all = לכל המנטורים, me = מופנית לאבנר בשמו
  sender_name TEXT NOT NULL,
  group_id TEXT,
  group_name TEXT,
  message_id TEXT,
  message_text TEXT,      -- ההודעה המקורית
  message_date DATE,      -- תאריך ההודעה (שעון ישראל)
  due_date DATE,
  done BOOLEAN DEFAULT false,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_management_tasks_done ON management_tasks(done, message_date DESC);

ALTER TABLE management_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE management_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner full access" ON management_settings FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
CREATE POLICY "Owner full access" ON management_tasks    FOR ALL USING (auth.jwt() ->> 'email' = 'avnamer@gmail.com') WITH CHECK (auth.jwt() ->> 'email' = 'avnamer@gmail.com');
