import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, RADIUS } from '../../theme';
import { Card, Badge } from '../ui';
import { DefectDrilldownModal } from './DefectDrilldownModal';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface SeverityCount { severity: string; count: number; }
interface BreakdownRow { label: string; count: number; bySeverity: SeverityCount[]; }
interface BugDashboardDto {
  reported: number;
  open: number;
  rejected: number;
  production: number;
  regression: number;
  changes: number;
  reopen: number;
  targetTotal: number;
  targetOpen: number;
  movedToNext: number;
  dailyReported: { date: string; count: number }[];
  openByType: BreakdownRow[];
  openByResponsibility: BreakdownRow[];
  openByCr: BreakdownRow[];
  openByStatus: BreakdownRow[];
}

interface Props { token: string; initialVersionId?: string; }

const pct = (n: number, total: number) => total > 0 ? `${((n / total) * 100).toFixed(2)}%` : '0%';

// Same 4 severities used throughout the app (CRITICAL_SEVERITIES etc.) — a
// bare "ללא סיווג" bucket catches anything else without crashing.
const SEVERITY_COLOR: Record<string, string> = {
  'Show Stopper': C.danger, 'Severe': C.warning, 'Medium': '#e8af00', 'Low': C.textMuted, 'ללא סיווג': C.statusOpen,
};
const SEVERITY_ORDER = ['Show Stopper', 'Severe', 'Medium', 'Low', 'ללא סיווג'];

function SeverityLegend() {
  return (
    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', ...TEXT.xs, color: C.textMuted, marginBottom: '8px' }}>
      {SEVERITY_ORDER.map(s => (
        <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: SEVERITY_COLOR[s], display: 'inline-block' }} />
          {s}
        </span>
      ))}
    </div>
  );
}

const KpiCard: React.FC<{ label: string; value: string; sub?: string; color: string; onClick?: () => void }> = ({ label, value, sub, color, onClick }) => (
  <Card padding={4} style={{ flex: 1, minWidth: '110px', textAlign: 'center', cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
    <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, marginBottom: '4px', whiteSpace: 'nowrap' }}>{label}</div>
    <div style={{ fontSize: '26px', fontWeight: WEIGHT.bold, color, fontFamily: FONT, lineHeight: 1.1 }}>{value}</div>
    {sub && <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, marginTop: '2px' }}>{sub}</div>}
  </Card>
);

// Each row's bar is now segmented by severity (Show Stopper/Severe/Medium/Low)
// instead of one flat brand-colored bar, so "Open By Type/Responsibility/CR"
// also answers "how bad", not just "how many" (spec confirmed 2026-09-04).
// Rows are click targets into the exact defect list behind them, same
// drill-down convention every other screen in this module already uses.
const BreakdownPanel: React.FC<{ title: string; total: number; rows: BreakdownRow[]; onSelect: (label: string) => void }> = ({ title, total, rows, onSelect }) => {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <Card padding={4} style={{ flex: 1, minWidth: '260px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, fontFamily: FONT }}>{title}</div>
        <Badge color={C.textMuted} bg={C.bgHover}>{total}</Badge>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '260px', overflowY: 'auto' }}>
        {rows.length === 0 && <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>אין נתונים</div>}
        {rows.map(r => (
          <div key={r.label} onClick={() => onSelect(r.label)} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <div style={{ ...TEXT.xs, color: C.textSecondary, fontFamily: FONT, width: '140px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</div>
            <div style={{ flex: 1, height: '14px', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden', display: 'flex' }}>
              {r.bySeverity.map(s => (
                <div key={s.severity} title={`${s.severity}: ${s.count}`} style={{ width: `${(s.count / max) * 100}%`, height: '100%', background: SEVERITY_COLOR[s.severity] ?? SEVERITY_COLOR['ללא סיווג'] }} />
              ))}
            </div>
            <div style={{ ...TEXT.xs, color: C.textPrimary, fontFamily: FONT, width: '24px', textAlign: 'left' }}>{r.count}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

const DailyTrendChart: React.FC<{ data: { date: string; count: number }[]; onPointClick?: (date: string) => void }> = ({ data, onPointClick }) => {
  if (data.length === 0) {
    return <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, padding: '20px', textAlign: 'center' }}>אין נתוני מגמה</div>;
  }
  const width = 720, height = 140, padX = 30, padY = 20;
  const max = Math.max(1, ...data.map(d => d.count));
  const stepX = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = padX + i * stepX;
    const y = height - padY - (d.count / max) * (height - padY * 2);
    return { x, y, d };
  });
  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  const hitW = Math.max(8, stepX || 12);

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <polyline points={polyline} fill="none" stroke={C.brand} strokeWidth={2} />
      {points.map((p, i) => (
        <g key={i} onClick={onPointClick ? () => onPointClick(p.d.date) : undefined} style={{ cursor: onPointClick ? 'pointer' : 'default' }}>
          {/* full-height invisible hit target so the whole column is clickable */}
          <rect x={p.x - hitW / 2} y={0} width={hitW} height={height} fill="transparent" />
          <circle cx={p.x} cy={p.y} r={onPointClick ? 4 : 3} fill={C.brand} />
          <text x={p.x} y={p.y - 8} fontSize="11" fill={C.textPrimary} textAnchor="middle" fontFamily={FONT}>{p.d.count}</text>
          {i % labelEvery === 0 && (
            <text x={p.x} y={height - 4} fontSize="10" fill={C.textMuted} textAnchor="middle" fontFamily={FONT}>
              {new Date(p.d.date).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
};

export const QcBugDashboardView: React.FC<Props> = ({ token, initialVersionId }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  // The version is driven entirely by the sidebar picker (BRD 2026-09-07 §4) —
  // no in-page selector anymore (spec 2026-09-07: "הסר את בורר הגרסאות מדף לוח הבאגים").
  const selectedVId = initialVersionId ?? '';
  const [dashboard, setDashboard] = useState<BugDashboardDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qcMock, setQcMock] = useState(true);
  const [drilldown, setDrilldown] = useState<{ filter: string; value?: string; title: string } | null>(null);

  useEffect(() => {
    axios.get(`${API}/qc/status`, { headers })
      .then(r => setQcMock(!r.data?.enabled))
      .catch(() => setQcMock(true));
  }, [headers]);

  const loadDashboard = useCallback(async (vId: string) => {
    if (!vId) { setDashboard(null); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API}/qc/bug-dashboard?versionId=${vId}`, { headers });
      setDashboard(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'שגיאה בטעינת נתוני QC');
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { loadDashboard(selectedVId); }, [selectedVId, loadDashboard]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px 28px', fontFamily: FONT }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '22px' }}>🪲</span>
          <div style={{ fontSize: '18px', fontWeight: WEIGHT.bold, color: C.textPrimary }}>לוח באגים (QC)</div>
          {qcMock && (
            <span style={{ fontSize: '13px', background: C.bgInProgress, color: C.statusInProgress, padding: '3px 10px', borderRadius: '10px', border: `1px solid ${C.statusInProgress}44` }}>Mock — ממתין לחיבור QC</span>
          )}
        </div>
      </Card>

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: C.textMuted }}>טוען...</div>}
      {error && <div style={{ textAlign: 'center', padding: '24px', color: C.danger }}>{error}</div>}
      {!loading && !error && !selectedVId && (
        <div style={{ textAlign: 'center', padding: '24px', color: C.textMuted }}>בחר גרסה מהתפריט הצדדי כדי להציג נתוני באגים</div>
      )}

      {!loading && !error && dashboard && (
        <>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <KpiCard label="תקלות שדווחו" value={String(dashboard.reported)} color={C.textPrimary}
              onClick={() => setDrilldown({ filter: 'reported', title: 'כל התקלות שדווחו' })} />
            <KpiCard label="תקלות פתוחות" value={String(dashboard.open)} sub={pct(dashboard.open, dashboard.reported)} color={C.statusInProgress}
              onClick={() => setDrilldown({ filter: 'open', title: 'תקלות פתוחות' })} />
            <KpiCard label="תקלות שנדחו" value={String(dashboard.rejected)} sub={pct(dashboard.rejected, dashboard.reported)} color={C.textMuted}
              onClick={() => setDrilldown({ filter: 'rejected', title: 'תקלות שנדחו' })} />
            {/* Production/Regression drill by BG_USER_10 = 'Production'/'Regression'
                (spec 2026-09-07). */}
            <KpiCard label="תקלות ייצור" value={String(dashboard.production)} sub={pct(dashboard.production, dashboard.reported)} color={C.danger}
              onClick={() => setDrilldown({ filter: 'production', title: 'תקלות ייצור (BG_USER_10 = Production)' })} />
            <KpiCard label="תקלות רגרסיה" value={String(dashboard.regression)} sub={pct(dashboard.regression, dashboard.reported)} color={C.danger}
              onClick={() => setDrilldown({ filter: 'regression', title: 'תקלות רגרסיה (BG_USER_10 = Regression)' })} />
            <KpiCard label="שינויים (CR)" value={String(dashboard.changes)} sub={pct(dashboard.changes, dashboard.reported)} color={C.brand}
              onClick={() => setDrilldown({ filter: 'changes', title: 'תקלות מסוג Change Requests' })} />
            <KpiCard label="נפתחו מחדש" value={String(dashboard.reopen)} sub={pct(dashboard.reopen, dashboard.reported)} color={C.statusFailed}
              onClick={() => setDrilldown({ filter: 'reopen', title: 'תקלות שנפתחו מחדש (Reopen) — לפי היסטוריה' })} />
            <KpiCard label="נותרו ליעד" value={`${dashboard.targetOpen}/${dashboard.targetTotal}`} color={C.statusDone}
              onClick={() => setDrilldown({ filter: 'target', title: 'תקלות מגרסאות קודמות שהיעד שלהן הוא גרסה זו' })} />
            {/* Mirror of "נותרו ליעד": defects opened in THIS release whose
                BG_TARGET_REL is set — i.e. deferred forward (spec 2026-09-09). */}
            <KpiCard label="עוברות לגרסה הבאה" value={String(dashboard.movedToNext)} sub={pct(dashboard.movedToNext, dashboard.reported)} color={C.brand}
              onClick={() => setDrilldown({ filter: 'moved-to-next', title: 'תקלות שנפתחו בגרסה זו ומועברות לגרסה הבאה (שדה TARGET מאוכלס)' })} />
          </div>

          <Card>
            <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, marginBottom: '8px' }}>דיווח יומי <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.normal }}>· לחיצה על נקודה = התקלות שדווחו באותו יום</span></div>
            <DailyTrendChart
              data={dashboard.dailyReported}
              onPointClick={date => setDrilldown({
                filter: 'day',
                value: date,
                title: `תקלות שדווחו בתאריך ${new Date(date).toLocaleDateString('he-IL')}`,
              })}
            />
          </Card>

          <SeverityLegend />
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <BreakdownPanel title="פתוחות לפי סטטוס" total={dashboard.open} rows={dashboard.openByStatus}
              onSelect={label => setDrilldown({ filter: 'status', value: label, title: `תקלות פתוחות — סטטוס: ${label}` })} />
            <BreakdownPanel title="פתוחות לפי סוג" total={dashboard.open} rows={dashboard.openByType}
              onSelect={label => setDrilldown({ filter: 'type', value: label, title: `תקלות פתוחות — סוג: ${label}` })} />
            <BreakdownPanel title="פתוחות לפי אחראי" total={dashboard.open} rows={dashboard.openByResponsibility}
              onSelect={label => setDrilldown({ filter: 'responsibility', value: label, title: `תקלות פתוחות — אחראי: ${label}` })} />
            <BreakdownPanel title="פתוחות לפי CR" total={dashboard.open} rows={dashboard.openByCr}
              onSelect={label => setDrilldown({ filter: 'cr', value: label, title: `תקלות פתוחות — CR: ${label}` })} />
          </div>
        </>
      )}

      {drilldown && selectedVId && (
        <DefectDrilldownModal
          token={token}
          versionId={selectedVId}
          screen="bug-dashboard"
          filter={drilldown.filter}
          value={drilldown.value}
          title={drilldown.title}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
};

export default QcBugDashboardView;
