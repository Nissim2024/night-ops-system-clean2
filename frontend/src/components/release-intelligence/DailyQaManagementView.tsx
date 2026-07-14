import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Row {
  crNumber: string;
  requirement: string;
  tester: string;
  secondaryTester: string | null;
  progressPct: number;
  passRatePct: number;
  openDefects: number;
  health: 'GOOD' | 'WARNING' | 'CRITICAL';
  forecastCompletion: string | null;
  isDelayed: boolean;
  isWaiting: boolean;
}

interface DailyQa {
  kpis: { openTargets: number; openDefects: number; waitingForQa: number; reopenDefects: number; delayedTargets: number };
  rows: Row[];
}

const HEALTH_COLOR: Record<Row['health'], string> = {
  GOOD: C.success, WARNING: '#e8af00', CRITICAL: C.danger,
};
const HEALTH_LABEL: Record<Row['health'], string> = {
  GOOD: 'תקין', WARNING: 'דורש תשומת לב', CRITICAL: 'קריטי',
};

function KpiCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', flex: 1, minWidth: '140px' }}>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: valueColor ?? C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
    </div>
  );
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const thStyle: React.CSSProperties = {
  padding: '10px 12px', ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textMuted,
  textAlign: 'right', borderBottom: `2px solid ${C.border}`, whiteSpace: 'nowrap',
};
const tdStyle: React.CSSProperties = {
  padding: '9px 12px', ...TEXT.sm, color: C.textPrimary, borderBottom: `1px solid ${C.border}`,
};

interface Props { token: string; versionId?: string; role: string; }

export const DailyQaManagementView: React.FC<Props> = ({ token, versionId }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<DailyQa | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!versionId) { setData(null); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/daily-qa/${versionId}`, { headers })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);

  useEffect(() => { load(); }, [load]);

  if (!versionId) {
    return (
      <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>
        בחר גרסה מתפריט הצד כדי לראות את ניהול ה-QA היומי שלה.
      </div>
    );
  }

  if (loading && !data) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>טוען...</div>;
  }

  if (!data) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>לא ניתן לטעון נתונים עבור גרסה זו.</div>;
  }

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📋 ניהול QA יומי</div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <KpiCard value={String(data.kpis.openTargets)} label="Open Targets" />
        <KpiCard value={String(data.kpis.openDefects)} label="Open Defects" valueColor={data.kpis.openDefects > 0 ? C.danger : C.success} />
        <KpiCard value={String(data.kpis.waitingForQa)} label="Waiting For QA" />
        <KpiCard value={String(data.kpis.reopenDefects)} label="Reopen Defects" valueColor={data.kpis.reopenDefects > 0 ? '#e8af00' : C.success} />
        <KpiCard value={String(data.kpis.delayedTargets)} label="Delayed Targets" valueColor={data.kpis.delayedTargets > 0 ? C.danger : C.success} />
      </div>

      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflowX: 'auto' }}>
        {data.rows.length === 0 ? (
          <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>אין CR-ים משובצים לגרסה זו.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>CR</th>
                <th style={thStyle}>דרישה</th>
                <th style={thStyle}>בודק</th>
                <th style={thStyle}>בודק שני</th>
                <th style={thStyle}>התקדמות</th>
                <th style={thStyle}>אחוז הצלחה</th>
                <th style={thStyle}>באגים פתוחים</th>
                <th style={thStyle}>מצב</th>
                <th style={thStyle}>תחזית סיום</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => (
                <tr key={r.crNumber}>
                  <td style={{ ...tdStyle, fontWeight: WEIGHT.semibold }}>{r.crNumber}</td>
                  <td style={{ ...tdStyle, maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.requirement}>{r.requirement}</td>
                  <td style={tdStyle}>{r.tester}</td>
                  <td style={{ ...tdStyle, color: r.secondaryTester ? C.textPrimary : C.textMuted }}>{r.secondaryTester ?? '—'}</td>
                  <td style={tdStyle}>{r.progressPct}%</td>
                  <td style={tdStyle}>{r.passRatePct}%</td>
                  <td style={{ ...tdStyle, color: r.openDefects > 0 ? C.danger : C.textPrimary, fontWeight: r.openDefects > 0 ? WEIGHT.bold : WEIGHT.normal }}>{r.openDefects}</td>
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: HEALTH_COLOR[r.health], fontWeight: WEIGHT.semibold }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: HEALTH_COLOR[r.health] }} />
                      {HEALTH_LABEL[r.health]}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: r.isDelayed ? C.danger : C.textPrimary }}>{fmtDate(r.forecastCompletion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
