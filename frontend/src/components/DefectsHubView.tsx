import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { C } from '../theme';
import { cn } from '../lib/utils';
import { Card, Badge, Modal } from './ui';
import { DefectDetailScreen } from './quality-hub/OpenProdDefectsView';
import { CreateDefectScreen } from './quality-hub/CreateDefectScreen';
import { StatusBadge, SeverityBadge } from './shared/defectFieldDisplay';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Props { token: string; }

interface BreakdownRow { label: string; count: number; }
interface AllDefectsDashboardDto {
  total: number;
  open: number;
  closed: number;
  criticalOpen: number;
  reopenCount: number;
  byStatus: BreakdownRow[];
  bySeverity: BreakdownRow[];
  byMainModule: BreakdownRow[];
  byResponsibility: BreakdownRow[];
  byDetectedRelease: BreakdownRow[];
  monthlyTrend: { month: string; count: number }[];
}
interface DrilldownListRow {
  id: string; title: string; status: string; severity: string;
  mainModule: string; responsibility: string; detectedInRelease: string; discoveryDate: string;
}

const KpiCard: React.FC<{ label: string; value: string; colorClass: string }> = ({ label, value, colorClass }) => (
  <Card padding={4} style={{ flex: 1, minWidth: '130px', textAlign: 'center' }}>
    {/* Longer labels (e.g. "קריטיות פתוחות (Show Stopper)") overflow a
        130px-wide tile with nowrap — unlike Bug Dashboard's KpiCard, whose
        labels are all short enough that nowrap never broke. Wrap instead. */}
    <div className="mb-1 text-xs leading-snug text-subtle-foreground">{label}</div>
    <div className={cn('text-[26px] font-bold leading-[1.1]', colorClass)}>{value}</div>
  </Card>
);

// Flat single-color bars (unlike Bug Dashboard's severity-segmented ones) —
// this dashboard's own breakdowns already include a dedicated "לפי חומרה"
// panel, so segmenting every other panel by severity too would be redundant
// rather than additive here.
const BreakdownPanel: React.FC<{ title: string; rows: BreakdownRow[]; onSelect: (label: string) => void }> = ({ title, rows, onSelect }) => {
  const max = Math.max(1, ...rows.map(r => r.count));
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <Card padding={4}>
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <Badge color={C.textMuted} bg={C.bgHover}>{total}</Badge>
      </div>
      <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto">
        {rows.length === 0 && <div className="text-xs text-subtle-foreground">אין נתונים</div>}
        {rows.map(r => (
          <div key={r.label} onClick={() => onSelect(r.label)} className="flex cursor-pointer items-center gap-2">
            <div className="w-[42%] flex-shrink-0 break-words text-xs leading-snug text-muted-foreground" title={r.label}>
              {r.label}
            </div>
            <div className="flex h-3.5 flex-1 overflow-hidden rounded-sm bg-muted">
              <div style={{ width: `${(r.count / max) * 100}%`, background: C.brand }} className="h-full" />
            </div>
            <div className="w-8 flex-shrink-0 text-left text-xs text-foreground">{r.count}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

// Monthly bar chart (unlike Bug Dashboard's daily polyline) — this
// dashboard's trend spans a whole defect history, so monthly buckets are the
// meaningful granularity, not individual days.
const MonthlyTrendChart: React.FC<{ data: { month: string; count: number }[]; onBarClick: (month: string) => void }> = ({ data, onBarClick }) => {
  if (data.length === 0) return <div className="p-5 text-center text-xs text-subtle-foreground">אין נתוני מגמה</div>;
  const width = 720, height = 140, padX = 30, padY = 20;
  const max = Math.max(1, ...data.map(d => d.count));
  const barW = (width - padX * 2) / data.length;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      {data.map((d, i) => {
        const h = ((height - padY * 2) * d.count) / max;
        const x = padX + i * barW;
        const y = height - padY - h;
        const [year, month] = d.month.split('-');
        return (
          <g key={d.month} onClick={() => onBarClick(d.month)} style={{ cursor: 'pointer' }}>
            <rect x={x + barW * 0.15} y={y} width={barW * 0.7} height={h} fill={C.brand} rx={2} />
            <text x={x + barW / 2} y={y - 6} fontSize="11" fill={C.textPrimary} textAnchor="middle">{d.count}</text>
            <text x={x + barW / 2} y={height - 4} fontSize="10" fill={C.textMuted} textAnchor="middle">{month}/{year.slice(2)}</text>
          </g>
        );
      })}
    </svg>
  );
};

// General, cross-version defects module (2026-09-22, user request): "looks
// like Bug Dashboard, but ALL defects, not just open ones, with topic charts,
// create + update". Deliberately no version/release scope at all (unlike
// QcBugDashboardView, which is one version's open defects) — this is the
// system-wide counterpart, closer in spirit to Quality Hub's "Open Prod
// Defects" screen but laid out as a KPI+breakdown dashboard instead of a
// table. Reuses CreateDefectScreen/DefectDetailScreen so create+update behave
// identically everywhere else in the app already does.
export const DefectsHubView: React.FC<Props> = ({ token }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [dashboard, setDashboard] = useState<AllDefectsDashboardDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qcMock, setQcMock] = useState(true);
  const [drilldown, setDrilldown] = useState<{ title: string } | null>(null);
  const [drilldownRows, setDrilldownRows] = useState<DrilldownListRow[] | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [selectedDefectId, setSelectedDefectId] = useState<string | null>(null);
  const [showCreateScreen, setShowCreateScreen] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    axios.get(`${API}/qc/all-defects-dashboard`, { headers })
      .then(r => setDashboard(r.data))
      .catch(err => setError(err?.response?.data?.message || 'שגיאה בטעינת נתוני תקלות'))
      .finally(() => setLoading(false));
  }, [headers]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    axios.get(`${API}/qc/status`, { headers }).then(r => setQcMock(!r.data?.enabled)).catch(() => setQcMock(true));
  }, [headers]);

  const openDrilldown = (field: string, value: string, title: string) => {
    setDrilldown({ title });
    setDrilldownLoading(true);
    axios.get(`${API}/qc/all-defects-filtered`, { headers, params: { field, value } })
      .then(r => setDrilldownRows(r.data))
      .catch(() => setDrilldownRows([]))
      .finally(() => setDrilldownLoading(false));
  };

  const closeDrilldown = () => { setDrilldown(null); setDrilldownRows(null); };

  if (showCreateScreen) {
    return (
      <CreateDefectScreen
        token={token}
        onBack={() => setShowCreateScreen(false)}
        onCreated={(id) => { setShowCreateScreen(false); load(); setSelectedDefectId(id); }}
      />
    );
  }

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
          <div className="text-lg font-bold text-foreground">מודול תקלות</div>
          <div className="text-xs text-subtle-foreground">כל התקלות במערכת, כל הגרסאות</div>
          {qcMock && (
            <span className="rounded-[10px] border border-warning/30 bg-warning-bg px-2.5 py-0.5 text-sm text-warning">Mock — ממתין לחיבור QC</span>
          )}
          <button
            onClick={() => setShowCreateScreen(true)}
            className="mr-auto cursor-pointer rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground"
          >
            + תקלה חדשה ב-QC
          </button>
        </div>
      </Card>

      {loading && <div className="p-6 text-center text-subtle-foreground">טוען...</div>}
      {error && <div className="p-6 text-center text-danger">{error}</div>}

      {!loading && !error && dashboard && (
        <>
          <div className="flex flex-wrap gap-2.5">
            <KpiCard label="סה״כ תקלות" value={String(dashboard.total)} colorClass="text-foreground" />
            <KpiCard label="פתוחות" value={String(dashboard.open)} colorClass="text-warning" />
            <KpiCard label="סגורות" value={String(dashboard.closed)} colorClass="text-subtle-foreground" />
            <KpiCard label="קריטיות פתוחות (Show Stopper)" value={String(dashboard.criticalOpen)} colorClass="text-danger" />
            <KpiCard label="נפתחו מחדש" value={String(dashboard.reopenCount)} colorClass="text-danger" />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <BreakdownPanel title="לפי סטטוס" rows={dashboard.byStatus}
              onSelect={label => openDrilldown('status', label, `תקלות — סטטוס: ${label}`)} />
            <BreakdownPanel title="לפי חומרה" rows={dashboard.bySeverity}
              onSelect={label => openDrilldown('severity', label, `תקלות — חומרה: ${label}`)} />
            <BreakdownPanel title="לפי מודול ראשי" rows={dashboard.byMainModule}
              onSelect={label => openDrilldown('mainModule', label, `תקלות — מודול: ${label}`)} />
            <BreakdownPanel title="לפי אחראי" rows={dashboard.byResponsibility}
              onSelect={label => openDrilldown('responsibility', label, `תקלות — אחראי: ${label}`)} />
            <BreakdownPanel title="לפי גרסה שבה זוהתה" rows={dashboard.byDetectedRelease}
              onSelect={label => openDrilldown('detectedInRelease', label, `תקלות — גרסה: ${label}`)} />
          </div>

          <Card>
            <div className="mb-2 text-sm font-semibold text-foreground">מגמה חודשית — תקלות שדווחו</div>
            <MonthlyTrendChart data={dashboard.monthlyTrend} onBarClick={() => {}} />
          </Card>
        </>
      )}

      {drilldown && (
        <Modal open onClose={closeDrilldown} title={drilldown.title} width={640}>
          {drilldownLoading && <div className="p-4 text-center text-subtle-foreground">טוען...</div>}
          {!drilldownLoading && drilldownRows && (
            <div className="flex max-h-[500px] flex-col gap-1 overflow-y-auto" dir="rtl">
              {drilldownRows.length === 0 && <div className="p-4 text-center text-xs text-subtle-foreground">אין תקלות</div>}
              {drilldownRows.map(r => (
                <div
                  key={r.id}
                  onClick={() => { setSelectedDefectId(r.id); closeDrilldown(); }}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                >
                  <div className="min-w-0 flex-1 truncate text-xs text-foreground" title={r.title}>{r.title}</div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <SeverityBadge severity={r.severity} />
                    <StatusBadge status={r.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
};
