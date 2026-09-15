import React, { useEffect, useState } from 'react';
import axios from 'axios';
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

const statusColorClass = (s: string) =>
  s === 'DONE' ? 'text-success' : s === 'FAILED' ? 'text-danger' : s === 'ROLLED_BACK' ? 'text-warning' : 'text-subtle-foreground';

const cellClass = 'px-3 py-2 text-sm border-b border-border';
const hCellClass = `${cellClass} font-semibold text-subtle-foreground bg-muted text-xs uppercase tracking-wider`;

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

  if (loading) return <div className="p-6 text-subtle-foreground">טוען נתונים...</div>;
  if (error)   return <div className="p-6 text-danger">{error}</div>;
  if (!data)   return null;

  const { overview: ov, byTeam, byCr, byPhase, anomalies } = data;
  const completionPct = ov.totalTasks ? Math.round((ov.done / ov.totalTasks) * 100) : 0;

  const card = (label: string, value: string | number, colorClass: string = 'text-foreground', sub?: string): React.ReactNode => (
    <div className="bg-card border border-border rounded-lg px-5 py-4 min-w-[120px]">
      <div className="text-xs text-subtle-foreground mb-1">{label}</div>
      <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
      {sub && <div className="text-xs text-subtle-foreground mt-1">{sub}</div>}
    </div>
  );

  const sectionTitle = (title: string) => (
    <div className="text-base font-semibold text-foreground border-b-2 border-primary pb-2 mb-4">{title}</div>
  );

  return (
    <div className="flex flex-col gap-6">

      {/* ── כותרת ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xl font-bold text-foreground">{versionName}</div>
          <div className="text-sm text-subtle-foreground mt-1">
            {fmtTime(ov.plannedStart)} — {fmtTime(ov.plannedEnd)} מתוכנן &nbsp;·&nbsp;
            {fmtTime(ov.actualStart)} — {fmtTime(ov.actualEnd)} בפועל
          </div>
        </div>
        <div className={`rounded-full px-3 py-1 text-sm font-semibold border ${ov.done === ov.totalTasks ? 'bg-success-bg border-success text-success' : 'bg-primary-100 border-primary text-primary'}`}>
          {completionPct}% הושלמו
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="flex flex-wrap gap-3">
        {card('סה"כ משימות', ov.totalTasks)}
        {card('הושלמו', ov.done, 'text-success')}
        {card('נכשלו', ov.failed, 'text-danger')}
        {card('גולגלו חזרה', ov.rolledBack, 'text-warning')}
        {ov.blocked  > 0 && card('חסומות', ov.blocked,  'text-danger')}
        {card("CRs הוטמעו", `${ov.doneCrs}/${ov.totalCrs}`, 'text-foreground', 'מתוך סה"כ')}
      </div>

      {/* ── Progress bar ── */}
      <div>
        <div className="flex justify-between text-xs text-subtle-foreground mb-1">
          <span>התקדמות כוללת</span><span>{ov.done}/{ov.totalTasks}</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-[width] duration-slow ease-out ${completionPct === 100 ? 'bg-success' : 'bg-primary'}`} style={{ width: `${completionPct}%` }} />
        </div>
      </div>

      {/* ── לפי שלב ── */}
      {byPhase.length > 0 && (
        <div>
          {sectionTitle('ביצוע לפי שלב')}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['שלב','תחילה מתוכנן','תחילה בפועל','משך מתוכנן','משך בפועל','חריגה','משימות'].map(h => (
                    <th key={h} className={`${hCellClass} text-right`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byPhase.map((ph: any, i: number) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-transparent' : 'bg-muted'}>
                    <td className={`${cellClass} font-medium text-foreground`}>{ph.phaseName}</td>
                    <td className={cellClass}>{fmtTime(ph.plannedStart)}</td>
                    <td className={cellClass}>{fmtTime(ph.actualStart)}</td>
                    <td className={cellClass}>{fmtDur(ph.plannedDurMins)}</td>
                    <td className={cellClass}>{fmtDur(ph.actualDurMins)}</td>
                    <td className={`${cellClass} font-medium ${ph.delayMins > 0 ? 'text-danger' : ph.delayMins < 0 ? 'text-success' : 'text-subtle-foreground'}`}>
                      {fmtDur(ph.delayMins)}
                    </td>
                    <td className={cellClass}>{ph.done}/{ph.total}</td>
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
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['צוות','סה"כ','הושלמו','נכשלו','גלגול חזרה','ממוצע עיכוב'].map(h => (
                    <th key={h} className={`${hCellClass} text-right`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byTeam.map((t: any, i: number) => (
                  <tr key={t.teamId} className={i % 2 === 0 ? 'bg-transparent' : 'bg-muted'}>
                    <td className={`${cellClass} font-medium text-foreground`}>{t.teamName}</td>
                    <td className={cellClass}>{t.total}</td>
                    <td className={`${cellClass} ${t.done === t.total ? 'text-success' : 'text-foreground'}`}>{t.done}</td>
                    <td className={`${cellClass} ${t.failed > 0 ? 'text-danger' : 'text-subtle-foreground'}`}>{t.failed || '—'}</td>
                    <td className={`${cellClass} ${t.rolledBack > 0 ? 'text-warning' : 'text-subtle-foreground'}`}>{t.rolledBack || '—'}</td>
                    <td className={`${cellClass} ${t.avgDelayMins > 30 ? 'text-danger' : t.avgDelayMins > 0 ? 'text-warning' : 'text-success'}`}>
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
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['CR','צוותות','משימות','הושלמו','סטטוס'].map(h => (
                    <th key={h} className={`${hCellClass} text-right`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byCr.map((cr: any, i: number) => (
                  <tr key={cr.crNumber} className={i % 2 === 0 ? 'bg-transparent' : 'bg-muted'}>
                    <td className={`${cellClass} font-medium text-primary font-mono`}>{cr.crNumber}</td>
                    <td className={`${cellClass} text-subtle-foreground`}>{cr.teams || '—'}</td>
                    <td className={cellClass}>{cr.total}</td>
                    <td className={cellClass}>{cr.done}</td>
                    <td className={`${cellClass} font-medium ${statusColorClass(cr.failed > 0 ? 'FAILED' : 'DONE')}`}>
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
          <div className="flex flex-col gap-2">
            {anomalies.map((a: any) => (
              <div key={a.taskId} className={`bg-card rounded-md px-4 py-3 flex items-start gap-3 border ${a.status === 'FAILED' || a.status === 'ROLLED_BACK' ? 'border-danger' : 'border-warning'}`}>
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">{a.title}</div>
                  <div className="text-xs text-subtle-foreground mt-1">
                    {a.teamName}
                    {a.delayMins !== null && Math.abs(a.delayMins) > 0 &&
                      <span className="text-warning me-2"> · עיכוב {fmtDur(a.delayMins)}</span>
                    }
                    {a.reason && <span className="me-2"> · {a.reason}</span>}
                  </div>
                </div>
                <div className={`text-xs font-semibold rounded-sm px-2 py-0.5 whitespace-nowrap border ${statusColorClass(a.status)} ${a.status === 'FAILED' ? 'bg-danger-bg border-danger/40' : 'bg-warning-bg border-warning/40'}`}>
                  {a.status === 'FAILED' ? 'נכשל' : a.status === 'ROLLED_BACK' ? 'גולגל' : `עיכוב ${fmtDur(a.delayMins)}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {anomalies.length === 0 && (
        <div className="bg-success-bg border border-success/40 rounded-lg px-5 py-4 text-sm text-success text-center">
          ✓ אין חריגות משמעותיות — הלילה עבר בהצלחה
        </div>
      )}
    </div>
  );
};
