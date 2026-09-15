import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { formatDate } from '../../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface TeamMemberRow { userId: string; name: string; remainingDays: number; }
interface ForecastTracking {
  kpis: { remainingWork: number; remainingTests: number; forecastDate: string; status: 'ON_TRACK' | 'AT_RISK' | 'BEHIND_PLAN' };
  daysToGoLive: number | null;
  byTeamMember: TeamMemberRow[];
}

const STATUS_LABEL: Record<ForecastTracking['kpis']['status'], { label: string; color: string }> = {
  ON_TRACK: { label: 'בקצב', color: C.success },
  AT_RISK: { label: 'בסיכון', color: '#e8af00' },
  BEHIND_PLAN: { label: 'בחריגה', color: C.danger },
};

function KpiCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg py-4 px-5 flex-1 min-w-[140px]">
      <div className="text-xl font-bold leading-tight text-foreground" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
      <div className="text-xs text-subtle-foreground mt-[3px]">{label}</div>
    </div>
  );
}

const fmtDate = (iso: string) => formatDate(iso);

interface Props { token: string; versionId?: string; role: string; }

export const ForecastTrackingView: React.FC<Props> = ({ token, versionId }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<ForecastTracking | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!versionId) { setData(null); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/forecast-tracking/${versionId}`, { headers })
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

  const status = STATUS_LABEL[data.kpis.status];
  const maxDays = Math.max(1, ...data.byTeamMember.map(m => m.remainingDays));

  return (
    <div className="flex flex-col gap-4">
      <div className="text-lg font-bold text-foreground">📈 תחזית ומעקב</div>

      <div className="flex gap-3 flex-wrap">
        <KpiCard value={String(data.kpis.remainingWork)} label="Remaining Work (days)" />
        <KpiCard value={String(data.kpis.remainingTests)} label="Remaining Tests" />
        <KpiCard value={fmtDate(data.kpis.forecastDate)} label="Forecast Date" />
        <KpiCard value={status.label} label="Forecast Status" valueColor={status.color} />
        <KpiCard value={data.daysToGoLive !== null ? String(data.daysToGoLive) : '—'} label="Days To Go Live" />
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <div className="text-sm font-bold text-foreground mb-3">עומס נותר לפי בודק</div>
        {data.byTeamMember.length === 0 ? (
          <div className="text-sm text-subtle-foreground">אין משימות פתוחות לגרסה זו.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {data.byTeamMember.map(m => (
              <div key={m.userId}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-semibold text-foreground">{m.name}</span>
                  <span className="text-subtle-foreground">{m.remainingDays} ימים</span>
                </div>
                <div className="h-2 bg-muted rounded-sm overflow-hidden">
                  <div className="h-full bg-primary rounded-sm" style={{ width: `${(m.remainingDays / maxDays) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
