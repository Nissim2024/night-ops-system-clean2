import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { C } from '../theme';
import { cn } from '../lib/utils';
import { Card, Badge } from './ui';
import { DefectDetailScreen } from './quality-hub/OpenProdDefectsView';
import { CreateDefectScreen } from './quality-hub/CreateDefectScreen';
import { DefectDrilldownModal } from './release-intelligence/DefectDrilldownModal';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Props { token: string; }

interface BreakdownRow { label: string; count: number; }
interface AllDefectsDashboardDto {
  options?: { years: number[]; releases: string[] };   // filter choices (user's whole scope)
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
  byEnvironmentComponent: BreakdownRow[];
  monthlyTrend: { month: string; count: number }[];
}
// onClick added 2026-09-23 (fixes-batch item B — "הכרטיסיות עצמן אינן
// מאפשרות לחיצה בכלל") — each tile drills into the exact same compound
// predicate that computed its own number (getAllDefectsFiltered's '__kpi__'
// path), so the drill-down list always matches the count that was clicked.
const KpiCard: React.FC<{ label: string; value: string; colorClass: string; onClick?: () => void }> = ({ label, value, colorClass, onClick }) => (
  <Card
    padding={4}
    style={{ flex: 1, minWidth: '130px', textAlign: 'center', cursor: onClick ? 'pointer' : undefined }}
    onClick={onClick}
  >
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
//
// Row layout (2026-09-29 feedback — "פס הגלילה מצד שמאל לפעמים מסתיר את
// הנתונים... יש רווח גדול וריק בין עמודת הנושא לגרף עצמו"): the label used
// to be a FIXED w-[42%] column, so a short label (e.g. "Low") left most of
// that 42% empty before the bar started — that's the gap. Switched to
// content-sized (max-w cap only, no fixed width) so short labels hug the
// bar and only long ones actually use the full cap. Also switched from
// break-words (multi-line, uneven row heights) to truncate (single line +
// ellipsis, full text still on hover via title). The scroll container's
// native scrollbar renders on the physical left in this RTL app — right on
// top of the count column, which sat flush against that edge — so the
// count column now gets its own end margin and the container reserves
// scrollbar space via scrollbarGutter instead of letting it overlap content.
const BreakdownPanel: React.FC<{ title: string; rows: BreakdownRow[]; onSelect: (label: string) => void }> = ({ title, rows, onSelect }) => {
  const max = Math.max(1, ...rows.map(r => r.count));
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <Card padding={4}>
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <Badge color={C.textMuted} bg={C.bgHover}>{total}</Badge>
      </div>
      <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto pl-2" style={{ scrollbarGutter: 'stable' }}>
        {rows.length === 0 && <div className="text-xs text-subtle-foreground">אין נתונים</div>}
        {rows.map(r => (
          <div key={r.label} onClick={() => onSelect(r.label)} className="flex cursor-pointer items-center gap-2">
            <div className="max-w-[40%] flex-shrink-0 truncate text-xs text-muted-foreground" title={r.label}>
              {r.label}
            </div>
            <div className="flex h-3.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-muted">
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
  const width = Math.max(720, data.length * 26), height = 140, padX = 30, padY = 20;
  const max = Math.max(1, ...data.map(d => d.count));
  const barW = (width - padX * 2) / data.length;
  return (
    <div className="overflow-x-auto">
    <svg width={data.length > 28 ? width : '100%'} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
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
    </div>
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
  // versionId omitted → DefectDrilldownModal's cross-version mode
  // (2026-09-23 follow-up: reuses the shared rich drill-down table — column
  // picker, sort, resize — instead of a separate, poorer reimplementation).
  const [drilldown, setDrilldown] = useState<{ filter: string; value: string; title: string; search?: string } | null>(null);
  // Filters (user ask 2026-10-05): detection year(s) + detected-in release(s);
  // they scope the KPIs, every chart and every drill-down list.
  const [years, setYears] = useState<number[]>([]);
  const [releases, setReleases] = useState<string[]>([]);
  const [releasePickerOpen, setReleasePickerOpen] = useState(false);
  const [releaseQuery, setReleaseQuery] = useState('');
  const [search, setSearch] = useState('');
  const [selectedDefectId, setSelectedDefectId] = useState<string | null>(null);
  const [showCreateScreen, setShowCreateScreen] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    axios.get(`${API}/qc/all-defects-dashboard`, { headers, params: {
      years: years.length ? years.join(',') : undefined,
      releases: releases.length ? releases.join(',') : undefined,
    } })
      .then(r => setDashboard(r.data))
      .catch(err => setError(err?.response?.data?.message || 'שגיאה בטעינת נתוני תקלות'))
      .finally(() => setLoading(false));
  }, [headers, years, releases]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    axios.get(`${API}/qc/status`, { headers }).then(r => setQcMock(!r.data?.enabled)).catch(() => setQcMock(true));
  }, [headers]);

  const openDrilldown = (field: string, value: string, title: string) => setDrilldown({ filter: field, value, title });
  const closeDrilldown = () => setDrilldown(null);

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

  if (drilldown) {
    return (
      <DefectDrilldownModal
        token={token}
        screen=""
        filter={drilldown.filter}
        value={drilldown.value}
        title={drilldown.title}
        crossVersion={{ years, releases, search: drilldown.search }}
        onClose={closeDrilldown}
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

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-subtle-foreground">שנה:</span>
          {(dashboard?.options?.years ?? []).map(y => (
            <button key={y} onClick={() => setYears(prev => prev.includes(y) ? prev.filter(v => v !== y) : [...prev, y])}
              className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-xs font-semibold ${years.includes(y) ? 'border-primary bg-primary text-white' : 'border-border bg-card text-foreground'}`}>
              {y}
            </button>
          ))}
          <span className="ms-3 text-xs font-semibold text-subtle-foreground">גרסה:</span>
          <div className="relative">
            <button onClick={() => setReleasePickerOpen(o => !o)}
              className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground">
              {releases.length === 0 ? 'כל הגרסאות' : releases.length === 1 ? releases[0] : `${releases.length} גרסאות`} ▾
            </button>
            {releasePickerOpen && (
              <div className="absolute z-20 mt-1 flex max-h-[320px] w-[260px] flex-col gap-1 overflow-y-auto rounded-md border border-border bg-card p-2 shadow-lg">
                <input autoFocus value={releaseQuery} onChange={e => setReleaseQuery(e.target.value)} placeholder="חפש גרסה…"
                  className="mb-1 rounded-sm border border-border px-2 py-1 text-xs" />
                {(dashboard?.options?.releases ?? []).filter(r => r.toLowerCase().includes(releaseQuery.toLowerCase())).map(r => (
                  <label key={r} className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                    <input type="checkbox" checked={releases.includes(r)}
                      onChange={() => setReleases(prev => prev.includes(r) ? prev.filter(v => v !== r) : [...prev, r])} />
                    {r}
                  </label>
                ))}
              </div>
            )}
          </div>
          {(years.length > 0 || releases.length > 0) && (
            <button onClick={() => { setYears([]); setReleases([]); }} className="cursor-pointer border-none bg-transparent text-xs text-primary">נקה סינון</button>
          )}
          <form className="ms-auto flex items-center gap-1.5"
            onSubmit={e => { e.preventDefault(); if (search.trim()) setDrilldown({ filter: '__kpi__', value: 'total', title: `חיפוש: ${search.trim()}`, search: search.trim() }); }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="חיפוש תקלה: מספר או טקסט"
              className="w-[220px] rounded-md border border-border bg-card px-2 py-1 text-xs" />
            <button type="submit" className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs">🔍 חפש</button>
          </form>
        </div>
      </Card>

      {loading && <div className="p-6 text-center text-subtle-foreground">טוען...</div>}
      {error && <div className="p-6 text-center text-danger">{error}</div>}

      {!loading && !error && dashboard && (
        <>
          <div className="flex flex-wrap gap-2.5">
            <KpiCard label="סה״כ תקלות" value={String(dashboard.total)} colorClass="text-foreground"
              onClick={() => openDrilldown('__kpi__', 'total', 'כל התקלות')} />
            <KpiCard label="פתוחות" value={String(dashboard.open)} colorClass="text-warning"
              onClick={() => openDrilldown('__kpi__', 'open', 'תקלות פתוחות')} />
            <KpiCard label="סגורות" value={String(dashboard.closed)} colorClass="text-subtle-foreground"
              onClick={() => openDrilldown('__kpi__', 'closed', 'תקלות סגורות')} />
            <KpiCard label="קריטיות פתוחות (Show Stopper)" value={String(dashboard.criticalOpen)} colorClass="text-danger"
              onClick={() => openDrilldown('__kpi__', 'criticalOpen', 'תקלות קריטיות פתוחות (Show Stopper)')} />
            <KpiCard label="נפתחו מחדש" value={String(dashboard.reopenCount)} colorClass="text-danger"
              onClick={() => openDrilldown('__kpi__', 'reopen', 'תקלות שנפתחו מחדש')} />
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
            <BreakdownPanel title="לפי רכיב סביבה" rows={dashboard.byEnvironmentComponent}
              onSelect={label => openDrilldown('environmentComponent', label, `תקלות — רכיב סביבה: ${label}`)} />
          </div>

          <Card>
            <div className="mb-2 text-sm font-semibold text-foreground">מגמה חודשית — תקלות שדווחו</div>
            <MonthlyTrendChart data={dashboard.monthlyTrend} onBarClick={() => {}} />
          </Card>
        </>
      )}
    </div>
  );
};
