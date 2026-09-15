import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C } from '../../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface TeamLoadRow { teamId: string; teamName: string; totalDays: number; crCount: number; }
interface Capacity {
  kpis: { qaEffortDays: number; crCount: number; teamCount: number; assignmentCount: number };
  teamLoad: TeamLoadRow[];
}

function KpiCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div className="min-w-[140px] flex-1 rounded-lg border border-border bg-card px-5 py-4">
      <div className="text-xl font-bold leading-tight" style={{ color: valueColor ?? undefined }}>
        <span className={valueColor ? '' : 'text-foreground'}>{value}</span>
      </div>
      <div className="mt-1 text-xs text-subtle-foreground">{label}</div>
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
    return <div dir="rtl" className="p-8 text-center font-sans text-subtle-foreground">בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div dir="rtl" className="p-6 font-sans text-subtle-foreground">טוען...</div>;
  if (!data) return <div dir="rtl" className="p-6 font-sans text-subtle-foreground">לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  const maxDays = Math.max(1, ...data.teamLoad.map(t => t.totalDays));

  return (
    <div dir="rtl" className="flex flex-col gap-4 font-sans">
      <div className="text-lg font-bold text-foreground">⚙️ קיבולת</div>

      <div className="flex flex-wrap gap-3">
        <KpiCard value={String(data.kpis.qaEffortDays)} label="QA Effort (days)" valueColor={C.brand} />
        <KpiCard value={String(data.kpis.crCount)} label="CR Count" />
        <KpiCard value={String(data.kpis.teamCount)} label="Teams" />
        <KpiCard value={String(data.kpis.assignmentCount)} label="Assignment Count" />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 text-sm font-bold text-foreground">עומס לפי צוות</div>
        {data.teamLoad.length === 0 ? (
          <div className="text-sm text-subtle-foreground">אין נתוני שיוך צוותים לגרסה זו.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {data.teamLoad.map(t => (
              <div key={t.teamId}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-semibold text-foreground">{t.teamName}</span>
                  <span className="text-subtle-foreground">{t.totalDays} ימים · {t.crCount} CR</span>
                </div>
                <div className="h-2 overflow-hidden rounded-sm bg-muted">
                  <div className="h-full rounded-sm bg-primary" style={{ width: `${(t.totalDays / maxDays) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
