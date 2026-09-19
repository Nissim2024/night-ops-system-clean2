import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { cn } from '../../lib/utils';
import { Card, Badge } from '../ui';
import { DefectDrilldownModal } from './DefectDrilldownModal';
import { DefectDetailScreen } from '../quality-hub/OpenProdDefectsView';
import { hasHebrew, StatusBadge, SeverityBadge } from '../shared/defectFieldDisplay';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface SeverityCount { severity: string; count: number; }
interface BreakdownRow { label: string; count: number; bySeverity: SeverityCount[]; }
interface OldestOpenRow { id: string; title: string; severity: string; status: string; discoveryDate: string; ageDays: number; }
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
  oldestOpen: OldestOpenRow[];
}

interface Props { token: string; initialVersionId?: string; }

const pct = (n: number, total: number) => total > 0 ? `${((n / total) * 100).toFixed(2)}%` : '0%';

// Same 4 severities used throughout the app (CRITICAL_SEVERITIES etc.) — a
// bare "ללא סיווג" bucket catches anything else without crashing. These stay
// as raw theme hex (not Tailwind classes) because the value is picked at
// render time from row data, same precedent as StatusChip/PriorityChip in ui.tsx.
const SEVERITY_COLOR: Record<string, string> = {
  'Show Stopper': C.danger, 'Severe': C.warning, 'Medium': '#e8af00', 'Low': C.textMuted, 'ללא סיווג': C.statusOpen,
};
const SEVERITY_ORDER = ['Show Stopper', 'Severe', 'Medium', 'Low', 'ללא סיווג'];

function SeverityLegend() {
  return (
    <div className="mb-2 flex flex-wrap gap-2.5 text-xs text-subtle-foreground">
      {SEVERITY_ORDER.map(s => (
        <span key={s} className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: SEVERITY_COLOR[s] }} />
          {s}
        </span>
      ))}
    </div>
  );
}

// Colors are chosen per call-site (a fixed semantic meaning, not row data),
// so they map onto Tailwind's semantic text tokens directly.
const KpiCard: React.FC<{ label: string; value: string; sub?: string; colorClass: string; onClick?: () => void }> = ({ label, value, sub, colorClass, onClick }) => (
  <Card padding={4} style={{ flex: 1, minWidth: '110px', textAlign: 'center', cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
    <div className="mb-1 whitespace-nowrap text-xs text-subtle-foreground">{label}</div>
    <div className={cn('text-[26px] font-bold leading-[1.1]', colorClass)}>{value}</div>
    {sub && <div className="mt-0.5 text-xs text-subtle-foreground">{sub}</div>}
  </Card>
);

// Each row's bar is now segmented by severity (Show Stopper/Severe/Medium/Low)
// instead of one flat brand-colored bar, so "Open By Type/Responsibility/CR"
// also answers "how bad", not just "how many" (spec confirmed 2026-09-04).
// Rows are click targets into the exact defect list behind them, same
// drill-down convention every other screen in this module already uses.
//
// Sizing is controlled entirely by the caller now (no inline flex/minWidth
// here) — 2026-09-19 redesign put "לפי CR" in its own wide column and the
// other three in a narrower stacked column, so a fixed self-opinionated size
// would fight whichever wrapper each one ends up in.
//
// Labels used to be a fixed 140px, single-line, ellipsis-truncated (spec
// 2026-08-30-era) — CR names and responsibility/team strings are often much
// longer than that, so most of the list was unreadable without hovering for
// the tooltip. Labels now wrap up to full width (`wide` gets more of the
// row; `compact` keeps a smaller share since its column is narrower) —
// wrapping instead of clipping is the actual fix (spec 2026-09-19: "שים לב
// שניתן לראות את רוב המלל בצורה ידידותית"); the title tooltip stays as a
// harmless fallback.
const BreakdownPanel: React.FC<{ title: string; total: number; rows: BreakdownRow[]; onSelect: (label: string) => void; wide?: boolean }> = ({ title, total, rows, onSelect, wide }) => {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <Card padding={4}>
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <Badge color={C.textMuted} bg={C.bgHover}>{total}</Badge>
      </div>
      <div className={cn('flex flex-col gap-2 overflow-y-auto', wide ? 'max-h-[440px]' : 'max-h-[220px]')}>
        {rows.length === 0 && <div className="text-xs text-subtle-foreground">אין נתונים</div>}
        {rows.map(r => (
          <div key={r.label} onClick={() => onSelect(r.label)} className="flex cursor-pointer items-start gap-2">
            <div className={cn('flex-shrink-0 break-words text-xs leading-snug text-muted-foreground', wide ? 'w-[38%]' : 'w-[46%]')} title={r.label}>
              {r.label}
            </div>
            <div className="mt-0.5 flex h-3.5 flex-1 overflow-hidden rounded-sm bg-muted">
              {r.bySeverity.map(s => (
                <div key={s.severity} title={`${s.severity}: ${s.count}`} style={{ width: `${(s.count / max) * 100}%`, background: SEVERITY_COLOR[s.severity] ?? SEVERITY_COLOR['ללא סיווג'] }} className="h-full" />
              ))}
            </div>
            <div className="mt-0.5 w-6 flex-shrink-0 text-left text-xs text-foreground">{r.count}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

// "Oldest still-open" (spec 2026-09-19, user's pick over a severity-summary
// chart and an open-vs-closed trend — most actionable of the three: tells
// you what to triage next instead of another aggregate view). Deliberately a
// compact list, not a chart, so it sits quietly in the left column instead of
// competing for space. Clicking a row opens the real defect detail screen
// directly (same shared DefectDetailScreen every other defect click in the
// app uses) rather than going through the filter-based drilldown modal,
// since there's already exactly one specific defect ID to jump to.
const OldestOpenPanel: React.FC<{ rows: OldestOpenRow[]; onSelect: (id: string) => void }> = ({ rows, onSelect }) => (
  <Card padding={4}>
    <div className="mb-2.5 flex items-center justify-between">
      <div className="text-sm font-semibold text-foreground">התקלות הפתוחות הכי ותיקות</div>
      <Badge color={C.textMuted} bg={C.bgHover}>{rows.length}</Badge>
    </div>
    <div className="flex flex-col gap-1.5">
      {rows.length === 0 && <div className="text-xs text-subtle-foreground">אין תקלות פתוחות</div>}
      {rows.map(r => (
        <div key={r.id} onClick={() => onSelect(r.id)} className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-muted">
          <div className="w-11 flex-shrink-0 text-left text-xs font-bold text-danger">{r.ageDays}י׳</div>
          <div className={cn('min-w-0 flex-1 break-words text-xs text-foreground', hasHebrew(r.title) ? 'text-right' : 'text-left')} title={r.title}>
            {r.title}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            <SeverityBadge severity={r.severity} />
            <StatusBadge status={r.status} />
          </div>
        </div>
      ))}
    </div>
  </Card>
);

const DailyTrendChart: React.FC<{ data: { date: string; count: number }[]; onPointClick?: (date: string) => void }> = ({ data, onPointClick }) => {
  if (data.length === 0) {
    return <div className="p-5 text-center text-xs text-subtle-foreground">אין נתוני מגמה</div>;
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
          <text x={p.x} y={p.y - 8} fontSize="11" fill={C.textPrimary} textAnchor="middle">{p.d.count}</text>
          {i % labelEvery === 0 && (
            <text x={p.x} y={height - 4} fontSize="10" fill={C.textMuted} textAnchor="middle">
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
  const [selectedDefectId, setSelectedDefectId] = useState<string | null>(null);

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

  if (selectedDefectId) {
    return (
      <DefectDetailScreen
        defectId={selectedDefectId}
        detailFields={[]}
        token={token}
        onBack={() => setSelectedDefectId(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 px-7 py-5">
      <Card>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[22px]">🪲</span>
          <div className="text-lg font-bold text-foreground">לוח באגים (QC)</div>
          {qcMock && (
            <span className="rounded-[10px] border border-warning/30 bg-warning-bg px-2.5 py-0.5 text-sm text-warning">Mock — ממתין לחיבור QC</span>
          )}
        </div>
      </Card>

      {loading && <div className="p-6 text-center text-subtle-foreground">טוען...</div>}
      {error && <div className="p-6 text-center text-danger">{error}</div>}
      {!loading && !error && !selectedVId && (
        <div className="p-6 text-center text-subtle-foreground">בחר גרסה מהתפריט הצדדי כדי להציג נתוני באגים</div>
      )}

      {!loading && !error && dashboard && (
        <>
          <div className="flex flex-wrap gap-2.5">
            <KpiCard label="תקלות שדווחו" value={String(dashboard.reported)} colorClass="text-foreground"
              onClick={() => setDrilldown({ filter: 'reported', title: 'כל התקלות שדווחו' })} />
            <KpiCard label="תקלות פתוחות" value={String(dashboard.open)} sub={pct(dashboard.open, dashboard.reported)} colorClass="text-warning"
              onClick={() => setDrilldown({ filter: 'open', title: 'תקלות פתוחות' })} />
            <KpiCard label="תקלות שנדחו" value={String(dashboard.rejected)} sub={pct(dashboard.rejected, dashboard.reported)} colorClass="text-subtle-foreground"
              onClick={() => setDrilldown({ filter: 'rejected', title: 'תקלות שנדחו' })} />
            {/* Production/Regression drill by BG_USER_10 = 'Production'/'Regression'
                (spec 2026-09-07). */}
            <KpiCard label="תקלות ייצור" value={String(dashboard.production)} sub={pct(dashboard.production, dashboard.reported)} colorClass="text-danger"
              onClick={() => setDrilldown({ filter: 'production', title: 'תקלות ייצור (BG_USER_10 = Production)' })} />
            <KpiCard label="תקלות רגרסיה" value={String(dashboard.regression)} sub={pct(dashboard.regression, dashboard.reported)} colorClass="text-danger"
              onClick={() => setDrilldown({ filter: 'regression', title: 'תקלות רגרסיה (BG_USER_10 = Regression)' })} />
            <KpiCard label="שינויים (CR)" value={String(dashboard.changes)} sub={pct(dashboard.changes, dashboard.reported)} colorClass="text-primary"
              onClick={() => setDrilldown({ filter: 'changes', title: 'תקלות מסוג Change Requests' })} />
            <KpiCard label="נפתחו מחדש" value={String(dashboard.reopen)} sub={pct(dashboard.reopen, dashboard.reported)} colorClass="text-danger"
              onClick={() => setDrilldown({ filter: 'reopen', title: 'תקלות שנפתחו מחדש (Reopen) — לפי היסטוריה' })} />
            <KpiCard label="נותרו ליעד" value={`${dashboard.targetOpen}/${dashboard.targetTotal}`} colorClass="text-success"
              onClick={() => setDrilldown({ filter: 'target', title: 'תקלות מגרסאות קודמות שהיעד שלהן הוא גרסה זו' })} />
            {/* Mirror of "נותרו ליעד": defects opened in THIS release whose
                BG_TARGET_REL is set — i.e. deferred forward (spec 2026-09-09). */}
            <KpiCard label="עוברות לגרסה הבאה" value={String(dashboard.movedToNext)} sub={pct(dashboard.movedToNext, dashboard.reported)} colorClass="text-primary"
              onClick={() => setDrilldown({ filter: 'moved-to-next', title: 'תקלות שנפתחו בגרסה זו ומועברות לגרסה הבאה (שדה TARGET מאוכלס)' })} />
          </div>

          <SeverityLegend />
          {/* 2026-09-19 redesign: "לפי CR" is the long/wide one (often many
              distinct CR values) — its own wide column on the right; the
              other three stack in a narrower column on the left. Page is
              RTL, and in a plain flex row the FIRST child renders on the
              right — so the CR column comes first in DOM order below. */}
          <div className="flex flex-wrap gap-4 items-start">
            <div style={{ flex: '1.4 1 420px', minWidth: '380px' }}>
              <BreakdownPanel wide title="פתוחות לפי CR" total={dashboard.open} rows={dashboard.openByCr}
                onSelect={label => setDrilldown({ filter: 'cr', value: label, title: `תקלות פתוחות — CR: ${label}` })} />
            </div>
            <div className="flex flex-col gap-3" style={{ flex: '1 1 320px', minWidth: '300px' }}>
              <BreakdownPanel title="פתוחות לפי סטטוס" total={dashboard.open} rows={dashboard.openByStatus}
                onSelect={label => setDrilldown({ filter: 'status', value: label, title: `תקלות פתוחות — סטטוס: ${label}` })} />
              <BreakdownPanel title="פתוחות לפי סוג" total={dashboard.open} rows={dashboard.openByType}
                onSelect={label => setDrilldown({ filter: 'type', value: label, title: `תקלות פתוחות — סוג: ${label}` })} />
              <BreakdownPanel title="פתוחות לפי אחראי" total={dashboard.open} rows={dashboard.openByResponsibility}
                onSelect={label => setDrilldown({ filter: 'responsibility', value: label, title: `תקלות פתוחות — אחראי: ${label}` })} />
              <OldestOpenPanel rows={dashboard.oldestOpen} onSelect={setSelectedDefectId} />
            </div>
          </div>

          {/* Daily report moved below the breakdowns (spec 2026-09-19: "הדיווח
              היומי תופס המון שטח, אפשר להוריד למטה") — it's a single wide
              trend line, lower priority to see first than the open-defect
              breakdowns above. */}
          <Card>
            <div className="mb-2 text-sm font-semibold text-foreground">דיווח יומי <span className="text-xs font-normal text-subtle-foreground">· לחיצה על נקודה = התקלות שדווחו באותו יום</span></div>
            <DailyTrendChart
              data={dashboard.dailyReported}
              onPointClick={date => setDrilldown({
                filter: 'day',
                value: date,
                title: `תקלות שדווחו בתאריך ${new Date(date).toLocaleDateString('he-IL')}`,
              })}
            />
          </Card>
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
