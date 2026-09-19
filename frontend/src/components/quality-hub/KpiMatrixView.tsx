import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
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

// "בפועל" (actual/achieved score) — 3 decimal places per explicit request.
function fmt3(v: number | null): string {
  return v != null ? v.toFixed(3) : '—';
}

function fmtPct(v: number | null): string {
  return v != null ? `${v.toFixed(2)}%` : '—';
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

function scoreColorClass(pct: number | null): string {
  if (pct == null) return 'text-subtle-foreground';
  if (pct >= 90) return 'text-success';
  if (pct >= 70) return 'text-warning';
  return 'text-danger';
}

// Row background: green when the KPI met target (Score Lost ~ 0), red/pink when it missed.
function rowBgClass(scoreLostPct: number | null): string {
  if (scoreLostPct == null) return 'bg-transparent';
  return scoreLostPct >= -0.05 ? 'bg-success-bg' : 'bg-danger-bg';
}

// 100%-width stacked bar: Score (met) + Distance-from-target + Deviation (only when missed).
function StackedBar({ relativeScorePct }: { relativeScorePct: number | null }) {
  const score = Math.max(0, Math.min(100, relativeScorePct ?? 0));
  const deviation = relativeScorePct != null && relativeScorePct < 100 ? 100 - score : 0;
  return (
    <div className="flex h-[22px] rounded-sm overflow-hidden w-full">
      {score > 0 && (
        <div className="flex items-center justify-center text-xs text-white font-semibold bg-success" style={{ width: `${score}%` }}>
          {score > 12 ? `${score}%` : ''}
        </div>
      )}
      {deviation > 0 && (
        <div className="flex items-center justify-center text-xs text-white font-semibold bg-danger" style={{ width: `${deviation}%` }}>
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
  // Clicking the Total-Defects/severity cells specifically (not the rest of
  // the row) should land straight on the expanded defect list, not just the
  // KPI detail screen with a "🪲 צפה בתקלות" button still to click (user
  // feedback 2026-09-18: "אני רוצה ממש דריל משורת הסיכום העליונה").
  const [autoOpenDrilldown, setAutoOpenDrilldown] = useState(false);

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
    return (
      <KpiDetailView
        token={token} role={role} kpiName={detailKpi} releaseName={selected}
        autoOpenDrilldown={autoOpenDrilldown}
        onBack={() => { setDetailKpi(null); setAutoOpenDrilldown(false); }}
      />
    );
  }

  if (releases.length === 0 && !loading) {
    return (
      <div className="text-center p-8 text-subtle-foreground">
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

  const thClass = 'px-3 py-2.5 text-right text-base text-muted-foreground font-bold border border-border';

  const headerCell = (key: SortKey, label: string) => (
    <th
      onClick={() => toggleSort(key)}
      className={`${thClass} cursor-pointer select-none`}
    >
      {label} {sortKey === key ? (sortAsc ? '▲' : '▼') : ''}
    </th>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="text-lg font-bold text-foreground">📊 מטריצת KPI</div>
        <div className="flex gap-2 items-center">
          <div className="flex rounded-md border border-border overflow-hidden">
            <button onClick={() => setView('table')} className={`px-3.5 py-1.5 border-none cursor-pointer text-xs font-semibold ${view === 'table' ? 'bg-primary text-white' : 'bg-card text-muted-foreground'}`}>טבלה</button>
            <button onClick={() => setView('bars')} className={`px-3.5 py-1.5 border-none cursor-pointer text-xs font-semibold ${view === 'bars' ? 'bg-primary text-white' : 'bg-card text-muted-foreground'}`}>עמודות</button>
          </div>
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            className="px-3.5 py-2 border border-border rounded-md text-sm min-w-[200px]"
          >
            {releases.map(r => (
              <option key={r.releaseName} value={r.releaseName}>{r.releaseName} ({r.totalScore}%)</option>
            ))}
          </select>
        </div>
      </div>

      {loading && !data ? (
        <div className="text-sm text-subtle-foreground p-6">טוען...</div>
      ) : !data ? (
        <div className="text-sm text-subtle-foreground p-6">לא ניתן לטעון נתונים עבור גרסה זו.</div>
      ) : view === 'table' ? (
        <div className="bg-card border border-border rounded-lg overflow-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-muted">
                {headerCell('kpiOrder', '#')}
                <th className={thClass}>KPI</th>
                {headerCell('actual', 'בפועל')}
                {headerCell('target', 'יעד')}
                {headerCell('weight', 'משקל')}
                {headerCell('relativeScorePct', 'ציון יחסי')}
                {headerCell('contributionPct', 'תרומה לציון')}
                {headerCell('scoreLostPct', 'Score Lost')}
                <th className={thClass}>סה&quot;כ תקלות</th>
                <th className={thClass}>חומרה (SS/Sev/Med/Low)</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(r => (
                <tr
                  key={r.kpiName}
                  onClick={() => setDetailKpi(r.kpiName)}
                  className={`border-b border-border cursor-pointer ${rowBgClass(r.scoreLostPct)}`}
                >
                  <td className="px-3 py-2.5 text-sm text-primary font-bold border border-border underline">{r.kpiOrder}</td>
                  <td className="px-3 py-2.5 text-sm font-semibold text-foreground border border-border">{r.kpiName}</td>
                  <td className="px-3 py-2.5 text-sm text-foreground border border-border">{fmt3(r.actual)}</td>
                  <td className="px-3 py-2.5 text-sm text-subtle-foreground border border-border">{r.target}</td>
                  <td className="px-3 py-2.5 text-sm text-subtle-foreground border border-border">{(r.weight * 100).toFixed(2)}%</td>
                  <td className={`px-3 py-2.5 text-sm font-semibold border border-border ${scoreColorClass(r.relativeScorePct)}`}>{fmtPct(r.relativeScorePct)}</td>
                  <td className="px-3 py-2.5 text-sm text-foreground border border-border">{fmtPct(r.contributionPct)}</td>
                  <td className={`px-3 py-2.5 text-sm font-semibold border border-border ${r.scoreLostPct != null && r.scoreLostPct < 0 ? 'text-danger' : 'text-success'}`}>{fmtPct(r.scoreLostPct)}</td>
                  <td
                    className="px-3 py-2.5 text-sm font-semibold text-foreground border border-border underline decoration-dotted cursor-pointer"
                    title="דריל ישיר לרשימת התקלות של ה-KPI הזה"
                    onClick={e => { e.stopPropagation(); setAutoOpenDrilldown(true); setDetailKpi(r.kpiName); }}
                  >
                    {totalDefects(r.severity)}
                  </td>
                  <td
                    className="px-3 py-2.5 text-xs text-subtle-foreground border border-border underline decoration-dotted cursor-pointer"
                    title="דריל ישיר לרשימת התקלות של ה-KPI הזה"
                    onClick={e => { e.stopPropagation(); setAutoOpenDrilldown(true); setDetailKpi(r.kpiName); }}
                  >
                    {fmtCount(r.severity.showStopper)} / {fmtCount(r.severity.severe)} / {fmtCount(r.severity.medium)} / {fmtCount(r.severity.low)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
          <div className="flex gap-4 items-center pb-2 border-b border-border">
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-success inline-block" />
              <span className="text-xs text-subtle-foreground">ציון שהושג</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-danger inline-block" />
              <span className="text-xs text-subtle-foreground">סטייה מהיעד (Score Lost)</span>
            </div>
          </div>
          {barRows.map(r => (
            <div key={r.kpiName} onClick={() => setDetailKpi(r.kpiName)} className="flex items-center gap-3 cursor-pointer">
              <div className="min-w-[220px] shrink-0 text-sm font-semibold text-foreground">{r.kpiName}</div>
              <div className="flex-1">
                <StackedBar relativeScorePct={r.relativeScorePct} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
