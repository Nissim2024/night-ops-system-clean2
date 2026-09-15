import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { cn } from '../../lib/utils';
import { formatDate } from '../../utils/dateFormat';
import { DefectDrilldownModal } from './DefectDrilldownModal';
import { PersonAvatar } from '../shared/defectFieldDisplay';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Redesigned 2026-09-03 — was a flat per-CR table with a single health flag.
// New structure: exec summary, per-tester heat map, per-CR risk list, and
// auto-alerts, built for the actual daily-standup use case ("30 seconds to
// know if the release is at risk, who's stuck, what needs escalation").
// Backed by release-intelligence.service.ts's redesigned getDailyQaManagement
// (same endpoint, entirely new shape) — see that method's own comment for
// why "Risk" here is a deliberately separate metric from Quality Gate/CR
// Quality Score/the coverage card's blocked-CR list.

interface DailySummary {
  testProgressPct: number; passed: number; failed: number; blocked: number;
  openDefects: number; criticalDefects: number; openBlockers: number;
  crsAtRisk: number; testersNoProgress: number;
}
interface DailyCrRow {
  crNumber: string; crLabel: string; tester: string | null;
  progressPct: number; defectCount: number; blockerCount: number;
  risk: 'HIGH' | 'MEDIUM' | 'LOW'; reasons: string[];
  teams: { id: string; name: string }[];
  passed: number; failed: number; total: number; remaining: number;
  passedDelta: number | null; dailyTarget: number | null; mustFinishNow: boolean;
}
interface DailyTesterRow {
  tester: string; progressPct: number; crCount: number; defectCount: number; blockerCount: number;
  status: 'GOOD' | 'WARNING' | 'CRITICAL'; crs: { crNumber: string; crLabel: string; progressPct: number }[];
  doneToday: number | null; dailyTarget: number;
}
interface DailyTargetsMeta {
  targetDay: 'today' | 'tomorrow'; standupCutoff: string; workDaysLeft: number | null;
  deadline: string | null; deadlineCycle: string | null; deadlineIsGoLive: boolean;
  hasSnapshot: boolean; snapshotDate: string | null;
}
type HealthRecommendation = 'GO' | 'CONDITIONAL_GO' | 'NO_GO';
interface ReleaseHealthInfo {
  score: number; recommendation: HealthRecommendation;
  breakdown: { coverageScore: number; qualityScore: number; riskScore: number; forecastScore: number };
  calculatedAt: string;
}
interface DailyQaMeeting {
  summary: DailySummary; testers: DailyTesterRow[]; crs: DailyCrRow[]; alerts: string[];
  // Persisted RI-Home Release Health snapshot; null until the Overview screen
  // has computed it once for this version.
  health: ReleaseHealthInfo | null;
  dailyTargets: DailyTargetsMeta;
}

// "What Changed Since Yesterday" — hasData is false until the nightly
// snapshot job (DAILY_QA_SNAPSHOT_TIME, see release-intelligence.service.ts)
// has run at least once for this version.
type YesterdayDiff =
  | { hasData: false }
  | {
      hasData: true; sinceDate: string;
      testsPassedDelta: number; openDefectsDelta: number; openBlockersDelta: number;
      crsMovedToHighRisk: string[]; testersNoUpdates: { tester: string; days: number }[];
    };

interface Blocker {
  id: string; title: string; type: string; crNumber: string | null; ownerName: string | null;
  status: 'OPEN' | 'RESOLVED'; createdAt: string; resolvedAt: string | null;
}

// QA-only roster (not all 142 users) — same source QaWorkPlanView uses for
// its tester picker: GET /qa/testers (TesterProfile rows, isActive already
// filtered server-side), not GET /users. Stored on the form as the fullName
// string (not userId), same as ownerName elsewhere in this file.
interface PersonOption { userId: string; fullName: string; }

// Closed list + free-text "other" fallback (same convention as
// RiskManagementView's IMPACT_OTHER) — the spec's own examples mix a real
// person (זאב) and a team name (פיתוח Billing) as "אחראי", so the picker
// can't be list-only without losing data on values that aren't a real user.
const OWNER_OTHER = '__OTHER__';
function ownerSelectValue(ownerName: string, people: PersonOption[]): string {
  if (!ownerName) return '';
  return people.some(p => p.fullName === ownerName) ? ownerName : OWNER_OTHER;
}

const STATUS_COLOR: Record<'GOOD' | 'WARNING' | 'CRITICAL', string> = {
  GOOD: C.success, WARNING: '#e8af00', CRITICAL: C.danger,
};
const RISK_COLOR: Record<DailyCrRow['risk'], string> = {
  HIGH: C.danger, MEDIUM: '#e8af00', LOW: C.success,
};
const RISK_LABEL: Record<DailyCrRow['risk'], string> = {
  HIGH: 'גבוה', MEDIUM: 'בינוני', LOW: 'נמוך',
};

// Fixed catalog from the spec — "לא טקסט חופשי" (not free text). Must match
// the BlockerType enum in schema.prisma exactly.
const BLOCKER_TYPE_OPTIONS = [
  { value: 'ENVIRONMENT', label: 'סביבה' },
  { value: 'DATA', label: 'נתונים' },
  { value: 'DEVELOPMENT', label: 'פיתוח' },
  { value: 'INTEGRATION', label: 'אינטגרציה' },
  { value: 'INFRASTRUCTURE', label: 'תשתיות' },
  { value: 'PERMISSIONS', label: 'הרשאות' },
  { value: 'THIRD_PARTY', label: "צד ג'" },
  { value: 'BUSINESS_REQUIREMENT', label: 'דרישה עסקית' },
  { value: 'EQUIPMENT', label: 'ציוד' },
  { value: 'OTHER', label: 'אחר' },
];
const BLOCKER_TYPE_LABEL: Record<string, string> = Object.fromEntries(BLOCKER_TYPE_OPTIONS.map(o => [o.value, o.label]));

// Same role split as RiskManagementView's RISK_WRITERS/RISK_CLOSERS — blockers
// are logged/edited by the same roles as risks, closed only by RM/ADMIN.
const BLOCKER_WRITERS = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];
const BLOCKER_CLOSERS = ['RELEASE_MANAGER', 'ADMIN'];

function daysOpen(b: Blocker): number {
  const end = b.resolvedAt ? new Date(b.resolvedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((end - new Date(b.createdAt).getTime()) / 86400000));
}

interface ActionItem {
  id: string; title: string; ownerName: string | null; dueAt: string | null; status: ActionItemStatus;
}
type ActionItemStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'DONE' | 'CANCELED';

// Fixed status list from the spec — Open/In Progress/Waiting/Done/Canceled.
const ACTION_STATUS_OPTIONS: { value: ActionItemStatus; label: string }[] = [
  { value: 'OPEN', label: 'פתוח' },
  { value: 'IN_PROGRESS', label: 'בטיפול' },
  { value: 'WAITING', label: 'ממתין' },
  { value: 'DONE', label: 'הושלם' },
  { value: 'CANCELED', label: 'בוטל' },
];
const ACTION_STATUS_LABEL: Record<string, string> = Object.fromEntries(ACTION_STATUS_OPTIONS.map(o => [o.value, o.label]));
const ACTION_STATUS_COLOR: Record<string, string> = {
  OPEN: C.textMuted, IN_PROGRESS: '#e8af00', WAITING: C.danger, DONE: C.success, CANCELED: C.textMuted,
};
// No separate closer role — action items are day-to-day follow-ups anyone in
// BLOCKER_WRITERS can move through the full status list, unlike Risk/Blocker
// which gate their terminal state to RM/ADMIN.
const ACTION_WRITERS = BLOCKER_WRITERS;

function isActionOverdue(a: ActionItem): boolean {
  return !!a.dueAt && a.status !== 'DONE' && a.status !== 'CANCELED' && new Date(a.dueAt).getTime() < Date.now();
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function StatusDot({ color }: { color: string }) {
  return <span className="inline-block h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: color }} />;
}

function KpiCard({ value, label, color, onClick }: { value: string; label: string; color?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cn('relative min-w-[130px] flex-1 basis-[130px] rounded-lg border bg-card px-[18px] py-3.5', onClick ? 'cursor-pointer' : 'cursor-default')}
      style={{ borderColor: C.border, borderTop: color ? `3px solid ${color}` : undefined }}
      onMouseEnter={onClick ? e => { (e.currentTarget as HTMLElement).style.borderColor = C.brand; } : undefined}
      onMouseLeave={onClick ? e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; } : undefined}
    >
      {onClick && <span className="absolute top-2.5 text-xs text-subtle-foreground [inset-inline-end:12px]">←</span>}
      <div className="text-xl font-bold leading-[1.2]" style={{ color: color ?? C.textPrimary }}>{value}</div>
      <div className="mt-[3px] text-xs text-subtle-foreground">{label}</div>
    </div>
  );
}

// Readiness = gated model (release-intelligence.service.ts, spec 2026-09-09):
// weighted 4-axis soft score capped by hard blockers. ≥75 GO, 50-74
// CONDITIONAL_GO, <50 NO_GO.
const HEALTH_REC_META: Record<HealthRecommendation, { label: string; color: string }> = {
  GO: { label: 'GO — מוכן', color: C.success },
  CONDITIONAL_GO: { label: 'GO בתנאים', color: C.warning },
  NO_GO: { label: 'NO-GO', color: C.danger },
};
const HEALTH_PARTS: [keyof ReleaseHealthInfo['breakdown'], string][] = [
  ['coverageScore', 'כיסוי'], ['qualityScore', 'תקלות'], ['riskScore', 'סיכונים'], ['forecastScore', 'תחזית'],
];

// Same snapshot the RI Home shows. Kept as a strip (not a bare KpiCard number)
// so the 4 sub-scores are always visible next to the blended figure.
function HealthBanner({ health }: { health: ReleaseHealthInfo | null }) {
  if (!health) {
    return (
      <div className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-xs text-subtle-foreground">
        🩺 מדד מוכנות הגרסה — טרם חושב. ייחשב לאחר כניסה לדף הבית של ניהול הבדיקות.
      </div>
    );
  }
  const meta = HEALTH_REC_META[health.recommendation];
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card px-4 py-3" style={{ borderTop: `3px solid ${meta.color}` }}>
      <div className="flex items-baseline gap-2">
        <span className="text-sm">🩺</span>
        <span className="text-xs font-semibold text-subtle-foreground">מוכנות הגרסה</span>
        <span className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ color: meta.color }}>{health.score}</span>
        <span className="text-sm font-semibold" style={{ color: meta.color }}>{meta.label}</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {HEALTH_PARTS.map(([k, label]) => {
          const v = health.breakdown[k];
          return (
            <span key={k} className="text-xs text-subtle-foreground">
              {label} <span className="font-semibold [font-variant-numeric:tabular-nums]" style={{ color: v < 50 ? C.danger : v < 80 ? C.warning : C.textSecondary }}>{v}</span>
            </span>
          );
        })}
      </div>
      <span className="ms-auto text-xs text-subtle-foreground">
        עודכן {new Date(health.calculatedAt).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}

const CYCLE_LABEL_SHORT: Record<string, string> = { CYCLE_1: 'סבב 1', CYCLE_2: 'סבב 2', CYCLE_3: 'סבב 3' };

// Explains which day the per-CR targets are framed for, and lets the QA manager
// flip it (a morning standup targets today; an afternoon one targets tomorrow —
// auto-decided by the DAILY_QA_STANDUP_CUTOFF hour, overridable here).
function TargetDayBar({ meta, override, onOverride }: {
  meta: DailyTargetsMeta;
  override: 'today' | 'tomorrow' | null;
  onOverride: (v: 'today' | 'tomorrow' | null) => void;
}) {
  const deadlineText = meta.deadline
    ? `${meta.deadlineIsGoLive ? 'עד עלייה לאוויר' : `סוף ${CYCLE_LABEL_SHORT[meta.deadlineCycle ?? ''] ?? 'הסבב'}`} ${new Date(meta.deadline).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}`
    : 'אין סבב ליבה פעיל — לא ניתן לחשב יעדים';
  const btn = (v: 'today' | 'tomorrow', label: string) => {
    const active = meta.targetDay === v;
    return (
      <button
        onClick={() => onOverride(override === v ? null : v)}
        className={cn('cursor-pointer rounded-sm border-none px-3 py-[3px] text-xs font-semibold', active ? 'bg-card text-foreground' : 'bg-transparent text-subtle-foreground')}
      >{label}</button>
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 text-xs text-subtle-foreground">
      <span>🎯 יעדים יומיים מחושבים ל<strong className="text-foreground">{meta.targetDay === 'today' ? 'היום' : 'מחר'}</strong></span>
      <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
        {btn('today', 'היום')}
        {btn('tomorrow', 'מחר')}
      </div>
      {override && <span style={{ color: '#e8af00' }}>(נבחר ידנית · <button onClick={() => onOverride(null)} className="cursor-pointer border-none bg-transparent p-0 text-xs text-primary underline">אוטומטי לפי שעת {meta.standupCutoff}</button>)</span>}
      <span className="ms-auto">
        {deadlineText}
        {meta.workDaysLeft != null && ` · ${meta.workDaysLeft} ימי עבודה נותרו`}
        {!meta.hasSnapshot && ' · "בוצע היום" יופיע אחרי הצילום הלילי הראשון'}
      </span>
    </div>
  );
}

const thClass = 'whitespace-nowrap border-b border-border px-2.5 py-2 text-right text-xs font-semibold text-subtle-foreground';
const tdClass = 'border-b border-border px-2.5 py-2 text-sm text-foreground';
const inputClass = 'box-border w-full rounded-sm border border-border bg-card px-[9px] py-1.5 text-xs text-foreground';

// Shared CR-risk table body — used both by Release View's single flat list
// and Team View's per-team sections (spec: "אותו מנגנון משרת גם Daily גרסה
// וגם Daily צוות").
// Click a row to drill into its blockers/team assignment (real DailyBlocker
// catalog rows, matched by crNumber — no drill-down for the Blockers *count*
// itself, since that's a QC script-status tally with no underlying listable
// record). Click the Defects count specifically (stopPropagation, so it
// doesn't also toggle the row) to open the shared DefectDrilldownModal.
function DeltaCell({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-subtle-foreground">—</span>;
  const color = delta > 0 ? C.success : delta < 0 ? C.danger : C.textMuted;
  return <span className={cn('[font-variant-numeric:tabular-nums]', delta !== 0 ? 'font-semibold' : 'font-normal')} style={{ color }}>{delta > 0 ? `+${delta}` : delta}</span>;
}

function CrRiskTable({ rows, blockers, emptyMessage, onShowDefects, targetDay }: {
  rows: DailyCrRow[]; blockers: Blocker[]; emptyMessage: string; onShowDefects: (crNumber: string, crLabel: string) => void;
  targetDay: 'today' | 'tomorrow';
}) {
  const [expandedCr, setExpandedCr] = useState<string | null>(null);
  if (rows.length === 0) {
    return <div className="p-6 text-center text-sm text-subtle-foreground">{emptyMessage}</div>;
  }
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={thClass}>CR</th>
          <th className={thClass}>בודק</th>
          <th className={thClass}>התקדמות</th>
          <th className={thClass}>בוצע היום</th>
          <th className={thClass}>יעד {targetDay === 'today' ? 'להיום' : 'למחר'}</th>
          <th className={thClass}>תקלות</th>
          <th className={thClass}>חסמים</th>
          <th className={thClass}>סיכון</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(cr => {
          const crBlockers = blockers.filter(b => b.crNumber === cr.crNumber);
          const expanded = expandedCr === cr.crNumber;
          return (
            <React.Fragment key={cr.crNumber}>
              <tr title={cr.reasons.join(' · ')} onClick={() => setExpandedCr(v => v === cr.crNumber ? null : cr.crNumber)} className="cursor-pointer">
                <td className={cn(tdClass, 'font-semibold')}>{cr.crNumber}{cr.crLabel ? ` — ${cr.crLabel.replace(/^\d+\s*-\s*/, '')}` : ''}</td>
                <td className={tdClass} style={{ color: cr.tester ? C.textPrimary : C.textMuted }}>{cr.tester ? <PersonAvatar name={cr.tester} full /> : '—'}</td>
                <td className={tdClass}>{cr.progressPct}%</td>
                <td className={tdClass}><DeltaCell delta={cr.passedDelta} /></td>
                <td className={tdClass} title={`נותרו ${cr.remaining} תרחישים${cr.mustFinishNow ? ' — עבר יעד הסבב, יש לסיים בהקדם' : ''}`}>
                  {cr.dailyTarget == null
                    ? <span className="text-subtle-foreground">—</span>
                    : <span className="font-semibold [font-variant-numeric:tabular-nums]" style={{ color: cr.mustFinishNow ? C.danger : C.textPrimary }}>{cr.dailyTarget}{cr.mustFinishNow ? ' ⚠' : ''}</span>}
                </td>
                <td className={tdClass}>
                  {cr.defectCount > 0 ? (
                    <span onClick={e => { e.stopPropagation(); onShowDefects(cr.crNumber, cr.crLabel); }} className="cursor-pointer text-danger underline">
                      {cr.defectCount}
                    </span>
                  ) : cr.defectCount}
                </td>
                <td className={tdClass} style={{ color: cr.blockerCount > 0 ? C.danger : C.textPrimary }}>{cr.blockerCount}</td>
                <td className={tdClass}>
                  <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: RISK_COLOR[cr.risk] }}>
                    <StatusDot color={RISK_COLOR[cr.risk]} />
                    {RISK_LABEL[cr.risk]}
                  </span>
                </td>
              </tr>
              {expanded && (
                <tr>
                  <td colSpan={8} className="border-b border-border bg-muted px-2.5 pb-3 pt-1">
                    <div className="flex flex-col gap-1.5 text-xs">
                      <div className="text-muted-foreground">
                        צוותים: {cr.teams.length > 0 ? cr.teams.map(t => t.name).join(', ') : 'ללא שיוך צוות'}
                      </div>
                      {crBlockers.length === 0 ? (
                        <div className="text-subtle-foreground">אין חסמים רשומים ל-CR זה.</div>
                      ) : crBlockers.map(b => (
                        <div key={b.id} className="flex justify-between px-1.5 py-0.5 text-muted-foreground">
                          <span>{b.title} ({BLOCKER_TYPE_LABEL[b.type] ?? b.type})</span>
                          <span className="font-semibold" style={{ color: b.status === 'OPEN' ? C.danger : C.success }}>{b.status === 'OPEN' ? 'פתוח' : 'נסגר'}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

const NO_TEAM_LABEL = 'ללא צוות';

interface Props { token: string; versionId?: string; role: string; }

interface BlockerDraft { title: string; type: string; crNumber: string; ownerName: string; }
const EMPTY_BLOCKER_DRAFT: BlockerDraft = { title: '', type: BLOCKER_TYPE_OPTIONS[0].value, crNumber: '', ownerName: '' };

interface ActionDraft { title: string; ownerName: string; dueAt: string; status: ActionItemStatus; }
const EMPTY_ACTION_DRAFT: ActionDraft = { title: '', ownerName: '', dueAt: '', status: 'OPEN' };

export const DailyQaManagementView: React.FC<Props> = ({ token, versionId, role }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<DailyQaMeeting | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedTester, setExpandedTester] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'RELEASE' | 'TEAM'>('RELEASE');
  // null = let the backend decide by standup-cutoff hour; 'today'/'tomorrow' = manual override
  const [targetDayOverride, setTargetDayOverride] = useState<'today' | 'tomorrow' | null>(null);

  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [addingBlocker, setAddingBlocker] = useState(false);
  const [editingBlockerId, setEditingBlockerId] = useState<string | null>(null);
  const [blockerDraft, setBlockerDraft] = useState<BlockerDraft>(EMPTY_BLOCKER_DRAFT);
  const [savingBlocker, setSavingBlocker] = useState(false);
  const canWriteBlockers = BLOCKER_WRITERS.includes(role);
  const canCloseBlockers = BLOCKER_CLOSERS.includes(role);

  const [actions, setActions] = useState<ActionItem[]>([]);
  const [addingAction, setAddingAction] = useState(false);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [actionDraft, setActionDraft] = useState<ActionDraft>(EMPTY_ACTION_DRAFT);
  const [savingAction, setSavingAction] = useState(false);
  const canWriteActions = ACTION_WRITERS.includes(role);

  const [diff, setDiff] = useState<YesterdayDiff | null>(null);

  const [drilldown, setDrilldown] = useState<{ screen: string; filter: string; value?: string; title: string } | null>(null);
  const showCrDefects = (crNumber: string, crLabel: string) =>
    setDrilldown({ screen: 'daily-qa', filter: 'cr', value: crNumber, title: `תקלות פתוחות — ${crNumber}${crLabel ? ` — ${crLabel.replace(/^\d+\s*-\s*/, '')}` : ''}` });
  const showTesterDefects = (tester: string) =>
    setDrilldown({ screen: 'daily-qa', filter: 'tester', value: tester, title: `תקלות פתוחות — בודק: ${tester}` });
  const scrollToSection = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const load = useCallback(() => {
    if (!versionId) { setData(null); setBlockers([]); setActions([]); setDiff(null); return; }
    setLoading(true);
    const targetQ = targetDayOverride ? `?targetDay=${targetDayOverride}` : '';
    axios.get(`${API}/release-intelligence/daily-qa/${versionId}${targetQ}`, { headers })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    axios.get(`${API}/release-intelligence/blockers/${versionId}`, { headers })
      .then(res => setBlockers(res.data ?? []))
      .catch(() => setBlockers([]));
    axios.get(`${API}/release-intelligence/action-items/${versionId}`, { headers })
      .then(res => setActions(res.data ?? []))
      .catch(() => setActions([]));
    axios.get(`${API}/release-intelligence/daily-qa/${versionId}/yesterday-diff`, { headers })
      .then(res => setDiff(res.data))
      .catch(() => setDiff(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token, targetDayOverride]);

  useEffect(() => { load(); setExpandedTester(null); }, [load]);

  const [people, setPeople] = useState<PersonOption[]>([]);
  useEffect(() => {
    if (!canWriteBlockers && !canWriteActions) { setPeople([]); return; }
    axios.get(`${API}/qa/testers`, { headers })
      .then(res => setPeople((res.data ?? [])
        .sort((a: PersonOption, b: PersonOption) => a.fullName.localeCompare(b.fullName, 'he'))))
      .catch(() => setPeople([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, canWriteBlockers, canWriteActions]);

  const startAddBlocker = () => { setBlockerDraft(EMPTY_BLOCKER_DRAFT); setEditingBlockerId(null); setAddingBlocker(true); };
  const startEditBlocker = (b: Blocker) => {
    setBlockerDraft({ title: b.title, type: b.type, crNumber: b.crNumber ?? '', ownerName: b.ownerName ?? '' });
    setAddingBlocker(false); setEditingBlockerId(b.id);
  };
  const cancelBlocker = () => { setAddingBlocker(false); setEditingBlockerId(null); setBlockerDraft(EMPTY_BLOCKER_DRAFT); };

  const saveBlocker = async () => {
    if (!versionId || !blockerDraft.title.trim()) return;
    const payload = {
      title: blockerDraft.title.trim(), type: blockerDraft.type,
      crNumber: blockerDraft.crNumber.trim() || null, ownerName: blockerDraft.ownerName.trim() || null,
    };
    setSavingBlocker(true);
    try {
      if (editingBlockerId) {
        await axios.patch(`${API}/release-intelligence/blockers/${editingBlockerId}`, payload, { headers });
      } else {
        await axios.post(`${API}/release-intelligence/blockers`, { ...payload, versionId }, { headers });
      }
      load();
      cancelBlocker();
    } catch (e) { console.error('Failed to save blocker', e); }
    setSavingBlocker(false);
  };

  const toggleBlockerStatus = async (b: Blocker) => {
    try {
      await axios.patch(`${API}/release-intelligence/blockers/${b.id}/${b.status === 'OPEN' ? 'resolve' : 'reopen'}`, {}, { headers });
      load();
    } catch (e) { console.error('Failed to update blocker status', e); }
  };

  const startAddAction = () => { setActionDraft(EMPTY_ACTION_DRAFT); setEditingActionId(null); setAddingAction(true); };
  const startEditAction = (a: ActionItem) => {
    setActionDraft({ title: a.title, ownerName: a.ownerName ?? '', dueAt: toDateInputValue(a.dueAt), status: a.status });
    setAddingAction(false); setEditingActionId(a.id);
  };
  const cancelAction = () => { setAddingAction(false); setEditingActionId(null); setActionDraft(EMPTY_ACTION_DRAFT); };

  const saveAction = async () => {
    if (!versionId || !actionDraft.title.trim()) return;
    const payload = {
      title: actionDraft.title.trim(), ownerName: actionDraft.ownerName.trim() || null,
      dueAt: actionDraft.dueAt || null, status: actionDraft.status,
    };
    setSavingAction(true);
    try {
      if (editingActionId) {
        await axios.patch(`${API}/release-intelligence/action-items/${editingActionId}`, payload, { headers });
      } else {
        await axios.post(`${API}/release-intelligence/action-items`, { ...payload, versionId }, { headers });
      }
      load();
      cancelAction();
    } catch (e) { console.error('Failed to save action item', e); }
    setSavingAction(false);
  };

  if (!versionId) {
    return (
      <div className="p-8 text-center text-subtle-foreground [direction:rtl]">
        בחר גרסה מתפריט הצד כדי לראות את ה-Daily שלה.
      </div>
    );
  }

  if (loading && !data) {
    return <div className="p-6 text-subtle-foreground [direction:rtl]">טוען...</div>;
  }

  if (!data) {
    return <div className="p-6 text-subtle-foreground [direction:rtl]">לא ניתן לטעון נתונים עבור גרסה זו.</div>;
  }

  const { summary, testers, crs, alerts, dailyTargets } = data;

  // Team View grouping — a CR with no team assignment falls into a "ללא
  // צוות" bucket rather than being silently dropped, and a CR assigned to
  // more than one team appears under each (see DailyBlocker's teams field).
  const crsByTeam = new Map<string, DailyCrRow[]>();
  for (const cr of crs) {
    const teamNames = cr.teams.length > 0 ? cr.teams.map(t => t.name) : [NO_TEAM_LABEL];
    for (const name of teamNames) {
      const list = crsByTeam.get(name) ?? [];
      list.push(cr);
      crsByTeam.set(name, list);
    }
  }
  const teamSections = Array.from(crsByTeam.entries()).sort(([a], [b]) => a === NO_TEAM_LABEL ? 1 : b === NO_TEAM_LABEL ? -1 : a.localeCompare(b, 'he'));

  return (
    <div className="flex flex-col gap-4 [direction:rtl]">
      <div className="flex items-center justify-between">
        <div className="text-lg font-bold text-foreground">📋 ניהול QA יומי</div>
        <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
          {(['RELEASE', 'TEAM'] as const).map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={cn('cursor-pointer rounded-sm border-none px-3.5 py-1.5 text-xs font-semibold', viewMode === m ? 'bg-card text-foreground' : 'bg-transparent text-subtle-foreground')}
            >
              {m === 'RELEASE' ? 'תצוגת גרסה' : 'תצוגת צוותים'}
            </button>
          ))}
        </div>
      </div>

      {/* ── מדד בריאות גרסה — אותו snapshot של דף הבית, כהקשר-על לישיבה ── */}
      <HealthBanner health={data.health} />

      {/* ── יעדים יומיים: להיום/למחר לפי שעת הישיבה ── */}
      <TargetDayBar meta={dailyTargets} override={targetDayOverride} onOverride={setTargetDayOverride} />

      {/* ── "מה השתנה מאתמול" — הדבר הראשון שמוצג, כדי שהישיבה תתחיל מהחריגים בלבד ── */}
      {diff && (diff.hasData ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
          <div className="text-xs font-bold uppercase tracking-[0.06em] text-subtle-foreground">
            מאתמול ({formatDate(diff.sinceDate)}) → היום
          </div>
          <div className="flex flex-wrap gap-4">
            <span className="text-sm font-semibold" style={{ color: diff.testsPassedDelta >= 0 ? C.success : C.danger }}>
              {diff.testsPassedDelta >= 0 ? '+' : ''}{diff.testsPassedDelta} תרחישים עברו
            </span>
            <span className="text-sm font-semibold" style={{ color: diff.openDefectsDelta > 0 ? C.danger : C.textMuted }}>
              {diff.openDefectsDelta >= 0 ? '+' : ''}{diff.openDefectsDelta} תקלות פתוחות
            </span>
            <span className="text-sm font-semibold" style={{ color: diff.openBlockersDelta < 0 ? C.success : diff.openBlockersDelta > 0 ? C.danger : C.textMuted }}>
              {diff.openBlockersDelta > 0 ? '+' : ''}{diff.openBlockersDelta} חסמים פתוחים
            </span>
          </div>
          {(diff.crsMovedToHighRisk.length > 0 || diff.testersNoUpdates.length > 0) && (
            <div className="flex flex-col gap-1 border-t border-border pt-1">
              {diff.crsMovedToHighRisk.map(cr => (
                <div key={cr} className="text-sm font-semibold text-danger">⚠️ {cr} עבר לסיכון גבוה</div>
              ))}
              {diff.testersNoUpdates.map(t => (
                <div key={t.tester} className="text-sm font-semibold text-danger">⚠️ {t.tester} — ללא עדכון {t.days} ימים</div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="px-0.5 py-0.5 text-xs text-subtle-foreground">אין עדיין נתוני השוואה ליום הקודם — הצילום הראשון ירוץ הלילה.</div>
      ))}

      {/* ── אזור 6: התראות אוטומטיות — קודם כל, כדי שהמשתמש ייכנס ישר למה שדורש דיון ── */}
      {alerts.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-danger/25 bg-danger-bg p-3">
          {alerts.map((a, i) => (
            <div key={i} className="text-sm font-semibold text-danger">{a}</div>
          ))}
        </div>
      )}

      {/* ── אזור 1: Executive Summary — כל כרטיס עם דריל לרשומות/לסקציה הרלוונטית ── */}
      <div className="flex flex-wrap gap-3">
        <KpiCard value={`${summary.testProgressPct}%`} label="התקדמות בדיקות" color={summary.testProgressPct >= 80 ? C.success : summary.testProgressPct >= 50 ? C.warning : C.danger} onClick={() => scrollToSection('daily-crs')} />
        <KpiCard value={String(summary.passed)} label="עברו" color={C.success} onClick={() => scrollToSection('daily-crs')} />
        <KpiCard value={String(summary.failed)} label="נכשלו" color={summary.failed > 0 ? C.danger : undefined} onClick={() => scrollToSection('daily-crs')} />
        <KpiCard value={String(summary.blocked)} label="חסומים" color={summary.blocked > 0 ? C.warning : undefined} onClick={() => scrollToSection('daily-crs')} />
        <KpiCard value={String(summary.openDefects)} label="תקלות פתוחות" color={summary.openDefects > 0 ? C.warning : C.success}
          onClick={summary.openDefects > 0 ? () => setDrilldown({ screen: 'daily-qa', filter: 'openAll', title: 'תקלות פתוחות — כל הגרסה' }) : undefined} />
        <KpiCard value={String(summary.criticalDefects)} label="תקלות קריטיות" color={summary.criticalDefects > 0 ? C.danger : C.success}
          onClick={summary.criticalDefects > 0 ? () => setDrilldown({ screen: 'daily-qa', filter: 'critical', title: 'תקלות קריטיות פתוחות (Show Stopper)' }) : undefined} />
        <KpiCard value={String(summary.openBlockers)} label="חסמים פתוחים" color={summary.openBlockers > 0 ? C.danger : C.success} onClick={() => scrollToSection('daily-blockers')} />
        <KpiCard value={String(summary.crsAtRisk)} label="CR-ים בסיכון" color={summary.crsAtRisk > 0 ? C.danger : C.success} onClick={() => scrollToSection('daily-crs')} />
        <KpiCard value={String(summary.testersNoProgress)} label="בודקים ללא התקדמות" color={summary.testersNoProgress > 0 ? C.danger : C.success} onClick={() => scrollToSection('daily-heatmap')} />
      </div>

      {/* ── אזור 2: Heat Map לבודקים ── */}
      <div id="daily-heatmap">
        <h2 className="my-1 mb-2 text-xs font-bold uppercase tracking-[0.06em] text-subtle-foreground">מפת חום — בודקים</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          {testers.length === 0 ? (
            <div className="p-6 text-center text-sm text-subtle-foreground">אין בודקים משובצים לגרסה זו.</div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thClass}>בודק</th>
                  <th className={thClass}>התקדמות</th>
                  <th className={thClass}>CR</th>
                  <th className={thClass}>בוצע היום</th>
                  <th className={thClass}>יעד {dailyTargets.targetDay === 'today' ? 'להיום' : 'למחר'}</th>
                  <th className={thClass}>תקלות</th>
                  <th className={thClass}>חסמים</th>
                  <th className={thClass}>סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {testers.map(t => (
                  <React.Fragment key={t.tester}>
                    <tr onClick={() => setExpandedTester(v => v === t.tester ? null : t.tester)} className="cursor-pointer">
                      <td className={cn(tdClass, 'font-semibold')}>{t.tester && t.tester !== 'לא משויך' ? <PersonAvatar name={t.tester} full /> : t.tester}</td>
                      <td className={tdClass}>{t.progressPct}%</td>
                      <td className={tdClass}>{t.crCount}</td>
                      <td className={tdClass}><DeltaCell delta={t.doneToday} /></td>
                      <td className={cn(tdClass, 'font-semibold [font-variant-numeric:tabular-nums]')}>{t.dailyTarget > 0 ? t.dailyTarget : <span className="font-normal text-subtle-foreground">—</span>}</td>
                      <td className={tdClass}>
                        {t.defectCount > 0 ? (
                          <span onClick={e => { e.stopPropagation(); showTesterDefects(t.tester); }} className="cursor-pointer text-danger underline">
                            {t.defectCount}
                          </span>
                        ) : t.defectCount}
                      </td>
                      <td className={tdClass} style={{ color: t.blockerCount > 0 ? C.danger : C.textPrimary }}>{t.blockerCount}</td>
                      <td className={tdClass}><StatusDot color={STATUS_COLOR[t.status]} /></td>
                    </tr>
                    {expandedTester === t.tester && (
                      <tr>
                        <td colSpan={8} className="border-b border-border bg-muted px-2.5 pb-3 pt-1">
                          <div className="flex flex-col gap-1">
                            {t.crs.map(cr => (
                              <div key={cr.crNumber} className="flex justify-between px-1.5 py-0.5 text-xs text-muted-foreground">
                                <span>{cr.crNumber}{cr.crLabel ? ` — ${cr.crLabel.replace(/^\d+\s*-\s*/, '')}` : ''}</span>
                                <span className="font-semibold">{cr.progressPct}%</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── אזור 3: CRs בסיכון — Release View: רשימה שטוחה. Team View: אותה
           טבלה בדיוק, מפוצלת לסקציה לכל צוות ── */}
      <div id="daily-crs" />
      {viewMode === 'RELEASE' ? (
        <div>
          <h2 className="my-1 mb-2 text-xs font-bold uppercase tracking-[0.06em] text-subtle-foreground">CR-ים בסיכון</h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <CrRiskTable rows={crs} blockers={blockers} emptyMessage="אין CR-ים משובצים לגרסה זו." onShowDefects={showCrDefects} targetDay={dailyTargets.targetDay} />
          </div>
        </div>
      ) : teamSections.length === 0 ? (
        <div>
          <h2 className="my-1 mb-2 text-xs font-bold uppercase tracking-[0.06em] text-subtle-foreground">CR-ים בסיכון לפי צוות</h2>
          <div className="rounded-lg border border-border bg-card">
            <div className="p-6 text-center text-sm text-subtle-foreground">אין CR-ים משובצים לגרסה זו.</div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {teamSections.map(([teamName, rows]) => (
            <div key={teamName}>
              <h2 className="my-1 mb-2 text-xs font-bold uppercase tracking-[0.06em] text-subtle-foreground">
                {teamName} <span className="font-normal text-subtle-foreground">({rows.length})</span>
              </h2>
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <CrRiskTable rows={rows} blockers={blockers} emptyMessage="אין CR-ים משובצים לצוות זה." onShowDefects={showCrDefects} targetDay={dailyTargets.targetDay} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── אזור 4: מרכז חסמים ── */}
      <div id="daily-blockers">
        <div className="my-1 mb-2 flex items-center justify-between">
          <h2 className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-subtle-foreground">מרכז חסמים</h2>
          {canWriteBlockers && !addingBlocker && (
            <button onClick={startAddBlocker} className="cursor-pointer rounded-md border-none bg-primary px-3.5 py-1.5 text-xs font-semibold text-white">
              + חסם חדש
            </button>
          )}
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={thClass}>חסם</th>
                <th className={thClass}>סוג</th>
                <th className={thClass}>CR</th>
                <th className={thClass}>אחראי</th>
                <th className={thClass}>ימים פתוח</th>
                <th className={thClass}>סטטוס</th>
                {canWriteBlockers && <th className={thClass}></th>}
              </tr>
            </thead>
            <tbody>
              {(addingBlocker || editingBlockerId) && (
                <tr className="bg-muted">
                  <td className={tdClass}>
                    <input autoFocus value={blockerDraft.title} onChange={e => setBlockerDraft(d => ({ ...d, title: e.target.value }))} placeholder="תיאור החסם…" className={cn(inputClass, 'min-w-[180px]')} />
                  </td>
                  <td className={tdClass}>
                    <select value={blockerDraft.type} onChange={e => setBlockerDraft(d => ({ ...d, type: e.target.value }))} className={inputClass}>
                      {BLOCKER_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td className={tdClass}>
                    <input value={blockerDraft.crNumber} onChange={e => setBlockerDraft(d => ({ ...d, crNumber: e.target.value }))} placeholder="CR…" className={inputClass} />
                  </td>
                  <td className={tdClass}>
                    <select
                      value={ownerSelectValue(blockerDraft.ownerName, people)}
                      onChange={e => setBlockerDraft(d => ({ ...d, ownerName: e.target.value === OWNER_OTHER ? '' : e.target.value }))}
                      className={cn(inputClass, ownerSelectValue(blockerDraft.ownerName, people) === OWNER_OTHER && 'mb-1.5')}
                    >
                      <option value="">— אחראי —</option>
                      {people.map(p => <option key={p.userId} value={p.fullName}>{p.fullName}</option>)}
                      <option value={OWNER_OTHER}>אחר…</option>
                    </select>
                    {ownerSelectValue(blockerDraft.ownerName, people) === OWNER_OTHER && (
                      <input value={blockerDraft.ownerName} onChange={e => setBlockerDraft(d => ({ ...d, ownerName: e.target.value }))} placeholder="פרט…" className={inputClass} />
                    )}
                  </td>
                  <td className={tdClass}>—</td>
                  <td className={tdClass}>—</td>
                  <td className={cn(tdClass, 'whitespace-nowrap')}>
                    <div className="flex gap-1.5">
                      <button onClick={saveBlocker} disabled={savingBlocker || !blockerDraft.title.trim()} className={cn('cursor-pointer rounded-sm border-none bg-primary px-3 py-[5px] text-xs font-semibold text-white', (savingBlocker || !blockerDraft.title.trim()) && 'opacity-60')}>
                        {savingBlocker ? '...' : 'שמור'}
                      </button>
                      <button onClick={cancelBlocker} disabled={savingBlocker} className="cursor-pointer rounded-sm border border-border bg-transparent px-3 py-[5px] text-xs text-subtle-foreground">
                        ביטול
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {blockers.length === 0 && !addingBlocker && (
                <tr><td colSpan={7} className={cn(tdClass, 'p-5 text-center text-subtle-foreground')}>אין חסמים רשומים לגרסה זו.</td></tr>
              )}
              {blockers.map(b => editingBlockerId === b.id ? null : (
                <tr key={b.id}>
                  <td
                    className={cn(tdClass, 'font-semibold')}
                    style={{ textDecoration: b.status === 'RESOLVED' ? 'line-through' : undefined, color: b.status === 'RESOLVED' ? C.textMuted : C.textPrimary }}
                  >{b.title}</td>
                  <td className={tdClass}>{BLOCKER_TYPE_LABEL[b.type] ?? b.type}</td>
                  <td className={tdClass}>{b.crNumber || '—'}</td>
                  <td className={tdClass}>{b.ownerName || '—'}</td>
                  <td
                    className={cn(tdClass, b.status === 'OPEN' && daysOpen(b) > 2 && 'font-semibold')}
                    style={{ color: b.status === 'OPEN' && daysOpen(b) > 2 ? C.danger : C.textPrimary }}
                  >{daysOpen(b)}</td>
                  <td className={tdClass}>
                    <span
                      className="inline-block rounded-full px-2.5 py-0.5 font-semibold"
                      style={{
                        color: b.status === 'OPEN' ? C.danger : C.success,
                        background: `${b.status === 'OPEN' ? C.danger : C.success}14`,
                        border: `1px solid ${b.status === 'OPEN' ? C.danger : C.success}40`,
                      }}
                    >
                      {b.status === 'OPEN' ? 'פתוח' : 'נסגר'}
                    </span>
                  </td>
                  {canWriteBlockers && (
                    <td className={cn(tdClass, 'whitespace-nowrap')}>
                      <div className="flex gap-2.5">
                        <button onClick={() => startEditBlocker(b)} className="cursor-pointer border-none bg-transparent text-xs font-semibold text-primary">✏️ ערוך</button>
                        {canCloseBlockers && (
                          <button onClick={() => toggleBlockerStatus(b)} className="cursor-pointer border-none bg-transparent text-xs font-semibold" style={{ color: b.status === 'OPEN' ? C.success : C.textMuted }}>
                            {b.status === 'OPEN' ? '✔ סגור' : '↺ פתח מחדש'}
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── אזור 5: Action Items ── */}
      <div>
        <div className="my-1 mb-2 flex items-center justify-between">
          <h2 className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-subtle-foreground">משימות לביצוע</h2>
          {canWriteActions && !addingAction && (
            <button onClick={startAddAction} className="cursor-pointer rounded-md border-none bg-primary px-3.5 py-1.5 text-xs font-semibold text-white">
              + משימה חדשה
            </button>
          )}
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={thClass}>משימה</th>
                <th className={thClass}>אחראי</th>
                <th className={thClass}>יעד</th>
                <th className={thClass}>סטטוס</th>
                {canWriteActions && <th className={thClass}></th>}
              </tr>
            </thead>
            <tbody>
              {(addingAction || editingActionId) && (
                <tr className="bg-muted">
                  <td className={tdClass}>
                    <input autoFocus value={actionDraft.title} onChange={e => setActionDraft(d => ({ ...d, title: e.target.value }))} placeholder="תיאור המשימה…" className={cn(inputClass, 'min-w-[200px]')} />
                  </td>
                  <td className={tdClass}>
                    <select
                      value={ownerSelectValue(actionDraft.ownerName, people)}
                      onChange={e => setActionDraft(d => ({ ...d, ownerName: e.target.value === OWNER_OTHER ? '' : e.target.value }))}
                      className={cn(inputClass, ownerSelectValue(actionDraft.ownerName, people) === OWNER_OTHER && 'mb-1.5')}
                    >
                      <option value="">— אחראי —</option>
                      {people.map(p => <option key={p.userId} value={p.fullName}>{p.fullName}</option>)}
                      <option value={OWNER_OTHER}>אחר…</option>
                    </select>
                    {ownerSelectValue(actionDraft.ownerName, people) === OWNER_OTHER && (
                      <input value={actionDraft.ownerName} onChange={e => setActionDraft(d => ({ ...d, ownerName: e.target.value }))} placeholder="פרט…" className={inputClass} />
                    )}
                  </td>
                  <td className={tdClass}>
                    <input type="date" value={actionDraft.dueAt} onChange={e => setActionDraft(d => ({ ...d, dueAt: e.target.value }))} className={inputClass} />
                  </td>
                  <td className={tdClass}>
                    <select value={actionDraft.status} onChange={e => setActionDraft(d => ({ ...d, status: e.target.value as ActionItemStatus }))} className={inputClass}>
                      {ACTION_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td className={cn(tdClass, 'whitespace-nowrap')}>
                    <div className="flex gap-1.5">
                      <button onClick={saveAction} disabled={savingAction || !actionDraft.title.trim()} className={cn('cursor-pointer rounded-sm border-none bg-primary px-3 py-[5px] text-xs font-semibold text-white', (savingAction || !actionDraft.title.trim()) && 'opacity-60')}>
                        {savingAction ? '...' : 'שמור'}
                      </button>
                      <button onClick={cancelAction} disabled={savingAction} className="cursor-pointer rounded-sm border border-border bg-transparent px-3 py-[5px] text-xs text-subtle-foreground">
                        ביטול
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {actions.length === 0 && !addingAction && (
                <tr><td colSpan={5} className={cn(tdClass, 'p-5 text-center text-subtle-foreground')}>אין משימות רשומות לגרסה זו.</td></tr>
              )}
              {actions.map(a => editingActionId === a.id ? null : (
                <tr key={a.id}>
                  <td
                    className={cn(tdClass, 'font-semibold')}
                    style={{ textDecoration: a.status === 'DONE' || a.status === 'CANCELED' ? 'line-through' : undefined, color: a.status === 'DONE' || a.status === 'CANCELED' ? C.textMuted : C.textPrimary }}
                  >{a.title}</td>
                  <td className={tdClass}>{a.ownerName || '—'}</td>
                  <td
                    className={cn(tdClass, isActionOverdue(a) && 'font-semibold')}
                    style={{ color: isActionOverdue(a) ? C.danger : C.textPrimary }}
                  >{a.dueAt ? formatDate(a.dueAt) : '—'}</td>
                  <td className={tdClass}>
                    <span
                      className="inline-block rounded-full px-2.5 py-0.5 font-semibold"
                      style={{
                        color: ACTION_STATUS_COLOR[a.status],
                        background: `${ACTION_STATUS_COLOR[a.status]}14`,
                        border: `1px solid ${ACTION_STATUS_COLOR[a.status]}40`,
                      }}
                    >
                      {ACTION_STATUS_LABEL[a.status]}
                    </span>
                  </td>
                  {canWriteActions && (
                    <td className={cn(tdClass, 'whitespace-nowrap')}>
                      <button onClick={() => startEditAction(a)} className="cursor-pointer border-none bg-transparent text-xs font-semibold text-primary">✏️ ערוך</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drilldown && (
        <DefectDrilldownModal
          token={token}
          versionId={versionId}
          screen={drilldown.screen}
          filter={drilldown.filter}
          value={drilldown.value}
          title={drilldown.title}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
};
