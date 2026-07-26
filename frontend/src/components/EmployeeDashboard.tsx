import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { TeamView } from './TeamView';
import { VersionProgressChain } from './VersionProgressChain';
import { useSocket } from '../hooks/useSocket';
import { playTaskReady } from '../utils/sound';
import { DeployCenterLogo } from './DeployCenterLogo';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { EmployeeLeavesView } from './EmployeeLeavesView';
import { EmployeeHomeView } from './EmployeeHomeView';
import { QaTestersView } from './qa/QaTestersView';
import { MyQaTasksView, MyQaTask, TargetDefectGroup } from './qa/MyQaTasksView';
import { FocusModeModal } from './FocusModeModal';
import { RUNBOOKS } from './qa/RunbookModal';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../theme';

// Same order used by VersionProgressChain — picks the most-advanced planning
// version when several exist, instead of whichever happens to come first in the API response.
const PLANNING_STATUS_ORDER = ['DRAFT', 'COLLECTING', 'CR_REVIEW', 'REFINING', 'REVIEW', 'APPROVED'];

// Mirrors EmployeeLeavesView's isSeasonLocked — a season stops accepting new requests
// 3 days before its first date.
const isSeasonLocked = (dates: { date: string }[]): boolean => {
  if (!dates.length) return false;
  const sorted = [...dates].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const lockDate = new Date(sorted[0].date);
  lockDate.setDate(lockDate.getDate() - 3);
  lockDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today >= lockDate;
};

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const IS_TEST = process.env.REACT_APP_ENV === 'test';

interface ToastItem {
  id: number;
  type: 'info' | 'go' | 'blocked' | 'warn';
  title: string;
  body?: string;
}

interface Props {
  token: string;
  onLogout: () => void;
}

type NavView = 'home' | 'tasks' | 'leaves' | 'skills' | 'qaTasks';

const NAV_ITEMS: { key: NavView; label: string; icon: string }[] = [
  { key: 'home',    label: 'דף הבית',           icon: '🏠' },
  { key: 'tasks',   label: 'משימות הרצה',      icon: '🌙' },
  { key: 'qaTasks', label: 'המשימות שלי (QA)', icon: '🧪' },
  { key: 'leaves',  label: 'חופשות',            icon: '📅' },
  { key: 'skills',  label: 'מטריצת מיומנויות',  icon: '🎯' },
];

export const EmployeeDashboard: React.FC<Props> = ({ token, onLogout }) => {
  const [myTeam, setMyTeam]               = useState<any>(null);
  const [activeVersion, setActiveVersion] = useState<any>(null);
  const [loading, setLoading]             = useState(true);
  const [toasts, setToasts]               = useState<ToastItem[]>([]);
  const [onlineUsers, setOnlineUsers]     = useState<any[]>([]);
  const [refreshKey, setRefreshKey]       = useState(0);
  const [taskStats, setTaskStats]         = useState({ done: 0, inProgress: 0, open: 0, waiting: 0, blocked: 0, total: 0 });
  const [planningVersion, setPlanningVersion] = useState<any>(null);
  const [seasonReminder, setSeasonReminder] = useState<{ id: string; name: string } | null>(null);
  const [activeView, setActiveView]       = useState<NavView>('home');
  const [hoveredNav, setHoveredNav]       = useState<NavView | null>(null);
  const [focusMode, setFocusMode]               = useState(false);
  const [focusAllTasks, setFocusAllTasks]       = useState<any[]>([]);
  const [focusLoading, setFocusLoading]         = useState(false);
  const [updatingFocusTaskId, setUpdatingFocusTaskId] = useState<string | null>(null);
  const [myRunbookSteps, setMyRunbookSteps] = useState<{
    runbookId: string; stepIndex: number; startTime: string; runDate: string; team: string;
  }[]>([]);
  const [isQaTester, setIsQaTester]   = useState(false);
  const [myQaTasks, setMyQaTasks]     = useState<MyQaTask[]>([]);
  const [qaSummary, setQaSummary]     = useState<{ cycles: { cycleType: string; plannedStart: string; plannedEnd: string }[] } | null>(null);
  const [targetDefectGroups, setTargetDefectGroups] = useState<TargetDefectGroup[]>([]);
  const [defectStats, setDefectStats] = useState<{ opened: number; stillOpen: number; waitingForMyVerification: number; expectedMin: number; tooFew: boolean } | null>(null);
  const isQaTeam = myTeam?.name?.toLowerCase().includes('qa') ?? false;

  const payload  = JSON.parse(atob(token.split('.')[1]));
  const fullName = localStorage.getItem('deploycenter_fullName') || payload.fullName || 'עובד';
  const headers  = { Authorization: `Bearer ${token}` };
  const push = usePushNotifications(token);

  const toastCounter = React.useRef(0);
  const showToast = (item: Omit<ToastItem, 'id'>, duration = 8000) => {
    const id = ++toastCounter.current;
    setToasts(prev => [...prev, { ...item, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  };
  const dismissToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  useSocket({
    userId: payload.sub,
    fullName,
    teamId: myTeam?.id,
    onTaskUpdated: (task) => {
      setRefreshKey(k => k + 1);
      if (task) setFocusAllTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...task } : t));
      const isMyTask = task?.assignedUserId === payload.sub || task?.assignedUserName === fullName;
      if (isMyTask && task?.status === 'OPEN') {
        playTaskReady();
        showToast({ type: 'info', title: '🔔 משימה מוכנה להתחלה', body: task.title }, 8000);
      }
    },
    onTaskBlocked: (task) => {
      showToast({
        type: 'blocked',
        title: '⚠️ משימה חסומה',
        body: `${task.title}${task.blockedReason ? ` — ${task.blockedReason}` : ''}`,
      }, 10000);
    },
    onJoined:      (users) => setOnlineUsers(users.filter((u, i, arr) => arr.findIndex(x => x.userId === u.userId) === i)),
    onUserOnline:  (u) => setOnlineUsers(prev => [...prev.filter(x => x.userId !== u.userId), u]),
    onUserOffline: (u) => setOnlineUsers(prev => prev.filter(x => x.userId !== u.userId)),
  });

  const fetchTaskStats = async (versionId: string) => {
    try {
      const res = await axios.get(`${API}/versions/${versionId}`, { headers });
      const ver = res.data;
      const allTasks: any[] = [];
      for (const phase of (ver.phases ?? [])) {
        for (const sub of (phase.subPhases ?? [])) {
          for (const t of (sub.tasks ?? [])) allTasks.push(t);
        }
      }
      setTaskStats({
        done:       allTasks.filter(t => t.status === 'DONE').length,
        inProgress: allTasks.filter(t => t.status === 'IN_PROGRESS').length,
        open:       allTasks.filter(t => t.status === 'OPEN').length,
        waiting:    allTasks.filter(t => t.status === 'WAITING').length,
        blocked:    allTasks.filter(t => t.status === 'BLOCKED').length,
        total:      allTasks.length,
      });
    } catch { /* silent */ }
  };

  // Runbook steps assigned specifically to this employee (any version, upcoming
  // ones only) — surfaced on Home per the "the employee assigned to the task
  // should see it" requirement, independent of team-lead/admin visibility.
  useEffect(() => {
    const versionId = activeVersion?.id ?? planningVersion?.id;
    if (!versionId) { setMyRunbookSteps([]); return; }
    axios.get(`${API}/runbook/${versionId}/upcoming`, { headers })
      .then(res => setMyRunbookSteps((res.data ?? []).filter((e: any) => e.employeeUserId === payload.sub)))
      .catch(() => setMyRunbookSteps([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVersion?.id, planningVersion?.id, token]);

  // QA work-plan tasks assigned specifically to this employee for the current
  // version — separate from the general night-execution Task model above.
  // `isTester` gates whether the "המשימות שלי (QA)" nav tab even shows, since
  // being a QA tester (TesterProfile) is independent of team/role.
  useEffect(() => {
    const versionId = activeVersion?.id ?? planningVersion?.id;
    if (!versionId) { setIsQaTester(false); setMyQaTasks([]); return; }
    axios.get(`${API}/qa/me/tasks?versionId=${versionId}`, { headers })
      .then(res => { setIsQaTester(!!res.data?.isTester); setMyQaTasks(res.data?.tasks ?? []); })
      .catch(() => { setIsQaTester(false); setMyQaTasks([]); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVersion?.id, planningVersion?.id, token]);

  // QA cycle dates (for the milestone timeline on Home) — only fetched for an
  // actual QA tester, matching the scope of this addition (the tester's own
  // dashboard, not a general change for every employee).
  useEffect(() => {
    const versionId = activeVersion?.id ?? planningVersion?.id;
    if (!isQaTester || !versionId) { setQaSummary(null); return; }
    axios.get(`${API}/qa-stats/summary?versionId=${versionId}`, { headers })
      .then(res => setQaSummary(res.data))
      .catch(() => setQaSummary(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isQaTester, activeVersion?.id, planningVersion?.id, token]);

  // TARGET CR defects assigned to me + my own defect-reporting stats — fetched
  // once here so both the home-page KPI summary and the "המשימות שלי (QA)"
  // tab's detail list share the same data instead of double-fetching.
  useEffect(() => {
    const versionId = activeVersion?.id ?? planningVersion?.id;
    if (!isQaTester || !versionId) { setTargetDefectGroups([]); setDefectStats(null); return; }
    axios.get(`${API}/target-cr/my-defects?versionId=${versionId}`, { headers })
      .then(res => setTargetDefectGroups(res.data ?? []))
      .catch(() => setTargetDefectGroups([]));
    axios.get(`${API}/target-cr/my-defect-stats?versionId=${versionId}`, { headers })
      .then(res => setDefectStats(res.data))
      .catch(() => setDefectStats(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isQaTester, activeVersion?.id, planningVersion?.id, token]);

  const openFocusMode = async () => {
    if (!activeVersion) return;
    setFocusMode(true);
    setFocusLoading(true);
    try {
      const res = await axios.get(`${API}/versions/${activeVersion.id}`, { headers });
      const all: any[] = [];
      for (const ph of (res.data.phases ?? []))
        for (const sub of (ph.subPhases ?? []))
          for (const t of (sub.tasks ?? []))
            all.push({ ...t, _phaseName: ph.name, _subPhaseName: sub.name });
      setFocusAllTasks(all);
    } catch {} finally { setFocusLoading(false); }
  };

  const updateFocusTask = async (taskId: string, status: string, reason?: string) => {
    setUpdatingFocusTaskId(taskId);
    try {
      await axios.patch(`${API}/tasks/${taskId}/status`, { status, ...(reason ? { blockedReason: reason } : {}) }, { headers });
      setFocusAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, status, ...(reason ? { blockedReason: reason } : {}) } : t));
    } catch {} finally { setUpdatingFocusTaskId(null); }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      axios.get(`${API}/teams`, { headers }),
      axios.get(`${API}/versions`, { headers }),
    ])
      .then(([teamsRes, versionsRes]) => {
        const userId = payload.sub;
        const team = teamsRes.data.find((t: any) =>
          t.members?.some((m: any) => m.userId === userId || m.user?.id === userId)
        );
        setMyTeam(team || null);
        const allVersions: any[] = versionsRes.data;
        const active = allVersions.find((v: any) => ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(v.status));
        setActiveVersion(active || null);
        if (active) {
          fetchTaskStats(active.id);
        } else {
          const candidates = allVersions.filter((v: any) =>
            !v.isArchived && PLANNING_STATUS_ORDER.includes(v.status)
          );
          // Several versions can be "in planning" at once (e.g. one still DRAFT while
          // another is already in CR_REVIEW) — show whichever is furthest along, not
          // just whichever the API happened to list first.
          const planning = candidates.sort(
            (a: any, b: any) => PLANNING_STATUS_ORDER.indexOf(b.status) - PLANNING_STATUS_ORDER.indexOf(a.status)
          )[0];
          setPlanningVersion(planning || null);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // QA-team members can request leave — surface a reminder when a season is open
  // for requests but this employee hasn't submitted anything for it yet.
  useEffect(() => {
    if (!isQaTeam) { setSeasonReminder(null); return; }
    Promise.all([
      axios.get(`${API}/leaves/seasons`, { headers }),
      axios.get(`${API}/leaves/my-requests`, { headers }),
    ])
      .then(([seasonsRes, myRequestsRes]) => {
        const mySeasonIds = new Set((myRequestsRes.data as any[]).map(r => r.seasonId).filter(Boolean));
        // A season stays "open" as long as at least one of its own dates hasn't hit its
        // 3-day cutoff yet — a long season (e.g. summer) shouldn't count as closed just
        // because its earliest date already has.
        const open = (seasonsRes.data as any[]).find(s =>
          s.isActive && !mySeasonIds.has(s.id) && (s.dates ?? []).some((d: any) => !isSeasonLocked([d]))
        );
        setSeasonReminder(open ? { id: open.id, name: open.name } : null);
      })
      .catch(() => setSeasonReminder(null));
  }, [isQaTeam]); // eslint-disable-line react-hooks/exhaustive-deps

  // עובד בצוות QA: רואה חופשות בלבד (לא מטריצת מיומנויות — שמורה למנהלי QA דרך ManagerDashboard)
  // עובד שאינו QA: רואה משימות בלבד
  const visibleNavItems = NAV_ITEMS.filter(item => {
    if (item.key === 'skills') return false;          // employees never see skills matrix
    if (item.key === 'leaves') return isQaTeam;       // only QA team members see vacations
    if (item.key === 'qaTasks') return isQaTester;    // only active QA testers (TesterProfile) see their QA tasks
    return true;                                       // tasks — everyone
  });

  // אפס view אם המשתמש נמצא בלשונית שאינה זמינה לו
  React.useEffect(() => {
    if (!loading && activeView === 'skills') setActiveView('tasks');
    if (!loading && activeView === 'leaves' && !isQaTeam) setActiveView('tasks');
    if (!loading && activeView === 'qaTasks' && !isQaTester) setActiveView('home');
  }, [isQaTeam, isQaTester, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const initials = fullName.split(' ').map((w: string) => w[0]).slice(0, 2).join('');

  // ── Focus Mode derived state ──
  const myFocusName = fullName.trim().toLowerCase();
  const isMyFocusTask = (t: any) =>
    (t.assignedUserId && t.assignedUserId === payload.sub) ||
    (t.assignedUserName && t.assignedUserName.trim().toLowerCase() === myFocusName);
  const myFocusTasks = focusAllTasks.filter(isMyFocusTask);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: FONT, direction: 'rtl', background: C.bgApp, color: C.textPrimary, overflow: 'hidden' }}>

      {/* ── Focus Mode overlay ── */}
      {focusMode && !focusLoading && (
        <FocusModeModal
          phaseLabel={activeVersion?.name}
          tasks={myFocusTasks}
          updatingTaskId={updatingFocusTaskId}
          onAction={updateFocusTask}
          onClose={() => { setFocusMode(false); setActiveView('home'); }}
          isMine={() => true}
        />
      )}

      {/* ─── Header ─── */}
      <div style={{
        background: C.headerBg,
        padding: `0 ${SP[6]}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: '58px', flexShrink: 0,
        borderBottom: `1px solid ${C.border}`,
        boxShadow: SHADOW.xs, zIndex: 100,
      }}>
        <DeployCenterLogo variant="nav" />

        <div style={{ display: 'flex', alignItems: 'center', gap: SP[3] }}>
          {/* Online */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: SP[1],
            background: C.successBg, border: `1px solid ${C.success}33`,
            padding: '4px 10px', borderRadius: RADIUS.full,
          }}>
            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: C.success, boxShadow: `0 0 5px ${C.success}80` }} />
            <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.success }}>{onlineUsers.length}</span>
            <span style={{ ...TEXT.xs, color: C.textMuted }}>מחוברים</span>
          </div>

          {/* Focus Mode */}
          {activeVersion && (
            <button
              onClick={openFocusMode}
              title="פתח מצב הרצה — המשימות שלי"
              style={{
                padding: '7px 14px', background: C.brand, color: 'white',
                border: 'none', borderRadius: RADIUS.md, cursor: 'pointer',
                fontSize: '15px', fontWeight: WEIGHT.bold, fontFamily: FONT,
                display: 'flex', alignItems: 'center', gap: '6px',
              }}>
              ⚡ המשימות שלי
            </button>
          )}

          {/* Push */}
          <button
            onClick={push.subscribed ? push.unsubscribe : push.subscribe}
            disabled={push.loading || !push.supported}
            title={!push.supported ? 'דפדפן זה אינו תומך ב-Push' : push.subscribed ? 'בטל התראות' : 'הפעל התראות'}
            style={{
              width: '34px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `1px solid ${push.subscribed ? C.success + '44' : C.border}`,
              borderRadius: RADIUS.md, cursor: push.supported ? 'pointer' : 'not-allowed',
              background: push.subscribed ? C.successBg : C.bgNested, fontSize: '17px',
              transition: EASE.fast, opacity: push.supported ? 1 : 0.4,
            }}
          >
            {push.loading ? '⏳' : push.subscribed ? '🔔' : '🔕'}
          </button>

          <div style={{ width: '1px', height: '20px', background: C.border }} />

          {/* User */}
          <div style={{ display: 'flex', alignItems: 'center', gap: SP[2] }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '50%',
              background: C.brandDim, border: `1px solid ${C.brand}44`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '14px', fontWeight: WEIGHT.bold, color: C.brand,
            }}>
              {initials}
            </div>
            <span style={{ ...TEXT.sm, color: C.textSecondary }}>{fullName}</span>
          </div>

          {/* Logout */}
          <button
            onClick={onLogout}
            title="יציאה"
            style={{
              width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', color: C.textMuted,
              border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer',
              transition: EASE.fast,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.danger + '44'; e.currentTarget.style.color = C.danger; e.currentTarget.style.background = C.dangerBg; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted; e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ─── Progress chain ─── */}
      {activeVersion && activeView === 'tasks' && (
        <VersionProgressChain versionStatus={activeVersion.status} />
      )}

      {/* ─── Body ─── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* ── Sidebar ── */}
        <div style={{
          width: '240px', minWidth: '240px',
          background: C.sidebarBg,
          borderLeft: `1px solid ${C.sidebarBorder}`,
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
        }}>
          {IS_TEST && (
            <div style={{
              margin: `${SP[3]} ${SP[3]} 0`,
              background: 'rgba(232,175,0,0.15)', border: `1px solid rgba(232,175,0,0.30)`,
              color: '#d4a017', fontSize: '14px', fontWeight: WEIGHT.bold,
              textAlign: 'center', padding: '5px 8px', borderRadius: RADIUS.md,
              letterSpacing: '0.08em', textTransform: 'uppercase' as const,
            }}>⚡ TEST</div>
          )}

          {/* Nav section label */}
          <div style={{
            padding: `16px ${SP[3]} 8px`,
            fontSize: '13px', fontWeight: WEIGHT.bold,
            color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
          }}>
            ניווט
          </div>

          {/* Nav items */}
          <div style={{ padding: `0 ${SP[3]}`, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {visibleNavItems.map(item => {
              const isActive = activeView === item.key;
              const isHov    = hoveredNav === item.key && !isActive;
              return (
                <button key={item.key}
                  onClick={() => setActiveView(item.key)}
                  onMouseEnter={() => setHoveredNav(item.key)}
                  onMouseLeave={() => setHoveredNav(null)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: '11px',
                    padding: `11px ${SP[2]}`, borderRadius: RADIUS.lg, cursor: 'pointer',
                    background: isActive ? C.sidebarBgActive : isHov ? C.sidebarBgHover : 'transparent',
                    border: isActive ? `1px solid rgba(255,255,255,0.12)` : '1px solid transparent',
                    textAlign: 'right' as const, direction: 'rtl', transition: EASE.fast,
                    position: 'relative', overflow: 'hidden',
                  }}>
                  {isActive && (
                    <div style={{ position: 'absolute', right: 0, top: '15%', bottom: '15%', width: '3px', borderRadius: '0 3px 3px 0', background: C.brand, boxShadow: `0 0 8px ${C.brand}80` }} />
                  )}
                  <span style={{ fontSize: '18px', flexShrink: 0, lineHeight: 1 }}>{item.icon}</span>
                  <span style={{
                    fontSize: '17px',
                    fontWeight: isActive ? WEIGHT.semibold : WEIGHT.medium,
                    color: isActive ? C.sidebarText : 'rgba(255,255,255,0.78)',
                    flex: 1,
                  }}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1 }} />

          {/* Team info */}
          {myTeam && (
            <>
              <div style={{ height: '1px', background: C.sidebarBorder, margin: `${SP[2]} ${SP[3]}` }} />
              <div style={{ padding: `${SP[2]} ${SP[3]} ${SP[3]}`, display: 'flex', alignItems: 'center', gap: SP[2] }}>
                <span style={{ fontSize: '17px' }}>👥</span>
                <div>
                  <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)' }}>הצוות שלי</div>
                  <div style={{ fontSize: '15px', fontWeight: WEIGHT.semibold, color: 'rgba(255,255,255,0.85)' }}>{myTeam.name}</div>
                </div>
              </div>
            </>
          )}

          {/* Footer */}
          <div style={{
            padding: `${SP[2]} ${SP[3]}`,
            borderTop: `1px solid ${C.sidebarBorder}`,
            display: 'flex', alignItems: 'center', gap: '8px',
            fontSize: '14px', color: 'rgba(255,255,255,0.35)',
          }}>
            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: C.success, flexShrink: 0, boxShadow: `0 0 4px ${C.success}80` }} />
            <span>DeployCenter v2</span>
          </div>
        </div>

        {/* ── Main content ── */}
        <div style={{ flex: 1, padding: SP[6], overflowY: 'auto', minWidth: 0, minHeight: 0, background: C.bgApp }}>

          {/* ─── Home view ─── */}
          {activeView === 'home' && !loading && (
            <EmployeeHomeView
              fullName={fullName}
              activeVersion={activeVersion}
              planningVersion={planningVersion}
              taskStats={taskStats}
              seasonReminder={seasonReminder}
              teamName={myTeam?.name}
              myRunbookSteps={myRunbookSteps}
              isQaTester={isQaTester}
              myQaTasks={myQaTasks}
              qaSummary={qaSummary}
              targetDefectGroups={targetDefectGroups}
              defectStats={defectStats}
              onGoToTasks={() => setActiveView('tasks')}
              onGoToLeaves={() => setActiveView('leaves')}
              onGoToQaTasks={() => setActiveView('qaTasks')}
              onOpenFocusMode={openFocusMode}
            />
          )}

          {/* ─── Leaves view ─── */}
          {activeView === 'leaves' && <EmployeeLeavesView token={token} />}

          {/* ─── Skills matrix view ─── */}
          {activeView === 'skills' && <QaTestersView token={token} />}

          {/* ─── My QA tasks view ─── */}
          {activeView === 'qaTasks' && (
            <MyQaTasksView
              tasks={myQaTasks}
              versionName={(activeVersion ?? planningVersion)?.name}
              versionId={(activeVersion ?? planningVersion)?.id}
              token={token}
              fullName={fullName}
              targetDefectGroups={targetDefectGroups}
            />
          )}

          {/* ─── Tasks view ─── */}
          {activeView === 'tasks' && (loading ? (
            <div style={{ textAlign: 'center', padding: '80px', color: C.textMuted }}>
              <div style={{ fontSize: '48px' }}>🌙</div>
              <p style={{ fontSize: '17px', marginTop: '12px' }}>טוען...</p>
            </div>
          ) : myTeam ? (
            <>
              {activeVersion ? (
                <>
                  {/* Progress graph */}
                  <div style={{
                    background: 'linear-gradient(135deg, #1a2332 0%, #2d4a7a 100%)',
                    borderRadius: '12px', padding: '20px 24px', marginBottom: '20px', color: 'white',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '15px' }}>
                      <span>התקדמות כללית — {activeVersion.name}</span>
                      <span>{taskStats.done}/{taskStats.total} משימות ({taskStats.total > 0 ? Math.round((taskStats.done / taskStats.total) * 100) : 0}%)</span>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: '8px', height: '12px', overflow: 'hidden' }}>
                      <div style={{
                        background: taskStats.total > 0 && taskStats.done === taskStats.total ? '#27ae60' : '#3498db',
                        width: `${taskStats.total > 0 ? Math.round((taskStats.done / taskStats.total) * 100) : 0}%`,
                        height: '100%', borderRadius: '8px', transition: 'width 0.5s ease',
                      }} />
                    </div>
                    <div style={{ display: 'flex', gap: '12px', marginTop: '14px', flexWrap: 'wrap' }}>
                      {[
                        { label: 'הושלמו',  value: taskStats.done,        color: '#27ae60' },
                        { label: 'בביצוע',  value: taskStats.inProgress,  color: '#f39c12' },
                        { label: 'פתוחות',  value: taskStats.open,        color: '#3498db' },
                        { label: 'ממתינות', value: taskStats.waiting,     color: '#9b59b6' },
                        { label: 'חסומות',  value: taskStats.blocked,     color: '#e74c3c' },
                        { label: 'סה"כ',    value: taskStats.total,       color: 'white'   },
                      ].map(stat => (
                        <div key={stat.label} style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '8px', padding: '8px 14px', textAlign: 'center', minWidth: '64px' }}>
                          <div style={{ fontSize: '20px', fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
                          <div style={{ fontSize: '13px', opacity: 0.8 }}>{stat.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <TeamView token={token} teamId={myTeam.id} teamName={myTeam.name} versionId={activeVersion.id} userId={payload.sub} userName={fullName} refreshKey={refreshKey} hideAddTask hideFocusMode />
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '80px', color: C.textMuted, background: C.bgCard, borderRadius: '16px', border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: '64px' }}>🌙</div>
                  <h2 style={{ color: C.textPrimary, marginTop: '16px' }}>אין הרצה פעילה כרגע</h2>
                  <p style={{ color: C.textMuted }}>סטטוס הגרסה ופרטים נוספים זמינים ב<span onClick={() => setActiveView('home')} style={{ color: C.brand, cursor: 'pointer', fontWeight: 'bold' }}>דף הבית</span>.</p>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '80px', color: C.textMuted, background: C.bgCard, borderRadius: '16px', border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: '64px' }}>👤</div>
              <h2 style={{ color: C.textPrimary, marginTop: '16px' }}>לא שויכת לצוות</h2>
              <p>פנה למנהל הלילה כדי להשתייך לצוות</p>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Toast container ─── */}
      <div style={{
        position: 'fixed', bottom: '24px', left: '24px',
        display: 'flex', flexDirection: 'column', gap: '10px',
        zIndex: 9999, direction: 'rtl',
      }}>
        {toasts.map(t => {
          const colors: Record<string, string> = {
            info: '#2980b9', go: '#27ae60', blocked: '#c0392b', warn: '#e67e22',
          };
          return (
            <div key={t.id} className="toast-slide-in" style={{
              background: colors[t.type] || '#333',
              color: 'white', borderRadius: '10px',
              padding: '12px 16px', minWidth: '260px', maxWidth: '380px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px',
            }}>
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '15px' }}>{t.title}</div>
                {t.body && <div style={{ fontSize: '15px', marginTop: '4px', opacity: 0.9 }}>{t.body}</div>}
              </div>
              <button onClick={() => dismissToast(t.id)} style={{
                background: 'none', border: 'none', color: 'white',
                cursor: 'pointer', fontSize: '17px', lineHeight: 1, opacity: 0.7, flexShrink: 0,
              }}>✕</button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
