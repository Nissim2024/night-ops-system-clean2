import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { TeamView } from './TeamView';
import { VersionProgressChain } from './VersionProgressChain';
import { useSocket } from '../hooks/useSocket';
import { playTaskReady } from '../utils/sound';
import { DeployCenterLogo } from './DeployCenterLogo';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { EmployeeLeavesView } from './EmployeeLeavesView';
import { QaTestersView } from './qa/QaTestersView';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE, statusColor } from '../theme';

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

type NavView = 'tasks' | 'leaves' | 'skills';

const NAV_ITEMS: { key: NavView; label: string; icon: string }[] = [
  { key: 'tasks',  label: 'משימות הרצה',   icon: '🌙' },
  { key: 'leaves', label: 'חופשות',         icon: '📅' },
  { key: 'skills', label: 'מטריצת מיומנויות', icon: '🎯' },
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
  const [activeView, setActiveView]       = useState<NavView>('tasks');
  const [hoveredNav, setHoveredNav]       = useState<NavView | null>(null);
  const [focusMode, setFocusMode]               = useState(false);
  const [focusAllTasks, setFocusAllTasks]       = useState<any[]>([]);
  const [focusLoading, setFocusLoading]         = useState(false);
  const [updatingFocusTaskId, setUpdatingFocusTaskId] = useState<string | null>(null);
  const [focusBlockFor, setFocusBlockFor]       = useState<string | null>(null);
  const [focusBlockReason, setFocusBlockReason] = useState('');
  const [focusNearOnly, setFocusNearOnly]       = useState(true);
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
          const planning = allVersions.find((v: any) =>
            !v.isArchived && ['DRAFT', 'COLLECTING', 'REFINING', 'REVIEW', 'APPROVED'].includes(v.status)
          );
          setPlanningVersion(planning || null);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // עובד בצוות QA: רואה חופשות בלבד (לא מטריצת מיומנויות — שמורה למנהלי QA דרך ManagerDashboard)
  // עובד שאינו QA: רואה משימות בלבד
  const visibleNavItems = NAV_ITEMS.filter(item => {
    if (item.key === 'skills') return false;          // employees never see skills matrix
    if (item.key === 'leaves') return isQaTeam;       // only QA team members see vacations
    return true;                                       // tasks — everyone
  });

  // אפס view אם המשתמש נמצא בלשונית שאינה זמינה לו
  React.useEffect(() => {
    if (!loading && activeView === 'skills') setActiveView('tasks');
    if (!loading && activeView === 'leaves' && !isQaTeam) setActiveView('tasks');
  }, [isQaTeam, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const initials = fullName.split(' ').map((w: string) => w[0]).slice(0, 2).join('');

  // ── Focus Mode derived state ──
  const TERMINAL_F = ['DONE', 'FAILED', 'ROLLED_BACK'];
  const NEAR_MINUTES_F = 15;
  const PNL = { bg: '#111827', header: '#0f172a', border: 'rgba(255,255,255,0.10)', text: '#f1f5f9', muted: '#94a3b8', section: '#1e293b' };
  const myFocusName = fullName.trim().toLowerCase();
  const isMyFocusTask = (t: any) =>
    (t.assignedUserId && t.assignedUserId === payload.sub) ||
    (t.assignedUserName && t.assignedUserName.trim().toLowerCase() === myFocusName);
  const myFocusTasks = focusAllTasks.filter(isMyFocusTask);
  const focusDone    = myFocusTasks.filter(t => TERMINAL_F.includes(t.status)).length;
  const focusTotal   = myFocusTasks.length;
  const focusPct     = focusTotal > 0 ? Math.round((focusDone / focusTotal) * 100) : 0;

  const focusSubGroups: { subName: string; tasks: any[] }[] = [];
  for (const t of myFocusTasks) {
    const name = t._subPhaseName || t._phaseName || '';
    let g = focusSubGroups.find(x => x.subName === name);
    if (!g) { g = { subName: name, tasks: [] }; focusSubGroups.push(g); }
    g.tasks.push(t);
  }

  const nowF = Date.now();
  const isNearFocusTask = (t: any) => {
    if (['OPEN', 'IN_PROGRESS', 'BLOCKED'].includes(t.status)) return true;
    if (!TERMINAL_F.includes(t.status) && t.plannedStart) {
      const ms = new Date(t.plannedStart).getTime() - nowF;
      return ms >= 0 && ms <= NEAR_MINUTES_F * 60_000;
    }
    return false;
  };
  const filterFocusTasks = (tasks: any[]) => focusNearOnly ? tasks.filter(isNearFocusTask) : tasks;
  const filteredFocusGroups = focusSubGroups
    .map(g => ({ ...g, tasks: filterFocusTasks(g.tasks) }))
    .filter(g => g.tasks.length > 0);
  const nearFocusCount = myFocusTasks.filter(isNearFocusTask).length;

  const FocusTaskRow = ({ task }: { task: any }) => {
    const isUpd     = updatingFocusTaskId === task.id;
    const isBlocking = focusBlockFor === task.id;
    const isDone    = TERMINAL_F.includes(task.status);
    const isIP      = task.status === 'IN_PROGRESS';
    const isOpen    = task.status === 'OPEN';
    const isBlocked = task.status === 'BLOCKED';
    const hasBlockingDeps = (task.dependencies ?? []).some(
      (d: any) => !TERMINAL_F.includes(d.dependsOn?.status ?? '')
    );
    const sColor = statusColor(task.status);
    const btnBase: React.CSSProperties = {
      fontFamily: FONT, fontSize: '12px', fontWeight: 'bold',
      padding: '5px 10px', border: 'none', borderRadius: '6px',
      cursor: isUpd ? 'not-allowed' : 'pointer',
      whiteSpace: 'nowrap', opacity: isUpd ? 0.6 : 1,
      width: '100%', textAlign: 'center' as const,
    };
    return (
      <div style={{ borderRight: `3px solid ${sColor}`, borderBottom: `1px solid rgba(255,255,255,0.06)`, background: isDone ? 'rgba(255,255,255,0.02)' : isIP ? 'rgba(56,139,253,0.12)' : isOpen ? 'rgba(227,179,65,0.10)' : isBlocked ? 'rgba(240,106,106,0.08)' : '#172030', opacity: isDone ? 0.45 : 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', minHeight: '44px', gap: '0' }}>
          {/* Title col */}
          <div style={{ flex: 1, minWidth: 0, padding: '6px 10px 6px 4px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', fontWeight: !isDone ? 'bold' : 'normal', color: isDone ? 'rgba(255,255,255,0.4)' : 'white' }}>{task.title}</span>
              {task.crNumber && <span style={{ fontSize: '10px', color: C.info, background: 'rgba(56,139,253,0.15)', padding: '1px 5px', borderRadius: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>{task.crNumber}</span>}
            </div>
            <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.45)', flexWrap: 'wrap', alignItems: 'center' }}>
              {task.assignedTeam?.name && <span style={{ color: C.brand, background: 'rgba(56,139,253,0.15)', padding: '0 5px', borderRadius: '4px' }}>{task.assignedTeam.name}</span>}
              {task.assignedUserName && <span>{task.assignedUserName.split(' ')[0]}</span>}
              {task.application && <span>{task.application}</span>}
              {task.duration && <span>⏱ {task.duration}</span>}
              {(task.plannedStart || task.plannedEnd) && (
                <span style={{ color: 'rgba(255,255,255,0.55)', background: 'rgba(255,255,255,0.07)', padding: '1px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                  🕐 {task.plannedStart ? new Date(task.plannedStart).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '?'}
                  {task.plannedEnd && ` — ${new Date(task.plannedEnd).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`}
                </span>
              )}
              {isBlocked && task.blockedReason && <span style={{ color: C.statusFailed }}>⛔ {task.blockedReason}</span>}
            </div>
            {(task.dependencies ?? []).length > 0 && (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', marginTop: '3px' }}>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.30)', flexShrink: 0 }}>תלוי ב:</span>
                {(task.dependencies ?? []).map((d: any) => {
                  const depDone = TERMINAL_F.includes(d.dependsOn?.status ?? '');
                  const dc = depDone ? C.statusDone : statusColor(d.dependsOn?.status ?? '');
                  return (
                    <span key={d.id} style={{ fontSize: '10px', color: dc, background: dc + '22', padding: '1px 6px', borderRadius: '4px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', flexShrink: 0 }}>
                      {depDone ? '✓' : '○'} {d.dependsOn?.title ?? '?'}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          {/* Status chip */}
          <div style={{ width: '64px', flexShrink: 0, padding: '0 4px', textAlign: 'center' }}>
            <span style={{ fontSize: '10px', color: sColor, background: sColor + '22', padding: '2px 6px', borderRadius: '8px', whiteSpace: 'nowrap', display: 'inline-block' }}>
              {task.status === 'DONE' ? 'הושלם' : task.status === 'IN_PROGRESS' ? 'בביצוע' : task.status === 'OPEN' ? 'פתוח' : task.status === 'WAITING' ? 'ממתין' : task.status === 'BLOCKED' ? 'חסום' : task.status === 'FAILED' ? 'נכשל' : 'Rollback'}
            </span>
          </div>
          {/* Action buttons */}
          <div style={{ width: '90px', flexShrink: 0, padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {!isDone && !isBlocking ? (
              <>
                {isOpen && <button disabled={isUpd} onClick={() => updateFocusTask(task.id, 'IN_PROGRESS')} style={{ ...btnBase, background: `linear-gradient(135deg,${C.statusInProgress},#b07d1e)`, color: 'white', boxShadow: '0 2px 6px rgba(227,179,65,0.25)' }}>▶ התחל</button>}
                {isIP && <button disabled={isUpd} onClick={() => updateFocusTask(task.id, 'DONE')} style={{ ...btnBase, background: `linear-gradient(135deg,${C.statusDone},#2ea043)`, color: 'white', boxShadow: '0 2px 6px rgba(86,211,100,0.22)' }}>✓ סיים</button>}
                {isBlocked && <button disabled={isUpd} onClick={() => updateFocusTask(task.id, 'IN_PROGRESS')} style={{ ...btnBase, background: 'transparent', color: C.statusDone, border: `1px solid ${C.statusDone}44` }}>♻️ חזור</button>}
                {(isOpen || isIP) && <button disabled={isUpd || hasBlockingDeps} onClick={() => { setFocusBlockFor(task.id); setFocusBlockReason(''); }} style={{ ...btnBase, background: 'transparent', color: C.statusFailed, border: `1px solid ${C.statusFailed}55` }}>🚫 חסום</button>}
              </>
            ) : isDone ? (
              <span style={{ fontSize: '18px', textAlign: 'center', display: 'block', opacity: 0.5 }}>{task.status === 'DONE' ? '✓' : task.status === 'FAILED' ? '✗' : '⏪'}</span>
            ) : null}
          </div>
        </div>
        {/* Block reason input */}
        {isBlocking && (
          <div style={{ padding: '8px 10px 10px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <textarea autoFocus value={focusBlockReason} onChange={e => setFocusBlockReason(e.target.value)}
              placeholder="סיבת חסימה (חובה)..." rows={2}
              style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: `1px solid ${C.statusFailed}66`, fontSize: '13px', resize: 'none', boxSizing: 'border-box' as const, direction: 'rtl', fontFamily: FONT, background: '#1e293b', color: 'white', outline: 'none', marginBottom: '7px' }}
            />
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={() => { setFocusBlockFor(null); setFocusBlockReason(''); }}
                style={{ flex: 1, padding: '6px', background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', cursor: 'pointer', fontFamily: FONT, fontSize: '12px' }}>ביטול</button>
              <button disabled={!focusBlockReason.trim() || isUpd}
                onClick={() => { updateFocusTask(task.id, 'BLOCKED', focusBlockReason.trim()); setFocusBlockFor(null); }}
                style={{ flex: 2, padding: '6px', background: focusBlockReason.trim() ? C.statusFailed : 'rgba(255,255,255,0.05)', color: focusBlockReason.trim() ? 'white' : 'rgba(255,255,255,0.25)', border: 'none', borderRadius: '6px', cursor: focusBlockReason.trim() ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontFamily: FONT, fontSize: '12px' }}>אשר חסימה 🚫</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: FONT, direction: 'rtl', background: C.bgApp, color: C.textPrimary, overflow: 'hidden' }}>

      {/* ── Focus Mode overlay ── */}
      {focusMode && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 20000, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl', fontFamily: FONT }} onClick={() => setFocusMode(false)}>
          <div style={{ width: '100%', maxWidth: '820px', height: '90vh', margin: '0 16px', display: 'flex', flexDirection: 'column', background: PNL.bg, borderRadius: '16px', boxShadow: '0 24px 64px rgba(0,0,0,0.7)', overflow: 'hidden', border: `1px solid ${PNL.border}` }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ background: PNL.header, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: `1px solid ${PNL.border}`, flexShrink: 0 }}>
              <span style={{ fontSize: '18px' }}>⚡</span>
              <span style={{ fontSize: '16px', fontWeight: 'bold', color: PNL.text }}>מצב הרצה</span>
              {activeVersion && <span style={{ fontSize: '13px', color: PNL.muted, background: 'rgba(255,255,255,0.07)', padding: '3px 12px', borderRadius: '20px', border: `1px solid ${PNL.border}` }}>{activeVersion.name}</span>}
              <div style={{ flex: 1 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', fontSize: '13px', color: PNL.muted, userSelect: 'none' as const }}>
                <input type="checkbox" checked={focusNearOnly} onChange={e => setFocusNearOnly(e.target.checked)} style={{ width: '15px', height: '15px', accentColor: C.brand, cursor: 'pointer' }} />
                <span style={{ color: focusNearOnly ? C.brand : PNL.muted, fontWeight: focusNearOnly ? 'bold' : 'normal' }}>
                  {NEAR_MINUTES_F} דקות קרובות בלבד
                  {focusNearOnly && <span style={{ marginRight: '6px', color: C.statusWaiting }}>({nearFocusCount})</span>}
                </span>
              </label>
              <span style={{ color: PNL.muted, fontSize: '12px', background: 'rgba(255,255,255,0.06)', padding: '3px 10px', borderRadius: '10px' }}>{focusDone}/{focusTotal} ✓</span>
              <button onClick={() => setFocusMode(false)} style={{ background: 'rgba(255,255,255,0.07)', border: `1px solid ${PNL.border}`, color: PNL.muted, cursor: 'pointer', fontSize: '18px', width: '30px', height: '30px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
            {/* Progress bar */}
            <div style={{ padding: '10px 20px', background: PNL.header, borderBottom: `1px solid ${PNL.border}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ flex: 1, height: '7px', background: 'rgba(255,255,255,0.10)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${focusPct}%`, background: focusPct === 100 ? C.statusDone : `linear-gradient(90deg, ${C.brand}, ${C.statusInProgress})`, borderRadius: '4px', transition: 'width 0.5s ease' }} />
              </div>
              <span style={{ fontSize: '12px', color: PNL.muted, whiteSpace: 'nowrap' }}>{focusPct}%</span>
            </div>
            {/* Task list */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {focusLoading ? (
                <div style={{ padding: '60px', textAlign: 'center', color: PNL.muted }}>⏳ טוען...</div>
              ) : focusTotal === 0 ? (
                <div style={{ padding: '60px', textAlign: 'center' }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: C.statusDone }}>אין משימות פעילות!</div>
                </div>
              ) : (
                <>
                  {filteredFocusGroups.map(g => (
                    <div key={g.subName}>
                      <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'rgba(255,255,255,0.55)', padding: '7px 16px', background: PNL.section, borderBottom: `1px solid ${PNL.border}`, borderTop: `1px solid ${PNL.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{g.subName}</span>
                        <span style={{ color: g.tasks.filter((t: any) => TERMINAL_F.includes(t.status)).length === g.tasks.length ? C.statusDone : PNL.muted }}>{g.tasks.filter((t: any) => TERMINAL_F.includes(t.status)).length}/{g.tasks.length}</span>
                      </div>
                      {g.tasks.map((t: any) => <FocusTaskRow key={t.id} task={t} />)}
                    </div>
                  ))}
                  {focusNearOnly && nearFocusCount === 0 && (
                    <div style={{ padding: '48px', textAlign: 'center', color: PNL.muted }}>
                      <div style={{ fontSize: '32px', marginBottom: '10px' }}>⏳</div>
                      <div style={{ fontSize: '14px' }}>אין משימות פעילות בטווח {NEAR_MINUTES_F} הדקות הקרובות</div>
                      <button onClick={() => setFocusNearOnly(false)} style={{ marginTop: '14px', padding: '7px 18px', background: 'rgba(255,255,255,0.08)', color: PNL.text, border: `1px solid ${PNL.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontFamily: FONT }}>הצג כל המשימות</button>
                    </div>
                  )}
                </>
              )}
            </div>
            {/* Footer */}
            <div style={{ background: PNL.header, borderTop: `1px solid ${PNL.border}`, padding: '8px 20px', display: 'flex', gap: '16px', fontSize: '12px', color: PNL.muted, flexShrink: 0, flexWrap: 'wrap' }}>
              {[
                { label: 'הושלם', count: myFocusTasks.filter(t => t.status === 'DONE').length, color: C.statusDone },
                { label: 'בביצוע', count: myFocusTasks.filter(t => t.status === 'IN_PROGRESS').length, color: C.statusInProgress },
                { label: 'פתוח',  count: myFocusTasks.filter(t => t.status === 'OPEN').length, color: C.statusOpen },
                { label: 'ממתין', count: myFocusTasks.filter(t => t.status === 'WAITING').length, color: C.statusWaiting },
                { label: 'חסום',  count: myFocusTasks.filter(t => t.status === 'BLOCKED').length, color: C.statusFailed },
              ].filter(s => s.count > 0).map(s => (
                <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                  <span style={{ color: s.color, fontWeight: 'bold' }}>{s.count}</span>
                  <span>{s.label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
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
                fontSize: '13px', fontWeight: WEIGHT.bold, fontFamily: FONT,
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
              background: push.subscribed ? C.successBg : C.bgNested, fontSize: '16px',
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
              fontSize: '12px', fontWeight: WEIGHT.bold, color: C.brand,
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
              color: '#d4a017', fontSize: '12px', fontWeight: WEIGHT.bold,
              textAlign: 'center', padding: '5px 8px', borderRadius: RADIUS.md,
              letterSpacing: '0.08em', textTransform: 'uppercase' as const,
            }}>⚡ TEST</div>
          )}

          {/* Nav section label */}
          <div style={{
            padding: `16px ${SP[3]} 8px`,
            fontSize: '11px', fontWeight: WEIGHT.bold,
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
                    fontSize: '16px',
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
                <span style={{ fontSize: '16px' }}>👥</span>
                <div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>הצוות שלי</div>
                  <div style={{ fontSize: '14px', fontWeight: WEIGHT.semibold, color: 'rgba(255,255,255,0.85)' }}>{myTeam.name}</div>
                </div>
              </div>
            </>
          )}

          {/* Footer */}
          <div style={{
            padding: `${SP[2]} ${SP[3]}`,
            borderTop: `1px solid ${C.sidebarBorder}`,
            display: 'flex', alignItems: 'center', gap: '8px',
            fontSize: '12px', color: 'rgba(255,255,255,0.35)',
          }}>
            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: C.success, flexShrink: 0, boxShadow: `0 0 4px ${C.success}80` }} />
            <span>DeployCenter v2</span>
          </div>
        </div>

        {/* ── Main content ── */}
        <div style={{ flex: 1, padding: SP[6], overflowY: 'auto', minWidth: 0, minHeight: 0, background: C.bgApp }}>

          {/* ─── Leaves view ─── */}
          {activeView === 'leaves' && <EmployeeLeavesView token={token} />}

          {/* ─── Skills matrix view ─── */}
          {activeView === 'skills' && <QaTestersView token={token} />}

          {/* ─── Tasks view ─── */}
          {activeView === 'tasks' && (loading ? (
            <div style={{ textAlign: 'center', padding: '80px', color: C.textMuted }}>
              <div style={{ fontSize: '48px' }}>🌙</div>
              <p style={{ fontSize: '16px', marginTop: '12px' }}>טוען...</p>
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
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
                          <div style={{ fontSize: '11px', opacity: 0.8 }}>{stat.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <TeamView token={token} teamId={myTeam.id} teamName={myTeam.name} versionId={activeVersion.id} userId={payload.sub} userName={fullName} refreshKey={refreshKey} hideAddTask />
                </>
              ) : (() => {
                const PLANNING_MSG: Record<string, { icon: string; title: string; sub: string }> = {
                  DRAFT:      { icon: '📝', title: 'הגרסה בשלב טיוטה',         sub: 'מנהל הלילה מכין את תוכנית העבודה.' },
                  COLLECTING: { icon: '📋', title: 'שלב איסוף המשימות פתוח',   sub: 'ההרצה תתחיל לאחר אישור התוכנית.' },
                  REFINING:   { icon: '🔧', title: 'התוכנית בעריכה פנימית',    sub: 'מנהל הלילה עורך ומסדר את המשימות.' },
                  REVIEW:     { icon: '🔍', title: 'התוכנית ממתינה לאישור',    sub: 'הגרסה בסקירה. ההרצה תחל לאחר אישורים.' },
                  APPROVED:   { icon: '✅', title: 'הגרסה אושרה — מוכנים!',   sub: 'התוכנית סגורה. ההרצה עתידה להתחיל בקרוב.' },
                };
                const info = planningVersion
                  ? (PLANNING_MSG[planningVersion.status] ?? { icon: '🌙', title: 'אין פעילות פעילה', sub: 'המתן להנחיות מנהל הלילה.' })
                  : { icon: '🌙', title: 'אין פעילות פעילה הלילה', sub: 'אין גרסה פעילה כעת. המתן להנחיות מנהל הלילה.' };
                return (
                  <div style={{ textAlign: 'center', padding: '80px', color: C.textMuted, background: C.bgCard, borderRadius: '16px', border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: '64px' }}>{info.icon}</div>
                    <h2 style={{ color: C.textPrimary, marginTop: '16px' }}>{info.title}</h2>
                    <p style={{ color: C.textMuted }}>{info.sub}</p>
                    {planningVersion && (
                      <div style={{ marginTop: '16px', background: C.bgNested, borderRadius: '10px', padding: '10px 20px', display: 'inline-block', fontSize: '13px', color: C.textSecondary }}>
                        גרסה: <strong>{planningVersion.name}</strong>
                      </div>
                    )}
                  </div>
                );
              })()}
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
                <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{t.title}</div>
                {t.body && <div style={{ fontSize: '13px', marginTop: '4px', opacity: 0.9 }}>{t.body}</div>}
              </div>
              <button onClick={() => dismissToast(t.id)} style={{
                background: 'none', border: 'none', color: 'white',
                cursor: 'pointer', fontSize: '16px', lineHeight: 1, opacity: 0.7, flexShrink: 0,
              }}>✕</button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
