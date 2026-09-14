# TODO — משימות פתוחות שדורשות התייחסות

רשימת המשימות הגדולות שמחכות. פריטים קטנים (באגים נקודתיים, חוב טכני, רעיונות)
נמצאים ב-[GitHub Issues](https://github.com/avnamer/teacher-crm/issues). כאן נמצאות
המשימות שמשנות ארכיטקטורה או שדורשות החלטה והתייחסות שלך.

---

## ✅ התחברות (Supabase Auth) — הושלם

שלב 0 ([PR #14](https://github.com/avnamer/teacher-crm/pull/14)) ושלב 1
([PR #17](https://github.com/avnamer/teacher-crm/pull/17)) בוצעו ואומתו: התחברות
Google למשתמש יחיד + נעילת RLS של כל הטבלאות לבעלים; המפתח הציבורי כבר לא קורא ולא
כותב. פירוט ב-[ARCHITECTURE.md](ARCHITECTURE.md) וב-spec/plan של שלב 1.

נשאר כ-follow-up (ב-Issues, לא כאן): אימות JWT גם ב-backend (Render), וסנכרון
`supabase-setup.sql` מול ה-DB החי.

*(אין כרגע משימות גדולות פתוחות שדורשות החלטה. פריטים חדשים — ראה למטה.)*

---

## איך עובדים עם הקובץ הזה

- משימה גדולה חדשה שדורשת התייחסות שלך → שורה כאן.
- באג / חוב טכני / רעיון → [Issue](https://github.com/avnamer/teacher-crm/issues),
  לא כאן (ראה "Documentation — where things go" ב-[CLAUDE.md](../CLAUDE.md)).
- כשמשימה מכאן מטופלת עד הסוף — מוחקים אותה מכאן ומעדכנים את
  [docs/README.md](README.md) ואת [ARCHITECTURE.md](ARCHITECTURE.md).
