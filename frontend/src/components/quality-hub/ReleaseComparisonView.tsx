import React, { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';

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

function scoreColor(pct: number | null): string {
  if (pct == null) return C.textMuted;
  if (pct >= 90) return C.success;
  if (pct >= 70) return '#e8af00';
  return C.danger;
}

const RELEASE_COLORS = [C.brand, C.success, '#e8af00', C.danger, C.info, '#9c6ade', '#00897b', '#f0883e'];

// Grouped bar chart: one cluster per KPI, one bar per selected release —
// lets you visually compare a KPI's relative score across releases at a
// glance, complementing the table's precise-number view.
function ComparisonChart({ releases, kpiRows }: { releases: { releaseName: string }[]; kpiRows: Comparison['kpiRows'] }) {
  const rowHeight = 34;
  const labelWidth = 260;

  return (
    <div>
      <div style={{ display: 'flex', gap: SP[4], flexWrap: 'wrap', marginBottom: SP[3], paddingBottom: SP[2], borderBottom: `1px solid ${C.border}` }}>
        {releases.map((r, i) => (
          <div key={r.releaseName} style={{ display: 'flex', alignItems: 'center', gap: SP[1] }}>
            <span style={{ width: '12px', height: '12px', borderRadius: RADIUS.sm, background: RELEASE_COLORS[i % RELEASE_COLORS.length], display: 'inline-block' }} />
            <span style={{ ...TEXT.xs, color: C.textMuted }}>{r.releaseName}</span>
          </div>
        ))}
      </div>
      <div style={{ width: '100%' }}>
        {kpiRows.map(row => (
          <div key={row.kpiName} style={{ display: 'flex', alignItems: 'center', height: `${rowHeight}px`, gap: SP[2] }}>
            <div style={{ width: `${labelWidth}px`, flexShrink: 0, ...TEXT.xs, color: C.textPrimary, fontWeight: WEIGHT.semibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.kpiName}>
              {row.kpiName}
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '3px', height: '100%' }}>
              {releases.map((r, i) => {
                const v = row.perRelease[r.releaseName];
                const pct = Math.max(0, Math.min(100, v ?? 0));
                return (
                  <div key={r.releaseName} style={{ flex: 1, height: '70%', background: C.bgNested, borderRadius: RADIUS.sm, position: 'relative', overflow: 'hidden' }} title={`${r.releaseName}: ${v != null ? v + '%' : '—'}`}>
                    <div style={{ position: 'absolute', bottom: 0, right: 0, left: 0, height: `${pct}%`, background: RELEASE_COLORS[i % RELEASE_COLORS.length], borderRadius: RADIUS.sm }} />
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
      <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>
        אין עדיין נתוני איכות גרסה. יש לייבא את שני קבצי ה-Excel דרך מסך הניהול.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: SP[2] }}>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>⚖️ השוואת גרסאות</div>
        <div style={{ display: 'flex', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
          <button onClick={() => setView('table')} style={{ padding: '6px 14px', border: 'none', background: view === 'table' ? C.brand : C.bgCard, color: view === 'table' ? '#fff' : C.textSecondary, cursor: 'pointer', ...TEXT.xs, fontWeight: WEIGHT.semibold }}>טבלה</button>
          <button onClick={() => setView('chart')} style={{ padding: '6px 14px', border: 'none', background: view === 'chart' ? C.brand : C.bgCard, color: view === 'chart' ? '#fff' : C.textSecondary, cursor: 'pointer', ...TEXT.xs, fontWeight: WEIGHT.semibold }}>גרף</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: SP[4], flexWrap: 'wrap' }}>
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[3], maxHeight: '220px', overflowY: 'auto', minWidth: '260px' }}>
          <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: SP[2] }}>בחר גרסאות להשוואה (2+)</div>
          {releases.map(r => (
            <label key={r.releaseName} style={{ display: 'flex', alignItems: 'center', gap: SP[2], padding: '4px 0', cursor: 'pointer', ...TEXT.sm }}>
              <input type="checkbox" checked={picked.includes(r.releaseName)} onChange={() => toggleRelease(r.releaseName)} />
              <span style={{ color: C.textPrimary }}>{r.releaseName}</span>
              <span style={{ color: C.textMuted, ...TEXT.xs }}>({r.totalScore}%)</span>
            </label>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: SP[2], cursor: 'pointer', ...TEXT.sm, color: C.textSecondary, alignSelf: 'flex-start' }}>
          <input type="checkbox" checked={includeYearAverage} onChange={e => setIncludeYearAverage(e.target.checked)} />
          כלול ממוצע שנתי
        </label>
      </div>

      {loading && !data ? (
        <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6] }}>טוען...</div>
      ) : !data || picked.length === 0 ? (
        <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6] }}>בחר לפחות גרסה אחת להשוואה.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
            {sortedReleases.map(r => (
              <div key={r.releaseName} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '14px 18px', flex: 1, minWidth: '160px' }}>
                <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: scoreColor(r.totalScore) }}>{r.totalScore}%</div>
                <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{r.releaseName}</div>
              </div>
            ))}
            {data.yearAverage && (
              <div style={{ background: C.bgNested, border: `1px dashed ${C.border}`, borderRadius: RADIUS.lg, padding: '14px 18px', flex: 1, minWidth: '160px' }}>
                <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: C.textSecondary }}>{data.yearAverage.totalScore}%</div>
                <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{data.yearAverage.label}</div>
              </div>
            )}
          </div>

          {view === 'table' ? (
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: C.bgNested }}>
                    <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '16px', color: C.textSecondary, fontWeight: WEIGHT.bold, border: `1px solid ${C.border}` }}>KPI</th>
                    {sortedReleases.map(r => (
                      <th key={r.releaseName} style={{ padding: '10px 12px', textAlign: 'right', fontSize: '16px', color: C.textSecondary, fontWeight: WEIGHT.bold, border: `1px solid ${C.border}` }}>{r.releaseName}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.kpiRows.map(row => (
                    <tr key={row.kpiName} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '10px 12px', ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, border: `1px solid ${C.border}` }}>{row.kpiName}</td>
                      {sortedReleases.map(r => {
                        const v = row.perRelease[r.releaseName];
                        return (
                          <td key={r.releaseName} style={{ padding: '10px 12px', ...TEXT.sm, fontWeight: WEIGHT.semibold, color: scoreColor(v), border: `1px solid ${C.border}` }}>
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
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
              <ComparisonChart releases={sortedReleases} kpiRows={data.kpiRows} />
            </div>
          )}
        </>
      )}
    </div>
  );
};
