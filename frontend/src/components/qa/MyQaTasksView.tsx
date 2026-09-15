import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { formatDate } from '../../utils/dateFormat';
import { IssueKeyLink, StatusBadge, SeverityBadge } from '../shared/defectFieldDisplay';

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
      <div className="mb-1 text-xs text-subtle-foreground">{label}</div>
      <div className="text-sm font-medium text-foreground">{value}</div>
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
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-lg font-bold text-foreground">🧪 המשימות שלי (QA)</div>
        <div className="mt-0.5 text-xs text-subtle-foreground">
          {versionName ? `בדיקות שהוקצו לך בגרסה ${versionName}` : 'בדיקות שהוקצו לך'}
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-20 text-center text-subtle-foreground">
          <div className="text-[48px]">🧪</div>
          <p className="mt-3 text-sm text-subtle-foreground">אין לך משימות QA משובצות כרגע בגרסה זו</p>
        </div>
      ) : (
        cycleTypes.map(ct => (
          <div key={ct} className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3 text-sm font-bold text-foreground">
              {CYCLE_LABEL[ct] ?? ct} · {grouped.get(ct)!.length} משימות
            </div>
            <div>
              {grouped.get(ct)!.map(t => {
                const isUrgent = t.urgent || !!t.priorityTestDate;
                return (
                  <div
                    key={t.id}
                    className={`flex items-center justify-between gap-3 border-b border-border px-4 py-3 ${isUrgent ? 'bg-danger-bg' : 'bg-transparent'}`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1 text-sm font-medium text-foreground">
                        {isUrgent && <span title="דחוף / עדיפות" className="text-danger">🔴</span>}
                        <span
                          onClick={() => openCrDetail(t.crNumber)}
                          title="לחץ לפרטי ה-CR"
                          className="cursor-pointer text-primary underline decoration-dotted"
                        >
                          {formatCrTitle(t.crNumber, t.crLabel)}
                        </span>
                        {!t.isPrimary && (
                          <span className="text-xs text-subtle-foreground">(בודק שני)</span>
                        )}
                        {t.taskType === 'STAND_ALONE' && (
                          <span className="text-xs text-primary">SA</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-subtle-foreground">
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
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3 text-sm font-bold text-foreground">
            📅 פעילויות משויכות אליי מלוח הפעילויות · {myActivities.length}
          </div>
          <div>
            {myActivities.map(a => (
              <div key={a.id} className={`border-b border-border px-4 py-3 ${a.isRelevant ? 'opacity-100' : 'opacity-[0.55]'}`}>
                <div className="text-sm font-medium text-foreground">
                  {a.label}
                  <span className="ms-2 text-xs text-subtle-foreground">({CAT_LABELS[a.category] ?? a.category})</span>
                </div>
                <div className="mt-0.5 text-xs text-subtle-foreground">
                  {a.dateStart ? fmtDate(a.dateStart) : '—'}{a.dateEnd && a.dateEnd !== a.dateStart ? ` – ${fmtDate(a.dateEnd)}` : ''}
                  {a.owner && <> · {a.owner}</>}
                </div>
                {a.notes && <div className="mt-0.5 text-xs text-muted-foreground">{a.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TARGET CR defects — for every TARGET CR I'm assigned to test ── */}
      {targetDefectGroups.some(g => g.defects.length > 0) && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3 text-sm font-bold text-foreground">
            🎯 תקלות TARGET · {targetDefectGroups.reduce((n, g) => n + g.defects.length, 0)}
          </div>
          <div>
            {targetDefectGroups.filter(g => g.defects.length > 0).map(g => (
              <div key={g.crNumber}>
                <div className="bg-muted px-4 py-2 text-xs font-semibold text-muted-foreground">
                  {formatCrTitle(g.crNumber, g.crLabel)}
                </div>
                {g.defects.map(d => (
                  <div
                    key={d.defectId}
                    className={`flex items-center justify-between gap-3 border-b border-border px-4 py-3 ${d.isMine ? 'bg-primary-50' : 'bg-transparent'}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 text-sm font-medium text-foreground">
                        {d.isMine && <span title="תקלה משויכת אליי אישית" className="text-primary">★</span>}
                        <IssueKeyLink id={d.defectId} /> — {d.title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-subtle-foreground">
                        {d.status && <StatusBadge status={d.status} />}
                        {d.severity && <SeverityBadge severity={d.severity} />}
                        {d.assignedTo && <span>צוות: {d.assignedTo}</span>}
                        {d.qaTester && <span>בודק QA: {d.qaTester}</span>}
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
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/45 p-4"
          onClick={() => { setCrDetailFor(null); setCrDetail(null); }}
        >
          <div
            dir="rtl"
            className="flex max-h-[85vh] w-full max-w-[720px] flex-col rounded-xl border border-border bg-card shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold text-foreground">📄 פרטי CR {crDetailFor}</span>
                {crDetail?.versionName && (
                  <span className="rounded-full bg-primary-50 px-3 py-0.5 text-xs font-semibold text-primary">
                    {crDetail.versionName}
                  </span>
                )}
              </div>
              <button
                onClick={() => { setCrDetailFor(null); setCrDetail(null); }}
                className="cursor-pointer border-none bg-transparent text-lg text-subtle-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
              {crDetailLoading ? (
                <div className="p-6 text-center text-sm text-subtle-foreground">⏳ טוען...</div>
              ) : !crDetail ? (
                <div className="p-6 text-center text-sm text-subtle-foreground">שגיאה בטעינת פרטי ה-CR</div>
              ) : (
                <>
                  <div>
                    <div className="mb-1 text-xs text-subtle-foreground">כותרת</div>
                    <div className="text-md font-semibold text-foreground">{crDetail.crLabel}</div>
                  </div>
                  {crDetail.crDescription && (
                    <div>
                      <div className="mb-1 text-xs text-subtle-foreground">תיאור</div>
                      <div className="whitespace-pre-wrap text-sm leading-[1.6] text-muted-foreground">{decodeHtmlEntities(crDetail.crDescription)}</div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted p-4">
                    <DetailField label="מנהל CR" value={crDetail.crManager} />
                    <DetailField label="פרויקט" value={crDetail.application} />
                    <DetailField label="סטטוס" value={crDetail.status} />
                    <DetailField label="צוותים מעורבים" value={crDetail.teams.length > 0 ? crDetail.teams.join(', ') : null} />
                  </div>
                  {crDetail.notes && (
                    <div>
                      <div className="mb-1 text-xs text-subtle-foreground">הערות</div>
                      <div className="whitespace-pre-wrap text-sm leading-[1.6] text-muted-foreground">{decodeHtmlEntities(crDetail.notes)}</div>
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
