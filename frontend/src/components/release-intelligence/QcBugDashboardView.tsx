import React, { useState, useEffect, useCallback, useMemo, useLayoutEffect, useRef } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { cn } from '../../lib/utils';
import { Card, Badge } from '../ui';
import { DefectDrilldownModal } from './DefectDrilldownModal';
import { DefectDetailScreen } from '../quality-hub/OpenProdDefectsView';
import { CreateDefectScreen } from '../quality-hub/CreateDefectScreen';
import { hasHebrew, StatusBadge, SeverityBadge } from '../shared/defectFieldDisplay';
import { historicalDrilldownUrl } from './DefectsView';
import { SEVERITY_CHART_COLOR, OTHER_COLOR, TrendBars, BacklogLine, Legend, useChartTooltip } from '../defects/charts';

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
  // 2026-10-06 — see qc.service BugDashboardDto
  timeline?: { id: string; detected: string | null; closed: string | null }[];
  closeDateFallback?: number;
  agingOpen?: { id: string; ageDays: number; ageHours: number; severity: string }[];
  testingSlaHours?: Record<string, number>;
  releaseName?: string | null;
}

// `initialRelId` (2026-09-20) — an alternative entry point for a QC-only
// historical release with no local Version at all (see QcReleaseHistoryView).
// Mutually exclusive with `initialVersionId` in practice; when relId-driven,
// the KPI-tile/breakdown-row drilldown modal naturally no-ops (it's gated on
// `selectedVId`, which stays empty in this mode) rather than crashing — that
// modal goes through the Version-scoped release-intelligence dispatcher,
// which has no equivalent for a relId with no Version. The "oldest still-open"
// list's click-through still works fully in this mode: it opens a defect by
// id directly, no Version needed.
interface Props {
  token: string; initialVersionId?: string; initialRelId?: number;
  /** Fallback QC release name for the deep link when the API doesn't return one (dev/mock). */
  versionName?: string;
  /** "פתח במודול תקלות" — the defects module filtered to this release. */
  onOpenInDefects?: (releaseName: string) => void;
}

const pct = (n: number, total: number) => total > 0 ? `${((n / total) * 100).toFixed(2)}%` : '0%';

// Same 4 severities used throughout the app (CRITICAL_SEVERITIES etc.) — a
// bare "ללא סיווג" bucket catches anything else without crashing. These stay
// as raw theme hex (not Tailwind classes) because the value is picked at
// render time from row data, same precedent as StatusChip/PriorityChip in ui.tsx.
// Same validated severity scale as the defects module (2026-10-06) — the old
// Severe-orange vs Medium-yellow pair was too close to tell apart.
const SEVERITY_COLOR: Record<string, string> = { ...SEVERITY_CHART_COLOR, 'ללא סיווג': OTHER_COLOR };
const SEVERITY_ORDER = ['Show Stopper', 'Severe', 'Medium', 'Low', 'ללא סיווג'];

function SeverityLegend() {
  return (
    <div className="mb-1">
      <Legend items={SEVERITY_ORDER.map(sv => ({ label: sv, color: SEVERITY_COLOR[sv] }))} />
    </div>
  );
}

// Colors are chosen per call-site (a fixed semantic meaning, not row data),
// so they map onto Tailwind's semantic text tokens directly.
const KpiCard: React.FC<{ label: string; value: string; sub?: string; colorClass: string; onClick?: () => void }> = ({ label, value, sub, colorClass, onClick }) => (
  <Card padding={3} style={{ textAlign: 'center', cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
    <div className="mb-1 min-h-[2lh] text-xs leading-tight text-subtle-foreground">{label}</div>
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
  const tip = useChartTooltip();
  return (
    <Card padding={4}>
     <div ref={tip.ref} className="relative">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <Badge color={C.textMuted} bg={C.bgHover}>{total}</Badge>
      </div>
      {/* Label stays a wider break-words column here on purpose (spec
          2026-09-19 — long CR/team names need it), unlike the truncating
          content-sized label used everywhere else; only the scrollbar-overlap
          half of the 2026-09-29 fix applies to this one. */}
      <div className={cn('flex flex-col gap-2 overflow-y-auto pl-2', wide ? 'max-h-[440px]' : 'max-h-[220px]')} style={{ scrollbarGutter: 'stable' }}>
        {rows.length === 0 && <div className="text-xs text-subtle-foreground">אין נתונים</div>}
        {rows.map(r => (
          // Label column is fixed and its text sits on the bar's side (no
          // empty gap — same as the defects module); long CR names still wrap.
          <div key={r.label} onClick={() => onSelect(r.label)}
            onMouseMove={e => tip.show(e, <><b>{r.label}</b> · {r.count}{r.bySeverity.map(s => ` · ${s.severity} ${s.count}`).join('')}</>)}
            onMouseLeave={tip.hide}
            className="flex cursor-pointer items-start gap-2 rounded-sm hover:bg-muted">
            <div className={cn('flex-shrink-0 break-words text-left text-xs leading-snug text-muted-foreground', wide ? 'w-[190px]' : 'w-[140px]')}>
              {r.label}
            </div>
            <div className="mt-0.5 flex h-3.5 min-w-0 flex-1">
              <div className="flex h-full gap-[2px]" style={{ width: `${Math.max(2, (r.count / max) * 100)}%` }}>
                {r.bySeverity.map((s, k) => (
                  <div key={s.severity}
                    className={cn('h-full', k === r.bySeverity.length - 1 && 'rounded-e-[4px]')}
                    style={{ flexGrow: s.count, flexBasis: 0, background: SEVERITY_COLOR[s.severity] ?? SEVERITY_COLOR['ללא סיווג'] }} />
                ))}
              </div>
            </div>
            <div className="mt-0.5 w-6 flex-shrink-0 text-left text-xs tabular-nums text-foreground">{r.count}</div>
          </div>
        ))}
      </div>
      {tip.node}
     </div>
    </Card>
  );
};

// Two-column layout that fills itself without a hole under the shorter
// column (user ask 2026-10-04). The pinned panel ("לפי CR") stays first in
// the wide column; every other panel, in order, goes to whichever column is
// currently shorter. Heights are measured once per `layoutKey` (new data)
// and the arrangement is then frozen — a panel's height depends on its
// column's width, so re-balancing on every resize could flip-flop. On a
// narrow screen the columns wrap into one, as before.
const BalancedColumns: React.FC<{
  panels: { key: string; node: React.ReactNode }[];
  pinnedWide: string;
  layoutKey: string;
}> = ({ panels, pinnedWide, layoutKey }) => {
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const defaultNarrow = panels.filter(p => p.key !== pinnedWide).map(p => p.key);
  const [wideKeys, setWideKeys] = useState<string[]>([pinnedWide]);
  const [narrowKeys, setNarrowKeys] = useState<string[]>(defaultNarrow);
  const measuredFor = useRef<string | null>(null);

  // New data → back to the default split, then measure it below.
  useLayoutEffect(() => {
    setWideKeys([pinnedWide]);
    setNarrowKeys(defaultNarrow);
    measuredFor.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  useLayoutEffect(() => {
    if (measuredFor.current === layoutKey) return;
    // Measure only the default split (wide = pinned alone), so every panel's
    // height is taken in a known column — not mid-reset from the old layout.
    if (wideKeys.length !== 1 || wideKeys[0] !== pinnedWide || narrowKeys.length !== defaultNarrow.length) return;
    const h = (k: string) => refs.current[k]?.offsetHeight ?? 0;
    if (panels.some(p => !refs.current[p.key])) return;
    const GAP = 12;
    const wide = [pinnedWide];
    const narrow: string[] = [];
    let hWide = h(pinnedWide);
    let hNarrow = 0;
    for (const p of panels) {
      if (p.key === pinnedWide) continue;
      if (hNarrow <= hWide) { narrow.push(p.key); hNarrow += h(p.key) + GAP; }
      else { wide.push(p.key); hWide += h(p.key) + GAP; }
    }
    measuredFor.current = layoutKey;
    setWideKeys(wide);
    setNarrowKeys(narrow);
  });

  const render = (keys: string[]) => keys.map(k => {
    const p = panels.find(x => x.key === k);
    return p ? <div key={k} ref={el => { refs.current[k] = el; }}>{p.node}</div> : null;
  });

  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex flex-col gap-3" style={{ flex: '1.4 1 420px', minWidth: '380px' }}>{render(wideKeys)}</div>
      <div className="flex flex-col gap-3" style={{ flex: '1 1 320px', minWidth: '300px' }}>{render(narrowKeys)}</div>
    </div>
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

// Day-by-day trend for this version (2026-10-06, aligned with the defects
// module): opened vs closed per day (bars) + open at the end of each day
// (backlog line, its own chart — never a second y-axis). Built from the
// per-defect timeline; every point drills down to its exact ids.
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function buildDailyTrend(timeline: NonNullable<BugDashboardDto['timeline']>) {
  const detectedDays = timeline.map(t => t.detected).filter((d): d is string => !!d).sort();
  if (detectedDays.length === 0) return [];
  // Window = the version's own activity: first detection → today while
  // anything is still open, else → the last open/close day. Capped to the
  // last 120 days of that window so the bars stay readable.
  const start = new Date(detectedDays[0] + 'T12:00:00');
  const stillOpen = timeline.some(t => t.detected && !t.closed);
  const lastDay = timeline.flatMap(t => [t.detected, t.closed]).filter((d): d is string => !!d).sort().pop()!;
  const end = stillOpen ? new Date() : new Date(lastDay + 'T12:00:00');
  const from = new Date(Math.max(start.getTime(), end.getTime() - 119 * 86400000));
  const points: { key: string; label: string; opened: number[]; closed: number[]; openAtEnd: number; openIds: number[] }[] = [];
  for (let d = new Date(from); d <= end; d = new Date(d.getTime() + 86400000)) {
    const key = isoDay(d);
    const opened: number[] = [], closed: number[] = [], openIds: number[] = [];
    timeline.forEach((t, i) => {
      if (t.detected === key) opened.push(i);
      if (t.closed === key) closed.push(i);
      if (t.detected && t.detected <= key && (!t.closed || t.closed > key)) openIds.push(i);
    });
    points.push({ key, label: `${key.slice(8, 10)}/${key.slice(5, 7)}`, opened, closed, openAtEnd: openIds.length, openIds });
  }
  return points;
}

// Testing-phase fix SLA (user, 2026-10-06): SS 24h, Severe 2d, Medium 3d,
// Low 4d — or decide not to handle it and cancel. Per severity: open defects
// still inside the SLA vs already past it; every count drills to its ids.
const SlaPanel: React.FC<{ aging: NonNullable<BugDashboardDto['agingOpen']>; sla: Record<string, number>; onDrill: (title: string, ids: string[]) => void }> = ({ aging, sla, onDrill }) => {
  const rows = SEVERITY_ORDER.filter(sv => sla[sv] != null).map(sv => {
    const of = aging.filter(a => a.severity === sv);
    const late = of.filter(a => a.ageHours >= sla[sv]);
    return { sv, hours: sla[sv], within: of.filter(a => a.ageHours < sla[sv]), late };
  });
  const max = Math.max(1, ...rows.map(r => r.within.length + r.late.length));
  const totalLate = rows.reduce((n, r) => n + r.late.length, 0);
  const fmt = (h: number) => (h === 24 ? '24 שעות' : `${h / 24} ימים`);
  return (
    <Card padding={4}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-foreground">⏱ SLA תיקון — שלב הבדיקות</div>
        <button disabled={totalLate === 0} onClick={() => onDrill('חריגות SLA', rows.flatMap(r => r.late.map(a => a.id)))}
          className={cn('rounded-md border-none px-2 py-0.5 text-xs font-semibold', totalLate ? 'cursor-pointer' : 'cursor-default')}
          style={{ background: totalLate ? C.dangerBg : C.bgHover, color: totalLate ? C.danger : C.textMuted }}>
          {totalLate ? `⚠ ${totalLate} בחריגה` : '✓ אין חריגות'}
        </button>
      </div>
      <div className="flex flex-col gap-2.5">
        {rows.map(r => (
          <div key={r.sv} className="flex items-center gap-2 text-xs">
            <div className="w-[205px] flex-shrink-0 whitespace-nowrap text-left">
              <span className="font-semibold text-foreground">{r.sv}</span>
              <span className="ms-1 text-subtle-foreground">· עד {fmt(r.hours)}</span>
            </div>
            <div className="flex h-3.5 min-w-0 flex-1">
              <div className="flex h-full gap-[2px]" style={{ width: `${((r.within.length + r.late.length) / max) * 100}%` }}>
                {r.late.length > 0 && <div className="h-full cursor-pointer" title={`בחריגה: ${r.late.length}`} onClick={() => onDrill(`${r.sv} — בחריגת SLA`, r.late.map(a => a.id))} style={{ flexGrow: r.late.length, flexBasis: 0, background: C.danger }} />}
                {r.within.length > 0 && <div className="h-full cursor-pointer rounded-e-[4px]" title={`בתוך ה-SLA: ${r.within.length}`} onClick={() => onDrill(`${r.sv} — בתוך ה-SLA`, r.within.map(a => a.id))} style={{ flexGrow: r.within.length, flexBasis: 0, background: OTHER_COLOR }} />}
              </div>
            </div>
            <button disabled={!r.late.length} onClick={() => onDrill(`${r.sv} — בחריגת SLA`, r.late.map(a => a.id))}
              className={cn('w-[70px] flex-shrink-0 border-none bg-transparent p-0 text-left text-xs tabular-nums', r.late.length ? 'cursor-pointer font-semibold' : 'cursor-default text-subtle-foreground')}
              style={r.late.length ? { color: C.danger } : undefined}>
              {r.late.length} / {r.within.length + r.late.length}
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 text-[11px] text-subtle-foreground">
        אדום = עבר את זמן התיקון · אפור = עדיין בזמן. השעון רץ מהפתיחה (או מה-Reopen האחרון) ונעצר ב-Fixed / Closed / Canceled או בהעברה לגרסה אחרת
      </div>
    </Card>
  );
};

export const QcBugDashboardView: React.FC<Props> = ({ token, initialVersionId, initialRelId, versionName, onOpenInDefects }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  // The version is driven entirely by the sidebar picker (BRD 2026-09-07 §4) —
  // no in-page selector anymore (spec 2026-09-07: "הסר את בורר הגרסאות מדף לוח הבאגים").
  // relId mode (QC-only historical release) leaves this empty on purpose —
  // see the drilldown-modal gate below and the Props comment above.
  const selectedVId = initialVersionId ?? '';
  const [dashboard, setDashboard] = useState<BugDashboardDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qcMock, setQcMock] = useState(true);
  const [drilldown, setDrilldown] = useState<{ filter: string; value?: string; title: string } | null>(null);
  const [selectedDefectId, setSelectedDefectId] = useState<string | null>(null);
  const [showCreateScreen, setShowCreateScreen] = useState(false);
  // SLA / trend / backlog: drill by the exact ids behind the number
  const drillIds = (title: string, idList: string[]) => {
    if (idList.length === 0) return;
    setDrilldown({ filter: 'ids', value: idList.join(','), title });
  };

  useEffect(() => {
    axios.get(`${API}/qc/status`, { headers })
      .then(r => setQcMock(!r.data?.enabled))
      .catch(() => setQcMock(true));
  }, [headers]);

  const loadDashboard = useCallback(async (vId: string, relId?: number) => {
    if (!vId && !relId) { setDashboard(null); return; }
    setLoading(true);
    setError(null);
    try {
      const url = relId
        ? `${API}/qc/bug-dashboard-by-rel?relId=${relId}`
        : `${API}/qc/bug-dashboard?versionId=${vId}`;
      const res = await axios.get(url, { headers });
      setDashboard(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'שגיאה בטעינת נתוני QC');
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { loadDashboard(selectedVId, initialRelId); }, [selectedVId, initialRelId, loadDashboard]);

  if (showCreateScreen) {
    return (
      <CreateDefectScreen
        token={token}
        initialVersionId={selectedVId || undefined}
        onBack={() => setShowCreateScreen(false)}
        onCreated={(id) => { setShowCreateScreen(false); setSelectedDefectId(id); }}
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
          <span className="text-[22px]">🐞</span>
          <div className="text-lg font-bold text-foreground">לוח באגים (QC)</div>
          {qcMock && (
            <span className="rounded-[10px] border border-warning/30 bg-warning-bg px-2.5 py-0.5 text-sm text-warning">Mock — ממתין לחיבור QC</span>
          )}
          {onOpenInDefects && dashboard && (dashboard.releaseName || versionName) && (
            <button
              onClick={() => onOpenInDefects((dashboard.releaseName || versionName)!)}
              title="דאשבורד התחקור במודול התקלות, מסונן לגרסה הזו"
              className="mr-auto cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-semibold text-primary"
            >
              🔎 פתח במודול תקלות
            </button>
          )}
          {selectedVId && (
            <button
              onClick={() => setShowCreateScreen(true)}
              className={cn('cursor-pointer rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground', !(onOpenInDefects && dashboard) && 'mr-auto')}
            >
              + תקלה חדשה ב-QC
            </button>
          )}
        </div>
      </Card>

      {loading && <div className="p-6 text-center text-subtle-foreground">טוען...</div>}
      {error && <div className="p-6 text-center text-danger">{error}</div>}
      {!loading && !error && !selectedVId && !initialRelId && (
        <div className="p-6 text-center text-subtle-foreground">בחר גרסה מהתפריט הצדדי כדי להציג נתוני באגים</div>
      )}

      {!loading && !error && dashboard && (
        <>
          {/* grid (2026-10-06): equal cells — a 9th card used to stretch across a whole row */}
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))' }}>
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
          <BalancedColumns
            layoutKey={`${initialRelId ?? selectedVId}-${dashboard.open}-${dashboard.openByCr.length}-${dashboard.oldestOpen.length}`}
            pinnedWide="cr"
            panels={[
              { key: 'cr', node: <BreakdownPanel wide title="פתוחות לפי CR" total={dashboard.open} rows={dashboard.openByCr}
                  onSelect={label => setDrilldown({ filter: 'cr', value: label, title: `תקלות פתוחות — CR: ${label}` })} /> },
              { key: 'status', node: <BreakdownPanel title="פתוחות לפי סטטוס" total={dashboard.open} rows={dashboard.openByStatus}
                  onSelect={label => setDrilldown({ filter: 'status', value: label, title: `תקלות פתוחות — סטטוס: ${label}` })} /> },
              { key: 'type', node: <BreakdownPanel title="פתוחות לפי סוג" total={dashboard.open} rows={dashboard.openByType}
                  onSelect={label => setDrilldown({ filter: 'type', value: label, title: `תקלות פתוחות — סוג: ${label}` })} /> },
              { key: 'responsibility', node: <BreakdownPanel title="פתוחות לפי אחראי" total={dashboard.open} rows={dashboard.openByResponsibility}
                  onSelect={label => setDrilldown({ filter: 'responsibility', value: label, title: `תקלות פתוחות — אחראי: ${label}` })} /> },
              { key: 'oldest', node: <OldestOpenPanel rows={dashboard.oldestOpen} onSelect={setSelectedDefectId} /> },
              ...(dashboard.agingOpen && dashboard.testingSlaHours ? [{ key: 'sla', node: (
                <SlaPanel aging={dashboard.agingOpen} sla={dashboard.testingSlaHours} onDrill={drillIds} />
              ) }] : []),
            ]}
          />

          {/* Daily report moved below the breakdowns (spec 2026-09-19: "הדיווח
              היומי תופס המון שטח, אפשר להוריד למטה") — it's a single wide
              trend line, lower priority to see first than the open-defect
              breakdowns above. */}
          <Card>
            <div className="mb-2 text-sm font-semibold text-foreground">
              📈 מגמה יומית — נפתחו מול נסגרו
              <span className="ms-1 text-xs font-normal text-subtle-foreground">· לחיצה על עמודה או נקודה = התקלות שמאחוריה</span>
            </div>
            {dashboard.timeline && dashboard.timeline.length > 0 ? (() => {
              const tl = dashboard.timeline!;
              const points = buildDailyTrend(tl);
              const ids = (idx: number[]) => idx.map(i => tl[i].id);
              return (
                <>
                  {(dashboard.closeDateFallback ?? 0) > 0 && (
                    <div className="mb-2 text-[11px] text-subtle-foreground">ל-{dashboard.closeDateFallback} תקלות סגורות לא נמצא מועד סגירה בהיסטוריה — נלקח תאריך העדכון האחרון (או הפתיחה)</div>
                  )}
                  <TrendBars points={points} onPick={(title, idx) => drillIds(title, ids(idx))} height={200} />
                  <div className="mb-1 mt-3 text-xs font-semibold text-subtle-foreground">Backlog — פתוחות בסוף כל יום</div>
                  <BacklogLine points={points} height={140}
                    onPick={p => { const pt = points.find(x => x.label === p.label); if (pt) drillIds(`פתוחות בסוף ${p.label}`, ids(pt.openIds)); }} />
                </>
              );
            })() : (
              <div className="p-5 text-center text-xs text-subtle-foreground">אין נתוני מגמה</div>
            )}
          </Card>
        </>
      )}

      {drilldown && (selectedVId || initialRelId != null) && (
        <DefectDrilldownModal
          token={token}
          versionId={selectedVId}
          screen="bug-dashboard"
          filter={drilldown.filter}
          value={drilldown.value}
          title={drilldown.title}
          // historical QC release (no local Version): same buckets via relId
          endpoint={!selectedVId && initialRelId != null ? historicalDrilldownUrl(initialRelId, 'bug-dashboard', drilldown.filter, drilldown.value) : undefined}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
};

export default QcBugDashboardView;
