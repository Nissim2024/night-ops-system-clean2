import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { HomeDashboard } from './HomeDashboard';
import { VersionsView } from './VersionsView';
import { ImportView } from './ImportView';
import { WarRoom } from './WarRoom';
import { NightSummary } from './NightSummary';
import { TeamView } from './TeamView';
import { Sidebar } from './Sidebar';
import { useSocket } from '../hooks/useSocket';
import { TimelineView } from './TimelineView';
import { AdminPanel } from './AdminPanel';
import { usePermissions } from '../context/PermissionsContext';
import { playTaskReady } from '../utils/sound';
import { DeployCenterLogo } from './DeployCenterLogo';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { VersionProgressChain } from './VersionProgressChain';
import { VersionHub } from './VersionHub';
import { TeamLeadProposalView } from './TeamLeadProposalView';
import { CrHandoffView } from './CrHandoffView';
import { CrReviewView } from './CrReviewView';
import { ImplementationPlansView } from './ImplementationPlansView';
import { CrManagerView } from './CrManagerView';
import { QaSeasonsView } from './qa/QaSeasonsView';
import { QaLeavesView } from './qa/QaLeavesView';
import { QaSkillsView } from './qa/QaSkillsView';
import { QaTestersView } from './qa/QaTestersView';
import QaAssignmentView from './qa/QaAssignmentView';
import QaWorkPlanView from './qa/QaWorkPlanView';
import { FEATURES } from '../featureFlags';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE, versionStatusColor, versionStatusLabel } from '../theme';
import { useDialog } from '../context/DialogContext';
import { Avatar, Badge, VersionStatusChip } from './ui';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Props {
  token: string;
  onLogout: () => void;
}

interface ToastItem {
  id: string;
  type: 'blocked' | 'go' | 'nogo' | 'version' | 'info';
  title: string;
  body?: string;
}

export const ManagerDashboard: React.FC<Props> = ({ token, onLogout }) => {
  const appDialog = useDialog();
  type Tab = 'home' | 'list' | 'version-detail' | 'proposals' | 'cr-review' | 'board' | 'overview' | 'timeline' | 'dashboard' | 'summary-rehearsal' | 'summary-night' | 'admin' | 'implementation-plans' | 'cr-manager';
  const [activeTab, setActiveTab]               = useState<Tab>(() => {
    try { return JSON.parse(atob(token.split('.')[1])).role === 'CR_MANAGER' ? 'cr-manager' : 'home'; }
    catch { return 'home'; }
  });
  const [myTasksMode, setMyTasksMode]           = useState(false);
  const [versions, setVersions]                 = useState<any[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [onlineUsers, setOnlineUsers]           = useState<any[]>([]);

  const [endNightLoading, setEndNightLoading]   = useState(false);
  const [endNightError, setEndNightError]       = useState<string | null>(null);
  const [endNightBlockers, setEndNightBlockers] = useState<any[]>([]);
  const [endNightPending, setEndNightPending]   = useState<number>(0); // pending tasks count when force is available
  const [summaryReady, setSummaryReady]         = useState(false);
  const [currentPhaseName, setCurrentPhaseName] = useState<string | null>(null);
  const [archiveLoading, setArchiveLoading]     = useState(false);
  const [versionFilter, setVersionFilter]       = useState<'active' | 'inactive' | 'archived'>('active');
  const [blockerReasons, setBlockerReasons]     = useState<Record<string, string>>({});
  const [savingReason, setSavingReason]         = useState<string | null>(null);
  const [activeRunPhase, setActiveRunPhase]     = useState<number>(1);
  const [dialog, setDialog]                     = useState<DialogConfig | null>(null);
  const [toasts, setToasts]                     = useState<ToastItem[]>([]);
  const [warRoomRefresh, setWarRoomRefresh]      = useState(0);
  const [myTeamId, setMyTeamId]                 = useState('');
  const [openNewVersionForm, setOpenNewVersionForm] = useState(false);
  const [activeModule, setActiveModule] = useState<'deployments' | 'qa'>('deployments');
  const [activeQaView, setActiveQaView]  = useState('testers');
  const [isQaTeamMember, setIsQaTeamMember] = useState(false);

  const payload  = JSON.parse(atob(token.split('.')[1]));
  const fullName = localStorage.getItem('deploycenter_fullName') || payload.fullName || 'מנהל';
  const headers  = { Authorization: `Bearer ${token}` };
  const { can } = usePermissions();
  const push = usePushNotifications(token);

  // לחיצה על גרסה בתפריט → תמיד דף נחיתה (Hub)
  useEffect(() => {
    if (!selectedVersionId || !versions.length) return;
    const v = versions.find(x => x.id === selectedVersionId);
    setActiveTab(
      payload.role === 'CR_MANAGER' ? 'cr-manager' :
      payload.role === 'TEAM_LEAD' && v?.status === 'COLLECTING' ? 'proposals' :
      'list'
    );
    setMyTasksMode(false);
  }, [selectedVersionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useSocket({
    userId: payload.sub,
    fullName,
    onTaskUpdated: (task) => {
      setWarRoomRefresh(n => n + 1);
      window.dispatchEvent(new CustomEvent('deploycenter:taskUpdated', { detail: task }));
      if (task?.assignedUserId === payload.sub && task?.status === 'OPEN') {
        playTaskReady();
        showToast({ type: 'info', title: '🔔 משימה מוכנה להתחלה', body: task.title }, 8000);
        return;
      }
      if (['RELEASE_MANAGER', 'ADMIN'].includes(payload.role)) {
        const userName = task?.assignedUserName || task?.assignedUser?.fullName || '';
        const name = userName ? `${userName}: ` : '';
        if (task?.status === 'IN_PROGRESS') {
          showToast({ type: 'info', title: '▶️ משימה החלה', body: `${name}${task.title}` }, 6000);
        } else if (task?.status === 'DONE') {
          showToast({ type: 'go', title: '✅ משימה הושלמה', body: `${name}${task.title}` }, 6000);
        }
      }
    },
    onTaskBlocked: (task) => {
      setWarRoomRefresh(n => n + 1);
      window.dispatchEvent(new CustomEvent('deploycenter:taskUpdated', { detail: task }));
      showToast({
        type: 'blocked',
        title: `🚨 משימה חסומה`,
        body: `${task.title}${task.blockedReason ? ` — ${task.blockedReason}` : ''}`,
      }, 12000);
    },
    onGoDecision: (d) => {
      showToast({
        type: d.go ? 'go' : 'nogo',
        title: d.go ? '✅ GO — ניתן להמשיך!' : '🛑 NO GO — עצור!',
        body: d.message || undefined,
      }, d.go ? 8000 : 12000);
    },
    onVersionUpdated: (v) => {
      const labels: Record<string, { title: string; body: string; type: ToastItem['type'] }> = {
        ACTIVE:        { type: 'version', title: '🌙 ליל ההטמעה מתחיל!',   body: `גרסה ${v.name} עברה למצב פעיל` },
        MORNING_AFTER: { type: 'version', title: '☀️ בוקר שלמחרת',          body: `גרסה ${v.name} — שלב הבוקר החל` },
        COMPLETED:     { type: 'go',      title: '✅ גרסה הושלמה',           body: `גרסה ${v.name} הושלמה בהצלחה` },
        ROLLED_BACK:   { type: 'blocked', title: '⏪ Rollback בוצע',         body: `גרסה ${v.name} — בוצע חזרה לאחור` },
      };
      const info = labels[v.status];
      if (info) showToast(info, v.status === 'ROLLED_BACK' ? 15000 : 8000);
    },
    onJoined:     (users) => setOnlineUsers(users.filter((u, i, arr) => arr.findIndex(x => x.userId === u.userId) === i)),
    onUserOnline: (u)     => setOnlineUsers(prev => [...prev.filter(x => x.userId !== u.userId), u]),
    onUserOffline:(u)     => setOnlineUsers(prev => prev.filter(x => x.userId !== u.userId)),
    onProposalCreated: (data) => {
      window.dispatchEvent(new CustomEvent('deploycenter:proposalCreated', { detail: data }));
    },
    onTeamSubmitted: (data) => {
      if (!['RELEASE_MANAGER', 'ADMIN'].includes(payload.role)) return;
      showToast({
        type: 'info',
        title: `📥 ${data.teamName} הגישו`,
        body: `${data.submittedCount} מתוך ${data.totalTeams} צוותים הגישו`,
      }, 8000);
      window.dispatchEvent(new CustomEvent('deploycenter:teamSubmitted', { detail: data }));
    },
    onAllTeamsSubmitted: (data) => {
      if (!['RELEASE_MANAGER', 'ADMIN'].includes(payload.role)) return;
      showToast({
        type: 'go',
        title: '✅ כל הצוותים הגישו!',
        body: `${data.totalTeams} צוותים — ניתן לאשר ולשבץ משימות`,
      }, 12000);
      window.dispatchEvent(new CustomEvent('deploycenter:allTeamsSubmitted', { detail: data }));
    },
  });

  const fetchVersions = () => {
    return axios.get(`${API}/versions`, { headers }).then(r => {
      setVersions(r.data);
      setSelectedVersionId(prev => {
        if (r.data.some((v: any) => v.id === prev)) return prev;
        const active = r.data.find((v: any) => ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(v.status));
        if (active) return active.id;
        const inactive = r.data.find((v: any) => !v.isArchived && !['ACTIVE', 'REHEARSAL', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(v.status));
        if (inactive) return inactive.id;
        // Never auto-select archived/completed versions — user must choose explicitly
        return '';
      });
    });
  };

  const handleGoLive = (versionId: string, _versionName: string, isRehearsal: boolean) => {
    setVersionFilter('active');
    setSelectedVersionId(versionId);
    setActiveTab('board');
    fetchVersions();
  };

  useEffect(() => {
    fetchVersions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch own team for TEAM_LEAD role (used to filter tasks by team when lacking view_all_teams permission)
  useEffect(() => {
    axios.get(`${API}/teams`, { headers }).then(res => {
      const teams: any[] = res.data ?? [];
      const qaTeam = teams.find((t: any) =>
        t.name?.toLowerCase().includes('qa') &&
        t.members?.some((m: any) => (m.userId || m.user?.id) === payload.sub)
      );
      setIsQaTeamMember(!!qaTeam);
      if (payload.role === 'TEAM_LEAD') {
        const myTeam = teams.find((t: any) =>
          t.members?.some((m: any) => m.userId === payload.sub || m.user?.id === payload.sub)
        );
        if (myTeam) setMyTeamId(myTeam.id);
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync filter to match selected version's category (when version changes or its status changes)
  const selectedVersionStatus = versions.find((x: any) => x.id === selectedVersionId)?.status;
  const selectedVersionIsArchived = versions.find((x: any) => x.id === selectedVersionId)?.isArchived;
  useEffect(() => {
    if (!selectedVersionId || !versions.length) return;
    const v = versions.find((x: any) => x.id === selectedVersionId);
    if (!v) return;
    setVersionFilter(versionCategory(v));
  }, [selectedVersionId, selectedVersionStatus, selectedVersionIsArchived]); // eslint-disable-line

  // When filter tab changes: auto-select for active/inactive; archive requires manual pick
  useEffect(() => {
    if (!versions.length) return;
    const filtered = versions.filter((v: any) => versionCategory(v) === versionFilter);
    if (filtered.length === 0) {
      // No versions in this category — clear selection
      setSelectedVersionId('');
    } else if (versionFilter === 'archived') {
      // Archive: only keep current if it's in the list; never auto-pick
      if (!filtered.some((v: any) => v.id === selectedVersionId)) {
        setSelectedVersionId('');
      }
    } else {
      // Active / inactive: auto-select first if current isn't in the list
      if (!filtered.some((v: any) => v.id === selectedVersionId)) {
        setSelectedVersionId(filtered[0].id);
      }
    }
  }, [versionFilter]); // eslint-disable-line

  // Reset stale per-version state when switching versions
  useEffect(() => {
    setSummaryReady(false);
    setCurrentPhaseName(null);
    setEndNightError(null);
    setEndNightBlockers([]);
    setBlockerReasons({});
  }, [selectedVersionId]); // eslint-disable-line

  // Compute which phase (1-4) is currently active within ACTIVE/REHEARSAL versions
  useEffect(() => {
    const v = versions.find((x: any) => x.id === selectedVersionId);
    if (!v || !['ACTIVE', 'REHEARSAL'].includes(v.status)) { setActiveRunPhase(1); return; }
    axios.get(`${API}/versions/${selectedVersionId}`, { headers })
      .then(res => {
        const phases = [...(res.data.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
        let donePhasesCount = 0;
        for (const ph of phases) {
          const tasks = (ph.subPhases || []).flatMap((sp: any) => sp.tasks || []);
          const nightTasks = tasks.filter((t: any) => t.status !== 'WAITING');
          if (nightTasks.length > 0 && nightTasks.every((t: any) => t.status === 'DONE')) {
            donePhasesCount++;
          } else break;
        }
        setActiveRunPhase(Math.min(donePhasesCount + 1, 4));
      })
      .catch(() => {});
  }, [selectedVersionId, versions]); // eslint-disable-line

  const parseMins = (dur: string | null): number | null => {
    if (!dur) return null;
    const hM = dur.match(/(\d+)ש/); const mM = dur.match(/(\d+)ד/);
    if (hM || mM) return (hM ? +hM[1] * 60 : 0) + (mM ? +mM[1] : 0);
    const n = parseInt(dur); return isNaN(n) ? null : n;
  };

  const fmtMins = (m: number) => m >= 60 ? `${Math.floor(m/60)}ש' ${m%60}דק'` : `${m}דק'`;

  const DELAY_REASONS = [
    'תקלה טכנית בלתי צפויה','תלות שלא הושלמה בזמן','בדיקות / Rollback נדרשו',
    'בעיית גישה / הרשאות','עיכוב בצוות / לא ענו','בעיית תקשורת / רשת',
    'בעיית סביבה / תשתית','תיאום בעיה עם צוות אחר','לא סומן בזמן (בוצע אך לא עודכן)','אחר',
  ];

  const computeBlockers = (tasks: any[]) => tasks.filter((t: any) => {
    if (!['DONE', 'FAILED', 'ROLLED_BACK'].includes(t.status)) return false;
    if (t.delayReason) return false;
    const actualM = t.actualStart && t.actualFinish
      ? Math.round((new Date(t.actualFinish).getTime() - new Date(t.actualStart).getTime()) / 60000) : null;
    const plannedM = parseMins(t.duration) ||
      (t.plannedStart && t.plannedEnd
        ? Math.round((new Date(t.plannedEnd).getTime() - new Date(t.plannedStart).getTime()) / 60000) : null);
    return !!(actualM && plannedM && actualM >= plannedM * 2);
  }).map((t: any) => {
    const actualM = Math.round((new Date(t.actualFinish).getTime() - new Date(t.actualStart).getTime()) / 60000);
    const plannedM = parseMins(t.duration) ||
      Math.round((new Date(t.plannedEnd).getTime() - new Date(t.plannedStart).getTime()) / 60000);
    return { ...t, actualM, plannedM };
  });

  const endNight = async () => {
    setEndNightLoading(true);
    setEndNightError(null);
    setEndNightBlockers([]);
    setBlockerReasons({});
    try {
      // Transition to morning-after phase (not directly to COMPLETED)
      await axios.patch(`${API}/versions/${selectedVersionId}/status`, { status: 'MORNING_AFTER' }, { headers });
      await fetchVersions();
      setActiveTab('summary-night');
    } catch (err: any) {
      setEndNightError(err?.response?.data?.message || err?.message || 'שגיאה');
    } finally {
      setEndNightLoading(false);
    }
  };

  const saveBlockerReason = async (taskId: string) => {
    const reason = blockerReasons[taskId]?.trim();
    if (!reason) return;
    setSavingReason(taskId);
    try {
      await axios.patch(`${API}/tasks/${taskId}`, { delayReason: reason }, { headers });
      const remaining = endNightBlockers.filter(t => t.id !== taskId);
      setEndNightBlockers(remaining);
      setBlockerReasons(prev => { const n = {...prev}; delete n[taskId]; return n; });
      if (remaining.length === 0) {
        setEndNightError(null);
        endNight(); // auto-retry once all reasons filled
      }
    } catch { /* ignore */ }
    finally { setSavingReason(null); }
  };

  const showToast = (toast: Omit<ToastItem, 'id'>, duration = 9000) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev.slice(-4), { ...toast, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  };

  const dismissToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  const ACTIVE_STATUSES = ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'];

  const versionCategory = (v: any): 'active' | 'inactive' | 'archived' => {
    if (v.isArchived) return 'archived';
    if (ACTIVE_STATUSES.includes(v.status)) return 'active';
    return 'inactive'; // כולל COMPLETED ו-ROLLED_BACK שטרם עברו לארכיון
  };

  const filteredVersions = versions.filter(v => versionCategory(v) === versionFilter);

  const handleVersionFocus = (versionId: string) => {
    const v = versions.find(x => x.id === versionId);
    if (v) {
      setVersionFilter(versionCategory(v));
      setSelectedVersionId(versionId);
      // Always navigate on version click — including same-version re-click (useEffect won't fire then)
      setActiveTab(
        payload.role === 'CR_MANAGER' ? 'cr-manager' :
        payload.role === 'TEAM_LEAD' && v.status === 'COLLECTING' ? 'proposals' :
        'list'
      );
      setMyTasksMode(false);
    }
  };

  const selectedVersion = versions.find(v => v.id === selectedVersionId);
  const vStatus = selectedVersion?.status;
  const isRehearsal = vStatus === 'REHEARSAL';
  const isMorningAfter = vStatus === 'MORNING_AFTER';

  // True when a version-specific tab should show NoVersionsForFilter instead of content
  const noVersionGuard = filteredVersions.length === 0 || (versionFilter === 'archived' && !selectedVersionId);

  const isExecution = ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(vStatus ?? '');
  const hasRun = !!(selectedVersion?.lastRehearsalAt ||
    ['REHEARSAL', 'ACTIVE', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(vStatus ?? ''));
  // סיכום אושר לפני שמשימות הבוקר הסתיימו (force-approved while morning tasks pending)
  const summaryBeforeMorning = !!(selectedVersion?.nightSummary?.forceApprovedBy && vStatus !== 'COMPLETED');

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'list',           label: 'גרסה',     icon: '🏠' },
    { key: 'version-detail', label: 'פרטים',    icon: '📋' },
    { key: 'proposals',      label: 'הגשות',    icon: '📝' },
    { key: 'cr-review', label: 'סקירת CR', icon: '🔍' },
    { key: 'board',     label: 'לוח',      icon: '⬛' },
    { key: 'overview',  label: 'סקירה',    icon: '👥' },
    { key: 'timeline',  label: 'ציר זמן',  icon: '⏱' },
    { key: 'dashboard', label: 'לוח בקרה', icon: '🎛' },
    { key: 'summary-rehearsal',    label: 'סיכום חזרה',   icon: '🎭' },
    { key: 'summary-night',       label: 'סיכום לילה',   icon: '🌙' },
    { key: 'implementation-plans', label: 'תוכניות הטמעה', icon: '📁' },
    { key: 'cr-manager',          label: 'לוח מנהל CR',   icon: '🛡' },
  ];

  const crManagerTab = TABS.find(t => t.key === 'cr-manager')!;
  const visibleTabs = [
    // CR Manager tab is always shown for CR_MANAGER (cross-version, no version selection needed)
    ...(['CR_MANAGER', 'RELEASE_MANAGER', 'ADMIN'].includes(payload.role) ? [crManagerTab] : []),
    ...(selectedVersionId ? TABS.filter(tab => {
      if (tab.key === 'cr-manager') return false;
      switch (tab.key) {
        case 'list':           return true;
        case 'version-detail': return can('screen:prep');
        case 'proposals': return payload.role === 'TEAM_LEAD'
          ? ['COLLECTING', 'CR_REVIEW'].includes(vStatus ?? '')
          : ['COLLECTING', 'CR_REVIEW', 'REFINING'].includes(vStatus ?? '') && can('screen:prep');
        case 'cr-review': return ['CR_REVIEW', 'REFINING', 'REVIEW', 'APPROVED', 'REHEARSAL', 'ACTIVE', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(vStatus ?? '') &&
                                 ['RELEASE_MANAGER', 'ADMIN'].includes(payload.role);
        case 'board':     return isExecution || ['COMPLETED', 'ROLLED_BACK'].includes(vStatus ?? '');
        case 'overview':  return isExecution;
        case 'timeline':  return can('screen:timeline') && !!(hasRun || selectedVersion?.plannedStart);
        case 'dashboard': return isExecution && can('screen:night');
        case 'summary-rehearsal': return can('screen:summary') && !!selectedVersion?.lastRehearsalAt;
        case 'summary-night':    return can('screen:summary') && !!(selectedVersion?.actualStart || ['ACTIVE','MORNING_AFTER','COMPLETED','ROLLED_BACK'].includes(vStatus ?? ''));
        case 'implementation-plans': return ['COLLECTING', 'CR_REVIEW', 'REFINING', 'REVIEW', 'APPROVED', 'REHEARSAL', 'ACTIVE', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(vStatus ?? '') &&
                                            ['RELEASE_MANAGER', 'ADMIN', 'CR_MANAGER'].includes(payload.role);
        default:          return false;
      }
    }) : []),
  ];

  return (
    <div style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: C.bgApp, fontFamily: FONT, direction: 'rtl', color: C.textPrimary }}>

      {/* ─── Header ─── */}
      <div style={{
        background: C.headerBg,
        padding: `0 ${SP[6]}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: '58px',
        borderBottom: `1px solid ${C.border}`,
        flexShrink: 0, zIndex: 100,
        fontFamily: FONT,
        boxShadow: SHADOW.xs,
      }}>
        {/* ── Right side: Logo + current version indicator ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: SP[3] }}>
          <DeployCenterLogo variant="nav" />
          {selectedVersion && (
            <>
              <div style={{ width: '1px', height: '20px', background: C.border }} />
              <span
                onClick={() => setActiveTab('list')}
                title="עבור לדף הנחיתה"
                style={{ ...TEXT.sm, fontWeight: WEIGHT.medium, color: C.textPrimary, fontFamily: FONT, cursor: 'pointer', textDecoration: 'underline dotted' }}
              >
                {selectedVersion.name}
              </span>
              <VersionStatusChip status={selectedVersion.status} size="xs" />
            </>
          )}
        </div>

        {/* ── Left side: Online users, Push, User, Logout ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: SP[3] }}>

          {/* Online users */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: SP[2],
            background: C.successBg,
            border: `1px solid ${C.success}33`,
            padding: '4px 10px', borderRadius: RADIUS.full,
          }}>
            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: C.success, boxShadow: `0 0 5px ${C.success}80` }} />
            <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.success }}>{onlineUsers.length}</span>
            <span style={{ ...TEXT.xs, color: C.textMuted }}>מחוברים</span>
          </div>

          {/* Push notification toggle */}
          <button
            onClick={push.subscribed ? push.unsubscribe : push.subscribe}
            disabled={push.loading || !push.supported}
            title={!push.supported ? 'דפדפן זה אינו תומך ב-Push' : push.subscribed ? 'בטל התראות' : 'הפעל התראות'}
            style={{
              width: '34px', height: '34px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `1px solid ${push.subscribed ? C.success + '44' : C.border}`,
              borderRadius: RADIUS.md,
              cursor: push.supported ? 'pointer' : 'not-allowed',
              background: push.subscribed ? C.successBg : C.bgNested,
              fontSize: '16px',
              transition: EASE.fast,
              opacity: push.supported ? 1 : 0.4,
            }}
          >
            {push.loading ? '⏳' : push.subscribed ? '🔔' : '🔕'}
          </button>

          {/* Divider */}
          <div style={{ width: '1px', height: '20px', background: C.border }} />

          {/* User */}
          <div style={{ display: 'flex', alignItems: 'center', gap: SP[2] }}>
            <Avatar name={fullName} size={28} />
            <span style={{ ...TEXT.sm, color: C.textSecondary, maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fullName}
            </span>
            <Badge color={
              payload.role === 'ADMIN' ? C.statusFailed :
              payload.role === 'RELEASE_MANAGER' ? C.brand :
              payload.role === 'CR_MANAGER' ? C.statusOpen :
              payload.role === 'TEAM_LEAD' ? C.warning : C.textMuted
            } bg={
              payload.role === 'ADMIN' ? C.dangerBg :
              payload.role === 'RELEASE_MANAGER' ? C.brandDim :
              payload.role === 'CR_MANAGER' ? C.infoBg :
              payload.role === 'TEAM_LEAD' ? C.warningBg : C.bgActive
            }>
              {payload.role === 'ADMIN' ? 'ADMIN' :
               payload.role === 'RELEASE_MANAGER' ? 'MANAGER' :
               payload.role === 'CR_MANAGER' ? 'CR MGR' :
               payload.role === 'TEAM_LEAD' ? 'LEAD' : payload.role}
            </Badge>
          </div>

          {/* Logout */}
          <button
            onClick={onLogout}
            title="יציאה מהמערכת"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '32px', height: '32px',
              background: 'transparent', color: C.textMuted,
              border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer',
              transition: EASE.fast,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = C.danger + '44';
              e.currentTarget.style.color = C.danger;
              e.currentTarget.style.background = C.dangerBg;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = C.border;
              e.currentTarget.style.color = C.textMuted;
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ─── Progress Chain — only when selected version matches current filter ─── */}
      {activeModule === 'deployments' && selectedVersion && versionFilter !== 'archived' && filteredVersions.some(v => v.id === selectedVersionId) && (
        <VersionProgressChain
          versionStatus={selectedVersion.status}
          activeRunPhase={activeRunPhase}
          rehearsalDone={!!selectedVersion.lastRehearsalAt}
          summaryBeforeMorning={summaryBeforeMorning}
          onStageClick={(stageId) => {
            if (stageId === 'rehearsal' && selectedVersion.lastRehearsalAt) setActiveTab('summary-rehearsal');
            else if (stageId === 'run' || stageId === 'done') setActiveTab(isExecution ? 'board' : 'summary-night');
            else if (stageId === 'prep') setActiveTab('list');
          }}
        />
      )}

      {/* ─── Tab Bar — Admin only ─── */}
      {activeModule === 'deployments' && payload.role === 'ADMIN' && activeTab === 'admin' && (
        <div style={{
          background: C.headerBg, borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', padding: `0 ${SP[4]}`,
          flexShrink: 0, zIndex: 90, boxShadow: SHADOW.xs,
        }}>
          <button onClick={() => setActiveTab('list')}
            style={{ padding: `12px ${SP[4]}`, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, ...TEXT.sm, color: C.textMuted, display: 'flex', alignItems: 'center', gap: '5px' }}>
            ← חזור
          </button>
          <button onClick={() => setActiveTab('admin')}
            style={{ padding: `12px ${SP[4]}`, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, borderBottom: `2px solid ${C.brand}`, marginBottom: '-1px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: '13px' }}>⚙️</span>
            ניהול
          </button>
        </div>
      )}

      {/* ─── Body ─── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* ─── Sidebar (first = right in RTL) ─── */}
        <Sidebar
          versions={versions}
          selectedVersionId={selectedVersionId}
          onVersionChange={handleVersionFocus}
          myTasksActive={myTasksMode}
          onMyTasksClick={() => { setMyTasksMode(m => !m); setActiveTab('board'); }}
          showAdmin={payload.role === 'ADMIN'}
          onAdminClick={() => { setActiveModule('deployments'); setActiveTab('admin'); }}
          activeTab={activeTab}
          onNewVersionClick={['ADMIN', 'RELEASE_MANAGER'].includes(payload.role) ? () => { setSelectedVersionId(''); setVersionFilter('inactive'); setActiveTab('list'); setOpenNewVersionForm(true); } : undefined}
          activeModule={activeModule}
          onModuleChange={m => { if (m === 'qa' && !isQaTeamMember && payload.role !== 'ADMIN') return; setActiveModule(m); if (m === 'qa') setActiveQaView('testers'); }}
          activeQaView={activeQaView}
          onQaViewChange={setActiveQaView}
          canAccessQa={isQaTeamMember || payload.role === 'ADMIN'}
          showLeaves={false}
          leavesActive={activeModule === 'qa' && activeQaView === 'leaves'}
          onLeavesClick={() => { setActiveModule('qa'); setActiveQaView('leaves'); }}
          onHomeClick={() => { setActiveModule('deployments'); setActiveTab('home'); }}
        />

        {/* Main content (second = left in RTL) */}
        <div style={{ flex: 1, padding: '24px', overflowY: 'auto', minWidth: 0, minHeight: 0, background: C.bgApp }}>

          {/* ── Module: ניהול QA ── */}
          {activeModule === 'qa' && <QaModulePlaceholder view={activeQaView} token={token} role={payload.role} isQaMember={isQaTeamMember} />}

          {activeModule === 'deployments' && (<>

          {/* ── Tab: Home Dashboard ── */}
          {activeTab === 'home' && (
            <HomeDashboard
              versions={versions.filter(v => !v.isArchived)}
              role={payload.role}
              fullName={fullName}
              onSelectVersion={(id, tab) => {
                setSelectedVersionId(id);
                setVersionFilter(
                  ['ACTIVE','REHEARSAL','MORNING_AFTER'].some(s => versions.find(v=>v.id===id)?.status === s) ? 'active' : 'inactive'
                );
                setActiveTab((tab as Tab) || 'list');
              }}
              onNewVersion={['ADMIN','RELEASE_MANAGER'].includes(payload.role) ? () => {
                setSelectedVersionId(''); setVersionFilter('inactive'); setActiveTab('list'); setOpenNewVersionForm(true);
              } : undefined}
            />
          )}

          {/* ── Tab: רשימה / Hub ── */}
          {activeTab === 'list' && (() => {
            // Archived filter with no version selected → prompt to pick one
            if (versionFilter === 'archived' && !selectedVersionId)
              return <NoVersionsForFilter filter={versionFilter} />;

            const EXEC_STATUSES = ['REHEARSAL', 'ACTIVE', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'];
            // TEAM_LEAD sees VersionHub in planning statuses too (to reach implementation-plans card)
            const TEAM_LEAD_HUB_STATUSES = ['COLLECTING', 'CR_REVIEW', 'REFINING', 'REVIEW', 'APPROVED'];
            const isExecVersion = selectedVersion && (
              EXEC_STATUSES.includes(selectedVersion.status) ||
              (payload.role === 'TEAM_LEAD' && TEAM_LEAD_HUB_STATUSES.includes(selectedVersion.status))
            );

            // גרסה בביצוע / סגורה (+ TEAM_LEAD בתכנון) → VersionHub
            if (selectedVersionId && selectedVersion && isExecVersion) {
              return (
                <VersionHub
                  version={selectedVersion}
                  onNavigate={tab => setActiveTab(tab as any)}
                  userRole={payload.role}
                  token={token}
                  onVersionUpdated={fetchVersions}
                />
              );
            }

            // TEAM_LEAD בגרסה בשלב טיוטה → הודעה מיידית
            if (payload.role === 'TEAM_LEAD' && selectedVersion?.status === 'DRAFT') {
              return (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  padding: '60px 24px', textAlign: 'center', gap: '16px',
                }}>
                  <div style={{ fontSize: '48px' }}>📋</div>
                  <div style={{ fontSize: '20px', fontWeight: '700', color: C.textPrimary }}>
                    התוכנית כרגע בשלב טיוטא
                  </div>
                  <div style={{ fontSize: '15px', color: C.textSecondary, maxWidth: '420px', lineHeight: '1.6' }}>
                    שלב הגשת המשימות ייפתח עם פתיחת שלב איסוף המשימות על ידי מנהל הלילה.
                  </div>
                  <div style={{ marginTop: '8px', padding: '10px 20px', background: C.bgCard, borderRadius: '10px', border: `1px solid ${C.border}`, fontSize: '14px', color: C.textMuted }}>
                    גרסה: <strong style={{ color: C.textPrimary }}>{selectedVersion.name}</strong>
                  </div>
                </div>
              );
            }

            // גרסה בתכנון OR אין גרסה → VersionsView (מסך בנייה)
            return (
              <ListTabContent
                token={token}
                selectedVersionId={selectedVersionId}
                selectedVersion={selectedVersion}
                versionFilter={versionFilter}
                fetchVersions={fetchVersions}
                handleGoLive={handleGoLive}
                handleVersionFocus={handleVersionFocus}
                onGoToAdmin={() => setActiveTab('admin')}
                autoNew={openNewVersionForm}
                onAutoNewConsumed={() => setOpenNewVersionForm(false)}
              />
            );
          })()}

          {/* ── Tab: פרטי גרסה (VersionsView) ── */}
          {activeTab === 'version-detail' && (
            <ListTabContent
              token={token}
              selectedVersionId={selectedVersionId}
              selectedVersion={selectedVersion}
              versionFilter={versionFilter}
              fetchVersions={fetchVersions}
              handleGoLive={handleGoLive}
              handleVersionFocus={handleVersionFocus}
              onGoToAdmin={() => setActiveTab('admin')}
            />
          )}

          {/* ── Tab: הגשות ── */}
          {activeTab === 'proposals' && (
            noVersionGuard ? <NoVersionsForFilter filter={versionFilter} /> :
            selectedVersionId && selectedVersion ? (
              <TeamLeadProposalView
                token={token}
                versionId={selectedVersionId}
                versionName={selectedVersion.name}
                reviewMeetingTime={selectedVersion.reviewMeetingTime}
              />
            ) : <EmptyVersionMessage />
          )}

          {/* ── Tab: סקירת CR ── */}
          {activeTab === 'cr-review' && (
            noVersionGuard ? <NoVersionsForFilter filter={versionFilter} /> :
            selectedVersionId && selectedVersion ? (
              <CrReviewView
                token={token}
                versionId={selectedVersionId}
                versionName={selectedVersion.name}
              />
            ) : <EmptyVersionMessage />
          )}


          {/* ── Tab: לוח (ביצוע) ── */}
          {activeTab === 'board' && (
            noVersionGuard ? <NoVersionsForFilter filter={versionFilter} /> :
            ['COMPLETED', 'ROLLED_BACK'].includes(selectedVersion?.status) ? (
              <div>
                <div style={{ background: C.bgCard, borderRadius: '10px', padding: '12px 18px', marginBottom: '14px', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: C.textMuted }}>
                  🔒 <strong style={{ color: C.textSecondary }}>גרסה סגורה — תצוגה בלבד</strong>
                </div>
                <TeamView token={token} versionId={selectedVersionId} onTaskUpdated={fetchVersions} onSummaryReady={setSummaryReady} onCurrentPhaseChange={setCurrentPhaseName} refreshKey={warRoomRefresh} />
              </div>
            ) :
            ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(selectedVersion?.status) ? (
              <div>
                {selectedVersion?.status === 'REHEARSAL' ? (
                  /* Rehearsal header */
                  <div style={{
                    background: 'linear-gradient(135deg, #7d3c00 0%, #f39c12 100%)',
                    borderRadius: '12px', padding: '12px 20px', marginBottom: '14px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '22px' }}>🎭</span>
                      <div>
                        <div style={{ fontWeight: 'bold', color: 'white', fontSize: '15px' }}>חזרה גנרלית — {selectedVersion?.name}</div>
                        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.8)', marginTop: '2px' }}>מצב אימון — שינויים לא יכנסו לייצור | לסיום עבור לטאב "דוח סיכום פעילות"</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        onClick={async () => {
                          try {
                            await axios.post(`${API}/versions/${selectedVersionId}/cancel-rehearsal`, {}, { headers });
                            setVersionFilter('inactive');
                            setActiveTab('list');
                            fetchVersions();
                          } catch (err: any) {
                            appDialog.alert(err?.response?.data?.message || 'לא ניתן לבטל את החזרה הגנרלית', 'שגיאה', 'danger');
                          }
                        }}
                        style={{ padding: '8px 16px', background: 'rgba(0,0,0,0.25)', color: 'white', border: '1px solid rgba(255,255,255,0.4)', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap' }}
                        title="חזור לתוכנית — רק אם טרם הורצה משימה"
                      >
                        ← חזור לתוכנית
                      </button>
                      {summaryReady && (
                        <button
                          onClick={() => setActiveTab('summary-night')}
                          style={{ padding: '8px 20px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap' }}
                        >
                          עבור לדוח הסיכום ←
                        </button>
                      )}
                    </div>
                  </div>
                ) : selectedVersion?.status === 'MORNING_AFTER' ? (
                  /* Morning-after header */
                  <div style={{ background: 'white', borderRadius: '12px', padding: '12px 20px', marginBottom: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '20px' }}>🌅</span>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: 'bold', color: '#8e44ad', fontSize: '14px' }}>שלב 4 — בוקר לאחר גרסה — {selectedVersion?.name}</span>
                            {currentPhaseName && (
                              <span style={{ background: '#8e44ad', color: 'white', fontSize: '11px', padding: '2px 10px', borderRadius: '12px', fontWeight: 'bold' }}>
                                {currentPhaseName}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>השלם את משימות הבוקר ואשר סיכום לסגירת הגרסה</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {summaryReady && (
                          <button
                            onClick={() => setActiveTab('summary-night')}
                            style={{ padding: '8px 20px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap' }}
                          >
                            עבור לדוח הסיכום ←
                          </button>
                        )}
                        <button
                          onClick={() => setDialog({
                            title: 'סגירת גרסה',
                            message: 'לסגור את הגרסה?\nניתן לארכב אותה לאחר מכן.',
                            variant: 'warning',
                            confirmLabel: 'סגור גרסה',
                            cancelLabel: 'ביטול',
                            onConfirm: async () => {
                              setEndNightLoading(true);
                              setEndNightError(null);
                              setEndNightBlockers([]);
                              setEndNightPending(0);
                              try {
                                await axios.patch(`${API}/versions/${selectedVersionId}/status`, { status: 'COMPLETED' }, { headers });
                                setVersionFilter('inactive');
                                await fetchVersions();
                              } catch (err: any) {
                                const msg = err?.response?.data?.message || err?.message || 'שגיאה';
                                setEndNightError(msg);
                                if (msg.includes('עיכוב')) {
                                  try {
                                    const res = await axios.get(`${API}/tasks?versionId=${selectedVersionId}`, { headers });
                                    setEndNightBlockers(computeBlockers(res.data));
                                  } catch { /* ignore */ }
                                } else if (msg.includes('לא הושלמו')) {
                                  // Extract pending count for force-close option
                                  const match = msg.match(/(\d+) משימות/);
                                  setEndNightPending(match ? parseInt(match[1]) : 1);
                                }
                              } finally {
                                setEndNightLoading(false);
                              }
                            },
                            onCancel: () => {},
                          })}
                          disabled={endNightLoading}
                          style={{ padding: '8px 20px', background: endNightLoading ? '#aaa' : '#1a5c2a', color: 'white', border: 'none', borderRadius: '8px', cursor: endNightLoading ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '13px' }}
                        >
                          {endNightLoading ? '...' : '✅ סגור גרסה'}
                        </button>
                      </div>
                    </div>
                    {(endNightError || endNightBlockers.length > 0) && (
                      <div style={{ background: '#fff8f0', border: '1px solid #e67e22', borderRadius: '8px', padding: '10px 14px', fontSize: '13px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: (endNightBlockers.length || endNightPending > 0) ? '10px' : 0 }}>
                          <span style={{ color: '#c0392b', fontWeight: 'bold' }}>⚠️ {endNightBlockers.length > 0 ? `${endNightBlockers.length} משימות עם עיכוב ללא סיבה` : endNightError}</span>
                          <button onClick={() => { setEndNightError(null); setEndNightBlockers([]); setBlockerReasons({}); setEndNightPending(0); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontWeight: 'bold', fontSize: '16px' }}>×</button>
                        </div>
                        {endNightPending > 0 && ['RELEASE_MANAGER', 'ADMIN'].includes(payload.role) && (
                          <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '6px', padding: '10px 14px', marginTop: '8px' }}>
                            <div style={{ fontSize: '12px', color: '#856404', marginBottom: '8px' }}>
                              {endNightPending} משימות לא הושלמו. מנהל לילה יכול לסגור בכל זאת.
                            </div>
                            <button
                              onClick={() => setDialog({
                                title: 'סגירת גרסה בעקיפה',
                                message: `${endNightPending} משימות עדיין לא הושלמו.\nהאם לסגור את הגרסה בכל זאת?`,
                                variant: 'warning',
                                confirmLabel: 'סגור בכל זאת',
                                cancelLabel: 'ביטול',
                                onConfirm: async () => {
                                  setEndNightLoading(true);
                                  setEndNightError(null);
                                  setEndNightPending(0);
                                  try {
                                    await axios.patch(`${API}/versions/${selectedVersionId}/status`, { status: 'COMPLETED', force: true }, { headers });
                                    await fetchVersions();
                                  } catch (err: any) {
                                    setEndNightError(err?.response?.data?.message || 'שגיאה');
                                  } finally { setEndNightLoading(false); }
                                },
                                onCancel: () => {},
                              })}
                              style={{ padding: '6px 16px', background: '#e67e22', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
                              ⚠️ סגור בכל זאת
                            </button>
                          </div>
                        )}
                        {endNightBlockers.map((t: any) => (
                          <div key={t.id} style={{ background: 'white', border: '1px solid #f0c040', borderRadius: '8px', padding: '10px', marginBottom: '8px' }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#1a2332' }}>{t.title}</div>
                            <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>מתוכנן: {fmtMins(t.plannedM)} · בפועל: {fmtMins(t.actualM)} · חריגה: +{fmtMins(t.actualM - t.plannedM)}</div>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                              <select value={blockerReasons[t.id] || ''} onChange={e => setBlockerReasons(prev => ({ ...prev, [t.id]: e.target.value }))} style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', direction: 'rtl' }}>
                                <option value="">— בחר סיבת עיכוב —</option>
                                {DELAY_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                              <button onClick={() => saveBlockerReason(t.id)} disabled={!blockerReasons[t.id] || savingReason === t.id} style={{ padding: '5px 14px', background: blockerReasons[t.id] ? '#e67e22' : '#ccc', color: 'white', border: 'none', borderRadius: '6px', cursor: blockerReasons[t.id] ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                                {savingReason === t.id ? '...' : 'שמור'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* ACTIVE: Real-night header */
                  <div style={{ background: 'white', borderRadius: '12px', padding: '12px 20px', marginBottom: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 'bold', color: '#1a2332', fontSize: '14px' }}>🌙 {selectedVersion?.name}</span>
                        {currentPhaseName && (
                          <span style={{ background: '#2d4a7a', color: 'white', fontSize: '11px', padding: '2px 10px', borderRadius: '12px', fontWeight: 'bold' }}>
                            {currentPhaseName}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {summaryReady && (
                          <button
                            onClick={() => setActiveTab('summary-night')}
                            style={{ padding: '8px 20px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap' }}
                          >
                            עבור לדוח הסיכום ←
                          </button>
                        )}
                        <button
                          onClick={endNight}
                          disabled={endNightLoading}
                          style={{ padding: '8px 20px', background: endNightLoading ? '#aaa' : '#1a5c2a', color: 'white', border: 'none', borderRadius: '8px', cursor: endNightLoading ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '13px' }}
                        >
                          {endNightLoading ? '...' : 'סיום פעילות גרסה →'}
                        </button>
                      </div>
                    </div>
                    {endNightError && (
                      <div style={{ background: '#fff8f0', border: '1px solid #e67e22', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#c0392b', fontWeight: 'bold' }}>⚠️ {endNightError}</span>
                        <button onClick={() => setEndNightError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontWeight: 'bold', fontSize: '16px' }}>×</button>
                      </div>
                    )}
                  </div>
                )}
                <TeamView
                  token={token}
                  versionId={selectedVersionId}
                  teamId={!myTasksMode && payload.role === 'TEAM_LEAD' && !can('action:view_all_teams') ? myTeamId || undefined : undefined}
                  userId={myTasksMode ? payload.sub : undefined}
                  userName={myTasksMode ? fullName : undefined}
                  onTaskUpdated={fetchVersions}
                  onSummaryReady={setSummaryReady}
                  onCurrentPhaseChange={setCurrentPhaseName}
                  refreshKey={warRoomRefresh}
                />
              </div>
            ) : (
              <NoActiveVersionMessage />
            )
          )}

          {/* ── Tab: ציר זמן ── */}
          {activeTab === 'timeline' && (
            noVersionGuard
              ? <NoVersionsForFilter filter={versionFilter} />
              : <TimelineView token={token} versionId={selectedVersionId} versionName={selectedVersion?.name || ''} />
          )}

          {/* ── Tab: סקירה — מצב שלבים וצוותים (ללא GO/NOGO) ── */}
          {activeTab === 'overview' && (
            noVersionGuard ? <NoVersionsForFilter filter={versionFilter} /> :
            isExecution ? (
              <WarRoom
                token={token}
                versionId={selectedVersionId}
                versionName={selectedVersion?.name || ''}
                onTeamClick={() => setActiveTab('board')}
                onlineUsers={onlineUsers}
                isRehearsal={selectedVersion?.status === 'REHEARSAL'}
                hideGoNogo={true}
                refreshSignal={warRoomRefresh}
                onGoToHub={() => setActiveTab('list')}
              />
            ) : <NoActiveVersionMessage />
          )}

          {/* ── Tab: לוח בקרה — WarRoom מלא עם GO/NOGO ── */}
          {activeTab === 'dashboard' && (
            noVersionGuard ? <NoVersionsForFilter filter={versionFilter} /> :
            isExecution ? (
              <WarRoom
                token={token}
                versionId={selectedVersionId}
                versionName={selectedVersion?.name || ''}
                onTeamClick={() => setActiveTab('board')}
                onlineUsers={onlineUsers}
                isRehearsal={selectedVersion?.status === 'REHEARSAL'}
                hideGoNogo={false}
                refreshSignal={warRoomRefresh}
                onGoToHub={() => setActiveTab('list')}
              />
            ) : <NoActiveVersionMessage />
          )}

          {/* ── Tab: ניהול ── */}
          {activeTab === 'admin' && (
            <AdminPanel token={token} />
          )}

          {/* ── Tab: סיכום חזרה גנרלית ── */}
          {activeTab === 'summary-rehearsal' && (
            noVersionGuard ? <NoVersionsForFilter filter={versionFilter} /> :
            selectedVersionId && selectedVersion ? (
              <div>
                <div style={{ background: 'linear-gradient(135deg, #7d3c00 0%, #f39c12 100%)', borderRadius: '12px', padding: '14px 20px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '22px' }}>🎭</span>
                  <div>
                    <div style={{ fontWeight: 'bold', color: 'white', fontSize: '15px' }}>סיכום חזרה גנרלית — {selectedVersion.name}</div>
                    <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.8)', marginTop: '2px' }}>
                      {selectedVersion.lastRehearsalAt
                        ? `הורצה ב-${new Date(selectedVersion.lastRehearsalAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                        : 'חזרה גנרלית פעילה'}
                    </div>
                  </div>
                </div>
                <NightSummary
                  token={token}
                  versionId={selectedVersionId}
                  versionName={selectedVersion.name}
                  isRehearsal={true}
                  onApproved={async () => { await fetchVersions(); }}
                  onGoToHub={() => setActiveTab('list')}
                />
              </div>
            ) : <EmptyVersionMessage />
          )}

          {/* ── Tab: סיכום ליל ההטמעה ── */}
          {activeTab === 'summary-night' && (
            noVersionGuard ? <NoVersionsForFilter filter={versionFilter} /> :
            selectedVersionId && selectedVersion ? (
              <div>
                {/* בלוק ארכיון — רק למנהל, רק בגרסה סגורה */}
                {['COMPLETED', 'ROLLED_BACK'].includes(selectedVersion.status) && payload.role === 'ADMIN' && (
                  <div style={{ background: C.bgCard, borderRadius: '12px', padding: '16px 20px', marginBottom: '20px', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '28px' }}>{selectedVersion.isArchived ? '📦' : '✅'}</span>
                      <div>
                        <div style={{ fontWeight: 'bold', color: C.textPrimary, fontSize: '14px' }}>{selectedVersion.isArchived ? 'גרסה בארכיון' : 'גרסה סגורה'}</div>
                        <div style={{ fontSize: '12px', color: C.textMuted }}>{selectedVersion.isArchived ? 'ניתן לשחזר מניהול גרסאות' : 'ADMIN — ניתן לארכב'}</div>
                      </div>
                    </div>
                    {!selectedVersion.isArchived && (
                      <button
                        onClick={() => setDialog({ title: 'העברה לארכיון', message: 'להעביר לארכיון?', variant: 'warning', confirmLabel: 'העבר', cancelLabel: 'ביטול',
                          onConfirm: async () => { setArchiveLoading(true); try { await axios.patch(`${API}/versions/${selectedVersionId}/archive`, {}, { headers }); await fetchVersions(); } catch {} finally { setArchiveLoading(false); } },
                          onCancel: () => {},
                        })}
                        disabled={archiveLoading}
                        style={{ padding: '7px 16px', background: '#6c3483', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
                        📦 ארכיון
                      </button>
                    )}
                  </div>
                )}
                {/* גרסה סגורה — תצוגה בלבד */}
                {['COMPLETED', 'ROLLED_BACK'].includes(selectedVersion.status) && payload.role !== 'ADMIN' && (
                  <div style={{ background: C.bgCard, borderRadius: '8px', padding: '10px 16px', marginBottom: '16px', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: C.textMuted }}>
                    🔒 גרסה סגורה — תצוגה בלבד
                  </div>
                )}
                <div style={{ background: 'linear-gradient(135deg, #1a2332 0%, #0d1b2a 100%)', borderRadius: '12px', padding: '14px 20px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '22px' }}>🌙</span>
                  <div>
                    <div style={{ fontWeight: 'bold', color: 'white', fontSize: '15px' }}>סיכום ליל ההטמעה — {selectedVersion.name}</div>
                    <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.65)', marginTop: '2px' }}>
                      {selectedVersion.actualStart
                        ? `הרצה התחילה: ${new Date(selectedVersion.actualStart).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                        : 'הפק ואשר את דוח הסיכום'}
                    </div>
                  </div>
                </div>
                <NightSummary
                  token={token}
                  versionId={selectedVersionId}
                  versionName={selectedVersion.name}
                  isRehearsal={false}
                  onApproved={() => fetchVersions()}
                  onGoToHub={() => setActiveTab('list')}
                />
              </div>
            ) : <EmptyVersionMessage />
          )}
          {/* ── Tab: לוח מנהל CR ── */}
          {activeTab === 'cr-manager' && (
            <CrManagerView token={token} />
          )}

          {/* ── Tab: תוכניות הטמעה ── */}
          {activeTab === 'implementation-plans' && (
            noVersionGuard ? <NoVersionsForFilter filter={versionFilter} /> :
            selectedVersionId && selectedVersion ? (
              <div>
                <div style={{ background: C.bgCard, borderRadius: '10px', padding: '12px 18px', marginBottom: '16px', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '22px' }}>📁</span>
                  <div>
                    <div style={{ fontWeight: '700', color: C.textPrimary, fontSize: '15px' }}>תוכניות הטמעה — {selectedVersion.name}</div>
                    <div style={{ fontSize: '12px', color: C.textMuted, marginTop: '2px' }}>הגשה, סקירה ואישור תוכניות מנהל CR</div>
                  </div>
                </div>
                <ImplementationPlansView
                  token={token}
                  versionId={selectedVersionId}
                  versionStatus={selectedVersion.status}
                  userRole={payload.role}
                  userId={payload.sub}
                />
              </div>
            ) : <EmptyVersionMessage />
          )}

          </>)}
        </div>
      </div>

      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />

      {/* ─── Toast notifications ─── */}
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px',
          zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '10px',
          pointerEvents: 'none',
        }}>
          {toasts.map(toast => {
            const colors: Record<ToastItem['type'], { bg: string; border: string; color: string }> = {
              blocked: { bg: '#2d0f0f', border: C.statusFailed, color: 'white' },
              nogo:    { bg: '#2d0f0f', border: C.statusFailed, color: 'white' },
              go:      { bg: '#0d2818', border: C.statusDone,   color: 'white' },
              version: { bg: C.bgCard,  border: C.brand,        color: C.textPrimary },
              info:    { bg: C.bgCard,  border: C.border,        color: C.textPrimary },
            };
            const c = colors[toast.type];
            return (
              <div key={toast.id} className="toast-slide-in" style={{
                pointerEvents: 'auto',
                minWidth: '300px', maxWidth: '440px',
                background: c.bg,
                border: `2px solid ${c.border}`,
                color: c.color,
                borderRadius: '12px',
                padding: '14px 16px',
                boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px',
                direction: 'rtl',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: toast.body ? '4px' : 0 }}>
                    {toast.title}
                  </div>
                  {toast.body && <div style={{ fontSize: '13px', opacity: 0.92, lineHeight: '1.4' }}>{toast.body}</div>}
                </div>
                <button
                  onClick={() => dismissToast(toast.id)}
                  style={{
                    background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white',
                    borderRadius: '50%', width: '22px', height: '22px', cursor: 'pointer',
                    fontSize: '11px', fontWeight: 'bold', flexShrink: 0, lineHeight: '22px',
                    textAlign: 'center', padding: 0,
                  }}
                >✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const EmptyVersionMessage: React.FC = () => (
  <div style={{ textAlign: 'center', padding: '80px', color: C.textMuted, background: C.bgCard, borderRadius: '12px', border: `1px solid ${C.border}` }}>
    <div style={{ fontSize: '48px' }}>📁</div>
    <p style={{ fontSize: '15px', marginTop: '12px', color: C.textSecondary }}>בחר גרסה מהתפריט בכותרת</p>
  </div>
);

const emptyCardStyle: React.CSSProperties = {
  textAlign: 'center', padding: '80px',
  background: C.bgCard, borderRadius: '12px', border: `1px solid ${C.border}`,
};

const NoVersionsForFilter: React.FC<{ filter: 'active' | 'inactive' | 'archived' }> = ({ filter }) => {
  const config = {
    active:   { icon: '🟢', title: 'אין גרסאות פעילות כרגע', sub: 'לא קיימת גרסה במצב ACTIVE, REHEARSAL או MORNING_AFTER.\nעבור למסך הכנה כדי להפעיל גרסה.' },
    inactive: { icon: '📋', title: 'אין גרסאות בשלב תכנון', sub: 'צור גרסה חדשה ממסך הכנה כדי להתחיל.' },
    archived: { icon: '📦', title: 'בחר גרסה מהארכיון', sub: 'בחר גרסה מהתפריט הנפתח בכותרת כדי לצפות בנתוניה.' },
  }[filter];
  return (
    <div style={emptyCardStyle}>
      <div style={{ fontSize: '48px' }}>{config.icon}</div>
      <h3 style={{ color: C.textPrimary, marginTop: '16px', marginBottom: '8px' }}>{config.title}</h3>
      {config.sub.split('\n').map((line, i) => (
        <p key={i} style={{ fontSize: '14px', color: C.textMuted, margin: '4px 0' }}>{line}</p>
      ))}
    </div>
  );
};

const NoActiveVersionMessage: React.FC = () => (
  <div style={emptyCardStyle}>
    <div style={{ fontSize: '48px' }}>🔒</div>
    <h3 style={{ color: C.textPrimary, marginTop: '16px' }}>אין גרסה פעילה</h3>
    <p style={{ fontSize: '14px', color: C.textMuted }}>מסך זה זמין רק כאשר גרסה הופעלה ללילה</p>
    <p style={{ fontSize: '13px', color: C.textDisabled }}>עבור למסך הכנה ושנה את סטטוס הגרסה ל-ACTIVE</p>
  </div>
);

// ── QA Module placeholder ────────────────────────────────────────────────────

const QA_VIEW_META: Record<string, { icon: string; title: string; sub: string }> = {
  testers:    { icon: '👥', title: 'בודקים',          sub: 'ניהול פרופילי בודקים, הוספה ועריכה' },
  skills:     { icon: '🧠', title: 'מטריצת סקילים',   sub: 'הגדרת סקילים ורמות מיומנות לכל בודק' },
  leaves:     { icon: '📅', title: 'חופשות',           sub: '' },
  assignment: { icon: '🎯', title: 'תכנון ושיבוץ',    sub: 'שיבוץ בודקים ותכנון סבבי בדיקות' },
};

const QaModulePlaceholder: React.FC<{ view: string; token: string; role: string; isQaMember?: boolean }> = ({ view, token, role, isQaMember }) => {
  // Leaves board is accessible to all authenticated users; QA module views are for QA team members and ADMIN
  if (view !== 'leaves' && role !== 'ADMIN' && !isQaMember) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '12px', color: C.textMuted }}>
        <div style={{ fontSize: '48px' }}>🔒</div>
        <div style={{ fontSize: '18px', fontWeight: WEIGHT.bold, color: C.textPrimary }}>אין הרשאת גישה</div>
        <div style={{ fontSize: '14px', color: C.textMuted }}>אזור זה מיועד לצוות QA בלבד</div>
      </div>
    );
  }
  if (view === 'leaves')     return <QaLeavesView role={role} token={token} />;
  if (view === 'testers')    return <QaTestersView token={token} />;
  if (view === 'skills')     return <QaSkillsView token={token} />;
  if (view === 'assignment') return <QaAssignmentView token={token} />;

  const meta = QA_VIEW_META[view] ?? { icon: '👥', title: 'ניהול QA', sub: '' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '16px', color: C.textMuted }}>
      <div style={{ fontSize: '56px', lineHeight: 1 }}>{meta.icon}</div>
      <div style={{ fontSize: '20px', fontWeight: WEIGHT.bold, color: C.textPrimary }}>{meta.title}</div>
      <div style={{ fontSize: '14px', color: C.textMuted }}>{meta.sub}</div>
      <div style={{ marginTop: '8px', background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '10px 20px', fontSize: '13px', color: C.textDisabled }}>
        בפיתוח — יתווסף בקרוב
      </div>
    </div>
  );
};

// ── LIST tab — Asana-style TaskListView, editable in planning phases ──
const PLANNING_STATUSES = new Set(['DRAFT', 'CR_REVIEW', 'COLLECTING', 'REFINING', 'REVIEW', 'APPROVED']);

const ListTabContent: React.FC<{
  token: string;
  selectedVersionId: string;
  selectedVersion: any;
  versionFilter: string;
  fetchVersions: () => void;
  handleGoLive: (id: string, name: string, isRehearsal: boolean) => void;
  handleVersionFocus: (id: string) => void;
  onGoToAdmin: () => void;
  autoNew?: boolean;
  onAutoNewConsumed?: () => void;
}> = ({ token, selectedVersionId, selectedVersion, versionFilter, fetchVersions, handleGoLive, handleVersionFocus, onGoToAdmin, autoNew, onAutoNewConsumed }) => (
  <VersionsView
    key={selectedVersionId || versionFilter + (autoNew ? '-new' : '')}
    token={token}
    onVersionsChanged={() => { fetchVersions(); onAutoNewConsumed?.(); }}
    onGoLive={handleGoLive}
    onVersionFocus={handleVersionFocus}
    onGoToAdmin={onGoToAdmin}
    initialSelectedId={selectedVersionId}
    autoNew={autoNew}
  />
);
