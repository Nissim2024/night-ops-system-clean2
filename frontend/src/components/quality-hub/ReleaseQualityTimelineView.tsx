import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { cn } from '../../lib/utils';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface ReleaseSummary { releaseName: string; totalScore: number; year: number | null; }
interface KpiDef { kpiName: string; kpiOrder: number; }
interface TimelinePoint { releaseName: string; value: number | null; }
interface TimelineData { metric: string; points: TimelinePoint[]; }
interface TimelineSeries { kpiName: string; kpiOrder: number; points: TimelinePoint[]; }

const CHART_HEIGHT = 380;
const POINT_GAP = 56;
const CHART_PAD = 40; // left/right margin — first/last point sit exactly here, symmetric on both sides
const TOP_PAD = 28; // room above a 100% bar for its value label
const BOTTOM_PAD = 10;

// Measures the container so the chart stretches to fill the full width when
// there's room for every point, and only falls back to a fixed per-point gap
// (with horizontal scroll) once there are more points than comfortably fit.
function useChartWidth(pointCount: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setContainerWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const naturalWidth = Math.max(400, (pointCount - 1) * POINT_GAP + CHART_PAD * 2);
  const width = Math.max(naturalWidth, containerWidth);
  // Divide by (pointCount - 1), not pointCount — the first point anchors at
  // CHART_PAD and the last at (width - CHART_PAD), spending the full width
  // symmetrically. The previous /pointCount left roughly one full gap's
  // worth of empty space trailing after the last point (nothing balancing
  // it before the first) — the chart visually hugged one side of the card
  // instead of centering across it. Found live in production 2026-08-05.
  const gap = pointCount > 1 ? (width - CHART_PAD * 2) / (pointCount - 1) : 0;
  return { containerRef, width, gap };
}

function kpiColor(kpiOrder: number): string {
  return C.teams[kpiOrder % C.teams.length];
}

// Bars = overall version score per release (matches the deck's headline
// chart). Toggling a KPI button overlays that KPI's own trend as a line on
// top of the same bars, so it's read relative to the overall score.
function BarChartWithOverlays({ bars, overlays }: { bars: TimelinePoint[]; overlays: { kpiName: string; color: string; points: TimelinePoint[] }[] }) {
  const { containerRef, width, gap } = useChartWidth(bars.length);
  const hasBars = bars.some(b => b.value != null);

  if (!hasBars) {
    return <div className="p-6 text-center text-sm text-subtle-foreground">אין נתונים להצגה עם הפילטרים הנוכחיים.</div>;
  }

  const barWidth = Math.max(14, Math.min(40, gap * 0.5));
  // TOP_PAD reserves room above a 100% bar for its value label (otherwise it
  // sits right at the SVG's top edge and gets clipped) — matches the same
  // pattern already used in ReleaseOverviewView's chart.
  const yFor = (v: number) => (CHART_HEIGHT - BOTTOM_PAD) - (v / 100) * (CHART_HEIGHT - BOTTOM_PAD - TOP_PAD);

  return (
    <div ref={containerRef} className="w-full overflow-x-auto">
      <svg width={width} height={CHART_HEIGHT + 40} className="block">
        {[0, 25, 50, 75, 100].map(v => (
          <g key={v}>
            <line x1={CHART_PAD - 20} y1={yFor(v)} x2={width - CHART_PAD + 20} y2={yFor(v)} stroke={C.border} strokeWidth={1} />
            <text x={2} y={yFor(v) + 4} fontSize={14} fill={C.textMuted}>{v}</text>
          </g>
        ))}

        {bars.map((b, i) => {
          const x = CHART_PAD + i * gap;
          if (b.value == null) {
            return (
              <text key={i} x={x} y={CHART_HEIGHT + 24} fontSize={14} fill={C.textMuted} textAnchor="middle">
                {b.releaseName}
              </text>
            );
          }
          const y = yFor(b.value);
          const h = (CHART_HEIGHT - BOTTOM_PAD) - y;
          return (
            <g key={i}>
              <rect x={x - barWidth / 2} y={y} width={barWidth} height={h} rx={4} fill={C.textDisabled} opacity={0.9} />
              <text x={x} y={y - 8} fontSize={14} fill={C.textPrimary} textAnchor="middle" fontWeight="bold">{b.value}%</text>
              <text x={x} y={CHART_HEIGHT + 24} fontSize={14} fill={C.textMuted} textAnchor="middle">
                {b.releaseName}
              </text>
            </g>
          );
        })}

        {overlays.map(s => {
          const coords = s.points.map((p, i) => ({ x: CHART_PAD + i * gap, y: p.value != null ? yFor(p.value) : null, v: p.value }));
          const pathD = coords.filter(c => c.y != null).map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
          return (
            <g key={s.kpiName}>
              <path d={pathD} fill="none" stroke={s.color} strokeWidth={2.5} />
              {coords.map((c, i) => c.y != null ? (
                <g key={i}>
                  <circle cx={c.x} cy={c.y} r={4} fill={s.color} stroke={C.bgCard} strokeWidth={1.5} />
                  {/* Always below the point (never above, where the bar's own
                      % label lives) — the two value sets never fight for the
                      same space, whatever the line's shape does. */}
                  <text x={c.x} y={c.y + 18} fontSize={13} fill={s.color} textAnchor="middle" fontWeight="bold">{c.v}%</text>
                </g>
              ) : null)}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

interface Props { token: string; role: string; }

export const ReleaseQualityTimelineView: React.FC<Props> = ({ token }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [kpiDefs, setKpiDefs] = useState<KpiDef[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [selectedReleases, setSelectedReleases] = useState<string[]>([]);
  const [selectedKpis, setSelectedKpis] = useState<string[]>([]);
  const [barsData, setBarsData] = useState<TimelineData | null>(null);
  const [allSeries, setAllSeries] = useState<TimelineSeries[]>([]);
  const [loading, setLoading] = useState(false);
  // Years filter defaults to the last 6 — with ~10+ years of historical data
  // (releases going back to 2015) showing every year by default just crowds
  // the panel; a checkbox reveals the rest on demand (2026-09-24 feedback).
  const [showAllYears, setShowAllYears] = useState(false);

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/quality-hub/releases`, { headers }),
      axios.get(`${API}/quality-hub/kpi-definitions`, { headers }),
    ]).then(([relRes, kpiRes]) => {
      setReleases(relRes.data);
      setKpiDefs(kpiRes.data);
    }).catch(() => { setReleases([]); setKpiDefs([]); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const years = useMemo(() => {
    const s = new Set(releases.map(r => r.year).filter((y): y is number => y != null));
    return Array.from(s).sort((a, b) => b - a);
  }, [releases]);
  const YEARS_VISIBLE_DEFAULT = 6;
  const hasMoreYears = years.length > YEARS_VISIBLE_DEFAULT;
  const visibleYears = showAllYears ? years : years.slice(0, YEARS_VISIBLE_DEFAULT);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedYears.length) params.set('years', selectedYears.join(','));
    if (selectedReleases.length) params.set('releaseNames', selectedReleases.join(','));
    Promise.all([
      axios.get(`${API}/quality-hub/timeline?${params.toString()}`, { headers }),
      axios.get(`${API}/quality-hub/timeline-all?${params.toString()}`, { headers }),
    ]).then(([barsRes, allRes]) => {
      setBarsData(barsRes.data);
      setAllSeries(allRes.data);
    }).catch(() => { setBarsData(null); setAllSeries([]); })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYears, selectedReleases, token]);

  useEffect(() => { load(); }, [load]);

  const toggleYear = (y: number) => setSelectedYears(prev => prev.includes(y) ? prev.filter(x => x !== y) : [...prev, y]);
  const toggleRelease = (name: string) => setSelectedReleases(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name]);
  const toggleKpi = (name: string) => setSelectedKpis(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name]);

  const overlays = useMemo(() => selectedKpis
    .map(name => {
      const s = allSeries.find(s => s.kpiName === name);
      if (!s) return null;
      return { kpiName: s.kpiName, color: kpiColor(s.kpiOrder), points: s.points };
    })
    .filter((s): s is { kpiName: string; color: string; points: TimelinePoint[] } => s != null),
  [selectedKpis, allSeries]);

  if (releases.length === 0) {
    return (
      <div className="p-8 text-center text-subtle-foreground [direction:rtl]">
        אין עדיין נתוני איכות גרסה. יש לייבא את שני קבצי ה-Excel דרך מסך הניהול.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 [direction:rtl]">
      <div className="text-lg font-bold text-foreground">📈 ציר זמן איכות גרסה</div>

      {/* Both filter panels share flex-1 (equal, symmetric width) instead of
          the old fixed max-w/min-w pair — wider panels mean more items per
          row, which is what actually reduces/removes their scrollbars
          (2026-09-24 feedback), not a taller box. */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-[280px] flex-1 rounded-lg border border-border bg-card p-3">
          <div className="mb-2 text-xs text-subtle-foreground">סינון לפי שנה</div>
          <div className="flex flex-wrap gap-2">
            {visibleYears.map(y => (
              <label key={y} className={cn('flex cursor-pointer items-center gap-1 rounded-sm px-2 py-[3px] text-sm', selectedYears.includes(y) ? 'bg-primary-50' : 'bg-transparent')}>
                <input type="checkbox" checked={selectedYears.includes(y)} onChange={() => toggleYear(y)} />
                {y}
              </label>
            ))}
          </div>
          {hasMoreYears && (
            <label className="mt-2 flex cursor-pointer items-center gap-1.5 border-t border-border pt-2 text-xs text-subtle-foreground">
              <input type="checkbox" checked={showAllYears} onChange={e => setShowAllYears(e.target.checked)} />
              הצג שנים נוספות ({years.length - YEARS_VISIBLE_DEFAULT} שנים ישנות יותר)
            </label>
          )}
        </div>
        <div className="min-w-[280px] max-h-[200px] flex-1 overflow-y-auto rounded-lg border border-border bg-card p-3">
          <div className="mb-2 text-xs text-subtle-foreground">או בחר גרסאות ספציפיות</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {releases.map(r => (
              <label key={r.releaseName} className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-sm">
                <input type="checkbox" checked={selectedReleases.includes(r.releaseName)} onChange={() => toggleRelease(r.releaseName)} />
                {r.releaseName}
              </label>
            ))}
          </div>
        </div>
        {(selectedYears.length > 0 || selectedReleases.length > 0) && (
          <button
            onClick={() => { setSelectedYears([]); setSelectedReleases([]); }}
            className="self-start cursor-pointer rounded-md border border-border bg-transparent px-3 py-1.5 text-xs text-subtle-foreground"
          >
            נקה סינון
          </button>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 text-xs text-subtle-foreground">הצג מדד על גבי ציון הגרסה הכללי</div>
        {/* Fixed 2-row grid (2026-09-24 feedback: restore the previous
            layout/order) — columns = ceil(n/2), so however many KPIs are
            defined always lay out as exactly two rows, filled in kpiOrder
            (the backend already returns getKpiDefinitions() sorted
            `orderBy: kpiOrder asc`, so DOM order here already IS the
            intended order — this only fixes how it wraps). Previously a
            flex-wrap wrapped into however many rows the container's current
            width happened to produce, which drifted with viewport width
            instead of staying at a fixed two. */}
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.ceil(kpiDefs.length / 2))}, minmax(150px, 1fr))` }}
        >
          {kpiDefs.map(k => {
            const active = selectedKpis.includes(k.kpiName);
            const color = kpiColor(k.kpiOrder);
            return (
              <button
                key={k.kpiName}
                onClick={() => toggleKpi(k.kpiName)}
                className={cn(
                  'flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-[5px] text-sm',
                  active ? 'font-bold' : 'font-normal'
                )}
                style={{
                  border: `1.5px solid ${active ? color : C.border}`,
                  background: active ? `${color}22` : 'transparent',
                  color: active ? color : C.textSecondary,
                }}
              >
                <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: color }} />
                {k.kpiName}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        {loading && !barsData ? (
          <div className="p-6 text-center text-sm text-subtle-foreground">טוען...</div>
        ) : !barsData ? (
          <div className="p-6 text-center text-sm text-subtle-foreground">לא ניתן לטעון נתונים.</div>
        ) : (
          <BarChartWithOverlays bars={barsData.points} overlays={overlays} />
        )}
      </div>
    </div>
  );
};
