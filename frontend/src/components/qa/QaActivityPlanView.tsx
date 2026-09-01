import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { C, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE, FONT } from '../../theme';
import RunbookModal, { getRunbookTrigger, RunbookTrigger } from './RunbookModal';
import { InviteDialog, InviteTeamOption } from './InviteDialog';
import { DateField } from '../DatePicker';
import { formatDate } from '../../utils/dateFormat';
import { useDialog } from '../../context/DialogContext';

const API  = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;
const BLUE = '#4573D2';

// ── Types ──────────────────────────────────────────────────────────────────────

interface WorkPlanCycle {
  cycleType: string;
  plannedStart: string | null;
  plannedEnd:   string | null;
}

interface WorkPlan {
  id:          string;
  cycle1Start: string | null;
  testingEnd:  string | null;
  cycles:      WorkPlanCycle[];
}

interface ActivityItem {
  id:             string;
  dbId?:          string;
  sortKey:        number;
  dateStartLabel: string;
  dateEndLabel:   string;
  dateStartISO:   string;
  dateEndISO:     string;
  label:          string;
  owner:          string;
  ownerEmployee:  string;
  attendees:      string[];
  notes:          string;
  category:       string;
  isRelevant:     boolean;
  isCustom:       boolean;
  highlight?:     'golive' | 'billing';
}

type Category = 'meeting' | 'refresh' | 'deployment' | 'testing' | 'golive' | 'billing' | 'other';

const CAT_LABELS: Record<Category | 'all', string> = {
  all:        'הכל',
  meeting:    'פגישות',
  refresh:    'רענונים',
  deployment: 'העברות גרסה',
  testing:    'בדיקות',
  golive:     'עלייה לאוויר',
  billing:    'בילינג',
  other:      'אחר',
};


// ── Work-day helpers (ראשון–חמישי) ────────────────────────────────────────────
// `holidayDays` (yyyy-mm-dd keys) mirrors the real-holiday set the other QA
// screens use (Season.forcesOff, fetched from GET /leaves/seasons) — this
// screen previously only skipped Fri/Sat and was completely holiday-blind,
// generating meeting/refresh/deployment/go-live dates straight through real
// holidays. Fixed 2026-08-03 alongside the same gap in qa-workplan.service.ts
// and qa.service.ts.

function isWorkDay(d: Date, holidayDays?: Set<string>): boolean {
  const w = d.getDay();
  if (w === 5 || w === 6) return false; // שישי=5, שבת=6
  if (holidayDays && holidayDays.has(d.toISOString().slice(0, 10))) return false;
  return true;
}

function addWDBase(base: Date, n: number, holidayDays?: Set<string>): Date {
  const d = new Date(base);
  d.setHours(12, 0, 0, 0);
  if (n === 0) return d;
  const step = n > 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    d.setDate(d.getDate() + step);
    if (isWorkDay(d, holidayDays)) remaining--;
  }
  return d;
}

function nextDowBase(from: Date, dow: number, holidayDays?: Set<string>): Date {
  const d = new Date(from);
  d.setHours(12, 0, 0, 0);
  do { d.setDate(d.getDate() + 1); } while (d.getDay() !== dow || (holidayDays && holidayDays.has(d.toISOString().slice(0, 10))));
  return d;
}

// Holiday-agnostic aliases for call sites outside buildSchedule's local
// shadowing (e.g. computeGoLive, called with an explicit holidayDays arg).
const addWD   = addWDBase;
const nextDow = nextDowBase;

function fmtDate(d: Date): string {
  const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  // Unified DD/MM/YYYY date (2026-08-31 spec) — single-letter weekday kept:
  // this is a compact per-day column header in a calendar/Gantt view, where
  // the weekday letter is the primary at-a-glance context, not decoration.
  return `${formatDate(d)} ${DOW[d.getDay()]}`;
}

function parseDate(s: string): Date {
  const d = new Date(s);
  d.setHours(12, 0, 0, 0);
  return d;
}

function savedToItem(e: any): ActivityItem {
  return {
    id:             e.activityKey,
    dbId:           e.id,
    sortKey:        e.dateStart ? new Date(e.dateStart).getTime() : 0,
    dateStartLabel: e.dateStart ? fmtDate(new Date(e.dateStart)) : '—',
    dateEndLabel:   e.dateEnd   ? fmtDate(new Date(e.dateEnd))   : '—',
    dateStartISO:   e.dateStart ?? '',
    dateEndISO:     e.dateEnd   ?? '',
    label:          e.label,
    owner:          e.owner         ?? '',
    ownerEmployee:  e.ownerEmployee ?? '',
    attendees:      e.attendees ?? [],
    notes:          e.notes     ?? '',
    category:       e.category  ?? 'other',
    isRelevant:     e.isRelevant ?? true,
    isCustom:       e.isCustom  ?? false,
    highlight:      e.category === 'golive'  ? 'golive'
                  : e.category === 'billing' ? 'billing'
                  : undefined,
  };
}

// ── Go-live (מודול 3.3) ────────────────────────────────────────────────────────

const BLOCKED_DOW = [3, 4, 5, 6]; // רביעי, חמישי, שישי, שבת

function computeGoLive(lastTestEnd: Date, manualDelay: number, holidayDays?: Set<string>): Date {
  let t = addWD(lastTestEnd, 1 + manualDelay, holidayDays);
  while (BLOCKED_DOW.includes(t.getDay()) || (holidayDays && holidayDays.has(t.toISOString().slice(0, 10)))) {
    do { t.setDate(t.getDate() + 1); } while (t.getDay() !== 0); // קפוץ לראשון
  }
  return t;
}

// ── Schedule engine ────────────────────────────────────────────────────────────

type EnvName = 'אינטגרציה' | 'טסט';
const envLabel = (e: EnvName) => `סביבת ה${e}`;

function buildSchedule(
  integrationStart: Date | null,
  integrationEnd:   Date,
  test1Start:       Date,
  cycle1End:        Date | null,
  cycle2Start:      Date | null,
  test2End:         Date,
  lastTestEnd:      Date,
  manualDelay:      number,
  envInt:           EnvName,
  envQA:            EnvName,
  envDry:           EnvName,
  holidayDays?:     Set<string>,
): { activities: ActivityItem[]; warnings: string[] } {

  // Shadow the module-level date helpers with holiday-bound versions for the
  // rest of this function — every unqualified addWD/nextDow call below picks
  // this up automatically without editing each of the ~20 call sites.
  const addWD    = (base: Date, n: number) => addWDBase(base, n, holidayDays);
  const nextDow  = (from: Date, dow: number) => nextDowBase(from, dow, holidayDays);

  const T      = computeGoLive(lastTestEnd, manualDelay, holidayDays);
  const phaseC = addWD(T, 1);

  const eInt = envLabel(envInt);
  const eQA  = envLabel(envQA);
  const eDry = envLabel(envDry);

  // PLIKE: יום חמישי (4) הקרוב ביותר אחרי שלב ג׳
  const plikeDate = nextDow(phaseC, 4);

  // הדרכה: יום רביעי (3) הקרוב, אם < 2 ימים מלאים → שני (1) שבוע הבא
  let trainingDate = nextDow(phaseC, 3);
  const trainingNote = Math.floor(
    (trainingDate.getTime() - phaseC.getTime()) / 86400000,
  ) < 2;
  if (trainingNote) trainingDate = nextDow(trainingDate, 1);

  // בילינג — המופע הבא של כל תאריך לאחר integrationEnd
  const nextBillingDay = (after: Date, day: number): Date => {
    const same = new Date(after.getFullYear(), after.getMonth(), day, 12);
    return same > after ? same : new Date(after.getFullYear(), after.getMonth() + 1, day, 12);
  };
  const billing16s = nextBillingDay(integrationEnd, 7);
  const billing16e = new Date(billing16s.getFullYear(), billing16s.getMonth(), 9, 12);
  // סייקל 1 רץ ה-23 הראשון שנמצא לפחות 3 ימי עבודה אחרי פתיחת הסבב
  const billing1   = nextBillingDay(addWD(test1Start, 3), 23);

  // אימות
  const warnings: string[] = [];
  if (integrationEnd >= test1Start)
    warnings.push('⚠️ תאריך סיום אינטגרציה חופף או מאוחר מתחילת סבב הבדיקות');
  if (integrationStart && integrationStart >= integrationEnd)
    warnings.push('⚠️ תחילת האינטגרציה חייבת להיות לפני סיומה');

  const act = (
    id: string, dateStart: Date, dateEnd: Date,
    label: string, owner: string, ownerEmployee: string, attendees: string[], notes: string,
    category: string,
    highlight?: ActivityItem['highlight'],
  ): ActivityItem => ({
    id, sortKey: dateStart.getTime(),
    dateStartLabel: fmtDate(dateStart),
    dateEndLabel:   fmtDate(dateEnd),
    dateStartISO:   dateStart.toISOString(),
    dateEndISO:     dateEnd.toISOString(),
    label, owner, ownerEmployee, attendees, notes, category,
    isRelevant: true, isCustom: false, highlight,
  });

  const activities: ActivityItem[] = [];

  // ── שלב היערכות לאינטגרציה ────────────────────────────────────────────────────
  if (integrationStart) {
    activities.push(
      act('prod_to_int_copy',   integrationStart, integrationStart,
        `העתקת קודים מסביבת הייצור ל${eInt}`, 'DBA Team', 'Ayelet Amar',
        [],
        `יישור קו בסטאפ האחרון — העתקת נתוני הייצור ל${eInt} לקראת סבב הבדיקות.`,
        'refresh'),
      act('container_run',      integrationStart, integrationStart,
        `הרצת קונטיינר על ${eInt}`, 'DBA Team', 'Ayelet Amar',
        [],
        `הרצת קונטיינר ובדיקת תקינות הסביבה לאחר העתקת הנתונים ל${eInt}.`,
        'deployment'),
      act('version_delivery',   integrationStart, integrationStart,
        `העברת הגרסה ל${eInt}`, 'Dev Teams', '',
        [],
        `פריסת גרסת הפיתוח ל${eInt} לטובת בדיקות האינטגרציה.`,
        'deployment'),
      act('integration_testing', integrationStart, integrationEnd,
        `בדיקות אינטגרציה ב${eInt}`, 'QA Team', 'Nissim Peretz',
        [],
        `שלב בדיקות האינטגרציה על ${eInt}. הבדיקות כוללות תרחישי end-to-end בין מערכות.`,
        'testing'),
      act('team_readiness',     addWD(integrationEnd, -1), addWD(integrationEnd, -1),
        'מוכנות צוותי הבדיקות', 'QA Team', 'Nissim Peretz',
        [],
        'וידוא שתוכנית הבדיקות מוכנה עבור כלל הפיתוחים בגרסה. כל צוות מאשר מוכנות יום לפני סיום האינטגרציה.',
        'meeting'),
      act('bug_fix_deadline',   integrationEnd, integrationEnd,
        'מועד אחרון להכנסת תיקוני באגים מהייצור', 'Management', 'Talk Elshayov',
        [],
        'לאחר מועד זה לא תתאפשר הכנסה של תיקוני ייצור לסבב, אלא אם מדובר בתקלת שבר.',
        'deployment'),
    );
  }

  // ── פעילויות עיקריות ──────────────────────────────────────────────────────────
  activities.push(
    act('env_refresh',    addWD(integrationEnd, -1), addWD(integrationEnd, -1),
      `רענון מלא ${eQA}`, 'DBA Team', 'Ayelet Amar',
      [],
      `חלון השבתת ${eQA} לצורך רענון נתונים קומפלט (לקוחות + דאטה) מסביבת הייצור. אין לבצע בדיקות ביום זה.`,
      'refresh'),
    act('code_delivery',  integrationEnd, integrationEnd,
      `תאריך אחרון להעברת קוד ל${eQA}`, 'Management', 'Talk Elshayov',
      [],
      `המועד האחרון להעברת קוד מסביבת הפיתוח ל${eQA}. לאחר תאריך זה לא יתקבל קוד נוסף לסבב הנוכחי.`,
      'deployment'),
    act('code_freeze',    integrationEnd, integrationEnd,
      'Code Freeze + Setup', 'Dev Teams', '',
      [],
      `סגירת Code Freeze, פריסת קוד פיתוח, הרצת קונטיינר וביצוע תהליך Setup ב${eQA}.`,
      'deployment'),
    act('billing_16',     billing16s, billing16e,
      'בילינג — סייקל 16 (חלון 7–9 לחודש)', 'QA Team', 'Hna Klsbansky',
      [],
      `חלון הרצת סייקל 16 מ-${fmtDate(billing16s)} עד ${fmtDate(billing16e)}.`,
      'billing', 'billing'),
    act('billing_1',      billing1, billing1,
      'בילינג — סייקל 1 (23 לחודש)', 'QA Team', 'Hna Klsbansky',
      [],
      'הרצת סייקל 1 של בילינג (חוק ה-23 לחודש).',
      'billing', 'billing'),
  );

  if (cycle2Start)
    activities.push(
      act('cycle2_prep',  addWD(cycle2Start, -1), addWD(cycle2Start, -1),
        'הערכות צוותי הבדיקות לסבב שני', 'QA Team', 'Nissim Peretz',
        [],
        'פגישת צוותי הבדיקות לתאום וגיבוש היערכות לקראת פתיחת סבב הבדיקות השני.',
        'meeting'),
    );

  // בדיקות משתמשים — 2 ימים אחרונים של סבב 1
  const userTestStart = cycle1End ? addWD(cycle1End, -1) : addWD(test2End, 2);
  const userTestEnd   = cycle1End ?? addWD(test2End, 2);

  activities.push(
    act('user_testing',   userTestStart, userTestEnd,
      'תחילת בדיקות משתמשים', 'QA Team', 'Hay Cohen',
      [],
      'בדיקות קבלה על ידי משתמשים עסקיים — 2 ימים אחרונים של סבב 1.',
      'testing'),
    act('dry_run',        addWD(T, -2), addWD(T, -2),
      `חזרה גנרלית — סימולציית משימות לילה על ${eDry}`, 'QA Team', 'Hay Cohen',
      [],
      `הרצת סימולציה מלאה של ה-Runbook על ${eDry}, כולל משימות לילה. מתקיים יומיים לפני עלייה לאוויר.`,
      'testing'),
    act('cr_review',      addWD(T, -10), addWD(T, -10),
      'סקירת תוכניות CR-ים (אחודה)', 'Management', 'CR Manager',
      [],
      'סקירה ארכיטקטונית ופונקציונלית של כלל הפיצ\'רים שעולים בגרסה. שבועיים לפני עלייה לאוויר.',
      'meeting'),
    act('runbook',        addWD(T, -9), addWD(T, -9),
      'מעבר על תוכנית עבודה (ליל הטמעה)', 'QA Team', 'Hay Cohen',
      [],
      'מעבר שורה-שורה על ה-Runbook הטכנולוגי של ליל ההטמעה. וידאו זמנים וקשרים.',
      'meeting'),
    act('runbook_backup', addWD(T, -8), addWD(T, -8),
      'פגישת המשך — מעבר על תוכנית עליה לאוויר', 'QA Team', 'Odedya Etna',
      [],
      'פגישת המשך למעבר על תוכנית עליה לאוויר, במידה והמעבר לא הושלם בפגישה הקודמת.',
      'meeting'),
    act('handoff',        lastTestEnd, lastTestEnd,
      'העברת מקל לתפעול והדרכות', 'QA Team', 'Odedya Etna',
      [],
      'העברת תיעוד, מדריכים למשתמש, הגדרת מערכות ניטור ורשימת באגים פתוחים.',
      'meeting'),
    act('mgmt_prep',      addWD(T, -3), addWD(T, -3),
      'היערכות מנהלים — סיכום בדיקות + UAT', 'Management', 'Talk Elshayov',
      [],
      'סטטוס חזרה גנרלית, מדדי באגים, ואישור סופי סטטוס בדיקות UAT. יומיים לפני פגישת הנהלה בכירה.',
      'meeting'),
    act('go_nogo',        addWD(T, -1), addWD(T, -1),
      'אישור הנהלה בכירה — Go / No-Go', 'Management', 'Talk Elshayov',
      [],
      'הצגת סטטוס מוכנות סופי להנהלה בכירה וקבלת אישור חתום לעלייה לאוויר.',
      'meeting'),
    act('golive_a',       T, T,
      '🟢 עלייה לאוויר — שלב א׳ (היערכות ביום)', 'QA Team', 'Hay Cohen',
      [],
      'פתיחת חמ"ל פיזי/וירטואלי, וידאו זמינות ספקים ובדיקות מוכנות אחרונות.',
      'golive', 'golive'),
    act('golive_b',       T, phaseC,
      '🟢 עלייה לאוויר — שלב ב׳ (הטמעה לילה)', 'QA Team', 'Hay Cohen',
      [],
      'ביצוע ההטמעה בפועל בייצור. הרצת Runbook ובדיקות Sanity/Post-Ops לפנות בוקר.',
      'golive', 'golive'),
    act('golive_c',       phaseC, phaseC,
      '🟢 עלייה לאוויר — שלב ג׳ (בקרות ייצוב)', 'QA Team', 'Odedya Etna',
      [],
      'בקרות שרשרת אספקה, אישור תקינות בוקר, השלמת משימות ופתיחת שירות ללקוחות.',
      'golive', 'golive'),
    act('plike',          plikeDate, plikeDate,
      'סביבת PLIKE — רענון ויישור גרסה', 'QA Team', 'Stanislav Abramyan',
      [],
      'רענון מלא של סביבת Pre-Prod מהייצור החדש (חוק: יום חמישי הקרוב ביותר).',
      'refresh'),
    act('training',       trainingDate, trainingDate,
      'סביבת הדרכה — רענון ויישור גרסה', 'QA Team', 'Stanislav Abramyan',
      [],
      trainingNote
        ? 'רענון סביבת הדרכה (הוזז לשני הקרוב — לא חלפו 2 ימים מלאים מסיום שלב ג׳).'
        : 'רענון מלא והעתקת גרסת הייצור לסביבת ההדרכה (יום רביעי הקרוב).',
      'refresh'),
    act('lessons_learned', addWD(phaseC, 5), addWD(phaseC, 5),
      'הפקת לקחים', 'QA Team', 'Nissim Peretz',
      [],
      'ישיבת הפקת לקחים מסיכום הגרסה — סקירת תקלות, עיכובים ותהליכים לשיפור בגרסה הבאה.',
      'meeting'),
  );

  // ── אבני דרך — סבבי בדיקות ────────────────────────────────────────────────
  activities.push(
    act('cycle1_start', test1Start, test1Start,
      `🔵 פתיחת סבב בדיקות 1`, 'QA Team', 'Nissim Peretz',
      [],
      `תחילת סבב הבדיקות הראשון ב${eQA}.`,
      'testing'),
  );

  if (cycle1End) {
    activities.push(
      act('cycle1_end', cycle1End, cycle1End,
        `🔵 סיום סבב בדיקות 1`, 'QA Team', 'Nissim Peretz',
        [],
        `סיום סבב הבדיקות הראשון ב${eQA}. מעבר לסבב השני.`,
        'testing'),
    );
  }

  if (cycle2Start) {
    activities.push(
      act('cycle2_start', cycle2Start, cycle2Start,
        `🔵 פתיחת סבב בדיקות 2`, 'QA Team', 'Nissim Peretz',
        [],
        `תחילת סבב הבדיקות השני ב${eQA}.`,
        'testing'),
    );
  }

  activities.push(
    act('cycle2_end', test2End, test2End,
      `🔵 סיום סבב בדיקות 2 — סגירת בדיקות`, 'QA Team', 'Nissim Peretz',
      [],
      `סיום סבב הבדיקות השני ב${eQA}. לאחר מועד זה לא מתאפשרת כניסת קוד חדש לגרסה.`,
      'testing'),
  );

  activities.sort((a, b) => a.sortKey - b.sortKey);
  return { activities, warnings };
}

// ── Component ──────────────────────────────────────────────────────────────────

// ── Team / employee data ───────────────────────────────────────────────────────

interface TeamMember { user: { id: string; fullName: string; email?: string } }
interface TeamOption  { id: string; name: string; members: TeamMember[] }

const MANUAL_SENTINEL = '__manual__';

const inputStyle = (extra?: React.CSSProperties): React.CSSProperties => ({
  padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md,
  border: `1px solid ${C.border}`, background: C.bgCard,
  color: C.textPrimary, fontFamily: FONT, ...TEXT.sm, outline: 'none',
  width: '100%', boxSizing: 'border-box', ...extra,
});

interface OwnerPickerProps {
  teams:         TeamOption[];
  teamValue:     string;
  employeeValue: string;
  onChange:      (team: string, employee: string) => void;
}

function OwnerPicker({ teams, teamValue, employeeValue, onChange }: OwnerPickerProps) {
  const matchedTeam = teams.find(t => t.name === teamValue);
  const isManual    = !matchedTeam && teamValue !== '';
  const selectVal   = matchedTeam ? teamValue : (teamValue === '' ? '' : MANUAL_SENTINEL);
  const members     = matchedTeam?.members ?? [];

  const handleTeamSelect = (v: string) => {
    if (v === MANUAL_SENTINEL) {
      onChange('', employeeValue);
    } else {
      onChange(v, '');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[1] }}>
      <select
        value={isManual ? MANUAL_SENTINEL : selectVal}
        onChange={e => handleTeamSelect(e.target.value)}
        style={inputStyle()}
      >
        <option value="">— בחר צוות —</option>
        {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
        <option value={MANUAL_SENTINEL}>✏️ הזן ידנית…</option>
      </select>

      {/* Manual team name input */}
      {(isManual || selectVal === MANUAL_SENTINEL) && (
        <input
          value={teamValue}
          onChange={e => onChange(e.target.value, employeeValue)}
          placeholder="שם הצוות"
          style={inputStyle()}
        />
      )}

      {/* Employee: dropdown if system team, text input if manual */}
      {matchedTeam ? (
        <select
          value={employeeValue}
          onChange={e => onChange(teamValue, e.target.value)}
          style={inputStyle()}
        >
          <option value="">— בחר עובד —</option>
          {members.map(m => (
            <option key={m.user.id} value={m.user.fullName}>{m.user.fullName}</option>
          ))}
        </select>
      ) : (
        <input
          value={employeeValue}
          onChange={e => onChange(teamValue, e.target.value)}
          placeholder="שם עובד (אופציונלי)"
          style={inputStyle()}
        />
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  token:                    string;
  versionId:                string;
  versionIntegrationStart?: string | null;
  versionIntegrationEnd?:   string | null;
}

export default function QaActivityPlanView({ token, versionId, versionIntegrationStart, versionIntegrationEnd }: Props) {
  const headers = { Authorization: `Bearer ${token}` };
  const dialog = useDialog();

  const [workPlan,         setWorkPlan]         = useState<WorkPlan | null>(null);
  const [loadingPlan,      setLoadingPlan]      = useState(false);
  const [holidayDays,      setHolidayDays]      = useState<Set<string>>(new Set());
  const [integrationStart, setIntegrationStart] = useState('');
  const [integrationEnd,   setIntegrationEnd]   = useState('');
  const [manualDelay,      setManualDelay]      = useState(0);
  const [envInt,           setEnvInt]           = useState<EnvName>('אינטגרציה');
  const [envQA,            setEnvQA]            = useState<EnvName>('טסט');
  const [envDry,           setEnvDry]           = useState<EnvName>('אינטגרציה');
  const [activities,       setActivities]       = useState<ActivityItem[]>([]);
  const [warnings,         setWarnings]         = useState<string[]>([]);
  const [computed,         setComputed]         = useState(false);
  const [boardSaved,       setBoardSaved]       = useState(false);
  const [saving,           setSaving]           = useState(false);
  const [filterCat,        setFilterCat]        = useState<string>('all');
  const [editingId,        setEditingId]        = useState<string | null>(null);
  const [editDraft,        setEditDraft]        = useState<Partial<ActivityItem>>({});
  const [showAddForm,      setShowAddForm]      = useState(false);
  const [addDraft,         setAddDraft]         = useState({ label: '', owner: '', ownerEmployee: '', category: 'other', notes: '' });
  const [showBulkReplace,  setShowBulkReplace]  = useState(false);
  const [repTeamFrom,      setRepTeamFrom]      = useState('');
  const [repTeamTo,        setRepTeamTo]        = useState('');
  const [repEmpFrom,       setRepEmpFrom]       = useState('');
  const [repEmpTo,         setRepEmpTo]         = useState('');
  const [repEmpToTeam,     setRepEmpToTeam]     = useState('');
  const [expandedId,       setExpandedId]       = useState<string | null>(null);
  const [teams,            setTeams]            = useState<TeamOption[]>([]);
  const [inlineId,         setInlineId]         = useState<string | null>(null);
  const [inlineDraft,      setInlineDraft]      = useState<{ owner: string; ownerEmployee: string }>({ owner: '', ownerEmployee: '' });
  const [runbookItem,      setRunbookItem]      = useState<{ trigger: RunbookTrigger; dateStartISO: string } | null>(null);
  const [inviteItem,       setInviteItem]       = useState<ActivityItem | null>(null);
  const DEV_TEAMS_ENTRY: TeamOption = { id: '__dev_teams__', name: 'Dev Teams', members: [] };
  const displayTeams = [DEV_TEAMS_ENTRY, ...teams];
  const inviteTeams: InviteTeamOption[] = teams.map(t => ({
    id: t.id, name: t.name,
    members: t.members.filter(m => m.user.email).map(m => ({ id: m.user.id, fullName: m.user.fullName, email: m.user.email! })),
  }));

  const handleSendInvite = async (attendees: string[]) => {
    if (!inviteItem?.dbId) throw new Error('יש לשמור את הפעילות לפני קביעת פגישה');
    await axios.post(`${API}/activity-board/entry/${inviteItem.dbId}/invite`, { attendees }, { headers });
    setActivities(prev => prev.map(a => a.id === inviteItem.id ? { ...a, attendees } : a));
  };

  // ── Fetch teams (once) ───────────────────────────────────────────────────────
  useEffect(() => {
    axios.get(`${API}/teams`, { headers }).then(r => setTeams(r.data)).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch real holidays (once) — same forcesOff-filtered set the other QA
  // screens use, see qa-workplan.service.ts's loadHolidayDays ─────────────────
  useEffect(() => {
    axios.get(`${API}/leaves/seasons`, { headers })
      .then(r => {
        const keys = new Set<string>();
        (r.data as { forcesOff: boolean; dates: { date: string }[] }[])
          .filter(s => s.forcesOff)
          .forEach(s => s.dates.forEach(d => keys.add(new Date(d.date).toISOString().slice(0, 10))));
        setHolidayDays(keys);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pre-fill integration dates from version ───────────────────────────────
  useEffect(() => {
    if (versionIntegrationStart) {
      const d = new Date(versionIntegrationStart);
      setIntegrationStart(d.toISOString().split('T')[0]);
    }
    if (versionIntegrationEnd) {
      const d = new Date(versionIntegrationEnd);
      setIntegrationEnd(d.toISOString().split('T')[0]);
    }
  }, [versionIntegrationStart, versionIntegrationEnd]);

  // ── Fetch work plan ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!versionId) return;
    setWorkPlan(null);
    setComputed(false);
    setActivities([]);
    setBoardSaved(false);
    setLoadingPlan(true);
    Promise.all([
      axios.get(`${API}/qa/workplan?versionId=${versionId}`, { headers }).catch(() => null),
      axios.get(`${API}/activity-board/${versionId}`, { headers }).catch(() => null),
    ]).then(([wpRes, boardRes]) => {
      if (wpRes) setWorkPlan(wpRes.data);
      if (boardRes && boardRes.data?.length > 0) {
        setActivities((boardRes.data as any[]).map(savedToItem));
        setBoardSaved(true);
        setComputed(true);
      }
    }).finally(() => setLoadingPlan(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId]);

  // ── Derived inputs from work plan ────────────────────────────────────────────

  const test1Start  = workPlan?.cycle1Start ? parseDate(workPlan.cycle1Start) : null;
  const lastTestEnd = workPlan?.testingEnd  ? parseDate(workPlan.testingEnd)  : null;
  const cycle1End   = (() => {
    const c1 = workPlan?.cycles?.find(c => c.cycleType === 'CYCLE_1');
    return c1?.plannedEnd ? parseDate(c1.plannedEnd) : null;
  })();
  const cycle2Start = (() => {
    const c2 = workPlan?.cycles?.find(c => c.cycleType === 'CYCLE_2');
    return c2?.plannedStart ? parseDate(c2.plannedStart) : null;
  })();
  const cycle2End = (() => {
    const c2 = workPlan?.cycles?.find(c => c.cycleType === 'CYCLE_2');
    return c2?.plannedEnd ? parseDate(c2.plannedEnd) : null;
  })();

  // ── Compute ──────────────────────────────────────────────────────────────────

  const canCompute = !!test1Start && !!lastTestEnd && !!cycle2End && !!integrationEnd;

  const handleCompute = () => {
    if (!canCompute) return;
    const intStart = integrationStart ? parseDate(integrationStart) : null;
    const intEnd   = parseDate(integrationEnd);
    const result   = buildSchedule(
      intStart, intEnd, test1Start!, cycle1End, cycle2Start, cycle2End!, lastTestEnd!,
      manualDelay, envInt, envQA, envDry, holidayDays,
    );
    setActivities(result.activities);
    setWarnings(result.warnings);
    setComputed(true);
    setBoardSaved(false);
  };

  const handleSaveBoard = async () => {
    if (!versionId || activities.length === 0) return;
    setSaving(true);
    try {
      const entries = activities.map((a, i) => ({
        activityKey:   a.id,
        label:         a.label,
        owner:         a.owner,
        ownerEmployee: a.ownerEmployee,
        notes:         a.notes,
        attendees:     a.attendees,
        category:      a.category,
        dateStart:     a.dateStartISO || null,
        dateEnd:       a.dateEndISO   || null,
        sortOrder:     i,
        isRelevant:    a.isRelevant,
        isCustom:      a.isCustom,
      }));
      const res = await axios.post(`${API}/activity-board/${versionId}/save`, { entries }, { headers });
      setActivities(res.data.map(savedToItem));
      setBoardSaved(true);

      // Sync dates back to the version automatically
      const crReview = activities.find(a => a.id === 'cr_review');
      const runbook  = activities.find(a => a.id === 'runbook');
      const versionPatch: Record<string, string | null> = {};
      if (crReview?.dateStartISO) versionPatch.reviewMeetingTime   = crReview.dateStartISO;
      if (runbook?.dateStartISO)  versionPatch.workPlanMeetingTime = runbook.dateStartISO;
      // Sync integration/QA dates if changed in the board UI
      if (integrationStart) versionPatch.integrationStart = integrationStart;
      if (integrationEnd)   versionPatch.integrationEnd   = integrationEnd;
      if (Object.keys(versionPatch).length > 0) {
        await axios.patch(`${API}/versions/${versionId}`, versionPatch, { headers }).catch(() => {});
      }
    } finally {
      setSaving(false);
    }
  };

  // Deletes every activity-board entry for this version — the granular
  // counterpart to the old whole-version delete.
  const [deletingBoard, setDeletingBoard] = useState(false);
  const handleDeleteBoard = async () => {
    if (!versionId) return;
    if (!await dialog.confirm('למחוק את כל לוח הפעילויות לצמיתות? ניתן לחשב מחדש מאפס בכל עת.', 'מחיקת לוח פעילויות', 'danger')) return;
    setDeletingBoard(true);
    try {
      await axios.delete(`${API}/activity-board/${versionId}`, { headers });
      setActivities([]);
      setBoardSaved(false);
    } finally {
      setDeletingBoard(false);
    }
  };

  const handleLoadBoard = async () => {
    if (!versionId) return;
    const res = await axios.get(`${API}/activity-board/${versionId}`, { headers });
    if (res.data.length > 0) {
      setActivities(res.data.map(savedToItem));
      setBoardSaved(true);
      setComputed(true);
    }
  };

  const handlePatchEntry = async (dbId: string, patch: Partial<ActivityItem>) => {
    const res = await axios.patch(`${API}/activity-board/entry/${dbId}`, patch, { headers });
    setActivities(prev => prev.map(a => a.dbId === dbId ? { ...a, ...patch, dbId: res.data.id } : a));
  };

  const handleInlineSave = (item: ActivityItem, owner: string, emp: string) => {
    const patch = { owner, ownerEmployee: emp };
    setActivities(prev => prev.map(a => a.id === item.id ? { ...a, ...patch } : a));
    if (item.dbId) handlePatchEntry(item.dbId, patch as any);
  };

  const handleToggleRelevant = (item: ActivityItem) => {
    const next = !item.isRelevant;
    setActivities(prev => prev.map(a => a.id === item.id ? { ...a, isRelevant: next } : a));
    if (item.dbId) handlePatchEntry(item.dbId, { isRelevant: next } as any);
  };

  const handleEditSave = async () => {
    if (!editingId) return;
    const item = activities.find(a => a.id === editingId);
    if (!item) return;
    // Recompute display labels if dates changed
    const startISO = (editDraft as any).dateStartISO ?? item.dateStartISO;
    const endISO   = (editDraft as any).dateEndISO   ?? item.dateEndISO;
    const updated: ActivityItem = {
      ...item,
      ...editDraft,
      dateStartISO:   startISO,
      dateEndISO:     endISO,
      dateStartLabel: startISO ? fmtDate(new Date(startISO)) : item.dateStartLabel,
      dateEndLabel:   endISO   ? fmtDate(new Date(endISO))   : item.dateEndLabel,
      sortKey:        startISO ? new Date(startISO).getTime() : item.sortKey,
    };
    setActivities(prev => prev.map(a => a.id === editingId ? updated : a));
    if (item.dbId) {
      const { dateStartISO: ds, dateEndISO: de, ...rest } = editDraft as any;
      await handlePatchEntry(item.dbId, {
        ...rest,
        ...(ds !== undefined && { dateStart: ds || null }),
        ...(de !== undefined && { dateEnd:   de || null }),
      });
    }
    // Sync meeting dates to version when editing cr_review / runbook
    if (versionId && (editingId === 'cr_review' || editingId === 'runbook') && (editDraft as any).dateStartISO !== undefined) {
      const field = editingId === 'cr_review' ? 'reviewMeetingTime' : 'workPlanMeetingTime';
      await axios.patch(`${API}/versions/${versionId}`, { [field]: startISO || null }, { headers }).catch(() => {});
    }
    setEditingId(null);
    setEditDraft({});
  };

  const handleAddCustom = async () => {
    if (!addDraft.label.trim()) return;
    const newItem: ActivityItem = {
      id:             `custom_${Date.now()}`,
      sortKey:        Date.now(),
      dateStartLabel: '—', dateEndLabel: '—',
      dateStartISO:   '', dateEndISO: '',
      label:          addDraft.label,
      owner:          addDraft.owner,
      ownerEmployee:  addDraft.ownerEmployee,
      attendees:      [],
      notes:          addDraft.notes,
      category:       addDraft.category,
      isRelevant:     true,
      isCustom:       true,
    };
    setActivities(prev => [...prev, newItem]);
    setAddDraft({ label: '', owner: '', ownerEmployee: '', category: 'other', notes: '' });
    setShowAddForm(false);
  };

  const handleBulkReplaceTeam = async () => {
    if (!repTeamFrom.trim() || !versionId) return;
    setActivities(prev => prev.map(a => ({
      ...a,
      owner:     a.owner === repTeamFrom ? repTeamTo : a.owner,
      attendees: a.attendees.map(x => x === repTeamFrom ? repTeamTo : x),
    })));
    if (boardSaved) {
      await axios.post(`${API}/activity-board/${versionId}/bulk-replace`,
        { from: repTeamFrom, to: repTeamTo }, { headers });
    }
    setRepTeamFrom(''); setRepTeamTo('');
  };

  const handleBulkReplaceEmp = async () => {
    if (!repEmpFrom.trim()) return;
    const updated = activities.map(a => ({
      ...a,
      ownerEmployee: a.ownerEmployee === repEmpFrom ? repEmpTo : a.ownerEmployee,
    }));
    setActivities(updated);
    setRepEmpFrom(''); setRepEmpTo('');
    if (boardSaved) {
      setSaving(true);
      try {
        const entries = updated.map((a, i) => ({
          activityKey: a.id, label: a.label, owner: a.owner,
          ownerEmployee: a.ownerEmployee, notes: a.notes, attendees: a.attendees,
          category: a.category, dateStart: a.dateStartISO || null,
          dateEnd: a.dateEndISO || null, sortOrder: i,
          isRelevant: a.isRelevant, isCustom: a.isCustom,
        }));
        await axios.post(`${API}/activity-board/${versionId}/save`, { entries }, { headers });
      } finally { setSaving(false); }
    }
  };

  // ── Styles ───────────────────────────────────────────────────────────────────

  const rowHighlight = (h?: ActivityItem['highlight']) => {
    if (h === 'golive')  return { background: 'rgba(34,197,94,0.07)', borderRight: `3px solid ${C.success}` };
    if (h === 'billing') return { background: 'rgba(234,179,8,0.06)', borderRight: `3px solid ${C.warning}` };
    return {};
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!versionId) {
    return (
      <div style={{ padding: SP[8], textAlign: 'center', color: C.textMuted, ...TEXT.sm }}>
        בחר גרסה כדי לצפות בלוח הפעילויות
      </div>
    );
  }

  return (
    <div style={{ direction: 'rtl' }}>

      {/* ── Input card ── */}
      <div style={{
        background: C.bgCard, border: `1px solid ${C.border}`,
        borderRadius: RADIUS.lg, padding: SP[4], marginBottom: SP[4], boxShadow: SHADOW.sm,
      }}>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, marginBottom: SP[3], color: C.textPrimary }}>
          פרמטרי תוכנית
        </div>

        {/* ── שורה 1: תאריכים ────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: SP[4], alignItems: 'flex-end', marginBottom: SP[3] }}>

          {/* Integration Start */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              תחילת אינטגרציה
            </span>
            <DateField
              value={integrationStart}
              onChange={v => { setIntegrationStart(v); setComputed(false); }}
              style={{
                padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`,
                background: C.bgNested, color: C.textPrimary, fontFamily: FONT, ...TEXT.sm,
                outline: 'none', cursor: 'pointer',
              }}
            />
          </label>

          {/* Integration End */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              סיום אינטגרציה *
            </span>
            <DateField
              value={integrationEnd}
              onChange={v => { setIntegrationEnd(v); setComputed(false); }}
              style={{
                padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`,
                background: C.bgNested, color: C.textPrimary, fontFamily: FONT, ...TEXT.sm,
                outline: 'none', cursor: 'pointer',
              }}
            />
          </label>

          {/* Manual delay */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              עיכוב ידני (י"ע)
            </span>
            <input
              type="number"
              min={0} max={30}
              value={manualDelay}
              onChange={e => { setManualDelay(Number(e.target.value)); setComputed(false); }}
              style={{
                padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`,
                background: C.bgNested, color: C.textPrimary, fontFamily: FONT, ...TEXT.sm,
                outline: 'none', width: 70, textAlign: 'center',
              }}
            />
          </label>

          {/* Read-only derived fields */}
          <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
            {[
              { label: 'תחילת סבב 1', val: test1Start  ? fmtDate(test1Start)  : '—' },
              { label: 'סיום סבב 1',  val: cycle1End   ? fmtDate(cycle1End)   : '—' },
              { label: 'תחילת סבב 2', val: cycle2Start ? fmtDate(cycle2Start) : '—' },
              { label: 'סיום סבב 2',  val: cycle2End   ? fmtDate(cycle2End)   : '—' },
              { label: 'סיום בדיקות', val: lastTestEnd ? fmtDate(lastTestEnd) : '—' },
            ].map(({ label, val }) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {label}
                </span>
                <span style={{
                  padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`,
                  background: C.bgNested, color: C.textMuted, ...TEXT.sm,
                }}>
                  {loadingPlan ? '...' : val}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── שורה 2: סביבות ─────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: SP[4], alignItems: 'flex-end' }}>
          {([
            { label: 'בדיקות אינטגרציה בסביבת', val: envInt, set: setEnvInt },
            { label: 'בדיקות QA בסביבת',          val: envQA,  set: setEnvQA  },
            { label: 'חזרה גנרלית בסביבת',         val: envDry, set: setEnvDry },
          ] as { label: string; val: EnvName; set: (v: EnvName) => void }[]).map(({ label, val, set }) => (
            <label key={label} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {label}
              </span>
              <select
                value={val}
                onChange={e => { set(e.target.value as EnvName); setComputed(false); }}
                style={{
                  padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`,
                  background: C.bgNested, color: C.textPrimary, fontFamily: FONT, ...TEXT.sm,
                  outline: 'none', cursor: 'pointer',
                }}
              >
                <option value="אינטגרציה">אינטגרציה</option>
                <option value="טסט">טסט</option>
              </select>
            </label>
          ))}

          {/* Compute button */}
          <button
            onClick={handleCompute}
            disabled={!canCompute}
            style={{
              padding: `${SP[2]} ${SP[5]}`, borderRadius: RADIUS.md,
              border: 'none', background: canCompute ? BLUE : C.bgHover,
              color: canCompute ? '#fff' : C.textDisabled,
              fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.bold,
              cursor: canCompute ? 'pointer' : 'not-allowed', transition: EASE.fast,
            }}
          >
            ▶ חשב לוח פעילויות
          </button>

          {/* Save board */}
          {computed && (
            <button onClick={handleSaveBoard} disabled={saving} style={{
              padding: `${SP[2]} ${SP[4]}`, borderRadius: RADIUS.md,
              border: `1px solid ${boardSaved ? C.success : C.border}`,
              background: boardSaved ? C.successBg : C.bgNested,
              color: boardSaved ? C.success : C.textPrimary,
              fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.semibold,
              cursor: saving ? 'wait' : 'pointer', transition: EASE.fast,
            }}>
              {saving ? '...' : boardSaved ? '✓ לוח שמור' : '💾 שמור לוח'}
            </button>
          )}

          {/* Delete board */}
          {boardSaved && (
            <button onClick={handleDeleteBoard} disabled={deletingBoard} style={{
              padding: `${SP[2]} ${SP[4]}`, borderRadius: RADIUS.md,
              border: `1px solid ${C.danger}55`, background: 'transparent', color: C.danger,
              fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.semibold,
              cursor: deletingBoard ? 'wait' : 'pointer', transition: EASE.fast,
              opacity: deletingBoard ? 0.6 : 1,
            }}>
              {deletingBoard ? '⏳ מוחק...' : '🗑 מחק לוח פעילויות'}
            </button>
          )}

          {/* Bulk replace */}
          {boardSaved && (
            <button onClick={() => setShowBulkReplace(v => !v)} style={{
              padding: `${SP[2]} ${SP[4]}`, borderRadius: RADIUS.md,
              border: `1px solid ${C.border}`, background: C.bgNested,
              color: C.textPrimary, fontFamily: FONT, ...TEXT.sm,
              cursor: 'pointer', transition: EASE.fast,
            }}>
              👥 החלפת עובד
            </button>
          )}
        </div>

        {/* Bulk replace panel */}
        {showBulkReplace && (() => {
          const selSm: React.CSSProperties = {
            padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md,
            border: `1px solid ${C.border}`, background: C.bgCard,
            color: C.textPrimary, fontFamily: FONT, ...TEXT.sm, outline: 'none', minWidth: 170,
          };
          const btnStyle = (active: boolean): React.CSSProperties => ({
            padding: `${SP[2]} ${SP[4]}`, borderRadius: RADIUS.md, border: 'none',
            background: active ? BLUE : C.bgHover, color: active ? '#fff' : C.textDisabled,
            fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.bold,
            cursor: active ? 'pointer' : 'not-allowed',
          });
          const distinctOwners  = Array.from(new Set(activities.map(a => a.owner).filter(Boolean)));
          const distinctEmps    = Array.from(new Set(activities.map(a => a.ownerEmployee).filter(Boolean)));
          const allEmps         = teams.flatMap(t => t.members.map(m => ({ id: m.user.id, fullName: m.user.fullName })));
          return (
            <div style={{ marginTop: SP[3], padding: SP[3], background: C.bgNested, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: SP[3] }}>

              {/* Team replacement row */}
              <div style={{ display: 'flex', gap: SP[2], alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold, minWidth: 42 }}>צוות:</span>
                <select value={repTeamFrom} onChange={e => setRepTeamFrom(e.target.value)} style={selSm}>
                  <option value="">— בחר צוות להחלפה —</option>
                  {distinctOwners.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <span style={{ ...TEXT.xs, color: C.textMuted }}>→</span>
                <select value={repTeamTo} onChange={e => setRepTeamTo(e.target.value)} style={selSm}>
                  <option value="">— בחר צוות חדש —</option>
                  {displayTeams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
                <button onClick={handleBulkReplaceTeam} disabled={!repTeamFrom.trim()} style={btnStyle(!!repTeamFrom.trim())}>
                  החלף
                </button>
              </div>

              {/* Employee replacement row */}
              <div style={{ display: 'flex', gap: SP[2], alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold, minWidth: 42 }}>עובד:</span>
                <select value={repEmpFrom} onChange={e => setRepEmpFrom(e.target.value)} style={selSm}>
                  <option value="">— בחר עובד להחלפה —</option>
                  {distinctEmps.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
                <span style={{ ...TEXT.xs, color: C.textMuted }}>→</span>
                <select value={repEmpToTeam} onChange={e => { setRepEmpToTeam(e.target.value); setRepEmpTo(''); }} style={selSm}>
                  <option value="">— סנן לפי צוות —</option>
                  {displayTeams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
                <select value={repEmpTo} onChange={e => setRepEmpTo(e.target.value)} style={selSm}>
                  <option value="">— בחר עובד חדש —</option>
                  {(repEmpToTeam
                    ? teams.filter(t => t.name === repEmpToTeam).flatMap(t => t.members.map(m => ({ id: m.user.id, fullName: m.user.fullName })))
                    : allEmps
                  ).map(m => <option key={m.id} value={m.fullName}>{m.fullName}</option>)}
                </select>
                <button onClick={handleBulkReplaceEmp} disabled={!repEmpFrom.trim()} style={btnStyle(!!repEmpFrom.trim())}>
                  החלף
                </button>
              </div>
            </div>
          );
        })()}

        {/* Missing workplan notice */}
        {!loadingPlan && !workPlan && (
          <div style={{ marginTop: SP[3], ...TEXT.xs, color: C.warning }}>
            ⚠️ לא נמצאה תוכנית עבודה לגרסה זו. צור תוכנית בלשונית "תוכנית עבודה" כדי לאפשר חישוב אוטומטי של התאריכים.
          </div>
        )}
        {!loadingPlan && workPlan && !cycle2End && (
          <div style={{ marginTop: SP[3], ...TEXT.xs, color: C.warning }}>
            ⚠️ לא נמצא תאריך סיום לסבב 2. ודא שתוכנית העבודה כוללת CYCLE_2 עם תאריך סיום.
          </div>
        )}
      </div>

      {/* ── Warnings ── */}
      {computed && warnings.length > 0 && (
        <div style={{
          background: C.warningBg, border: `1px solid ${C.warning}44`,
          borderRadius: RADIUS.md, padding: SP[3], marginBottom: SP[3],
        }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ ...TEXT.sm, color: C.warning }}>{w}</div>
          ))}
        </div>
      )}

      {/* ── Activity table ── */}
      {computed && activities.length > 0 && (
        <div style={{
          background: C.bgCard, border: `1px solid ${C.border}`,
          borderRadius: RADIUS.lg, overflow: 'hidden', boxShadow: SHADOW.sm,
        }}>

          {/* ── Filter chips ── */}
          <div style={{
            padding: `${SP[2]} ${SP[4]}`, borderBottom: `1px solid ${C.border}`,
            display: 'flex', gap: SP[2], flexWrap: 'wrap', alignItems: 'center', background: C.bgNested,
          }}>
            {(Object.keys(CAT_LABELS) as (keyof typeof CAT_LABELS)[]).map(cat => (
              <button key={cat} onClick={() => setFilterCat(cat)} style={{
                padding: `2px 10px`, borderRadius: RADIUS.full,
                border: `1px solid ${filterCat === cat ? BLUE : C.border}`,
                background: filterCat === cat ? 'rgba(69,115,210,0.12)' : C.bgCard,
                color: filterCat === cat ? BLUE : C.textMuted,
                fontFamily: FONT, ...TEXT.xs, fontWeight: filterCat === cat ? WEIGHT.bold : WEIGHT.normal,
                cursor: 'pointer', transition: EASE.fast,
              }}>
                {CAT_LABELS[cat]}
              </button>
            ))}
            <span style={{ ...TEXT.xs, color: C.textMuted, marginRight: 'auto' }}>
              <span style={{ color: C.success }}>■</span> עלייה לאוויר &nbsp;
              <span style={{ color: C.warning }}>■</span> בילינג &nbsp;
              <span style={{ color: C.textDisabled }}>■</span> לא רלוונטי
            </span>
          </div>

          {/* Table header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '120px 120px 1fr 110px 130px 168px',
            padding: `${SP[2]} ${SP[4]}`, borderBottom: `1px solid ${C.border}`,
            background: C.bgNested,
          }}>
            {['תאריך התחלה', 'תאריך סיום', 'פעילות', 'צוות אחראי', 'שם עובד', ''].map((h, i) => (
              <div key={i} style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</div>
            ))}
          </div>

          {/* Rows */}
          {activities
            .filter(a => filterCat === 'all' || a.category === filterCat)
            .map(a => {
              const expanded = expandedId === a.id;
              const editing  = editingId === a.id;
              const rowStyle: React.CSSProperties = {
                borderBottom: `1px solid ${C.border}44`,
                opacity: a.isRelevant ? 1 : 0.45,
                ...rowHighlight(a.highlight),
              };
              return (
                <div key={a.id} style={rowStyle}>

                  {/* Edit mode */}
                  {editing ? (
                    <div style={{ padding: `${SP[3]} ${SP[4]}`, background: C.bgActive, display: 'flex', flexDirection: 'column', gap: SP[2] }}>
                      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
                        <label style={{ flex: 2, minWidth: 200, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold }}>כותרת</span>
                          <input value={editDraft.label ?? a.label}
                            onChange={e => setEditDraft(d => ({ ...d, label: e.target.value }))}
                            style={{ padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgCard, color: C.textPrimary, fontFamily: FONT, ...TEXT.sm, outline: 'none' }} />
                        </label>
                        <label style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold }}>צוות ועובד אחראי</span>
                          <OwnerPicker
                            teams={displayTeams}
                            teamValue={editDraft.owner ?? a.owner}
                            employeeValue={editDraft.ownerEmployee ?? a.ownerEmployee}
                            onChange={(team, emp) => setEditDraft(d => ({ ...d, owner: team, ownerEmployee: emp }))}
                          />
                        </label>
                        <label style={{ flex: 1, minWidth: 120, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold }}>קטגוריה</span>
                          <select value={editDraft.category ?? a.category}
                            onChange={e => setEditDraft(d => ({ ...d, category: e.target.value }))}
                            style={{ padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgCard, color: C.textPrimary, fontFamily: FONT, ...TEXT.sm, outline: 'none' }}>
                            {(Object.entries(CAT_LABELS) as [string, string][]).filter(([k]) => k !== 'all').map(([k, v]) => (
                              <option key={k} value={k}>{v}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold }}>תאריך התחלה</span>
                          <DateField
                            value={((editDraft as any).dateStartISO ?? a.dateStartISO ?? '').slice(0, 10)}
                            onChange={v => setEditDraft(d => ({ ...d, dateStartISO: v } as any))}
                            style={{ padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgCard, color: C.textPrimary, fontFamily: FONT, ...TEXT.sm, outline: 'none' }} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold }}>תאריך סיום</span>
                          <DateField
                            value={((editDraft as any).dateEndISO ?? a.dateEndISO ?? '').slice(0, 10)}
                            onChange={v => setEditDraft(d => ({ ...d, dateEndISO: v } as any))}
                            style={{ padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgCard, color: C.textPrimary, fontFamily: FONT, ...TEXT.sm, outline: 'none' }} />
                        </label>
                      </div>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold }}>הערות</span>
                        <textarea value={editDraft.notes ?? a.notes} rows={2}
                          onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))}
                          style={{ padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgCard, color: C.textPrimary, fontFamily: FONT, ...TEXT.sm, outline: 'none', resize: 'vertical' }} />
                      </label>
                      <div style={{ display: 'flex', gap: SP[2] }}>
                        <button onClick={handleEditSave} style={{ padding: `${SP[1]} ${SP[4]}`, borderRadius: RADIUS.md, border: 'none', background: BLUE, color: '#fff', fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.bold, cursor: 'pointer' }}>שמור</button>
                        <button onClick={() => { setEditingId(null); setEditDraft({}); }} style={{ padding: `${SP[1]} ${SP[4]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textMuted, fontFamily: FONT, ...TEXT.sm, cursor: 'pointer' }}>ביטול</button>
                      </div>
                    </div>
                  ) : (
                    /* Normal view row */
                    <div
                      onClick={() => { if (inlineId === a.id) { setInlineId(null); return; } setExpandedId(expanded ? null : a.id); }}
                      style={{ display: 'grid', gridTemplateColumns: '120px 120px 1fr 110px 130px 168px', padding: `${SP[2]} ${SP[4]}`, cursor: 'pointer', transition: EASE.fast, alignItems: 'center' }}
                      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = C.bgHover}
                      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
                    >
                      <span style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{a.dateStartLabel}</span>
                      <span style={{ ...TEXT.sm, color: C.textMuted }}>{a.dateEndLabel}</span>
                      <span style={{ ...TEXT.sm, color: a.isRelevant ? C.textPrimary : C.textMuted, textDecoration: a.isRelevant ? 'none' : 'line-through' }}>{a.label}</span>

                      {/* צוות — inline editable */}
                      {inlineId === a.id ? (
                        <select
                          value={inlineDraft.owner}
                          onClick={e => e.stopPropagation()}
                          onChange={e => {
                            const owner = e.target.value;
                            setInlineDraft({ owner, ownerEmployee: '' });
                            handleInlineSave(a, owner, '');
                          }}
                          style={inputStyle({ ...TEXT.xs, padding: '2px 4px' })}
                        >
                          <option value="">-- צוות --</option>
                          {displayTeams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                        </select>
                      ) : (
                        <span
                          onClick={e => { e.stopPropagation(); setInlineId(a.id); setInlineDraft({ owner: a.owner, ownerEmployee: a.ownerEmployee }); }}
                          title="לחץ לשינוי צוות"
                          style={{ ...TEXT.xs, color: C.textMuted, cursor: 'text', borderBottom: `1px dashed ${C.border}` }}
                        >
                          {a.owner || '—'}
                        </span>
                      )}

                      {/* עובד — inline editable */}
                      {inlineId === a.id ? (() => {
                        const matched = displayTeams.find(t => t.name === inlineDraft.owner);
                        const members = (matched?.members ?? []).map((m: TeamMember) => m.user);
                        return members.length > 0 ? (
                          <select
                            value={inlineDraft.ownerEmployee}
                            onClick={e => e.stopPropagation()}
                            onChange={e => {
                              const emp = e.target.value;
                              setInlineDraft(d => ({ ...d, ownerEmployee: emp }));
                              handleInlineSave(a, inlineDraft.owner, emp);
                            }}
                            style={inputStyle({ ...TEXT.xs, padding: '2px 4px' })}
                          >
                            <option value="">-- עובד --</option>
                            {members.map(m => <option key={m.id} value={m.fullName}>{m.fullName}</option>)}
                          </select>
                        ) : (
                          <input
                            value={inlineDraft.ownerEmployee}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setInlineDraft(d => ({ ...d, ownerEmployee: e.target.value }))}
                            onBlur={e => handleInlineSave(a, inlineDraft.owner, e.target.value)}
                            placeholder="שם עובד"
                            style={inputStyle({ ...TEXT.xs, padding: '2px 4px' })}
                          />
                        );
                      })() : (
                        <span
                          onClick={e => { e.stopPropagation(); setInlineId(a.id); setInlineDraft({ owner: a.owner, ownerEmployee: a.ownerEmployee }); }}
                          title="לחץ לשינוי עובד"
                          style={{ ...TEXT.xs, color: a.ownerEmployee ? C.textPrimary : C.textDisabled, fontStyle: a.ownerEmployee ? 'normal' : 'italic', cursor: 'text', borderBottom: `1px dashed ${C.border}` }}
                        >
                          {a.ownerEmployee || '—'}
                        </span>
                      )}

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: SP[1] }} onClick={e => e.stopPropagation()}>
                        {/* Runbook button — only for applicable activities */}
                        {(() => {
                          const trigger = getRunbookTrigger(a.id);
                          return trigger ? (
                            <button
                              onClick={() => setRunbookItem({ trigger, dateStartISO: a.dateStartISO })}
                              title="פתח תוכנית היערכות"
                              style={{ padding: '3px 8px', borderRadius: RADIUS.md, border: `1px solid ${BLUE}44`, background: 'rgba(69,115,210,0.08)', color: BLUE, fontFamily: FONT, ...TEXT.xs, cursor: 'pointer', fontWeight: WEIGHT.bold }}>
                              📋
                            </button>
                          ) : null;
                        })()}
                        <button
                          onClick={() => { setInlineId(a.id); setInlineDraft({ owner: a.owner, ownerEmployee: a.ownerEmployee }); }}
                          title="החלף עובד"
                          style={{ padding: '3px 8px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textMuted, fontFamily: FONT, ...TEXT.xs, cursor: 'pointer' }}>👤</button>
                        <button onClick={() => { setEditingId(a.id); setEditDraft({}); }}
                          title="ערוך" style={{ padding: '3px 8px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textMuted, fontFamily: FONT, ...TEXT.xs, cursor: 'pointer' }}>✏️</button>
                        <button onClick={() => handleToggleRelevant(a)}
                          title={a.isRelevant ? 'סמן כלא רלוונטי' : 'החזר לרלוונטי'}
                          style={{ padding: '3px 8px', borderRadius: RADIUS.md, border: `1px solid ${a.isRelevant ? C.border : C.warning}`, background: a.isRelevant ? C.bgNested : C.warningBg, color: a.isRelevant ? C.textMuted : C.warning, fontFamily: FONT, ...TEXT.xs, cursor: 'pointer' }}>
                          {a.isRelevant ? '🚫' : '✓'}
                        </button>
                        <button
                          onClick={() => setInviteItem(a)}
                          disabled={!a.dbId}
                          title={a.dbId ? 'קבע פגישה ביומן' : 'יש לשמור את הפעילות תחילה'}
                          style={{ padding: '3px 8px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: a.dbId ? C.textMuted : C.textDisabled, fontFamily: FONT, ...TEXT.xs, cursor: a.dbId ? 'pointer' : 'not-allowed', opacity: a.dbId ? 1 : 0.6 }}>
                          📅
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Expanded details */}
                  {expanded && !editing && (
                    <div style={{ padding: `${SP[2]} ${SP[4]} ${SP[3]}`, background: C.bgNested, borderTop: `1px solid ${C.border}22`, display: 'flex', flexDirection: 'column', gap: SP[2] }}>
                      <div style={{ ...TEXT.xs, color: C.textMuted }}>
                        <strong style={{ color: C.textPrimary }}>הערות:</strong> {a.notes}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SP[1] }}>
                        <span style={{ ...TEXT.xs, color: C.textMuted, alignSelf: 'center' }}><strong style={{ color: C.textPrimary }}>מוזמנים:</strong></span>
                        {a.attendees.map(email => (
                          <span key={email} style={{ background: C.bgHover, border: `1px solid ${C.border}`, borderRadius: RADIUS.full, padding: `1px 8px`, ...TEXT.xs, color: C.textMuted }}>{email}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

          {/* Add custom activity */}
          {showAddForm ? (
            <div style={{ padding: `${SP[3]} ${SP[4]}`, borderTop: `1px solid ${C.border}`, background: C.bgActive, display: 'flex', flexDirection: 'column', gap: SP[2] }}>
              <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
                <label style={{ flex: 2, minWidth: 200, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold }}>כותרת *</span>
                  <input value={addDraft.label} onChange={e => setAddDraft(d => ({ ...d, label: e.target.value }))} placeholder="שם הפעילות"
                    style={{ padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgCard, color: C.textPrimary, fontFamily: FONT, ...TEXT.sm, outline: 'none' }} />
                </label>
                <label style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold }}>צוות ועובד אחראי</span>
                  <OwnerPicker
                    teams={displayTeams}
                    teamValue={addDraft.owner}
                    employeeValue={addDraft.ownerEmployee}
                    onChange={(team, emp) => setAddDraft(d => ({ ...d, owner: team, ownerEmployee: emp }))}
                  />
                </label>
                <label style={{ flex: 1, minWidth: 120, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold }}>קטגוריה</span>
                  <select value={addDraft.category} onChange={e => setAddDraft(d => ({ ...d, category: e.target.value }))}
                    style={{ padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgCard, color: C.textPrimary, fontFamily: FONT, ...TEXT.sm, outline: 'none' }}>
                    {(Object.entries(CAT_LABELS) as [string, string][]).filter(([k]) => k !== 'all').map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold }}>הערות</span>
                <input value={addDraft.notes} onChange={e => setAddDraft(d => ({ ...d, notes: e.target.value }))}
                  style={{ padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgCard, color: C.textPrimary, fontFamily: FONT, ...TEXT.sm, outline: 'none' }} />
              </label>
              <div style={{ display: 'flex', gap: SP[2] }}>
                <button onClick={handleAddCustom} disabled={!addDraft.label.trim()} style={{ padding: `${SP[1]} ${SP[4]}`, borderRadius: RADIUS.md, border: 'none', background: addDraft.label.trim() ? BLUE : C.bgHover, color: addDraft.label.trim() ? '#fff' : C.textDisabled, fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.bold, cursor: addDraft.label.trim() ? 'pointer' : 'not-allowed' }}>הוסף</button>
                <button onClick={() => setShowAddForm(false)} style={{ padding: `${SP[1]} ${SP[4]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textMuted, fontFamily: FONT, ...TEXT.sm, cursor: 'pointer' }}>ביטול</button>
              </div>
            </div>
          ) : (
            <div style={{ padding: `${SP[2]} ${SP[4]}`, borderTop: `1px solid ${C.border}`, background: C.bgNested, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button onClick={() => setShowAddForm(true)} style={{ padding: `${SP[1]} ${SP[3]}`, borderRadius: RADIUS.md, border: `1px dashed ${C.border}`, background: 'transparent', color: C.textMuted, fontFamily: FONT, ...TEXT.xs, cursor: 'pointer' }}>
                + הוסף פעילות
              </button>
              <span style={{ ...TEXT.xs, color: C.textMuted }}>
                סה"כ {activities.filter(a => filterCat === 'all' || a.category === filterCat).length} פעילויות
                {activities.filter(a => !a.isRelevant).length > 0 && ` • ${activities.filter(a => !a.isRelevant).length} לא רלוונטיות`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Empty state after compute with no results */}
      {computed && activities.length === 0 && (
        <div style={{ textAlign: 'center', padding: SP[8], color: C.textMuted, ...TEXT.sm }}>
          לא נמצאו פעילויות — בדוק את הפרמטרים שהוזנו
        </div>
      )}

      {/* Runbook modal */}
      {runbookItem && (
        <RunbookModal
          trigger={runbookItem.trigger}
          dateStartISO={runbookItem.dateStartISO}
          versionId={versionId}
          token={token}
          startInRunMode
          onClose={() => setRunbookItem(null)}
        />
      )}

      {/* Calendar invite dialog */}
      {inviteItem && (
        <InviteDialog
          title={inviteItem.label}
          subtitle={[inviteItem.owner, inviteItem.ownerEmployee].filter(Boolean).join(' · ')}
          startISO={inviteItem.dateStartISO || null}
          endISO={inviteItem.dateEndISO || inviteItem.dateStartISO || null}
          teams={inviteTeams}
          preSelectedEmails={inviteItem.attendees}
          onSend={handleSendInvite}
          onClose={() => setInviteItem(null)}
        />
      )}
    </div>
  );
}
