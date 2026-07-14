import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface KpiDef {
  id: string; kpiOrder: number; kpiName: string; kpiType: string;
  target: number; weight: number; measuredEntity: string;
  purpose: string | null; description: string | null;
  dataSource: string | null; measurementPeriod: string | null; trend: string | null;
}

interface Props { token: string; role: string; }

export const KpiConfigView: React.FC<Props> = ({ token }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [defs, setDefs] = useState<KpiDef[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${API}/quality-hub/kpi-definitions`, { headers })
      .then(res => setDefs(res.data))
      .catch(() => setDefs(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (loading) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>טוען...</div>;

  if (!defs || defs.length === 0) {
    return (
      <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>
        אין עדיין הגדרות KPI. יש לייבא את קובץ ה-KPI_RELEASE_SCORE_SETUP דרך מסך הניהול.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>⚙️ הגדרות KPI</div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: SP[1] }}>
          מסך קריאה בלבד — הנוסחאות והמשקלים מגיעים מהמודל הארגוני הקיים ולא ניתנים לעריכה כאן.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: SP[3] }}>
        {defs.sort((a, b) => a.kpiOrder - b.kpiOrder).map(d => (
          <div key={d.id} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: SP[2] }}>
              <div>
                <div style={{ ...TEXT.base, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{d.kpiOrder}. {d.kpiName}</div>
                {d.purpose && <div style={{ ...TEXT.sm, color: C.textSecondary, marginTop: '2px' }}>{d.purpose}</div>}
              </div>
              <div style={{ display: 'flex', gap: SP[2], flexWrap: 'wrap' }}>
                <span style={{ background: C.bgNested, borderRadius: RADIUS.sm, padding: '3px 10px', ...TEXT.xs, color: C.textSecondary }}>יעד: {d.target}</span>
                <span style={{ background: C.bgNested, borderRadius: RADIUS.sm, padding: '3px 10px', ...TEXT.xs, color: C.textSecondary }}>משקל: {(d.weight * 100).toFixed(1)}%</span>
                <span style={{ background: C.brandDim, borderRadius: RADIUS.sm, padding: '3px 10px', ...TEXT.xs, color: C.brand, fontWeight: WEIGHT.semibold }}>{d.measuredEntity}</span>
              </div>
            </div>
            {d.description && <div style={{ ...TEXT.sm, color: C.textMuted, marginTop: SP[2] }}>{d.description}</div>}
            <div style={{ display: 'flex', gap: SP[4], marginTop: SP[2], ...TEXT.xs, color: C.textDisabled }}>
              {d.dataSource && <span>מקור: {d.dataSource}</span>}
              {d.measurementPeriod && <span>תקופת מדידה: {d.measurementPeriod}</span>}
              {d.trend && <span>מגמה רצויה: {d.trend}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
