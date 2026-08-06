import React, { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';
import { useReleaseCount } from './releaseCountSetting';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface ReleaseSummary { releaseName: string; totalScore: number; year: number | null; }
interface Overview {
  releaseName: string;
  totalScore: number;
  status: 'ABOVE_TARGET' | 'BELOW_TARGET';
  targetScore: number;
  yearAverage: number | null;
  previousRelease: { releaseName: string; totalScore: number; year: number | null } | null;
}

function KpiCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', flex: 1, minWidth: '180px' }}>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: valueColor ?? C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
    </div>
  );
}

// Bar chart of score-by-release, matching the source deck's "annual average" slide.
const CHART_HEIGHT = 400;
const BAR_GAP = 70;
// "Close to target" band — within this many points below target still gets
// the amber warning color instead of red; further below is a real miss.
const NEAR_TARGET_MARGIN = 3;

function barColorForScore(score: number, target: number): string {
  if (score >= target) return C.success;
  if (score >= target - NEAR_TARGET_MARGIN) return C.warning;
  return C.danger;
}

// Measures the container so the chart stretches to fill the full width when
// there's room for every bar, and only falls back to a fixed per-bar gap
// (with horizontal scroll) once there are more releases than comfortably fit.
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
  const naturalWidth = Math.max(400, pointCount * BAR_GAP);
  const width = Math.max(naturalWidth, containerWidth);
  const gap = pointCount > 0 ? (width - 40) / pointCount : width;
  return { containerRef, width, gap };
}

function ScoreBarChart({ points, selected, targetScore, onSelectRelease }: { points: ReleaseSummary[]; selected: string; targetScore: number; onSelectRelease?: (releaseName: string) => void }) {
  const { containerRef, width, gap } = useChartWidth(points.length);
  const barWidth = Math.max(24, Math.min(56, gap * 0.6));

  if (points.length === 0) {
    return <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>אין נתונים להצגה.</div>;
  }

  return (
    <div ref={containerRef} style={{ overflowX: 'auto', width: '100%' }}>
      <svg width={width} height={CHART_HEIGHT + 40} style={{ display: 'block' }}>
        {points.map((p, i) => {
          const x = 20 + i * gap + (gap - barWidth) / 2;
          const barHeight = Math.max(2, (p.totalScore / 100) * (CHART_HEIGHT - 30));
          const y = CHART_HEIGHT - barHeight;
          const isSelected = p.releaseName === selected;
          const color = barColorForScore(p.totalScore, targetScore);
          return (
            <g
              key={p.releaseName}
              onClick={() => onSelectRelease?.(p.releaseName)}
              style={{ cursor: onSelectRelease ? 'pointer' : 'default' }}
            >
              <rect
                x={x} y={y} width={barWidth} height={barHeight} fill={color} rx={2}
                stroke={isSelected ? C.info : 'none'} strokeWidth={isSelected ? 3 : 0}
              />
              <text x={x + barWidth / 2} y={y - 8} fontSize={14} fontWeight="bold" fill={isSelected ? C.info : C.textSecondary} textAnchor="middle">
                {p.totalScore}%
              </text>
              <text x={x + barWidth / 2} y={CHART_HEIGHT + 18} fontSize={13} fill={C.textMuted} textAnchor="middle">
                {p.releaseName}
              </text>
            </g>
          );
        })}
        <line x1={10} y1={CHART_HEIGHT} x2={width - 10} y2={CHART_HEIGHT} stroke={C.border} strokeWidth={1} />
      </svg>
    </div>
  );
}

interface Props { token: string; role: string; onSelectRelease?: (releaseName: string) => void; }

export const ReleaseOverviewView: React.FC<Props> = ({ token, onSelectRelease }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [data, setData] = useState<Overview | null>(null);
  const [chartPoints, setChartPoints] = useState<ReleaseSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [releaseCount, setReleaseCount] = useReleaseCount();

  useEffect(() => {
    axios.get(`${API}/quality-hub/releases`, { headers })
      .then(res => {
        setReleases(res.data);
        if (res.data.length > 0) setSelected(res.data[0].releaseName);
      })
      .catch(() => setReleases([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const load = useCallback(() => {
    if (!selected) return;
    setLoading(true);
    Promise.all([
      axios.get(`${API}/quality-hub/overview/${encodeURIComponent(selected)}`, { headers }),
      axios.get(`${API}/quality-hub/overview-chart?count=${releaseCount}`, { headers }),
    ])
      .then(([overviewRes, chartRes]) => { setData(overviewRes.data); setChartPoints(chartRes.data); })
      .catch(() => { setData(null); setChartPoints([]); })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, releaseCount, token]);

  useEffect(() => { load(); }, [load]);

  if (releases.length === 0 && !loading) {
    return (
      <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>
        אין עדיין נתוני איכות גרסה. יש לייבא את שני קבצי ה-Excel דרך מסך הניהול (⚙️ ניהול → איכות גרסה).
      </div>
    );
  }

  const scoreColor = (score: number, target: number) => (score >= target ? C.success : C.danger);

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🏆 סקירה כללית — איכות גרסה</div>
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          style={{ padding: '8px 14px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, fontFamily: FONT, ...TEXT.sm, minWidth: '200px' }}
        >
          {releases.map(r => (
            <option key={r.releaseName} value={r.releaseName}>{r.releaseName} ({r.totalScore}%)</option>
          ))}
        </select>
      </div>

      {loading && !data ? (
        <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6] }}>טוען...</div>
      ) : !data ? (
        <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6] }}>לא ניתן לטעון נתונים עבור גרסה זו.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
            <KpiCard value={`${data.totalScore}%`} label={`ציון גרסה (${data.releaseName})`} valueColor={scoreColor(data.totalScore, data.targetScore)} />
            <KpiCard
              value={data.status === 'ABOVE_TARGET' ? `מעל היעד (${data.targetScore}%)` : `מתחת ליעד (${data.targetScore}%)`}
              label="סטטוס"
              valueColor={data.status === 'ABOVE_TARGET' ? C.success : C.danger}
            />
            <KpiCard value={data.yearAverage != null ? `${data.yearAverage}%` : '—'} label="ממוצע שנתי" />
            <KpiCard
              value={data.previousRelease ? `${data.previousRelease.totalScore}%` : '—'}
              label={data.previousRelease ? `גרסה קודמת (${data.previousRelease.releaseName})` : 'גרסה קודמת'}
              valueColor={data.previousRelease ? (data.totalScore >= data.previousRelease.totalScore ? C.success : C.danger) : undefined}
            />
          </div>

          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP[3], flexWrap: 'wrap', gap: SP[2] }}>
              <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textSecondary }}>
                ציון גרסה — {releaseCount} הגרסאות האחרונות
                {onSelectRelease && <span style={{ ...TEXT.xs, fontWeight: WEIGHT.normal, color: C.textMuted }}> (לחצו על עמודה למעבר למטריצת KPI של אותה גרסה)</span>}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: SP[2], ...TEXT.xs, color: C.textMuted }}>
                כמות גרסאות בגרף:
                <input
                  type="number" min={1} max={100} value={releaseCount}
                  onChange={e => setReleaseCount(Number(e.target.value) || 12)}
                  style={{ width: '60px', padding: '4px 8px', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, fontFamily: FONT, ...TEXT.xs }}
                />
              </label>
            </div>
            <ScoreBarChart points={chartPoints} selected={selected} targetScore={data.targetScore} onSelectRelease={onSelectRelease} />
          </div>
        </>
      )}
    </div>
  );
};
