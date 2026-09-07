import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';
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
  return <span style={{ display: 'inline-block', width: '9px', height: '9px', borderRadius: '50%', background: color, flexShrink: 0 }} />;
}

function KpiCard({ value, label, color, onClick }: { value: string; label: string; color?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative', background: C.bgCard, border: `1px solid ${C.border}`, borderTop: color ? `3px solid ${color}` : undefined,
        borderRadius: RADIUS.lg, padding: '14px 18px', flex: '1 1 130px', minWidth: '130px',
        cursor: onClick ? 'pointer' : 'default',
      }}
      onMouseEnter={onClick ? e => { (e.currentTarget as HTMLElement).style.borderColor = C.brand; } : undefined}
      onMouseLeave={onClick ? e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; } : undefined}
    >
      {onClick && <span style={{ position: 'absolute', top: '10px', insetInlineEnd: '12px', ...TEXT.xs, color: C.textDisabled }}>←</span>}
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: color ?? C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
    </div>
  );
}

// Release Health = simple average of 4 equal-weighted 0-100 sub-scores
// (release-intelligence.service.ts). ≥70 GO, 40-69 CONDITIONAL_GO, <40 NO_GO.
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
      <div style={{ ...TEXT.xs, color: C.textMuted, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '10px 14px' }}>
        🩺 מדד מוכנות הגרסה — טרם חושב. ייחשב לאחר כניסה לדף הבית של ניהול הבדיקות.
      </div>
    );
  }
  const meta = HEALTH_REC_META[health.recommendation];
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderTop: `3px solid ${meta.color}`, borderRadius: RADIUS.lg, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: SP[4], flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <span style={{ fontSize: '15px' }}>🩺</span>
        <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.semibold }}>מוכנות הגרסה</span>
        <span style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: meta.color, fontVariantNumeric: 'tabular-nums' }}>{health.score}</span>
        <span style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: meta.color }}>{meta.label}</span>
      </div>
      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        {HEALTH_PARTS.map(([k, label]) => {
          const v = health.breakdown[k];
          return (
            <span key={k} style={{ ...TEXT.xs, color: C.textMuted }}>
              {label} <span style={{ fontWeight: WEIGHT.semibold, fontVariantNumeric: 'tabular-nums', color: v < 50 ? C.danger : v < 80 ? C.warning : C.textSecondary }}>{v}</span>
            </span>
          );
        })}
      </div>
      <span style={{ ...TEXT.xs, color: C.textDisabled, marginInlineStart: 'auto' }}>
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
      <button onClick={() => onOverride(override === v ? null : v)} style={{
        padding: '3px 12px', borderRadius: RADIUS.sm, border: 'none', cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold,
        background: active ? C.bgCard : 'transparent', color: active ? C.textPrimary : C.textMuted,
      }}>{label}</button>
    );
  };
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: SP[3], flexWrap: 'wrap', ...TEXT.xs, color: C.textMuted }}>
      <span>🎯 יעדים יומיים מחושבים ל<strong style={{ color: C.textPrimary }}>{meta.targetDay === 'today' ? 'היום' : 'מחר'}</strong></span>
      <div style={{ display: 'flex', gap: '2px', background: C.bgNested, borderRadius: RADIUS.md, padding: '2px' }}>
        {btn('today', 'היום')}
        {btn('tomorrow', 'מחר')}
      </div>
      {override && <span style={{ color: '#e8af00' }}>(נבחר ידנית · <button onClick={() => onOverride(null)} style={{ background: 'none', border: 'none', color: C.brand, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, padding: 0, textDecoration: 'underline' }}>אוטומטי לפי שעת {meta.standupCutoff}</button>)</span>}
      <span style={{ marginInlineStart: 'auto' }}>
        {deadlineText}
        {meta.workDaysLeft != null && ` · ${meta.workDaysLeft} ימי עבודה נותרו`}
        {!meta.hasSnapshot && ' · "בוצע היום" יופיע אחרי הצילום הלילי הראשון'}
      </span>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px', ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textMuted,
  textAlign: 'right', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px', ...TEXT.sm, color: C.textPrimary, borderBottom: `1px solid ${C.border}`,
};
const inputStyle: React.CSSProperties = {
  padding: '6px 9px', borderRadius: RADIUS.sm, border: `1px solid ${C.borderEm}`,
  background: C.bgCard, color: C.textPrimary, fontFamily: FONT, ...TEXT.xs, boxSizing: 'border-box', width: '100%',
};

// Shared CR-risk table body — used both by Release View's single flat list
// and Team View's per-team sections (spec: "אותו מנגנון משרת גם Daily גרסה
// וגם Daily צוות").
// Click a row to drill into its blockers/team assignment (real DailyBlocker
// catalog rows, matched by crNumber — no drill-down for the Blockers *count*
// itself, since that's a QC script-status tally with no underlying listable
// record). Click the Defects count specifically (stopPropagation, so it
// doesn't also toggle the row) to open the shared DefectDrilldownModal.
function DeltaCell({ delta }: { delta: number | null }) {
  if (delta == null) return <span style={{ color: C.textDisabled }}>—</span>;
  const color = delta > 0 ? C.success : delta < 0 ? C.danger : C.textMuted;
  return <span style={{ color, fontWeight: delta !== 0 ? WEIGHT.semibold : WEIGHT.normal, fontVariantNumeric: 'tabular-nums' }}>{delta > 0 ? `+${delta}` : delta}</span>;
}

function CrRiskTable({ rows, blockers, emptyMessage, onShowDefects, targetDay }: {
  rows: DailyCrRow[]; blockers: Blocker[]; emptyMessage: string; onShowDefects: (crNumber: string, crLabel: string) => void;
  targetDay: 'today' | 'tomorrow';
}) {
  const [expandedCr, setExpandedCr] = useState<string | null>(null);
  if (rows.length === 0) {
    return <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>{emptyMessage}</div>;
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={thStyle}>CR</th>
          <th style={thStyle}>בודק</th>
          <th style={thStyle}>התקדמות</th>
          <th style={thStyle}>בוצע היום</th>
          <th style={thStyle}>יעד {targetDay === 'today' ? 'להיום' : 'למחר'}</th>
          <th style={thStyle}>תקלות</th>
          <th style={thStyle}>חסמים</th>
          <th style={thStyle}>סיכון</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(cr => {
          const crBlockers = blockers.filter(b => b.crNumber === cr.crNumber);
          const expanded = expandedCr === cr.crNumber;
          return (
            <React.Fragment key={cr.crNumber}>
              <tr title={cr.reasons.join(' · ')} onClick={() => setExpandedCr(v => v === cr.crNumber ? null : cr.crNumber)} style={{ cursor: 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: WEIGHT.semibold }}>{cr.crNumber}{cr.crLabel ? ` — ${cr.crLabel.replace(/^\d+\s*-\s*/, '')}` : ''}</td>
                <td style={{ ...tdStyle, color: cr.tester ? C.textPrimary : C.textMuted }}>{cr.tester ? <PersonAvatar name={cr.tester} full /> : '—'}</td>
                <td style={tdStyle}>{cr.progressPct}%</td>
                <td style={tdStyle}><DeltaCell delta={cr.passedDelta} /></td>
                <td style={tdStyle} title={`נותרו ${cr.remaining} תרחישים${cr.mustFinishNow ? ' — עבר יעד הסבב, יש לסיים בהקדם' : ''}`}>
                  {cr.dailyTarget == null
                    ? <span style={{ color: C.textDisabled }}>—</span>
                    : <span style={{ fontWeight: WEIGHT.semibold, fontVariantNumeric: 'tabular-nums', color: cr.mustFinishNow ? C.danger : C.textPrimary }}>{cr.dailyTarget}{cr.mustFinishNow ? ' ⚠' : ''}</span>}
                </td>
                <td style={tdStyle}>
                  {cr.defectCount > 0 ? (
                    <span onClick={e => { e.stopPropagation(); onShowDefects(cr.crNumber, cr.crLabel); }} style={{ color: C.danger, textDecoration: 'underline', cursor: 'pointer' }}>
                      {cr.defectCount}
                    </span>
                  ) : cr.defectCount}
                </td>
                <td style={{ ...tdStyle, color: cr.blockerCount > 0 ? C.danger : C.textPrimary }}>{cr.blockerCount}</td>
                <td style={tdStyle}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: RISK_COLOR[cr.risk], fontWeight: WEIGHT.semibold }}>
                    <StatusDot color={RISK_COLOR[cr.risk]} />
                    {RISK_LABEL[cr.risk]}
                  </span>
                </td>
              </tr>
              {expanded && (
                <tr>
                  <td colSpan={8} style={{ padding: '4px 10px 12px', borderBottom: `1px solid ${C.border}`, background: C.bgNested }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', ...TEXT.xs }}>
                      <div style={{ color: C.textSecondary }}>
                        צוותים: {cr.teams.length > 0 ? cr.teams.map(t => t.name).join(', ') : 'ללא שיוך צוות'}
                      </div>
                      {crBlockers.length === 0 ? (
                        <div style={{ color: C.textMuted }}>אין חסמים רשומים ל-CR זה.</div>
                      ) : crBlockers.map(b => (
                        <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', color: C.textSecondary, padding: '3px 6px' }}>
                          <span>{b.title} ({BLOCKER_TYPE_LABEL[b.type] ?? b.type})</span>
                          <span style={{ fontWeight: WEIGHT.semibold, color: b.status === 'OPEN' ? C.danger : C.success }}>{b.status === 'OPEN' ? 'פתוח' : 'נסגר'}</span>
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
      <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>
        בחר גרסה מתפריט הצד כדי לראות את ה-Daily שלה.
      </div>
    );
  }

  if (loading && !data) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>טוען...</div>;
  }

  if (!data) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>לא ניתן לטעון נתונים עבור גרסה זו.</div>;
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
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📋 ניהול QA יומי</div>
        <div style={{ display: 'flex', gap: '2px', background: C.bgNested, borderRadius: RADIUS.md, padding: '2px' }}>
          {(['RELEASE', 'TEAM'] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)} style={{
              padding: '5px 14px', borderRadius: RADIUS.sm, border: 'none', cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold,
              background: viewMode === m ? C.bgCard : 'transparent', color: viewMode === m ? C.textPrimary : C.textMuted,
            }}>
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
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[3], display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>
            מאתמול ({formatDate(diff.sinceDate)}) → היום
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: SP[4] }}>
            <span style={{ ...TEXT.sm, color: diff.testsPassedDelta >= 0 ? C.success : C.danger, fontWeight: WEIGHT.semibold }}>
              {diff.testsPassedDelta >= 0 ? '+' : ''}{diff.testsPassedDelta} תרחישים עברו
            </span>
            <span style={{ ...TEXT.sm, color: diff.openDefectsDelta > 0 ? C.danger : C.textMuted, fontWeight: WEIGHT.semibold }}>
              {diff.openDefectsDelta >= 0 ? '+' : ''}{diff.openDefectsDelta} תקלות פתוחות
            </span>
            <span style={{ ...TEXT.sm, color: diff.openBlockersDelta < 0 ? C.success : diff.openBlockersDelta > 0 ? C.danger : C.textMuted, fontWeight: WEIGHT.semibold }}>
              {diff.openBlockersDelta > 0 ? '+' : ''}{diff.openBlockersDelta} חסמים פתוחים
            </span>
          </div>
          {(diff.crsMovedToHighRisk.length > 0 || diff.testersNoUpdates.length > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingTop: '4px', borderTop: `1px solid ${C.border}` }}>
              {diff.crsMovedToHighRisk.map(cr => (
                <div key={cr} style={{ ...TEXT.sm, color: C.danger, fontWeight: WEIGHT.semibold }}>⚠️ {cr} עבר לסיכון גבוה</div>
              ))}
              {diff.testersNoUpdates.map(t => (
                <div key={t.tester} style={{ ...TEXT.sm, color: C.danger, fontWeight: WEIGHT.semibold }}>⚠️ {t.tester} — ללא עדכון {t.days} ימים</div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ ...TEXT.xs, color: C.textMuted, padding: '2px 2px' }}>אין עדיין נתוני השוואה ליום הקודם — הצילום הראשון ירוץ הלילה.</div>
      ))}

      {/* ── אזור 6: התראות אוטומטיות — קודם כל, כדי שהמשתמש ייכנס ישר למה שדורש דיון ── */}
      {alerts.length > 0 && (
        <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}40`, borderRadius: RADIUS.lg, padding: SP[3], display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {alerts.map((a, i) => (
            <div key={i} style={{ ...TEXT.sm, color: C.danger, fontWeight: WEIGHT.semibold }}>{a}</div>
          ))}
        </div>
      )}

      {/* ── אזור 1: Executive Summary — כל כרטיס עם דריל לרשומות/לסקציה הרלוונטית ── */}
      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
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
        <h2 style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: '0.06em', margin: '4px 0 8px' }}>מפת חום — בודקים</h2>
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflowX: 'auto' }}>
          {testers.length === 0 ? (
            <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>אין בודקים משובצים לגרסה זו.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>בודק</th>
                  <th style={thStyle}>התקדמות</th>
                  <th style={thStyle}>CR</th>
                  <th style={thStyle}>בוצע היום</th>
                  <th style={thStyle}>יעד {dailyTargets.targetDay === 'today' ? 'להיום' : 'למחר'}</th>
                  <th style={thStyle}>תקלות</th>
                  <th style={thStyle}>חסמים</th>
                  <th style={thStyle}>סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {testers.map(t => (
                  <React.Fragment key={t.tester}>
                    <tr onClick={() => setExpandedTester(v => v === t.tester ? null : t.tester)} style={{ cursor: 'pointer' }}>
                      <td style={{ ...tdStyle, fontWeight: WEIGHT.semibold }}>{t.tester && t.tester !== 'לא משויך' ? <PersonAvatar name={t.tester} full /> : t.tester}</td>
                      <td style={tdStyle}>{t.progressPct}%</td>
                      <td style={tdStyle}>{t.crCount}</td>
                      <td style={tdStyle}><DeltaCell delta={t.doneToday} /></td>
                      <td style={{ ...tdStyle, fontWeight: WEIGHT.semibold, fontVariantNumeric: 'tabular-nums' }}>{t.dailyTarget > 0 ? t.dailyTarget : <span style={{ color: C.textDisabled, fontWeight: WEIGHT.normal }}>—</span>}</td>
                      <td style={tdStyle}>
                        {t.defectCount > 0 ? (
                          <span onClick={e => { e.stopPropagation(); showTesterDefects(t.tester); }} style={{ color: C.danger, textDecoration: 'underline', cursor: 'pointer' }}>
                            {t.defectCount}
                          </span>
                        ) : t.defectCount}
                      </td>
                      <td style={{ ...tdStyle, color: t.blockerCount > 0 ? C.danger : C.textPrimary }}>{t.blockerCount}</td>
                      <td style={tdStyle}><StatusDot color={STATUS_COLOR[t.status]} /></td>
                    </tr>
                    {expandedTester === t.tester && (
                      <tr>
                        <td colSpan={8} style={{ padding: '4px 10px 12px', borderBottom: `1px solid ${C.border}`, background: C.bgNested }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {t.crs.map(cr => (
                              <div key={cr.crNumber} style={{ display: 'flex', justifyContent: 'space-between', ...TEXT.xs, color: C.textSecondary, padding: '3px 6px' }}>
                                <span>{cr.crNumber}{cr.crLabel ? ` — ${cr.crLabel.replace(/^\d+\s*-\s*/, '')}` : ''}</span>
                                <span style={{ fontWeight: WEIGHT.semibold }}>{cr.progressPct}%</span>
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
          <h2 style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: '0.06em', margin: '4px 0 8px' }}>CR-ים בסיכון</h2>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflowX: 'auto' }}>
            <CrRiskTable rows={crs} blockers={blockers} emptyMessage="אין CR-ים משובצים לגרסה זו." onShowDefects={showCrDefects} targetDay={dailyTargets.targetDay} />
          </div>
        </div>
      ) : teamSections.length === 0 ? (
        <div>
          <h2 style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: '0.06em', margin: '4px 0 8px' }}>CR-ים בסיכון לפי צוות</h2>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg }}>
            <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>אין CR-ים משובצים לגרסה זו.</div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SP[3] }}>
          {teamSections.map(([teamName, rows]) => (
            <div key={teamName}>
              <h2 style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: '0.06em', margin: '4px 0 8px' }}>
                {teamName} <span style={{ color: C.textMuted, fontWeight: WEIGHT.normal }}>({rows.length})</span>
              </h2>
              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflowX: 'auto' }}>
                <CrRiskTable rows={rows} blockers={blockers} emptyMessage="אין CR-ים משובצים לצוות זה." onShowDefects={showCrDefects} targetDay={dailyTargets.targetDay} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── אזור 4: מרכז חסמים ── */}
      <div id="daily-blockers">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 8px' }}>
          <h2 style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: '0.06em', margin: 0 }}>מרכז חסמים</h2>
          {canWriteBlockers && !addingBlocker && (
            <button onClick={startAddBlocker} style={{ padding: '5px 14px', background: C.brand, color: '#fff', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold }}>
              + חסם חדש
            </button>
          )}
        </div>
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>חסם</th>
                <th style={thStyle}>סוג</th>
                <th style={thStyle}>CR</th>
                <th style={thStyle}>אחראי</th>
                <th style={thStyle}>ימים פתוח</th>
                <th style={thStyle}>סטטוס</th>
                {canWriteBlockers && <th style={thStyle}></th>}
              </tr>
            </thead>
            <tbody>
              {(addingBlocker || editingBlockerId) && (
                <tr style={{ background: C.bgHover }}>
                  <td style={tdStyle}>
                    <input autoFocus value={blockerDraft.title} onChange={e => setBlockerDraft(d => ({ ...d, title: e.target.value }))} placeholder="תיאור החסם…" style={{ ...inputStyle, minWidth: '180px' }} />
                  </td>
                  <td style={tdStyle}>
                    <select value={blockerDraft.type} onChange={e => setBlockerDraft(d => ({ ...d, type: e.target.value }))} style={inputStyle}>
                      {BLOCKER_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td style={tdStyle}>
                    <input value={blockerDraft.crNumber} onChange={e => setBlockerDraft(d => ({ ...d, crNumber: e.target.value }))} placeholder="CR…" style={inputStyle} />
                  </td>
                  <td style={tdStyle}>
                    <select
                      value={ownerSelectValue(blockerDraft.ownerName, people)}
                      onChange={e => setBlockerDraft(d => ({ ...d, ownerName: e.target.value === OWNER_OTHER ? '' : e.target.value }))}
                      style={{ ...inputStyle, marginBottom: ownerSelectValue(blockerDraft.ownerName, people) === OWNER_OTHER ? '6px' : 0 }}
                    >
                      <option value="">— אחראי —</option>
                      {people.map(p => <option key={p.userId} value={p.fullName}>{p.fullName}</option>)}
                      <option value={OWNER_OTHER}>אחר…</option>
                    </select>
                    {ownerSelectValue(blockerDraft.ownerName, people) === OWNER_OTHER && (
                      <input value={blockerDraft.ownerName} onChange={e => setBlockerDraft(d => ({ ...d, ownerName: e.target.value }))} placeholder="פרט…" style={inputStyle} />
                    )}
                  </td>
                  <td style={tdStyle}>—</td>
                  <td style={tdStyle}>—</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' as const }}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={saveBlocker} disabled={savingBlocker || !blockerDraft.title.trim()} style={{ padding: '5px 12px', background: C.brand, color: '#fff', border: 'none', borderRadius: RADIUS.sm, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold, opacity: savingBlocker || !blockerDraft.title.trim() ? 0.6 : 1 }}>
                        {savingBlocker ? '...' : 'שמור'}
                      </button>
                      <button onClick={cancelBlocker} disabled={savingBlocker} style={{ padding: '5px 12px', background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs }}>
                        ביטול
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {blockers.length === 0 && !addingBlocker && (
                <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: C.textMuted, padding: SP[5] }}>אין חסמים רשומים לגרסה זו.</td></tr>
              )}
              {blockers.map(b => editingBlockerId === b.id ? null : (
                <tr key={b.id}>
                  <td style={{ ...tdStyle, fontWeight: WEIGHT.semibold, textDecoration: b.status === 'RESOLVED' ? 'line-through' : undefined, color: b.status === 'RESOLVED' ? C.textMuted : C.textPrimary }}>{b.title}</td>
                  <td style={tdStyle}>{BLOCKER_TYPE_LABEL[b.type] ?? b.type}</td>
                  <td style={tdStyle}>{b.crNumber || '—'}</td>
                  <td style={tdStyle}>{b.ownerName || '—'}</td>
                  <td style={{ ...tdStyle, color: b.status === 'OPEN' && daysOpen(b) > 2 ? C.danger : C.textPrimary, fontWeight: b.status === 'OPEN' && daysOpen(b) > 2 ? WEIGHT.semibold : undefined }}>{daysOpen(b)}</td>
                  <td style={tdStyle}>
                    <span style={{
                      display: 'inline-block', color: b.status === 'OPEN' ? C.danger : C.success, fontWeight: WEIGHT.semibold,
                      background: `${b.status === 'OPEN' ? C.danger : C.success}14`, border: `1px solid ${b.status === 'OPEN' ? C.danger : C.success}40`,
                      borderRadius: RADIUS.full, padding: '2px 9px',
                    }}>
                      {b.status === 'OPEN' ? 'פתוח' : 'נסגר'}
                    </span>
                  </td>
                  {canWriteBlockers && (
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' as const }}>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button onClick={() => startEditBlocker(b)} style={{ background: 'transparent', border: 'none', color: C.brand, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold }}>✏️ ערוך</button>
                        {canCloseBlockers && (
                          <button onClick={() => toggleBlockerStatus(b)} style={{ background: 'transparent', border: 'none', color: b.status === 'OPEN' ? C.success : C.textMuted, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold }}>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 8px' }}>
          <h2 style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: '0.06em', margin: 0 }}>משימות לביצוע</h2>
          {canWriteActions && !addingAction && (
            <button onClick={startAddAction} style={{ padding: '5px 14px', background: C.brand, color: '#fff', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold }}>
              + משימה חדשה
            </button>
          )}
        </div>
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>משימה</th>
                <th style={thStyle}>אחראי</th>
                <th style={thStyle}>יעד</th>
                <th style={thStyle}>סטטוס</th>
                {canWriteActions && <th style={thStyle}></th>}
              </tr>
            </thead>
            <tbody>
              {(addingAction || editingActionId) && (
                <tr style={{ background: C.bgHover }}>
                  <td style={tdStyle}>
                    <input autoFocus value={actionDraft.title} onChange={e => setActionDraft(d => ({ ...d, title: e.target.value }))} placeholder="תיאור המשימה…" style={{ ...inputStyle, minWidth: '200px' }} />
                  </td>
                  <td style={tdStyle}>
                    <select
                      value={ownerSelectValue(actionDraft.ownerName, people)}
                      onChange={e => setActionDraft(d => ({ ...d, ownerName: e.target.value === OWNER_OTHER ? '' : e.target.value }))}
                      style={{ ...inputStyle, marginBottom: ownerSelectValue(actionDraft.ownerName, people) === OWNER_OTHER ? '6px' : 0 }}
                    >
                      <option value="">— אחראי —</option>
                      {people.map(p => <option key={p.userId} value={p.fullName}>{p.fullName}</option>)}
                      <option value={OWNER_OTHER}>אחר…</option>
                    </select>
                    {ownerSelectValue(actionDraft.ownerName, people) === OWNER_OTHER && (
                      <input value={actionDraft.ownerName} onChange={e => setActionDraft(d => ({ ...d, ownerName: e.target.value }))} placeholder="פרט…" style={inputStyle} />
                    )}
                  </td>
                  <td style={tdStyle}>
                    <input type="date" value={actionDraft.dueAt} onChange={e => setActionDraft(d => ({ ...d, dueAt: e.target.value }))} style={inputStyle} />
                  </td>
                  <td style={tdStyle}>
                    <select value={actionDraft.status} onChange={e => setActionDraft(d => ({ ...d, status: e.target.value as ActionItemStatus }))} style={inputStyle}>
                      {ACTION_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' as const }}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={saveAction} disabled={savingAction || !actionDraft.title.trim()} style={{ padding: '5px 12px', background: C.brand, color: '#fff', border: 'none', borderRadius: RADIUS.sm, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold, opacity: savingAction || !actionDraft.title.trim() ? 0.6 : 1 }}>
                        {savingAction ? '...' : 'שמור'}
                      </button>
                      <button onClick={cancelAction} disabled={savingAction} style={{ padding: '5px 12px', background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs }}>
                        ביטול
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {actions.length === 0 && !addingAction && (
                <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: C.textMuted, padding: SP[5] }}>אין משימות רשומות לגרסה זו.</td></tr>
              )}
              {actions.map(a => editingActionId === a.id ? null : (
                <tr key={a.id}>
                  <td style={{ ...tdStyle, fontWeight: WEIGHT.semibold, textDecoration: a.status === 'DONE' || a.status === 'CANCELED' ? 'line-through' : undefined, color: a.status === 'DONE' || a.status === 'CANCELED' ? C.textMuted : C.textPrimary }}>{a.title}</td>
                  <td style={tdStyle}>{a.ownerName || '—'}</td>
                  <td style={{ ...tdStyle, color: isActionOverdue(a) ? C.danger : C.textPrimary, fontWeight: isActionOverdue(a) ? WEIGHT.semibold : undefined }}>{a.dueAt ? formatDate(a.dueAt) : '—'}</td>
                  <td style={tdStyle}>
                    <span style={{
                      display: 'inline-block', color: ACTION_STATUS_COLOR[a.status], fontWeight: WEIGHT.semibold,
                      background: `${ACTION_STATUS_COLOR[a.status]}14`, border: `1px solid ${ACTION_STATUS_COLOR[a.status]}40`,
                      borderRadius: RADIUS.full, padding: '2px 9px',
                    }}>
                      {ACTION_STATUS_LABEL[a.status]}
                    </span>
                  </td>
                  {canWriteActions && (
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' as const }}>
                      <button onClick={() => startEditAction(a)} style={{ background: 'transparent', border: 'none', color: C.brand, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold }}>✏️ ערוך</button>
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
