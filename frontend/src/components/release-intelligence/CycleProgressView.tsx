import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface CycleTimelineItem { cycleType: string; plannedStart: string; plannedEnd: string; progressPct: number; state: 'done' | 'active' | 'upcoming'; }
interface CycleProgress {
  kpis: { currentCycle: string; qgStatus: 'PASS' | 'FAIL'; progressPct: number };
  qgSummary: Record<string, { count: number; threshold: number }>;
  timeline: CycleTimelineItem[];
}

const STATE_COLOR: Record<CycleTimelineItem['state'], string> = { done: C.success, active: C.brand, upcoming: C.textMuted };
const STATE_LABEL: Record<CycleTimelineItem['state'], string> = { done: 'הושלם', active: 'פעיל', upcoming: 'עתידי' };

function KpiCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', flex: 1, minWidth: '140px' }}>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: valueColor ?? C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
    </div>
  );
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });

interface Props { token: string; versionId?: string; role: string; }

export const CycleProgressView: React.FC<Props> = ({ token, versionId }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<CycleProgress | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!versionId) { setData(null); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/cycle-progress/${versionId}`, { headers })
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
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🔄 התקדמות סבבים ו-QG</div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <KpiCard value={data.kpis.currentCycle} label="Current Cycle" />
        <KpiCard value={data.kpis.qgStatus === 'PASS' ? '✓ PASS' : '✗ FAIL'} label="QG Status" valueColor={data.kpis.qgStatus === 'PASS' ? C.success : C.danger} />
        <KpiCard value={`${data.kpis.progressPct}%`} label="Progress %" valueColor={C.brand} />
      </div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], flex: 2, minWidth: '340px' }}>
          <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: SP[3] }}>ציר זמן סבבים</div>
          {data.timeline.length === 0 ? (
            <div style={{ ...TEXT.sm, color: C.textMuted }}>אין תוכנית עבודת QA לגרסה זו.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: SP[3] }}>
              {data.timeline.map((c, i) => (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', ...TEXT.sm, marginBottom: '4px' }}>
                    <span style={{ fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{c.cycleType}</span>
                    <span style={{ color: STATE_COLOR[c.state] }}>{STATE_LABEL[c.state]} · {c.progressPct}%</span>
                  </div>
                  <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>{fmtDate(c.plannedStart)} — {fmtDate(c.plannedEnd)}</div>
                  <div style={{ height: '6px', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden' }}>
                    <div style={{ width: `${c.progressPct}%`, height: '100%', background: STATE_COLOR[c.state], borderRadius: RADIUS.sm }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], flex: 1, minWidth: '260px' }}>
          <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: SP[3] }}>QG Summary</div>
          {Object.entries(data.qgSummary).map(([key, v]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: `${SP[1]} 0`, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ ...TEXT.sm, color: C.textPrimary }}>{key}</span>
              <span style={{ ...TEXT.sm, color: v.count > v.threshold ? C.danger : C.textMuted, fontWeight: v.count > v.threshold ? WEIGHT.bold : WEIGHT.normal }}>
                {v.count} / {v.threshold}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
