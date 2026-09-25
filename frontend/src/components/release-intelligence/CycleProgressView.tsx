import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, WEIGHT } from '../../theme';
import { cn } from '../../lib/utils';
import { DefectDrilldownModal } from './DefectDrilldownModal';
import { formatDate } from '../../utils/dateFormat';
import { PersonAvatar } from '../shared/defectFieldDisplay';
import { BackLink, Select, Spinner } from '../ui';
// './ui' (this directory) resolves the bare '../ui' specifier to the legacy
// ui.tsx file, not the newer Radix-based ui/ folder (file-before-directory
// resolution) — Dialog only exists in the latter, so it needs the explicit
// subpath here rather than the barrel import everything else in this file uses.
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Exported — the release-intelligence Home page embeds CyclesPanel with its
// own fetch of this same endpoint and needs the exact same shape, not a
// structurally-similar-but-distinct local copy (spec confirmed 2026-08-31).
export interface CrCoverageRow {
  crNumber: string; crLabel: string;
  passed: number; failed: number; notRun: number; blocked: number; notCompleted: number; notReady: number;
  notApplicable: number; notRelevant: number;
  total: number; coveragePct: number | null;
  project: string | null; tester: string | null;
  daysRemaining: number;
  defectsBySeverity: { showStopper: number; severe: number; medium: number; low: number };
  // reportedDefectsCount: every defect ever reported against this CR (any
  // status). stillOpenDefectsCount: reported minus only Closed/Canceled —
  // deliberately narrower than "open" elsewhere in the app, which also
  // excludes Rejected/Fixed (feedback 2026-09-14, worded as "לא נסגרו ולא
  // בוטלו" specifically).
  reportedDefectsCount: number;
  stillOpenDefectsCount: number;
  // testingStartDate: this CR's planned test-start in the QA work plan (null
  // if it has no scheduled CR task, e.g. Stand Alone items). notStartedYet:
  // total===0 AND that date is still in the future — the card shows a
  // "testing starts on..." message instead of an empty gauge in that case.
  // qualityScore: CR_QUALITY_TARGET-style score, populated ONLY when this CR
  // is breaching its target (null otherwise) — spec 2026-09-17.
  testingStartDate: string | null;
  notStartedYet: boolean;
  qualityScore: number | null;
}
export interface CycleTimelineItem {
  cycleType: string; plannedStart: string; plannedEnd: string; progressPct: number; state: 'done' | 'active' | 'upcoming';
  crCount: number; testerCount: number; defectCount: number; crs: { crNumber: string; crLabel: string }[]; testers: string[];
  coveragePct: number | null; successPct: number | null; crCoverage: CrCoverageRow[]; qgTargetPct: number | null;
  // Cycle-wide, CR-agnostic script counts (COUNT(DISTINCT TS_TEST_ID) per
  // status, server-side) — matches QC's own Requirements Coverage screen.
  // Summing crCoverage's per-CR rows client-side instead double-counts a
  // test whose requirements span two different CRs (feedback 2026-09-14,
  // ITv06-2026 audit) — use this for any cycle-wide total/bar, not crCoverage.
  scriptCounts: {
    total: number; passed: number; failed: number; blocked: number; notCompleted: number;
    notRun: number; notReady: number; notApplicable: number; notRelevant: number;
  };
}
export interface CycleProgress {
  kpis: { currentCycle: string; qgStatus: 'PASS' | 'FAIL'; progressPct: number };
  qgSummary: Record<string, { count: number; threshold: number }>;
  timeline: CycleTimelineItem[];
}

const STATE_COLOR: Record<CycleTimelineItem['state'], string> = { done: C.success, active: C.brand, upcoming: C.textMuted };
const STATE_LABEL: Record<CycleTimelineItem['state'], string> = { done: 'הושלם', active: 'פעיל', upcoming: 'עתידי' };
const CYCLE_LABEL: Record<string, string> = {
  CYCLE_1: 'סבב 1', CYCLE_2: 'סבב 2', CYCLE_3: 'סבב 3',
  STAND_ALONE: 'Stand Alone Items', UAT: 'UAT', REHEARSAL: 'חזרה גנרלית', GO_LIVE: 'עליה לאוויר',
};
// Maps computeQgSummary's keys (release-intelligence.service.ts) to the real
// DefectDto.severity string — same open-defects-by-severity filter the
// "באגים" screen's bySeverity bars already use, so this reuses screen:
// 'defects', filter: 'severity' rather than inventing a QG-specific filter.
const QG_SEVERITY_LABEL: Record<string, string> = {
  showStopper: 'Show Stopper', severe: 'Severe', medium: 'Medium', low: 'Low',
};

// One segmented bar per cycle/CR — every test status gets its own color
// segment (not just pass/fail lumped against everything else), ordered
// success → failure → the remaining statuses, with the QG target marked as a
// line over the whole thing (spec confirmed 2026-08-31, replacing an earlier
// two-separate-bars design).
const STATUS_SEGMENT_COLOR: Record<string, string> = {
  passed: C.success, failed: C.danger, blocked: C.warning,
  notCompleted: C.statusWaiting, notRun: C.statusOpen, notReady: C.textMuted,
  notApplicable: C.statusRollback, notRelevant: C.statusSkipped,
};
const STATUS_SEGMENT_LABEL: Record<string, string> = {
  passed: 'עברו', failed: 'נכשלו', blocked: 'חסומים',
  notCompleted: 'לא הושלמו', notRun: 'לא רצו', notReady: 'לא מוכנים ל-QA',
  notApplicable: 'לא רלוונטי (N/A)', notRelevant: 'לא רלוונטי',
};

// Same 4 severity buckets/colors as ReleaseIntelligenceHomeView's own
// QG_SEVERITY_META — kept as a separate local copy rather than a shared
// import since that file imports FROM this one (spec confirmed 2026-09-02,
// per-CR open-defects-by-severity chips on the cycle-detail CR cards).
// Exported — CoverageReadinessView reuses it for the exact same chips
// (2026-09-14).
export const CR_DEFECT_SEVERITY_META: Record<string, { label: string; color: string }> = {
  showStopper: { label: 'Show Stopper', color: C.danger },
  severe: { label: 'Severe', color: C.warning },
  medium: { label: 'Medium', color: '#e8af00' },
  low: { label: 'Low', color: C.textMuted },
};

// Days-remaining badge — urgency-colored (red ≤1 day, amber ≤3, neutral
// otherwise), "הסתיים" once the deadline has passed. Deadline is the CR's
// own priority test date when set, else the cycle's end date (spec
// confirmed 2026-09-02).
function DaysRemainingBadge({ days }: { days: number }) {
  const color = days <= 0 ? C.textMuted : days <= 1 ? C.danger : days <= 3 ? C.warning : C.textSecondary;
  const label = days <= 0 ? 'הסתיים' : days === 1 ? 'יום אחד נותר' : `${days} ימים נותרו`;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold rounded-full py-0.5 px-[9px] whitespace-nowrap"
      style={{ color, background: `${color}14`, border: `1px solid ${color}40` }}
    >
      ⏳ {label}
    </span>
  );
}

function SegmentedProgressBar({ passed, failed, blocked, notCompleted, notRun, notReady, notApplicable, notRelevant, total, targetPct }: {
  passed: number; failed: number; blocked: number; notCompleted: number; notRun: number; notReady: number;
  notApplicable: number; notRelevant: number;
  total: number; targetPct: number | null;
}) {
  if (total === 0) {
    return <div className="h-2 bg-muted rounded-sm" />;
  }
  const segments = [
    { key: 'passed', count: passed },
    { key: 'failed', count: failed },
    { key: 'blocked', count: blocked },
    { key: 'notCompleted', count: notCompleted },
    { key: 'notRun', count: notRun },
    { key: 'notReady', count: notReady },
    { key: 'notApplicable', count: notApplicable },
    { key: 'notRelevant', count: notRelevant },
  ].filter(s => s.count > 0);
  return (
    // The marker lives in its own non-clipping wrapper, outside the bar's own
    // overflow:hidden — otherwise it can't protrude past the bar's edges to
    // stand out (spec confirmed 2026-08-31: "target line needs to be more
    // prominent"). The white-ish halo (boxShadow ring in the card background
    // color) keeps it visible against whichever segment color sits behind it.
    <div className="relative py-[3px]">
      <div className="h-2 bg-muted rounded-sm overflow-hidden flex">
        {segments.map(s => (
          <div
            key={s.key}
            title={`${STATUS_SEGMENT_LABEL[s.key]}: ${s.count}`}
            className="h-full"
            style={{ width: `${(s.count / total) * 100}%`, background: STATUS_SEGMENT_COLOR[s.key] }}
          />
        ))}
      </div>
      {targetPct != null && (
        <div
          title={`יעד QG: ${targetPct}%`}
          className="absolute inset-y-0 w-[3px] rounded-[2px]"
          style={{ insetInlineStart: `${targetPct}%`, background: C.textPrimary, boxShadow: `0 0 0 1px ${C.bgCard}` }}
        />
      )}
    </div>
  );
}

// Radial ("clock face") version of SegmentedProgressBar — same 8 statuses,
// same colors, same QG-target marker, just wrapped around a ring instead of
// a straight bar (feedback 2026-09-14: "גרפים של שעונים" for the per-CR
// detail cards, laid out in a wrapping grid instead of one-per-line). 0%
// starts at 12 o'clock (the whole <svg> is rotated -90deg) so segments read
// clockwise like an actual clock face; the success% sits in the ring's
// center, same color logic as the linear bar's own label. Exported —
// CoverageReadinessView reuses the exact same widget for its per-CR,
// all-cycles gauge grid (2026-09-14) rather than a second visual language.
export function RadialSegmentedGauge({
  passed, failed, blocked, notCompleted, notRun, notReady, notApplicable, notRelevant,
  total, targetPct, successPct, size = 84, strokeWidth,
}: {
  passed: number; failed: number; blocked: number; notCompleted: number; notRun: number; notReady: number;
  notApplicable: number; notRelevant: number;
  total: number; targetPct: number | null; successPct: number | null; size?: number; strokeWidth?: number;
}) {
  const ringWidth = strokeWidth ?? Math.max(7, Math.round(size / 9));
  const radius = (size - ringWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const qgReached = successPct != null && targetPct != null && successPct >= targetPct;
  const centerColor = successPct == null ? C.textMuted : targetPct == null ? C.textPrimary : qgReached ? C.success : C.danger;

  const segments = [
    { key: 'passed', count: passed }, { key: 'failed', count: failed }, { key: 'blocked', count: blocked },
    { key: 'notCompleted', count: notCompleted }, { key: 'notRun', count: notRun }, { key: 'notReady', count: notReady },
    { key: 'notApplicable', count: notApplicable }, { key: 'notRelevant', count: notRelevant },
  ].filter(s => s.count > 0);

  let cumulative = 0;
  const arcs = segments.map(s => {
    const fraction = s.count / total;
    const offset = -cumulative * circumference;
    cumulative += fraction;
    return { key: s.key, count: s.count, dash: fraction * circumference, offset };
  });

  // Target tick — a short radial line crossing the ring at targetPct, same
  // role as the linear bar's vertical marker. Computed in the SAME
  // (unrotated) coordinate space as the segments — the whole <svg>'s own
  // -90deg CSS rotation carries this along with them.
  const targetAngle = targetPct != null ? (targetPct / 100) * 2 * Math.PI : null;
  const tick = targetAngle != null ? {
    x1: center + (radius - ringWidth / 2 - 2) * Math.cos(targetAngle),
    y1: center + (radius - ringWidth / 2 - 2) * Math.sin(targetAngle),
    x2: center + (radius + ringWidth / 2 + 2) * Math.cos(targetAngle),
    y2: center + (radius + ringWidth / 2 + 2) * Math.sin(targetAngle),
  } : null;

  return (
    <div className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={center} cy={center} r={radius} fill="none" stroke={C.bgHover} strokeWidth={ringWidth} />
        {arcs.map(a => (
          <circle
            key={a.key} cx={center} cy={center} r={radius} fill="none"
            stroke={STATUS_SEGMENT_COLOR[a.key]} strokeWidth={ringWidth}
            strokeDasharray={`${a.dash} ${circumference - a.dash}`} strokeDashoffset={a.offset}
          >
            <title>{`${STATUS_SEGMENT_LABEL[a.key]}: ${a.count}`}</title>
          </circle>
        ))}
        {tick && (
          <line x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} stroke={C.textPrimary} strokeWidth={2}>
            <title>{`יעד QG: ${targetPct}%`}</title>
          </line>
        )}
      </svg>
      <div className="absolute font-bold" style={{ color: centerColor, fontSize: Math.max(13, Math.round(size / 5.5)) }}>
        {successPct != null ? `${successPct.toFixed(2)}%` : '—'}
      </div>
    </div>
  );
}

// "Closing in Xd Yh Zm" — live countdown to plannedEnd, ticking every second
// while a cycle is active/upcoming. A finished cycle just shows "הסתיים",
// no countdown (there's nothing left to count down to). Independent of the
// coverage-based progress bar below — the countdown stays time-based per the
// user's explicit instruction to keep it as-is (2026-07-28).
function useCountdown(targetIso: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = new Date(targetIso).getTime() - now;
  if (diff <= 0) return 'הסתיים';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  if (days > 0) return `${days}י ${hours}ש ${mins}ד`;
  if (hours > 0) return `${hours}ש ${mins}ד ${secs}שנ`;
  return `${mins}ד ${secs}שנ`;
}

function BackButton({ onClick }: { onClick: () => void }) {
  return <BackLink onClick={onClick} style={{ marginBottom: '12px' }} />;
}

function CycleCard({ c, onShowDetail, onShowDefects }: { c: CycleTimelineItem; onShowDetail: (cycleType: string) => void; onShowDefects: (cycleType: string) => void }) {
  const countdown = useCountdown(c.plannedEnd);
  const color = STATE_COLOR[c.state];
  const hasSuccess = c.successPct != null;
  const qgReached = hasSuccess && c.qgTargetPct != null && (c.successPct as number) >= c.qgTargetPct;
  const successColor = !hasSuccess ? C.textMuted : c.qgTargetPct == null ? C.textPrimary : qgReached ? C.success : C.danger;
  const agg = c.scriptCounts;
  return (
    <div
      className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3 min-w-0"
      style={{ borderTop: `3px solid ${color}` }}
    >
      <div>
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-sm font-bold text-foreground whitespace-nowrap">{CYCLE_LABEL[c.cycleType] ?? c.cycleType}</span>
          <span className="text-xs font-semibold whitespace-nowrap shrink-0" style={{ color }}>{STATE_LABEL[c.state]}</span>
        </div>
        <div className="text-xs text-subtle-foreground mt-0.5 text-right whitespace-nowrap" dir="ltr">{fmtDate(c.plannedStart)} — {fmtDate(c.plannedEnd)}</div>
      </div>

      <div className="flex gap-4">
        <div className="text-center flex-1">
          <div className="text-lg font-bold text-foreground">{c.crCount}</div>
          <div className="text-xs text-subtle-foreground">CR-ים</div>
        </div>
        <div
          onClick={() => c.defectCount > 0 && onShowDefects(c.cycleType)}
          className={cn('text-center flex-1 border-e border-border', c.defectCount > 0 ? 'cursor-pointer' : 'cursor-default')}
        >
          <div className="text-lg font-bold text-foreground">{c.defectCount}</div>
          <div className="text-xs text-subtle-foreground">תקלות שדווחו</div>
        </div>
      </div>

      <div className="text-xs text-subtle-foreground flex items-center gap-1 whitespace-nowrap">
        🕐 {countdown === 'הסתיים' ? countdown : `${c.state === 'upcoming' ? 'נפתח בעוד' : 'נסגר בעוד'} ${countdown}`}
      </div>

      {/* One bar, every status its own color segment (success/failure/blocked/
          not-completed/not-run/not-ready), QG target marked as a line over it
          — replaces the earlier two-separate-bars design (spec confirmed
          2026-08-31). */}
      <SegmentedProgressBar {...agg} targetPct={c.qgTargetPct} />
      <div className="text-xs font-semibold text-center whitespace-nowrap" style={{ color: successColor }}>
        {hasSuccess
          ? `${c.successPct}% הצלחה${c.qgTargetPct != null ? ` (יעד: ${c.qgTargetPct}%)` : ''}`
          : 'אין נתוני הצלחה'}
      </div>

      <button
        onClick={() => onShowDetail(c.cycleType)}
        className={cn(
          'bg-muted text-muted-foreground border border-border rounded-md py-1.5 px-3 text-xs font-semibold',
          c.crCount > 0 ? 'cursor-pointer opacity-100' : 'cursor-default opacity-50'
        )}
        disabled={c.crCount === 0}
      >
        ▶ הצג פירוט
      </button>
    </div>
  );
}

function KpiCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg py-4 px-5 flex-1 min-w-[140px]">
      <div className="text-xl font-bold leading-tight text-foreground" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
      <div className="text-xs text-subtle-foreground mt-[3px]">{label}</div>
    </div>
  );
}

// Full-screen per-CR coverage breakdown for one cycle — replaces the old
// inline expand-in-card behavior per the user's explicit instruction to
// navigate to a new screen instead (2026-07-28).
function CycleDetailScreen({ cycle, onBack, token, versionId }: { cycle: CycleTimelineItem; onBack: () => void; token: string; versionId: string }) {
  const [projectFilter, setProjectFilter] = useState('');
  const [testerFilter, setTesterFilter] = useState('');
  // UAT-only "הצג סיכום בדיקות" button (spec 2026-09-17) — RQ_USER_26 pulled
  // on demand per CR, not prefetched for the whole cycle (avoids N Oracle
  // round-trips for CRs nobody actually opens).
  const [summaryModal, setSummaryModal] = useState<{ crNumber: string; crLabel: string; loading: boolean; error: string | null; text: string | null } | null>(null);
  const openTestSummary = async (cr: CrCoverageRow) => {
    setSummaryModal({ crNumber: cr.crNumber, crLabel: cr.crLabel, loading: true, error: null, text: null });
    try {
      const res = await axios.get(`${API}/qc/cr-test-summary`, {
        params: { crNumber: cr.crNumber, versionId },
        headers: { Authorization: `Bearer ${token}` },
      });
      setSummaryModal({ crNumber: cr.crNumber, crLabel: cr.crLabel, loading: false, error: null, text: res.data ?? null });
    } catch (e: any) {
      setSummaryModal({ crNumber: cr.crNumber, crLabel: cr.crLabel, loading: false, error: e?.response?.data?.message || e.message || 'שגיאה בטעינת הסיכום', text: null });
    }
  };
  const projectOptions = Array.from(new Set(cycle.crCoverage.map(cr => cr.project).filter((p): p is string => !!p))).sort();
  const testerOptions = Array.from(new Set(cycle.crCoverage.map(cr => cr.tester).filter((t): t is string => !!t))).sort();
  const filteredCrCoverage = cycle.crCoverage.filter(cr =>
    (!projectFilter || cr.project === projectFilter) && (!testerFilter || cr.tester === testerFilter)
  );
  return (
    <div className="flex flex-col gap-3">
      <BackButton onClick={onBack} />
      <div className="text-lg font-bold text-foreground">
        {CYCLE_LABEL[cycle.cycleType] ?? cycle.cycleType} — פירוט התקדמות לפי CR
      </div>
      <div className="text-xs text-subtle-foreground text-right" dir="ltr">{fmtDate(cycle.plannedStart)} — {fmtDate(cycle.plannedEnd)}</div>

      {(projectOptions.length > 0 || testerOptions.length > 0) && (
        <div className="flex gap-3 flex-wrap items-center">
          {projectOptions.length > 0 && (
            <Select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}>
              <option value="">כל הפרויקטים</option>
              {projectOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
          )}
          {testerOptions.length > 0 && (
            <Select value={testerFilter} onChange={e => setTesterFilter(e.target.value)}>
              <option value="">כל הבודקים</option>
              {testerOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          )}
          {(projectFilter || testerFilter) && (
            <span className="text-xs text-subtle-foreground">{filteredCrCoverage.length} מתוך {cycle.crCoverage.length} CR-ים</span>
          )}
        </div>
      )}

      {filteredCrCoverage.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-4 text-sm text-subtle-foreground">
          {cycle.crCoverage.length === 0 ? 'אין CR-ים בסבב זה.' : 'אין CR-ים התואמים את הסינון.'}
        </div>
      ) : (
        // Wrapping grid of "clock" gauges instead of one full-width row per CR
        // (feedback 2026-09-14) — as many cards per row as fit at ≥240px
        // each, wrapping to more rows rather than shrinking or scrolling.
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
          {filteredCrCoverage.map(cr => {
            const hasData = cr.total > 0;
            const successPct = hasData ? Math.round((cr.passed / cr.total) * 10000) / 100 : null;
            const openDefectsTotal = Object.values(cr.defectsBySeverity).reduce((s, n) => s + n, 0);
            return (
              <div key={cr.crNumber} className="bg-card border border-border rounded-lg p-3 flex flex-col items-center gap-2 text-center">
                <div className="w-full text-sm font-semibold text-foreground min-w-0" title={`${cr.crNumber} — ${cr.crLabel.replace(/^\d+\s*-\s*/, '')}`}>
                  <span className="font-bold">{cr.crNumber}</span>
                  {' — '}
                  <span className="line-clamp-1">{cr.crLabel.replace(/^\d+\s*-\s*/, '')}</span>
                </div>

                {/* notStartedYet (2026-09-17): an empty 0% gauge read as "no
                    progress / at risk" for a CR whose testing window simply
                    hasn't opened yet — show the scheduled start date instead
                    of a misleading gauge. */}
                {cr.notStartedYet && cr.testingStartDate ? (
                  <div className="flex flex-col items-center justify-center gap-1 py-4" style={{ width: 96, height: 96 }}>
                    <span className="text-xl">⏳</span>
                    <span className="text-xs text-subtle-foreground">בדיקות יחלו ב-{formatDate(cr.testingStartDate)}</span>
                  </div>
                ) : (
                  // Gauge is the card's dominant visual (feedback 2026-09-14:
                  // "יותר מרשומות" — chose the big-gauge layout over the
                  // earlier compact side-by-side one).
                  <RadialSegmentedGauge
                    passed={cr.passed} failed={cr.failed} blocked={cr.blocked}
                    notCompleted={cr.notCompleted} notRun={cr.notRun} notReady={cr.notReady}
                    notApplicable={cr.notApplicable} notRelevant={cr.notRelevant}
                    total={cr.total} targetPct={cycle.qgTargetPct} successPct={successPct}
                    size={96}
                  />
                )}

                {(cr.project || cr.tester) && (
                  <div className="flex gap-2 flex-wrap justify-center text-xs text-subtle-foreground">
                    {cr.project && <span className="truncate">📁 {cr.project}</span>}
                    {cr.tester && <span className="inline-flex items-center gap-1">בודק: <PersonAvatar name={cr.tester} full /></span>}
                  </div>
                )}

                <div className="flex items-center gap-3 flex-wrap justify-center">
                  <DaysRemainingBadge days={cr.daysRemaining} />
                  {/* stillOpenDefectsCount/reportedDefectsCount — how many
                      defects were ever reported against this CR, and how many
                      of those are still not Closed and not Canceled (narrower
                      than this screen's usual "open" — Rejected/Fixed count
                      as still-open here, unlike elsewhere). */}
                  {cr.reportedDefectsCount > 0 && (
                    <span
                      className="inline-flex items-center gap-1 text-xs font-semibold rounded-full py-0.5 px-[9px] whitespace-nowrap"
                      style={{ color: C.danger, background: `${C.danger}14`, border: `1px solid ${C.danger}40` }}
                    >
                      🐞 {cr.stillOpenDefectsCount}/{cr.reportedDefectsCount}
                    </span>
                  )}
                  {/* Quality score chip — only rendered when qualityByCr flagged
                      this CR as breaching target (spec 2026-09-17: "רק כאשר
                      הוא חורג"), never for a CR that meets it. */}
                  {cr.qualityScore != null && (
                    <span
                      className="inline-flex items-center gap-1 text-xs font-semibold rounded-full py-0.5 px-[9px] whitespace-nowrap"
                      style={{ color: '#e8af00', background: '#e8af0014', border: '1px solid #e8af0040' }}
                      title="מדד איכות CR חורג מהיעד (0.15)"
                    >
                      🎯 {cr.qualityScore.toFixed(2)}
                    </span>
                  )}
                </div>

                {/* Visible severity breakdown of currently-open defects — was
                    hover-tooltip-only, moved into the card itself per the
                    user's explicit request (2026-09-17: "בדומה לתצוגה 5
                    Severe 13 Medium 8 Low"). */}
                {openDefectsTotal > 0 && (
                  <div className="flex flex-wrap justify-center gap-x-2 gap-y-0.5 text-xs text-subtle-foreground">
                    {Object.entries(cr.defectsBySeverity).filter(([, n]) => n > 0).map(([key, n]) => (
                      <span key={key} style={{ whiteSpace: 'nowrap' }}>
                        <span className="font-bold" style={{ color: CR_DEFECT_SEVERITY_META[key].color }}>{n}</span>
                        {' '}{CR_DEFECT_SEVERITY_META[key].label}
                      </span>
                    ))}
                  </div>
                )}

                {/* Only on UAT cycle CR cards, per the user's explicit scope
                    (2026-09-17) — RQ_USER_26 is a UAT-stage sign-off field,
                    not meaningful for the earlier core cycles. */}
                {cycle.cycleType === 'UAT' && (
                  <button
                    onClick={() => openTestSummary(cr)}
                    className="text-xs font-semibold text-primary bg-transparent border-none cursor-pointer hover:underline"
                  >
                    📋 הצג סיכום בדיקות
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!summaryModal} onOpenChange={(open: boolean) => !open && setSummaryModal(null)}>
        <DialogContent className="max-w-2xl w-[90vw] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>📋 סיכום בדיקות — {summaryModal?.crNumber}{summaryModal?.crLabel ? ` — ${summaryModal.crLabel.replace(/^\d+\s*-\s*/, '')}` : ''}</DialogTitle>
          </DialogHeader>
          {summaryModal?.loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-subtle-foreground">
              <Spinner /> טוען סיכום מ-QC...
            </div>
          )}
          {summaryModal?.error && (
            <div className="bg-danger-bg border border-danger/25 rounded-md p-3 text-sm text-danger whitespace-pre-wrap">
              {summaryModal.error}
            </div>
          )}
          {!summaryModal?.loading && !summaryModal?.error && (
            summaryModal?.text ? (
              <div className="bg-muted border border-border rounded-lg p-4 text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                {summaryModal.text}
              </div>
            ) : (
              <div className="text-sm text-subtle-foreground text-center py-6">אין סיכום בדיקות עבור CR זה.</div>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const fmtDate = (iso: string) => formatDate(iso);

interface Props { token: string; versionId?: string; role: string; }

// The "סבבים" grid (CycleCard per cycle, countdown clock, per-CR detail
// drill-down, defect drilldown) — factored out so the release-intelligence
// Home page can embed the exact same widget unchanged, instead of the whole
// screen (spec confirmed 2026-08-31: "cycles panel stays as it is, with the
// countdown clock"). Takes already-fetched `data` rather than fetching its
// own copy — the parent screen (CycleProgressView or the Home page) owns the
// single fetch and passes it down, so embedding this doesn't double the
// network round-trip when the full screen also needs the same data for its
// KPI row / QG Summary.
export const CyclesPanel: React.FC<{ data: CycleProgress; token: string; versionId: string }> = ({ data, token, versionId }) => {
  const [selectedCycleType, setSelectedCycleType] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<{ screen: string; filter: string; value?: string; title: string } | null>(null);

  const selectedCycle = selectedCycleType ? data.timeline.find(t => t.cycleType === selectedCycleType) : null;
  if (selectedCycle) {
    return <CycleDetailScreen cycle={selectedCycle} onBack={() => setSelectedCycleType(null)} token={token} versionId={versionId} />;
  }

  return (
    <div>
      <div className="text-sm font-bold text-foreground mb-3">סבבים</div>
      {data.timeline.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-4 text-sm text-subtle-foreground">
          אין תוכנית עבודת QA לגרסה זו.
        </div>
      ) : (
        // One row, no wrap — gridAutoFlow:'column' keeps every card in a
        // single row (never drops to a second row), and gridAutoColumns'
        // 230px minimum is wide enough for the card's own text (dates,
        // countdown, success%) to stay on one line without truncating; if
        // all cards together don't fit the viewport, the row scrolls
        // horizontally instead of shrinking/cutting text (spec confirmed
        // 2026-08-31).
        <div className="overflow-x-auto">
          <div className="grid grid-flow-col auto-cols-[minmax(230px,1fr)] gap-3">
            {data.timeline.map(c => (
              <CycleCard
                key={c.cycleType} c={c} onShowDetail={setSelectedCycleType}
                onShowDefects={cycleType => setDrilldown({ screen: 'cycle-progress', filter: 'cycleDefects', value: cycleType, title: `תקלות שדווחו — ${CYCLE_LABEL[cycleType] ?? cycleType}` })}
              />
            ))}
          </div>
        </div>
      )}

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

export const CycleProgressView: React.FC<Props> = ({ token, versionId }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<CycleProgress | null>(null);
  const [loading, setLoading] = useState(false);
  // Separate from CyclesPanel's own internal drilldown state (cycle-defects) —
  // this one is for the QG Summary widget's severity-based drilldown below.
  const [drilldown, setDrilldown] = useState<{ screen: string; filter: string; value?: string; title: string } | null>(null);

  const load = useCallback(() => {
    if (!versionId) { setData(null); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/cycle-progress/${versionId}`, { headers })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);

  useEffect(() => { load(); }, [load]);

  if (!versionId) {
    return <div className="text-center p-8 text-subtle-foreground">בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div className="p-6 text-subtle-foreground">טוען...</div>;
  if (!data) return <div className="p-6 text-subtle-foreground">לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="text-lg font-bold text-foreground">🔄 התקדמות סבבים ו-QG</div>

      <div className="flex gap-3 flex-wrap">
        <KpiCard value={CYCLE_LABEL[data.kpis.currentCycle] ?? data.kpis.currentCycle} label="סבב נוכחי" />
        <KpiCard value={data.kpis.qgStatus === 'PASS' ? '✓ PASS' : '✗ FAIL'} label="סטטוס QG" valueColor={data.kpis.qgStatus === 'PASS' ? C.success : C.danger} />
        <KpiCard value={`${data.kpis.progressPct}%`} label="אחוז התקדמות" valueColor={C.brand} />
      </div>

      <CyclesPanel data={data} token={token} versionId={versionId} />

      <div className="bg-card border border-border rounded-lg p-4 max-w-[400px]">
        <div className="text-sm font-bold text-foreground mb-3">סיכום QG</div>
        {Object.entries(data.qgSummary).map(([key, v]) => (
          <div
            key={key}
            onClick={() => v.count > 0 && setDrilldown({ screen: 'defects', filter: 'severity', value: QG_SEVERITY_LABEL[key] ?? key, title: `תקלות פתוחות — חומרה: ${QG_SEVERITY_LABEL[key] ?? key}` })}
            className={cn('flex justify-between py-1 border-b border-border', v.count > 0 ? 'cursor-pointer' : 'cursor-default')}
          >
            <span className="text-sm text-foreground">{key}</span>
            <span className={cn('text-sm', v.count > v.threshold ? 'text-danger font-bold' : 'text-subtle-foreground font-normal')}>
              {v.count} / {v.threshold}
            </span>
          </div>
        ))}
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
