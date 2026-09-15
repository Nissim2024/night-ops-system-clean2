import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { C, WEIGHT } from '../../theme';
import { Card, Select } from '../ui';

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

// onClick (2026-09-14) — drill-down into the new-defects list filtered to
// this severity. `rows` is already fully loaded client-side (this screen is
// cross-release/all-history, no per-version fetch), so there's no new
// endpoint to add — just render the already-in-memory list, filtered.
const KpiCard: React.FC<{ label: string; value: string; color: string; active?: boolean; onClick?: () => void }> = ({ label, value, color, active, onClick }) => (
  <Card
    padding={4}
    onClick={onClick}
    style={{
      flex: 1, minWidth: '110px', textAlign: 'center',
      cursor: onClick ? 'pointer' : undefined,
      outline: active ? `2px solid ${color}` : undefined, outlineOffset: active ? '-2px' : undefined,
    }}
  >
    <div className="text-xs text-subtle-foreground mb-1 whitespace-nowrap">{label}</div>
    <div className="text-[32px] font-bold leading-[1.1]" style={{ color }}>{value}</div>
  </Card>
);

interface ChartPoint { release: string; target: number; newCount: number; ratioPct: number | null; }

// Grouped bars (Target / New, left count axis) + a ratio line (right % axis).
// Intentionally dual-axis — this replicates a specific existing Power BI report
// the user asked to match exactly, not a general-purpose chart.
const NewVsTargetChart: React.FC<{ points: ChartPoint[] }> = ({ points }) => {
  if (points.length === 0) {
    return <div className="text-xs text-subtle-foreground p-6 text-center">אין נתונים להצגה</div>;
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
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
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
            <text x={targetX + barW / 2} y={countY(p.target) - 5} fontSize="11" fill={C.textSecondary} textAnchor="middle">{p.target}</text>

            <rect x={newX} y={countY(p.newCount)} width={barW} height={Math.max(0, height - padBottom - countY(p.newCount))} rx={3} fill={C.statusWaiting}>
              <title>{`${p.release} — New: ${p.newCount}`}</title>
            </rect>
            <text x={newX + barW / 2} y={countY(p.newCount) - 5} fontSize="11" fill={C.textSecondary} textAnchor="middle">{p.newCount}</text>

            <text x={gx + groupW / 2} y={height - padBottom + 16} fontSize="11" fill={C.textMuted} textAnchor="middle">{p.release}</text>
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
            <text x={cx} y={cy - 10} fontSize="11" fontWeight={WEIGHT.bold} fill={C.statusInProgress} textAnchor="middle">
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
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);

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
    <div className="flex flex-col gap-4 py-5 px-7">
      <Card>
        <div className="flex items-center gap-2.5 mb-3.5 flex-wrap">
          <span className="text-[27px]">📈</span>
          <div className="text-xl font-bold text-foreground">יחס תקלות חדשות ביצור</div>
          {qcMock && (
            <span
              className="text-sm rounded-[10px] py-0.5 px-2.5 border"
              style={{ background: C.bgInProgress, color: C.statusInProgress, borderColor: `${C.statusInProgress}44` }}
            >Mock — ממתין לחיבור QC</span>
          )}
        </div>
        <div className="flex gap-2.5 flex-wrap">
          <Select value={fYear} onChange={e => setFYear(e.target.value)} className="min-w-[150px]">
            <option value="">Year — הכל</option>
            {yearOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </Select>
          <Select value={fResponsibility} onChange={e => setFResponsibility(e.target.value)} className="min-w-[150px]">
            <option value="">Responsibility — הכל</option>
            {responsibilityOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </Select>
        </div>
      </Card>

      {loading && <div className="text-center p-6 text-subtle-foreground">טוען...</div>}
      {error && <div className="text-center p-6 text-danger">{error}</div>}

      {!loading && !error && (
        <>
          <div className="flex gap-2.5 flex-wrap">
            {(['Show Stopper', 'Severe', 'Medium', 'Low'] as const).map(s => (
              <KpiCard
                key={s} label={s} value={String(severityCounts.get(s) ?? 0)} color={SEVERITY_COLOR[s]}
                active={severityFilter === s}
                onClick={() => setSeverityFilter(prev => prev === s ? null : s)}
              />
            ))}
          </div>

          {severityFilter && (() => {
            const filtered = newRows.filter(r => (r.severity || 'ללא סיווג') === severityFilter);
            return (
              <Card>
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2.5">
                  <div className="text-sm font-semibold text-foreground">
                    תקלות חדשות — {severityFilter} ({filtered.length})
                  </div>
                  <button
                    onClick={() => setSeverityFilter(null)}
                    className="cursor-pointer rounded-md border border-border bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground"
                  >
                    ✕ נקה סינון
                  </button>
                </div>
                {filtered.length === 0 ? (
                  <div className="p-3 text-xs text-subtle-foreground text-center">אין תקלות בחומרה זו בתחולת הסינון הנוכחית</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-muted">
                          {['מזהה תקלה', 'גרסת יעד', 'גרסת גילוי', 'אחראי', 'תאריך גילוי'].map(h => (
                            <th key={h} className="whitespace-nowrap border-b border-border px-2 py-1.5 text-start font-bold text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(r => (
                          <tr key={r.defectId} className="border-b border-border">
                            <td className="px-2 py-1.5 font-mono">{r.defectId}</td>
                            <td className="px-2 py-1.5">{r.targetRelName ?? '—'}</td>
                            <td className="px-2 py-1.5">{r.detectedRelName ?? '—'}</td>
                            <td className="px-2 py-1.5">{r.responsibility ?? '—'}</td>
                            <td className="px-2 py-1.5">{r.detectedDate ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            );
          })()}

          <Card>
            <div className="flex items-center gap-4 mb-2.5 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-[2px] inline-block" style={{ background: C.statusOpen }} />
                <span className="text-xs text-muted-foreground">Target</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-[2px] inline-block" style={{ background: C.statusWaiting }} />
                <span className="text-xs text-muted-foreground">New</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: C.statusInProgress }} />
                <span className="text-xs text-muted-foreground">Ratio (New / Target)</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <NewVsTargetChart points={chartPoints} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default NewVsTargetDefectsView;
