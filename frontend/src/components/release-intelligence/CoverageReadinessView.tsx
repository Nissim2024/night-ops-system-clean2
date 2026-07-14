import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Req {
  title: string; subject: string; planned: number; passed: number; failed: number; blocked: number; notReady: number; notRun: number;
}
interface CoverageReadiness {
  kpis: { covered: number; failed: number; blocked: number; notReady: number; coveragePct: number };
  byRequirement: Req[];
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

interface Props { token: string; versionId?: string; role: string; }

export const CoverageReadinessView: React.FC<Props> = ({ token, versionId }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<CoverageReadiness | null>(null);
  const [loading, setLoading] = useState(false);

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

  if (!versionId) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>טוען...</div>;
  if (!data) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>✅ כיסוי ומוכנות</div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <KpiCard value={String(data.kpis.covered)} label="Covered" valueColor={C.success} />
        <KpiCard value={String(data.kpis.failed)} label="Failed" valueColor={data.kpis.failed > 0 ? C.danger : C.success} />
        <KpiCard value={String(data.kpis.blocked)} label="Blocked" valueColor={data.kpis.blocked > 0 ? '#e8af00' : C.success} />
        <KpiCard value={String(data.kpis.notReady)} label="Not Ready" />
        <KpiCard value={`${data.kpis.coveragePct}%`} label="Coverage %" valueColor={C.brand} />
      </div>

      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflowX: 'auto' }}>
        {data.byRequirement.length === 0 ? (
          <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>אין נתוני כיסוי לגרסה זו.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>נושא</th>
                <th style={thStyle}>כותרת</th>
                <th style={thStyle}>מתוכנן</th>
                <th style={thStyle}>עבר</th>
                <th style={thStyle}>נכשל</th>
                <th style={thStyle}>חסום</th>
                <th style={thStyle}>לא מוכן</th>
                <th style={thStyle}>לא הורץ</th>
              </tr>
            </thead>
            <tbody>
              {data.byRequirement.map((r, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{r.subject || '—'}</td>
                  <td style={{ ...tdStyle, maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.title}>{r.title}</td>
                  <td style={tdStyle}>{r.planned}</td>
                  <td style={{ ...tdStyle, color: C.success }}>{r.passed}</td>
                  <td style={{ ...tdStyle, color: r.failed > 0 ? C.danger : C.textPrimary }}>{r.failed}</td>
                  <td style={{ ...tdStyle, color: r.blocked > 0 ? '#e8af00' : C.textPrimary }}>{r.blocked}</td>
                  <td style={tdStyle}>{r.notReady}</td>
                  <td style={tdStyle}>{r.notRun}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
