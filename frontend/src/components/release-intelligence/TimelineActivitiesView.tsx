import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../../theme';
import RunbookModal, { getRunbookTrigger, RunbookTrigger } from '../qa/RunbookModal';
import {
  CAT_LABELS, ACTIVITY_BLUE, fmtActivityDate, activityRowHighlight,
  ActivityStatus, ActivityStatusBadge, DoneToggleButton,
} from '../qa/activityBoardShared';
import { useDialog } from '../../context/DialogContext';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Read-only view of the QA module's activity board (same ActivityBoardEntry
// rows) — rebuilt 2026-10-05 in the board's own look: category filter chips,
// golive/billing row highlight, runbook launch, and a real "בוצע" status
// (before it, every activity whose end date had passed read as "באיחור").
// Editing stays in ניהול QA → תכנון ושיבוץ → לוח פעילויות (onEditBoard).

interface ActivityRow {
  id: string; activityKey: string; label: string; owner: string; ownerEmployee: string; notes: string;
  category: string; dateStart: string | null; dateEnd: string | null; doneAt: string | null; doneBy: string | null;
  status: ActivityStatus;
}
interface TimelineActivities {
  kpis: { activities: number; done: number; delayed: number; inProgress: number; upcoming: number; criticalMilestones: number };
  rows: ActivityRow[];
}

function KpiCard({ value, label, color, active, onClick }: { value: number; label: string; color: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, minWidth: 130, textAlign: 'right', padding: `${SP[3]} ${SP[4]}`, borderRadius: RADIUS.lg,
        border: `1px solid ${active ? color : C.border}`, background: active ? C.bgActive : C.bgCard,
        boxShadow: SHADOW.sm, cursor: onClick ? 'pointer' : 'default', fontFamily: FONT, transition: EASE.fast,
      }}
    >
      <div style={{ fontSize: '24px', fontWeight: WEIGHT.bold, lineHeight: 1.15, color }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: 2 }}>{label}</div>
    </button>
  );
}

const GRID = '136px 136px 1fr 110px 130px 84px 92px';

interface Props {
  token: string;
  versionId?: string;
  role: string;
  myFullName?: string;
  /** Opens ניהול QA → לוח פעילויות; omitted when the user has no access to it. */
  onEditBoard?: () => void;
}

export const TimelineActivitiesView: React.FC<Props> = ({ token, versionId, role, myFullName, onEditBoard }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const dialog = useDialog();
  const [data, setData] = useState<TimelineActivities | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterCat, setFilterCat] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<ActivityStatus | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [runbookItem, setRunbookItem] = useState<{ trigger: RunbookTrigger; dateStartISO: string } | null>(null);

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

  // The server is the authority (owner by name, or a board manager) — this
  // only decides whether to offer the button at all.
  const isBoardManager = ['ADMIN', 'RELEASE_MANAGER'].includes(role) || !!onEditBoard;
  const isMine = (r: ActivityRow) => !!myFullName && !!r.ownerEmployee && r.ownerEmployee.trim().toLowerCase() === myFullName.trim().toLowerCase();

  const toggleDone = async (r: ActivityRow) => {
    setBusyId(r.id);
    try {
      await axios.patch(`${API}/activity-board/entry/${r.id}/done`, { done: !r.doneAt }, { headers });
      load();
    } catch (err: any) {
      dialog.alert(err?.response?.data?.message || 'שגיאה בעדכון סטטוס הביצוע', 'שגיאה', 'danger');
    } finally {
      setBusyId(null);
    }
  };

  if (!versionId) {
    return <div className="p-8 text-center text-subtle-foreground" dir="rtl">בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div className="p-6 text-subtle-foreground" dir="rtl">טוען...</div>;
  if (!data) return <div className="p-6 text-subtle-foreground" dir="rtl">לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  const rows = data.rows
    .filter(r => filterCat === 'all' || r.category === filterCat)
    .filter(r => !statusFilter || r.status === statusFilter);
  const toggleStatus = (s: ActivityStatus) => setStatusFilter(cur => (cur === s ? null : s));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[4], direction: 'rtl', fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SP[3], flexWrap: 'wrap' }}>
        <div>
          <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🗓️ ציר זמן ופעילויות</div>
          <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: 2 }}>תצוגת קריאה של לוח הפעילויות שנבנה בניהול QA · לחיצה על כרטיס מסננת לפי מצב</div>
        </div>
        {onEditBoard && (
          <button onClick={onEditBoard} style={{
            padding: `${SP[2]} ${SP[4]}`, borderRadius: RADIUS.md, border: `1px solid ${ACTIVITY_BLUE}55`,
            background: 'rgba(69,115,210,0.08)', color: ACTIVITY_BLUE, fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.bold, cursor: 'pointer',
          }}>
            ✏️ עריכה בלוח הפעילויות
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SP[3] }}>
        <KpiCard value={data.kpis.activities} label="פעילויות" color={C.textPrimary} active={!statusFilter} onClick={() => setStatusFilter(null)} />
        <KpiCard value={data.kpis.done} label="בוצעו" color={C.success} active={statusFilter === 'DONE'} onClick={() => toggleStatus('DONE')} />
        <KpiCard value={data.kpis.delayed} label="באיחור" color={data.kpis.delayed > 0 ? C.danger : C.success} active={statusFilter === 'DELAYED'} onClick={() => toggleStatus('DELAYED')} />
        <KpiCard value={data.kpis.inProgress} label="בביצוע" color={C.warning} active={statusFilter === 'IN_PROGRESS'} onClick={() => toggleStatus('IN_PROGRESS')} />
        <KpiCard value={data.kpis.upcoming} label="עתידיות" color={ACTIVITY_BLUE} active={statusFilter === 'UPCOMING'} onClick={() => toggleStatus('UPCOMING')} />
        <KpiCard value={data.kpis.criticalMilestones} label="אבני דרך קריטיות (עלייה לאוויר)" color="#e8af00" />
      </div>

      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflow: 'hidden', boxShadow: SHADOW.sm }}>
        {/* Filter chips — same as the QA board */}
        <div style={{ padding: `${SP[2]} ${SP[4]}`, borderBottom: `1px solid ${C.border}`, display: 'flex', gap: SP[2], flexWrap: 'wrap', alignItems: 'center', background: C.bgNested }}>
          {(Object.keys(CAT_LABELS) as (keyof typeof CAT_LABELS)[]).map(cat => (
            <button key={cat} onClick={() => setFilterCat(cat)} style={{
              padding: '2px 10px', borderRadius: RADIUS.full,
              border: `1px solid ${filterCat === cat ? ACTIVITY_BLUE : C.border}`,
              background: filterCat === cat ? 'rgba(69,115,210,0.12)' : C.bgCard,
              color: filterCat === cat ? ACTIVITY_BLUE : C.textMuted,
              fontFamily: FONT, ...TEXT.xs, fontWeight: filterCat === cat ? WEIGHT.bold : WEIGHT.normal,
              cursor: 'pointer', transition: EASE.fast,
            }}>
              {CAT_LABELS[cat]}
            </button>
          ))}
          <span style={{ ...TEXT.xs, color: C.textMuted, marginRight: 'auto' }}>
            <span style={{ color: C.success }}>■</span> עלייה לאוויר &nbsp;
            <span style={{ color: C.warning }}>■</span> בילינג
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 820 }}>
            <div style={{ display: 'grid', gridTemplateColumns: GRID, padding: `${SP[2]} ${SP[4]}`, borderBottom: `1px solid ${C.border}`, background: C.bgNested }}>
              {['תאריך התחלה', 'תאריך סיום', 'פעילות', 'צוות אחראי', 'שם עובד', 'מצב', ''].map((h, i) => (
                <div key={i} style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, letterSpacing: '0.04em' }}>{h}</div>
              ))}
            </div>

            {rows.length === 0 && (
              <div style={{ padding: SP[6], textAlign: 'center', ...TEXT.sm, color: C.textMuted }}>
                {data.rows.length === 0 ? 'אין פעילויות רשומות לגרסה זו.' : 'אין פעילויות שתואמות את הסינון.'}
              </div>
            )}

            {rows.map(r => {
              const trigger = getRunbookTrigger(r.activityKey);
              const mine = isMine(r);
              const canDone = isBoardManager || mine;
              const expanded = expandedId === r.id;
              return (
                <div key={r.id} style={{ borderBottom: `1px solid ${C.border}44`, ...activityRowHighlight(r.category) }}>
                  <div
                    onClick={() => setExpandedId(expanded ? null : r.id)}
                    style={{ display: 'grid', gridTemplateColumns: GRID, padding: `${SP[2]} ${SP[4]}`, alignItems: 'center', cursor: 'pointer', transition: EASE.fast }}
                    onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = C.bgHover}
                    onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
                  >
                    <span style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{r.dateStart ? fmtActivityDate(new Date(r.dateStart)) : '—'}</span>
                    <span style={{ ...TEXT.sm, color: r.status === 'DELAYED' ? C.danger : C.textMuted }}>{r.dateEnd ? fmtActivityDate(new Date(r.dateEnd)) : '—'}</span>
                    <span style={{ ...TEXT.sm, color: C.textPrimary, textDecoration: r.status === 'DONE' ? 'line-through' : 'none', textDecorationColor: C.textMuted }}>
                      {r.label}
                      {mine && <span style={{ marginInlineStart: 6, padding: '0 7px', borderRadius: RADIUS.full, background: C.brandDim, color: C.brand, ...TEXT.xs, fontWeight: WEIGHT.bold }}>שלי</span>}
                    </span>
                    <span style={{ ...TEXT.xs, color: C.textMuted }}>{r.owner || '—'}</span>
                    <span style={{ ...TEXT.xs, color: r.ownerEmployee ? C.textPrimary : C.textDisabled, fontStyle: r.ownerEmployee ? 'normal' : 'italic' }}>{r.ownerEmployee || '—'}</span>
                    <span><ActivityStatusBadge status={r.status} title={r.doneAt ? `סומן ע"י ${r.doneBy ?? '—'}` : undefined} /></span>
                    <div style={{ display: 'flex', gap: SP[1] }} onClick={e => e.stopPropagation()}>
                      {trigger && (
                        <button
                          onClick={() => setRunbookItem({ trigger, dateStartISO: r.dateStart ?? '' })}
                          title="פתח תוכנית היערכות (Runbook)"
                          style={{ padding: '3px 8px', borderRadius: RADIUS.md, border: `1px solid ${ACTIVITY_BLUE}44`, background: 'rgba(69,115,210,0.08)', color: ACTIVITY_BLUE, fontFamily: FONT, ...TEXT.xs, cursor: 'pointer', fontWeight: WEIGHT.bold }}>
                          📋
                        </button>
                      )}
                      {canDone && (
                        <DoneToggleButton done={!!r.doneAt} busy={busyId === r.id} onClick={() => toggleDone(r)} />
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <div style={{ padding: `${SP[2]} ${SP[4]} ${SP[3]}`, background: C.bgNested, display: 'flex', flexDirection: 'column', gap: SP[1], ...TEXT.xs, color: C.textMuted }}>
                      <div><strong style={{ color: C.textPrimary }}>קטגוריה:</strong> {CAT_LABELS[r.category as keyof typeof CAT_LABELS] ?? r.category}</div>
                      <div><strong style={{ color: C.textPrimary }}>הערות:</strong> {r.notes || '—'}</div>
                      {r.doneAt && <div><strong style={{ color: C.textPrimary }}>בוצע:</strong> {fmtActivityDate(new Date(r.doneAt))}{r.doneBy ? ` · ${r.doneBy}` : ''}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ padding: `${SP[2]} ${SP[4]}`, borderTop: `1px solid ${C.border}`, background: C.bgNested, ...TEXT.xs, color: C.textMuted }}>
          מוצגות {rows.length} מתוך {data.rows.length} פעילויות
        </div>
      </div>

      {runbookItem && (
        <RunbookModal
          trigger={runbookItem.trigger}
          dateStartISO={runbookItem.dateStartISO}
          versionId={versionId}
          token={token}
          startInRunMode
          onClose={() => setRunbookItem(null)}
        />
      )}
    </div>
  );
};
