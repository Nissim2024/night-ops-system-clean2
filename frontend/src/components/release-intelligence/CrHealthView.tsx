import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C } from '../../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Row {
  crNumber: string;
  requirement: string;
  status: 'HEALTHY' | 'AT_RISK' | 'CRITICAL';
  coveragePct: number;
  criticalDefects: number;
  reopen: number;
  progressPct: number;
}

interface CrHealth {
  kpis: { healthy: number; atRisk: number; critical: number };
  rows: Row[];
}

// Fixed 3-way status enum with a bespoke "at risk" yellow distinct from the
// theme's own warning token — kept as raw color values driven by row data,
// same precedent as StatusChip/PriorityChip and StatusBoardView's SEVERITY_COLOR.
const STATUS_COLOR: Record<Row['status'], string> = {
  HEALTHY: C.success, AT_RISK: '#e8af00', CRITICAL: C.danger,
};
const STATUS_LABEL: Record<Row['status'], string> = {
  HEALTHY: 'תקין', AT_RISK: 'בסיכון', CRITICAL: 'קריטי',
};

function KpiCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div className="min-w-[140px] flex-1 rounded-lg border border-border bg-card px-5 py-4">
      <div className="text-xl font-bold leading-tight" style={{ color: valueColor ?? C.textPrimary }}>{value}</div>
      <div className="mt-[3px] text-xs text-subtle-foreground">{label}</div>
    </div>
  );
}

// Small proportional bar — pctOf100 for percentage metrics, or value/max for counts.
function MiniBar({ label, displayValue, pct, color }: { label: string; value: number; displayValue: string; pct: number; color: string }) {
  return (
    <div className="min-w-[110px]">
      <div className="mb-0.5 flex justify-between text-xs text-subtle-foreground">
        <span>{label}</span>
        <span className="font-semibold text-foreground">{displayValue}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-sm bg-muted">
        <div className="h-full rounded-sm" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
    </div>
  );
}

interface Props { token: string; versionId?: string; role: string; }

export const CrHealthView: React.FC<Props> = ({ token, versionId }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<CrHealth | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!versionId) { setData(null); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/cr-health/${versionId}`, { headers })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);

  useEffect(() => { load(); }, [load]);

  if (!versionId) {
    return (
      <div className="p-8 text-center text-subtle-foreground" dir="rtl">
        בחר גרסה מתפריט הצד כדי לראות את בריאות ה-CR-ים שלה.
      </div>
    );
  }

  if (loading && !data) {
    return <div className="p-6 text-subtle-foreground" dir="rtl">טוען...</div>;
  }

  if (!data) {
    return <div className="p-6 text-subtle-foreground" dir="rtl">לא ניתן לטעון נתונים עבור גרסה זו.</div>;
  }

  const maxCritical = Math.max(1, ...data.rows.map(r => r.criticalDefects));
  const maxReopen = Math.max(1, ...data.rows.map(r => r.reopen));

  return (
    <div className="flex flex-col gap-4" dir="rtl">
      <div className="text-lg font-bold text-foreground">🩺 בריאות CR</div>

      <div className="flex flex-wrap gap-3">
        <KpiCard value={String(data.kpis.healthy)} label="Healthy CR" valueColor={C.success} />
        <KpiCard value={String(data.kpis.atRisk)} label="At Risk CR" valueColor="#e8af00" />
        <KpiCard value={String(data.kpis.critical)} label="Critical CR" valueColor={C.danger} />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        {data.rows.length === 0 ? (
          <div className="p-4 text-center text-sm text-subtle-foreground">אין CR-ים משובצים לגרסה זו.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {data.rows.map(r => (
              <div key={r.crNumber} className="flex items-center gap-4 border-b border-border py-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[r.status] }} />
                <div className="min-w-[220px] shrink-0">
                  <div className="truncate text-sm font-semibold text-foreground" title={r.requirement}>
                    {r.crNumber} — {r.requirement.replace(/^\d+\s*-\s*/, '')}
                  </div>
                  <div className="text-xs font-medium" style={{ color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status]}</div>
                </div>
                <div className="flex flex-1 flex-wrap gap-4">
                  <MiniBar label="Coverage" value={r.coveragePct} displayValue={`${r.coveragePct}%`} pct={r.coveragePct} color={C.brand} />
                  <MiniBar label="Critical Defects" value={r.criticalDefects} displayValue={String(r.criticalDefects)} pct={(r.criticalDefects / maxCritical) * 100} color={C.danger} />
                  <MiniBar label="Reopen" value={r.reopen} displayValue={String(r.reopen)} pct={(r.reopen / maxReopen) * 100} color="#e8af00" />
                  <MiniBar label="Progress" value={r.progressPct} displayValue={`${r.progressPct}%`} pct={r.progressPct} color={C.success} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
