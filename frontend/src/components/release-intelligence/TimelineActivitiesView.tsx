import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { cn } from '../../lib/utils';
import { formatDate } from '../../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface ActivityRow { label: string; owner: string; category: string; dateStart: string | null; dateEnd: string | null; delayed: boolean; upcoming: boolean; }
interface TimelineActivities {
  kpis: { activities: number; delayed: number; upcoming: number; criticalMilestones: number };
  rows: ActivityRow[];
}

function KpiCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div className="min-w-[140px] flex-1 rounded-lg border border-border bg-card px-5 py-4">
      <div className="text-xl font-bold leading-tight" style={{ color: valueColor ?? C.textPrimary }}>{value}</div>
      <div className="mt-[3px] text-xs text-subtle-foreground">{label}</div>
    </div>
  );
}

const thClass = 'border-b-2 border-border px-3 py-2.5 text-right text-xs font-semibold text-subtle-foreground';
const tdClass = 'border-b border-border px-3 py-[9px] text-sm text-foreground';
const fmtDate = (iso: string | null) => iso ? formatDate(iso) : '—';

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
    return <div className="p-8 text-center text-subtle-foreground" dir="rtl">בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div className="p-6 text-subtle-foreground" dir="rtl">טוען...</div>;
  if (!data) return <div className="p-6 text-subtle-foreground" dir="rtl">לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  return (
    <div className="flex flex-col gap-4" dir="rtl">
      <div className="text-lg font-bold text-foreground">🗓️ ציר זמן ופעילויות</div>

      <div className="flex flex-wrap gap-3">
        <KpiCard value={String(data.kpis.activities)} label="Activities" />
        <KpiCard value={String(data.kpis.delayed)} label="Delayed" valueColor={data.kpis.delayed > 0 ? C.danger : C.success} />
        <KpiCard value={String(data.kpis.upcoming)} label="Upcoming" valueColor={C.brand} />
        <KpiCard value={String(data.kpis.criticalMilestones)} label="Critical Milestones" valueColor="#e8af00" />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        {data.rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-subtle-foreground">אין פעילויות רשומות לגרסה זו.</div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={thClass}>פעילות</th>
                <th className={thClass}>אחראי</th>
                <th className={thClass}>קטגוריה</th>
                <th className={thClass}>התחלה</th>
                <th className={thClass}>סיום</th>
                <th className={thClass}>מצב</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i}>
                  <td className={tdClass}>{r.label}</td>
                  <td className={tdClass}>{r.owner || '—'}</td>
                  <td className={tdClass}>{r.category === 'golive' ? '🚀 golive' : r.category}</td>
                  <td className={tdClass}>{fmtDate(r.dateStart)}</td>
                  <td className={cn(tdClass, r.delayed ? 'text-danger' : 'text-foreground')}>{fmtDate(r.dateEnd)}</td>
                  <td className={tdClass}>
                    {r.delayed && <span className="font-semibold text-danger">באיחור</span>}
                    {!r.delayed && r.upcoming && <span className="font-semibold text-primary">עתידי</span>}
                    {!r.delayed && !r.upcoming && <span className="font-semibold text-success">בתוקף</span>}
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
