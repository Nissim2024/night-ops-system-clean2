import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { cn } from '../../lib/utils';
import { DefectDrilldownModal } from './DefectDrilldownModal';
import { formatDate } from '../../utils/dateFormat';

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
// Fixed 3-value enum — safe to map straight onto full literal Tailwind classes.
const STATE_TEXT_CLASS: Record<string, string> = { done: 'text-success', active: 'text-primary', upcoming: 'text-subtle-foreground' };
// Open-ended severity palette (shared with notices/risks below) stays as raw
// theme color driven by row data, same precedent as StatusChip/PriorityChip.
const SEVERITY_COLOR: Record<string, string> = { CRITICAL: C.danger, HIGH: '#f0883e', MEDIUM: '#e8af00', LOW: C.textMuted };
const RISK_STATUS_LABEL: Record<string, string> = { OPEN: 'פתוח', MITIGATED: 'מטופל', CLOSED: 'סגור' };

const fmtDate = (iso: string) => formatDate(iso);

// `met` is a fixed 3-way state (null/true/false) — each branch maps to a
// complete literal className string (no runtime string interpolation).
function StatusTile({ met, title, actual, target, detail, onClick }: { met: boolean | null; title: string; actual: string; target: string; detail: string; onClick?: () => void }) {
  const bgClass = met === null ? 'bg-muted' : met ? 'bg-success-bg' : 'bg-danger-bg';
  const borderClass = met === null ? 'border-border' : met ? 'border-success/40' : 'border-danger/40';
  const colorClass = met === null ? 'text-subtle-foreground' : met ? 'text-success' : 'text-danger';
  const icon = met === null ? '—' : met ? '✓' : '✗';
  return (
    <div
      onClick={onClick}
      className={cn('min-w-[220px] flex-1 rounded-lg border p-4', bgClass, borderClass, onClick && 'cursor-pointer')}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-bold text-foreground">{title}</span>
        <span className={cn('text-lg font-bold', colorClass)}>{icon}</span>
      </div>
      <div className={cn('text-xl font-bold', colorClass)}>{actual}</div>
      <div className="mt-1 text-xs text-subtle-foreground">יעד: {target}</div>
      {detail && <div className={cn('mt-1 text-xs font-semibold', colorClass)}>{detail}</div>}
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
    return <div className="p-8 text-center text-subtle-foreground" dir="rtl">בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div className="p-6 text-subtle-foreground" dir="rtl">טוען...</div>;
  if (!data) return <div className="p-6 text-subtle-foreground" dir="rtl">לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  const cycleLabel = data.activeCycle ? (CYCLE_LABEL[data.activeCycle.cycleType] ?? data.activeCycle.cycleType) : 'אין סבב פעיל כרגע';

  return (
    <div className="flex flex-col gap-4" dir="rtl">
      <div>
        <div className="text-lg font-bold text-foreground">📟 לוח מצב</div>
        <div className="mt-0.5 text-xs text-subtle-foreground">סבב פעיל כרגע: {cycleLabel}</div>
      </div>

      <div className="flex flex-wrap gap-3">
        <StatusTile
          met={data.coverage.met}
          title="יעד הצלחת תרחישים"
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
        <div className="mb-2 text-sm font-bold text-foreground">התקדמות הסבבים</div>
        {data.timeline.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-subtle-foreground">
            אין תוכנית עבודת QA לגרסה זו.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-muted">
                  {['סבב', 'התחלה', 'סיום', '%', 'סטטוס'].map(h => (
                    <th key={h} className="px-3 py-2 text-right text-xs font-bold text-subtle-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.timeline.map(c => (
                  <tr key={c.cycleType} className="border-t border-border">
                    <td className="px-3 py-2 text-sm font-semibold text-foreground">{CYCLE_LABEL[c.cycleType] ?? c.cycleType}</td>
                    <td className="px-3 py-2 text-xs text-subtle-foreground">{fmtDate(c.plannedStart)}</td>
                    <td className="px-3 py-2 text-xs text-subtle-foreground">{fmtDate(c.plannedEnd)}</td>
                    <td className="px-3 py-2 text-sm font-bold text-foreground">
                      {c.coveragePct != null ? `${c.coveragePct}%` : '—'}
                      {c.qgTargetPct != null && <span className="text-xs font-normal text-subtle-foreground"> (יעד {c.qgTargetPct}%)</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn('text-xs font-semibold', STATE_TEXT_CLASS[c.state])}>{STATE_LABEL[c.state]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[320px] flex-1 rounded-lg border border-border bg-card p-4">
          <div className="mb-3 text-sm font-bold text-foreground">🔔 הודעות חשובות</div>
          {data.notices.length === 0 ? (
            <div className="text-sm text-subtle-foreground">אין הודעות.</div>
          ) : data.notices.map(n => (
            <div key={n.id} className="flex items-start gap-2 border-b border-border py-2">
              <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[n.severity] ?? C.textMuted }} />
              <div className="flex-1">
                {n.title && <div className="text-sm font-semibold text-foreground">{n.title}</div>}
                <div className="text-xs text-subtle-foreground">{n.message}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="min-w-[320px] flex-1 rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-bold text-foreground">⚠️ סיכונים</div>
          </div>
          {data.risks.length === 0 ? (
            <div className="text-sm text-subtle-foreground">אין סיכונים פתוחים. ליצירת סיכון — עבור למסך "סקירה כללית".</div>
          ) : data.risks.map(r => (
            <div key={r.id} className="flex items-start gap-2 border-b border-border py-2">
              <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[r.severity] ?? C.textMuted }} />
              <div className="flex-1">
                <div className="text-sm text-foreground">{r.title}</div>
                <div className="mt-0.5 text-xs text-subtle-foreground">
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
