import React, { useMemo, useState, useEffect } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, RADIUS, SHADOW, EASE } from '../theme';
import { VersionStatusChip } from './ui';
import RunbookModal, { RUNBOOKS, getRunbookTrigger, RunbookTrigger } from './qa/RunbookModal';

const API = process.env.REACT_APP_API_URL ?? 'http://localhost:3000';

interface TeamStatusRow {
  teamId: string;
  teamName: string;
  total: number;
  draft: number;
  submitted: number;
  returned: number;
  approved: number;
  allDone: boolean;
}

interface Props {
  versions: any[];
  role: string;
  fullName: string;
  token: string;
  onSelectVersion: (id: string, tab?: string) => void;
  onNewVersion?: () => void;
  onSwitchToQa?: () => void;
  canAccessQa?: boolean;
  onGoToLeaves?: () => void;
}

const STATUS_PRIORITY: Record<string, number> = {
  ACTIVE: 0, REHEARSAL: 1, MORNING_AFTER: 2,
  APPROVED: 3, REVIEW: 4, REFINING: 5, CR_REVIEW: 6,
  COLLECTING: 7, DRAFT: 8, COMPLETED: 9, ROLLED_BACK: 10,
};

const PHASE_META: Record<string, {
  label: string; icon: string; color: string; bg: string;
  desc: (role: string) => string;
  cta: (role: string) => string;
  ctaTab: string | ((role: string) => string);
  pulse?: boolean;
}> = {
  DRAFT:        { label: 'שלב טיוטה',          icon: '📋', color: '#4573D2', bg: 'rgba(69,115,210,0.07)',    desc: r => isRm(r) ? 'הגדר לוח זמנים, תכולה ומסגרת הגרסה.' : 'ממתין לפתיחת שלב האיסוף.',               cta: r => isRm(r) ? 'הגדר גרסה' : 'ראה פרטים',       ctaTab: 'list' },
  COLLECTING:   { label: 'איסוף משימות',        icon: '📝', color: '#9C6ADE', bg: 'rgba(156,106,222,0.07)', desc: r => r === 'TEAM_LEAD' ? 'הגש את הצעות המשימות לאישור.' : isRm(r) ? 'עקב אחר שיבוץ הצוותים.'  : 'בדוק אם שובצת למשימות.',                     cta: r => r === 'TEAM_LEAD' ? 'הגש תוכניות' : 'ראה סטטוס', ctaTab: 'proposals' },
  // Managers review CR plans on the version detail page itself (team-status grid + CR list) — the
  // separate implementation-plans screen is redundant for them. Team leads still use it to submit.
  CR_REVIEW:    { label: 'סקירת CR',             icon: '🔍', color: '#E8AF00', bg: 'rgba(232,175,0,0.07)',   desc: r => r === 'TEAM_LEAD' ? 'יש להגיש תוכנית CR לאישור.' : 'צוותים מגישים תוכניות עלייה לאוויר.', cta: r => r === 'TEAM_LEAD' ? 'הגש תוכנית CR' : 'סקור תוכניות', ctaTab: r => r === 'TEAM_LEAD' ? 'implementation-plans' : 'list' },
  REFINING:     { label: 'טיוב תוכנית',         icon: '✏️', color: '#E8AF00', bg: 'rgba(232,175,0,0.07)',   desc: () => 'שלב טיוב ועדכון תוכניות לאחר הסקירה.',                                                     cta: () => 'פרטי גרסה',            ctaTab: 'list' },
  REVIEW:       { label: 'ישיבת מעבר',          icon: '👥', color: '#4573D2', bg: 'rgba(69,115,210,0.07)',   desc: () => 'ישיבת מעבר עם כלל המשתתפים לאישור סופי.',                                                 cta: () => 'פרטי גרסה',            ctaTab: 'list' },
  APPROVED:     { label: 'תוכנית מאושרת',       icon: '✅', color: '#37C47A', bg: 'rgba(55,196,122,0.07)',   desc: () => 'התוכנית אושרה. ממתינים לחזרה הגנרלית.',                                                    cta: () => 'פרטי גרסה',            ctaTab: 'list' },
  REHEARSAL:    { label: 'חזרה גנרלית פעילה',   icon: '🎭', color: '#8b5cf6', bg: 'rgba(139,92,246,0.07)',   desc: () => 'החזרה הגנרלית בביצוע. עקב אחרי התקדמות הצוותים.',                                         cta: () => 'כנס ל-War Room',       ctaTab: 'dashboard', pulse: true },
  ACTIVE:       { label: 'עלייה לאוויר — לייב', icon: '🚀', color: '#F06A6A', bg: 'rgba(240,106,106,0.07)', desc: () => 'עלייה לאוויר פעילה. מעקב בזמן אמת אחרי כלל הצוותים.',                                    cta: () => 'War Room',             ctaTab: 'dashboard', pulse: true },
  MORNING_AFTER:{ label: 'בוקר שלאחר',          icon: '🌅', color: '#F0883E', bg: 'rgba(240,136,62,0.07)',   desc: () => 'שלב בקרות הבוקר. ודא שכל הבדיקות הושלמו.',                                                cta: () => 'לוח בקרה',             ctaTab: 'dashboard', pulse: true },
  COMPLETED:    { label: 'הושלם',               icon: '🏁', color: '#37C47A', bg: 'rgba(55,196,122,0.07)',   desc: () => 'הגרסה הושלמה בהצלחה.',                                                                    cta: () => 'ראה סיכום',            ctaTab: 'summary-night' },
  ROLLED_BACK:  { label: 'Rollback בוצע',       icon: '⏪', color: '#F06A6A', bg: 'rgba(240,106,106,0.07)', desc: () => 'בוצעה חזרה אחורה.',                                                                        cta: () => 'ראה פרטים',            ctaTab: 'list' },
};

function isRm(r: string) { return ['RELEASE_MANAGER', 'ADMIN'].includes(r); }



// ────────────────────────────────────────────────────────────────
// Stat card
// ────────────────────────────────────────────────────────────────
function StatCard({ value, label, delta, deltaColor }: { value: string; label: string; delta?: string; deltaColor?: string }) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', flex: 1 }}>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
      {delta && <div style={{ ...TEXT.xs, color: deltaColor ?? C.textMuted, marginTop: '6px' }}>{delta}</div>}
    </div>
  );
}

interface QaSummary { totalCrs: number; assignedCrs: number; hasWorkPlan: boolean; }

// ────────────────────────────────────────────────────────────────
// Version row (compact)
// ────────────────────────────────────────────────────────────────
function VersionRow({ v, isPrimary, onSelect, qaSummary, role }: { v: any; isPrimary: boolean; onSelect: (id: string, tab?: string) => void; qaSummary?: QaSummary | null; role: string }) {
  const ph = PHASE_META[v.status] ?? PHASE_META['DRAFT'];
  const isTrulyLive = ['ACTIVE', 'REHEARSAL'].includes(v.status);
  const isMorningAfter = v.status === 'MORNING_AFTER';
  const resolvedCtaTab = typeof ph.ctaTab === 'function' ? ph.ctaTab(role) : ph.ctaTab;
  return (
    <div
      onClick={() => onSelect(v.id, resolvedCtaTab)}
      style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '10px 14px', borderRadius: RADIUS.md, cursor: 'pointer',
        background: isPrimary ? `${ph.color}09` : 'transparent',
        border: `1px solid ${isPrimary ? ph.color + '30' : C.border}`,
        marginBottom: '6px', transition: EASE.fast,
      }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = isPrimary ? `${ph.color}14` : C.bgHover}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = isPrimary ? `${ph.color}09` : 'transparent'}
    >
      <span style={{ fontSize: '17px', flexShrink: 0 }}>{ph.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, display: 'flex', alignItems: 'center', gap: '6px' }}>
          {v.name}
          {isTrulyLive && <span style={{ fontSize: '11px', background: C.danger, color: 'white', borderRadius: '10px', padding: '1px 6px', fontWeight: WEIGHT.bold, letterSpacing: '0.05em', animation: 'home-pulse 2s ease-in-out infinite' }}>LIVE</span>}
          {isMorningAfter && <span style={{ fontSize: '11px', background: '#F0883E', color: 'white', borderRadius: '10px', padding: '1px 6px', fontWeight: WEIGHT.bold, letterSpacing: '0.05em' }}>בוקר</span>}
        </div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '1px' }}>{ph.label}</div>
      </div>
      {qaSummary && qaSummary.totalCrs > 0 && (
        <span style={{ ...TEXT.xs, color: '#7c3aed', background: 'rgba(124,58,237,0.08)', borderRadius: '10px', padding: '2px 7px', flexShrink: 0, whiteSpace: 'nowrap' as const }}>
          🧪 {qaSummary.assignedCrs}/{qaSummary.totalCrs}
        </span>
      )}
      <VersionStatusChip status={v.status} size="xs" />
      <span style={{ ...TEXT.xs, color: ph.color, fontWeight: WEIGHT.medium, flexShrink: 0 }}>פתח ←</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Next action item
// ────────────────────────────────────────────────────────────────
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
      {urgent && <span style={{ ...TEXT.xs, color: C.danger, fontWeight: WEIGHT.semibold, flexShrink: 0, marginTop: '2px' }}>⚠ דחוף</span>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Empty state
// ────────────────────────────────────────────────────────────────
function EmptyState({ canCreate, onNewVersion }: { canCreate: boolean; onNewVersion?: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', gap: '16px', flex: 1 }}>
      <span style={{ fontSize: '52px' }}>📦</span>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: C.textPrimary }}>אין גרסאות פעילות</div>
      <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', maxWidth: '340px', lineHeight: 1.6 }}>
        {canCreate ? 'לא קיימות גרסאות פעילות. צור גרסה חדשה כדי להתחיל תהליך.' : 'פנה למנהל הגרסה לפתיחת גרסה.'}
      </div>
      {canCreate && (
        <button
          onClick={onNewVersion}
          style={{ marginTop: '8px', background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, padding: '10px 24px', ...TEXT.sm, fontWeight: WEIGHT.semibold, cursor: 'pointer', fontFamily: FONT }}
        >
          + פתח גרסה חדשה
        </button>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────
const CR_REVIEW_STAGES = ['CR_REVIEW', 'REFINING', 'REVIEW'];

export const HomeDashboard: React.FC<Props> = ({ versions, role, fullName, token, onSelectVersion, onNewVersion, onSwitchToQa, canAccessQa, onGoToLeaves }) => {
  const canCreate = isRm(role);
  const canManageLeaves = ['ADMIN', 'TEAM_LEAD'].includes(role);

  const [pendingLeaveCount, setPendingLeaveCount] = useState(0);
  const [teamStatus, setTeamStatus] = useState<TeamStatusRow[]>([]);
  const [teamStatusLoading, setTeamStatusLoading] = useState(false);
  const [myTeamSummary, setMyTeamSummary] = useState<{ total: number; ready: number; draft: number } | null>(null);
  const [qaSummary, setQaSummary] = useState<QaSummary | null>(null);
  const [livePhases, setLivePhases] = useState<{ name: string; done: number; total: number; state: 'done' | 'active' | 'upcoming' }[]>([]);
  const [nextPhaseInfo, setNextPhaseInfo] = useState<{ name: string; startTime?: string | null } | null>(null);
  const [firstPhaseInfo, setFirstPhaseInfo] = useState<{ name: string; startTime?: string | null } | null>(null);
  const [estimateStats, setEstimateStats] = useState<{
    totalEstimateDays: number;
    qaFilteredEstimateDays: number;
    byTeam: { teamId: string; teamName: string; totalDays: number; qaFilteredDays: number; crs: { crNumber: string; crLabel: string; teamDays: number; hasQa: boolean }[] }[];
  } | null>(null);
  const [estimateDrillOpen, setEstimateDrillOpen] = useState(false);
  const [estimateQaFilter, setEstimateQaFilter] = useState(false);
  const [estimateExpandedTeam, setEstimateExpandedTeam] = useState<string | null>(null);

  // Pick the most urgent non-archived version
  const activeVersions = useMemo(
    () => versions.filter(v => !v.isArchived).sort((a, b) => (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99)),
    [versions]
  );
  const inProgressVersions = activeVersions.filter(v => !['COMPLETED', 'ROLLED_BACK'].includes(v.status));
  // primary = first version still in progress; when all are done → allDone state
  const primary = inProgressVersions[0] ?? null;
  const others  = inProgressVersions.slice(1);
  const allDone = activeVersions.length > 0 && inProgressVersions.length === 0;

  const firstName = fullName.split(' ')[0] || fullName;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'שלום' : hour < 21 ? 'ערב טוב' : 'לילה טוב';

  const isLiveNow = primary && ['ACTIVE', 'REHEARSAL'].includes(primary.status);
  const isMorningAfterNow = primary?.status === 'MORNING_AFTER';

  const myUserId = (() => { try { return JSON.parse(atob(token.split('.')[1])).sub; } catch { return null; } })();

  const [upcomingRunbookSteps, setUpcomingRunbookSteps] = useState<{
    runbookId: string; stepIndex: number; employee: string; employeeUserId: string | null;
    startTime: string; endTime: string; runDate: string; team: string; status: string;
  }[]>([]);

  useEffect(() => {
    if (!primary?.id) { setUpcomingRunbookSteps([]); return; }
    axios.get(`${API}/runbook/${primary.id}/upcoming`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setUpcomingRunbookSteps(res.data ?? []))
      .catch(() => setUpcomingRunbookSteps([]));
  }, [primary?.id, token]);

  // All activity-board entries for the version — QA-module access (where the
  // activities board normally lives) is gated to QA-team-members/admin only,
  // so RELEASE_MANAGER has no other way to see these otherwise. Any entry
  // scheduled today/tomorrow is surfaced under "your next actions"; ones that
  // also map to a runbook (refresh/version-transfer activities) get a direct
  // "launch" link that opens straight into run mode.
  const [activityBoard, setActivityBoard] = useState<{
    activityKey: string; label: string; owner: string; ownerEmployee: string;
    dateStart: string | null; dateEnd: string | null;
  }[]>([]);
  const [runbookItem, setRunbookItem] = useState<{ trigger: RunbookTrigger; dateStartISO: string } | null>(null);

  useEffect(() => {
    if (!primary?.id || !isRm(role)) { setActivityBoard([]); return; }
    axios.get(`${API}/activity-board/${primary.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setActivityBoard(res.data ?? []))
      .catch(() => setActivityBoard([]));
  }, [primary?.id, role, token]);

  const todayOrTomorrowActivities = activityBoard.filter(a => {
    if (!a.dateStart) return false;
    const d = new Date(a.dateStart).toDateString();
    const todayStr = new Date().toDateString();
    const tomorrowStr = new Date(Date.now() + 86400000).toDateString();
    return d === todayStr || d === tomorrowStr;
  });

  const TEAM_STATUS_STAGES = ['COLLECTING', ...CR_REVIEW_STAGES];
  const showTeamStatus = isRm(role) && primary && TEAM_STATUS_STAGES.includes(primary.status);
  const isCollecting   = primary?.status === 'COLLECTING';

  useEffect(() => {
    if (!showTeamStatus || !primary) { setTeamStatus([]); return; }
    setTeamStatusLoading(true);
    const url = isCollecting
      ? `${API}/task-proposals/version/${primary.id}/team-status`
      : `${API}/cr-plans/version/${primary.id}/team-status`;
    axios.get(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setTeamStatus(r.data))
      .catch(() => setTeamStatus([]))
      .finally(() => setTeamStatusLoading(false));
  }, [primary?.id, primary?.status, showTeamStatus, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch team lead's own submission summary when in DRAFT/COLLECTING/CR_REVIEW
  const isTl = role === 'TEAM_LEAD';
  const showMyTeamWarning = isTl && primary && ['DRAFT', 'COLLECTING', 'CR_REVIEW'].includes(primary.status);
  useEffect(() => {
    if (!showMyTeamWarning || !primary) { setMyTeamSummary(null); return; }
    const url = primary.status === 'COLLECTING'
      ? `${API}/task-proposals/version/${primary.id}/my-team-summary`
      : `${API}/cr-plans/version/${primary.id}/team-status`; // team lead sees only their team via this endpoint
    axios.get(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (primary.status === 'COLLECTING') {
          setMyTeamSummary(r.data);
        } else {
          // cr-plans endpoint returns array; take first row (team lead's own team)
          const row = (r.data as any[])[0];
          setMyTeamSummary(row ? { total: row.total, ready: row.submitted, draft: row.draft } : null);
        }
      })
      .catch(() => setMyTeamSummary(null));
  }, [primary?.id, primary?.status, showMyTeamWarning, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pending leave requests needing this manager's attention (ADMIN: all; TEAM_LEAD: own team only)
  useEffect(() => {
    if (!canManageLeaves) { setPendingLeaveCount(0); return; }
    axios.get(`${API}/leaves/requests/pending-count`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setPendingLeaveCount(r.data ?? 0))
      .catch(() => setPendingLeaveCount(0));
  }, [canManageLeaves, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch QA summary for primary version (accessible to all authenticated users via /qa-stats)
  useEffect(() => {
    if (!canAccessQa || !primary) { setQaSummary(null); return; }
    axios.get(`${API}/qa-stats/summary?versionId=${primary.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setQaSummary(r.data))
      .catch(() => setQaSummary(null));
  }, [canAccessQa, primary?.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch CR investment estimate stats; if empty, auto-sync from Excel then re-fetch
  useEffect(() => {
    if (!primary) { setEstimateStats(null); return; }
    const headers = { Authorization: `Bearer ${token}` };
    const statsUrl = `${API}/version-cr-assignments/version/${primary.id}/stats`;
    axios.get(statsUrl, { headers })
      .then(r => {
        const data = r.data ?? null;
        if (data && (data.crCount === 0 || data.crCount == null)) {
          // No assignments yet — trigger background sync then re-fetch
          return axios.post(`${API}/version-cr-assignments/version/${primary.id}/sync`, {}, { headers })
            .then(() => axios.get(statsUrl, { headers }))
            .then(r2 => setEstimateStats(r2.data ?? null))
            .catch(() => setEstimateStats(data));
        }
        setEstimateStats(data);
      })
      .catch(() => setEstimateStats(null));
  }, [primary?.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch phase progress when version is ACTIVE or REHEARSAL
  useEffect(() => {
    if (!primary || !['ACTIVE', 'REHEARSAL'].includes(primary.status)) { setLivePhases([]); setNextPhaseInfo(null); return; }
    axios.get(`${API}/versions/${primary.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        const phases = [...(res.data.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
        let foundActive = false;
        let lastTouchedOrderIndex: number | null = null; // last phase with at least one activated (non-WAITING) task, done or not
        const result = phases
          .map((ph: any) => {
            const tasks = (ph.subPhases || []).flatMap((sp: any) => sp.tasks || []);
            const nightTasks = tasks.filter((t: any) => t.status !== 'WAITING');
            const done = nightTasks.filter((t: any) => ['DONE', 'FAILED', 'ROLLED_BACK'].includes(t.status)).length;
            const total = nightTasks.length;
            // Skip phases with no activated tasks (all WAITING — not part of this night)
            if (total === 0) return null;
            lastTouchedOrderIndex = ph.orderIndex;
            let state: 'done' | 'active' | 'upcoming';
            if (done === total) {
              state = 'done';
            } else if (!foundActive) {
              foundActive = true;
              state = 'active';
            } else {
              state = 'upcoming';
            }
            return { name: ph.name, done, total, state };
          })
          .filter(Boolean) as { name: string; done: number; total: number; state: 'done' | 'active' | 'upcoming' }[];
        setLivePhases(result);

        // Next phase to come — the first one after the last touched phase, whether
        // that's still in progress or (once it's fully done) not yet started at all.
        // Start time comes from the earliest task in that phase (rehearsal-aware),
        // not Phase.plannedStart, which only ever reflects the production schedule.
        const nextPhase = lastTouchedOrderIndex !== null
          ? phases.find((ph: any) => ph.orderIndex > (lastTouchedOrderIndex as number))
          : undefined;
        if (nextPhase) {
          const nextTasks = (nextPhase.subPhases || []).flatMap((sp: any) => sp.tasks || []);
          const times = nextTasks
            .map((t: any) => t.rehearsalPlannedStart ?? t.plannedStart)
            .filter(Boolean)
            .map((d: any) => new Date(d).getTime());
          setNextPhaseInfo({ name: nextPhase.name, startTime: times.length ? new Date(Math.min(...times)).toISOString() : null });
        } else {
          setNextPhaseInfo(null);
        }
      })
      .catch(() => { setLivePhases([]); setNextPhaseInfo(null); });
  }, [primary?.id, primary?.status, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the first phase's name + start time for the "פתח לילה פעיל" action —
  // nothing has run yet at APPROVED, so this uses the phase's own plannedStart
  // (the production schedule), not a task-derived time like the in-run views do.
  useEffect(() => {
    if (!primary || primary.status !== 'APPROVED') { setFirstPhaseInfo(null); return; }
    axios.get(`${API}/versions/${primary.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        const phases = [...(res.data.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
        const first = phases[0];
        setFirstPhaseInfo(first ? { name: first.name, startTime: first.plannedStart ?? null } : null);
      })
      .catch(() => setFirstPhaseInfo(null));
  }, [primary?.id, primary?.status, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warning logic helpers
  const WARN_HOURS = 48;
  const reviewMeetingTime = primary?.reviewMeetingTime ? new Date(primary.reviewMeetingTime) : null;
  const hoursUntilReview  = reviewMeetingTime ? (reviewMeetingTime.getTime() - Date.now()) / 3_600_000 : null;
  const reviewIsApproaching = hoursUntilReview !== null && hoursUntilReview > 0 && hoursUntilReview <= WARN_HOURS;
  const reviewHoursLabel = hoursUntilReview !== null && hoursUntilReview > 0
    ? hoursUntilReview < 1 ? 'פחות משעה' : `${Math.round(hoursUntilReview)} שעות`
    : null;

  // Build role-specific action list based on primary version state
  const actions = useMemo(() => {
    if (!primary) return [];
    const st = primary.status;
    const rm = isRm(role);
    const tl = role === 'TEAM_LEAD';
    const list: { icon: string; title: string; desc: string; urgent?: boolean; tab?: string; onClick?: () => void }[] = [];

    if (canManageLeaves && pendingLeaveCount > 0) {
      list.push({
        icon: '🏖', title: `${pendingLeaveCount} בקשות חופשה ממתינות לאישור`,
        desc: 'עובדים הגישו בקשות חופשה שממתינות לטיפולך', urgent: true,
        onClick: onGoToLeaves,
      });
    }

    if (st === 'DRAFT' && rm) {
      const hasDates = !!(primary.integrationStart && primary.integrationEnd && primary.qaStart && primary.qaEnd);
      if (!hasDates) {
        list.push({ icon: '📅', title: 'קבע תאריכי גרסה', desc: 'הגדר תאריכי אינטגרציה ו-QA לפני בניית תוכנית ההטמעה', tab: 'version-detail' });
      } else {
        list.push({ icon: '📋', title: 'בנה תוכנית הטמעה', desc: 'החל תבנית על הגרסה ובנה את לוח הזמנים', tab: 'version-detail' });
      }
    }
    if (st === 'COLLECTING' && tl)      list.push({ icon: '📝', title: 'הגש תוכניות', desc: 'הגש את הצעות המשימות לאישור', urgent: true, tab: 'proposals' });
    if (st === 'COLLECTING' && rm)      list.push({ icon: '👥', title: 'מעקב הגשת תוכניות', desc: 'בדוק שכל הצוותים הגישו את תוכניות ה-CR', tab: 'proposals' });
    if (st === 'CR_REVIEW' && tl) {
      const deadline = (primary as any).submissionDeadline;
      const deadlineDesc = deadline
        ? ` — מועד הגשה: ${new Date(deadline).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${new Date(deadline) < new Date() ? ' ⚠ עבר' : ''}`
        : '';
      list.push({ icon: '📋', title: 'הגש תוכנית CR', desc: `הגדר תוכנית עלייה לאוויר לצוות שלך${deadlineDesc}`, urgent: true, tab: 'implementation-plans' });
    }
    if (st === 'CR_REVIEW' && rm)       list.push({ icon: '🔍', title: 'סקור תוכניות CR', desc: 'אשר או החזר הערות על תוכניות הצוותים', tab: 'list' });
    if (st === 'REFINING' && rm)        list.push({ icon: '✏️', title: 'ודא עדכוני תוכניות', desc: 'צוותים מעדכנים לפי הערות', tab: 'list' });
    if (st === 'REVIEW' && rm)          list.push({ icon: '👥', title: 'קיים ישיבת מעבר', desc: 'ישיבה עם כלל המשתתפים לאישור סופי', tab: 'list' });
    if (st === 'APPROVED' && rm) {
      if (primary.rehearsalSummary) {
        const dateStr = primary.plannedStart
          ? new Date(primary.plannedStart).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
          : null;
        const timeStr = primary.plannedStart
          ? new Date(primary.plannedStart).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
          : null;
        const dateTimeDesc = dateStr && timeStr ? ` — מתוכנן ל-${dateStr}, ${timeStr}` : '';
        const firstPhaseDesc = firstPhaseInfo
          ? ` · שלב ראשון: ${firstPhaseInfo.name}${firstPhaseInfo.startTime ? ` (${new Date(firstPhaseInfo.startTime).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })})` : ''}`
          : '';
        list.push({ icon: '🚀', title: 'פתח לילה פעיל', desc: `החזרה הגנרלית הושלמה — מוכן להתחיל את הלילה הפעיל${dateTimeDesc}${firstPhaseDesc}`, tab: 'list' });
      } else {
        list.push({ icon: '🎭', title: 'פתח חזרה גנרלית', desc: 'הרץ את התוכנית המאושרת כחזרה', tab: 'list' });
      }
    }
    // All activated phases done, nothing left queued up next — the run itself is
    // finished even though the version hasn't been formally closed yet.
    const allPhasesDone = livePhases.length > 0 && livePhases.every(p => p.state === 'done') && !nextPhaseInfo;

    if (['REHEARSAL', 'ACTIVE'].includes(st) && !allPhasesDone) {
      const nextDesc = nextPhaseInfo
        ? `שלב הבא: ${nextPhaseInfo.name}${nextPhaseInfo.startTime ? ` יחל בשעה ${new Date(nextPhaseInfo.startTime).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : ''}`
        : 'עקב אחר ביצוע המשימות בזמן אמת';
      list.push({ icon: '⚡', title: 'War Room', desc: nextDesc, urgent: true, tab: 'dashboard' });
    }
    if (st === 'REHEARSAL' && allPhasesDone && rm) {
      list.push({ icon: '🎭', title: 'החזרה הגנרלית הושלמה', desc: 'הפק דוח סיכום חזרה גנרלית וסיים אותה כדי לפתוח את הלילה הפעיל', urgent: true, tab: 'summary-rehearsal' });
    }
    if (st === 'ACTIVE' && allPhasesDone && rm) {
      list.push({ icon: '✅', title: 'ליל ההטמעה הושלם', desc: 'כל המשימות בוצעו — עבור לבקרות הבוקר ולסגירת הגרסה', urgent: true, tab: 'summary-night' });
    }
    if (st === 'MORNING_AFTER' && rm)   list.push({ icon: '🌅', title: 'אשר בקרות בוקר', desc: 'ודא השלמת כל הבדיקות ואשר סיום', urgent: true, tab: 'dashboard' });
    if (st === 'MORNING_AFTER' && rm)   list.push({ icon: '📄', title: 'הכן דוח סיכום', desc: 'צור וסכם את פעילות הלילה', urgent: true, tab: 'summary-night' });

    // Runbook steps happening today/tomorrow — visible to team leads, admin,
    // release manager, and the specific employee assigned to that step.
    const todayStr = new Date().toDateString();
    const tomorrowStr = new Date(Date.now() + 86400000).toDateString();
    for (const step of upcomingRunbookSteps) {
      const isMine = !!myUserId && step.employeeUserId === myUserId;
      if (!rm && !tl && !isMine) continue;
      const def = RUNBOOKS[step.runbookId];
      const stepDef = def?.steps[step.stepIndex];
      if (!stepDef) continue;
      const stepDate = new Date(step.runDate).toDateString();
      const dayLabel = stepDate === todayStr ? 'היום' : stepDate === tomorrowStr ? 'מחר' : null;
      if (!dayLabel) continue;
      list.push({
        icon: '🛠',
        title: `${stepDef.activity} — ${dayLabel} ${step.startTime}`,
        desc: `${step.team || stepDef.defaultTeam}${step.employee ? ` · ${step.employee}` : ''}${isMine ? ' · המשימה שלך' : ''}`,
        urgent: dayLabel === 'היום',
        onClick: onSwitchToQa,
      });
    }

    // Every activity-board entry scheduled today/tomorrow — release manager/
    // admin only (activity board access is otherwise QA-module gated). Ones
    // that map to a runbook get a direct "launch" link into run mode.
    if (rm) {
      for (const a of todayOrTomorrowActivities) {
        const trigger = getRunbookTrigger(a.activityKey);
        const dayLabel = new Date(a.dateStart!).toDateString() === new Date().toDateString() ? 'היום' : 'מחר';
        const timeLabel = new Date(a.dateStart!).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
        list.push({
          icon: trigger ? '▶' : '🗓',
          title: `${a.label} — ${dayLabel} ${timeLabel}`,
          desc: [a.owner, a.ownerEmployee].filter(Boolean).join(' · ') + (trigger ? ' · לחץ להפעלת Runbook' : ''),
          urgent: dayLabel === 'היום',
          onClick: trigger ? (() => setRunbookItem({ trigger, dateStartISO: a.dateStart! })) : undefined,
        });
      }
    }

    return list;
  }, [primary, role, canManageLeaves, pendingLeaveCount, onGoToLeaves, nextPhaseInfo, firstPhaseInfo, upcomingRunbookSteps, myUserId, onSwitchToQa, todayOrTomorrowActivities]);

  // Stats — only count non-terminal versions as "in progress"
  const totalVersions  = inProgressVersions.length;
  const liveCount      = inProgressVersions.filter(v => ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(v.status)).length;
  const planningCount  = inProgressVersions.filter(v => !['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(v.status)).length;
  const endedCount     = activeVersions.filter(v => ['COMPLETED', 'ROLLED_BACK'].includes(v.status)).length + versions.filter(v => v.isArchived).length;

  // ── Render ──
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: C.bgApp, fontFamily: FONT, direction: 'rtl', color: C.textPrimary, minHeight: 0 }}>
      <style>{`
        @keyframes home-pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
        @keyframes home-glow  { 0%,100%{box-shadow:0 0 0 3px rgba(240,106,106,0.15)} 50%{box-shadow:0 0 0 6px rgba(240,106,106,0.08)} }
      `}</style>

      {/* ── Topbar ── */}
      <div style={{ background: C.bgCard, borderBottom: `1px solid ${C.border}`, padding: '14px 28px', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0, boxShadow: SHADOW.xs }}>
        <div>
          <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{greeting}, {firstName} 👋</div>
          <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '1px' }}>
            {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
        <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isLiveNow && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(240,106,106,0.08)', border: '1px solid rgba(240,106,106,0.25)', borderRadius: RADIUS.full, padding: '4px 12px' }}>
              <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: C.danger, animation: 'home-pulse 1.5s ease-in-out infinite' }} />
              <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.danger }}>LIVE</span>
            </div>
          )}
          {isMorningAfterNow && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(240,136,62,0.08)', border: '1px solid rgba(240,136,62,0.30)', borderRadius: RADIUS.full, padding: '4px 12px' }}>
              <span style={{ fontSize: '14px' }}>🌅</span>
              <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: '#F0883E' }}>בוקר שלאחר</span>
            </div>
          )}
          {canCreate && onNewVersion && (
            <button
              onClick={onNewVersion}
              style={{ background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, padding: '7px 16px', ...TEXT.sm, fontWeight: WEIGHT.semibold, cursor: 'pointer', fontFamily: FONT, transition: EASE.fast }}
              onMouseEnter={e => (e.currentTarget.style.background = '#E05555')}
              onMouseLeave={e => (e.currentTarget.style.background = C.brand)}
            >
              + גרסה חדשה
            </button>
          )}
        </div>
      </div>

      {/* ── No versions at all ── */}
      {!primary && !allDone && <EmptyState canCreate={canCreate} onNewVersion={onNewVersion} />}

      {/* ── All versions completed — show compact notice + history ── */}
      {allDone && (
        <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Notice bar */}
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontSize: '28px', flexShrink: 0 }}>🏁</span>
            <div style={{ flex: 1 }}>
              <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>אין גרסאות פעילות כרגע</div>
              <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px' }}>כל הגרסאות הושלמו — ניתן לעיין בהן למטה</div>
            </div>
            {canCreate && onNewVersion && (
              <button
                onClick={onNewVersion}
                style={{ flexShrink: 0, background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, padding: '8px 18px', ...TEXT.sm, fontWeight: WEIGHT.semibold, cursor: 'pointer', fontFamily: FONT }}
              >
                + פתח גרסה חדשה
              </button>
            )}
          </div>
          {/* Stats */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <StatCard value="0" label="גרסאות בתהליך" />
            <StatCard value={String(activeVersions.filter(v => ['COMPLETED', 'ROLLED_BACK'].includes(v.status)).length + versions.filter(v => v.isArchived).length)} label="גרסאות שהסתיימו" deltaColor={C.success} delta="✓ הושלמו" />
          </div>
          {/* Version list */}
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '20px' }}>
            <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '14px' }}>📦 גרסאות אחרונות</div>
            {activeVersions.map(v => <VersionRow key={v.id} v={v} isPrimary={false} onSelect={onSelectVersion} role={role} />)}
            {canCreate && onNewVersion && (
              <button
                onClick={onNewVersion}
                style={{ width: '100%', marginTop: '10px', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: RADIUS.md, padding: '9px', ...TEXT.xs, color: C.textMuted, cursor: 'pointer', fontFamily: FONT, transition: EASE.fast }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.brand; e.currentTarget.style.color = C.brand; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted; }}
              >
                + פתח גרסה חדשה
              </button>
            )}
          </div>
        </div>
      )}

      {primary && (
        <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* ── Hero banner ── */}
          {(() => {
            const ph = PHASE_META[primary.status] ?? PHASE_META['DRAFT'];
            return (
              <div style={{
                background: ph.bg, border: `1.5px solid ${ph.color}30`, borderRadius: RADIUS.lg,
                padding: '20px 24px', display: 'flex', alignItems: 'center', gap: '20px',
                animation: ph.pulse ? 'home-glow 3s ease-in-out infinite' : 'none',
              }}>
                <span style={{ fontSize: '36px', flexShrink: 0 }}>{ph.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '28px', fontWeight: WEIGHT.bold, color: ph.color, lineHeight: 1.1, marginBottom: '4px', letterSpacing: '-0.01em' }}>
                    {primary.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: ph.color, opacity: 0.85 }}>{ph.icon} {ph.label}</span>
                  </div>
                  <div style={{ ...TEXT.xs, color: C.textSecondary }}>
                    {primary.status === 'APPROVED' && primary.rehearsalSummary
                      ? 'החזרה הגנרלית הושלמה. ממתינים לפתיחת הלילה הפעיל.'
                      : ph.desc(role)}
                  </div>
                  {/* Phase progress strip for ACTIVE/REHEARSAL */}
                  {livePhases.some(p => p.state !== 'done') && (
                    <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {livePhases.filter(p => p.state !== 'done').map((p, i) => {
                        const isDone     = p.state === 'done';
                        const isActive   = p.state === 'active';
                        const isUpcoming = p.state === 'upcoming';
                        const icon = isDone ? '✅' : isActive ? '▶' : '○';
                        const color = isDone ? C.success : isActive ? ph.color : C.textMuted;
                        const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
                        return (
                          <div
                            key={i}
                            onClick={() => onSelectVersion(primary.id, 'dashboard')}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                              padding: '5px 8px', borderRadius: RADIUS.sm,
                              background: isActive ? `${ph.color}14` : 'transparent',
                              border: isActive ? `1px solid ${ph.color}30` : '1px solid transparent',
                              opacity: isUpcoming ? 0.5 : 1,
                            }}
                          >
                            <span style={{ fontSize: '13px', width: '14px', flexShrink: 0, color }}>{icon}</span>
                            <span style={{ ...TEXT.xs, fontWeight: isActive ? WEIGHT.semibold : WEIGHT.normal, color, flex: 1 }}>{p.name}</span>
                            {p.total > 0 && (
                              <>
                                <span style={{ ...TEXT.xs, color: C.textMuted, flexShrink: 0 }}>{p.done}/{p.total}</span>
                                <div style={{ width: 48, height: 4, background: C.bgHover, borderRadius: 2, flexShrink: 0, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${pct}%`, background: isDone ? C.success : ph.color, borderRadius: 2 }} />
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {qaSummary && qaSummary.totalCrs > 0 && (
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' as const }}>
                      <span style={{ ...TEXT.xs, color: '#7c3aed', background: 'rgba(124,58,237,0.10)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: '10px', padding: '2px 8px' }}>
                        🧪 QA: {qaSummary.assignedCrs}/{qaSummary.totalCrs} CRs שובצו
                      </span>
                      {qaSummary.hasWorkPlan && (
                        <span style={{ ...TEXT.xs, color: C.success, background: 'rgba(55,196,122,0.08)', border: '1px solid rgba(55,196,122,0.2)', borderRadius: '10px', padding: '2px 8px' }}>
                          ✓ לוח פעילויות מוכן
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
                  {(() => {
                    const mainCtaTab = typeof ph.ctaTab === 'function' ? ph.ctaTab(role) : ph.ctaTab;
                    return (
                      <>
                        <button
                          onClick={() => onSelectVersion(primary.id, mainCtaTab)}
                          style={{ background: ph.color, color: 'white', border: 'none', borderRadius: RADIUS.md, padding: '10px 20px', ...TEXT.sm, fontWeight: WEIGHT.semibold, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' as const }}
                        >
                          {ph.cta(role)} ←
                        </button>
                        {/* Only show the secondary "פרטי גרסה" link when it actually leads
                            somewhere different — several statuses already route the main
                            CTA to 'list', making a second identical button pointless. */}
                        {mainCtaTab !== 'list' && (
                          <button
                            onClick={() => onSelectVersion(primary.id, 'list')}
                            style={{ background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '7px 16px', ...TEXT.xs, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' as const }}
                          >
                            פרטי גרסה
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            );
          })()}

          {/* ── Track selector — deployment quick-links always shown; QA card only when accessible ── */}
          <div style={{ display: 'grid', gridTemplateColumns: canAccessQa ? '1fr 1fr' : '1fr', gap: '12px' }}>
            <div
              onClick={() => primary && onSelectVersion(primary.id, 'list')}
              style={{ background: `${C.brand}08`, border: `1.5px solid ${C.brand}40`, borderRadius: RADIUS.lg, padding: '14px 18px', cursor: 'pointer', transition: EASE.fast }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${C.brand}12`; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${C.brand}08`; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <span style={{ fontSize: '18px' }}>🚀</span>
                <div style={{ flex: 1 }}>
                  <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>מסלול הטמעה</div>
                </div>
                <span style={{ ...TEXT.xs, background: C.brand, color: 'white', borderRadius: '10px', padding: '1px 7px', fontWeight: WEIGHT.semibold, flexShrink: 0 }}>פעיל</span>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' as const }}>
                {[
                  { label: '📅 לוח זמנים',  tab: 'version-detail' },
                  { label: '⚡ לוח בקרה',   tab: 'dashboard' },
                  { label: '🚀 דף ההרצה',   tab: 'board' },
                  ...(primary?.lastRehearsalAt ? [
                    { label: '🎭 סיכום חזרה', tab: 'summary-rehearsal' },
                    { label: '🎭 לוח חזרה (היסטורי)', tab: 'rehearsal-board' },
                  ] : []),
                  { label: '📄 סיכום לילה', tab: 'summary-night' },
                ].map(({ label, tab }) => (
                  <span
                    key={tab}
                    onClick={e => { e.stopPropagation(); primary && onSelectVersion(primary.id, tab); }}
                    style={{ ...TEXT.xs, color: C.brand, background: `${C.brand}12`, border: `1px solid ${C.brand}30`, borderRadius: '10px', padding: '2px 9px', cursor: 'pointer', fontWeight: WEIGHT.medium, whiteSpace: 'nowrap' as const, transition: EASE.fast }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${C.brand}22`; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${C.brand}12`; }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
            {canAccessQa && (
              <div
                onClick={onSwitchToQa}
                style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '14px 18px', cursor: 'pointer', transition: EASE.fast }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(124,58,237,0.4)'; (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.04)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; (e.currentTarget as HTMLElement).style.background = C.bgCard; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>🧪</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>ניהול QA</div>
                    <div style={{ ...TEXT.xs, color: C.textMuted }}>שיבוץ בודקים · סבבי QA · לוח פעילויות</div>
                  </div>
                  <span style={{ ...TEXT.xs, color: '#7c3aed', fontWeight: WEIGHT.semibold, flexShrink: 0 }}>עבור ←</span>
                </div>
              </div>
            )}
          </div>

          {/* ── Review-meeting approaching alert (manager) ── */}
          {isRm(role) && reviewIsApproaching && primary && (
            <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', background: 'rgba(232,175,0,0.09)', border: `1.5px solid rgba(232,175,0,0.4)`, borderRadius: RADIUS.lg, padding: '14px 18px' }}>
              <span style={{ fontSize: '22px', flexShrink: 0 }}>⏰</span>
              <div style={{ flex: 1 }}>
                <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: '#C97A00' }}>
                  פגישת סקירת תוכניות CR בעוד {reviewHoursLabel}
                </div>
                <div style={{ ...TEXT.xs, color: C.textSecondary, marginTop: '3px' }}>
                  {teamStatus.length > 0 && teamStatus.some(t => !t.allDone)
                    ? `${teamStatus.filter(t => !t.allDone).length} צוותים עדיין לא הגישו: ${teamStatus.filter(t => !t.allDone).map(t => t.teamName).join(', ')}`
                    : primary.status === 'DRAFT'
                      ? 'ודא שהגרסה עברה לשלב האיסוף ושהצוותים הגישו תוכניות'
                      : 'בדוק שכל הצוותים הגישו את תוכניות ה-CR לפני הפגישה'}
                </div>
              </div>
              {reviewMeetingTime && (
                <div style={{ flexShrink: 0, textAlign: 'center' as const, ...TEXT.xs, color: '#C97A00', fontWeight: WEIGHT.semibold, whiteSpace: 'nowrap' as const }}>
                  {reviewMeetingTime.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' })}
                  <br />{reviewMeetingTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
          )}

          {/* ── Stats row ── */}
          {activeVersions.length > 0 && (
            <div style={{ display: 'flex', gap: '12px' }}>
              <StatCard value={String(totalVersions)} label="גרסאות בתהליך" delta={liveCount > 0 ? `🔴 ${liveCount} בביצוע` : totalVersions > 0 ? '📋 בתכנון' : undefined} deltaColor={liveCount > 0 ? C.danger : C.textMuted} />
              <StatCard value={String(planningCount)} label="בשלבי תכנון" />
              <StatCard value={String(actions.filter(a => a.urgent).length)} label="פעולות דחופות" deltaColor={C.danger} delta={(() => { const u = actions.filter(a => a.urgent); return u.length > 0 ? `⚠ ${u[0].title}` : '✓ הכל תקין'; })()} />
              <StatCard value={String(endedCount)} label="גרסאות שהסתיימו" deltaColor={C.success} />
              {estimateStats && ((estimateStats as any).crCount > 0 || (estimateStats as any).qaTaskCount > 0) && (
                <div
                  onClick={() => setEstimateDrillOpen(o => !o)}
                  style={{ background: estimateDrillOpen ? 'rgba(69,115,210,0.06)' : C.bgCard, border: `1px solid ${estimateDrillOpen ? '#4573D2' : C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', flex: 1, cursor: 'pointer', transition: EASE.fast }}
                >
                  <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: C.textPrimary, lineHeight: 1.2 }}>
                    {estimateQaFilter ? `${(estimateStats as any).qaFilteredEstimateDays ?? '?'} ימ"ע` : `${estimateStats.totalEstimateDays ?? '?'} ימ"ע`}
                  </div>
                  <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>סך הערכות השקעה</div>
                  <div style={{ ...TEXT.xs, color: '#4573D2', marginTop: '6px' }}>{estimateDrillOpen ? '▲ סגור' : '▼ פירוט לפי צוות'}</div>
                </div>
              )}
              {teamStatus.length > 0 && (() => {
                const done = teamStatus.filter(t => t.allDone).length;
                const total = teamStatus.length;
                const hasReturned = teamStatus.some(t => t.returned > 0);
                return (
                  <StatCard
                    value={`${done}/${total}`}
                    label={isCollecting ? 'צוותים הגישו הצעות' : 'צוותים הגישו תוכניות CR'}
                    delta={hasReturned ? `↩ ${teamStatus.reduce((s,t)=>s+t.returned,0)} הוחזרו` : done === total ? '✓ כולם הגישו' : `${total - done} ממתינים`}
                    deltaColor={hasReturned ? C.warning : done === total ? C.success : C.textMuted}
                  />
                );
              })()}
            </div>
          )}

          {/* ── Estimate drill-down panel ── */}
          {estimateDrillOpen && estimateStats && (
            <div style={{ background: C.bgCard, border: '1px solid #4573D2', borderRadius: RADIUS.lg, padding: '20px' }}>
              {/* Header + toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <span style={{ fontSize: '17px' }}>📊</span>
                <div style={{ flex: 1 }}>
                  <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>פירוט הערכות השקעה לפי צוות</div>
                  <div style={{ ...TEXT.xs, color: C.textMuted }}>לחץ על צוות לפירוט CRs</div>
                </div>
                {/* Toggle filter */}
                <div style={{ display: 'flex', gap: '4px', background: C.bgApp, borderRadius: RADIUS.md, padding: '3px' }}>
                  {[
                    { key: false, label: 'כל CRs' },
                    { key: true,  label: 'CRs עם QA' },
                  ].map(opt => (
                    <button
                      key={String(opt.key)}
                      onClick={() => { setEstimateQaFilter(opt.key); setEstimateExpandedTeam(null); }}
                      style={{
                        border: 'none', borderRadius: RADIUS.sm, padding: '5px 14px',
                        ...TEXT.xs, fontWeight: WEIGHT.semibold, fontFamily: FONT, cursor: 'pointer',
                        background: estimateQaFilter === opt.key ? C.bgCard : 'transparent',
                        color: estimateQaFilter === opt.key ? C.textPrimary : C.textMuted,
                        boxShadow: estimateQaFilter === opt.key ? SHADOW.xs : 'none',
                        transition: EASE.fast,
                      }}
                    >{opt.label}</button>
                  ))}
                </div>
                {/* Grand total badge */}
                <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: '#4573D2', background: 'rgba(69,115,210,0.08)', borderRadius: RADIUS.md, padding: '4px 12px' }}>
                  סה"כ: {estimateQaFilter ? estimateStats.qaFilteredEstimateDays : estimateStats.totalEstimateDays} ימ"ע
                </div>
              </div>

              {/* Team list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {(estimateQaFilter
                  ? estimateStats.byTeam.filter(t => t.qaFilteredDays > 0)
                  : estimateStats.byTeam
                ).map(team => {
                  const days    = estimateQaFilter ? team.qaFilteredDays : team.totalDays;
                  const crs     = estimateQaFilter ? team.crs.filter(c => c.hasQa) : team.crs;
                  const isOpen  = estimateExpandedTeam === team.teamId;
                  const maxDays = Math.max(...(estimateQaFilter
                    ? estimateStats.byTeam.filter(t => t.qaFilteredDays > 0).map(t => t.qaFilteredDays)
                    : estimateStats.byTeam.map(t => t.totalDays)), 1);
                  const barPct  = Math.round((days / maxDays) * 100);
                  return (
                    <div key={team.teamId} style={{ borderRadius: RADIUS.md, overflow: 'hidden', border: `1px solid ${isOpen ? '#4573D2' : C.border}`, transition: EASE.fast }}>
                      {/* Team row */}
                      <div
                        onClick={() => setEstimateExpandedTeam(isOpen ? null : team.teamId)}
                        style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', cursor: 'pointer', background: isOpen ? 'rgba(69,115,210,0.04)' : C.bgCard }}
                      >
                        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, minWidth: '130px' }}>{team.teamName}</div>
                        {/* Bar */}
                        <div style={{ flex: 1, background: C.bgApp, borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                          <div style={{ width: `${barPct}%`, height: '100%', background: '#4573D2', borderRadius: '4px', transition: 'width 0.4s ease' }} />
                        </div>
                        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: '#4573D2', minWidth: '60px', textAlign: 'left' as const }}>{days} ימ"ע</div>
                        <div style={{ ...TEXT.xs, color: C.textMuted, minWidth: '50px', textAlign: 'left' as const }}>{crs.length} CRs</div>
                        <div style={{ ...TEXT.xs, color: '#4573D2' }}>{isOpen ? '▲' : '▼'}</div>
                      </div>
                      {/* CR list for team */}
                      {isOpen && (
                        <div style={{ background: C.bgApp, padding: '8px 14px 10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          {crs.map(cr => (
                            <div key={cr.crNumber} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 6px', borderRadius: RADIUS.sm }}>
                              <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textMuted, minWidth: '60px' }}>{cr.crNumber}</div>
                              <div style={{ ...TEXT.xs, color: C.textSecondary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{cr.crLabel.replace(cr.crNumber + ' - ', '')}</div>
                              {cr.hasQa && <span style={{ ...TEXT.xs, color: '#37C47A', fontWeight: WEIGHT.semibold }}>QA</span>}
                              <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: '#4573D2', minWidth: '50px', textAlign: 'left' as const }}>{cr.teamDays} ימ"ע</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {(estimateQaFilter ? estimateStats.byTeam.filter(t => t.qaFilteredDays > 0) : estimateStats.byTeam).length === 0 && (
                  <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center' as const, padding: '20px' }}>
                    הפירוט לפי צוות זמין לאחר סינכרון CR_LIST עם הגרסה
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Team submission status panel ── */}
          {showTeamStatus && (
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <span style={{ fontSize: '17px' }}>📋</span>
                <div>
                  <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{isCollecting ? 'סטטוס הגשות הצעות משימות לפי צוות' : 'סטטוס הגשות תוכניות CR לפי צוות'}</div>
                  <div style={{ ...TEXT.xs, color: C.textMuted }}>{isCollecting ? 'מעקב אחר הגשת הצעות המשימות של הצוותים' : 'מעקב אחר הגשת תוכניות עלייה לאוויר'}</div>
                </div>
                {!teamStatusLoading && teamStatus.length > 0 && (() => {
                  const done = teamStatus.filter(t => t.allDone).length;
                  const all  = teamStatus.length;
                  return (
                    <div style={{ marginRight: 'auto', ...TEXT.xs, color: done === all ? C.success : C.warning, fontWeight: WEIGHT.semibold }}>
                      {done}/{all} צוותים השלימו
                    </div>
                  );
                })()}
              </div>

              {/* Warning banner: review approaching + teams haven't submitted */}
              {reviewIsApproaching && !teamStatusLoading && teamStatus.some(t => !t.allDone) && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: 'rgba(232,175,0,0.08)', border: `1px solid rgba(232,175,0,0.35)`, borderRadius: RADIUS.md, padding: '10px 14px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '17px', flexShrink: 0 }}>⏰</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.warning }}>
                      פגישת סקירת התוכניות בעוד {reviewHoursLabel}
                    </div>
                    <div style={{ ...TEXT.xs, color: C.textSecondary, marginTop: '2px' }}>
                      {teamStatus.filter(t => !t.allDone).length} צוותים עדיין לא {isCollecting ? 'הגישו הצעות' : 'הגישו תוכנית CR'} —
                      {' '}{teamStatus.filter(t => !t.allDone).map(t => t.teamName).join(', ')}
                    </div>
                  </div>
                  {reviewMeetingTime && (
                    <div style={{ flexShrink: 0, ...TEXT.xs, color: C.textMuted, textAlign: 'center' as const, whiteSpace: 'nowrap' as const }}>
                      {reviewMeetingTime.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' })}
                      <br />{reviewMeetingTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
              )}

              {teamStatusLoading ? (
                <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: '16px 0' }}>טוען...</div>
              ) : teamStatus.length === 0 ? (
                <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: '16px 0' }}>אין תוכניות CR בגרסה זו</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {teamStatus.map(t => {
                    const pct = t.total > 0 ? Math.round(((t.approved + t.submitted) / t.total) * 100) : 0;
                    const icon = t.allDone ? '✅' : t.returned > 0 ? '↩️' : t.submitted > 0 ? '⏳' : '🔴';
                    const barColor = t.allDone ? C.success : t.returned > 0 ? C.warning : t.submitted > 0 ? '#4573D2' : C.danger;
                    return (
                      <div
                        key={t.teamId}
                        onClick={() => primary && onSelectVersion(primary.id, isCollecting ? 'proposals' : 'list')}
                        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: RADIUS.sm, cursor: 'pointer', border: `1px solid ${C.border}`, transition: EASE.fast }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.bgHover}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                      >
                        <span style={{ fontSize: '15px', flexShrink: 0 }}>{icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{t.teamName}</span>
                            <span style={{ ...TEXT.xs, color: C.textMuted, flexShrink: 0, marginRight: '8px' }}>
                              {isCollecting ? (
                                <>
                                  {t.submitted > 0 && <span style={{ color: C.success }}>✓{t.submitted} מוכנות </span>}
                                  {t.draft > 0    && <span style={{ color: C.textMuted }}>✎{t.draft} טיוטה</span>}
                                </>
                              ) : (
                                <>
                                  {t.approved > 0 && <span style={{ color: C.success }}>✓{t.approved} </span>}
                                  {t.submitted > 0 && <span style={{ color: '#4573D2' }}>↑{t.submitted} </span>}
                                  {t.returned > 0 && <span style={{ color: C.warning }}>↩{t.returned} </span>}
                                  {t.draft > 0 && <span style={{ color: C.textMuted }}>✎{t.draft}</span>}
                                </>
                              )}
                            </span>
                          </div>
                          <div style={{ height: '4px', borderRadius: '2px', background: C.border, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: '2px', transition: 'width 0.4s ease' }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Two-column body ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', alignItems: 'start' }}>

            {/* Left: Actions */}
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '20px' }}>
              <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '4px' }}>📌 הפעולות הבאות שלך</div>
              <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '12px' }}>בהתאם לתפקידך ושלב הגרסה הפעילה</div>

              {/* ── Sub-phase progress (ACTIVE / REHEARSAL only) ── */}
              {livePhases.length > 0 && (() => {
                const ph = PHASE_META[primary!.status] ?? PHASE_META['DRAFT'];
                return (
                  <div style={{ background: C.bgHover, borderRadius: RADIUS.md, padding: '10px 12px', marginBottom: '14px' }}>
                    <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '8px', fontWeight: WEIGHT.semibold }}>התקדמות שלבי הלילה</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      {livePhases.map((p, i) => {
                        const isDone     = p.state === 'done';
                        const isActive   = p.state === 'active';
                        const isUpcoming = p.state === 'upcoming';
                        const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
                        const color = isDone ? C.success : isActive ? ph.color : C.textMuted;
                        return (
                          <div
                            key={i}
                            onClick={() => primary && onSelectVersion(primary.id, 'dashboard')}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                              padding: '5px 7px', borderRadius: RADIUS.sm,
                              background: isActive ? `${ph.color}12` : 'transparent',
                              border: isActive ? `1px solid ${ph.color}30` : '1px solid transparent',
                              opacity: isUpcoming ? 0.5 : 1,
                            }}
                          >
                            <span style={{ fontSize: '13px', width: '14px', flexShrink: 0, color, textAlign: 'center' as const }}>
                              {isDone ? '✓' : isActive ? '▶' : '○'}
                            </span>
                            <span style={{ ...TEXT.xs, flex: 1, color: isDone ? C.textMuted : C.textPrimary, fontWeight: isActive ? WEIGHT.semibold : WEIGHT.normal }}>{p.name}</span>
                            <span style={{ ...TEXT.xs, color: C.textMuted, flexShrink: 0 }}>{p.done}/{p.total}</span>
                            <div style={{ width: 36, height: 3, background: C.border, borderRadius: 2, flexShrink: 0, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: isDone ? C.success : ph.color, borderRadius: 2 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Team lead warning: review approaching + no ready submissions (null = fetch failed/pending = treat as not submitted) */}
              {isTl && reviewIsApproaching && showMyTeamWarning && (myTeamSummary === null || myTeamSummary.ready === 0) && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: 'rgba(240,106,106,0.08)', border: `1px solid rgba(240,106,106,0.3)`, borderRadius: RADIUS.md, padding: '10px 14px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '18px', flexShrink: 0 }}>⚠️</span>
                  <div>
                    <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.danger }}>
                      {primary.status === 'COLLECTING' ? 'לא הגשת הצעות משימות עדיין' : 'לא הגשת תוכנית CR עדיין'}
                    </div>
                    <div style={{ ...TEXT.xs, color: C.textSecondary, marginTop: '2px' }}>
                      פגישת הסקירה בעוד {reviewHoursLabel}
                      {reviewMeetingTime && ` (${reviewMeetingTime.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})`}
                    </div>
                  </div>
                  <button
                    onClick={() => onSelectVersion(primary.id, primary.status === 'COLLECTING' ? 'proposals' : 'implementation-plans')}
                    style={{ marginRight: 'auto', flexShrink: 0, background: C.danger, color: 'white', border: 'none', borderRadius: RADIUS.sm, padding: '5px 12px', ...TEXT.xs, fontWeight: WEIGHT.semibold, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' as const }}
                  >
                    הגש עכשיו ←
                  </button>
                </div>
              )}

              {actions.length === 0 ? (
                <div style={{ ...TEXT.sm, color: C.textMuted, padding: '20px 0', textAlign: 'center' }}>
                  אין פעולות ממתינות כרגע ✓
                </div>
              ) : (
                <div>
                  {actions.map((a, i) => (
                    <ActionItem
                      key={i}
                      icon={a.icon}
                      title={a.title}
                      desc={a.desc}
                      urgent={a.urgent}
                      onClick={a.onClick ?? (a.tab ? () => onSelectVersion(primary.id, a.tab) : undefined)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Right: All versions */}
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '20px' }}>
              <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '14px' }}>
                📦 כל הגרסאות הפעילות
              </div>

              <VersionRow v={primary} isPrimary onSelect={onSelectVersion} qaSummary={qaSummary} role={role} />
              {others.map(v => <VersionRow key={v.id} v={v} isPrimary={false} onSelect={onSelectVersion} role={role} />)}

              {others.length === 0 && (
                <div style={{ ...TEXT.xs, color: C.textMuted, textAlign: 'center', padding: '8px 0' }}>
                  גרסה אחת בלבד
                </div>
              )}

              {canCreate && onNewVersion && (
                <button
                  onClick={onNewVersion}
                  style={{ width: '100%', marginTop: '10px', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: RADIUS.md, padding: '9px', ...TEXT.xs, color: C.textMuted, cursor: 'pointer', fontFamily: FONT, transition: EASE.fast }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.brand; e.currentTarget.style.color = C.brand; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted; }}
                >
                  + פתח גרסה חדשה
                </button>
              )}
            </div>

          </div>
        </div>
      )}

      {runbookItem && (
        <RunbookModal
          trigger={runbookItem.trigger}
          dateStartISO={runbookItem.dateStartISO}
          versionId={primary?.id ?? ''}
          token={token}
          startInRunMode
          onClose={() => setRunbookItem(null)}
        />
      )}
    </div>
  );
};
