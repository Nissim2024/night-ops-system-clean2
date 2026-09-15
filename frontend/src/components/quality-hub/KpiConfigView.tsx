import React, { useEffect, useState } from 'react';
import axios from 'axios';

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

  if (loading) return <div className="p-6 text-subtle-foreground">טוען...</div>;

  if (!defs || defs.length === 0) {
    return (
      <div className="p-8 text-center text-subtle-foreground">
        אין עדיין הגדרות KPI. יש לייבא את קובץ ה-KPI_RELEASE_SCORE_SETUP דרך מסך הניהול.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-lg font-bold text-foreground">⚙️ הגדרות KPI</div>
        <div className="text-xs text-subtle-foreground mt-1">
          מסך קריאה בלבד — הנוסחאות והמשקלים מגיעים מהמודל הארגוני הקיים ולא ניתנים לעריכה כאן.
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {defs.sort((a, b) => a.kpiOrder - b.kpiOrder).map(d => (
          <div key={d.id} className="bg-card border border-border rounded-lg p-4">
            <div className="flex justify-between items-start flex-wrap gap-2">
              <div>
                <div className="text-base font-bold text-foreground">{d.kpiOrder}. {d.kpiName}</div>
                {d.purpose && <div className="text-sm text-muted-foreground mt-0.5">{d.purpose}</div>}
              </div>
              <div className="flex gap-2 flex-wrap">
                <span className="bg-muted rounded-sm px-2.5 py-[3px] text-xs text-muted-foreground">יעד: {d.target}</span>
                <span className="bg-muted rounded-sm px-2.5 py-[3px] text-xs text-muted-foreground">משקל: {(d.weight * 100).toFixed(1)}%</span>
                <span className="bg-primary-50 rounded-sm px-2.5 py-[3px] text-xs text-primary font-semibold">{d.measuredEntity}</span>
              </div>
            </div>
            {d.description && <div className="text-sm text-subtle-foreground mt-2">{d.description}</div>}
            <div className="flex gap-4 mt-2 text-xs text-subtle-foreground">
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
