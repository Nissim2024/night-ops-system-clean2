import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';
import { KpiDetailView } from './KpiDetailView';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface ReleaseSummary { releaseName: string; totalScore: number; year: number | null; }
interface KpiRow {
  kpiName: string; kpiOrder: number;
  actual: number | null; target: number; weight: number;
  relativeScorePct: number | null; contributionPct: number | null; scoreLostPct: number | null;
  severity: { showStopper: number | null; severe: number | null; medium: number | null; low: number | null };
}
interface Matrix { releaseName: string; rows: KpiRow[]; }

type SortKey = 'kpiOrder' | 'actual' | 'target' | 'weight' | 'relativeScorePct' | 'contributionPct' | 'scoreLostPct';

function fmt2(v: number | null): string {
  return v != null ? v.toFixed(2) : '—';
}

// Severity breakdown values are defect COUNTS — always whole, non-negative.
function fmtCount(v: number | null): string {
  return v != null ? String(Math.round(Math.abs(v))) : '—';
}

// Severity fields are defect counts — round each before summing so a total
// never shows a long float even if the underlying source data has one.
function totalDefects(s: KpiRow['severity']): number {
  return Math.round(Math.abs(s.showStopper ?? 0)) + Math.round(Math.abs(s.severe ?? 0)) +
    Math.round(Math.abs(s.medium ?? 0)) + Math.round(Math.abs(s.low ?? 0));
}

function scoreColor(pct: number | null): string {
  if (pct == null) return C.textMuted;
  if (pct >= 90) return C.success;
  if (pct >= 70) return '#e8af00';
  return C.danger;
}

// Row background: green when the KPI met target (Score Lost ~ 0), red/pink when it missed.
function rowBg(scoreLostPct: number | null): string {
  if (scoreLostPct == null) return 'transparent';
  return scoreLostPct >= -0.05 ? C.bgDone : C.bgBlocked;
}

// 100%-width stacked bar: Score (met) + Distance-from-target + Deviation (only when missed).
function StackedBar({ relativeScorePct }: { relativeScorePct: number | null }) {
  const score = Math.max(0, Math.min(100, relativeScorePct ?? 0));
  const deviation = relativeScorePct != null && relativeScorePct < 100 ? 100 - score : 0;
  return (
    <div style={{ display: 'flex', height: '22px', borderRadius: RADIUS.sm, overflow: 'hidden', width: '100%' }}>
      {score > 0 && (
        <div style={{ width: `${score}%`, background: C.success, display: 'flex', alignItems: 'center', justifyContent: 'center', ...TEXT.xs, color: '#fff', fontWeight: WEIGHT.semibold }}>
          {score > 12 ? `${score}%` : ''}
        </div>
      )}
      {deviation > 0 && (
        <div style={{ width: `${deviation}%`, background: C.danger, display: 'flex', alignItems: 'center', justifyContent: 'center', ...TEXT.xs, color: '#fff', fontWeight: WEIGHT.semibold }}>
          {deviation > 8 ? `${Math.round(deviation)}%` : ''}
        </div>
      )}
    </div>
  );
}

interface Props { token: string; role: string; initialRelease?: string; }

export const KpiMatrixView: React.FC<Props> = ({ token, role, initialRelease }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [data, setData] = useState<Matrix | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'table' | 'bars'>('table');
  const [sortKey, setSortKey] = useState<SortKey>('kpiOrder');
  const [sortAsc, setSortAsc] = useState(true);
  const [detailKpi, setDetailKpi] = useState<string | null>(null);

  useEffect(() => {
    axios.get(`${API}/quality-hub/releases`, { headers })
      .then(res => {
        setReleases(res.data);
        if (res.data.length > 0) setSelected(initialRelease || res.data[0].releaseName);
      })
      .catch(() => setReleases([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Jump to whatever release was selected from another screen (e.g. Overview chart click).
  useEffect(() => {
    if (initialRelease) setSelected(initialRelease);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRelease]);

  const load = useCallback(() => {
    if (!selected) return;
    setLoading(true);
    axios.get(`${API}/quality-hub/kpi-matrix/${encodeURIComponent(selected)}`, { headers })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, token]);

  useEffect(() => { load(); }, [load]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  if (detailKpi) {
    return <KpiDetailView token={token} role={role} kpiName={detailKpi} releaseName={selected} onBack={() => setDetailKpi(null)} />;
  }

  if (releases.length === 0 && !loading) {
    return (
      <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>
        אין עדיין נתוני איכות גרסה. יש לייבא את שני קבצי ה-Excel דרך מסך הניהול.
      </div>
    );
  }

  const sortedRows = data ? [...data.rows].sort((a, b) => {
    const va = a[sortKey] ?? -Infinity;
    const vb = b[sortKey] ?? -Infinity;
    return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number);
  }) : [];

  // Bar view sorted by KPI order (matches the source deck), not worst-first.
  const barRows = data ? [...data.rows].sort((a, b) => a.kpiOrder - b.kpiOrder) : [];

  const headerCell = (key: SortKey, label: string) => (
    <th
      onClick={() => toggleSort(key)}
      style={{ padding: '10px 12px', textAlign: 'right', fontSize: '16px', color: C.textSecondary, fontWeight: WEIGHT.bold, border: `1px solid ${C.border}`, cursor: 'pointer', userSelect: 'none' }}
    >
      {label} {sortKey === key ? (sortAsc ? '▲' : '▼') : ''}
    </th>
  );

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: SP[2] }}>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📊 מטריצת KPI</div>
        <div style={{ display: 'flex', gap: SP[2], alignItems: 'center' }}>
          <div style={{ display: 'flex', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
            <button onClick={() => setView('table')} style={{ padding: '6px 14px', border: 'none', background: view === 'table' ? C.brand : C.bgCard, color: view === 'table' ? '#fff' : C.textSecondary, cursor: 'pointer', ...TEXT.xs, fontWeight: WEIGHT.semibold }}>טבלה</button>
            <button onClick={() => setView('bars')} style={{ padding: '6px 14px', border: 'none', background: view === 'bars' ? C.brand : C.bgCard, color: view === 'bars' ? '#fff' : C.textSecondary, cursor: 'pointer', ...TEXT.xs, fontWeight: WEIGHT.semibold }}>עמודות</button>
          </div>
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
      </div>

      {loading && !data ? (
        <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6] }}>טוען...</div>
      ) : !data ? (
        <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6] }}>לא ניתן לטעון נתונים עבור גרסה זו.</div>
      ) : view === 'table' ? (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.bgNested }}>
                {headerCell('kpiOrder', '#')}
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '16px', color: C.textSecondary, fontWeight: WEIGHT.bold, border: `1px solid ${C.border}` }}>KPI</th>
                {headerCell('actual', 'בפועל')}
                {headerCell('target', 'יעד')}
                {headerCell('weight', 'משקל')}
                {headerCell('relativeScorePct', 'ציון יחסי')}
                {headerCell('contributionPct', 'תרומה לציון')}
                {headerCell('scoreLostPct', 'Score Lost')}
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '16px', color: C.textSecondary, fontWeight: WEIGHT.bold, border: `1px solid ${C.border}` }}>סה&quot;כ תקלות</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '16px', color: C.textSecondary, fontWeight: WEIGHT.bold, border: `1px solid ${C.border}` }}>חומרה (SS/Sev/Med/Low)</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(r => (
                <tr
                  key={r.kpiName}
                  onClick={() => setDetailKpi(r.kpiName)}
                  style={{ borderBottom: `1px solid ${C.border}`, background: rowBg(r.scoreLostPct), cursor: 'pointer' }}
                >
                  <td style={{ padding: '10px 12px', ...TEXT.sm, color: C.textLink, fontWeight: WEIGHT.bold, border: `1px solid ${C.border}`, textDecoration: 'underline' }}>{r.kpiOrder}</td>
                  <td style={{ padding: '10px 12px', ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, border: `1px solid ${C.border}` }}>{r.kpiName}</td>
                  <td style={{ padding: '10px 12px', ...TEXT.sm, color: C.textPrimary, border: `1px solid ${C.border}` }}>{fmt2(r.actual)}</td>
                  <td style={{ padding: '10px 12px', ...TEXT.sm, color: C.textMuted, border: `1px solid ${C.border}` }}>{r.target}</td>
                  <td style={{ padding: '10px 12px', ...TEXT.sm, color: C.textMuted, border: `1px solid ${C.border}` }}>{(r.weight * 100).toFixed(1)}%</td>
                  <td style={{ padding: '10px 12px', ...TEXT.sm, fontWeight: WEIGHT.semibold, color: scoreColor(r.relativeScorePct), border: `1px solid ${C.border}` }}>{r.relativeScorePct != null ? `${r.relativeScorePct}%` : '—'}</td>
                  <td style={{ padding: '10px 12px', ...TEXT.sm, color: C.textPrimary, border: `1px solid ${C.border}` }}>{r.contributionPct != null ? `${r.contributionPct}%` : '—'}</td>
                  <td style={{ padding: '10px 12px', ...TEXT.sm, fontWeight: WEIGHT.semibold, color: r.scoreLostPct != null && r.scoreLostPct < 0 ? C.danger : C.success, border: `1px solid ${C.border}` }}>{r.scoreLostPct != null ? `${r.scoreLostPct}%` : '—'}</td>
                  <td style={{ padding: '10px 12px', ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, border: `1px solid ${C.border}` }}>{totalDefects(r.severity)}</td>
                  <td style={{ padding: '10px 12px', ...TEXT.xs, color: C.textMuted, border: `1px solid ${C.border}` }}>
                    {fmtCount(r.severity.showStopper)} / {fmtCount(r.severity.severe)} / {fmtCount(r.severity.medium)} / {fmtCount(r.severity.low)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], display: 'flex', flexDirection: 'column', gap: SP[3] }}>
          <div style={{ display: 'flex', gap: SP[4], alignItems: 'center', paddingBottom: SP[2], borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: SP[1] }}>
              <span style={{ width: '12px', height: '12px', borderRadius: RADIUS.sm, background: C.success, display: 'inline-block' }} />
              <span style={{ ...TEXT.xs, color: C.textMuted }}>ציון שהושג</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: SP[1] }}>
              <span style={{ width: '12px', height: '12px', borderRadius: RADIUS.sm, background: C.danger, display: 'inline-block' }} />
              <span style={{ ...TEXT.xs, color: C.textMuted }}>סטייה מהיעד (Score Lost)</span>
            </div>
          </div>
          {barRows.map(r => (
            <div key={r.kpiName} onClick={() => setDetailKpi(r.kpiName)} style={{ display: 'flex', alignItems: 'center', gap: SP[3], cursor: 'pointer' }}>
              <div style={{ minWidth: '220px', flexShrink: 0, ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{r.kpiName}</div>
              <div style={{ flex: 1 }}>
                <StackedBar relativeScorePct={r.relativeScorePct} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
