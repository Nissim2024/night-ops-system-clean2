import React, { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface ReleaseSummary { releaseName: string; totalScore: number; year: number | null; }
interface Comparison {
  releases: { releaseName: string; totalScore: number }[];
  yearAverage: { label: string; totalScore: number } | null;
  kpiRows: { kpiName: string; kpiOrder: number; perRelease: Record<string, number | null> }[];
}

// Parses "ITv04-2026" → { year: 2026, seq: 4 } so releases sort chronologically
// ascending, not in whatever order they were checked/returned in.
function releaseSortKey(name: string): [number, number] {
  const m = name.match(/^ITv(\d+)-(\d+)$/);
  if (!m) return [0, 0];
  return [Number(m[2]), Number(m[1])];
}

function sortReleasesAsc<T extends { releaseName: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const [ay, aSeq] = releaseSortKey(a.releaseName);
    const [by, bSeq] = releaseSortKey(b.releaseName);
    return ay !== by ? ay - by : aSeq - bSeq;
  });
}

// Fixed thresholds → semantic token classes (not raw hex).
function scoreColorClass(pct: number | null): string {
  if (pct == null) return 'text-subtle-foreground';
  if (pct >= 90) return 'text-success';
  if (pct >= 70) return 'text-warning';
  return 'text-danger';
}

// Qualitative per-release swatch/bar palette — arbitrary index-based hues with
// no semantic-token equivalent, kept as literal hex for inline style (same
// pattern as the app's other data-viz "team color" palettes).
const RELEASE_COLORS = ['#4F46E5', '#16A34A', '#e8af00', '#DC2626', '#0891B2', '#9c6ade', '#00897b', '#f0883e'];

// Grouped bar chart: one cluster per KPI, one bar per selected release —
// lets you visually compare a KPI's relative score across releases at a
// glance, complementing the table's precise-number view.
function ComparisonChart({ releases, kpiRows }: { releases: { releaseName: string }[]; kpiRows: Comparison['kpiRows'] }) {
  const rowHeight = 34;
  const labelWidth = 260;

  return (
    <div>
      <div className="flex gap-4 flex-wrap mb-3 pb-2 border-b border-border">
        {releases.map((r, i) => (
          <div key={r.releaseName} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ background: RELEASE_COLORS[i % RELEASE_COLORS.length] }} />
            <span className="text-xs text-subtle-foreground">{r.releaseName}</span>
          </div>
        ))}
      </div>
      <div className="w-full">
        {kpiRows.map(row => (
          <div key={row.kpiName} className="flex items-center gap-2" style={{ height: `${rowHeight}px` }}>
            <div className="shrink-0 text-xs text-foreground font-semibold overflow-hidden text-ellipsis whitespace-nowrap" style={{ width: `${labelWidth}px` }} title={row.kpiName}>
              {row.kpiName}
            </div>
            <div className="flex-1 flex items-center gap-[3px] h-full">
              {releases.map((r, i) => {
                const v = row.perRelease[r.releaseName];
                const pct = Math.max(0, Math.min(100, v ?? 0));
                return (
                  <div key={r.releaseName} className="flex-1 h-[70%] bg-muted rounded-sm relative overflow-hidden" title={`${r.releaseName}: ${v != null ? v + '%' : '—'}`}>
                    <div className="absolute bottom-0 inset-x-0 rounded-sm" style={{ height: `${pct}%`, background: RELEASE_COLORS[i % RELEASE_COLORS.length] }} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface Props { token: string; role: string; }

export const ReleaseComparisonView: React.FC<Props> = ({ token }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [includeYearAverage, setIncludeYearAverage] = useState(false);
  const [view, setView] = useState<'table' | 'chart'>('table');
  const [data, setData] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    axios.get(`${API}/quality-hub/releases`, { headers })
      .then(res => {
        setReleases(res.data);
        if (res.data.length >= 2) setPicked([res.data[0].releaseName, res.data[1].releaseName]);
        else if (res.data.length === 1) setPicked([res.data[0].releaseName]);
      })
      .catch(() => setReleases([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const load = useCallback(() => {
    if (picked.length === 0) { setData(null); return; }
    setLoading(true);
    const params = new URLSearchParams({ releases: picked.join(','), includeYearAverage: String(includeYearAverage) });
    axios.get(`${API}/quality-hub/comparison?${params.toString()}`, { headers })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, includeYearAverage, token]);

  useEffect(() => { load(); }, [load]);

  const sortedReleases = useMemo(() => data ? sortReleasesAsc(data.releases) : [], [data]);

  const toggleRelease = (name: string) => {
    setPicked(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };

  if (releases.length === 0) {
    return (
      <div className="text-center p-8 text-subtle-foreground">
        אין עדיין נתוני איכות גרסה. יש לייבא את שני קבצי ה-Excel דרך מסך הניהול.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="text-lg font-bold text-foreground">⚖️ השוואת גרסאות</div>
        <div className="flex rounded-md border border-border overflow-hidden">
          <button onClick={() => setView('table')} className={`px-3.5 py-1.5 border-none cursor-pointer text-xs font-semibold ${view === 'table' ? 'bg-primary text-white' : 'bg-card text-muted-foreground'}`}>טבלה</button>
          <button onClick={() => setView('chart')} className={`px-3.5 py-1.5 border-none cursor-pointer text-xs font-semibold ${view === 'chart' ? 'bg-primary text-white' : 'bg-card text-muted-foreground'}`}>גרף</button>
        </div>
      </div>

      <div className="flex gap-4 flex-wrap">
        <div className="bg-card border border-border rounded-lg p-3 max-h-[220px] overflow-y-auto min-w-[260px]">
          <div className="text-xs text-subtle-foreground mb-2">בחר גרסאות להשוואה (2+)</div>
          {releases.map(r => (
            <label key={r.releaseName} className="flex items-center gap-2 py-1 cursor-pointer text-sm">
              <input type="checkbox" checked={picked.includes(r.releaseName)} onChange={() => toggleRelease(r.releaseName)} />
              <span className="text-foreground">{r.releaseName}</span>
              <span className="text-subtle-foreground text-xs">({r.totalScore}%)</span>
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground self-start">
          <input type="checkbox" checked={includeYearAverage} onChange={e => setIncludeYearAverage(e.target.checked)} />
          כלול ממוצע שנתי
        </label>
      </div>

      {loading && !data ? (
        <div className="text-sm text-subtle-foreground p-6">טוען...</div>
      ) : !data || picked.length === 0 ? (
        <div className="text-sm text-subtle-foreground p-6">בחר לפחות גרסה אחת להשוואה.</div>
      ) : (
        <>
          <div className="flex gap-3 flex-wrap">
            {sortedReleases.map(r => (
              <div key={r.releaseName} className="bg-card border border-border rounded-lg px-[18px] py-3.5 flex-1 min-w-[160px]">
                <div className={`text-xl font-bold ${scoreColorClass(r.totalScore)}`}>{r.totalScore}%</div>
                <div className="text-xs text-subtle-foreground mt-[3px]">{r.releaseName}</div>
              </div>
            ))}
            {data.yearAverage && (
              <div className="bg-muted border border-dashed border-border rounded-lg px-[18px] py-3.5 flex-1 min-w-[160px]">
                <div className="text-xl font-bold text-muted-foreground">{data.yearAverage.totalScore}%</div>
                <div className="text-xs text-subtle-foreground mt-[3px]">{data.yearAverage.label}</div>
              </div>
            )}
          </div>

          {view === 'table' ? (
            <div className="bg-card border border-border rounded-lg overflow-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-muted">
                    <th className="px-3 py-2.5 text-right text-base text-muted-foreground font-bold border border-border">KPI</th>
                    {sortedReleases.map(r => (
                      <th key={r.releaseName} className="px-3 py-2.5 text-right text-base text-muted-foreground font-bold border border-border">{r.releaseName}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.kpiRows.map(row => (
                    <tr key={row.kpiName} className="border-b border-border">
                      <td className="px-3 py-2.5 text-sm font-semibold text-foreground border border-border">{row.kpiName}</td>
                      {sortedReleases.map(r => {
                        const v = row.perRelease[r.releaseName];
                        return (
                          <td key={r.releaseName} className={`px-3 py-2.5 text-sm font-semibold border border-border ${scoreColorClass(v)}`}>
                            {v != null ? `${v}%` : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-lg p-4">
              <ComparisonChart releases={sortedReleases} kpiRows={data.kpiRows} />
            </div>
          )}
        </>
      )}
    </div>
  );
};
