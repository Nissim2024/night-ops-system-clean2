import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface TeamLoadRow { teamId: string; teamName: string; totalDays: number; crCount: number; }
interface Capacity {
  kpis: { qaEffortDays: number; crCount: number; teamCount: number; assignmentCount: number };
  teamLoad: TeamLoadRow[];
}

function KpiCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', flex: 1, minWidth: '140px' }}>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: valueColor ?? C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
    </div>
  );
}

interface Props { token: string; versionId?: string; role: string; }

export const CapacityView: React.FC<Props> = ({ token, versionId }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<Capacity | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!versionId) { setData(null); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/capacity/${versionId}`, { headers })
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

  const maxDays = Math.max(1, ...data.teamLoad.map(t => t.totalDays));

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>⚙️ קיבולת</div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <KpiCard value={String(data.kpis.qaEffortDays)} label="QA Effort (days)" valueColor={C.brand} />
        <KpiCard value={String(data.kpis.crCount)} label="CR Count" />
        <KpiCard value={String(data.kpis.teamCount)} label="Teams" />
        <KpiCard value={String(data.kpis.assignmentCount)} label="Assignment Count" />
      </div>

      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: SP[3] }}>עומס לפי צוות</div>
        {data.teamLoad.length === 0 ? (
          <div style={{ ...TEXT.sm, color: C.textMuted }}>אין נתוני שיוך צוותים לגרסה זו.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: SP[3] }}>
            {data.teamLoad.map(t => (
              <div key={t.teamId}>
                <div style={{ display: 'flex', justifyContent: 'space-between', ...TEXT.sm, marginBottom: '4px' }}>
                  <span style={{ fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{t.teamName}</span>
                  <span style={{ color: C.textMuted }}>{t.totalDays} ימים · {t.crCount} CR</span>
                </div>
                <div style={{ height: '8px', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden' }}>
                  <div style={{ width: `${(t.totalDays / maxDays) * 100}%`, height: '100%', background: C.brand, borderRadius: RADIUS.sm }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
