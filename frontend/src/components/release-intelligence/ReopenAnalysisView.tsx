import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { cn } from '../../lib/utils';
import { DefectDrilldownModal } from './DefectDrilldownModal';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Bucket { label: string; count: number; }
interface TrendPoint { date: string; count: number; }
interface ReopenAnalysis {
  kpis: { reopenRate: number; criticalReopen: number; productionReopen: number };
  byCr: Bucket[]; byTeam: Bucket[]; trend: TrendPoint[];
}

function KpiCard({ value, label, valueColor, onClick }: { value: string; label: string; valueColor?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cn('bg-card border border-border rounded-lg py-4 px-5 flex-1 min-w-[140px]', onClick ? 'cursor-pointer' : 'cursor-default')}>
      <div className="text-xl font-bold leading-tight text-foreground" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
      <div className="text-xs text-subtle-foreground mt-[3px]">{label}</div>
    </div>
  );
}

// byCr bars are NOT wired to a drill-down: they come from getBugDashboard's
// aggregate rows (BugRawRow-based), not DefectDto — there's no defect-level
// list behind them without a new Oracle query (see release-intelligence.
// service.ts's getDefectsDrilldown comment). byTeam IS wired — it's grouped
// straight from the same reopen: DefectDto[] the KPIs above are computed from.
const BreakdownPanel: React.FC<{ title: string; rows: Bucket[]; onBarClick?: (label: string) => void }> = ({ title, rows, onBarClick }) => {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex-1 min-w-[280px]">
      <div className="flex justify-between items-center mb-3">
        <div className="text-sm font-bold text-foreground">{title}</div>
        <span className="text-xs text-subtle-foreground bg-muted rounded-full px-2 py-0.5">{rows.reduce((s, r) => s + r.count, 0)}</span>
      </div>
      <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto">
        {rows.length === 0 && <div className="text-xs text-subtle-foreground">אין נתונים</div>}
        {rows.map(r => (
          <div key={r.label} onClick={() => onBarClick?.(r.label)} className={cn('flex items-center gap-2', onBarClick ? 'cursor-pointer' : 'cursor-default')}>
            <div className="text-xs text-muted-foreground w-[160px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap" title={r.label}>{r.label}</div>
            <div className="flex-1 h-3.5 bg-muted rounded-sm overflow-hidden">
              <div className="h-full bg-[#e8af00] rounded-sm" style={{ width: `${(r.count / max) * 100}%` }} />
            </div>
            <div className="text-xs text-foreground w-6 text-left">{r.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

interface Props { token: string; versionId?: string; role: string; }

export const ReopenAnalysisView: React.FC<Props> = ({ token, versionId }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<ReopenAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [drilldown, setDrilldown] = useState<{ filter: string; value?: string; title: string } | null>(null);

  const load = useCallback(() => {
    if (!versionId) { setData(null); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/reopen-analysis/${versionId}`, { headers })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);

  useEffect(() => { load(); }, [load]);

  if (!versionId) {
    return <div className="text-center p-8 text-subtle-foreground">בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div className="p-6 text-subtle-foreground">טוען...</div>;
  if (!data) return <div className="p-6 text-subtle-foreground">לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="text-lg font-bold text-foreground">♻️ ניתוח Reopen</div>

      <div className="flex gap-3 flex-wrap">
        <KpiCard value={`${data.kpis.reopenRate}%`} label="Reopen Rate" valueColor={data.kpis.reopenRate > 0 ? '#e8af00' : C.success} onClick={() => setDrilldown({ filter: 'reopenAll', title: 'תקלות שנפתחו מחדש (Reopen)' })} />
        <KpiCard value={String(data.kpis.criticalReopen)} label="Critical Reopen" valueColor={data.kpis.criticalReopen > 0 ? C.danger : C.success} onClick={() => setDrilldown({ filter: 'reopenCritical', title: 'תקלות Reopen — קריטיות' })} />
        <KpiCard value={String(data.kpis.productionReopen)} label="Production Reopen" valueColor={data.kpis.productionReopen > 0 ? C.danger : C.success} onClick={() => setDrilldown({ filter: 'reopenProduction', title: 'תקלות Reopen — פרודקשן' })} />
      </div>

      <div className="flex gap-3 flex-wrap">
        <BreakdownPanel title="לפי CR" rows={data.byCr} />
        <BreakdownPanel title="לפי צוות" rows={data.byTeam} onBarClick={label => setDrilldown({ filter: 'reopenTeam', value: label, title: `תקלות Reopen — צוות: ${label}` })} />
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <div className="text-sm font-bold text-foreground mb-3">מגמה יומית</div>
        {data.trend.length === 0 ? (
          <div className="text-sm text-subtle-foreground text-center p-4">אין נתוני מגמה.</div>
        ) : (
          <div className="flex gap-1 items-end h-20">
            {data.trend.map((t, i) => {
              const max = Math.max(1, ...data.trend.map(x => x.count));
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${t.date}: ${t.count}`}>
                  <div className="w-full max-w-[18px] min-h-[2px] bg-[#e8af00] rounded-t-[2px]" style={{ height: `${(t.count / max) * 60}px` }} />
                  <span className="text-subtle-foreground text-[10px] leading-[23px]">{t.count}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {drilldown && (
        <DefectDrilldownModal
          token={token}
          versionId={versionId}
          screen="reopen-analysis"
          filter={drilldown.filter}
          value={drilldown.value}
          title={drilldown.title}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
};
