import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../theme';
import { formatTime } from '../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Props { token: string; versionId: string; versionName: string; }

const fmtTime = (iso: string | null) => iso ? formatTime(iso) : '—';

const fmtDur = (mins: number | null) => {
  if (mins === null) return '—';
  const sign = mins < 0 ? '-' : mins > 0 ? '+' : '';
  const abs  = Math.abs(mins);
  return abs >= 60 ? `${sign}${Math.floor(abs/60)}ש׳ ${abs%60}דק׳` : `${sign}${abs}דק׳`;
};

const statusColor = (s: string) =>
  s === 'DONE' ? C.success : s === 'FAILED' ? C.danger : s === 'ROLLED_BACK' ? C.warning : C.textMuted;

const cell: React.CSSProperties = {
  padding: `${SP[2]} ${SP[3]}`, ...TEXT.sm, borderBottom: `1px solid ${C.border}`,
};
const hCell: React.CSSProperties = {
  ...cell, fontWeight: WEIGHT.semibold, color: C.textMuted,
  background: C.bgHover, ...TEXT.xs, textTransform: 'uppercase', letterSpacing: '0.06em',
};

export const NightStatsDashboard: React.FC<Props> = ({ token, versionId, versionName }) => {
  const [data, setData]     = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');

  useEffect(() => {
    setLoading(true);
    axios.get(`${API}/summary/${versionId}/night-stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data))
      .catch(() => setError('שגיאה בטעינת נתוני הסיכום'))
      .finally(() => setLoading(false));
  }, [versionId, token]);

  if (loading) return <div style={{ padding: SP[6], color: C.textMuted, fontFamily: FONT }}>טוען נתונים...</div>;
  if (error)   return <div style={{ padding: SP[6], color: C.danger,    fontFamily: FONT }}>{error}</div>;
  if (!data)   return null;

  const { overview: ov, byTeam, byCr, byPhase, anomalies } = data;
  const completionPct = ov.totalTasks ? Math.round((ov.done / ov.totalTasks) * 100) : 0;

  const card = (label: string, value: string | number, color: string = C.textPrimary, sub?: string): React.ReactNode => (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg,
      padding: `${SP[4]} ${SP[5]}`, minWidth: 120,
    }}>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: SP[1] }}>{label}</div>
      <div style={{ ...TEXT['2xl'], fontWeight: WEIGHT.bold, color, fontFamily: FONT }}>{value}</div>
      {sub && <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: SP[1] }}>{sub}</div>}
    </div>
  );

  const sectionTitle = (title: string) => (
    <div style={{
      ...TEXT.base, fontWeight: WEIGHT.semibold, color: C.textPrimary,
      borderBottom: `2px solid ${C.brand}`, paddingBottom: SP[2], marginBottom: SP[4],
    }}>{title}</div>
  );

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[6] }}>

      {/* ── כותרת ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: SP[3] }}>
        <div>
          <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{versionName}</div>
          <div style={{ ...TEXT.sm, color: C.textMuted, marginTop: SP[1] }}>
            {fmtTime(ov.plannedStart)} — {fmtTime(ov.plannedEnd)} מתוכנן &nbsp;·&nbsp;
            {fmtTime(ov.actualStart)} — {fmtTime(ov.actualEnd)} בפועל
          </div>
        </div>
        <div style={{
          background: ov.done === ov.totalTasks ? C.bgDone : C.bgActive,
          border: `1px solid ${ov.done === ov.totalTasks ? C.success : C.brand}`,
          borderRadius: RADIUS.full, padding: `${SP[1]} ${SP[3]}`,
          ...TEXT.sm, fontWeight: WEIGHT.semibold,
          color: ov.done === ov.totalTasks ? C.success : C.brand,
        }}>
          {completionPct}% הושלמו
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SP[3] }}>
        {card('סה"כ משימות', ov.totalTasks)}
        {card('הושלמו', ov.done, C.success)}
        {card('נכשלו', ov.failed, C.danger)}
        {card('גולגלו חזרה', ov.rolledBack, C.warning)}
        {ov.blocked  > 0 && card('חסומות', ov.blocked,  C.danger)}
        {card("CRs הוטמעו", `${ov.doneCrs}/${ov.totalCrs}`, C.textPrimary, 'מתוך סה"כ')}
      </div>

      {/* ── Progress bar ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', ...TEXT.xs, color: C.textMuted, marginBottom: SP[1] }}>
          <span>התקדמות כוללת</span><span>{ov.done}/{ov.totalTasks}</span>
        </div>
        <div style={{ height: 8, background: C.bgHover, borderRadius: RADIUS.full, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${completionPct}%`, background: completionPct === 100 ? C.success : C.brand, borderRadius: RADIUS.full, transition: 'width 0.5s ease' }} />
        </div>
      </div>

      {/* ── לפי שלב ── */}
      {byPhase.length > 0 && (
        <div>
          {sectionTitle('ביצוע לפי שלב')}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['שלב','תחילה מתוכנן','תחילה בפועל','משך מתוכנן','משך בפועל','חריגה','משימות'].map(h => (
                    <th key={h} style={{ ...hCell, textAlign: 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byPhase.map((ph: any, i: number) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : C.bgHover }}>
                    <td style={{ ...cell, fontWeight: WEIGHT.medium, color: C.textPrimary }}>{ph.phaseName}</td>
                    <td style={cell}>{fmtTime(ph.plannedStart)}</td>
                    <td style={cell}>{fmtTime(ph.actualStart)}</td>
                    <td style={cell}>{fmtDur(ph.plannedDurMins)}</td>
                    <td style={cell}>{fmtDur(ph.actualDurMins)}</td>
                    <td style={{ ...cell, color: ph.delayMins > 0 ? C.danger : ph.delayMins < 0 ? C.success : C.textMuted, fontWeight: WEIGHT.medium }}>
                      {fmtDur(ph.delayMins)}
                    </td>
                    <td style={cell}>{ph.done}/{ph.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── לפי צוות ── */}
      {byTeam.length > 0 && (
        <div>
          {sectionTitle('ביצוע לפי צוות')}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['צוות','סה"כ','הושלמו','נכשלו','גלגול חזרה','ממוצע עיכוב'].map(h => (
                    <th key={h} style={{ ...hCell, textAlign: 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byTeam.map((t: any, i: number) => (
                  <tr key={t.teamId} style={{ background: i % 2 === 0 ? 'transparent' : C.bgHover }}>
                    <td style={{ ...cell, fontWeight: WEIGHT.medium, color: C.textPrimary }}>{t.teamName}</td>
                    <td style={cell}>{t.total}</td>
                    <td style={{ ...cell, color: t.done === t.total ? C.success : C.textPrimary }}>{t.done}</td>
                    <td style={{ ...cell, color: t.failed > 0 ? C.danger : C.textMuted }}>{t.failed || '—'}</td>
                    <td style={{ ...cell, color: t.rolledBack > 0 ? C.warning : C.textMuted }}>{t.rolledBack || '—'}</td>
                    <td style={{ ...cell, color: t.avgDelayMins > 30 ? C.danger : t.avgDelayMins > 0 ? C.warning : C.success }}>
                      {fmtDur(t.avgDelayMins)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── לפי CR ── */}
      {byCr.length > 0 && (
        <div>
          {sectionTitle(`CRs (${byCr.length})`)}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['CR','צוותות','משימות','הושלמו','סטטוס'].map(h => (
                    <th key={h} style={{ ...hCell, textAlign: 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byCr.map((cr: any, i: number) => (
                  <tr key={cr.crNumber} style={{ background: i % 2 === 0 ? 'transparent' : C.bgHover }}>
                    <td style={{ ...cell, fontWeight: WEIGHT.medium, color: C.brand, fontFamily: 'monospace' }}>{cr.crNumber}</td>
                    <td style={{ ...cell, color: C.textMuted }}>{cr.teams || '—'}</td>
                    <td style={cell}>{cr.total}</td>
                    <td style={cell}>{cr.done}</td>
                    <td style={{ ...cell, color: statusColor(cr.failed > 0 ? 'FAILED' : 'DONE'), fontWeight: WEIGHT.medium }}>
                      {cr.statusLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── חריגות ── */}
      {anomalies.length > 0 && (
        <div>
          {sectionTitle(`חריגות ואירועים (${anomalies.length})`)}
          <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
            {anomalies.map((a: any) => (
              <div key={a.taskId} style={{
                background: C.bgCard, border: `1px solid ${a.status === 'FAILED' || a.status === 'ROLLED_BACK' ? C.danger : C.warning}`,
                borderRadius: RADIUS.md, padding: `${SP[3]} ${SP[4]}`,
                display: 'flex', alignItems: 'flex-start', gap: SP[3],
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ ...TEXT.sm, fontWeight: WEIGHT.medium, color: C.textPrimary }}>{a.title}</div>
                  <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: SP[1] }}>
                    {a.teamName}
                    {a.delayMins !== null && Math.abs(a.delayMins) > 0 &&
                      <span style={{ color: C.warning, marginRight: SP[2] }}> · עיכוב {fmtDur(a.delayMins)}</span>
                    }
                    {a.reason && <span style={{ marginRight: SP[2] }}> · {a.reason}</span>}
                  </div>
                </div>
                <div style={{
                  ...TEXT.xs, fontWeight: WEIGHT.semibold, color: statusColor(a.status),
                  background: a.status === 'FAILED' ? `${C.danger}18` : `${C.warning}18`,
                  border: `1px solid ${statusColor(a.status)}40`,
                  borderRadius: RADIUS.sm, padding: `2px ${SP[2]}`, whiteSpace: 'nowrap',
                }}>
                  {a.status === 'FAILED' ? 'נכשל' : a.status === 'ROLLED_BACK' ? 'גולגל' : `עיכוב ${fmtDur(a.delayMins)}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {anomalies.length === 0 && (
        <div style={{
          background: `${C.success}12`, border: `1px solid ${C.success}40`,
          borderRadius: RADIUS.lg, padding: `${SP[4]} ${SP[5]}`,
          ...TEXT.sm, color: C.success, textAlign: 'center',
        }}>
          ✓ אין חריגות משמעותיות — הלילה עבר בהצלחה
        </div>
      )}
    </div>
  );
};
