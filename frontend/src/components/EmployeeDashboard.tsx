import React, { useState, useEffect } from 'react';
import axios from 'axios';
import pkg from '../../package.json';
const APP_VERSION: string = pkg.version;
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

// Fixed 4-value toast-type palette — approximated onto the semantic tokens.
const TOAST_CLASS: Record<ToastItem['type'], string> = {
  info: 'bg-info', go: 'bg-success', blocked: 'bg-danger', warn: 'bg-warning',
};

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

  // Manual, RM/ADMIN-authored notices for the current version — read-only here
  // (only RM/ADMIN can add/edit, from HomeDashboard), just displayed.
  const [homeNotices, setHomeNotices] = useState<{ id: string; text: string; urgency: string }[]>([]);
  useEffect(() => {
    const versionId = activeVersion?.id ?? planningVersion?.id;
    if (!versionId) { setHomeNotices([]); return; }
    axios.get(`${API}/versions/${versionId}/notices`, { headers })
      .then(res => setHomeNotices(res.data ?? []))
      .catch(() => setHomeNotices([]));
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
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">

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
      <div className="bg-card px-6 flex items-center justify-between h-[58px] shrink-0 border-b border-border shadow-xs z-[100]">
        <DeployCenterLogo variant="nav" />

        <div className="flex items-center gap-3">
          {/* Online */}
          <div className="flex items-center gap-1 bg-success-bg border border-success/20 px-2.5 py-1 rounded-full">
            <div className="w-[7px] h-[7px] rounded-full bg-success shadow-[0_0_5px_rgba(22,163,74,0.5)]" />
            <span className="text-xs font-semibold text-success">{onlineUsers.length}</span>
            <span className="text-xs text-subtle-foreground">מחוברים</span>
          </div>

          {/* Focus Mode */}
          {activeVersion && (
            <button
              onClick={openFocusMode}
              title="פתח מצב הרצה — המשימות שלי"
              className="px-3.5 py-[7px] bg-primary text-white border-none rounded-md cursor-pointer text-[15px] font-bold flex items-center gap-1.5">
              ⚡ המשימות שלי
            </button>
          )}

          {/* Push */}
          <button
            onClick={push.subscribed ? push.unsubscribe : push.subscribe}
            disabled={push.loading || !push.supported}
            title={!push.supported ? 'דפדפן זה אינו תומך ב-Push' : push.subscribed ? 'בטל התראות' : 'הפעל התראות'}
            className={`w-[34px] h-[34px] flex items-center justify-center rounded-md text-[17px] border transition-[background-color,border-color] duration-fast ease-out ${push.subscribed ? 'border-success/30 bg-success-bg' : 'border-border bg-muted'} ${push.supported ? 'cursor-pointer opacity-100' : 'cursor-not-allowed opacity-40'}`}
          >
            {push.loading ? '⏳' : push.subscribed ? '🔔' : '🔕'}
          </button>

          <div className="w-px h-5 bg-border" />

          {/* User */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary-50 border border-primary/30 flex items-center justify-center text-sm font-bold text-primary">
              {initials}
            </div>
            <span className="text-sm text-muted-foreground">{fullName}</span>
          </div>

          {/* Logout */}
          <button
            onClick={onLogout}
            title="יציאה"
            className="w-8 h-8 flex items-center justify-center bg-transparent text-subtle-foreground border border-border rounded-md cursor-pointer transition-[background-color,border-color,color] duration-fast ease-out hover:border-danger/30 hover:text-danger hover:bg-danger-bg"
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
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Sidebar ── */}
        <div className="w-60 min-w-[240px] bg-[#14152A] border-s border-[#2A2C52] flex flex-col overflow-y-auto">
          {IS_TEST && (
            <div className="mx-3 mt-3 bg-warning/15 border border-warning/30 text-[#d4a017] text-sm font-bold text-center px-2 py-1.5 rounded-md tracking-wider uppercase">⚡ TEST</div>
          )}

          {/* Nav section label */}
          <div className="pt-4 px-3 pb-2 text-[13px] font-bold text-white/35 tracking-wider uppercase">
            ניווט
          </div>

          {/* Nav items */}
          <div className="px-3 flex flex-col gap-0.5">
            {visibleNavItems.map(item => {
              const isActive = activeView === item.key;
              const isHov    = hoveredNav === item.key && !isActive;
              return (
                <button key={item.key}
                  onClick={() => setActiveView(item.key)}
                  onMouseEnter={() => setHoveredNav(item.key)}
                  onMouseLeave={() => setHoveredNav(null)}
                  className={`w-full flex items-center gap-[11px] px-2 py-[11px] rounded-lg cursor-pointer text-right relative overflow-hidden border transition-[background-color] duration-fast ease-out ${isActive ? 'bg-[#2A2C52] border-white/10' : isHov ? 'bg-[#1F2140] border-transparent' : 'bg-transparent border-transparent'}`}>
                  {isActive && (
                    <div className="absolute start-0 top-[15%] bottom-[15%] w-[3px] rounded-[0_3px_3px_0] bg-primary shadow-[0_0_8px_rgba(94,106,210,0.5)]" />
                  )}
                  <span className="text-lg shrink-0 leading-none">{item.icon}</span>
                  <span className={`text-[17px] flex-1 ${isActive ? 'font-semibold text-white' : 'font-medium text-white/[.78]'}`}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex-1" />

          {/* Team info */}
          {myTeam && (
            <>
              <div className="h-px bg-[#2A2C52] mx-3 my-2" />
              <div className="px-3 pt-2 pb-3 flex items-center gap-2">
                <span className="text-[17px]">👥</span>
                <div>
                  <div className="text-sm text-white/50">הצוות שלי</div>
                  <div className="text-[15px] font-semibold text-white/85">{myTeam.name}</div>
                </div>
              </div>
            </>
          )}

          {/* Footer */}
          <div className="px-3 py-2 border-t border-[#2A2C52] flex items-center gap-2 text-sm text-white/35">
            <div className="w-[7px] h-[7px] rounded-full bg-success shrink-0 shadow-[0_0_4px_rgba(22,163,74,0.5)]" />
            <span>DeployCenter v{APP_VERSION}</span>
          </div>
        </div>

        {/* ── Main content ── */}
        <div className="flex-1 p-6 overflow-y-auto min-w-0 min-h-0 bg-background">

          {/* ─── Home view ─── */}
          {activeView === 'home' && !loading && (
            <EmployeeHomeView
              fullName={fullName}
              activeVersion={activeVersion}
              planningVersion={planningVersion}
              taskStats={taskStats}
              seasonReminder={seasonReminder}
              teamName={myTeam?.name}
              homeNotices={homeNotices}
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
            <div className="text-center p-20 text-subtle-foreground">
              <div className="text-5xl">🌙</div>
              <p className="text-[17px] mt-3">טוען...</p>
            </div>
          ) : myTeam ? (
            <>
              {activeVersion ? (
                <>
                  {/* Progress graph */}
                  <div className="bg-[linear-gradient(135deg,#1a2332_0%,#2d4a7a_100%)] rounded-xl px-6 py-5 mb-5 text-white">
                    <div className="flex justify-between mb-1.5 text-[15px]">
                      <span>התקדמות כללית — {activeVersion.name}</span>
                      <span>{taskStats.done}/{taskStats.total} משימות ({taskStats.total > 0 ? Math.round((taskStats.done / taskStats.total) * 100) : 0}%)</span>
                    </div>
                    <div className="bg-white/20 rounded-lg h-3 overflow-hidden">
                      <div
                        className={`h-full rounded-lg transition-[width] duration-slow ease-out ${taskStats.total > 0 && taskStats.done === taskStats.total ? 'bg-[#27ae60]' : 'bg-[#3498db]'}`}
                        style={{ width: `${taskStats.total > 0 ? Math.round((taskStats.done / taskStats.total) * 100) : 0}%` }}
                      />
                    </div>
                    <div className="flex gap-3 mt-3.5 flex-wrap">
                      {[
                        { label: 'הושלמו',  value: taskStats.done,        color: '#27ae60' },
                        { label: 'בביצוע',  value: taskStats.inProgress,  color: '#f39c12' },
                        { label: 'פתוחות',  value: taskStats.open,        color: '#3498db' },
                        { label: 'ממתינות', value: taskStats.waiting,     color: '#9b59b6' },
                        { label: 'חסומות',  value: taskStats.blocked,     color: '#e74c3c' },
                        { label: 'סה"כ',    value: taskStats.total,       color: 'white'   },
                      ].map(stat => (
                        <div key={stat.label} className="bg-white/10 rounded-lg px-3.5 py-2 text-center min-w-[64px]">
                          <div className="text-xl font-bold" style={{ color: stat.color }}>{stat.value}</div>
                          <div className="text-[13px] opacity-80">{stat.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <TeamView token={token} teamId={myTeam.id} teamName={myTeam.name} versionId={activeVersion.id} userId={payload.sub} userName={fullName} refreshKey={refreshKey} hideAddTask hideFocusMode />
                </>
              ) : (
                <div className="text-center p-20 text-subtle-foreground bg-card rounded-2xl border border-border">
                  <div className="text-6xl">🌙</div>
                  <h2 className="text-foreground mt-4">אין הרצה פעילה כרגע</h2>
                  <p className="text-subtle-foreground">סטטוס הגרסה ופרטים נוספים זמינים ב<span onClick={() => setActiveView('home')} className="text-primary cursor-pointer font-bold">דף הבית</span>.</p>
                </div>
              )}
            </>
          ) : (
            <div className="text-center p-20 text-subtle-foreground bg-card rounded-2xl border border-border">
              <div className="text-6xl">👤</div>
              <h2 className="text-foreground mt-4">לא שויכת לצוות</h2>
              <p>פנה למנהל הלילה כדי להשתייך לצוות</p>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Toast container ─── */}
      <div className="fixed bottom-6 end-6 flex flex-col gap-2.5 z-[9999]">
        {toasts.map(t => (
          <div key={t.id} className={`toast-slide-in ${TOAST_CLASS[t.type] ?? 'bg-neutral-800'} text-white rounded-[10px] px-4 py-3 min-w-[260px] max-w-[380px] shadow-lg flex justify-between items-start gap-2.5`}>
            <div>
              <div className="font-bold text-[15px]">{t.title}</div>
              {t.body && <div className="text-[15px] mt-1 opacity-90">{t.body}</div>}
            </div>
            <button onClick={() => dismissToast(t.id)} className="bg-transparent border-none text-white cursor-pointer text-[17px] leading-none opacity-70 shrink-0">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
};
