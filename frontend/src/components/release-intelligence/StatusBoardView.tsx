import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';
import { DefectDrilldownModal } from './DefectDrilldownModal';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface CycleTimelineItem {
  cycleType: string; plannedStart: string; plannedEnd: string; progressPct: number; state: 'done' | 'active' | 'upcoming';
  coveragePct: number | null; qgTargetPct: number | null;
}
interface Risk {
  id: string; title: string; severity: string; probability: string | null; owner: string | null; status: string;
}
interface Notice {
  id: string; category: string; severity: string; title: string | null; message: string; createdAt: string;
}
interface StatusBoard {
  activeCycle: { cycleType: string; state: string } | null;
  coverage: { actualPct: number | null; targetPct: number | null; met: boolean | null };
  openDefects: { total: number; severeOrWorseActual: number; severeOrWorseTarget: number; met: boolean };
  aging: { thresholdDays: number; count: number; avgAgingDays: number; met: boolean };
  timeline: CycleTimelineItem[];
  risks: Risk[];
  notices: Notice[];
}

const CYCLE_LABEL: Record<string, string> = {
  CYCLE_1: 'סבב 1', CYCLE_2: 'סבב 2', CYCLE_3: 'סבב 3',
  STAND_ALONE: 'Stand Alone', UAT: 'UAT', REHEARSAL: 'חזרה גנרלית', GO_LIVE: 'עליה לאוויר',
};
const STATE_LABEL: Record<string, string> = { done: 'הושלם', active: 'פעיל', upcoming: 'עתידי' };
const STATE_COLOR: Record<string, string> = { done: C.success, active: C.brand, upcoming: C.textMuted };
const SEVERITY_COLOR: Record<string, string> = { CRITICAL: C.danger, HIGH: '#f0883e', MEDIUM: '#e8af00', LOW: C.textMuted };
const RISK_STATUS_LABEL: Record<string, string> = { OPEN: 'פתוח', MITIGATED: 'מטופל', CLOSED: 'סגור' };

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });

function StatusTile({ met, title, actual, target, detail, onClick }: { met: boolean | null; title: string; actual: string; target: string; detail: string; onClick?: () => void }) {
  const bg = met === null ? C.bgNested : met ? C.successBg : C.dangerBg;
  const color = met === null ? C.textMuted : met ? C.success : C.danger;
  const icon = met === null ? '—' : met ? '✓' : '✗';
  return (
    <div onClick={onClick} style={{ flex: 1, minWidth: '220px', background: bg, border: `1px solid ${color}40`, borderRadius: RADIUS.lg, padding: SP[4], cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{title}</span>
        <span style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color }}>{icon}</span>
      </div>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color }}>{actual}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '4px' }}>יעד: {target}</div>
      {detail && <div style={{ ...TEXT.xs, color, marginTop: '4px', fontWeight: WEIGHT.semibold }}>{detail}</div>}
    </div>
  );
}

interface Props { token: string; versionId?: string; role: string; }

export const StatusBoardView: React.FC<Props> = ({ token, versionId }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<StatusBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [drilldown, setDrilldown] = useState<{ filter: string; title: string } | null>(null);

  const load = useCallback(() => {
    if (!versionId) { setData(null); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/status-board/${versionId}`, { headers })
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

  const cycleLabel = data.activeCycle ? (CYCLE_LABEL[data.activeCycle.cycleType] ?? data.activeCycle.cycleType) : 'אין סבב פעיל כרגע';

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📟 לוח מצב</div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px' }}>סבב פעיל כרגע: {cycleLabel}</div>
      </div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <StatusTile
          met={data.coverage.met}
          title="יעד כיסוי תרחישים"
          actual={data.coverage.actualPct != null ? `${data.coverage.actualPct}%` : 'אין נתונים'}
          target={data.coverage.targetPct != null ? `${data.coverage.targetPct}%` : '—'}
          detail={data.coverage.met === false ? 'טרם עמדו ביעד הסבב' : ''}
        />
        <StatusTile
          met={data.openDefects.met}
          title="יעד תקלות פתוחות (חמור+)"
          actual={`${data.openDefects.severeOrWorseActual} מתוך ${data.openDefects.total} פתוחות`}
          target={`${data.openDefects.severeOrWorseTarget}`}
          detail={data.openDefects.met === false ? `חריגה בתקלות חמורות (יעד: ${data.openDefects.severeOrWorseTarget}, בפועל: ${data.openDefects.severeOrWorseActual})` : ''}
          onClick={() => setDrilldown({ filter: 'openSevereOrWorse', title: 'תקלות פתוחות — חמור ומעלה' })}
        />
        <StatusTile
          met={data.aging.met}
          title="יעד זמני טיפול"
          actual={`${data.aging.count} תקלות`}
          target={`עד ${data.aging.thresholdDays} ימים`}
          detail={data.aging.count > 0 ? `פתוחות מעל ${data.aging.thresholdDays} ימים (ממוצע גיל: ${data.aging.avgAgingDays} ימים)` : ''}
          onClick={() => setDrilldown({ filter: 'aging', title: `תקלות פתוחות מעל ${data.aging.thresholdDays} ימים` })}
        />
      </div>

      <div>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: SP[2] }}>התקדמות הסבבים</div>
        {data.timeline.length === 0 ? (
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], ...TEXT.sm, color: C.textMuted }}>
            אין תוכנית עבודת QA לגרסה זו.
          </div>
        ) : (
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: C.bgNested }}>
                  {['סבב', 'התחלה', 'סיום', '%', 'סטטוס'].map(h => (
                    <th key={h} style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold, padding: '8px 12px', textAlign: 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.timeline.map(c => (
                  <tr key={c.cycleType} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, padding: '8px 12px' }}>{CYCLE_LABEL[c.cycleType] ?? c.cycleType}</td>
                    <td style={{ ...TEXT.xs, color: C.textMuted, padding: '8px 12px' }}>{fmtDate(c.plannedStart)}</td>
                    <td style={{ ...TEXT.xs, color: C.textMuted, padding: '8px 12px' }}>{fmtDate(c.plannedEnd)}</td>
                    <td style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, padding: '8px 12px' }}>
                      {c.coveragePct != null ? `${c.coveragePct}%` : '—'}
                      {c.qgTargetPct != null && <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.normal }}> (יעד {c.qgTargetPct}%)</span>}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: STATE_COLOR[c.state] }}>{STATE_LABEL[c.state]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '320px', background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
          <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: SP[3] }}>🔔 הודעות חשובות</div>
          {data.notices.length === 0 ? (
            <div style={{ ...TEXT.sm, color: C.textMuted }}>אין הודעות.</div>
          ) : data.notices.map(n => (
            <div key={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: SP[2], padding: `${SP[2]} 0`, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: SEVERITY_COLOR[n.severity] ?? C.textMuted, marginTop: '6px', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                {n.title && <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{n.title}</div>}
                <div style={{ ...TEXT.xs, color: C.textMuted }}>{n.message}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: '320px', background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP[3] }}>
            <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>⚠️ סיכונים</div>
          </div>
          {data.risks.length === 0 ? (
            <div style={{ ...TEXT.sm, color: C.textMuted }}>אין סיכונים פתוחים. ליצירת סיכון — עבור למסך "סקירה כללית".</div>
          ) : data.risks.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: SP[2], padding: `${SP[2]} 0`, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: SEVERITY_COLOR[r.severity] ?? C.textMuted, marginTop: '6px', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ ...TEXT.sm, color: C.textPrimary }}>{r.title}</div>
                <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px' }}>
                  {RISK_STATUS_LABEL[r.status] ?? r.status}
                  {r.owner && ` · אחראי: ${r.owner}`}
                  {r.probability && ` · סבירות: ${r.probability}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {drilldown && (
        <DefectDrilldownModal
          token={token}
          versionId={versionId}
          screen="status-board"
          filter={drilldown.filter}
          title={drilldown.title}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
};
