import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface ActivityRow { label: string; owner: string; category: string; dateStart: string | null; dateEnd: string | null; delayed: boolean; upcoming: boolean; }
interface TimelineActivities {
  kpis: { activities: number; delayed: number; upcoming: number; criticalMilestones: number };
  rows: ActivityRow[];
}

function KpiCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', flex: 1, minWidth: '140px' }}>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: valueColor ?? C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '10px 12px', ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textMuted, textAlign: 'right', borderBottom: `2px solid ${C.border}` };
const tdStyle: React.CSSProperties = { padding: '9px 12px', ...TEXT.sm, color: C.textPrimary, borderBottom: `1px solid ${C.border}` };
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

interface Props { token: string; versionId?: string; role: string; }

export const TimelineActivitiesView: React.FC<Props> = ({ token, versionId }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<TimelineActivities | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!versionId) { setData(null); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/timeline-activities/${versionId}`, { headers })
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

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🗓️ ציר זמן ופעילויות</div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <KpiCard value={String(data.kpis.activities)} label="Activities" />
        <KpiCard value={String(data.kpis.delayed)} label="Delayed" valueColor={data.kpis.delayed > 0 ? C.danger : C.success} />
        <KpiCard value={String(data.kpis.upcoming)} label="Upcoming" valueColor={C.brand} />
        <KpiCard value={String(data.kpis.criticalMilestones)} label="Critical Milestones" valueColor="#e8af00" />
      </div>

      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflowX: 'auto' }}>
        {data.rows.length === 0 ? (
          <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>אין פעילויות רשומות לגרסה זו.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>פעילות</th>
                <th style={thStyle}>אחראי</th>
                <th style={thStyle}>קטגוריה</th>
                <th style={thStyle}>התחלה</th>
                <th style={thStyle}>סיום</th>
                <th style={thStyle}>מצב</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{r.label}</td>
                  <td style={tdStyle}>{r.owner || '—'}</td>
                  <td style={tdStyle}>{r.category === 'golive' ? '🚀 golive' : r.category}</td>
                  <td style={tdStyle}>{fmtDate(r.dateStart)}</td>
                  <td style={{ ...tdStyle, color: r.delayed ? C.danger : C.textPrimary }}>{fmtDate(r.dateEnd)}</td>
                  <td style={tdStyle}>
                    {r.delayed && <span style={{ color: C.danger, fontWeight: WEIGHT.semibold }}>באיחור</span>}
                    {!r.delayed && r.upcoming && <span style={{ color: C.brand, fontWeight: WEIGHT.semibold }}>עתידי</span>}
                    {!r.delayed && !r.upcoming && <span style={{ color: C.success, fontWeight: WEIGHT.semibold }}>בתוקף</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
