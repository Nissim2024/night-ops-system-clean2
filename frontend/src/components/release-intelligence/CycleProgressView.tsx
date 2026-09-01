import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';
import { DefectDrilldownModal } from './DefectDrilldownModal';
import { formatDate } from '../../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Exported — the release-intelligence Home page embeds CyclesPanel with its
// own fetch of this same endpoint and needs the exact same shape, not a
// structurally-similar-but-distinct local copy (spec confirmed 2026-08-31).
export interface CrCoverageRow {
  crNumber: string; crLabel: string;
  passed: number; failed: number; notRun: number; blocked: number; notCompleted: number; notReady: number;
  total: number; coveragePct: number | null;
}
export interface CycleTimelineItem {
  cycleType: string; plannedStart: string; plannedEnd: string; progressPct: number; state: 'done' | 'active' | 'upcoming';
  crCount: number; testerCount: number; defectCount: number; crs: { crNumber: string; crLabel: string }[]; testers: string[];
  coveragePct: number | null; successPct: number | null; crCoverage: CrCoverageRow[]; qgTargetPct: number | null;
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
  STAND_ALONE: 'Stand Alone', UAT: 'UAT', REHEARSAL: 'חזרה גנרלית', GO_LIVE: 'עליה לאוויר',
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
};
const STATUS_SEGMENT_LABEL: Record<string, string> = {
  passed: 'עברו', failed: 'נכשלו', blocked: 'חסומים',
  notCompleted: 'לא הושלמו', notRun: 'לא רצו', notReady: 'לא מוכנים ל-QA',
};

function SegmentedProgressBar({ passed, failed, blocked, notCompleted, notRun, notReady, total, targetPct }: {
  passed: number; failed: number; blocked: number; notCompleted: number; notRun: number; notReady: number;
  total: number; targetPct: number | null;
}) {
  if (total === 0) {
    return <div style={{ height: '8px', background: C.bgNested, borderRadius: RADIUS.sm }} />;
  }
  const segments = [
    { key: 'passed', count: passed },
    { key: 'failed', count: failed },
    { key: 'blocked', count: blocked },
    { key: 'notCompleted', count: notCompleted },
    { key: 'notRun', count: notRun },
    { key: 'notReady', count: notReady },
  ].filter(s => s.count > 0);
  return (
    // The marker lives in its own non-clipping wrapper, outside the bar's own
    // overflow:hidden — otherwise it can't protrude past the bar's edges to
    // stand out (spec confirmed 2026-08-31: "target line needs to be more
    // prominent"). The white-ish halo (boxShadow ring in the card background
    // color) keeps it visible against whichever segment color sits behind it.
    <div style={{ position: 'relative', padding: '3px 0' }}>
      <div style={{ height: '8px', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden', display: 'flex' }}>
        {segments.map(s => (
          <div
            key={s.key}
            title={`${STATUS_SEGMENT_LABEL[s.key]}: ${s.count}`}
            style={{ width: `${(s.count / total) * 100}%`, height: '100%', background: STATUS_SEGMENT_COLOR[s.key] }}
          />
        ))}
      </div>
      {targetPct != null && (
        <div
          title={`יעד QG: ${targetPct}%`}
          style={{
            position: 'absolute', top: 0, bottom: 0, right: `${targetPct}%`, width: '3px',
            background: C.textPrimary, borderRadius: '2px', boxShadow: `0 0 0 1px ${C.bgCard}`,
          }}
        />
      )}
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
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px', background: C.bgNested, color: C.textSecondary,
        border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px',
        fontWeight: WEIGHT.semibold, padding: '6px 14px', marginBottom: SP[3], fontFamily: FONT,
      }}
    >
      → חזרה
    </button>
  );
}

function CycleCard({ c, onShowDetail, onShowDefects }: { c: CycleTimelineItem; onShowDetail: (cycleType: string) => void; onShowDefects: (cycleType: string) => void }) {
  const countdown = useCountdown(c.plannedEnd);
  const color = STATE_COLOR[c.state];
  const hasSuccess = c.successPct != null;
  const qgReached = hasSuccess && c.qgTargetPct != null && (c.successPct as number) >= c.qgTargetPct;
  const successColor = !hasSuccess ? C.textMuted : c.qgTargetPct == null ? C.textPrimary : qgReached ? C.success : C.danger;
  const agg = c.crCoverage.reduce((acc, cr) => ({
    passed: acc.passed + cr.passed, failed: acc.failed + cr.failed, blocked: acc.blocked + cr.blocked,
    notCompleted: acc.notCompleted + cr.notCompleted, notRun: acc.notRun + cr.notRun, notReady: acc.notReady + cr.notReady,
    total: acc.total + cr.total,
  }), { passed: 0, failed: 0, blocked: 0, notCompleted: 0, notRun: 0, notReady: 0, total: 0 });
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderTop: `3px solid ${color}`, borderRadius: RADIUS.lg, padding: SP[4], display: 'flex', flexDirection: 'column', gap: SP[3], minWidth: 0 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
          <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, whiteSpace: 'nowrap' as const }}>{CYCLE_LABEL[c.cycleType] ?? c.cycleType}</span>
          <span style={{ ...TEXT.xs, color, fontWeight: WEIGHT.semibold, whiteSpace: 'nowrap' as const, flexShrink: 0 }}>{STATE_LABEL[c.state]}</span>
        </div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px', direction: 'ltr', textAlign: 'right', whiteSpace: 'nowrap' as const }}>{fmtDate(c.plannedStart)} — {fmtDate(c.plannedEnd)}</div>
      </div>

      <div style={{ display: 'flex', gap: SP[4] }}>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{c.crCount}</div>
          <div style={{ ...TEXT.xs, color: C.textMuted }}>CR-ים</div>
        </div>
        <div
          onClick={() => c.defectCount > 0 && onShowDefects(c.cycleType)}
          style={{ textAlign: 'center', flex: 1, borderRight: `1px solid ${C.border}`, cursor: c.defectCount > 0 ? 'pointer' : 'default' }}
        >
          <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{c.defectCount}</div>
          <div style={{ ...TEXT.xs, color: C.textMuted }}>תקלות שדווחו</div>
        </div>
      </div>

      <div style={{ ...TEXT.xs, color: C.textMuted, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' as const }}>
        🕐 {countdown === 'הסתיים' ? countdown : `${c.state === 'upcoming' ? 'נפתח בעוד' : 'נסגר בעוד'} ${countdown}`}
      </div>

      {/* One bar, every status its own color segment (success/failure/blocked/
          not-completed/not-run/not-ready), QG target marked as a line over it
          — replaces the earlier two-separate-bars design (spec confirmed
          2026-08-31). */}
      <SegmentedProgressBar {...agg} targetPct={c.qgTargetPct} />
      <div style={{ ...TEXT.xs, color: successColor, fontWeight: WEIGHT.semibold, textAlign: 'center', whiteSpace: 'nowrap' as const }}>
        {hasSuccess
          ? `${c.successPct}% הצלחה${c.qgTargetPct != null ? ` (יעד: ${c.qgTargetPct}%)` : ''}`
          : 'אין נתוני הצלחה'}
      </div>

      <button
        onClick={() => onShowDetail(c.cycleType)}
        style={{
          background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md,
          padding: '6px 12px', cursor: c.crCount > 0 ? 'pointer' : 'default', fontSize: '12px', fontFamily: FONT,
          fontWeight: WEIGHT.semibold, opacity: c.crCount > 0 ? 1 : 0.5,
        }}
        disabled={c.crCount === 0}
      >
        ▶ הצג פירוט
      </button>
    </div>
  );
}

function KpiCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', flex: 1, minWidth: '140px' }}>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: valueColor ?? C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
    </div>
  );
}

// Full-screen per-CR coverage breakdown for one cycle — replaces the old
// inline expand-in-card behavior per the user's explicit instruction to
// navigate to a new screen instead (2026-07-28).
function CycleDetailScreen({ cycle, onBack }: { cycle: CycleTimelineItem; onBack: () => void }) {
  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[3] }}>
      <BackButton onClick={onBack} />
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>
        {CYCLE_LABEL[cycle.cycleType] ?? cycle.cycleType} — פירוט התקדמות לפי CR
      </div>
      <div style={{ ...TEXT.xs, color: C.textMuted, direction: 'ltr', textAlign: 'right' }}>{fmtDate(cycle.plannedStart)} — {fmtDate(cycle.plannedEnd)}</div>

      {cycle.crCoverage.length === 0 ? (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], ...TEXT.sm, color: C.textMuted }}>
          אין CR-ים בסבב זה.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
          {cycle.crCoverage.map(cr => {
            const hasData = cr.total > 0;
            const successPct = hasData ? Math.round((cr.passed / cr.total) * 100) : null;
            const qgReached = successPct != null && cycle.qgTargetPct != null && successPct >= cycle.qgTargetPct;
            const color = successPct == null ? C.textMuted : cycle.qgTargetPct == null ? C.textPrimary : qgReached ? C.success : C.danger;
            return (
              <div key={cr.crNumber} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[3] }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>
                    <span style={{ fontWeight: WEIGHT.bold }}>{cr.crNumber}</span>
                    {' — '}
                    {cr.crLabel.replace(/^\d+\s*-\s*/, '')}
                  </div>
                  <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color }}>
                    {successPct != null ? `${successPct}% הצלחה${cycle.qgTargetPct != null ? ` (יעד: ${cycle.qgTargetPct}%)` : ''}` : 'אין נתונים'}
                  </span>
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <SegmentedProgressBar
                    passed={cr.passed} failed={cr.failed} blocked={cr.blocked}
                    notCompleted={cr.notCompleted} notRun={cr.notRun} notReady={cr.notReady}
                    total={cr.total} targetPct={cycle.qgTargetPct}
                  />
                </div>
                {hasData && (
                  <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap', ...TEXT.xs, color: C.textMuted }}>
                    <span>סה״כ: {cr.total}</span>
                    <span style={{ color: C.success }}>עברו: {cr.passed}</span>
                    {cr.failed > 0 && <span style={{ color: C.danger }}>נכשלו: {cr.failed}</span>}
                    {cr.blocked > 0 && <span style={{ color: C.warning }}>חסומים: {cr.blocked}</span>}
                    {cr.notCompleted > 0 && <span>לא הושלמו: {cr.notCompleted}</span>}
                    {cr.notRun > 0 && <span>לא רצו: {cr.notRun}</span>}
                    {cr.notReady > 0 && <span>לא מוכנים ל-QA: {cr.notReady}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
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
    return <CycleDetailScreen cycle={selectedCycle} onBack={() => setSelectedCycleType(null)} />;
  }

  return (
    <div>
      <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: SP[3] }}>סבבים</div>
      {data.timeline.length === 0 ? (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], ...TEXT.sm, color: C.textMuted }}>
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
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(230px, 1fr)', gap: SP[3] }}>
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
    return <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>טוען...</div>;
  if (!data) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🔄 התקדמות סבבים ו-QG</div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <KpiCard value={data.kpis.currentCycle} label="Current Cycle" />
        <KpiCard value={data.kpis.qgStatus === 'PASS' ? '✓ PASS' : '✗ FAIL'} label="QG Status" valueColor={data.kpis.qgStatus === 'PASS' ? C.success : C.danger} />
        <KpiCard value={`${data.kpis.progressPct}%`} label="Progress %" valueColor={C.brand} />
      </div>

      <CyclesPanel data={data} token={token} versionId={versionId} />

      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], maxWidth: '400px' }}>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: SP[3] }}>QG Summary</div>
        {Object.entries(data.qgSummary).map(([key, v]) => (
          <div
            key={key}
            onClick={() => v.count > 0 && setDrilldown({ screen: 'defects', filter: 'severity', value: QG_SEVERITY_LABEL[key] ?? key, title: `תקלות פתוחות — חומרה: ${QG_SEVERITY_LABEL[key] ?? key}` })}
            style={{ display: 'flex', justifyContent: 'space-between', padding: `${SP[1]} 0`, borderBottom: `1px solid ${C.border}`, cursor: v.count > 0 ? 'pointer' : 'default' }}
          >
            <span style={{ ...TEXT.sm, color: C.textPrimary }}>{key}</span>
            <span style={{ ...TEXT.sm, color: v.count > v.threshold ? C.danger : C.textMuted, fontWeight: v.count > v.threshold ? WEIGHT.bold : WEIGHT.normal }}>
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
