import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';
import { DefectDrilldownModal } from './DefectDrilldownModal';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface CrCoverageRow {
  crNumber: string; crLabel: string;
  passed: number; failed: number; notRun: number; blocked: number; notCompleted: number; notReady: number;
  total: number; coveragePct: number | null;
}
interface CycleTimelineItem {
  cycleType: string; plannedStart: string; plannedEnd: string; progressPct: number; state: 'done' | 'active' | 'upcoming';
  crCount: number; testerCount: number; defectCount: number; crs: { crNumber: string; crLabel: string }[]; testers: string[];
  coveragePct: number | null; crCoverage: CrCoverageRow[]; qgTargetPct: number | null;
}
interface CycleProgress {
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
  const hasCoverage = c.coveragePct != null;
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderTop: `3px solid ${color}`, borderRadius: RADIUS.lg, padding: SP[4], display: 'flex', flexDirection: 'column', gap: SP[3] }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{CYCLE_LABEL[c.cycleType] ?? c.cycleType}</span>
          <span style={{ ...TEXT.xs, color, fontWeight: WEIGHT.semibold }}>{STATE_LABEL[c.state]}</span>
        </div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px', direction: 'ltr', textAlign: 'right' }}>{fmtDate(c.plannedStart)} — {fmtDate(c.plannedEnd)}</div>
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

      <div style={{ ...TEXT.xs, color: C.textMuted, display: 'flex', alignItems: 'center', gap: '4px' }}>
        🕐 {countdown === 'הסתיים' ? countdown : `${c.state === 'upcoming' ? 'נפתח בעוד' : 'נסגר בעוד'} ${countdown}`}
      </div>

      {/* Progress bar = test coverage (% of planned tests executed), not time
          elapsed — the countdown above is the only time-based indicator now.
          The vertical tick marks the cycle's real QG target (RELEASE_CYCLES.
          QG_HIGH) — a marker on the bar, not baked into its fill/color, per
          the user's explicit choice (2026-07-28). */}
      <div style={{ height: '6px', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden', position: 'relative' }}>
        <div style={{ width: `${hasCoverage ? c.coveragePct : 0}%`, height: '100%', background: hasCoverage ? color : C.border, borderRadius: RADIUS.sm }} />
        {c.qgTargetPct != null && (
          <div
            title={`יעד QG: ${c.qgTargetPct}%`}
            style={{ position: 'absolute', top: 0, bottom: 0, right: `${c.qgTargetPct}%`, width: '2px', background: C.textPrimary, opacity: 0.7 }}
          />
        )}
      </div>
      <div style={{ ...TEXT.xs, color: C.textMuted, textAlign: 'left' }}>
        {hasCoverage
          ? `${c.coveragePct}% כיסוי בדיקות${c.qgTargetPct != null ? ` (יעד: ${c.qgTargetPct}%)` : ''}`
          : 'אין נתוני כיסוי'}
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
            const pct = cr.coveragePct;
            const hasCoverage = pct != null;
            const color = pct == null ? C.textMuted : pct >= 100 ? C.success : pct >= 50 ? C.brand : C.warning;
            return (
              <div key={cr.crNumber} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[3] }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>
                    <span style={{ fontWeight: WEIGHT.bold }}>{cr.crNumber}</span>
                    {' — '}
                    {cr.crLabel.replace(/^\d+\s*-\s*/, '')}
                  </div>
                  <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color }}>
                    {hasCoverage ? `${pct}%` : 'אין נתונים'}
                  </span>
                </div>
                <div style={{ height: '6px', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden', marginBottom: '8px' }}>
                  <div style={{ width: `${pct ?? 0}%`, height: '100%', background: hasCoverage ? color : C.border, borderRadius: RADIUS.sm }} />
                </div>
                {hasCoverage && (
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

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });

interface Props { token: string; versionId?: string; role: string; }

export const CycleProgressView: React.FC<Props> = ({ token, versionId }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<CycleProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedCycleType, setSelectedCycleType] = useState<string | null>(null);
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

  useEffect(() => { load(); setSelectedCycleType(null); }, [load]);

  if (!versionId) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>טוען...</div>;
  if (!data) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  const selectedCycle = selectedCycleType ? data.timeline.find(t => t.cycleType === selectedCycleType) : null;
  if (selectedCycle) {
    return <CycleDetailScreen cycle={selectedCycle} onBack={() => setSelectedCycleType(null)} />;
  }

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🔄 התקדמות סבבים ו-QG</div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <KpiCard value={data.kpis.currentCycle} label="Current Cycle" />
        <KpiCard value={data.kpis.qgStatus === 'PASS' ? '✓ PASS' : '✗ FAIL'} label="QG Status" valueColor={data.kpis.qgStatus === 'PASS' ? C.success : C.danger} />
        <KpiCard value={`${data.kpis.progressPct}%`} label="Progress %" valueColor={C.brand} />
      </div>

      <div>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: SP[3] }}>סבבים</div>
        {data.timeline.length === 0 ? (
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], ...TEXT.sm, color: C.textMuted }}>
            אין תוכנית עבודת QA לגרסה זו.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: SP[3] }}>
            {data.timeline.map(c => (
              <CycleCard
                key={c.cycleType} c={c} onShowDetail={setSelectedCycleType}
                onShowDefects={cycleType => setDrilldown({ screen: 'cycle-progress', filter: 'cycleDefects', value: cycleType, title: `תקלות שדווחו — ${CYCLE_LABEL[cycleType] ?? cycleType}` })}
              />
            ))}
          </div>
        )}
      </div>

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
