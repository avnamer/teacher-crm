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
