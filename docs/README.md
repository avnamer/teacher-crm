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
| 2026-10-29 | תיעוד קולי: בכרטיס האישור הסיכום עלה לראש הכרטיס והטקסט שהוקלט לפני העיבוד ירד לתחתית | [#100](https://github.com/avnamer/teacher-crm/pull/100) | — | — |
| 2026-10-29 | תיעוד קולי לנסיעה: כרטיס "מי הבא להתקשר" — המורה שעבר הכי הרבה זמן מאז שיחה/פגישה, כפתור חיוג, "דלג", "המורה לא ענה" ו"על מה דיברנו" (הקלטה, עיבוד ושמירה בתור האישורים, ואז המורה הבא); סדר חדש בעמוד: "סכם ושמור" ליד "דבר" וסטטוס השמירה מעל התמלול | PR נוכחי | — | — |
| 2026-10-26 | פגישות במשרדי מאנדיי — תיבת סימון בהוספת פגישה (`metadata.location`), אזור נפרד בדף הפגישות עם מונה "לפני X ימים", וספירה נפרדת בדוח הנסיעות | PR נוכחי | — | — |
| 2026-10-26 | דשבורד: שורת סטטיסטיקה שנייה — מתי שוחחתי בטלפון או נפגשתי פנים אל פנים (שוחחנו / לא שוחחנו), ושינוי נוסח כרטיסי שורה ראשונה (התכתבנו); שליחת וואטסאפ מודרכת דרך התוסף ומשתני עמודות בתבניות | [#94](https://github.com/avnamer/teacher-crm/pull/94) | — | — |
| 2026-10-19 | כרטיס מיקום בית הספר: כפתור "לעריכה" חושף את שדה הקישור והמחיקה (ניקיון ומניעת מחיקה בטעות); דוח שינויי סטטוס בסקריפט סנכרון ימי מאנדיי | PR נוכחי | — | — |
| 2026-10-19 | ימי מאנדיי של בתי ספר — סנכרון חד-כיווני מבורד Mentor Hub: כרטיס לקריאה בלבד בדף בית הספר ושתי עמודות למורים (תאריך יום מאנדיי, אישרו הגעה); סקריפט `scripts/sync-monday-days.mjs` | [#92](https://github.com/avnamer/teacher-crm/pull/92) | — | — |
| 2026-10-17 | דף בית ספר: שדה מיקום — מדביקים קישור Google Maps (גם קישור שיתוף קצר מהטלפון) והמערכת שומרת קואורדינטות; בסיס לחישוב ק"מ לדיווח נסיעות ב-monday | [#91](https://github.com/avnamer/teacher-crm/pull/91) | — | — |
| 2026-10-15 | הכתבה קולית בנייד: תיקון כפל טקסט אחרי הפעלה מחדש אוטומטית של זיהוי הדיבור (מיזוג לפי חפיפת מילים) | [#90](https://github.com/avnamer/teacher-crm/pull/90) | — | — |
| 2026-10-13 | תיעוד קולי: תפריט אישור דו-שלבי (אינטראקציה עם מורה / משימה / פגישות ונסיעות) — Claude מזהה גם משימה למורה, משימת הנהלה, פגישה עתידית ונסיעה מנהלית, ומציע להוסיף פגישה עתידית שנקבעה בתוך תיעוד שיחה | [#89](https://github.com/avnamer/teacher-crm/pull/89) | — | — |
| 2026-10-13 | דשבורד: יום וואטסאפ שבו רק אני כתבתי כבר לא נספר כקשר עם המורה (באנר ועמודת "יומן קשר אחרון") — נדרשת הודעה מהמורה | [#88](https://github.com/avnamer/teacher-crm/pull/88) | — | — |
| 2026-10-13 | WhatsApp: כפתור "שלח לאנשי קשר מהרשימה" — בחירה ידנית של אנשי קשר (עם חיפוש) ושליחת תבנית אליהם, בלי קשר למשימות | [#87](https://github.com/avnamer/teacher-crm/pull/87) | — | — |
| 2026-10-13 | פגישות: פגישה מנהלית (נסיעה שלא קשורה לבית ספר או מורה), סינון לפי חודש ודוח נסיעות בעמוד הפגישות | [#86](https://github.com/avnamer/teacher-crm/pull/86) | — | — |
| 2026-10-13 | סנכרון וואטסאפ: התאמת שם הצ'אט וחיפוש קבוצה סלחניים יותר (הבדלי שם בין ה-CRM לוואטסאפ, אימוג'י) — תיקון "הניווט לא נחת על השיחה" ו"לא נמצאה הקבוצה" | [#85](https://github.com/avnamer/teacher-crm/pull/85) | — | — |
| 2026-10-11 | כלל עבודה: אחרי כל שינוי קוד מריצים את האתר מקומית ושולחים קישור לבדיקה (CLAUDE.md + סקיל run-teacher-crm) | [#84](https://github.com/avnamer/teacher-crm/pull/84) | — | — |
| 2026-10-08 | פגישות: בחירת בית ספר ידנית בעריכת פגישה, למורה שמלמד בשני בתי ספר (ברירת מחדל: אוטומטי) | [#84](https://github.com/avnamer/teacher-crm/pull/84) | — | — |
| 2026-10-08 | טבלת אנשי הקשר: שם בית הספר מוצג בעד שתי שורות במקום להיחתך בשורה אחת | [#83](https://github.com/avnamer/teacher-crm/pull/83) | — | — |
| 2026-10-08 | דשבורד: "משימות מההנהלה" מעל "המשימות שלי", ושני הלוחות נפתחים סגורים בכל כניסה | [#82](https://github.com/avnamer/teacher-crm/pull/82) | — | — |
| 2026-10-08 | משימות מהנהלת טק סקול: לוח בדשבורד למשימות מקבוצות הנהלה ומשיחות פרטיות עם בני ומיקה (זיהוי אוטומטי בסנכרון — ראו [#81](https://github.com/avnamer/teacher-crm/issues/81)), ותיבת "משימה מהנהלת טק סקול" לתיוג ידני במשימה חדשה ובהקלטה קולית | [#80](https://github.com/avnamer/teacher-crm/pull/80) | — | — |
| 2026-10-07 | דף "בתי ספר": לוח פתקים "על מה דיברנו לאחרונה" — סיכום של עד שני משפטים לכל שיחה או התכתבות עם מורי בית הספר מאז הפגישה האחרונה | [#79](https://github.com/avnamer/teacher-crm/pull/79) | — | — |
| 2026-10-05 | דף "בתי ספר": מורי בית הספר ונבחרות שלהם, משימות פתוחות והיסטוריית פגישות (פגישות שהתקיימו בלבד) עם סיכום AI קצר; כרטיס "נבחרות" בדף המורה (עד 3 נבחרות, כיתה אחת או יותר לכל אחת) | [#73](https://github.com/avnamer/teacher-crm/pull/73) | — | — |
| 2026-10-06 | נבחרות: ימי לימוד ושעות (1–8) ושיעור הכנה לכל נבחרת, בכרטיס "נבחרות" בדף המורה | — | — | — |
| 2026-10-05 | המשימות שלי: משימות עם תאריך יעד בסוף הרשימה לפי מועד, ושם בית הספר של המורה ליד המשימה | [#72](https://github.com/avnamer/teacher-crm/pull/72) | — | — |
| 2026-10-05 | הוסר טקסט ההסבר על שמירת משימות מעמוד התיעוד הקולי | [#71](https://github.com/avnamer/teacher-crm/pull/71) | — | — |
| 2026-10-04 | "המשימות שלי": הקלטה בתיעוד הקולי שנפתחת ב"משימה לעצמי" מפוצלת למשימות (עם תאריכים וחודשיות) ונשמרת ישר בלי אישור; משימות של אבנר משיחות ופגישות עם מורים מופיעות גם הן ב"המשימות שלי" | [#69](https://github.com/avnamer/teacher-crm/pull/69) | — | — |
| 2026-10-02 | משימות מוואטסאפ: סקריפט שמחלץ משימות משיחות שסונכרנו לפני הפיצ'ר, ותיבת סימון ליד כל משימה בבאנר "מורים עם משימות פתוחות" בדשבורד | [#68](https://github.com/avnamer/teacher-crm/pull/68) | — | — |
| 2026-10-02 | סנכרון וואטסאפ: זיהוי משימות בהתכתבות עם המורה (כולל הודעות קוליות) — משימות המורה נכנסות ליומן שלה, משימות אבנר ל"המשימות שלי", עם תאריך ההודעה | [#65](https://github.com/avnamer/teacher-crm/pull/65) | [spec](superpowers/specs/2026-10-01-whatsapp-task-extraction-design.md) | [plan](superpowers/plans/2026-10-01-whatsapp-task-extraction.md) |
| 2026-10-02 | תיקון: משימות המנהל הופיעו גם בבאנר "מורים עם משימות פתוחות" | [#61](https://github.com/avnamer/teacher-crm/pull/61) | — | — |
| 2026-10-01 | כרטיס מורה: פרטי קשר באקורדיון, תיבת משימות דשבורד (טופל / לא טופל) ותיבת משימות מיומן האירועים עם סגירה | [#59](https://github.com/avnamer/teacher-crm/pull/59) | — | — |
| 2026-10-01 | סנכרון וואטסאפ: תוסף Chrome שקורא שיחות פרטיות וקבוצות (טקסט + הודעות קוליות מתומללות ב-Whisper) ושומר אותן ביומן המורה; דף קבוצות מסונכרנות, באנר סטטוס בדשבורד והפעלה לכל מורה | [#56](https://github.com/avnamer/teacher-crm/pull/56) | — | — |
| 2026-09-29 | קוביית "המשימות שלי" בדשבורד (משימות אישיות של המנהל מהקלטות ומהוספה ידנית) + משימות חוזרות חודשיות | [#50](https://github.com/avnamer/teacher-crm/pull/50) | — | — |
| 2026-09-29 | איחוד פגישות כפולות רק באישור: באנר בדשבורד עם פירוט מה נלקח מכל רשומה | [#49](https://github.com/avnamer/teacher-crm/pull/49) | — | — |
| 2026-09-29 | איחוד פגישות כפולות מאותו יום עם סיכום AI מאוחד | [#48](https://github.com/avnamer/teacher-crm/pull/48) | — | — |
| 2026-09-29 | ניתוח AI לפגישות ידניות + תיקוני הקלטה (הקלטה רציפה, תשובה ריקה מ-Claude) | [#47](https://github.com/avnamer/teacher-crm/pull/47) | — | — |
| 2026-09-17 | תיקון: אילוץ סוג האינטראקציה בטבלה לא כלל 'mailing_list', ולכן כל שליחה קבוצתית נכשלה בשקט ולא נרשמה ביומן המורה | [#45](https://github.com/avnamer/teacher-crm/pull/45) | — | — |
| 2026-09-17 | תיעוד קולי: "סכם ושמור" מנקה את ההקלטה מיד ומעבד ברקע — אפשר להקליט הודעה הבאה בלי לחכות לניתוח הקודם, וכמה הודעות מתועדות במקביל | [#41](https://github.com/avnamer/teacher-crm/pull/41) | — | — |
| 2026-09-16 | דף פגישות: שורה אחת לכל פגישה (במקום שורה לכל מורה) — שם בית ספר + כל המשתתפים באותה שורה, תוכן מוסתר עד לחיצה | [#37](https://github.com/avnamer/teacher-crm/pull/37) | [spec](superpowers/specs/2026-09-15-meetings-per-meeting-rows-design.md) | [plan](superpowers/plans/2026-09-15-meetings-per-meeting-rows.md) |
| 2026-09-15 | עריכת המורים המתויגים בפגישה קיימת (הוספה/הסרה) | [#36](https://github.com/avnamer/teacher-crm/pull/36) | [spec](superpowers/specs/2026-09-15-edit-meeting-attendees-design.md) | [plan](superpowers/plans/2026-09-15-edit-meeting-attendees.md) |
| 2026-09-15 | מיזוג תיעוד קולי של פגישה עם פגישה מתוכננת קיימת (במקום יצירת רשומה כפולה) | [#35](https://github.com/avnamer/teacher-crm/pull/35) | [spec](superpowers/specs/2026-09-15-voice-log-meeting-merge-design.md) | [plan](superpowers/plans/2026-09-15-voice-log-meeting-merge.md) |
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
