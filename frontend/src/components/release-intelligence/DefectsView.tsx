import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { DefectDrilldownModal } from './DefectDrilldownModal';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// relId-mode drill-down URL — same screen/filter/value scheme as the
// versionId dispatcher, served by /release-intelligence/historical-defects-drilldown.
export function historicalDrilldownUrl(relId: number, screen: string, filter: string, value?: string): string {
  const params = new URLSearchParams({ screen, filter });
  if (value != null) params.set('value', value);
  return `${API}/release-intelligence/historical-defects-drilldown/${relId}?${params.toString()}`;
}

interface Bucket { label: string; count: number; }
interface Defects {
  kpis: { open: number; fixed: number; closed: number; rejected: number; reopen: number };
  bySeverity: Bucket[]; byStatus: Bucket[]; byTeam: Bucket[]; byProject: Bucket[];
}

function KpiCard({ value, label, valueClassName, onClick }: { value: string; label: string; valueClassName?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`bg-card border border-border rounded-lg px-5 py-4 flex-1 min-w-[140px] ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className={`text-xl font-bold leading-tight ${valueClassName ?? 'text-foreground'}`}>{value}</div>
      <div className="text-xs text-subtle-foreground mt-[3px]">{label}</div>
    </div>
  );
}

const BreakdownPanel: React.FC<{ title: string; rows: Bucket[]; onBarClick: (label: string) => void }> = ({ title, rows, onBarClick }) => {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex-1 min-w-[280px]">
      <div className="flex justify-between items-center mb-3">
        <div className="text-sm font-bold text-foreground">{title}</div>
        <span className="text-xs text-subtle-foreground bg-muted rounded-full px-2 py-0.5">{rows.reduce((s, r) => s + r.count, 0)}</span>
      </div>
      {/* Row layout matches DefectsHubView's BreakdownPanel (2026-09-29 fix,
          applied here too): content-sized label instead of a fixed width so
          short labels hug the bar instead of leaving a gap, and
          scrollbarGutter reserves space so the RTL-left scrollbar doesn't
          overlap the count column. */}
      <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto pl-2" style={{ scrollbarGutter: 'stable' }}>
        {rows.length === 0 && <div className="text-xs text-subtle-foreground">אין נתונים</div>}
        {rows.map(r => (
          <div key={r.label} onClick={() => onBarClick(r.label)} className="flex items-center gap-2 cursor-pointer">
            <div className="text-xs text-muted-foreground max-w-[40%] shrink-0 truncate" title={r.label}>{r.label}</div>
            <div className="min-w-0 flex-1 h-3.5 bg-muted rounded-sm overflow-hidden">
              <div className="h-full bg-primary rounded-sm" style={{ width: `${(r.count / max) * 100}%` }} />
            </div>
            <div className="text-xs text-foreground w-6 shrink-0 text-left">{r.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

interface Props {
  token: string; versionId?: string; role: string;
  // Set when navigation into this screen already carries intent (e.g. the
  // Home page's "תקלות פתוחות" tile) — opens straight into the filtered list
  // instead of landing on the KPI overview and requiring a second click
  // (spec confirmed 2026-08-31).
  autoOpenDrilldown?: { filter: string; value?: string; title: string } | null;
  // Historical QC release with no local Version (QcReleaseHistoryView) —
  // fetches and drills down by relId instead of versionId.
  relId?: number;
}

export const DefectsView: React.FC<Props> = ({ token, versionId, autoOpenDrilldown, relId }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<Defects | null>(null);
  const [loading, setLoading] = useState(false);
  const [drilldown, setDrilldown] = useState<{ filter: string; value?: string; title: string } | null>(autoOpenDrilldown ?? null);

  const load = useCallback(() => {
    if (!versionId && relId == null) { setData(null); return; }
    setLoading(true);
    const url = relId != null
      ? `${API}/release-intelligence/historical-defects/${relId}`
      : `${API}/release-intelligence/defects/${versionId}`;
    axios.get(url, { headers })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, relId, token]);

  useEffect(() => { load(); }, [load]);

  if (!versionId && relId == null) {
    return <div className="text-center p-8 text-subtle-foreground">בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div className="p-6 text-subtle-foreground">טוען...</div>;
  if (!data) return <div className="p-6 text-subtle-foreground">לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="text-lg font-bold text-foreground">🐞 באגים</div>

      <div className="flex gap-3 flex-wrap">
        <KpiCard value={String(data.kpis.open)} label="Open" valueClassName={data.kpis.open > 0 ? 'text-danger' : 'text-success'} onClick={() => setDrilldown({ filter: 'kpi', value: 'open', title: 'תקלות פתוחות (Open)' })} />
        <KpiCard value={String(data.kpis.fixed)} label="Fixed" valueClassName="text-success" onClick={() => setDrilldown({ filter: 'kpi', value: 'fixed', title: 'תקלות שתוקנו (Fixed)' })} />
        <KpiCard value={String(data.kpis.closed)} label="Closed" onClick={() => setDrilldown({ filter: 'kpi', value: 'closed', title: 'תקלות סגורות (Closed)' })} />
        <KpiCard value={String(data.kpis.rejected)} label="Rejected" onClick={() => setDrilldown({ filter: 'kpi', value: 'rejected', title: 'תקלות שנדחו (Rejected)' })} />
        <KpiCard value={String(data.kpis.reopen)} label="Reopen" valueClassName={data.kpis.reopen > 0 ? 'text-warning' : 'text-success'} onClick={() => setDrilldown({ filter: 'kpi', value: 'reopen', title: 'תקלות שנפתחו מחדש (Reopen)' })} />
      </div>

      <div className="flex gap-3 flex-wrap">
        <BreakdownPanel title="לפי חומרה" rows={data.bySeverity} onBarClick={label => setDrilldown({ filter: 'severity', value: label, title: `תקלות פתוחות — חומרה: ${label}` })} />
        <BreakdownPanel title="לפי סטטוס" rows={data.byStatus} onBarClick={label => setDrilldown({ filter: 'status', value: label, title: `תקלות — סטטוס: ${label}` })} />
        <BreakdownPanel title="לפי צוות" rows={data.byTeam} onBarClick={label => setDrilldown({ filter: 'team', value: label, title: `תקלות פתוחות — צוות: ${label}` })} />
        <BreakdownPanel title="לפי פרויקט" rows={data.byProject} onBarClick={label => setDrilldown({ filter: 'project', value: label, title: `תקלות פתוחות — פרויקט: ${label}` })} />
      </div>

      {drilldown && (
        <DefectDrilldownModal
          token={token}
          versionId={versionId}
          screen="defects"
          filter={drilldown.filter}
          value={drilldown.value}
          endpoint={relId != null ? historicalDrilldownUrl(relId, 'defects', drilldown.filter, drilldown.value) : undefined}
          title={drilldown.title}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
};
