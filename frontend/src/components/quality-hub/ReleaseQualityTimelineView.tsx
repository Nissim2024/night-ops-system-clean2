import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface ReleaseSummary { releaseName: string; totalScore: number; year: number | null; }
interface KpiDef { kpiName: string; kpiOrder: number; }
interface TimelinePoint { releaseName: string; value: number | null; }
interface TimelineData { metric: string; points: TimelinePoint[]; }
interface TimelineSeries { kpiName: string; kpiOrder: number; points: TimelinePoint[]; }

const CHART_HEIGHT = 220;
const POINT_GAP = 56;

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
  const naturalWidth = Math.max(400, pointCount * POINT_GAP);
  const width = Math.max(naturalWidth, containerWidth);
  const gap = pointCount > 1 ? (width - 40) / pointCount : width;
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
    return <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>אין נתונים להצגה עם הפילטרים הנוכחיים.</div>;
  }

  const barWidth = Math.max(14, Math.min(40, gap * 0.5));
  const yFor = (v: number) => CHART_HEIGHT - (v / 100) * (CHART_HEIGHT - 20) - 10;

  return (
    <div ref={containerRef} style={{ overflowX: 'auto', width: '100%' }}>
      <svg width={width} height={CHART_HEIGHT + 40} style={{ display: 'block' }}>
        {[0, 25, 50, 75, 100].map(v => (
          <g key={v}>
            <line x1={20} y1={yFor(v)} x2={width - 10} y2={yFor(v)} stroke={C.border} strokeWidth={1} />
            <text x={2} y={yFor(v) + 4} fontSize={12} fill={C.textMuted}>{v}</text>
          </g>
        ))}

        {bars.map((b, i) => {
          const x = 30 + i * gap;
          if (b.value == null) {
            return (
              <text key={i} x={x} y={CHART_HEIGHT + 20} fontSize={12} fill={C.textMuted} textAnchor="middle" transform={`rotate(-40 ${x} ${CHART_HEIGHT + 20})`}>
                {b.releaseName}
              </text>
            );
          }
          const y = yFor(b.value);
          const h = CHART_HEIGHT - 10 - y;
          return (
            <g key={i}>
              <rect x={x - barWidth / 2} y={y} width={barWidth} height={h} rx={4} fill={C.textDisabled} opacity={0.9} />
              <text x={x} y={y - 6} fontSize={12} fill={C.textPrimary} textAnchor="middle" fontWeight="bold">{b.value}%</text>
              <text x={x} y={CHART_HEIGHT + 20} fontSize={12} fill={C.textMuted} textAnchor="middle" transform={`rotate(-40 ${x} ${CHART_HEIGHT + 20})`}>
                {b.releaseName}
              </text>
            </g>
          );
        })}

        {overlays.map(s => {
          const coords = s.points.map((p, i) => ({ x: 30 + i * gap, y: p.value != null ? yFor(p.value) : null, v: p.value }));
          const pathD = coords.filter(c => c.y != null).map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
          return (
            <g key={s.kpiName}>
              <path d={pathD} fill="none" stroke={s.color} strokeWidth={2.5} />
              {coords.map((c, i) => c.y != null ? (
                <circle key={i} cx={c.x} cy={c.y} r={4} fill={s.color} stroke={C.bgCard} strokeWidth={1.5} />
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
      <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>
        אין עדיין נתוני איכות גרסה. יש לייבא את שני קבצי ה-Excel דרך מסך הניהול.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📈 ציר זמן איכות גרסה</div>

      <div style={{ display: 'flex', gap: SP[4], flexWrap: 'wrap' }}>
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[3] }}>
          <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: SP[2] }}>סינון לפי שנה</div>
          <div style={{ display: 'flex', gap: SP[2], flexWrap: 'wrap', maxWidth: '340px' }}>
            {years.map(y => (
              <label key={y} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', ...TEXT.sm, background: selectedYears.includes(y) ? C.brandDim : 'transparent', padding: '3px 8px', borderRadius: RADIUS.sm }}>
                <input type="checkbox" checked={selectedYears.includes(y)} onChange={() => toggleYear(y)} />
                {y}
              </label>
            ))}
          </div>
        </div>
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[3], maxHeight: '160px', overflowY: 'auto', minWidth: '220px' }}>
          <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: SP[2] }}>או בחר גרסאות ספציפיות</div>
          {releases.map(r => (
            <label key={r.releaseName} style={{ display: 'flex', alignItems: 'center', gap: SP[2], padding: '2px 0', cursor: 'pointer', ...TEXT.sm }}>
              <input type="checkbox" checked={selectedReleases.includes(r.releaseName)} onChange={() => toggleRelease(r.releaseName)} />
              {r.releaseName}
            </label>
          ))}
        </div>
        {(selectedYears.length > 0 || selectedReleases.length > 0) && (
          <button
            onClick={() => { setSelectedYears([]); setSelectedReleases([]); }}
            style={{ alignSelf: 'flex-start', padding: '6px 12px', background: 'none', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', color: C.textMuted, ...TEXT.xs }}
          >
            נקה סינון
          </button>
        )}
      </div>

      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[3] }}>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: SP[2] }}>הצג מדד על גבי ציון הגרסה הכללי</div>
        <div style={{ display: 'flex', gap: SP[2], flexWrap: 'wrap' }}>
          {kpiDefs.map(k => {
            const active = selectedKpis.includes(k.kpiName);
            const color = kpiColor(k.kpiOrder);
            return (
              <button
                key={k.kpiName}
                onClick={() => toggleKpi(k.kpiName)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: RADIUS.md,
                  border: `1.5px solid ${active ? color : C.border}`, background: active ? `${color}22` : 'transparent',
                  color: active ? color : C.textSecondary, cursor: 'pointer', fontFamily: FONT, ...TEXT.sm,
                  fontWeight: active ? WEIGHT.bold : WEIGHT.normal,
                }}
              >
                <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                {k.kpiName}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
        {loading && !barsData ? (
          <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>טוען...</div>
        ) : !barsData ? (
          <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>לא ניתן לטעון נתונים.</div>
        ) : (
          <BarChartWithOverlays bars={barsData.points} overlays={overlays} />
        )}
      </div>
    </div>
  );
};
