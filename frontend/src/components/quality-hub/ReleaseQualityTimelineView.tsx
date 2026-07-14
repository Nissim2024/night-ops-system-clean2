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
const POINT_GAP = 46;

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

function LineChart({ points, color }: { points: TimelinePoint[]; color: string }) {
  const { containerRef, width, gap } = useChartWidth(points.length);
  const usable = points.filter(p => p.value != null);
  const coords = points.map((p, i) => {
    const x = 30 + i * gap;
    const y = p.value != null ? CHART_HEIGHT - (p.value / 100) * (CHART_HEIGHT - 20) - 10 : null;
    return { x, y, p };
  });
  const pathD = coords.filter(c => c.y != null).map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');

  if (usable.length === 0) {
    return <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>אין נתונים להצגה עם הפילטרים הנוכחיים.</div>;
  }

  return (
    <div ref={containerRef} style={{ overflowX: 'auto', width: '100%' }}>
      <svg width={width} height={CHART_HEIGHT + 40} style={{ display: 'block' }}>
        {[0, 25, 50, 75, 100].map(v => {
          const y = CHART_HEIGHT - (v / 100) * (CHART_HEIGHT - 20) - 10;
          return (
            <g key={v}>
              <line x1={20} y1={y} x2={width - 10} y2={y} stroke={C.border} strokeWidth={1} />
              <text x={2} y={y + 4} fontSize={12} fill={C.textMuted}>{v}</text>
            </g>
          );
        })}
        <path d={pathD} fill="none" stroke={color} strokeWidth={2} />
        {coords.map((c, i) => c.y != null ? (
          <g key={i}>
            <circle cx={c.x} cy={c.y} r={4} fill={color} />
            <text x={c.x} y={CHART_HEIGHT + 20} fontSize={12} fill={C.textMuted} textAnchor="middle" transform={`rotate(-40 ${c.x} ${CHART_HEIGHT + 20})`}>
              {c.p.releaseName}
            </text>
            <text x={c.x} y={c.y - 8} fontSize={12} fill={C.textPrimary} textAnchor="middle" fontWeight="bold">
              {c.p.value}%
            </text>
          </g>
        ) : null)}
      </svg>
    </div>
  );
}

// Overlaid multi-KPI trend chart, matches the deck's dense "all metrics at once" view.
function MultiLineChart({ series }: { series: TimelineSeries[] }) {
  const allReleases = series[0]?.points ?? [];
  const { containerRef, width, gap } = useChartWidth(allReleases.length);
  const hasAnyData = series.some(s => s.points.some(p => p.value != null));

  if (!hasAnyData) {
    return <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>אין נתונים להצגה עם הפילטרים הנוכחיים.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SP[3], marginBottom: SP[3] }}>
        {series.map((s, i) => (
          <div key={s.kpiName} style={{ display: 'flex', alignItems: 'center', gap: '5px', ...TEXT.xs, color: C.textSecondary }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: C.teams[i % C.teams.length] }} />
            {s.kpiName}
          </div>
        ))}
      </div>
      <div ref={containerRef} style={{ overflowX: 'auto', width: '100%' }}>
        <svg width={width} height={CHART_HEIGHT + 40} style={{ display: 'block' }}>
          {[0, 25, 50, 75, 100].map(v => {
            const y = CHART_HEIGHT - (v / 100) * (CHART_HEIGHT - 20) - 10;
            return (
              <g key={v}>
                <line x1={20} y1={y} x2={width - 10} y2={y} stroke={C.border} strokeWidth={1} />
                <text x={2} y={y + 4} fontSize={12} fill={C.textMuted}>{v}</text>
              </g>
            );
          })}
          {series.map((s, i) => {
            const coords = s.points.map((p, j) => ({
              x: 30 + j * gap,
              y: p.value != null ? CHART_HEIGHT - (p.value / 100) * (CHART_HEIGHT - 20) - 10 : null,
            }));
            const pathD = coords.filter(c => c.y != null).map((c, j) => `${j === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
            return <path key={s.kpiName} d={pathD} fill="none" stroke={C.teams[i % C.teams.length]} strokeWidth={1.5} opacity={0.85} />;
          })}
          {allReleases.map((p, i) => (
            <text key={p.releaseName} x={30 + i * gap} y={CHART_HEIGHT + 20} fontSize={12} fill={C.textMuted} textAnchor="middle" transform={`rotate(-40 ${30 + i * gap} ${CHART_HEIGHT + 20})`}>
              {p.releaseName}
            </text>
          ))}
        </svg>
      </div>
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
  const [metric, setMetric] = useState<string>('TOTAL_SCORE');
  const [showAll, setShowAll] = useState(false);
  const [data, setData] = useState<TimelineData | null>(null);
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
    if (showAll) {
      axios.get(`${API}/quality-hub/timeline-all?${params.toString()}`, { headers })
        .then(res => setAllSeries(res.data))
        .catch(() => setAllSeries([]))
        .finally(() => setLoading(false));
      return;
    }
    if (metric !== 'TOTAL_SCORE') params.set('kpiName', metric);
    axios.get(`${API}/quality-hub/timeline?${params.toString()}`, { headers })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYears, selectedReleases, metric, showAll, token]);

  useEffect(() => { load(); }, [load]);

  const toggleYear = (y: number) => setSelectedYears(prev => prev.includes(y) ? prev.filter(x => x !== y) : [...prev, y]);
  const toggleRelease = (name: string) => setSelectedReleases(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name]);

  if (releases.length === 0) {
    return (
      <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>
        אין עדיין נתוני איכות גרסה. יש לייבא את שני קבצי ה-Excel דרך מסך הניהול.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: SP[2] }}>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📈 ציר זמן איכות גרסה</div>
        <div style={{ display: 'flex', gap: SP[3], alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', ...TEXT.sm, color: C.textSecondary }}>
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
            הצג את כל המדדים
          </label>
          <select
            value={metric}
            onChange={e => setMetric(e.target.value)}
            disabled={showAll}
            style={{ padding: '8px 14px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, fontFamily: FONT, ...TEXT.sm, minWidth: '220px', opacity: showAll ? 0.5 : 1 }}
          >
            <option value="TOTAL_SCORE">ציון כולל</option>
            {kpiDefs.map(k => <option key={k.kpiName} value={k.kpiName}>{k.kpiName}</option>)}
          </select>
        </div>
      </div>

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

      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
        {loading && !data && allSeries.length === 0 ? (
          <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>טוען...</div>
        ) : showAll ? (
          <MultiLineChart series={allSeries} />
        ) : !data ? (
          <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>לא ניתן לטעון נתונים.</div>
        ) : (
          <LineChart points={data.points} color={C.brand} />
        )}
      </div>
    </div>
  );
};
