import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C, TEXT, WEIGHT, SP, RADIUS, SHADOW, FONT } from '../../theme';
import { formatDate } from '../../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

export interface MyQaTask {
  id: string;
  crNumber: string;
  crLabel: string | null;
  taskType: 'CR' | 'STAND_ALONE' | 'REGRESSION';
  effortDays: number;
  plannedStart: string;
  plannedEnd: string;
  isPrimary: boolean;
  cycle: { cycleType: string };
  application?: string | null;
  urgent?: boolean;
  priorityTestDate?: string | null;
}

interface ActivityEntry {
  id: string;
  activityKey: string;
  label: string;
  owner: string;
  ownerEmployee: string;
  notes: string;
  category: string;
  dateStart: string | null;
  dateEnd: string | null;
  isRelevant: boolean;
}

interface CrDetail {
  crNumber: string; crLabel: string; crDescription: string | null; crManager: string | null;
  application: string | null; estimateDays: number | null; notes: string | null;
  versionName: string; teams: string[]; status: string;
  archiveHistory: { id: string; action: string; userEmail: string | null; cycleType: string | null; reason: string | null; createdAt: string }[];
}

export interface TargetDefect {
  id: string | null;
  defectId: string;
  title: string;
  status: string;
  severity: string;
  assignedTo: string;
  qaTester: string;
  isMine: boolean;
}

export interface TargetDefectGroup {
  crNumber: string;
  crLabel: string | null;
  teamName: string;
  defects: TargetDefect[];
}

const CYCLE_LABEL: Record<string, string> = {
  CYCLE_1: 'סבב 1', CYCLE_2: 'סבב 2', CYCLE_3: 'סבב 3',
  STAND_ALONE: 'Stand Alone', UAT: 'UAT', REHEARSAL: 'חזרה גנרלית', GO_LIVE: 'עליה לאוויר',
};
const CYCLE_ORDER = ['CYCLE_1', 'CYCLE_2', 'CYCLE_3', 'STAND_ALONE', 'UAT', 'REHEARSAL', 'GO_LIVE'];

const CAT_LABELS: Record<string, string> = {
  meeting: 'פגישה', refresh: 'רענון', deployment: 'העברת גרסה',
  testing: 'בדיקות', golive: 'עלייה לאוויר', billing: 'בילינג', other: 'אחר',
};

const fmtDate = (d: string) => formatDate(d);

// A CR's label often already starts with its own number as plain text (e.g.
// "13085 - העברת לקוח..."), pulled verbatim from the Excel source — prefixing
// "CR {number} —" on top of that duplicates it. Only prefix when the label
// doesn't already lead with the number.
function formatCrTitle(crNumber: string, crLabel: string | null): string {
  if (crLabel && crLabel.trim().startsWith(crNumber)) return crLabel.trim();
  return crLabel ? `CR ${crNumber} — ${crLabel}` : `CR ${crNumber}`;
}

function decodeHtmlEntities(text: string | null | undefined): string {
  if (!text) return '';
  const el = document.createElement('textarea');
  el.innerHTML = text;
  return el.value;
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '3px' }}>{label}</div>
      <div style={{ ...TEXT.sm, color: C.textPrimary, fontWeight: WEIGHT.medium }}>{value}</div>
    </div>
  );
}

interface Props {
  tasks: MyQaTask[];
  versionName?: string;
  versionId?: string;
  token: string;
  fullName: string;
  // Lifted up to EmployeeDashboard so the same fetch also feeds the home-page
  // defect KPI summary, instead of fetching it twice.
  targetDefectGroups: TargetDefectGroup[];
}

export const MyQaTasksView: React.FC<Props> = ({ tasks, versionName, versionId, token, fullName, targetDefectGroups }) => {
  const headers = { Authorization: `Bearer ${token}` };

  const [myActivities, setMyActivities] = useState<ActivityEntry[]>([]);
  const [crDetailFor, setCrDetailFor]   = useState<string | null>(null);
  const [crDetail, setCrDetail]         = useState<CrDetail | null>(null);
  const [crDetailLoading, setCrDetailLoading] = useState(false);

  // Activity-board entries (project milestones/events — a separate concept
  // from QA testing tasks) whose free-text owner-employee name matches this
  // tester, so they see anything specifically assigned to them there too.
  useEffect(() => {
    if (!versionId) { setMyActivities([]); return; }
    const myName = fullName.trim().toLowerCase();
    axios.get(`${API}/activity-board/${versionId}`, { headers })
      .then(res => setMyActivities(
        (res.data ?? []).filter((a: ActivityEntry) => a.ownerEmployee?.trim().toLowerCase() === myName),
      ))
      .catch(() => setMyActivities([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token, fullName]);

  const openCrDetail = useCallback(async (crNumber: string) => {
    if (!versionId) return;
    setCrDetailFor(crNumber);
    setCrDetail(null);
    setCrDetailLoading(true);
    try {
      const res = await axios.get(`${API}/version-cr-assignments/version/${versionId}/cr/${crNumber}/detail`, { headers });
      setCrDetail(res.data);
    } catch {
      setCrDetail(null);
    } finally {
      setCrDetailLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);

  const grouped = new Map<string, MyQaTask[]>();
  for (const t of tasks) {
    const ct = t.cycle.cycleType;
    if (!grouped.has(ct)) grouped.set(ct, []);
    grouped.get(ct)!.push(t);
  }
  const cycleTypes = Array.from(grouped.keys()).sort(
    (a, b) => CYCLE_ORDER.indexOf(a) - CYCLE_ORDER.indexOf(b),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🧪 המשימות שלי (QA)</div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px' }}>
          {versionName ? `בדיקות שהוקצו לך בגרסה ${versionName}` : 'בדיקות שהוקצו לך'}
        </div>
      </div>

      {tasks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px', color: C.textMuted, background: C.bgCard, borderRadius: RADIUS.lg, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: '48px' }}>🧪</div>
          <p style={{ fontSize: '17px', marginTop: '12px' }}>אין לך משימות QA משובצות כרגע בגרסה זו</p>
        </div>
      ) : (
        cycleTypes.map(ct => (
          <div key={ct} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflow: 'hidden' }}>
            <div style={{ padding: `${SP[3]} ${SP[4]}`, borderBottom: `1px solid ${C.border}`, ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>
              {CYCLE_LABEL[ct] ?? ct} · {grouped.get(ct)!.length} משימות
            </div>
            <div>
              {grouped.get(ct)!.map(t => {
                const isUrgent = t.urgent || !!t.priorityTestDate;
                return (
                  <div key={t.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SP[3],
                    padding: `${SP[3]} ${SP[4]}`, borderBottom: `1px solid ${C.border}`,
                    background: isUrgent ? C.dangerBg : 'transparent',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ ...TEXT.sm, fontWeight: WEIGHT.medium, color: C.textPrimary, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: SP[1] }}>
                        {isUrgent && <span title="דחוף / עדיפות" style={{ color: C.danger }}>🔴</span>}
                        <span
                          onClick={() => openCrDetail(t.crNumber)}
                          title="לחץ לפרטי ה-CR"
                          style={{ color: C.brand, cursor: 'pointer', textDecoration: 'underline dotted' }}
                        >
                          {formatCrTitle(t.crNumber, t.crLabel)}
                        </span>
                        {!t.isPrimary && (
                          <span style={{ ...TEXT.xs, color: C.textMuted }}>(בודק שני)</span>
                        )}
                        {t.taskType === 'STAND_ALONE' && (
                          <span style={{ ...TEXT.xs, color: C.brand }}>SA</span>
                        )}
                      </div>
                      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px' }}>
                        {fmtDate(t.plannedStart)} – {fmtDate(t.plannedEnd)} · {t.effortDays} ימים
                        {t.application && <> · פרויקט: {t.application}</>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* ── Activities assigned to me from the activity board ── */}
      {myActivities.length > 0 && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflow: 'hidden' }}>
          <div style={{ padding: `${SP[3]} ${SP[4]}`, borderBottom: `1px solid ${C.border}`, ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>
            📅 פעילויות משויכות אליי מלוח הפעילויות · {myActivities.length}
          </div>
          <div>
            {myActivities.map(a => (
              <div key={a.id} style={{ padding: `${SP[3]} ${SP[4]}`, borderBottom: `1px solid ${C.border}`, opacity: a.isRelevant ? 1 : 0.55 }}>
                <div style={{ ...TEXT.sm, fontWeight: WEIGHT.medium, color: C.textPrimary }}>
                  {a.label}
                  <span style={{ ...TEXT.xs, color: C.textMuted, marginRight: SP[2] }}>({CAT_LABELS[a.category] ?? a.category})</span>
                </div>
                <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px' }}>
                  {a.dateStart ? fmtDate(a.dateStart) : '—'}{a.dateEnd && a.dateEnd !== a.dateStart ? ` – ${fmtDate(a.dateEnd)}` : ''}
                  {a.owner && <> · {a.owner}</>}
                </div>
                {a.notes && <div style={{ ...TEXT.xs, color: C.textSecondary, marginTop: '2px' }}>{a.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TARGET CR defects — for every TARGET CR I'm assigned to test ── */}
      {targetDefectGroups.some(g => g.defects.length > 0) && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflow: 'hidden' }}>
          <div style={{ padding: `${SP[3]} ${SP[4]}`, borderBottom: `1px solid ${C.border}`, ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>
            🎯 תקלות TARGET · {targetDefectGroups.reduce((n, g) => n + g.defects.length, 0)}
          </div>
          <div>
            {targetDefectGroups.filter(g => g.defects.length > 0).map(g => (
              <div key={g.crNumber}>
                <div style={{ padding: `${SP[2]} ${SP[4]}`, background: C.bgNested, ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textSecondary }}>
                  {formatCrTitle(g.crNumber, g.crLabel)}
                </div>
                {g.defects.map(d => (
                  <div key={d.defectId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SP[3], padding: `${SP[3]} ${SP[4]}`, borderBottom: `1px solid ${C.border}`, background: d.isMine ? C.brandDim : 'transparent' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ ...TEXT.sm, fontWeight: WEIGHT.medium, color: C.textPrimary, display: 'flex', alignItems: 'center', gap: SP[1] }}>
                        {d.isMine && <span title="תקלה משויכת אליי אישית" style={{ color: C.brand }}>★</span>}
                        DEF-{d.defectId} — {d.title}
                      </div>
                      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px' }}>
                        {d.status}{d.severity && ` · ${d.severity}`}{d.assignedTo && ` · צוות: ${d.assignedTo}`}{d.qaTester && ` · בודק QA: ${d.qaTester}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── CR detail modal ── */}
      {crDetailFor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SP[4] }}
          onClick={() => { setCrDetailFor(null); setCrDetail(null); }}>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.xl, boxShadow: SHADOW.xl, width: '100%', maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column', direction: 'rtl' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding: `${SP[4]} ${SP[5]}`, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: SP[3] }}>
                <span style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📄 פרטי CR {crDetailFor}</span>
                {crDetail?.versionName && (
                  <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.brand, background: C.brandDim, padding: `2px ${SP[3]}`, borderRadius: RADIUS.full }}>
                    {crDetail.versionName}
                  </span>
                )}
              </div>
              <button onClick={() => { setCrDetailFor(null); setCrDetail(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 18, fontFamily: FONT }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: SP[5], display: 'flex', flexDirection: 'column', gap: SP[4] }}>
              {crDetailLoading ? (
                <div style={{ textAlign: 'center', padding: SP[6], color: C.textMuted, ...TEXT.sm }}>⏳ טוען...</div>
              ) : !crDetail ? (
                <div style={{ textAlign: 'center', padding: SP[6], color: C.textMuted, ...TEXT.sm }}>שגיאה בטעינת פרטי ה-CR</div>
              ) : (
                <>
                  <div>
                    <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>כותרת</div>
                    <div style={{ ...TEXT.md, color: C.textPrimary, fontWeight: WEIGHT.semibold }}>{crDetail.crLabel}</div>
                  </div>
                  {crDetail.crDescription && (
                    <div>
                      <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>תיאור</div>
                      <div style={{ ...TEXT.sm, color: C.textSecondary, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{decodeHtmlEntities(crDetail.crDescription)}</div>
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: SP[4], padding: SP[4], background: C.bgNested, borderRadius: RADIUS.lg }}>
                    <DetailField label="מנהל CR" value={crDetail.crManager} />
                    <DetailField label="פרויקט" value={crDetail.application} />
                    <DetailField label="סטטוס" value={crDetail.status} />
                    <DetailField label="צוותים מעורבים" value={crDetail.teams.length > 0 ? crDetail.teams.join(', ') : null} />
                  </div>
                  {crDetail.notes && (
                    <div>
                      <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>הערות</div>
                      <div style={{ ...TEXT.sm, color: C.textSecondary, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{decodeHtmlEntities(crDetail.notes)}</div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
