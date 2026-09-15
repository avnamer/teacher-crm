# תיעוד: Teacher CRM

## איפה מה

| איפה | מה | מתעדכן? |
|---|---|---|
| [../README.md](../README.md) | מה המערכת עושה ואיך מריצים אותה | כשנוספת או משתנה יכולת גלויה |
| [ARCHITECTURE.md](ARCHITECTURE.md) | מצב נוכחי: דפים, API, טבלאות, דיפלוי, משתני סביבה | כשמשתנה סכמה, API, env או דיפלוי |
| [../CLAUDE.md](../CLAUDE.md) | כללי עבודה ל-Claude Code | כשנלמד כלל או לקח חדש |
| [superpowers/specs/](superpowers/specs/) | מסמך תכנון (design) לכל פיצ'ר, נכתב לפני המימוש | לא. היסטורי |
| [superpowers/plans/](superpowers/plans/) | תוכנית מימוש מפורטת לכל פיצ'ר. תיבות הסימון בהן לא מעודכנות | לא. היסטורי |
| [history/](history/) | [CHECKPOINT-v1](history/CHECKPOINT-v1.md): יומן העבודה עד PR #4. [VOICE-CRM-PLAN](history/VOICE-CRM-PLAN.md): מסמך הדרישות המקורי לתיעוד קולי | לא. קפוא |
| [GitHub Issues](https://github.com/avnamer/teacher-crm/issues) | באגים, חוב טכני, רעיונות והחלטות מוצר פתוחות | כל הזמן |

**כלל:** מקשרים ולא מעתיקים. פריט פתוח נמצא רק ב-Issue, מצב נוכחי רק ב-ARCHITECTURE, ו"למה בנינו ככה" רק ב-spec וב-PR.

## יומן פיצ'רים

החדש ביותר למעלה. תאריך = מיזוג ל-`main` (דיפלוי production).

| תאריך | פיצ'ר | PR | Spec | Plan |
|---|---|---|---|---|
| 2026-09-15 | תיקון: אישור "משימה אישית לי" נכשל עם `null` ב-`type`; נעילת פורט 5173 ל-dev server | [#34](https://github.com/avnamer/teacher-crm/pull/34) | — | — |
| 2026-09-14 | תיבת "הייתה תגובה" — הודעות/דיוור נספרים ב"קשר אחרון" רק אם סומנו | [#33](https://github.com/avnamer/teacher-crm/pull/33) | — | — |
| 2026-09-14 | בחירה חופשית של מורים (תיבות סימון) לשליחת WhatsApp | [#18](https://github.com/avnamer/teacher-crm/pull/18) | — | — |
| 2026-09-14 | 🔒 שלב 1 אבטחה: התחברות משתמש-יחיד (Google) + נעילת RLS לכל הטבלאות | [#17](https://github.com/avnamer/teacher-crm/pull/17) | [spec](superpowers/specs/2026-09-14-supabase-auth-single-user-design.md) | [plan](superpowers/plans/2026-09-14-supabase-auth-single-user.md) |
| 2026-09-14 | WhatsApp: צ'יפים למשתני תבנית, שליחה פר-מורה, תג רשימת תפוצה | [#16](https://github.com/avnamer/teacher-crm/pull/16) | — | — |
| 2026-09-14 | סידור התיעוד: README, אינדקס, ARCHITECTURE, TODO, .env.example | [#15](https://github.com/avnamer/teacher-crm/pull/15) | — | — |
| 2026-09-14 | 🔒 שלב 0 אבטחה: טוקני Google לטבלה פרטית + הגבלת CORS | [#14](https://github.com/avnamer/teacher-crm/pull/14) | — | — |
| 2026-09-14 | תצוגת "בעוד X ימים" לפגישה עתידית (במקום ימים שליליים) | [#13](https://github.com/avnamer/teacher-crm/pull/13) | — | — |
| 2026-09-14 | מחיקת פגישה (לכל המשתתפים) | [#12](https://github.com/avnamer/teacher-crm/pull/12) | [spec](superpowers/specs/2026-09-13-delete-meeting-design.md) | [plan](superpowers/plans/2026-09-13-delete-meeting.md) |
| 2026-09-13 | עריכת תאריך ותוכן של פגישה | [#11](https://github.com/avnamer/teacher-crm/pull/11) | [spec](superpowers/specs/2026-09-13-edit-meeting-design.md) | [plan](superpowers/plans/2026-09-13-edit-meeting.md) |
| 2026-09-13 | דף פגישות חדש וקביעת פגישות עתידיות | [#10](https://github.com/avnamer/teacher-crm/pull/10) | [spec](superpowers/specs/2026-09-13-meetings-page-redesign-design.md) | [plan](superpowers/plans/2026-09-13-meetings-page-redesign.md) |
| 2026-09-13 | ייבוא CSV עבר למודאל בהגדרות | [#9](https://github.com/avnamer/teacher-crm/pull/9) | — | — |
| 2026-09-12 | אייקון ✈️ להודעות שנשלחו דרך המערכת | [#8](https://github.com/avnamer/teacher-crm/pull/8) | — | — |
| 2026-09-12 | תזכורות WhatsApp לפי השלמת משימה | [#7](https://github.com/avnamer/teacher-crm/pull/7) | — | — |
| 2026-09-12 | כללי git להפעלות מקבילות (CLAUDE.md) | [#6](https://github.com/avnamer/teacher-crm/pull/6) | — | — |
| 2026-09-12 | שליחת WhatsApp בפועל (click-to-chat) | [#5](https://github.com/avnamer/teacher-crm/pull/5) | — | — |
| 2026-09-11 | תור אישור להקלטות קוליות | [#4](https://github.com/avnamer/teacher-crm/pull/4) | [spec](superpowers/specs/2026-09-11-pending-voice-log-approval-design.md) | [plan](superpowers/plans/2026-09-11-pending-voice-log-approval.md) |
| 2026-09-11 | תיקון: סוג אינטראקציה היה תמיד phone_call | [#3](https://github.com/avnamer/teacher-crm/pull/3) | — | — |
| 2026-09-11 | כללי עבודה: עלויות קרדיטים ב-Netlify | [#2](https://github.com/avnamer/teacher-crm/pull/2) | — | — |
| 2026-09-10 | כל עבודת הבסיס בענף אחד: דף מנטורים, מנהל עמודות ועמודות יומן, תיעוד שיחות קולי (PWA), עמודות משימה ומיזוג Monday, העלאה לאוויר | [#1](https://github.com/avnamer/teacher-crm/pull/1) | [מנטורים](superpowers/specs/2026-09-03-mentors-page-design.md) · [קולי](superpowers/specs/2026-09-08-voice-call-logging-design.md) · [משימות](superpowers/specs/2026-09-10-task-columns-monday-merge-design.md) | [מנטורים](superpowers/plans/2026-09-03-mentors-page.md) · [קולי](superpowers/plans/2026-09-08-voice-call-logging.md) · [משימות](superpowers/plans/2026-09-10-task-columns-monday-merge.md) |
| 2026-04-02 | קומיט ראשוני | — | — | — |

### Specs שלא מומשו

- [סף השלמת משימה](superpowers/specs/2026-09-10-task-completion-threshold-design.md) (2026-09-10): נכתב רק spec, אין קוד. נמצא במעקב כ-Issue.

## איך מתעדים פיצ'ר חדש

1. **תכנון:** spec ב-`superpowers/specs/YYYY-MM-DD-<name>-design.md`, ואחריו plan ב-`superpowers/plans/`.
2. **במהלך העבודה:** באגים ורעיונות שעולים ולא מטופלים נפתחים כ-Issue ולא נכתבים לקובץ MD.
3. **בסגירה** (הסקיל `close-teacher-crm-feature`, "סיימנו כאן"), באותו ענף ולפני ה-merge:
   - מוסיפים שורה ליומן הפיצ'רים למעלה.
   - מעדכנים את `ARCHITECTURE.md` / `README.md` / `CLAUDE.md` רק אם הפיצ'ר שינה את מה שהם מתארים.
   - Issues שהפיצ'ר פותר נסגרים עם `Closes #N` בגוף ה-PR, ו-follow-ups חדשים נפתחים כ-Issues.
