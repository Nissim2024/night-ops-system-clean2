import React, { useState } from 'react';
import RunbookModal, { RUNBOOKS, getRunbookTrigger, RunbookTrigger } from './qa/RunbookModal';
import { CAT_LABELS, useMyActivityTasks } from './qa/activityBoardShared';
import { C, severityColor, severityLabel } from '../theme';
import { MyQaTask, TargetDefectGroup } from './qa/MyQaTasksView';
import { VersionMilestoneTimeline } from './shared/VersionMilestoneTimeline';
import { GoLiveCountdown } from './shared/GoLiveCountdown';
import { DefectDrilldownModal } from './release-intelligence/DefectDrilldownModal';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const CYCLE_LABEL: Record<string, string> = {
  CYCLE_1: 'סבב 1', CYCLE_2: 'סבב 2', CYCLE_3: 'סבב 3',
  STAND_ALONE: 'Stand Alone', UAT: 'UAT',
};

// Same stage → icon/color mapping used in HomeDashboard (manager view) — kept in sync
// deliberately so employees see the same visual language for the same stage.
const PHASE_META: Record<string, { label: string; icon: string; color: string; bg: string; desc: string }> = {
  DRAFT:        { label: 'שלב טיוטה',        icon: '📋', color: '#4573D2', bg: 'rgba(69,115,210,0.07)',  desc: 'מנהל הלילה מכין את תוכנית העבודה. עוד אין משימות לצפייה.' },
  COLLECTING:   { label: 'איסוף משימות',      icon: '📝', color: '#9C6ADE', bg: 'rgba(156,106,222,0.07)', desc: 'הצוותים מגישים הצעות משימות. ההרצה תתחיל לאחר האישור.' },
  CR_REVIEW:    { label: 'סקירת CR',          icon: '🔍', color: '#E8AF00', bg: 'rgba(232,175,0,0.07)',   desc: 'הצוותים מגישים ומאשרים תוכניות עבודה ל-CR-ים.' },
  REFINING:     { label: 'טיוב תוכנית',       icon: '✏️', color: '#E8AF00', bg: 'rgba(232,175,0,0.07)',   desc: 'מנהל הלילה עורך ומסדר את המשימות לפי הערות הסקירה.' },
  REVIEW:       { label: 'ישיבת מעבר',        icon: '👥', color: '#4573D2', bg: 'rgba(69,115,210,0.07)',  desc: 'ישיבת מעבר עם כלל המשתתפים לאישור סופי.' },
  APPROVED:     { label: 'תוכנית מאושרת',     icon: '✅', color: '#37C47A', bg: 'rgba(55,196,122,0.07)',  desc: 'התוכנית אושרה. ההרצה עתידה להתחיל בקרוב.' },
  REHEARSAL:    { label: 'חזרה גנרלית פעילה', icon: '🎭', color: '#8b5cf6', bg: 'rgba(139,92,246,0.07)',  desc: 'החזרה הגנרלית בביצוע — עקוב אחר המשימות שלך.' },
  ACTIVE:       { label: 'עלייה לאוויר — לייב', icon: '🚀', color: '#F06A6A', bg: 'rgba(240,106,106,0.07)', desc: 'עלייה לאוויר פעילה — עקוב אחר המשימות שלך בזמן אמת.' },
  MORNING_AFTER:{ label: 'בוקר שלאחר',        icon: '🌅', color: '#F0883E', bg: 'rgba(240,136,62,0.07)',  desc: 'שלב בקרות הבוקר — ודא שהמשימות שלך הושלמו.' },
  COMPLETED:    { label: 'הושלם',             icon: '🏁', color: '#37C47A', bg: 'rgba(55,196,122,0.07)',  desc: 'הגרסה הושלמה בהצלחה.' },
};

function StatCard({ value, label, delta, deltaColor }: { value: string; label: string; delta?: string; deltaColor?: string }) {
  return (
    <div className="flex-1 rounded-lg border border-border bg-card px-5 py-4">
      <div className="text-xl font-bold leading-tight text-foreground">{value}</div>
      <div className="mt-1 text-xs text-subtle-foreground">{label}</div>
      {delta && <div className="mt-1.5 text-xs" style={{ color: deltaColor ?? undefined }}>{delta}</div>}
    </div>
  );
}

function ActionItem({ icon, title, desc, urgent, onClick }: { icon: string; title: string; desc: string; urgent?: boolean; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-2.5 border-b border-border py-2.5 ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <span className="mt-0.5 flex-shrink-0 text-base">{icon}</span>
      <div className="flex-1">
        <div className={`text-sm font-medium ${urgent ? 'text-danger' : 'text-foreground'}`}>{title}</div>
        <div className="mt-0.5 text-xs text-subtle-foreground">{desc}</div>
      </div>
      {onClick && <span className="mt-0.5 flex-shrink-0 text-xs font-semibold text-primary">←</span>}
    </div>
  );
}

// The tester's own plan-vs-actual slice (GET /release-intelligence/my-plan-status).
export interface MyPlanStatus {
  cycleType: string | null;
  todayIsWorkDay: boolean;
  todayDataAvailable: boolean;
  pastTodayCheckHour: boolean;
  me: {
    expected: number; executed: number; total: number; gap: number; gapPct: number | null;
    status: 'AHEAD' | 'ON_TRACK' | 'AT_RISK' | 'BEHIND' | 'NOT_STARTED' | 'NO_SCENARIOS';
    plannedToday: number; executedToday: number | null; crCount: number;
    defects: { reported: number; stillOpen: number; awaitingRetest: number; targetAwaitingRetest: number };
  } | null;
}

interface Props {
  token: string;
  fullName: string;
  activeVersion: any | null;
  planningVersion: any | null;
  taskStats: { done: number; inProgress: number; open: number; waiting: number; blocked: number; total: number };
  seasonReminder: { id: string; name: string } | null;
  teamName?: string | null;
  homeNotices?: { id: string; text: string; urgency: string }[];
  myRunbookSteps?: { runbookId: string; stepIndex: number; startTime: string; runDate: string; team: string }[];
  isQaTester?: boolean;
  myQaTasks?: MyQaTask[];
  qaSummary?: { cycles: { cycleType: string; plannedStart: string; plannedEnd: string }[] } | null;
  targetDefectGroups?: TargetDefectGroup[];
  defectStats?: {
    opened: number; stillOpen: number; waitingForMyVerification: number; expectedMin: number; tooFew: boolean;
    underCoveredCrs: { crNumber: string; crLabel: string; scenarioCount: number; expectedMinScenarios: number; devDays: number }[];
    staleVerifications: { id: string; severity: string; daysWaiting: number; threshold: number }[];
  } | null;
  planStatus?: MyPlanStatus | null;
  onGoToTasks: () => void;
  onGoToLeaves: () => void;
  onGoToQaTasks?: () => void;
  onOpenFocusMode: () => void;
}

export const EmployeeHomeView: React.FC<Props> = ({
  token, fullName, activeVersion, planningVersion, taskStats, seasonReminder, teamName,
  homeNotices, myRunbookSteps, isQaTester, myQaTasks, qaSummary, targetDefectGroups, defectStats, planStatus,
  onGoToTasks, onGoToLeaves, onGoToQaTasks, onOpenFocusMode,
}) => {
  const firstName = fullName.split(' ')[0] || fullName;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'שלום' : hour < 21 ? 'ערב טוב' : 'לילה טוב';
  const [tasksExpanded, setTasksExpanded] = useState(false);
  // Drill-down from any defect stat tile → the actual defect list, reusing
  // the same DefectDrilldownModal + DefectDetailScreen every other defect
  // count in the app opens (spec 2026-09-30, tester feedback: "צריך לאפשר
  // בהן דריל לרשימת התקלות"). `endpoint` is a full, ready-to-fetch URL —
  // built per-tile below — rather than the versionId/screen/filter scheme,
  // since these buckets are self-scoped server-side (target-cr.controller's
  // req.user), not generic KPI filters.
  const [drilldown, setDrilldown] = useState<{ title: string; endpoint: string } | null>(null);
  const [runbookItem, setRunbookItem] = useState<{ trigger: RunbookTrigger; dateStartISO: string } | null>(null);

  const primary = activeVersion ?? planningVersion;
  // Activity-board entries assigned to me (QA module's לוח פעילויות) — same
  // personal-task rules as the manager Home (activityBoardShared.tsx).
  const { tasks: myActivityTasks, markDone: markActivityDone } = useMyActivityTasks(token, primary?.id, fullName);
  const ph = primary ? (PHASE_META[primary.status] ?? PHASE_META['DRAFT']) : null;
  const isLiveNow = activeVersion && ['ACTIVE', 'REHEARSAL'].includes(activeVersion.status);

  const openDefectDrilldown = (title: string, bucket: string) => {
    if (!primary) return;
    const params = new URLSearchParams({ versionId: primary.id, bucket });
    setDrilldown({ title, endpoint: `${API}/target-cr/my-defects-list?${params.toString()}` });
  };

  const actions: { icon: string; title: string; desc: string; urgent?: boolean; onClick: () => void }[] = [];
  for (const { a, task } of myActivityTasks) {
    const trigger = task.dueNow ? getRunbookTrigger(a.activityKey) : null;
    actions.push({
      icon: trigger ? '▶' : '📌',
      title: `המשימה שלך: ${task.text}`,
      desc: [a.owner, CAT_LABELS[a.category as keyof typeof CAT_LABELS]].filter(Boolean).join(' · ')
        + (trigger ? ' · לחץ להפעלת Runbook' : ' · לחץ לסימון כבוצע'),
      urgent: task.urgent,
      onClick: trigger ? () => setRunbookItem({ trigger, dateStartISO: a.dateStart! }) : () => markActivityDone(a),
    });
  }
  if (seasonReminder) {
    actions.push({
      icon: '🌴', title: `עונת חופשות "${seasonReminder.name}" פתוחה להגשה`,
      desc: 'עדיין לא הגשת בקשה — כדאי להגיש לפני נעילת המערכת.', urgent: true,
      onClick: onGoToLeaves,
    });
  }
  if (isLiveNow && taskStats.blocked > 0) {
    actions.push({
      icon: '⛔', title: `${taskStats.blocked} משימות חסומות`,
      desc: 'יש לך משימות שנחסמו — בדוק אותן במסך המשימות.', urgent: true,
      onClick: onGoToTasks,
    });
  }
  if (isLiveNow && taskStats.open > 0) {
    actions.push({
      icon: '🔔', title: `${taskStats.open} משימות פתוחות מוכנות להתחלה`,
      desc: 'ניתן להתחיל אותן עכשיו במסך המשימות.',
      onClick: onGoToTasks,
    });
  }

  // Runbook steps assigned specifically to this employee, happening today/tomorrow.
  const todayStr = new Date().toDateString();
  const tomorrowStr = new Date(Date.now() + 86400000).toDateString();
  for (const step of myRunbookSteps ?? []) {
    const def = RUNBOOKS[step.runbookId];
    const stepDef = def?.steps[step.stepIndex];
    if (!stepDef) continue;
    const stepDate = new Date(step.runDate).toDateString();
    const dayLabel = stepDate === todayStr ? 'היום' : stepDate === tomorrowStr ? 'מחר' : null;
    if (!dayLabel) continue;
    actions.push({
      icon: '🛠',
      title: `${stepDef.activity} — ${dayLabel} ${step.startTime}`,
      desc: `המשימה שלך${step.team ? ` · ${step.team}` : ''}`,
      urgent: dayLabel === 'היום',
      onClick: onGoToTasks,
    });
  }

  // Plan-vs-actual alerts (spec 2026-10-03, user's wording): behind the work
  // plan to date, and — once part of the work day has passed — nothing run
  // today, or today's runs short of today's planned amount.
  const myPlan = planStatus?.me;
  if (myPlan && (myPlan.status === 'BEHIND' || myPlan.status === 'AT_RISK')) {
    actions.push({
      icon: '📉',
      title: myPlan.status === 'BEHIND' ? 'לפי התוכנית אתה בפיגור' : 'לפי התוכנית אתה בסיכון לפיגור',
      desc: `הרצת ${myPlan.executed} תרחישים מתוך ${myPlan.expected} מצופים עד היום לפי תוכנית העבודה (פער ${Math.abs(myPlan.gap)}${myPlan.gapPct != null ? `, ${Math.abs(myPlan.gapPct)}%` : ''}).`,
      urgent: myPlan.status === 'BEHIND',
      onClick: onGoToQaTasks ?? onGoToTasks,
    });
  }
  if (myPlan && planStatus!.todayIsWorkDay && planStatus!.todayDataAvailable && planStatus!.pastTodayCheckHour
      && myPlan.plannedToday > 0 && myPlan.executedToday != null && myPlan.executedToday < myPlan.plannedToday) {
    actions.push(myPlan.executedToday === 0
      ? {
          icon: '⏸️', title: 'היום לא הרצת תרחישים בכלל',
          desc: `לפי תוכנית העבודה מתוכננים לך היום ${myPlan.plannedToday} תרחישים.`,
          urgent: true, onClick: onGoToQaTasks ?? onGoToTasks,
        }
      : {
          icon: '⚠️', title: 'כמות התרחישים שהרצת היום אינה תואמת לתוכנית העבודה',
          desc: `הרצת היום ${myPlan.executedToday} מתוך ${myPlan.plannedToday} מתוכננים.`,
          onClick: onGoToQaTasks ?? onGoToTasks,
        });
  }
  if (myPlan && myPlan.defects.targetAwaitingRetest > 0) {
    actions.push({
      icon: '🎯', title: `${myPlan.defects.targetAwaitingRetest} תקלות TARGET ממתינות לאימות שלך`,
      desc: 'תקלות TARGET שמשויכות אליך תוקנו וממתינות לבדיקה חוזרת — כדאי לשבץ אותן בתוכנית היום.',
      onClick: onGoToQaTasks ?? onGoToTasks,
    });
  }

  // Two tester-specific alerts (spec 2026-09-29): both only ever have data
  // when isQaTester (EmployeeDashboard only fetches defectStats for a real
  // tester), so no extra isQaTester gate needed here.
  if ((defectStats?.staleVerifications?.length ?? 0) > 0) {
    const oldest = defectStats!.staleVerifications[0];
    actions.push({
      icon: '⏰', title: `${defectStats!.staleVerifications.length} תקלות ממתינות לבדיקתך זמן רב מדי`,
      desc: `הוותיקה ביותר: ${oldest.daysWaiting} ימים בסטטוס Fixed_Test (${oldest.severity}, סף: ${oldest.threshold} ${oldest.threshold === 1 ? 'יום' : 'ימים'}).`,
      urgent: true,
      onClick: onGoToQaTasks ?? onGoToTasks,
    });
  }
  if ((defectStats?.underCoveredCrs?.length ?? 0) > 0) {
    const worst = [...defectStats!.underCoveredCrs].sort((a, b) => (a.scenarioCount / Math.max(1, a.expectedMinScenarios)) - (b.scenarioCount / Math.max(1, b.expectedMinScenarios)))[0];
    actions.push({
      icon: '📉', title: `${defectStats!.underCoveredCrs.length} CR-ים עם כיסוי תרחישים חסר`,
      desc: `לדוגמה CR ${worst.crNumber}: ${worst.scenarioCount} תרחישים נכתבו מתוך ${worst.expectedMinScenarios} צפויים (${worst.devDays} ימי פיתוח).`,
      onClick: onGoToQaTasks ?? onGoToTasks,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Greeting ── */}
      <div>
        <div className="text-lg font-bold text-foreground">{greeting}, {firstName} 👋</div>
        <div className="mt-0.5 text-xs text-subtle-foreground">
          {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          {teamName && <> · {teamName}</>}
        </div>
      </div>

      {/* ── Hero banner — one dark card (matches the manager's HomeDashboard
          hero) holding the version name/phase/CTA plus, for QA testers, the
          milestone timeline and go-live countdown — not a separate card per
          piece. Notices moved out to their own dedicated panel below (spec
          2026-09-30: they were getting buried here, mixed into decoration
          rather than reading as an announcements area) and the pre-live
          "פרטי גרסה" button was removed — it was a mislabeled duplicate of
          the same onGoToTasks the action-item cards below already trigger. */}
      {primary && ph ? (
        <div
          className="rounded-lg px-6 py-5 shadow-md"
          style={{ background: 'linear-gradient(135deg, #14152A 0%, #22244a 60%, #241f42 100%)' }}
        >
          <div className="flex items-center gap-5">
            <span className="flex-shrink-0 text-4xl">{ph.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[28px] font-bold leading-[1.1] tracking-tight text-white">
                {primary.name}
              </div>
              <div className="mb-1.5 text-sm font-semibold text-white/85">{ph.icon} {ph.label}</div>
              <div className="text-xs text-white/60">{ph.desc}</div>
            </div>
            {isLiveNow && (
              <div className="flex flex-shrink-0 flex-col items-start gap-2">
                <button
                  onClick={onOpenFocusMode}
                  className="cursor-pointer whitespace-nowrap rounded-md border-none bg-white px-5 py-2.5 font-sans text-sm font-semibold text-[#14152A]"
                >
                  ⚡ המשימות שלי
                </button>
              </div>
            )}
          </div>

          {/* QA-tester-only enrichment, scoped to their dashboard — not a
              general change for every employee. */}
          {isQaTester && (
            <>
              <VersionMilestoneTimeline version={primary} cycles={qaSummary?.cycles} />
              <GoLiveCountdown plannedStart={primary.plannedStart} status={primary.status} />
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-4 rounded-lg border border-border bg-card px-6 py-5">
          <span className="text-3xl">🌙</span>
          <div>
            <div className="text-sm font-bold text-foreground">אין פעילות פעילה הלילה</div>
            <div className="mt-0.5 text-xs text-subtle-foreground">אין גרסה פעילה כעת. המתן להנחיות מנהל הלילה.</div>
          </div>
        </div>
      )}

      {/* ── Notices — a dedicated announcements panel, not decoration mixed
          into the hero card (spec 2026-09-30, tester feedback: "למה להציג
          הודעות בחלק של החלונית ולא באיזור ההודעות?"). Same RM/ADMIN-authored
          VersionNotice rows the manager's HomeDashboard pins above its own
          feed — this is that same dedicated-panel treatment for the tester. ── */}
      {isQaTester && (homeNotices ?? []).length > 0 && (
        <div className="rounded-lg border border-border bg-card px-5 py-[18px]">
          <div className="mb-2.5 text-sm font-bold text-foreground">📌 הודעות</div>
          <div className="flex flex-col gap-2">
            {homeNotices!.map(n => (
              <div key={n.id} className="flex items-start gap-2 rounded-md px-3 py-2 text-sm" style={{ background: `${severityColor(n.urgency)}14`, border: `1px solid ${severityColor(n.urgency)}40` }}>
                <span className="flex-shrink-0">📌</span>
                <div className="min-w-0 flex-1">
                  <span className="mb-1 inline-block rounded-full px-2 py-px text-xs font-bold text-white" style={{ background: severityColor(n.urgency) }}>
                    {severityLabel(n.urgency)}
                  </span>
                  <div className="whitespace-pre-wrap text-foreground">{n.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Stats row (only while a run is actually live) ── */}
      {isLiveNow && (
        <div className="flex gap-3">
          <StatCard value={`${taskStats.done}/${taskStats.total}`} label="התקדמות כללית" deltaColor={C.success} delta={taskStats.total > 0 ? `${Math.round((taskStats.done / taskStats.total) * 100)}%` : undefined} />
          <StatCard value={String(taskStats.open)} label="פתוחות" />
          <StatCard value={String(taskStats.inProgress)} label="בביצוע" deltaColor={C.warning} />
          <StatCard value={String(taskStats.blocked)} label="חסומות" deltaColor={taskStats.blocked > 0 ? C.danger : undefined} />
        </div>
      )}

      {/* ── My QA tasks card — header + overall progress + inline drill-down,
          merged into one card instead of separate task/progress boxes. ── */}
      {isQaTester && (() => {
        const total = myQaTasks?.length ?? 0;
        const now = Date.now();
        const pastSchedule = (myQaTasks ?? []).filter(t => new Date(t.plannedEnd).getTime() < now).length;
        const pct = total > 0 ? Math.round((pastSchedule / total) * 100) : 0;
        const taskStatus = (t: MyQaTask) => {
          const start = new Date(t.plannedStart).getTime();
          const end = new Date(t.plannedEnd).getTime();
          if (end < now) return { label: '⚠ חרג מלו"ז', color: C.danger };
          if (start <= now) return { label: '▶ בביצוע', color: C.brand };
          return { label: '○ טרם התחיל', color: C.textMuted };
        };
        return (
          <div className="rounded-lg border border-border bg-card px-5 py-[18px]">
            <div className="flex items-center gap-4">
              <span className="flex-shrink-0 text-[30px]">🧪</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-foreground">המשימות שלי (QA)</div>
                {total > 0 ? (
                  <div className="mt-0.5 text-xs text-subtle-foreground">
                    {total} משימות בדיקה משובצות לך
                    {myQaTasks![0] && ` · הקרובה: CR ${myQaTasks![0].crNumber} (${CYCLE_LABEL[myQaTasks![0].cycle.cycleType] ?? myQaTasks![0].cycle.cycleType})`}
                  </div>
                ) : (
                  <div className="mt-0.5 text-xs text-subtle-foreground">אין לך משימות בדיקה משובצות כרגע בגרסה זו</div>
                )}
              </div>
              {onGoToQaTasks && (
                <span onClick={onGoToQaTasks} className="flex-shrink-0 cursor-pointer text-xs font-semibold text-primary">לכל המשימות ←</span>
              )}
            </div>

            {total > 0 && (
              <>
                <div className="mt-3.5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span
                      onClick={() => setTasksExpanded(v => !v)}
                      className="cursor-pointer select-none text-xs font-semibold text-muted-foreground"
                    >
                      {tasksExpanded ? '▲' : '▼'} התקדמות בבדיקות (לפי לוח זמנים)
                    </span>
                    <span className="text-xs text-subtle-foreground">{pastSchedule}/{total} משימות ({pct}%)</span>
                  </div>
                  <div
                    onClick={() => setTasksExpanded(v => !v)}
                    className="h-2.5 cursor-pointer overflow-hidden rounded-lg bg-muted"
                  >
                    <div className="h-full rounded-lg transition-[width] duration-500 ease-in-out" style={{ background: pct >= 100 ? C.success : C.brand, width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-subtle-foreground">
                    מבוסס על תאריכי הסיום המתוכננים — לא בהכרח משקף השלמה בפועל
                  </div>
                </div>

                {/* ── Drill-down: per-task status, inline, no navigation needed ── */}
                {tasksExpanded && (
                  <div className="mt-2.5 flex flex-col gap-1.5 border-t border-border pt-2.5">
                    {myQaTasks!.map(t => {
                      const st = taskStatus(t);
                      return (
                        <div key={t.id} className="flex items-center justify-between gap-2.5">
                          <div className="min-w-0">
                            <span className="text-xs font-medium text-foreground">CR {t.crNumber}</span>
                            <span className="text-xs text-subtle-foreground"> · {CYCLE_LABEL[t.cycle.cycleType] ?? t.cycle.cycleType}</span>
                          </div>
                          <span className="whitespace-nowrap text-xs font-semibold" style={{ color: st.color }}>{st.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* ── Defects I reported + TARGET defects assigned to me — same
                card, not a separate one, since it's all "my QA work today". ── */}
            {(defectStats || (targetDefectGroups?.length ?? 0) > 0) && (() => {
              const targetAll = (targetDefectGroups ?? []).flatMap(g => g.defects);
              const targetTotal = targetAll.length;
              const targetOpen = targetAll.filter(d => !['Closed', 'Canceled'].includes(d.status)).length;
              return (
                <div className="mt-3.5 border-t border-border pt-3.5">
                  <div className="mb-2.5 text-xs font-bold text-muted-foreground">🪲 התקלות שלי</div>
                  {defectStats && (
                    <>
                      {defectStats.tooFew && (
                        <div className="mb-2.5 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning" style={{ border: `1px solid ${C.warning}33` }}>
                          ⚠ פתחת {defectStats.opened} תקלות מתוך כ-{defectStats.expectedMin} צפויות (לפי היקף הפיתוח של ה-CR-ים שאתה בודק) — כדאי לבדוק אם יש עוד תקלות שטרם דווחו.
                        </div>
                      )}
                      <div className="flex">
                        {[
                          { value: defectStats.opened, label: 'תקלות שפתחתי', color: C.textPrimary, bucket: 'opened' },
                          { value: defectStats.stillOpen, label: 'עדיין פתוחות', color: defectStats.stillOpen > 0 ? C.warning : C.textPrimary, bucket: 'stillOpen' },
                          { value: defectStats.waitingForMyVerification, label: 'ממתינות לבדיקתי', color: defectStats.waitingForMyVerification > 0 ? C.brand : C.textPrimary, bucket: 'waitingForVerification' },
                        ].map((s, i) => (
                          <div
                            key={s.label}
                            onClick={() => s.value > 0 && openDefectDrilldown(s.label, s.bucket)}
                            className={`flex-1 px-2 text-center ${i > 0 ? 'border-s border-border' : ''} ${s.value > 0 ? 'cursor-pointer' : ''}`}
                          >
                            <div className="text-xl font-bold leading-tight" style={{ color: s.color }}>{s.value}</div>
                            <div className="mt-1 text-xs text-subtle-foreground">{s.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* ── Stale verifications (spec 2026-09-29) ── */}
                      {defectStats.staleVerifications.length > 0 && (
                        <div className="mt-2.5 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger" style={{ border: `1px solid ${C.danger}33` }}>
                          ⏰ {defectStats.staleVerifications.length} תקלות ממתינות לבדיקתך מעבר לסף: {defectStats.staleVerifications.slice(0, 3).map(d => `#${d.id} (${d.daysWaiting}י׳)`).join(', ')}
                          {defectStats.staleVerifications.length > 3 ? ` ועוד ${defectStats.staleVerifications.length - 3}` : ''}
                        </div>
                      )}

                      {/* ── Under-covered CRs (spec 2026-09-29) — scenario count vs
                          dev-effort days, SCENARIOS_PER_DEV_DAY=2 ── */}
                      {defectStats.underCoveredCrs.length > 0 && (
                        <div className="mt-2.5 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning" style={{ border: `1px solid ${C.warning}33` }}>
                          <div className="mb-1 font-semibold">📉 כיסוי תרחישים חסר ביחס להיקף הפיתוח:</div>
                          {defectStats.underCoveredCrs.map(cr => (
                            <div key={cr.crNumber}>
                              CR {cr.crNumber}{cr.crLabel ? ` — ${cr.crLabel}` : ''}: {cr.scenarioCount} מתוך {cr.expectedMinScenarios} תרחישים צפויים ({cr.devDays} ימי פיתוח)
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {targetTotal > 0 && (
                    <div
                      onClick={onGoToQaTasks}
                      className={`text-xs text-subtle-foreground ${defectStats ? 'mt-2.5' : 'mt-0'} ${onGoToQaTasks ? 'cursor-pointer hover:text-foreground' : ''}`}
                    >
                      🎯 {targetTotal} תקלות TARGET משויכות אליי · {targetOpen} עדיין פתוחות
                      {onGoToQaTasks && <span className="font-semibold text-primary"> — לרשימה המלאה ←</span>}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* ── Next actions ── */}
      {actions.length > 0 && (
        <div className="rounded-lg border border-border bg-card px-5 py-[18px]">
          <div className="mb-1 text-sm font-bold text-foreground">📌 הפעולות הבאות שלך</div>
          <div className="mb-2 text-xs text-subtle-foreground">מה מומלץ לבדוק עכשיו</div>
          {actions.map((a, i) => <ActionItem key={i} {...a} />)}
        </div>
      )}

      {drilldown && (
        <DefectDrilldownModal
          token={token}
          screen=""
          filter=""
          endpoint={drilldown.endpoint}
          title={drilldown.title}
          onClose={() => setDrilldown(null)}
        />
      )}

      {runbookItem && primary && (
        <RunbookModal
          trigger={runbookItem.trigger}
          dateStartISO={runbookItem.dateStartISO}
          versionId={primary.id}
          token={token}
          startInRunMode
          onClose={() => setRunbookItem(null)}
        />
      )}
    </div>
  );
};
