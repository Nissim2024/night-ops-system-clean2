import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// AI-identified candidate risks (spec confirmed 2026-09-05 — "טבלה נפרדת...
// כרגע רק לבחינה"). Generic, version-independent risk PATTERNS derived from
// signals the app already computes elsewhere — not auto-refreshed against
// live data, just a fixed list to browse and cherry-pick from. See project
// memory "deferred AI risk suggestions" for the original analysis this seeds
// from. `key` is the upsert target — edit values here and restart to update
// an existing row; add a new object with a new `key` to add one, since
// `seed()` never overwrites an already-PROMOTED/REJECTED row's status.
const SEED_DATA = [
  {
    key: 'qg-fail-near-golive',
    title: 'שער איכות (Quality Gate) נכשל בסמוך למועד עלייה לאוויר',
    sourceArea: 'Release Intelligence — דף הבית',
    signal: 'qualityGate.status === FAIL בשילוב עם קרבה לתאריך העלייה לאוויר',
    severity: 'CRITICAL',
    probability: 'MEDIUM',
    impact: 'יעד האיכות שהוגדר לגרסה אינו מתקיים — סיכון לעלייה לאוויר בניגוד ליעד שנקבע מראש',
    mitigation: 'כינוס דיון Go/No-Go ממוקד ברכיבי ה-QG שנכשלו (Show Stopper/Severe) לפני כל המשך תהליך',
  },
  {
    key: 'coverage-pace-insufficient',
    title: 'כיסוי בדיקות נמוך מהיעד עם קצב שלא מספיק להשלמה עד עלייה לאוויר',
    sourceArea: 'Release Intelligence — כרטיס כיסוי בדיקות',
    signal: 'forecastPace (מחושב כבר בכרטיס הכיסוי) מצביע על אי-עמידה ביעד עד למועד',
    severity: 'HIGH',
    probability: 'MEDIUM',
    impact: 'חלק ניכר מהתרחישים לא ירוצו לפני העלייה — כיסוי חלקי בפועל',
    mitigation: 'תגבור בודקים / צמצום scope / בחינת דחיית מועד העלייה',
  },
  {
    key: 'critical-defect-aging',
    title: 'תקלה קריטית (Show Stopper/Severe) פתוחה זמן רב ללא טיפול',
    sourceArea: 'Release Intelligence — כרטיס תקלות / Bug Dashboard',
    signal: 'oldestCriticalDefectAgeDays חורג מסף (למשל 5+ ימים)',
    severity: 'HIGH',
    probability: 'HIGH',
    impact: 'תקלה חוסמת עלולה לעכב את כל הגרסה אם לא תטופל בזמן',
    mitigation: 'קביעת בעלים ו-ETA מחייבים תוך 24 שעות, אחרת אסקלציה למנהל הגרסה',
  },
  {
    key: 'worst-cr-defect-concentration',
    title: 'ריכוז תקלות חריג ב-CR בודד',
    sourceArea: 'Release Intelligence — כרטיס תקלות (worstCr)',
    signal: 'worstCr.count חורג משמעותית משאר ה-CR-ים',
    severity: 'MEDIUM',
    probability: 'MEDIUM',
    impact: 'יכול להעיד על CR לא יציב / לא בשל מספיק לעלייה',
    mitigation: 'בדיקת Root Cause ממוקדת ל-CR לפני שממשיכים הלאה',
  },
  {
    key: 'env-refresh-unconfirmed',
    title: 'ריענון סביבה קרוב ללא אישור מפורש שהוא אכן יתבצע',
    sourceArea: 'לוח פעילויות (Activity Board)',
    signal: 'תזכורת env_refresh פעילה (3 ימים לפני) ללא עדכון סטטוס מפורש מהצוות האחראי',
    severity: 'HIGH',
    probability: 'MEDIUM',
    impact: 'אם הריענון לא יתבצע בזמן — כל תוכנית הבדיקות נעצרת',
    mitigation: 'דרישת אישור מפורש מ-DBA Team יום לפני המועד, לא הסתמכות על תזכורת פסיבית בלבד',
  },
  {
    key: 'dry-run-not-confirmed-done',
    title: 'חזרה גנרלית (dry run) שלא סומנה כהושלמה בהצלחה',
    sourceArea: 'לוח פעילויות (Activity Board) + Runbook',
    signal: 'תאריך החזרה הגנרלית חלף ואין השלמה מלאה של שלבי ה-Runbook',
    severity: 'MEDIUM',
    probability: 'LOW',
    impact: 'חוסר וודאות אם ה-Runbook נבדק בפועל לפני ליל ההטמעה האמיתי',
    mitigation: 'מעקב יזום אחרי סטטוס השלמת שלבי ה-Runbook, לא רק חלוף התאריך',
  },
  {
    key: 'cr-plan-teams-not-submitted',
    title: 'צוותים שלא הגישו תוכנית CR קרוב לדדליין',
    sourceArea: 'ניהול גרסה / CR Plans',
    signal: 'מספר הצוותים שטרם הגישו תוכנית (כבר מוצג כ-KPI היום) בשילוב קרבה לתאריך CR_REVIEW',
    severity: 'HIGH',
    probability: 'HIGH',
    impact: 'בלי תוכנית לא ניתן לתכנן את פעילות הלילה עבור אותו צוות',
    mitigation: 'תזכורת אוטומטית לצוות + אסקלציה למנהל הצוות ככל שמתקרבים לדדליין',
  },
  {
    key: 'crplan-highrisk-not-surfaced',
    title: 'תוכנית CR שסומנה בסיכון גבוה על ידי הצוות אך לא מטופלת במרכז',
    sourceArea: 'CR Plans (riskLevel)',
    signal: 'CrPlan.riskLevel = HIGH קיים בשדה אך לא זורם לטבלת הסיכונים המרכזית',
    severity: 'HIGH',
    probability: 'MEDIUM',
    impact: 'סיכון שכבר דווח על ידי הצוות עצמו נשאר "קבור" ולא נראה במקום מרכזי',
    mitigation: 'קישור ישיר מהסיכון ל-CR Plan הרלוונטי + מעקב תקופתי',
  },
  {
    key: 'crs-at-risk-trending-up',
    title: 'מספר CR-ים בסיכון (crsAtRisk) עולה מיום ליום',
    sourceArea: 'Daily QA Management (DailyQaSnapshot)',
    signal: 'DailyQaSnapshot.crsAtRisk עולה יומיים ברציפות — הנתון היחיד היום עם היסטוריה אמיתית שמורה',
    severity: 'HIGH',
    probability: 'MEDIUM',
    impact: 'התרעה מוקדמת על גרסה שמידרדרת, לא רק תמונת מצב חד-פעמית',
    mitigation: 'בדיקת ה-CR-ים הספציפיים שעברו ל-HIGH (המפה crRisk כבר קיימת) ותיאום מול הצוותים',
  },
  {
    key: 'testers-no-progress',
    title: 'בודק/ים ללא התקדמות מספר ימים',
    sourceArea: 'Daily QA Management (DailyQaSnapshot)',
    signal: 'DailyQaSnapshot.testersNoProgress > 0 יומיים ברציפות',
    severity: 'MEDIUM',
    probability: 'MEDIUM',
    impact: 'עומס לא מאוזן בין בודקים או חסימה שלא דווחה',
    mitigation: 'בירור יזום מול הבודק/ר.צוות הרלוונטי',
  },
  {
    key: 'cycle-ending-soon-qg-miss',
    title: 'מחזור בדיקות שמסתיים בקרוב בלי לעמוד ביעד שער האיכות',
    sourceArea: 'Cycle Progress',
    signal: 'CYCLE_ENDING_SOON_HOURS (48 שעות) — קיים כבר כלוגיקה פנימית במסך אך לא כסיכון גלוי',
    severity: 'HIGH',
    probability: 'MEDIUM',
    impact: 'המחזור ייסגר בפועל בלי לעמוד ביעד — משפיע ישירות על ציון הבריאות',
    mitigation: 'הארכת המחזור או דחיפה ממוקדת להשלמת הרכיבים החסרים',
  },
  {
    key: 'bug-reopen-rate-high',
    title: 'קצב Reopen גבוה מהרגיל',
    sourceArea: 'QC Bug Dashboard',
    signal: 'getReopenedDefectIdsForVersion בהשוואה לבייסליין (ממוצע גרסאות קודמות)',
    severity: 'MEDIUM',
    probability: 'LOW',
    impact: 'מעיד על תיקונים לא יציבים או כיסוי regression חלש',
    mitigation: 'בדיקת דפוס משותף בין ה-Reopens (אותו רכיב / אותו מפתח)',
  },
  {
    key: 'quality-hub-sync-stale',
    title: 'סנכרון KPI מ-Oracle (Quality Hub) נכשל או לא רץ בשקט',
    sourceArea: 'Quality Hub',
    signal: 'חלוף זמן ניכר מאז QUALITY_KPI_SYNC_TIME האחרון בלי עדכון בפועל',
    severity: 'HIGH',
    probability: 'LOW',
    impact: 'מקבלי החלטות מסתכלים על ציון איכות מיושן בלי לדעת שהוא לא עדכני',
    mitigation: 'התרעה אוטומטית כשחלף סף שעות מוגדר מאז הסנכרון האחרון בלי שינוי',
  },
  {
    key: 'email-snapshot-staleness',
    title: 'תמונת מצב שנשלחה במייל (Copy to Email) עלולה להתיישן',
    sourceArea: 'Release Intelligence — דף הבית (Copy to Email)',
    signal: 'אין תאריך תפוגה על התוכן שהועתק, רק חותמת זמן יצירה',
    severity: 'LOW',
    probability: 'MEDIUM',
    impact: 'מקבל המייל עלול לפעול לפי נתונים לא עדכניים אם קרא את המייל זמן רב אחרי שנשלח',
    mitigation: 'הדגשת הקישור החוזר לנתונים חיים (קיים כבר) בצורה בולטת יותר בגוף ההודעה',
  },
] as const;

@Injectable()
export class SuggestedRisksService {
  // Upsert-by-key, never overwrites an existing row (matches SystemParamsService's
  // own seed() convention) — a row a user already promoted/rejected keeps that
  // status across restarts; editing SEED_DATA above only affects rows not yet
  // created (new keys) since `update: {}`.
  async seed() {
    for (const r of SEED_DATA) {
      await prisma.suggestedRisk.upsert({
        where: { key: r.key },
        update: {},
        create: r,
      });
    }
  }

  listAll() {
    return prisma.suggestedRisk.findMany({
      orderBy: [{ status: 'asc' }, { severity: 'desc' }, { createdAt: 'asc' }],
    });
  }

  // Creates a real, per-version ReleaseRisk from this candidate — the "move
  // to the main table" step. The candidate's `signal` (what data pattern it
  // was based on) is kept on the new risk's `description`, so anyone reading
  // it later still sees why it was raised, not just the title.
  async promote(id: string, versionId: string, userId: string) {
    if (!versionId) throw new BadRequestException('יש לבחור גרסה להעברת הסיכון אליה');
    const candidate = await prisma.suggestedRisk.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundException('הצעת הסיכון לא נמצאה');
    if (candidate.status !== 'PENDING') throw new BadRequestException('הצעה זו כבר טופלה');

    const risk = await prisma.releaseRisk.create({
      data: {
        versionId,
        title: candidate.title,
        description: candidate.signal,
        severity: candidate.severity,
        probability: candidate.probability,
        impact: candidate.impact,
        mitigation: candidate.mitigation,
        createdBy: userId,
      },
    });
    await prisma.suggestedRisk.update({
      where: { id },
      data: { status: 'PROMOTED', promotedRiskId: risk.id },
    });
    return risk;
  }

  async reject(id: string) {
    const candidate = await prisma.suggestedRisk.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundException('הצעת הסיכון לא נמצאה');
    if (candidate.status !== 'PENDING') throw new BadRequestException('הצעה זו כבר טופלה');
    return prisma.suggestedRisk.update({ where: { id }, data: { status: 'REJECTED' } });
  }
}
