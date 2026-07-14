import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';

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
  GO:             { bg: C.goBg,   border: C.goBorder,   text: C.goText,   label: '✅ GO' },
  CONDITIONAL_GO: { bg: C.warningBg, border: C.warning,  text: '#8A6300',  label: '⚠️ CONDITIONAL GO' },
  NO_GO:          { bg: C.nogoBg, border: C.nogoBorder, text: C.nogoText, label: '⛔ NO GO' },
};

type Stage = 'qa-manager' | 'release-manager' | 'management';

const STAGES: { key: Stage; label: string; statusField: keyof GoNoGo; byField: keyof GoNoGo; atField: keyof GoNoGo; roles: string[] }[] = [
  { key: 'qa-manager', label: 'אישור מנהל QA', statusField: 'qaManagerStatus', byField: 'qaManagerBy', atField: 'qaManagerAt', roles: ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'] },
  { key: 'release-manager', label: 'אישור מנהל גרסה', statusField: 'releaseManagerStatus', byField: 'releaseManagerBy', atField: 'releaseManagerAt', roles: ['RELEASE_MANAGER', 'ADMIN'] },
  { key: 'management', label: 'אישור הנהלה', statusField: 'managementStatus', byField: 'managementBy', atField: 'managementAt', roles: ['RELEASE_MANAGER', 'ADMIN'] },
];

const STATUS_COLOR: Record<string, string> = { APPROVED: C.success, REJECTED: C.danger, PENDING: C.textMuted };
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
    return <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>טוען...</div>;
  if (!data) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  const rec = RECOMMENDATION_STYLE[data.systemRecommendation];

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🚦 Go / No-Go</div>

      <div style={{ ...TEXT.xs, color: C.textMuted, background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: SP[3] }}>
        מסך זה הוא שכבת תיעוד והמלצה בלבד. אישור/דחייה בשלבים אלו אינו משנה את סטטוס הגרסה בפועל ואינו חוסם את תהליך העבודה הקיים.
      </div>

      <div style={{ background: rec.bg, border: `2px solid ${rec.border}`, borderRadius: RADIUS.lg, padding: SP[5], textAlign: 'center' }}>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: SP[1] }}>המלצת מערכת (מבוססת ציון בריאות)</div>
        <div style={{ fontSize: '28px', fontWeight: WEIGHT.bold, color: rec.text }}>{rec.label}</div>
      </div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        {STAGES.map(s => {
          const status = (data[s.statusField] as string | null) ?? 'PENDING';
          const by = data[s.byField] as string | null;
          const at = data[s.atField] as string | null;
          const canAct = s.roles.includes(role);
          return (
            <div key={s.key} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], flex: 1, minWidth: '260px' }}>
              <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: SP[2] }}>{s.label}</div>
              <div style={{ ...TEXT.base, fontWeight: WEIGHT.semibold, color: STATUS_COLOR[status] }}>{STATUS_LABEL[status] ?? status}</div>
              {by && at && (
                <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: SP[1] }}>
                  {by} · {new Date(at).toLocaleString('he-IL')}
                </div>
              )}
              {canAct && (
                <div style={{ display: 'flex', gap: SP[2], marginTop: SP[3] }}>
                  <button
                    onClick={() => setStage(s.key, 'APPROVED')}
                    disabled={saving === s.key}
                    style={{ flex: 1, padding: '7px 10px', background: C.success, color: '#fff', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', ...TEXT.xs, fontWeight: WEIGHT.semibold }}
                  >
                    אשר
                  </button>
                  <button
                    onClick={() => setStage(s.key, 'REJECTED')}
                    disabled={saving === s.key}
                    style={{ flex: 1, padding: '7px 10px', background: C.danger, color: '#fff', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', ...TEXT.xs, fontWeight: WEIGHT.semibold }}
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
