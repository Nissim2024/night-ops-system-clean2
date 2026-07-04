import React from 'react';
import { VersionProgressChain } from './VersionProgressChain';
import { C, FONT, TEXT, WEIGHT, RADIUS, SHADOW, EASE } from '../theme';
import { RUNBOOKS } from './qa/RunbookModal';

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
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', flex: 1 }}>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
      {delta && <div style={{ ...TEXT.xs, color: deltaColor ?? C.textMuted, marginTop: '6px' }}>{delta}</div>}
    </div>
  );
}

function ActionItem({ icon, title, desc, urgent, onClick }: { icon: string; title: string; desc: string; urgent?: boolean; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '10px',
        padding: '10px 0', borderBottom: `1px solid ${C.border}`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{ fontSize: '17px', flexShrink: 0, marginTop: '1px' }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.medium, color: urgent ? C.danger : C.textPrimary }}>{title}</div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px' }}>{desc}</div>
      </div>
      {onClick && <span style={{ ...TEXT.xs, color: C.brand, fontWeight: WEIGHT.semibold, flexShrink: 0, marginTop: '2px' }}>←</span>}
    </div>
  );
}

interface Props {
  fullName: string;
  activeVersion: any | null;
  planningVersion: any | null;
  taskStats: { done: number; inProgress: number; open: number; waiting: number; blocked: number; total: number };
  seasonReminder: { id: string; name: string } | null;
  teamName?: string | null;
  myRunbookSteps?: { runbookId: string; stepIndex: number; startTime: string; runDate: string; team: string }[];
  onGoToTasks: () => void;
  onGoToLeaves: () => void;
  onOpenFocusMode: () => void;
}

export const EmployeeHomeView: React.FC<Props> = ({
  fullName, activeVersion, planningVersion, taskStats, seasonReminder, teamName,
  myRunbookSteps, onGoToTasks, onGoToLeaves, onOpenFocusMode,
}) => {
  const firstName = fullName.split(' ')[0] || fullName;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'שלום' : hour < 21 ? 'ערב טוב' : 'לילה טוב';

  const primary = activeVersion ?? planningVersion;
  const ph = primary ? (PHASE_META[primary.status] ?? PHASE_META['DRAFT']) : null;
  const isLiveNow = activeVersion && ['ACTIVE', 'REHEARSAL'].includes(activeVersion.status);

  const actions: { icon: string; title: string; desc: string; urgent?: boolean; onClick: () => void }[] = [];
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* ── Greeting ── */}
      <div>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{greeting}, {firstName} 👋</div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '1px' }}>
          {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          {teamName && <> · {teamName}</>}
        </div>
      </div>

      {/* ── Hero banner ── */}
      {primary && ph ? (
        <div style={{
          background: ph.bg, border: `1.5px solid ${ph.color}30`, borderRadius: RADIUS.lg,
          padding: '20px 24px', display: 'flex', alignItems: 'center', gap: '20px',
        }}>
          <span style={{ fontSize: '36px', flexShrink: 0 }}>{ph.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '28px', fontWeight: WEIGHT.bold, color: ph.color, lineHeight: 1.1, marginBottom: '4px', letterSpacing: '-0.01em' }}>
              {primary.name}
            </div>
            <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: ph.color, opacity: 0.85, marginBottom: '6px' }}>{ph.icon} {ph.label}</div>
            <div style={{ ...TEXT.xs, color: C.textSecondary }}>{ph.desc}</div>
          </div>
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
            {isLiveNow ? (
              <button
                onClick={onOpenFocusMode}
                style={{ background: ph.color, color: 'white', border: 'none', borderRadius: RADIUS.md, padding: '10px 20px', ...TEXT.sm, fontWeight: WEIGHT.semibold, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' as const }}
              >
                ⚡ המשימות שלי
              </button>
            ) : (
              <button
                onClick={onGoToTasks}
                style={{ background: 'transparent', color: ph.color, border: `1px solid ${ph.color}55`, borderRadius: RADIUS.md, padding: '7px 16px', ...TEXT.xs, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' as const }}
              >
                פרטי גרסה
              </button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '32px' }}>🌙</span>
          <div>
            <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>אין פעילות פעילה הלילה</div>
            <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px' }}>אין גרסה פעילה כעת. המתן להנחיות מנהל הלילה.</div>
          </div>
        </div>
      )}

      {/* ── Progress chain ── */}
      {primary && !isLiveNow && <VersionProgressChain versionStatus={primary.status} />}

      {/* ── Stats row (only while a run is actually live) ── */}
      {isLiveNow && (
        <div style={{ display: 'flex', gap: '12px' }}>
          <StatCard value={`${taskStats.done}/${taskStats.total}`} label="התקדמות כללית" deltaColor={C.success} delta={taskStats.total > 0 ? `${Math.round((taskStats.done / taskStats.total) * 100)}%` : undefined} />
          <StatCard value={String(taskStats.open)} label="פתוחות" />
          <StatCard value={String(taskStats.inProgress)} label="בביצוע" deltaColor={C.warning} />
          <StatCard value={String(taskStats.blocked)} label="חסומות" deltaColor={taskStats.blocked > 0 ? C.danger : undefined} />
        </div>
      )}

      {/* ── Next actions ── */}
      {actions.length > 0 && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '18px 20px' }}>
          <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '4px' }}>📌 הפעולות הבאות שלך</div>
          <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '8px' }}>מה מומלץ לבדוק עכשיו</div>
          {actions.map((a, i) => <ActionItem key={i} {...a} />)}
        </div>
      )}
    </div>
  );
};
