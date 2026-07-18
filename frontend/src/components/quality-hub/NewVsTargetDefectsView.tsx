import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, RADIUS } from '../../theme';
import { Card } from '../ui';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// "יחס תקלות חדשות ביצור" — Target = defects whose TARGET_REL is a release
// (the fix commitment), New = defects actually DETECTED_IN_REL that release.
// Cross-release, all-history (no version scoping), matching the reference
// Power BI page's Year/Release/Responsibility filters.

interface NewVsTargetDefectRow {
  defectId: string;
  targetRelId: string | null;
  targetRelName: string | null;
  detectedRelId: string | null;
  detectedRelName: string | null;
  responsibility: string | null;
  severity: string | null;
  detectedDate: string | null;
}

interface Props { token: string; }

const SEVERITY_COLOR: Record<string, string> = {
  'Show Stopper': C.danger,
  'Severe':       C.statusFailed,
  'Medium':       C.statusInProgress,
  'Low':          C.textMuted,
};

// "ITv04-2025" → { seq: 4, year: 2025 } for chronological x-axis ordering;
// non-matching names sort last rather than being dropped.
function parseRelease(name: string): { seq: number; year: number } | null {
  const m = /^ITv(\d+)-(\d{4})$/i.exec(name.trim());
  if (!m) return null;
  return { seq: Number(m[1]), year: Number(m[2]) };
}

function compareReleasesAsc(a: string, b: string): number {
  const pa = parseRelease(a), pb = parseRelease(b);
  if (pa && pb) return pa.year !== pb.year ? pa.year - pb.year : pa.seq - pb.seq;
  if (pa && !pb) return -1;
  if (!pa && pb) return 1;
  return a.localeCompare(b);
}

const KpiCard: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <Card padding={4} style={{ flex: 1, minWidth: '110px', textAlign: 'center' }}>
    <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, marginBottom: '4px', whiteSpace: 'nowrap' }}>{label}</div>
    <div style={{ fontSize: '32px', fontWeight: WEIGHT.bold, color, fontFamily: FONT, lineHeight: 1.1 }}>{value}</div>
  </Card>
);

const selectStyle: React.CSSProperties = {
  padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md,
  fontSize: '14px', background: C.bgCard, color: C.textPrimary, fontFamily: FONT, minWidth: '150px',
};

interface ChartPoint { release: string; target: number; newCount: number; ratioPct: number | null; }

// Grouped bars (Target / New, left count axis) + a ratio line (right % axis).
// Intentionally dual-axis — this replicates a specific existing Power BI report
// the user asked to match exactly, not a general-purpose chart.
const NewVsTargetChart: React.FC<{ points: ChartPoint[] }> = ({ points }) => {
  if (points.length === 0) {
    return <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, padding: '24px', textAlign: 'center' }}>אין נתונים להצגה</div>;
  }
  const width = Math.max(760, points.length * 100);
  const height = 260;
  const padTop = 30, padBottom = 30, padX = 40;
  const plotH = height - padTop - padBottom;
  const maxCount = Math.max(1, ...points.map(p => Math.max(p.target, p.newCount)));
  const maxRatio = Math.max(100, ...points.map(p => p.ratioPct ?? 0));
  const groupW = (width - padX * 2) / points.length;
  const barW = Math.min(28, groupW / 3);

  const countY = (v: number) => padTop + plotH - (v / maxCount) * plotH;
  const ratioY = (v: number) => padTop + plotH - (v / maxRatio) * plotH;

  const linePoints = points
    .filter(p => p.ratioPct != null)
    .map((p, i) => {
      const cx = padX + i * groupW + groupW / 2;
      return `${cx},${ratioY(p.ratioPct as number)}`;
    })
    .join(' ');

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <line x1={padX} y1={height - padBottom} x2={width - padX} y2={height - padBottom} stroke={C.border} strokeWidth={1} />
      {points.map((p, i) => {
        const gx = padX + i * groupW;
        const targetX = gx + groupW / 2 - barW - 2;
        const newX = gx + groupW / 2 + 2;
        return (
          <g key={p.release}>
            <rect x={targetX} y={countY(p.target)} width={barW} height={Math.max(0, height - padBottom - countY(p.target))} rx={3} fill={C.statusOpen}>
              <title>{`${p.release} — Target: ${p.target}`}</title>
            </rect>
            <text x={targetX + barW / 2} y={countY(p.target) - 5} fontSize="11" fill={C.textSecondary} textAnchor="middle" fontFamily={FONT}>{p.target}</text>

            <rect x={newX} y={countY(p.newCount)} width={barW} height={Math.max(0, height - padBottom - countY(p.newCount))} rx={3} fill={C.statusWaiting}>
              <title>{`${p.release} — New: ${p.newCount}`}</title>
            </rect>
            <text x={newX + barW / 2} y={countY(p.newCount) - 5} fontSize="11" fill={C.textSecondary} textAnchor="middle" fontFamily={FONT}>{p.newCount}</text>

            <text x={gx + groupW / 2} y={height - padBottom + 16} fontSize="11" fill={C.textMuted} textAnchor="middle" fontFamily={FONT}>{p.release}</text>
          </g>
        );
      })}
      <polyline points={linePoints} fill="none" stroke={C.statusInProgress} strokeWidth={2} />
      {points.map((p, i) => {
        if (p.ratioPct == null) return null;
        const cx = padX + i * groupW + groupW / 2;
        const cy = ratioY(p.ratioPct);
        return (
          <g key={`ratio-${p.release}`}>
            <circle cx={cx} cy={cy} r={4} fill={C.statusInProgress} />
            <text x={cx} y={cy - 10} fontSize="11" fontWeight={WEIGHT.bold} fill={C.statusInProgress} textAnchor="middle" fontFamily={FONT}>
              {p.ratioPct.toFixed(2)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export const NewVsTargetDefectsView: React.FC<Props> = ({ token }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [rows, setRows] = useState<NewVsTargetDefectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qcMock, setQcMock] = useState(true);

  const [fYear, setFYear] = useState('');
  const [fResponsibility, setFResponsibility] = useState('');

  useEffect(() => {
    axios.get(`${API}/qc/status`, { headers })
      .then(r => setQcMock(!r.data?.enabled))
      .catch(() => setQcMock(true));
  }, [headers]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    axios.get(`${API}/qc/new-vs-target-defects`, { headers })
      .then(r => setRows(r.data ?? []))
      .catch(err => setError(err?.response?.data?.message || 'שגיאה בטעינת נתוני תקלות'))
      .finally(() => setLoading(false));
  }, [headers]);

  const yearOptions = useMemo(() => Array.from(new Set(
    rows.map(r => parseRelease(r.detectedRelName ?? r.targetRelName ?? '')?.year).filter((y): y is number => !!y)
  )).sort((a, b) => b - a).map(String), [rows]);

  const responsibilityOptions = useMemo(() => Array.from(new Set(
    rows.map(r => r.responsibility).filter(Boolean)
  )).sort() as string[], [rows]);

  const filteredRows = useMemo(() => rows.filter(r => {
    if (fResponsibility && r.responsibility !== fResponsibility) return false;
    if (fYear) {
      const ty = parseRelease(r.targetRelName ?? '')?.year;
      const dy = parseRelease(r.detectedRelName ?? '')?.year;
      if (String(ty) !== fYear && String(dy) !== fYear) return false;
    }
    return true;
  }), [rows, fYear, fResponsibility]);

  const chartPoints = useMemo((): ChartPoint[] => {
    const releases = new Set<string>();
    for (const r of filteredRows) {
      if (r.targetRelName) releases.add(r.targetRelName);
      if (r.detectedRelName) releases.add(r.detectedRelName);
    }
    return Array.from(releases).sort(compareReleasesAsc).map(release => {
      const target = filteredRows.filter(r => r.targetRelName === release).length;
      const newCount = filteredRows.filter(r => r.detectedRelName === release).length;
      return { release, target, newCount, ratioPct: target > 0 ? (newCount / target) * 100 : null };
    });
  }, [filteredRows]);

  const newRows = useMemo(() => filteredRows.filter(r => r.detectedRelName != null), [filteredRows]);
  const severityCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of newRows) { const s = r.severity || 'ללא סיווג'; m.set(s, (m.get(s) ?? 0) + 1); }
    return m;
  }, [newRows]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px 28px', fontFamily: FONT }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '27px' }}>📈</span>
          <div style={{ fontSize: '22px', fontWeight: WEIGHT.bold, color: C.textPrimary }}>יחס תקלות חדשות ביצור</div>
          {qcMock && (
            <span style={{ fontSize: '14px', background: C.bgInProgress, color: C.statusInProgress, padding: '3px 10px', borderRadius: '10px', border: `1px solid ${C.statusInProgress}44` }}>Mock — ממתין לחיבור QC</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <select value={fYear} onChange={e => setFYear(e.target.value)} style={selectStyle}>
            <option value="">Year — הכל</option>
            {yearOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={fResponsibility} onChange={e => setFResponsibility(e.target.value)} style={selectStyle}>
            <option value="">Responsibility — הכל</option>
            {responsibilityOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </Card>

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: C.textMuted }}>טוען...</div>}
      {error && <div style={{ textAlign: 'center', padding: '24px', color: C.danger }}>{error}</div>}

      {!loading && !error && (
        <>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {(['Show Stopper', 'Severe', 'Medium', 'Low'] as const).map(s => (
              <KpiCard key={s} label={s} value={String(severityCounts.get(s) ?? 0)} color={SEVERITY_COLOR[s]} />
            ))}
          </div>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '10px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: C.statusOpen, display: 'inline-block' }} />
                <span style={{ ...TEXT.xs, color: C.textSecondary }}>Target</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: C.statusWaiting, display: 'inline-block' }} />
                <span style={{ ...TEXT.xs, color: C.textSecondary }}>New</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: C.statusInProgress, display: 'inline-block' }} />
                <span style={{ ...TEXT.xs, color: C.textSecondary }}>Ratio (New / Target)</span>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <NewVsTargetChart points={chartPoints} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default NewVsTargetDefectsView;
