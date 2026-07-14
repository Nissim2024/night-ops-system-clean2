import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';

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

const STATUS_COLOR: Record<Row['status'], string> = {
  HEALTHY: C.success, AT_RISK: '#e8af00', CRITICAL: C.danger,
};
const STATUS_LABEL: Record<Row['status'], string> = {
  HEALTHY: 'תקין', AT_RISK: 'בסיכון', CRITICAL: 'קריטי',
};

function KpiCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', flex: 1, minWidth: '140px' }}>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: valueColor ?? C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
    </div>
  );
}

// Small proportional bar — pctOf100 for percentage metrics, or value/max for counts.
function MiniBar({ label, value, displayValue, pct, color }: { label: string; value: number; displayValue: string; pct: number; color: string }) {
  return (
    <div style={{ minWidth: '110px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', ...TEXT.xs, color: C.textMuted, marginBottom: '2px' }}>
        <span>{label}</span>
        <span style={{ color: C.textPrimary, fontWeight: WEIGHT.semibold }}>{displayValue}</span>
      </div>
      <div style={{ height: '6px', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color, borderRadius: RADIUS.sm }} />
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
      <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>
        בחר גרסה מתפריט הצד כדי לראות את בריאות ה-CR-ים שלה.
      </div>
    );
  }

  if (loading && !data) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>טוען...</div>;
  }

  if (!data) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>לא ניתן לטעון נתונים עבור גרסה זו.</div>;
  }

  const maxCritical = Math.max(1, ...data.rows.map(r => r.criticalDefects));
  const maxReopen = Math.max(1, ...data.rows.map(r => r.reopen));

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🩺 בריאות CR</div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <KpiCard value={String(data.kpis.healthy)} label="Healthy CR" valueColor={C.success} />
        <KpiCard value={String(data.kpis.atRisk)} label="At Risk CR" valueColor="#e8af00" />
        <KpiCard value={String(data.kpis.critical)} label="Critical CR" valueColor={C.danger} />
      </div>

      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
        {data.rows.length === 0 ? (
          <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[4] }}>אין CR-ים משובצים לגרסה זו.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: SP[3] }}>
            {data.rows.map(r => (
              <div key={r.crNumber} style={{ display: 'flex', alignItems: 'center', gap: SP[4], padding: `${SP[2]} 0`, borderBottom: `1px solid ${C.border}` }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: STATUS_COLOR[r.status], flexShrink: 0 }} />
                <div style={{ minWidth: '220px', flexShrink: 0 }}>
                  <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.requirement}>
                    {r.crNumber} — {r.requirement.replace(/^\d+\s*-\s*/, '')}
                  </div>
                  <div style={{ ...TEXT.xs, color: STATUS_COLOR[r.status], fontWeight: WEIGHT.medium }}>{STATUS_LABEL[r.status]}</div>
                </div>
                <div style={{ display: 'flex', gap: SP[4], flex: 1, flexWrap: 'wrap' }}>
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
