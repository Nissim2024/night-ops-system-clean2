import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { formatDateTime } from '../../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface GoNoGo {
  versionId: string;
  systemRecommendation: 'GO' | 'CONDITIONAL_GO' | 'NO_GO';
  qaManagerStatus: string | null;
  qaManagerBy: string | null;
  qaManagerAt: string | null;
  releaseManagerStatus: string | null;
  releaseManagerBy: string | null;
  releaseManagerAt: string | null;
  managementStatus: string | null;
  managementBy: string | null;
  managementAt: string | null;
}

const RECOMMENDATION_STYLE: Record<GoNoGo['systemRecommendation'], { bg: string; border: string; text: string; label: string }> = {
  GO:             { bg: 'bg-success-bg', border: 'border-success', text: 'text-success', label: '✅ GO' },
  CONDITIONAL_GO: { bg: 'bg-warning-bg', border: 'border-warning', text: 'text-warning', label: '⚠️ CONDITIONAL GO' },
  NO_GO:          { bg: 'bg-danger-bg', border: 'border-danger', text: 'text-danger', label: '⛔ NO GO' },
};

type Stage = 'qa-manager' | 'release-manager' | 'management';

const STAGES: { key: Stage; label: string; statusField: keyof GoNoGo; byField: keyof GoNoGo; atField: keyof GoNoGo; roles: string[] }[] = [
  { key: 'qa-manager', label: 'אישור מנהל QA', statusField: 'qaManagerStatus', byField: 'qaManagerBy', atField: 'qaManagerAt', roles: ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'] },
  { key: 'release-manager', label: 'אישור מנהל גרסה', statusField: 'releaseManagerStatus', byField: 'releaseManagerBy', atField: 'releaseManagerAt', roles: ['RELEASE_MANAGER', 'ADMIN'] },
  { key: 'management', label: 'אישור הנהלה', statusField: 'managementStatus', byField: 'managementBy', atField: 'managementAt', roles: ['RELEASE_MANAGER', 'ADMIN'] },
];

const STATUS_COLOR_CLASS: Record<string, string> = { APPROVED: 'text-success', REJECTED: 'text-danger', PENDING: 'text-subtle-foreground' };
const STATUS_LABEL: Record<string, string> = { APPROVED: 'אושר', REJECTED: 'נדחה', PENDING: 'ממתין' };

interface Props { token: string; versionId?: string; role: string; }

export const GoNoGoView: React.FC<Props> = ({ token, versionId, role }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<GoNoGo | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<Stage | null>(null);

  const load = useCallback(() => {
    if (!versionId) { setData(null); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/go-no-go/${versionId}`, { headers })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);

  useEffect(() => { load(); }, [load]);

  const setStage = async (stage: Stage, status: 'APPROVED' | 'REJECTED') => {
    if (!versionId) return;
    setSaving(stage);
    try {
      await axios.patch(`${API}/release-intelligence/go-no-go/${versionId}/${stage}`, { status }, { headers });
      load();
    } catch (e) { console.error('failed to update go/no-go stage', e); }
    finally { setSaving(null); }
  };

  if (!versionId) {
    return <div className="text-center p-8 text-subtle-foreground">בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div className="p-6 text-subtle-foreground">טוען...</div>;
  if (!data) return <div className="p-6 text-subtle-foreground">לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  const rec = RECOMMENDATION_STYLE[data.systemRecommendation];

  return (
    <div className="flex flex-col gap-4">
      <div className="text-lg font-bold text-foreground">🚦 Go / No-Go</div>

      <div className="text-xs text-subtle-foreground bg-muted border border-border rounded-md p-3">
        מסך זה הוא שכבת תיעוד והמלצה בלבד. אישור/דחייה בשלבים אלו אינו משנה את סטטוס הגרסה בפועל ואינו חוסם את תהליך העבודה הקיים.
      </div>

      <div className={`${rec.bg} border-2 ${rec.border} rounded-lg p-5 text-center`}>
        <div className="text-xs text-subtle-foreground mb-1">המלצת מערכת (מבוססת ציון בריאות)</div>
        <div className={`text-[28px] font-bold ${rec.text}`}>{rec.label}</div>
      </div>

      <div className="flex gap-3 flex-wrap">
        {STAGES.map(s => {
          const status = (data[s.statusField] as string | null) ?? 'PENDING';
          const by = data[s.byField] as string | null;
          const at = data[s.atField] as string | null;
          const canAct = s.roles.includes(role);
          return (
            <div key={s.key} className="bg-card border border-border rounded-lg p-4 flex-1 min-w-[260px]">
              <div className="text-sm font-bold text-foreground mb-2">{s.label}</div>
              <div className={`text-base font-semibold ${STATUS_COLOR_CLASS[status]}`}>{STATUS_LABEL[status] ?? status}</div>
              {by && at && (
                <div className="text-xs text-subtle-foreground mt-1">
                  {by} · {formatDateTime(at)}
                </div>
              )}
              {canAct && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setStage(s.key, 'APPROVED')}
                    disabled={saving === s.key}
                    className="flex-1 px-2.5 py-[7px] bg-success text-white border-none rounded-md cursor-pointer text-xs font-semibold"
                  >
                    אשר
                  </button>
                  <button
                    onClick={() => setStage(s.key, 'REJECTED')}
                    disabled={saving === s.key}
                    className="flex-1 px-2.5 py-[7px] bg-danger text-white border-none rounded-md cursor-pointer text-xs font-semibold"
                  >
                    דחה
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
