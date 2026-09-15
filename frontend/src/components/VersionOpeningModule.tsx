import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { DateField, DateTimeField } from './DatePicker';
import { formatDate } from '../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface CrRow {
  crNumber: string;
  crLabel: string | null;
  teamNames: string[];
  teams: { id: string; name: string; needsAttention: boolean }[];
  needsAttention: boolean;
  syncStatus: string;
}

interface VersionOpeningModuleProps {
  version: any;
  token: string;
  isManager: boolean;
  onRefresh: () => void;
  onStatusChange?: (s: string) => Promise<void>;
  focusStep?: StepKey;
}

export type StepKey = 'open' | 'scope' | 'approve' | 'manage';

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'open',     label: 'פתיחת גרסה' },
  { key: 'scope',    label: 'תכולת משימות' },
  { key: 'approve',  label: 'אישור תכולה' },
  { key: 'manage',   label: 'ניהול שינויים (מתמשך)' },
];

function utcToLocalInputStr(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function toUtcIso(str: string): string | undefined {
  if (!str) return undefined;
  const d = new Date(str);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}
function toDateOnly(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}
function fmtDateOnly(iso: string | null | undefined): string {
  return iso ? formatDate(iso) : '—';
}

// Explicit literal class lookup (never string-interpolated) per the two
// action buttons in this file — "brand" (save dates) and "success" (approve).
// Disabled swaps to a neutral fill, matching the old btnStyle()'s behavior of
// swapping the background to C.textDisabled rather than dimming via opacity.
const ACTION_BTN_VARIANT_CLASS: Record<'brand' | 'success', string> = {
  brand: 'bg-primary hover:bg-primary-600',
  success: 'bg-success hover:brightness-95',
};
function actionBtnClass(variant: 'brand' | 'success', disabled: boolean): string {
  return [
    'rounded-md px-5 py-[9px] text-[15px] font-bold text-white',
    'transition-colors duration-fast ease-out',
    disabled ? 'cursor-not-allowed bg-subtle-foreground' : `cursor-pointer ${ACTION_BTN_VARIANT_CLASS[variant]}`,
  ].join(' ');
}

// Step-chain bubble/label classes — three mutually exclusive states
// (done / active / neither), looked up explicitly rather than built from
// interpolated variables.
function stepBubbleClass(isDone: boolean, isActive: boolean): string {
  if (isDone) return 'border-success bg-success';
  if (isActive) return 'border-primary bg-primary';
  return 'border-border bg-muted';
}
function stepLabelClass(isDone: boolean, isActive: boolean): string {
  if (isDone) return 'text-success';
  if (isActive) return 'text-primary';
  return 'text-subtle-foreground';
}
function connectorClass(done: boolean): string {
  return done ? 'bg-success/50' : 'bg-border';
}

export const VersionOpeningModule: React.FC<VersionOpeningModuleProps> = ({ version, token, isManager, onRefresh, onStatusChange, focusStep }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  const dateFieldsFromVersion = (v: any) => ({
    integrationStart: toDateOnly(v.integrationStart),
    integrationEnd: toDateOnly(v.integrationEnd),
    qaStart: toDateOnly(v.qaStart),
    qaEnd: toDateOnly(v.qaEnd),
    plannedStart: v.plannedStart ? utcToLocalInputStr(v.plannedStart) : '',
    reviewMeetingTime: v.reviewMeetingTime ? utcToLocalInputStr(v.reviewMeetingTime) : '',
    workPlanMeetingTime: v.workPlanMeetingTime ? utcToLocalInputStr(v.workPlanMeetingTime) : '',
    submissionDeadline: v.submissionDeadline ? utcToLocalInputStr(v.submissionDeadline) : '',
    approvalDeadline: v.approvalDeadline ? utcToLocalInputStr(v.approvalDeadline) : '',
  });

  const [dates, setDates] = useState(dateFieldsFromVersion(version));
  const [savingDates, setSavingDates] = useState(false);

  useEffect(() => {
    setDates(dateFieldsFromVersion(version));
  }, [
    version.integrationStart, version.integrationEnd, version.qaStart, version.qaEnd, version.plannedStart,
    version.reviewMeetingTime, version.workPlanMeetingTime, version.submissionDeadline, version.approvalDeadline,
  ]);

  // integrationStart/End + qaStart/End are owned by the QA work plan once one
  // exists for a datesLockedToWorkPlan version (see versions.service.ts's
  // updateFields guard, added alongside this) — direct edits are rejected
  // server-side, so mirror that here: disable the fields and drop them from
  // the save payload instead of letting the whole save fail on an unrelated
  // field. plannedStart/reviewMeetingTime/workPlanMeetingTime/deadlines stay
  // freely editable regardless.
  const [hasWorkPlan, setHasWorkPlan] = useState(false);
  useEffect(() => {
    axios.get(`${API}/qa/workplan`, { headers, params: { versionId: version.id } })
      .then(r => setHasWorkPlan(!!r.data))
      .catch(() => setHasWorkPlan(false));
  }, [version.id]); // eslint-disable-line
  const datesLocked = !!version.datesLockedToWorkPlan && hasWorkPlan;

  const [rows, setRows] = useState<CrRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);

  const [estimateStats, setEstimateStats] = useState<{
    totalEstimateDays: number;
    qaFilteredEstimateDays: number;
    byTeam: { teamId: string; teamName: string; totalDays: number; qaFilteredDays: number; crs: { crNumber: string; crLabel: string; teamDays: number; hasQa: boolean }[] }[];
  } | null>(null);
  const [estimateQaFilter, setEstimateQaFilter] = useState(false);
  const [estimateExpandedTeam, setEstimateExpandedTeam] = useState<string | null>(null);

  useEffect(() => {
    const statsUrl = `${API}/version-cr-assignments/version/${version.id}/stats`;
    axios.get(statsUrl, { headers })
      .then(r => setEstimateStats(r.data ?? null))
      .catch(() => setEstimateStats(null));
  }, [version.id]); // eslint-disable-line

  const loadRows = async () => {
    setLoadingRows(true);
    try {
      const res = await axios.get(`${API}/version-cr-assignments/version/${version.id}`, { headers });
      const raw: any[] = res.data;
      const byCr = new Map<string, CrRow>();
      for (const r of raw) {
        const existing = byCr.get(r.crNumber);
        if (existing) {
          if (r.team?.name && !existing.teamNames.includes(r.team.name)) existing.teamNames.push(r.team.name);
          if (r.team?.id && !existing.teams.some(t => t.id === r.team.id)) {
            existing.teams.push({ id: r.team.id, name: r.team.name, needsAttention: r.needsAttention });
          }
          existing.needsAttention = existing.needsAttention || r.needsAttention;
        } else {
          byCr.set(r.crNumber, {
            crNumber: r.crNumber, crLabel: r.crLabel,
            teamNames: r.team?.name ? [r.team.name] : [],
            teams: r.team?.id ? [{ id: r.team.id, name: r.team.name, needsAttention: r.needsAttention }] : [],
            needsAttention: r.needsAttention, syncStatus: r.syncStatus,
          });
        }
      }
      setRows(Array.from(byCr.values()).sort((a, b) => a.crNumber.localeCompare(b.crNumber)));
    } catch (e) { console.error(e); }
    setLoadingRows(false);
  };

  useEffect(() => { loadRows(); }, [version.id]); // eslint-disable-line

  const saveDates = async () => {
    setSavingDates(true);
    setError(null);
    try {
      const payload: any = {
        plannedStart: dates.plannedStart ? toUtcIso(dates.plannedStart) : null,
        reviewMeetingTime: dates.reviewMeetingTime ? toUtcIso(dates.reviewMeetingTime) : null,
        workPlanMeetingTime: dates.workPlanMeetingTime ? toUtcIso(dates.workPlanMeetingTime) : null,
        submissionDeadline: dates.submissionDeadline ? toUtcIso(dates.submissionDeadline) : null,
        approvalDeadline: dates.approvalDeadline ? toUtcIso(dates.approvalDeadline) : null,
      };
      if (!datesLocked) {
        payload.integrationStart = dates.integrationStart || null;
        payload.integrationEnd = dates.integrationEnd || null;
        payload.qaStart = dates.qaStart || null;
        payload.qaEnd = dates.qaEnd || null;
      }
      await axios.patch(`${API}/versions/${version.id}`, payload, { headers });
      onRefresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'שגיאה בשמירת תאריכים');
    }
    setSavingDates(false);
  };

  const resync = async () => {
    setLoadingRows(true);
    try {
      await axios.post(`${API}/version-cr-assignments/version/${version.id}/sync`, {}, { headers });
      await loadRows();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'שגיאה בסנכרון תכולה');
      setLoadingRows(false);
    }
  };

  const acknowledgeAttention = async () => {
    setError(null);
    try {
      await axios.post(`${API}/versions/${version.id}/approve-scope`, {}, { headers });
      onRefresh();
      await loadRows();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'שגיאה באישור השינויים');
    }
  };

  const activeRows = rows.filter(r => r.syncStatus !== 'REMOVED');
  const attentionRows = rows.filter(r => r.needsAttention);

  const doApprove = async () => {
    setApproving(true);
    setError(null);
    try {
      await axios.post(`${API}/versions/${version.id}/approve-scope`, {}, { headers });
      if (version.status === 'COLLECTING' && onStatusChange) {
        await onStatusChange('CR_REVIEW');
      }
      onRefresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'שגיאה באישור תכולה');
    }
    setApproving(false);
  };

  // Driven by the persisted version, not the live `dates` draft — otherwise
  // just typing into the fields (before ever clicking "שמור") flips this to
  // true and the openStep-tracking effect below yanks the user straight to
  // the next step mid-edit, with nothing saved yet.
  const datesComplete = !!(version.integrationStart && version.integrationEnd && version.plannedStart);
  const scopeExists = activeRows.length > 0;
  const scopeApproved = !!version.scopeApprovedAt;

  const stepDone: Record<StepKey, boolean> = {
    open: datesComplete,
    scope: scopeExists,
    approve: scopeApproved,
    manage: false, // ongoing state — never "done"
  };
  const firstNotDone = STEPS.find(s => !stepDone[s.key])?.key ?? 'manage';
  const activeStepKey: StepKey = scopeApproved ? 'manage' : firstNotDone;

  const [openStep, setOpenStep] = useState<StepKey>(activeStepKey);
  // Once the user (or an explicit focusStep navigation) has picked a step,
  // that choice sticks for the rest of this mount — otherwise activeStepKey
  // recomputing after `rows` finishes its async load (see loadRows below)
  // silently yanks the view back to the "natural" current step, undoing
  // e.g. a "ניהול תאריכים" jump straight to the dates step (found live in
  // production 2026-08-03: reproduces on any version still mid CR_REVIEW,
  // since scopeExists — and therefore activeStepKey — only settles once the
  // CR rows fetch resolves; an already-approved version's activeStepKey is
  // 'manage' from the first render and never moves, so it never reproduced there).
  const userPickedStepRef = useRef(false);
  useEffect(() => {
    if (userPickedStepRef.current) return;
    setOpenStep(activeStepKey);
  }, [activeStepKey]); // eslint-disable-line

  const [expanded, setExpanded] = useState(!scopeApproved || attentionRows.length > 0);
  useEffect(() => {
    if (!scopeApproved || attentionRows.length > 0) setExpanded(true);
  }, [scopeApproved, attentionRows.length]);

  useEffect(() => {
    if (focusStep) { userPickedStepRef.current = true; setOpenStep(focusStep); setExpanded(true); }
  }, [focusStep]);

  const stepDescriptions: Record<StepKey, string> = {
    open: 'הזנת תאריכי פתיחת הגרסה — תחילת וסיום בדיקות אינטגרציה, ותאריך היעד לעליה לאוויר.',
    scope: `רשימת ה-CR-ים שסונכרנו לגרסה זו מ-CR_LIST (${activeRows.length} פעילים).`,
    approve: 'אישור סופי של תכולת הגרסה.',
    manage: `בניהול שינויי תכולה${version.plannedStart ? ` · יעד עלייה: ${fmtDateOnly(version.plannedStart)}` : ''}.`,
  };

  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* ── Header: title + numbered badge + step chain ── */}
      <div
        className="cursor-pointer px-6 pb-4 pt-3.5"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center">
          <div className="ms-5 flex shrink-0 items-center gap-2">
            <span className="text-base font-bold text-foreground">ניהול גרסה</span>
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-bold text-white">1</span>
            <span className="me-1 text-sm text-subtle-foreground">{expanded ? '▾' : '▸'}</span>
          </div>

          <div className="flex flex-1 items-center">
            {STEPS.map((s, i) => {
              const isDone = stepDone[s.key];
              const isActive = s.key === activeStepKey;
              const isNodeOpen = s.key === openStep;
              return (
                <React.Fragment key={s.key}>
                  <div
                    onClick={(e) => { e.stopPropagation(); userPickedStepRef.current = true; setOpenStep(s.key); setExpanded(true); }}
                    title={s.label}
                    className="flex shrink-0 cursor-pointer flex-col items-center gap-1"
                  >
                    <div className={[
                      'flex h-8 w-8 items-center justify-center rounded-full border-2',
                      'transition-[background-color,border-color,box-shadow] duration-fast ease-out',
                      stepBubbleClass(isDone, isActive),
                      isNodeOpen ? 'ring-4 ring-primary-100' : '',
                    ].join(' ')}>
                      {isDone ? (
                        <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
                          <path d="M1 5L4.5 8.5L11 1.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : isActive ? (
                        <div className="h-2 w-2 rounded-full bg-white" />
                      ) : null}
                    </div>
                    <span className={`whitespace-nowrap text-[13px] ${isActive ? 'font-semibold' : 'font-normal'} ${stepLabelClass(isDone, isActive)}`}>
                      {s.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div
                      className={`mx-1.5 mt-[15px] h-[1.5px] min-w-[10px] flex-1 self-start ${connectorClass(stepDone[STEPS[i + 1].key] || stepDone[s.key])}`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div className="mt-2.5 text-[13px] text-subtle-foreground">
          {stepDescriptions[openStep]}
        </div>

        {openStep === 'manage' && (
          <div
            onClick={e => e.stopPropagation()}
            className="mt-2.5 flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-2 text-[13px] text-muted-foreground"
          >
            <span>●</span>
            <span>כל שינוי בתכולה (הוספה/הסרה של משימה) מפעיל עדכון אוטומטי במודול 2 (תכנון ושיבוץ בדיקות) ובמודול 6 (תכנון ושיבוץ משימות לעלייה לאוויר)</span>
          </div>
        )}
      </div>

      {/* ── Expandable content ── */}
      {expanded && (
        <div className="border-t border-border px-6 py-5" onClick={e => e.stopPropagation()}>
          {error && (
            <div className="mb-4 rounded-lg border border-danger bg-danger-bg px-3.5 py-2.5 text-sm text-danger">⚠️ {error}</div>
          )}

          {openStep === 'open' && (
            <div>
              {datesLocked && (
                <div className="mb-3.5 rounded-md border border-border bg-muted px-3 py-2 text-[13px] text-muted-foreground">
                  ● תאריכי אינטגרציה ו-QA מנוהלים אוטומטית על ידי תוכנית העבודה של QA ואינם ניתנים לעריכה כאן — לשינוי לוח הזמנים יש לעדכן את תוכנית העבודה במודול 2 (תכנון ושיבוץ בדיקות).
                </div>
              )}
              <div className="flex flex-col gap-[18px]">
                <div>
                  <div className="mb-2 text-[13px] font-bold text-subtle-foreground">אינטגרציה ו-QA</div>
                  <div className="flex flex-wrap items-end gap-4">
                    <div>
                      <label className="mb-1.5 block text-[13px] font-semibold text-muted-foreground">תחילת בדיקות אינטגרציה</label>
                      <DateField value={dates.integrationStart} onChange={v => setDates(d => ({ ...d, integrationStart: v }))} disabled={datesLocked} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[13px] font-semibold text-muted-foreground">סיום בדיקות אינטגרציה</label>
                      <DateField value={dates.integrationEnd} onChange={v => setDates(d => ({ ...d, integrationEnd: v }))} minIso={dates.integrationStart || undefined} disabled={datesLocked} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[13px] font-semibold text-muted-foreground">תחילת QA</label>
                      <DateField value={dates.qaStart} onChange={v => setDates(d => ({ ...d, qaStart: v }))} disabled={datesLocked} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[13px] font-semibold text-muted-foreground">סיום QA</label>
                      <DateField value={dates.qaEnd} onChange={v => setDates(d => ({ ...d, qaEnd: v }))} minIso={dates.qaStart || undefined} disabled={datesLocked} />
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[13px] font-bold text-subtle-foreground">עלייה לאוויר</div>
                  <div className="flex flex-wrap items-end gap-4">
                    <div>
                      <label className="mb-1.5 block text-[13px] font-semibold text-muted-foreground">יעד לעליה לאוויר (ליל ההטמעה)</label>
                      <DateTimeField value={dates.plannedStart} onChange={v => setDates(d => ({ ...d, plannedStart: v }))} />
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[13px] font-bold text-subtle-foreground">ישיבות</div>
                  <div className="flex flex-wrap items-end gap-4">
                    <div>
                      <label className="mb-1.5 block text-[13px] font-semibold text-muted-foreground">ישיבת סקירה</label>
                      <DateTimeField value={dates.reviewMeetingTime} onChange={v => setDates(d => ({ ...d, reviewMeetingTime: v }))} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[13px] font-semibold text-muted-foreground">ישיבת תוכנית עבודה</label>
                      <DateTimeField value={dates.workPlanMeetingTime} onChange={v => setDates(d => ({ ...d, workPlanMeetingTime: v }))} />
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[13px] font-bold text-subtle-foreground">מועדי הגשה ואישור</div>
                  <div className="flex flex-wrap items-end gap-4">
                    <div>
                      <label className="mb-1.5 block text-[13px] font-semibold text-muted-foreground">מועד הגשת תוכניות</label>
                      <DateTimeField value={dates.submissionDeadline} onChange={v => setDates(d => ({ ...d, submissionDeadline: v }))} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[13px] font-semibold text-muted-foreground">מועד אישור תוכניות</label>
                      <DateTimeField value={dates.approvalDeadline} onChange={v => setDates(d => ({ ...d, approvalDeadline: v }))} />
                    </div>
                  </div>
                </div>

                <div>
                  <button onClick={saveDates} disabled={savingDates} className={actionBtnClass('brand', savingDates)}>
                    {savingDates ? '...' : '💾 שמור תאריכים'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {(openStep === 'scope' || openStep === 'manage') && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {activeRows.length} CR-ים פעילים{attentionRows.length > 0 ? `, ${attentionRows.length} דורשים תשומת לב` : ''}
                </div>
                <div className="flex gap-2">
                  <button onClick={resync} disabled={loadingRows} className="cursor-pointer rounded-md border border-border bg-muted px-3.5 py-1.5 text-[13px] text-muted-foreground">
                    🔄 סנכרן מ-CR_LIST
                  </button>
                  {openStep === 'manage' && attentionRows.length > 0 && (
                    <button onClick={acknowledgeAttention} className="cursor-pointer rounded-md border-none bg-warning px-3.5 py-1.5 text-[13px] font-bold text-white">
                      ✓ אשר שינויים
                    </button>
                  )}
                </div>
              </div>
              {loadingRows ? <div className="text-subtle-foreground">טוען...</div> : (
                <CrList rows={rows} versionId={version.id} headers={headers} />
              )}

              {estimateStats && (
                <EstimateBreakdown
                  stats={estimateStats}
                  qaFilter={estimateQaFilter}
                  onQaFilterChange={v => { setEstimateQaFilter(v); setEstimateExpandedTeam(null); }}
                  expandedTeam={estimateExpandedTeam}
                  onExpandTeam={t => setEstimateExpandedTeam(t)}
                />
              )}
            </div>
          )}

          {openStep === 'approve' && (
            <div>
              <div className="mb-4 flex max-w-[420px] flex-col gap-2">
                <div className="flex justify-between text-sm">
                  <span className="text-subtle-foreground">תחילת אינטגרציה</span>
                  <span className="font-semibold text-foreground">{dates.integrationStart || '—'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-subtle-foreground">סיום אינטגרציה</span>
                  <span className="font-semibold text-foreground">{dates.integrationEnd || '—'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-subtle-foreground">יעד עליה לאוויר</span>
                  <span className="font-semibold text-foreground">{dates.plannedStart ? dates.plannedStart.replace('T', ' ') : '—'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-subtle-foreground">CR-ים בתכולה</span>
                  <span className="font-semibold text-foreground">{activeRows.length}</span>
                </div>
              </div>
              <button onClick={doApprove} disabled={approving || !datesComplete || !scopeExists} className={actionBtnClass('success', approving || !datesComplete || !scopeExists)}>
                {approving ? '...' : version.status === 'COLLECTING' ? '✓ אשר תכולה ועבור לסקירת CR' : '✓ אשר תכולה'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const EstimateBreakdown: React.FC<{
  stats: {
    totalEstimateDays: number;
    qaFilteredEstimateDays: number;
    byTeam: { teamId: string; teamName: string; totalDays: number; qaFilteredDays: number; crs: { crNumber: string; crLabel: string; teamDays: number; hasQa: boolean }[] }[];
  };
  qaFilter: boolean;
  onQaFilterChange: (v: boolean) => void;
  expandedTeam: string | null;
  onExpandTeam: (teamId: string | null) => void;
}> = ({ stats, qaFilter, onQaFilterChange, expandedTeam, onExpandTeam }) => {
  const teams = qaFilter ? stats.byTeam.filter(t => t.qaFilteredDays > 0) : stats.byTeam;
  const maxDays = Math.max(...(teams.length ? teams.map(t => qaFilter ? t.qaFilteredDays : t.totalDays) : [1]), 1);

  return (
    <div className="mt-4 rounded-md border border-border bg-muted p-4">
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="text-[17px]">📊</span>
        <div className="flex-1">
          <div className="text-sm font-bold text-foreground">פירוט הערכות השקעה לפי צוות</div>
          <div className="text-xs text-subtle-foreground">לחץ על צוות לפירוט CRs</div>
        </div>
        <div className="flex gap-1 rounded-md bg-card p-[3px]">
          {[
            { key: false, label: 'כל CRs' },
            { key: true, label: 'CRs עם QA' },
          ].map(opt => (
            <button
              key={String(opt.key)}
              onClick={() => onQaFilterChange(opt.key)}
              className={[
                'cursor-pointer rounded-sm border-none px-3.5 py-[5px] text-xs font-semibold',
                'transition-[background-color,color,box-shadow] duration-fast ease-out',
                qaFilter === opt.key ? 'bg-muted text-foreground shadow-xs' : 'bg-transparent text-subtle-foreground',
              ].join(' ')}
            >{opt.label}</button>
          ))}
        </div>
        <div className="rounded-md bg-primary-100 px-3 py-1 text-[13px] font-bold text-primary">
          סה"כ: {qaFilter ? stats.qaFilteredEstimateDays : stats.totalEstimateDays} ימ"ע
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {teams.map(team => {
          const days = qaFilter ? team.qaFilteredDays : team.totalDays;
          const crs = qaFilter ? team.crs.filter(c => c.hasQa) : team.crs;
          const isOpen = expandedTeam === team.teamId;
          const barPct = Math.round((days / maxDays) * 100);
          return (
            <div key={team.teamId} className={`overflow-hidden rounded-md border transition-colors duration-fast ease-out ${isOpen ? 'border-primary' : 'border-border'}`}>
              <div
                onClick={() => onExpandTeam(isOpen ? null : team.teamId)}
                className={`flex cursor-pointer items-center gap-3 px-3.5 py-2.5 ${isOpen ? 'bg-primary-100' : 'bg-card'}`}
              >
                <div className="min-w-[130px] text-[13px] font-semibold text-foreground">{team.teamName}</div>
                <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                  <div className="h-full rounded bg-primary transition-[width] duration-300 ease-out" style={{ width: `${barPct}%` }} />
                </div>
                <div className="min-w-[60px] text-start text-[13px] font-bold text-primary">{days} ימ"ע</div>
                <div className="min-w-[50px] text-start text-xs text-subtle-foreground">{crs.length} CRs</div>
                <div className="text-xs text-primary">{isOpen ? '▲' : '▼'}</div>
              </div>
              {isOpen && (
                <div className="flex flex-col gap-[3px] bg-muted px-3.5 pb-2.5 pt-2">
                  {crs.map(cr => (
                    <div key={cr.crNumber} className="flex items-center gap-2.5 rounded-sm px-1.5 py-[5px]">
                      <div className="min-w-[60px] text-xs font-semibold text-subtle-foreground">{cr.crNumber}</div>
                      <div className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{cr.crLabel.replace(cr.crNumber + ' - ', '')}</div>
                      {cr.hasQa && <span className="text-xs font-semibold text-success">QA</span>}
                      <div className="min-w-[50px] text-start text-xs font-bold text-primary">{cr.teamDays} ימ"ע</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {teams.length === 0 && (
          <div className="p-5 text-center text-[13px] text-subtle-foreground">
            הפירוט לפי צוות זמין לאחר סינכרון CR_LIST עם הגרסה
          </div>
        )}
      </div>
    </div>
  );
};

// Per-team change reason, fetched on demand from the same endpoint
// VersionOverview's CR-detail screen already uses — reused here instead of
// duplicated, just surfaced inline instead of as a separate screen.
type ChangeDetail = { teamName: string; reason: string };

const CrList: React.FC<{ rows: CrRow[]; versionId: string; headers: Record<string, string> }> = ({ rows, versionId, headers }) => {
  const [expandedCr, setExpandedCr] = useState<string | null>(null);
  const [details, setDetails] = useState<ChangeDetail[] | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const toggle = async (r: CrRow) => {
    if (expandedCr === r.crNumber) { setExpandedCr(null); return; }
    setExpandedCr(r.crNumber);
    setDetails(null);
    setLoadingDetail(true);
    const flaggedTeams = (r.teams ?? []).filter(t => t.needsAttention);
    try {
      const results = await Promise.all(flaggedTeams.map(t =>
        axios.get(`${API}/version-cr-assignments/version/${versionId}/cr/${r.crNumber}/team/${t.id}/change-detail`, { headers })
          .then(res => ({ teamName: t.name, reason: res.data.reason as string }))
          .catch(() => ({ teamName: t.name, reason: 'שגיאה בטעינת הסיבה.' }))
      ));
      setDetails(results);
    } finally {
      setLoadingDetail(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map(r => (
        <div key={r.crNumber} className={[
          'rounded-md border',
          r.needsAttention ? 'border-warning bg-warning-bg' : 'border-border bg-muted',
          r.syncStatus === 'REMOVED' ? 'opacity-60' : 'opacity-100',
        ].join(' ')}>
          <div
            onClick={r.needsAttention ? () => toggle(r) : undefined}
            className={`flex items-center gap-2.5 px-3 py-2 ${r.needsAttention ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <span className="min-w-[90px] font-semibold text-foreground">{r.crNumber}</span>
            <span className={`flex-1 text-muted-foreground ${r.syncStatus === 'REMOVED' ? 'line-through' : ''}`}>{r.crLabel?.replace(/^\d+\s*-\s*/, '') ?? '—'}</span>
            <span className="text-[13px] text-subtle-foreground">{r.teamNames.join(', ')}</span>
            {r.syncStatus === 'NEW' && <span className="text-xs font-bold text-primary">חדש</span>}
            {r.syncStatus === 'REMOVED' && <span className="text-xs font-bold text-danger">הוסר</span>}
            {r.needsAttention && (
              <span className="text-xs font-bold text-warning">
                ⚠ דורש תשומת לב · {expandedCr === r.crNumber ? 'הסתר פירוט ▲' : 'מה השתנה? ▾'}
              </span>
            )}
          </div>
          {expandedCr === r.crNumber && (
            <div className="border-t border-warning/25 px-3 pb-2.5 pt-1">
              {loadingDetail ? (
                <div className="text-[13px] text-subtle-foreground">טוען...</div>
              ) : (
                (details ?? []).map((d, i) => (
                  <div key={i} className="mt-1 text-[13px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{d.teamName}:</span> {d.reason}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      ))}
      {rows.length === 0 && <div className="text-subtle-foreground">אין CR-ים בתכולת הגרסה. יש לסנכרן מקובץ CR_LIST.</div>}
    </div>
  );
};
