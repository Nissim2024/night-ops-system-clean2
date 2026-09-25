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

// Red when more defects were newly introduced into production than were
// actually targeted/fixed for that release (New > Target — a worsening
// trend), green otherwise (2026-09-24 feedback).
function ratioColor(p: { target: number; newCount: number }): string {
  return p.newCount > p.target ? C.danger : C.success;
}

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
//
// Redesigned 2026-09-24 (feedback: axis fonts unreadably small, ratio line
// "didn't look trustworthy"): fontSize bumped from a hardcoded 11px (this
// app's own type scale — theme.ts's TEXT — starts at 16px for a reason,
// "legibility for weaker eyesight"; this chart's custom SVG text had drifted
// far below even that) to 14px, matching what ReleaseQualityTimelineView's
// own custom SVG chart already uses for the same kind of axis/value label.
// The ratio line previously had NO visible scale at all — just floating dots
// with a % number on each — nothing to judge the line's shape against,
// which is what actually read as "unreliable." Added real gridlines + tick
// labels for both axes (count on the left, ratio % on the right), and split
// the polyline at any release with no ratio (target=0) instead of drawing a
// straight connector across the gap, which was silently implying a trend
// through a release that has no real ratio to show.
const NewVsTargetChart: React.FC<{ points: ChartPoint[] }> = ({ points }) => {
  if (points.length === 0) {
    return <div className="text-xs text-subtle-foreground p-6 text-center">אין נתונים להצגה</div>;
  }
  const height = 280;
  const padTop = 30, padBottom = 34, padLeft = 36;
  const plotH = height - padTop - padBottom;
  const maxCount = Math.max(1, ...points.map(p => Math.max(p.target, p.newCount)));
  const maxRatio = Math.max(100, ...points.map(p => p.ratioPct ?? 0));

  // Round, readable tick steps rather than always-4-ticks — a maxCount of 7
  // shouldn't force ticks at 1.75/3.5/5.25.
  const niceStep = (max: number, targetTicks: number) => {
    const raw = max / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const norm = raw / mag;
    const step = (norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1) * mag;
    return Math.max(1, step);
  };
  const countStep = niceStep(maxCount, 4);
  const countTicks: number[] = [];
  for (let v = 0; v <= maxCount; v += countStep) countTicks.push(Math.round(v));
  // Adaptive, same as countTicks — a fixed [0,25,50,75,100,+] set falls
  // apart the moment one release has an extreme ratio (e.g. a small target
  // count with a much larger new count spikes maxRatio into the hundreds%):
  // ticks up to 100 all end up compressed into a few pixels near the axis
  // and their labels overlap into unreadable mush — exactly the "doesn't
  // look reliable" symptom (found live 2026-09-24, mock data producing a
  // 540% ratio point). A step sized to the real max keeps ticks evenly
  // spaced regardless of how extreme any single point is.
  const ratioStep = niceStep(maxRatio, 4);
  const ratioTicks: number[] = [];
  for (let v = 0; v <= maxRatio; v += ratioStep) ratioTicks.push(Math.round(v));

  // Fixed padRight is safe now that the tick labels are right-anchored (see
  // the `textAnchor="end"` below) — an end-anchored label grows LEFTWARD
  // from its x, so it can never overflow past the card edge no matter how
  // wide "500%" vs "0%" is; a start-anchored label (the first version of
  // this fix) grows rightward and clipped against the card boundary once
  // ratioStep above started producing 3-digit-plus ticks (found live
  // 2026-09-24 testing the previous fix).
  const padRight = 44;

  const width = Math.max(760, points.length * 100);
  const groupW = (width - padLeft - padRight) / points.length;
  const barW = Math.min(28, groupW / 3);

  const countY = (v: number) => padTop + plotH - (v / maxCount) * plotH;
  const ratioY = (v: number) => padTop + plotH - (v / maxRatio) * plotH;

  // Break the polyline into separate segments at any gap (ratioPct == null)
  // instead of one continuous line skipping over it.
  const lineSegments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  points.forEach((p, i) => {
    if (p.ratioPct == null) {
      if (current.length) { lineSegments.push(current); current = []; }
      return;
    }
    current.push({ x: padLeft + i * groupW + groupW / 2, y: ratioY(p.ratioPct) });
  });
  if (current.length) lineSegments.push(current);

  // direction: ltr below is load-bearing, not decoration — this SVG
  // otherwise inherits [direction:rtl] from the page, and SVG text-anchor
  // keywords are direction-relative per spec: under RTL, "end" resolves to
  // where "start" normally sits, so a right-anchored label grows RIGHTWARD
  // off its intended anchor instead of leftward into the reserved margin.
  // Confirmed via direct measurement (2026-09-24): an end-anchored "400%"
  // tick's rendered box started AT its x instead of ending there, running
  // off the card's right edge — exactly the "ratio line doesn't look
  // reliable" symptom. This chart's own coordinate math (x=0 left, x=width
  // right) is plain LTR by construction, so the fix is forcing the SVG back
  // to that, not re-deriving every anchor for RTL.
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible" style={{ direction: 'ltr' }}>
      {/* Count gridlines (left axis) */}
      {countTicks.map(v => (
        <g key={`c-${v}`}>
          <line x1={padLeft} y1={countY(v)} x2={width - padRight} y2={countY(v)} stroke={C.border} strokeWidth={1} />
          <text x={padLeft - 8} y={countY(v) + 4} fontSize={13} fill={C.textMuted} textAnchor="end">{v}</text>
        </g>
      ))}
      {/* Ratio % ticks (right axis) — labels only, gridlines already drawn by
          the count axis. End-anchored at the card's own right edge (`width`,
          not width - padRight + offset) so a wide label like "500%" grows
          leftward into the reserved padRight margin instead of rightward
          past it. */}
      {ratioTicks.map(v => (
        <text key={`r-${v}`} x={width - 4} y={ratioY(v) + 4} fontSize={13} fill={C.statusInProgress} textAnchor="end">{v}%</text>
      ))}
      <line x1={padLeft} y1={height - padBottom} x2={width - padRight} y2={height - padBottom} stroke={C.borderEm} strokeWidth={1.5} />

      {points.map((p, i) => {
        const gx = padLeft + i * groupW;
        const targetX = gx + groupW / 2 - barW - 2;
        const newX = gx + groupW / 2 + 2;
        return (
          <g key={p.release}>
            <rect x={targetX} y={countY(p.target)} width={barW} height={Math.max(0, height - padBottom - countY(p.target))} rx={3} fill={C.statusOpen}>
              <title>{`${p.release} — Target: ${p.target}`}</title>
            </rect>
            <text x={targetX + barW / 2} y={countY(p.target) - 6} fontSize={14} fill={C.textSecondary} textAnchor="middle">{p.target}</text>

            <rect x={newX} y={countY(p.newCount)} width={barW} height={Math.max(0, height - padBottom - countY(p.newCount))} rx={3} fill={C.statusWaiting}>
              <title>{`${p.release} — New: ${p.newCount}`}</title>
            </rect>
            <text x={newX + barW / 2} y={countY(p.newCount) - 6} fontSize={14} fill={C.textSecondary} textAnchor="middle">{p.newCount}</text>

            <text x={gx + groupW / 2} y={height - padBottom + 20} fontSize={14} fill={C.textMuted} textAnchor="middle">{p.release}</text>
          </g>
        );
      })}
      {/* Neutral connector — the color signal now lives on the points
          themselves (red/green per 2026-09-24 feedback), so the line stays
          muted instead of competing with a third color. */}
      {lineSegments.map((seg, si) => (
        <polyline key={si} points={seg.map(pt => `${pt.x},${pt.y}`).join(' ')} fill="none" stroke={C.borderEm} strokeWidth={2} />
      ))}
      {points.map((p, i) => {
        if (p.ratioPct == null) return null;
        const cx = padLeft + i * groupW + groupW / 2;
        const cy = ratioY(p.ratioPct);
        const color = ratioColor(p);
        return (
          <g key={`ratio-${p.release}`}>
            <circle cx={cx} cy={cy} r={4} fill={color} stroke={C.bgCard} strokeWidth={1.5} />
            <text x={cx} y={cy - 10} fontSize={14} fontWeight={WEIGHT.bold} fill={color} textAnchor="middle">
              {p.ratioPct.toFixed(1)}%
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

  // Only the responsibility filter narrows the ROW set — year filtering is
  // applied separately, per release, below. (Bug found 2026-09-24: the old
  // single filteredRows kept a row if EITHER its target-release year OR its
  // detected-release year matched fYear, then fed BOTH release names into
  // the chart — so a defect detected in the filtered year but originally
  // targeted at an earlier release pulled that unrelated earlier release
  // onto the x-axis too. Filtering by year "leaked" bars from other years.)
  const responsibilityFilteredRows = useMemo(() => rows.filter(r =>
    !fResponsibility || r.responsibility === fResponsibility
  ), [rows, fResponsibility]);

  const releaseMatchesYear = (releaseName: string | null) =>
    !fYear || String(parseRelease(releaseName ?? '')?.year) === fYear;

  const chartPoints = useMemo((): ChartPoint[] => {
    const releases = new Set<string>();
    for (const r of responsibilityFilteredRows) {
      if (r.targetRelName) releases.add(r.targetRelName);
      if (r.detectedRelName) releases.add(r.detectedRelName);
    }
    // Year filter narrows WHICH releases appear on the x-axis (only ones
    // whose own name-year matches) — each surviving release's target/new
    // counts still come from the full (responsibility-only-filtered) row
    // set, so a release's own numbers are never partial.
    return Array.from(releases)
      .filter(releaseMatchesYear)
      .sort(compareReleasesAsc)
      .map(release => {
        const target = responsibilityFilteredRows.filter(r => r.targetRelName === release).length;
        const newCount = responsibilityFilteredRows.filter(r => r.detectedRelName === release).length;
        return { release, target, newCount, ratioPct: target > 0 ? (newCount / target) * 100 : null };
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responsibilityFilteredRows, fYear]);

  // "New defects" (KPI severity cards + drill-down table below) — a defect
  // actually detected in the filtered year, not "detected OR targeted" —
  // this screen is specifically about defects newly found in production.
  const newRows = useMemo(() => responsibilityFilteredRows.filter(r =>
    r.detectedRelName != null && releaseMatchesYear(r.detectedRelName)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [responsibilityFilteredRows, fYear]);
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
              {/* Ratio legend split into red/green (2026-09-24 feedback) —
                  matches the per-point coloring in the chart itself:
                  New > Target (more defects newly introduced than were
                  actually targeted/fixed for the release) is a worsening
                  trend, shown red; New ≤ Target is green. */}
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: C.danger }} />
                <span className="text-xs text-muted-foreground">יחס שלילי (New {'>'} Target)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: C.success }} />
                <span className="text-xs text-muted-foreground">יחס חיובי (New ≤ Target)</span>
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
