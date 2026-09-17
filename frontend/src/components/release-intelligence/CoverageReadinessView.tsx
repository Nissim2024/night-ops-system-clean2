import React, { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { cn } from '../../lib/utils';
import { RadialSegmentedGauge, CR_DEFECT_SEVERITY_META } from './CycleProgressView';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface ScopedCounts {
  passed: number; failed: number; notRun: number; blocked: number; notCompleted: number; notReady: number;
  notApplicable: number; notRelevant: number; total: number; coveragePct: number;
}
interface CrGaugeRow {
  crNumber: string; crLabel: string; project: string | null;
  core: ScopedCounts; sa: ScopedCounts;
  reportedDefectsCount: number; stillOpenDefectsCount: number;
  defectsBySeverity: { showStopper: number; severe: number; medium: number; low: number };
}
interface ScopeKpis { covered: number; failed: number; blocked: number; notReady: number; coveragePct: number }
interface CoverageReadiness {
  kpis: { core: ScopeKpis; sa: ScopeKpis };
  crRows: CrGaugeRow[];
}

type Scope = 'core' | 'sa';

function KpiCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div className="min-w-[140px] flex-1 rounded-lg border border-border bg-card px-5 py-4">
      <div className="text-xl font-bold leading-tight" style={{ color: valueColor ?? undefined }}>
        <span className={valueColor ? '' : 'text-foreground'}>{value}</span>
      </div>
      <div className="mt-1 text-xs text-subtle-foreground">{label}</div>
    </div>
  );
}

// Same "clock" card shape as CycleProgressView's per-CR cards (2026-09-14) —
// gauge dominant, defect badge below — just scoped to whichever toggle
// (core cycles / Stand Alone) is active instead of one specific cycle, since
// this screen's own point is "progress across the whole test plan" per the
// user's wording, not a single cycle's snapshot.
function CrGaugeCard({ row, scope }: { row: CrGaugeRow; scope: Scope }) {
  const counts = row[scope];
  const hasData = counts.total > 0;
  const successPct = hasData ? Math.round((counts.passed / counts.total) * 100) : null;
  const openDefectsTotal = Object.values(row.defectsBySeverity).reduce((s, n) => s + n, 0);
  return (
    <div className="bg-card border border-border rounded-lg p-3 flex flex-col items-center gap-2 text-center">
      <div className="w-full text-sm font-semibold text-foreground min-w-0" title={`${row.crNumber} — ${row.crLabel.replace(/^\d+\s*-\s*/, '')}`}>
        <span className="font-bold">{row.crNumber}</span>
        {' — '}
        <span className="line-clamp-1">{row.crLabel.replace(/^\d+\s*-\s*/, '')}</span>
      </div>

      <RadialSegmentedGauge
        passed={counts.passed} failed={counts.failed} blocked={counts.blocked}
        notCompleted={counts.notCompleted} notRun={counts.notRun} notReady={counts.notReady}
        notApplicable={counts.notApplicable} notRelevant={counts.notRelevant}
        total={counts.total} targetPct={null} successPct={successPct}
        size={96}
      />

      {row.project && <div className="text-xs text-subtle-foreground truncate w-full">📁 {row.project}</div>}

      {row.reportedDefectsCount > 0 && (
        <span
          className="inline-flex items-center gap-1 text-xs font-semibold rounded-full py-0.5 px-[9px] whitespace-nowrap"
          style={{ color: C.danger, background: `${C.danger}14`, border: `1px solid ${C.danger}40` }}
          title={openDefectsTotal > 0
            ? Object.entries(row.defectsBySeverity).filter(([, n]) => n > 0)
                .map(([key, n]) => `${CR_DEFECT_SEVERITY_META[key].label}: ${n}`).join(' · ')
            : undefined}
        >
          🐞 {row.stillOpenDefectsCount}/{row.reportedDefectsCount}
        </span>
      )}
    </div>
  );
}

interface Props { token: string; versionId?: string; role: string; }

export const CoverageReadinessView: React.FC<Props> = ({ token, versionId }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<CoverageReadiness | null>(null);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<Scope>('core');
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    if (!versionId) { setData(null); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/coverage-readiness/${versionId}`, { headers })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);

  useEffect(() => { load(); }, [load]);

  const visibleRows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.crRows
      .filter(r => r[scope].total > 0)
      .filter(r => !q || r.crNumber.toLowerCase().includes(q) || r.crLabel.toLowerCase().includes(q))
      // Worst-first: any failed/blocked pushes a CR to the top, then lowest
      // pass-rate — same instinct the old row-list screen used.
      .sort((a, b) => {
        const ca = a[scope]; const cb = b[scope];
        const riskA = ca.failed > 0 || ca.blocked > 0 ? 1 : 0;
        const riskB = cb.failed > 0 || cb.blocked > 0 ? 1 : 0;
        if (riskA !== riskB) return riskB - riskA;
        const pctA = ca.total > 0 ? ca.passed / ca.total : 1;
        const pctB = cb.total > 0 ? cb.passed / cb.total : 1;
        return pctA - pctB;
      });
  }, [data, scope, search]);

  if (!versionId) {
    return <div dir="rtl" className="p-8 text-center font-sans text-subtle-foreground">בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div dir="rtl" className="p-6 font-sans text-subtle-foreground">טוען...</div>;
  if (!data) return <div dir="rtl" className="p-6 font-sans text-subtle-foreground">לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  const kpis = data.kpis[scope];

  return (
    <div dir="rtl" className="flex flex-col gap-4 font-sans">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-lg font-bold text-foreground">✅ כיסוי ומוכנות</div>

        {/* CORE (Cycle 1/2/3) / Stand Alone toggle (2026-09-14) — this screen
            tracks progress across the whole test plan, and a CR's scripts can
            live under either bucket (or both). */}
        <div className="inline-flex rounded-md border border-border bg-muted p-0.5">
          {(['core', 'sa'] as Scope[]).map(s => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={cn(
                'rounded-[5px] px-3 py-1 text-xs font-semibold whitespace-nowrap',
                scope === s ? 'bg-card text-foreground shadow-xs' : 'text-subtle-foreground cursor-pointer'
              )}
            >
              {s === 'core' ? 'פיתוחי ליבה' : 'Stand Alone'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <KpiCard value={String(kpis.covered)} label="Covered" valueColor={C.success} />
        <KpiCard value={String(kpis.failed)} label="Failed" valueColor={kpis.failed > 0 ? C.danger : C.success} />
        <KpiCard value={String(kpis.blocked)} label="Blocked" valueColor={kpis.blocked > 0 ? '#e8af00' : C.success} />
        <KpiCard value={String(kpis.notReady)} label="Not Ready" />
        <KpiCard value={`${kpis.coveragePct.toFixed(2)}%`} label="Coverage %" valueColor={C.brand} />
      </div>

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="חיפוש לפי שם או מספר CR..."
        className="w-full max-w-sm rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
      />

      {visibleRows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-subtle-foreground">
          {search ? 'אין CR-ים התואמים את החיפוש.' : 'אין נתוני כיסוי להצגה בתצוגה הזו.'}
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
          {visibleRows.map(r => <CrGaugeCard key={r.crNumber} row={r} scope={scope} />)}
        </div>
      )}
    </div>
  );
};
