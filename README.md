# Teacher CRM

מערכת CRM אישית למנטור בתוכנית Tech-School: ניהול הקשר עם המורים, כולל יומן אינטראקציות, משימות, פגישות, WhatsApp ותיעוד שיחות בקול.

🌐 **אתר:** https://comforting-pegasus-780af0.netlify.app

## מה יש במערכת

- **דשבורד מורים** (`/contacts`): טבלה עם עמודות שאפשר להסתיר, להזיז ולשנות רוחב, ועריכה ישירה בתא. יש עמודות יומן, עמודות משימה (כלליות או מ-Monday) עם מונים, ופס "זמן מאז קשר אחרון". בראש הדף מופיעים תור אישור להקלטות קוליות והתראה על פגישות שעבר מועדן.
- **כרטיס מורה** (`/contacts/:id`): היסטוריית אינטראקציות ויומן.
- **פגישות** (`/meetings`): קביעת פגישות עתידיות, פגישות שהתקיימו מקובצות לפי בית ספר, סטטוס עדכניות לכל בית ספר, ועריכה ומחיקה של פגישה לכל המשתתפים יחד.
- **WhatsApp** (`/whatsapp`): שליחה דרך click-to-chat, תור שליחה לכמה נמענים וסינון נמענים לפי השלמת משימה.
- **תיעוד שיחה בקול** (`/voice-log`, PWA): הכתבה בעברית, סיכום על ידי Claude, המתנה לאישור בדשבורד, ואז שמירה ביומן המורה וב-Google Calendar.
- **מנטורים** (`/mentors`) ו**הגדרות** (`/settings`, כולל ייבוא CSV).

## טכנולוגיה

React + Vite (Netlify) · Node/Express (Render) · Supabase Postgres · Anthropic API · Google Calendar API

## הרצה מקומית

```bash
cd backend && npm install && npm run dev    # http://localhost:3001
cd frontend && npm install && npm run dev   # http://localhost:5173
```

צריך את הקבצים `backend/.env` ו-`frontend/.env.local`. הם לא נשמרים בגיט, ורשימת המשתנים נמצאת ב-[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#environment-variables).

## תיעוד

| איפה | מה יש שם |
|---|---|
| [docs/README.md](docs/README.md) | אינדקס התיעוד ויומן הפיצ'רים (מתי, איזה PR, spec, plan) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | מבנה הקוד, טבלאות, API, דיפלוי, משתני סביבה |
| [CLAUDE.md](CLAUDE.md) | כללי עבודה ל-Claude Code (עלויות דיפלוי, הפעלות מקבילות) |
| [Issues](https://github.com/avnamer/teacher-crm/issues) | באגים, חוב טכני ורעיונות פתוחים |

## תהליך עבודה

ענף פיצ'ר → בדיקה מקומית → PR → merge ל-`main`. ה-merge מפעיל דיפלוי production שעולה קרדיטים ב-Netlify. הפרטים ב-[CLAUDE.md](CLAUDE.md).
