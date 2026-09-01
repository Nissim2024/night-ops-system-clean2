import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';
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
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', flex: 1, minWidth: '140px' }}>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: valueColor ?? C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
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
    return <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>טוען...</div>;
  if (!data) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  const status = STATUS_LABEL[data.kpis.status];
  const maxDays = Math.max(1, ...data.byTeamMember.map(m => m.remainingDays));

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📈 תחזית ומעקב</div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <KpiCard value={String(data.kpis.remainingWork)} label="Remaining Work (days)" />
        <KpiCard value={String(data.kpis.remainingTests)} label="Remaining Tests" />
        <KpiCard value={fmtDate(data.kpis.forecastDate)} label="Forecast Date" />
        <KpiCard value={status.label} label="Forecast Status" valueColor={status.color} />
        <KpiCard value={data.daysToGoLive !== null ? String(data.daysToGoLive) : '—'} label="Days To Go Live" />
      </div>

      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: SP[3] }}>עומס נותר לפי בודק</div>
        {data.byTeamMember.length === 0 ? (
          <div style={{ ...TEXT.sm, color: C.textMuted }}>אין משימות פתוחות לגרסה זו.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: SP[3] }}>
            {data.byTeamMember.map(m => (
              <div key={m.userId}>
                <div style={{ display: 'flex', justifyContent: 'space-between', ...TEXT.sm, marginBottom: '4px' }}>
                  <span style={{ fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{m.name}</span>
                  <span style={{ color: C.textMuted }}>{m.remainingDays} ימים</span>
                </div>
                <div style={{ height: '8px', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden' }}>
                  <div style={{ width: `${(m.remainingDays / maxDays) * 100}%`, height: '100%', background: C.brand, borderRadius: RADIUS.sm }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
