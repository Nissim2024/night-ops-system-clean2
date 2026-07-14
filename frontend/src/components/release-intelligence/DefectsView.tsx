import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Bucket { label: string; count: number; }
interface Defects {
  kpis: { open: number; fixed: number; closed: number; rejected: number; reopen: number };
  bySeverity: Bucket[]; byStatus: Bucket[]; byTeam: Bucket[]; byProject: Bucket[];
}

function KpiCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', flex: 1, minWidth: '140px' }}>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: valueColor ?? C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
    </div>
  );
}

const BreakdownPanel: React.FC<{ title: string; rows: Bucket[] }> = ({ title, rows }) => {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], flex: 1, minWidth: '280px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP[3] }}>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{title}</div>
        <span style={{ ...TEXT.xs, color: C.textMuted, background: C.bgNested, borderRadius: RADIUS.full, padding: '2px 8px' }}>{rows.reduce((s, r) => s + r.count, 0)}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '240px', overflowY: 'auto' }}>
        {rows.length === 0 && <div style={{ ...TEXT.xs, color: C.textMuted }}>אין נתונים</div>}
        {rows.map(r => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ ...TEXT.xs, color: C.textSecondary, width: '140px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</div>
            <div style={{ flex: 1, height: '14px', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden' }}>
              <div style={{ width: `${(r.count / max) * 100}%`, height: '100%', background: C.brand, borderRadius: RADIUS.sm }} />
            </div>
            <div style={{ ...TEXT.xs, color: C.textPrimary, width: '24px', textAlign: 'left' }}>{r.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

interface Props { token: string; versionId?: string; role: string; }

export const DefectsView: React.FC<Props> = ({ token, versionId }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<Defects | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!versionId) { setData(null); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/defects/${versionId}`, { headers })
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
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🐞 באגים</div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <KpiCard value={String(data.kpis.open)} label="Open" valueColor={data.kpis.open > 0 ? C.danger : C.success} />
        <KpiCard value={String(data.kpis.fixed)} label="Fixed" valueColor={C.success} />
        <KpiCard value={String(data.kpis.closed)} label="Closed" />
        <KpiCard value={String(data.kpis.rejected)} label="Rejected" />
        <KpiCard value={String(data.kpis.reopen)} label="Reopen" valueColor={data.kpis.reopen > 0 ? '#e8af00' : C.success} />
      </div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <BreakdownPanel title="לפי חומרה" rows={data.bySeverity} />
        <BreakdownPanel title="לפי סטטוס" rows={data.byStatus} />
        <BreakdownPanel title="לפי צוות" rows={data.byTeam} />
        <BreakdownPanel title="לפי פרויקט" rows={data.byProject} />
      </div>
    </div>
  );
};
