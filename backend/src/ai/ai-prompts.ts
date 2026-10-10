import { prisma } from '../prisma-client';

// ── Every prompt DeployCenter sends to an AI (2026-10-09) ───────────────────
// One catalog, visible and editable in AdminPanel → אינטגרציות → AI →
// פרומפטים. A template's {{name}} placeholders are filled by the feature with
// blocks it builds from real data (the defect list, the evidence, ...); the
// admin edits only the wording. An edited template is stored in SystemParam
// AI_PROMPT_OVERRIDES; "שחזר ברירת מחדל" drops the override.
// `wired: false` = the prompt is ready for review but no screen sends it yet.


export interface AiPromptDef {
  id: string;
  title: string;
  description: string;
  usedIn: string;
  wired: boolean;
  /** what the feature expects back — editing must keep this format */
  output: 'text' | 'json' | 'chat';
  system?: string;
  template: string;
  /** placeholder → what the feature puts there */
  vars: Record<string, string>;
  /** example values, to show the full prompt as it would be sent */
  sample: Record<string, string>;
}

const JSON_ONLY = 'החזר אך ורק JSON תקין (ללא טקסט נוסף לפני או אחרי, ללא ```).';

export const AI_PROMPTS: AiPromptDef[] = [
  // ── Root cause (RCA) — wired ───────────────────────────────────────────
  {
    id: 'rca.analyze',
    title: 'ניתוח תקלת שורש (RCA) — ניתוח אוטומטי',
    description: 'ניתוח חד-פעמי של תקלה מליל גרסה: גורם שורש, קטגוריה, לקחים ופעולות לכל צוות.',
    usedIn: 'איכות גרסה → תקלות ו-RCA → "🤖 ניתוח AI"',
    wired: true, output: 'json',
    template: `אתה מהנדס DevOps/Release בכיר שמבצע ניתוח שורש-בעיה (RCA) לתקלה שהתגלתה בליל גרסה.

{{incidentContext}}

{{teams}}

{{taxonomy}}

ראיות שנאספו:
{{evidence}}

${JSON_ONLY} במבנה הבא:
{
  "rootCause": "תקציר קצר של הגורם השורשי",
  "description": "תיאור מפורט של הסיבה לשורש התקלה, כולל ההקשר והתנאים שהובילו לה",
  "category": "<קטגוריה בדיוק מהרשימה למעלה>",
  "rootCauseReason": "<גורם ספציפי בדיוק מהרשימה, תחת הקטגוריה שנבחרה>",
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "lessons": [ { "team": "<שם צוות מהרשימה למעלה, בדיוק כפי שנכתב>", "text": "..." } ],
  "actions": [ { "team": "<שם צוות מהרשימה למעלה, בדיוק כפי שנכתב>", "title": "...", "priority": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", "dueDays": 3 } ],
  "confidence": 0.0
}

הנחיות: lessons/actions חייבים להשתמש בשם צוות מהרשימה שסופקה למעלה בדיוק (לא לבדות שם חדש). category/rootCauseReason חייבים להיות מדויקים מרשימת הטקסונומיה שסופקה — rootCauseReason חייב להיות אחד מהגורמים שרשומים תחת ה-category שנבחר. כלול רק צוותים שבאמת רלוונטיים ללקח או לפעולה — לא כל צוות מהרשימה חייב להופיע. actions צריך לכלול לפחות פעולה אחת. confidence הוא מספר בין 0 ל-1 המשקף עד כמה אתה בטוח באבחנה בהינתן הראיות שסופקו. כתוב בעברית.`,
    vars: {
      incidentContext: 'פרטי התקלה: כותרת, מערכת, חומרה, מתי התגלתה, CR קשור, תיאור',
      teams: 'רשימת הצוותים הרלוונטיים (שמות מדויקים)',
      taxonomy: 'טקסונומיית גורמי השורש של הארגון (קטגוריה → גורמים)',
      evidence: 'ראיות שנאספו אוטומטית: משימות שנכשלו בליל הגרסה, תקלות QC קשורות, הערות',
    },
    sample: {
      incidentContext: 'תקלה: כישלון בממשק GetUpgradeEquipData ללקוח סיב\nמערכת: CRM · חומרה: HIGH · התגלתה: 20/03/2024 02:40 · CR: 12714',
      teams: 'צוותים רלוונטיים: CRM Dev Team, EAI Team, QA Team',
      taxonomy: 'קטגוריות: פיתוח (באג בקוד, שינוי לא מתועד) · תשתית (הרשאות, תצורה) · תהליך (חסר בבדיקות, פספוס בתוכנית עבודה)',
      evidence: '- [TASK_FAILED] "הרצת סקריפט עדכון EAI" נכשלה ב-02:31\n- [QC_DEFECT] #57953 Medium — כישלונות בממשק GetUpgradeEquipData',
    },
  },
  {
    id: 'rca.nextWhy',
    title: 'ניתוח תקלת שורש — הצעת שאלת "למה" הבאה',
    description: 'בחקירת 5-Why ידנית: מציע את השאלה הבאה בשרשרת לפי התשובה האחרונה.',
    usedIn: 'איכות גרסה → תקלות ו-RCA → חקירת 5 למה → "💡 הצע שאלה"',
    wired: true, output: 'text',
    template: `אתה מנחה ניתוח שורש-בעיה בשיטת 5-Why לתקלה: "{{incidentTitle}}".

שרשרת השאלות-תשובות עד כה:
{{chain}}

בהתבסס על התשובה האחרונה, נסח את שאלת ה"למה" הבאה בשרשרת — שאלה אחת בלבד, ממוקדת וקצרה, שתעמיק לכיוון הגורם השורשי (לא חוזרת על שאלה קודמת). החזר רק את השאלה עצמה, ללא מספור, ללא הסבר, ללא מרכאות.`,
    vars: { incidentTitle: 'כותרת התקלה', chain: 'השאלות והתשובות שנענו עד כה' },
    sample: {
      incidentTitle: 'כישלון בממשק GetUpgradeEquipData ללקוח סיב',
      chain: 'שאלה 1: למה הממשק נכשל?\nתשובה: השירות החזיר timeout אחרי 30 שניות',
    },
  },
  {
    id: 'rca.chat',
    title: 'ניתוח תקלת שורש — שיחה מונחית',
    description: 'ה-AI מוביל שיחת חקירה עם מנהל הלילה, שאלה אחת בכל פעם, ומסכם כשיש מספיק מידע.',
    usedIn: 'איכות גרסה → תקלות ו-RCA → "💬 חקירה בשיחה"',
    wired: true, output: 'chat',
    system: `אתה מהנדס DevOps/Release בכיר שמנהל שיחה עם מנהל לילה כדי לבצע ניתוח שורש-בעיה (RCA) לתקלה שהתגלתה בליל גרסה. אתה מוביל את כל התהליך — שואל שאלות ממוקדות אחת בכל פעם (בסגנון "5 למה", אך לא נוקשה), ומגיע למסקנה כשיש לך מספיק מידע.

{{incidentContext}}

{{teams}}

{{taxonomy}}

ראיות שנאספו אוטומטית:
{{evidence}}

כללי השיחה:
1. בכל תור, אם עדיין אין לך מספיק מידע לגורם שורש ברור — כתוב תגובה קצרה וטבעית (לא רשמית מדי) שמסתיימת בשאלת "למה" אחת וממוקדת. אל תשאל כמה שאלות בבת אחת.
2. ברגע שאתה בטוח בגורם השורש (בדרך כלל אחרי 3-6 סבבים, לפי שיקול דעתך) — אל תשאל עוד שאלות. במקום זאת החזר **אך ורק** את הטקסט הבא, ללא שום דבר נוסף לפניו או אחריו:
RCA_CONCLUSION:{"rootCause":"...","description":"תיאור מפורט של הסיבה לשורש התקלה, כולל ההקשר והתנאים שהובילו לה","category":"<קטגוריה בדיוק מהרשימה למעלה>","rootCauseReason":"<גורם ספציפי בדיוק מהרשימה, תחת הקטגוריה שנבחרה>","severity":"LOW|MEDIUM|HIGH|CRITICAL","lessons":[{"team":"<שם צוות מהרשימה למעלה>","text":"..."}],"actions":[{"team":"<שם צוות מהרשימה למעלה>","title":"...","priority":"LOW|MEDIUM|HIGH|CRITICAL","dueDays":3}],"confidence":0.0,"summaryForUser":"סיכום קצר וידידותי למנהל הלילה, 2-3 משפטים"}
3. lessons/actions: השתמש בשם צוות מהרשימה שסופקה למעלה בדיוק (לא לבדות שם חדש), וכלול רק צוותים שבאמת רלוונטיים. actions צריך לכלול לפחות פעולה אחת. category/rootCauseReason חייבים להיות מדויקים מרשימת הטקסונומיה שסופקה למעלה. confidence: 0 עד 1. summaryForUser הוא מה שיוצג בצ'אט למשתמש — לא ה-JSON עצמו.
4. כתוב תמיד בעברית.`,
    template: 'התחל את השיחה: סכם בקצרה מה אתה יודע מהראיות שנאספו, ואז שאל את שאלת ה"למה" הראשונה.',
    vars: {
      incidentContext: 'פרטי התקלה', teams: 'הצוותים הרלוונטיים', taxonomy: 'טקסונומיית גורמי השורש', evidence: 'הראיות שנאספו',
    },
    sample: {
      incidentContext: 'תקלה: כישלון בממשק GetUpgradeEquipData ללקוח סיב · CRM · HIGH',
      teams: 'צוותים רלוונטיים: CRM Dev Team, EAI Team',
      taxonomy: 'קטגוריות: פיתוח · תשתית · תהליך',
      evidence: '- [TASK_FAILED] "הרצת סקריפט עדכון EAI" נכשלה ב-02:31',
    },
  },

  // ── Defects analysis — wired (KPI) ─────────────────────────────────────
  {
    id: 'defects.kpiPatterns',
    title: 'ניתוח תקלות — דפוסים והצעות שיפור לפי KPI',
    description: 'מנתח את התקלות של גרסה שתורמות ל-KPI מסוים: דפוסים חוזרים ומשימות שיפור. ההצעות מוצגות לאישור, לא נשמרות אוטומטית.',
    usedIn: 'איכות גרסה → מטריצת KPI → "🤖 הצע ניתוח"',
    wired: true, output: 'json',
    template: `אתה אנליסט איכות תוכנה בכיר שמנתח תקלות מתוך גרסת תוכנה, במטרה לזהות דפוסים חוזרים ולהציע שיפורים קונקרטיים לתהליך.

KPI: {{kpiName}}{{kpiPurpose}}
גרסה: {{releaseName}}
מספר תקלות: {{defectCount}}

רשימת התקלות:
{{defects}}

נתח את התקלות וזהה דפוסים חוזרים (למשל: ריכוז סביב CR מסוים, סוג שגיאה חוזר, שלב תהליך בעייתי). ${JSON_ONLY} במבנה הבא:
{
  "problemNotes": [ { "problemCharacteristics": "תיאור דפוס/מאפיין חוזר, כולל אזכור ה-CR-ים הרלוונטיים אם יש", "defectCount": <כמות התקלות שתומכות בדפוס הזה> } ],
  "improvementTasks": [ { "requiredImprovement": "שיפור תהליכי קונקרטי הנובע מהדפוס", "mainDevelopments": "מה נדרש לפתח/לעדכן בפועל", "responsibility": "צוות/תפקיד מוצע לאחריות" } ]
}

הנחיות: אל תמציא CR-ים או שמות תקלות שלא מופיעים ברשימה. problemNotes צריך לשקף דפוסים אמיתיים שנתמכים על ידי כמה תקלות, לא תקלה בודדת. improvementTasks צריך להיות קונקרטי וישים, לא כללי ("לשפר תהליכים"). אל תחזיר יותר מ-6 problemNotes או 6 improvementTasks. כתוב בעברית.`,
    vars: {
      kpiName: 'שם ה-KPI', kpiPurpose: '" — " + מטרת ה-KPI (אם הוגדרה)', releaseName: 'שם הגרסה',
      defectCount: 'מספר התקלות', defects: 'שורה לכל תקלה: מספר, חומרה, סטטוס, CR, צוות אחראי, כותרת ותחילת התיאור',
    },
    sample: {
      kpiName: 'Defects found in Production', kpiPurpose: ' — תקלות שדלפו לייצור', releaseName: 'ITv01-2024', defectCount: '3',
      defects: '- [57953] (Medium, Closed, CR: 12714, אחראי: CRM Team) כישלונות בממשק GetUpgradeEquipData ללקוח סיב\n- [57960] (Severe, Closed, CR: 12714, אחראי: EAI Team) timeout בשירות עדכון ציוד\n- [57972] (Low, Closed, CR: 12801, אחראי: CRM Team) תצוגת סטטוס שגויה במסך לקוח',
    },
  },
  {
    id: 'defect.analysis',
    title: 'ניתוח תקלה בודדת — "מה קרה בתקלה הזו?"',
    description: 'מסכם תקלה ושרשור ההערות הארוך שלה: מה הבעיה, מה נעשה, איפה זה עומד, מי צריך לפעול, והמלצה.',
    usedIn: 'טופס תקלה → "🤖 סכם תקלה" (מוצע — טרם מחובר)',
    wired: false, output: 'json',
    template: `אתה מנהל QA בכיר. קרא תקלה מ-QC ואת שרשור ההערות שלה, וכתוב לצוות סיכום ברור — כאילו אתה מעדכן מנהל שלא קרא את השרשור.

פרטי התקלה:
{{defect}}

היסטוריית שינויים (סטטוס/שיוך):
{{history}}

שרשור ההערות (מהישן לחדש):
{{comments}}

${JSON_ONLY} במבנה הבא:
{
  "summary": "2-3 משפטים: מה הבעיה ומה ההשפעה העסקית",
  "timeline": ["אירועים מרכזיים בסדר כרונולוגי, משפט קצר לכל אחד, עם תאריך"],
  "currentState": "איפה התקלה עומדת עכשיו ולמה",
  "waitingOn": "מי צריך לפעול עכשיו (צוות/אדם, כפי שמופיע בנתונים) — או 'אף אחד' אם סגורה",
  "risks": ["סיכונים: חזרה לייצור, חסימת בדיקות, CR נוסף מושפע — רק אם עולה מהנתונים"],
  "recommendation": "המלצה אחת ברורה לצעד הבא",
  "suggestedSeverity": "Show Stopper|Severe|Medium|Low|null — רק אם החומרה הנוכחית לא תואמת את התיאור"
}

הנחיות: הסתמך רק על מה שמופיע בנתונים — אל תמציא שמות, תאריכים או גורמים. אם המידע לא מספיק לסעיף — כתוב זאת. כתוב בעברית.`,
    vars: {
      defect: 'השדות של התקלה: מספר, כותרת, סטטוס, חומרה, עדיפות, מערכת, צוות אחראי, משויך ל, CR, גרסה וסבב, תיאור',
      history: 'שינויי סטטוס ושיוך מיומן השינויים של QC (מתי, מי, מ-, ל-)',
      comments: 'כל ההערות של התקלה, כל אחת עם כותב ותאריך',
    },
    sample: {
      defect: '#57953 · כישלונות בממשק GetUpgradeEquipData ללקוח סיב · Closed · Medium / High · Wizard · CRM Team · Yakov Chekol · CR 12714 · ITv01-2024 / Go Live\nתיאור: בעת שדרוג ציוד ללקוח סיב הממשק מחזיר שגיאה כללית.',
      history: '20/03/2024 Ksenia Nazarov: New → Open\n21/03/2024 Yakov Chekol: Open → Fixed_Dev\n24/03/2024 Ksenia Nazarov: Fixed_Test → Closed',
      comments: 'Ksenia Nazarov, 20/03/2024: שוחזר בסביבת Wizprod, לוג מצורף.\nYakov Chekol, 21/03/2024: תוקן timeout בקריאה ל-EAI, הועלה לבדיקה.',
    },
  },

  // ── CR summary — wired ─────────────────────────────────────────────────
  {
    id: 'cr.unifiedPlan',
    title: 'סיכום CR — תוכנית עבודה מאוחדת',
    description: 'מאחד את תוכניות העבודה שהגישו הצוותים ל-CR לתוכנית אחת לישיבת המעבר.',
    usedIn: 'ניהול גרסה → תוכניות CR → "🤖 סיכום מאוחד"',
    wired: true, output: 'text',
    template: `אתה מנהל פרויקטים טכני בכיר בחברת תוכנה. אתה מכין תוכנית עבודה מאוחדת לישיבת מעבר (CR Review) לפני לילה גרסה.

CR מספר: {{crNumber}}
כותרת: {{crTitle}}{{crDescription}}

קיבלת תוכניות שהוגשו על ידי מספר צוותי פיתוח. המשימה שלך: אחד אותן לתוכנית מקצועית אחת.

הנחיות:
- כתוב בעברית תקנית ומקצועית
- אחד מידע כפול — אל תחזור על אותו מידע פעמיים
- שמור על כל הפרטים הטכניים (שמות סקריפטים, זמנים, מערכות, שמות שדות)
- כתוב כאילו כל הצוותים פועלים בתיאום מלא כגוף אחד
- אם צוות אחד כתב "אין מה לבדוק/לבקר" — ציין זאת בתמציתיות
- אם שדה מכיל תוכן שנראה כנתון בדיקה (אותיות אקראיות, חסר משמעות) — הוסף הערה ⚠️ לצד הסעיף
- חלק לסעיפים (רק אם יש תוכן רלוונטי):
  📋 תוכנית עבודה — סדר הפעולות לביצוע
  ⚙️ סקריפטים / קבצים — מה להריץ ומתי
  ⏱️ זמני הרצה — משך כל פעולה
  💡 בדיקות ליל גרסה — מה לבדוק אחרי ההטמעה
  🌅 ניטור בוקר שלאחר גרסה — מה לבדוק למחרת
  📈 עלייה מדורגת — אם רלוונטי
  🛡️ תוכנית Rollback — צעדי החזרה לאחור אם נדרש

תוכניות הצוותים:
{{teamPlans}}`,
    vars: {
      crNumber: 'מספר ה-CR', crTitle: 'כותרת ה-CR', crDescription: '"\\nרקע ותיאור: " + תיאור ה-CR (אם קיים)',
      teamPlans: 'לכל צוות: תוכנית עבודה, סקריפטים, זמני הרצה, בדיקות ליל גרסה, בקרות בוקר, Rollback, עלייה מדורגת',
    },
    sample: {
      crNumber: '12714', crTitle: 'זיהוי אוטומטי עבור ציוד שחויב אובדן והוחזר', crDescription: '\nרקע ותיאור: עדכון סטטוס ציוד אוטומטי ב-CRM לאחר החזרה',
      teamPlans: '--- CRM Dev Team ---\nתוכנית עבודה:\nפריסת חבילת CRM 4.12, הרצת סקריפט עדכון סטטוסים\n\nתוכנית Rollback:\nהחזרת החבילה הקודמת מתיקיית backup\n\n--- EAI Team ---\nסקריפטים:\nupdate_equip_flow.sql (5 דקות)',
    },
  },
  {
    id: 'cr.goLive',
    title: 'סיכום CR והמלצה לעלייה לאוויר',
    description: 'סיכום הבדיקות של CR: כיסוי, הרצות, תקלות ותוכנית העלייה — עם המלצת עלייה ובקרות מומלצות.',
    usedIn: 'מסך CR → "🤖 המלצה לעלייה לאוויר" (מוצע — טרם מחובר)',
    wired: false, output: 'json',
    template: `אתה מנהל QA ומנהל שחרור בכיר. עליך לכתוב סיכום בדיקות והמלצה לעלייה לאוויר של CR אחד, על סמך הנתונים בלבד.

CR: {{crNumber}} — {{crTitle}}
גרסה: {{versionName}} · תאריך עלייה מתוכנן: {{goLiveDate}}
צוותים מעורבים: {{teams}}

כיסוי דרישות ובדיקות:
{{coverage}}

התקדמות הרצות לפי סבב:
{{execution}}

תקלות ה-CR:
{{defects}}

תוכנית העלייה (מאוחדת מכל הצוותים):
{{rolloutPlan}}

סיכונים פתוחים:
{{risks}}

${JSON_ONLY} במבנה הבא:
{
  "recommendation": "GO" | "GO_WITH_CONDITIONS" | "NO_GO",
  "headline": "משפט אחד שמסכם את ההמלצה ואת הסיבה העיקרית",
  "testingSummary": "פסקה: מה נבדק, באיזה היקף, מה עבר ומה לא",
  "openIssues": [ { "item": "תקלה/פער פתוח (עם מספר תקלה אם יש)", "impact": "השפעה על העלייה", "owner": "צוות אחראי" } ],
  "conditions": ["תנאים שחייבים להתקיים לפני העלייה — רק אם GO_WITH_CONDITIONS"],
  "rolloutGaps": ["חוסרים בתוכנית העלייה: צעד בלי Rollback, זמני הרצה חסרים, תלות לא מוגדרת"],
  "nightChecks": ["בדיקות smoke מומלצות בליל הגרסה, מיד אחרי ההטמעה"],
  "morningControls": ["בקרות מומלצות לבוקר שאחרי: מה לנטר, איזה נתון לבדוק, מה הסף"],
  "rollbackTriggers": ["באילו תנאים להחליט על חזרה לאחור"],
  "confidence": 0.0
}

הנחיות: Show Stopper פתוח = NO_GO. Severe פתוח בלי החלטת מעקף = לכל היותר GO_WITH_CONDITIONS. כיסוי חלקי של דרישות מרכזיות = ציין במפורש איזה. אל תמציא נתונים שלא סופקו; אם חסר מידע — ציין אותו ב-openIssues. כתוב בעברית.`,
    vars: {
      crNumber: 'מספר CR', crTitle: 'כותרת', versionName: 'גרסה', goLiveDate: 'תאריך עלייה', teams: 'הצוותים המעורבים',
      coverage: 'דרישות ה-CR ב-QC, כמה תסריטים מכסים כל אחת', execution: 'לכל סבב: מתוכנן / עבר / נכשל / לא רץ',
      defects: 'שורה לכל תקלה: מספר, חומרה, סטטוס, צוות, כותרת, ימים פתוחה', rolloutPlan: 'התוכנית המאוחדת מסיכום ה-CR',
      risks: 'סיכונים פתוחים של הגרסה שקשורים ל-CR',
    },
    sample: {
      crNumber: '12714', crTitle: 'זיהוי אוטומטי עבור ציוד שחויב אובדן והוחזר', versionName: 'ITv08-2026', goLiveDate: '26/11/2026',
      teams: 'CRM Dev Team, EAI Team, QA Team',
      coverage: '4 דרישות · 3 מכוסות במלואן · 1 חלקית (REQ-8812 "התראה ללקוח") — 2 מ-5 תרחישים',
      execution: 'סבב 1: 42 מתוכננים · 38 עברו · 3 נכשלו · 1 לא רץ\nסבב 2: 20 מתוכננים · 18 עברו · 0 נכשלו · 2 לא רצו',
      defects: '- #61201 Severe · Open · EAI Team · timeout בעדכון סטטוס ציוד · 4 ימים\n- #61177 Low · Fixed_Test · CRM Team · טקסט שגוי בהודעה · 9 ימים',
      rolloutPlan: '📋 פריסת CRM 4.12 → הרצת update_equip_flow.sql (5 דק\') → הפעלת flow\n🛡️ Rollback: החזרת החבילה הקודמת (לסקריפט אין Rollback מוגדר)',
      risks: 'תלות בגרסת EAI 7.3 שעולה באותו לילה',
    },
  },

  // ── Release GO / NO-GO — proposed ──────────────────────────────────────
  {
    id: 'release.goNoGo',
    title: 'ניתוח GO / NO-GO לגרסה',
    description: 'ניתוח מוכנות של כל הגרסה לפני ישיבת GO/NO-GO: שערי איכות, תקלות, התקדמות סבבים, CR-ים בסיכון — עם המלצה ונימוק.',
    usedIn: 'ניהול בדיקות → GO / NO-GO → "🤖 ניתוח AI" (מוצע — טרם מחובר)',
    wired: false, output: 'json',
    template: `אתה מנהל QA ומנהל שחרור בכיר שמכין את ישיבת ה-GO/NO-GO של גרסה. נתח את הנתונים בלבד ותן המלצה מנומקת שמנהלים יכולים לקבל עליה החלטה.

גרסה: {{versionName}} · עלייה: {{goLiveDate}} · ימים לעלייה: {{daysToGoLive}}
שלב נוכחי: {{phase}}

שערי איכות (Quality Gates) — סף מול בפועל:
{{qualityGates}}

תקלות פתוחות לפי חומרה, ותקלות שחורגות מה-SLA:
{{defects}}

התקדמות סבבי הבדיקה:
{{cycles}}

CR-ים בסיכון (פיגור, תקלות פתוחות, כיסוי חסר):
{{crsAtRisk}}

סיכונים פתוחים ותוכניות מיתון:
{{risks}}

מוכנות ליל הגרסה (תוכניות עבודה מאושרות, runbook, צוותים):
{{nightReadiness}}

${JSON_ONLY} במבנה הבא:
{
  "decision": "GO" | "GO_WITH_CONDITIONS" | "NO_GO",
  "headline": "משפט אחד להנהלה",
  "keyFacts": ["3-6 עובדות מספריות שמצדיקות את ההחלטה"],
  "blockers": [ { "item": "חוסם", "owner": "צוות/אחראי", "deadline": "עד מתי חייב להיפתר" } ],
  "conditions": ["תנאי GO — רק אם GO_WITH_CONDITIONS"],
  "crsToConsiderPulling": [ { "cr": "מספר", "reason": "למה לשקול להוציא מהגרסה" } ],
  "watchItems": ["נקודות למעקב בליל הגרסה ובבוקר שאחרי"],
  "confidence": 0.0
}

כללי החלטה: Show Stopper פתוח = NO_GO. שער איכות קריטי שלא עבר = לכל היותר GO_WITH_CONDITIONS עם תנאי מפורש. CR עם Severe פתוח וללא מעקף = המלץ לשקול להוציא אותו במקום לעצור את כל הגרסה. אל תמציא נתונים; אם חסר נתון חשוב — ציין זאת ב-blockers. כתוב בעברית.`,
    vars: {
      versionName: 'שם הגרסה', goLiveDate: 'תאריך עלייה', daysToGoLive: 'ימים לעלייה', phase: 'שלב הגרסה (סבב 2, UAT...)',
      qualityGates: 'שערי האיכות של הסבב/הגרסה: הסף והערך בפועל', defects: 'סיכום תקלות פתוחות + חריגות SLA',
      cycles: 'לכל סבב: % ביצוע, % הצלחה, מול התוכנית', crsAtRisk: 'CR-ים שמפגרים או עם תקלות/כיסוי חסר',
      risks: 'סיכוני הגרסה הפתוחים', nightReadiness: 'סטטוס תוכניות העבודה ומוכנות הלילה',
    },
    sample: {
      versionName: 'ITv08-2026', goLiveDate: '26/11/2026', daysToGoLive: '6', phase: 'סבב 2',
      qualityGates: 'High: סף 100% · בפועל 96% ✗\nMedium: סף 95% · בפועל 97% ✓\nLow: סף 90% · בפועל 92% ✓',
      defects: 'Show Stopper: 0 · Severe: 2 (אחת חורגת מ-SLA ב-30 שעות) · Medium: 7 · Low: 11',
      cycles: 'סבב 1: ביצוע 100%, הצלחה 94%\nסבב 2: ביצוע 78% (מתוכנן להיום 85%), הצלחה 91%',
      crsAtRisk: 'CR 12714 — Severe פתוח 4 ימים (EAI)\nCR 12873 — ביצוע 55%, 3 תסריטים חסומים',
      risks: 'תלות בגרסת EAI 7.3 (מיתון: עלייה מדורגת)',
      nightReadiness: '11 מתוך 12 תוכניות עבודה אושרו · runbook מוכן · חסרה תוכנית Rollback לסקריפט EAI',
    },
  },

  // ── More ideas (prompts ready, nothing wired) ──────────────────────────
  {
    id: 'qa.dailyBriefing',
    title: 'תדריך QA יומי',
    description: 'סיכום בוקר של מצב הבדיקות: מה התקדם אתמול, מה תקוע, CR-ים מפגרים, עומס בודקים — מוכן להעתקה למייל.',
    usedIn: 'ניהול בדיקות → ניהול QA יומי → "🤖 תדריך יומי" (מוצע — טרם מחובר)',
    wired: false, output: 'text',
    template: `אתה מנהל QA. כתוב תדריך בוקר קצר לצוות ולמנהלים על מצב הבדיקות בגרסה, על סמך הנתונים בלבד.

גרסה: {{versionName}} · סבב נוכחי: {{cycle}} · ימים לסוף הסבב: {{daysLeft}}

התקדמות אתמול (בוצע מול תוכנן, לפי CR):
{{yesterday}}

תקלות שנפתחו/נסגרו אתמול, ותקלות שחורגות מה-SLA:
{{defects}}

תסריטים חסומים ובגלל מה:
{{blocked}}

עומס בודקים (משויך מול בוצע):
{{testers}}

כתוב עד 12 שורות, בסעיפים: ✅ מה התקדם · ⚠️ מה תקוע ומי צריך לפעול · 🎯 מיקוד להיום. משפטים קצרים, מספרים אמיתיים, בלי הקדמות. כתוב בעברית.`,
    vars: {
      versionName: 'גרסה', cycle: 'הסבב הנוכחי', daysLeft: 'ימים לסוף הסבב', yesterday: 'ביצוע מול תכנון לפי CR',
      defects: 'תנועת תקלות + חריגות SLA', blocked: 'תסריטים חסומים והסיבה', testers: 'עומס לכל בודק',
    },
    sample: {
      versionName: 'ITv08-2026', cycle: 'סבב 2', daysLeft: '3',
      yesterday: 'CR 12714: 6/8 · CR 12873: 2/9 · CR 12901: 5/5',
      defects: 'נפתחו 4 (Severe 1) · נסגרו 6 · חריגת SLA: #61201 Severe (+30 שעות)',
      blocked: '3 תסריטים של CR 12873 — ממתינים לתיקון #61201',
      testers: 'Anna Leshem 12/14 · Asaf Soul 3/11 · Dan Brauda 9/9',
    },
  },
  {
    id: 'rollout.planReview',
    title: 'בדיקת שלמות תוכנית עבודה',
    description: 'לפני אישור תוכנית עבודה של צוות: בודק שלכל צעד יש זמן ו-Rollback, שאין תלויות חסרות, ושיש בדיקות ובקרות.',
    usedIn: 'תוכניות CR → "🤖 בדוק תוכנית" (מוצע — טרם מחובר)',
    wired: false, output: 'json',
    template: `אתה מנהל שחרור בכיר שבודק תוכנית עבודה לליל גרסה לפני אישור. מצא חוסרים — אל תשכתב את התוכנית.

CR: {{crNumber}} — {{crTitle}} · צוות: {{team}}
תוכנית העבודה:
{{plan}}

${JSON_ONLY} במבנה הבא:
{
  "ready": true | false,
  "missing": [ { "section": "תוכנית עבודה|סקריפטים|זמני הרצה|בדיקות לילה|בקרות בוקר|Rollback|עלייה מדורגת", "issue": "מה חסר או לא ברור", "severity": "חוסם|חשוב|הערה" } ],
  "questionsToTeam": ["שאלות ממוקדות לצוות לפני אישור"]
}

בדוק במיוחד: לכל סקריפט/פריסה יש Rollback; זמני הרצה מוגדרים ומסתכמים בחלון הלילה; תלויות בצוותים אחרים מצוינות; יש בדיקת smoke אחרי ההטמעה ובקרה לבוקר; טקסט שנראה כנתוני ניסיון מסומן. כתוב בעברית.`,
    vars: { crNumber: 'מספר CR', crTitle: 'כותרת', team: 'הצוות', plan: 'כל שדות תוכנית העבודה של הצוות' },
    sample: {
      crNumber: '12714', crTitle: 'זיהוי אוטומטי עבור ציוד שחויב אובדן והוחזר', team: 'EAI Team',
      plan: 'תוכנית עבודה: פריסת flow חדש\nסקריפטים: update_equip_flow.sql\nזמני הרצה: (ריק)\nRollback: (ריק)\nבדיקות לילה: הרצת הזמנת ציוד לדוגמה',
    },
  },
  {
    id: 'defect.duplicateCheck',
    title: 'זיהוי תקלה כפולה',
    description: 'בפתיחת תקלה חדשה: משווה לתקלות פתוחות דומות באותה מערכת ומציע אם זו כפילות.',
    usedIn: 'פתיחת תקלה חדשה → בדיקה לפני שמירה (מוצע — טרם מחובר)',
    wired: false, output: 'json',
    template: `אתה מנהל QA. נבדקת תקלה חדשה לפני שנפתחת ב-QC. קבע אם היא כפילות של אחת מהתקלות הקיימות.

התקלה החדשה:
{{newDefect}}

תקלות קיימות פתוחות דומות (אותה מערכת/צוות):
{{candidates}}

${JSON_ONLY} במבנה הבא:
{
  "matches": [ { "id": "מספר תקלה קיימת", "likelihood": "גבוהה|בינונית|נמוכה", "why": "מה דומה ומה שונה" } ],
  "advice": "פתח תקלה חדשה | הוסף הערה לתקלה #... במקום | פתח וקשר ל-#..."
}

כפילות = אותה התנהגות שגויה באותו תהליך, לא רק מילים דומות. החזר רק התאמות בסבירות בינונית ומעלה. כתוב בעברית.`,
    vars: { newDefect: 'כותרת, מערכת, סביבה ותיאור של התקלה החדשה', candidates: 'עד 20 תקלות פתוחות דומות: מספר, כותרת, סטטוס, תחילת התיאור' },
    sample: {
      newDefect: 'timeout בעדכון סטטוס ציוד אחרי החזרה · CRM · Test\nתיאור: לאחר החזרת ציוד הסטטוס לא מתעדכן ומתקבלת שגיאת זמן',
      candidates: '- #61201 Open · timeout בעדכון סטטוס ציוד · "בעת החזרת ממיר הממשק לא מגיב תוך 30 שניות"\n- #61150 Open · שגיאה במסך החזרת ציוד · "כפתור החזרה לא פעיל"',
    },
  },
];

// ── overrides + rendering ────────────────────────────────────────────────
const OVERRIDES_KEY = 'AI_PROMPT_OVERRIDES';
type Overrides = Record<string, { template?: string; system?: string; updatedAt?: string; updatedBy?: string }>;

export async function readPromptOverrides(): Promise<Overrides> {
  const row = await prisma.systemParam.findUnique({ where: { key: OVERRIDES_KEY } });
  try { return row?.value ? JSON.parse(row.value) : {}; } catch { return {}; }
}

export async function savePromptOverride(id: string, value: { template?: string; system?: string } | null, by: string): Promise<void> {
  const all = await readPromptOverrides();
  if (value) all[id] = { ...value, updatedAt: new Date().toISOString(), updatedBy: by };
  else delete all[id];
  await prisma.systemParam.upsert({
    where: { key: OVERRIDES_KEY },
    update: { value: JSON.stringify(all) },
    create: { key: OVERRIDES_KEY, label: 'פרומפטים של AI שנערכו במערכת', value: JSON.stringify(all), type: 'text' },
  });
}

export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

/** The prompt a feature sends: the admin's edited wording if any, filled with the data blocks. */
export async function renderPrompt(id: string, vars: Record<string, string>): Promise<{ system?: string; prompt: string }> {
  const def = AI_PROMPTS.find(p => p.id === id);
  if (!def) throw new Error(`Unknown AI prompt: ${id}`);
  const o = (await readPromptOverrides())[id];
  const system = o?.system ?? def.system;
  return { system: system ? fillTemplate(system, vars) : undefined, prompt: fillTemplate(o?.template ?? def.template, vars) };
}
