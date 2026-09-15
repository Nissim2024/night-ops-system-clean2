import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { usePermissions } from '../context/PermissionsContext';
import { C, statusColor, statusBg, severityColor, severityBg, severityLabel } from '../theme';
import { cn } from '../lib/utils';
import { formatDateTime, formatTime } from '../utils/dateFormat';
import { FocusModeModal } from './FocusModeModal';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Props {
  token: string;
  versionId: string;
  versionName: string;
  isRehearsal?: boolean;
  hideGoNogo?: boolean;
  onTeamClick?: (teamId: string, teamName: string) => void;
  onlineUsers?: { userId: string; fullName: string; teamId?: string }[];
  onVersionEnded?: () => void;
  refreshSignal?: number;
  onGoToHub?: () => void;
  onGoHome?: () => void;
}

type GoStatus = 'checking' | 'go' | 'nogo' | null;

interface GoNoPanelProps {
  env: string;
  label: string;
  status: GoStatus;
  details: { incomplete: number; blocked: number; blockedNoReason: string[]; incompleteTasks?: { title: string; team: string; phase: string; status: string }[] } | undefined;
  envTasks: any[];
  onCheck: (env: string) => void;
  failedTasks?: any[];
  onWaive?: (taskId: string) => void;
  onRequestWaive?: (taskId: string, title: string) => void;
  onToggleHistory?: (taskId: string) => void;
  historyOpenId?: string | null;
  historyData?: Record<string, any[]>;
  isManager?: boolean;
  isRehearsal?: boolean;
}

const GoNoGoPanel: React.FC<GoNoPanelProps> = ({ env, label, status, details, envTasks, onCheck, failedTasks = [], onWaive, onRequestWaive, onToggleHistory, historyOpenId, historyData, isManager, isRehearsal }) => {
  const canCheck = envTasks.length > 0;
  const unwaived = failedTasks.filter((t: any) => !t.goNoGoWaived);
  const waived = failedTasks.filter((t: any) => t.goNoGoWaived);
  return (
    <div
      className="rounded-[10px] p-4 min-w-[280px] flex-1 border"
      style={{ background: isRehearsal ? 'rgba(124,58,237,0.07)' : C.bgNested, borderColor: isRehearsal ? 'rgba(139,92,246,0.40)' : C.border }}>
      {isRehearsal && (
        <div className="text-[13px] font-bold rounded-[20px] inline-block mb-2 py-[3px] px-2.5 border" style={{ color: '#7c3aed', background: 'rgba(124,58,237,0.12)', borderColor: 'rgba(124,58,237,0.30)' }}>
          🎭 חזרה גנרלית
        </div>
      )}
      <div className="font-bold text-foreground mb-2.5 text-[15px]">{label}</div>
      <div className="text-sm text-subtle-foreground mb-2.5">
        {envTasks.length} משימות · {envTasks.filter((t: any) => t.status === 'DONE').length} הושלמו
      </div>
      <button
        onClick={() => canCheck && onCheck(env)}
        disabled={!canCheck}
        className={cn('py-2.5 px-5 font-bold text-[15px] border-none rounded-lg w-full', canCheck ? 'cursor-pointer' : 'cursor-not-allowed')}
        style={{
          background: !canCheck ? C.bgHover : status === 'go' ? C.statusDone : status === 'nogo' ? C.statusFailed : isRehearsal ? '#8b5cf6' : C.brand,
          color: !canCheck ? C.textDisabled : 'white',
        }}
      >
        {status === 'checking' ? 'בודק...' : status === 'go' ? (isRehearsal ? '✅ GO — חזרה!' : '✅ GO!') : status === 'nogo' ? '❌ NO GO' : isRehearsal ? 'בדוק GO/NO GO (חזרה)' : 'בדוק GO/NO GO'}
      </button>
      {status === 'go' && (
        <div className="mt-2.5 rounded-md py-2 px-3 font-bold text-[15px] border" style={{ background: C.bgDone, color: C.statusDone, borderColor: `${C.statusDone}44` }}>
          {isRehearsal ? `✅ חזרה הצליחה ב-${label}!` : `כל משימות ${label} הושלמו — ניתן להמשיך!`}
        </div>
      )}
      {status === 'nogo' && details && (
        <div className="mt-2.5 rounded-md py-2 px-3 text-[15px] border" style={{ background: C.bgBlocked, color: C.statusFailed, borderColor: `${C.statusFailed}44` }}>
          {(details as any).missingByEnv?.length > 0 && (
            <div className="mb-1.5">
              {(details as any).missingByEnv.map((line: string, i: number) => (
                <div key={i}>⚠️ {line}</div>
              ))}
            </div>
          )}
          {details.blocked > 0 && <div>{details.blocked} משימות חסומות/נכשלו</div>}
          {details.blockedNoReason?.length > 0 && (
            <div className="mt-1.5 pt-1.5 border-t" style={{ borderColor: `${C.statusFailed}44` }}>
              <div className="font-bold mb-1">⚠️ חסומות ללא סיבה:</div>
              {details.blockedNoReason.map((title: string, i: number) => (
                <div key={i} className="text-sm">• {title}</div>
              ))}
            </div>
          )}
          {(details as any).incompleteTasks?.length > 0 && (
            <div className="mt-1.5 pt-1.5 border-t" style={{ borderColor: `${C.statusFailed}44` }}>
              <div className="font-bold mb-1 text-sm">⏳ משימות שטרם הושלמו:</div>
              {(details as any).incompleteTasks.map((t: any, i: number) => (
                <div key={i} className="text-[13px] mb-[3px] flex gap-1.5 items-center">
                  <span className="rounded font-bold whitespace-nowrap py-px px-[5px]" style={{ background: C.statusFailed + '22', color: C.statusFailed }}>{t.status}</span>
                  <span className="flex-1">{t.title}</span>
                  <span className="text-subtle-foreground whitespace-nowrap">{t.team}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {isManager && failedTasks.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-border">
          <div className="text-sm font-bold mb-1.5" style={{ color: C.statusFailed }}>
            ⚠️ משימות נכשלות ({failedTasks.length})
          </div>
          {unwaived.map((t: any) => (
            <div key={t.id} className="flex items-center gap-1.5 mb-1 rounded-md py-1 px-2" style={{ background: C.bgBlocked }}>
              <span className="flex-1 text-sm" style={{ color: C.statusFailed }}>{t.title}</span>
              <button onClick={() => onRequestWaive?.(t.id, t.title)}
                className="py-0.5 px-2 text-[13px] text-white border-none rounded cursor-pointer whitespace-nowrap" style={{ background: '#8b5cf6' }}>
                ✓ אשר דילוג
              </button>
            </div>
          ))}
          {waived.length > 0 && (
            <div className="mt-1">
              <div className="text-[13px] text-subtle-foreground mb-[3px]">מאושרים לדילוג:</div>
              {waived.map((t: any) => (
                <div key={t.id} className="mb-[3px]">
                  <div className="flex items-center gap-1.5 rounded-md py-[3px] px-2" style={{ background: C.bgDone }}>
                    <span className="flex-1 text-sm" style={{ color: C.statusDone }}>✓ {t.title}</span>
                    <button onClick={() => onToggleHistory?.(t.id)}
                      title="היסטוריית דילוגים"
                      className="py-0.5 px-1.5 text-xs bg-transparent text-subtle-foreground border border-border rounded cursor-pointer whitespace-nowrap">
                      🕐
                    </button>
                    <button onClick={() => onWaive?.(t.id)}
                      className="py-0.5 px-1.5 text-xs text-subtle-foreground border border-border rounded cursor-pointer whitespace-nowrap" style={{ background: C.bgHover }}>
                      בטל
                    </button>
                  </div>
                  {historyOpenId === t.id && (
                    <div className="mt-[3px] me-2 py-1.5 px-2.5 rounded-md border border-border" style={{ background: C.bgNested }}>
                      {!historyData?.[t.id] ? (
                        <div className="text-[13px] text-subtle-foreground">טוען...</div>
                      ) : historyData[t.id].length === 0 ? (
                        <div className="text-[13px] text-subtle-foreground">אין היסטוריה</div>
                      ) : (
                        historyData[t.id].map((h: any) => (
                          <div key={h.id} className="text-[13px] text-muted-foreground mb-1">
                            <div>
                              <strong>{h.action === 'GO_NOGO_WAIVED' ? '✓ אושר דילוג' : '↩ בוטל דילוג'}</strong>
                              {' '}ע"י {h.user?.fullName ?? '?'} · {formatDateTime(h.createdAt)}
                            </div>
                            {h.afterData?.reason && <div className="text-subtle-foreground">סיבה: {h.afterData.reason}</div>}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const WarRoom: React.FC<Props> = ({ token, versionId, versionName, isRehearsal = false, hideGoNogo = false, onTeamClick, onlineUsers = [], onVersionEnded, refreshSignal, onGoToHub, onGoHome }) => {
  const { can } = usePermissions();
  const [version, setVersion] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [planView, setPlanView] = useState<'overview' | 'plan' | 'connected'>('overview');
  const [subscribedUserIds, setSubscribedUserIds] = useState<string[]>([]);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [pushToggling, setPushToggling] = useState(false);
  const [blockingTask, setBlockingTask] = useState<{ id: string; title: string } | null>(null);
  const [blockingReason, setBlockingReason] = useState('');
  const [blockingSeverity, setBlockingSeverity] = useState('MEDIUM');
  const [waivingTask, setWaivingTask] = useState<{ id: string; title: string } | null>(null);
  const [waivingReason, setWaivingReason] = useState('');
  const [waiverHistoryOpenId, setWaiverHistoryOpenId] = useState<string | null>(null);
  const [waiverHistoryData, setWaiverHistoryData] = useState<Record<string, any[]>>({});
  const [focusMode, setFocusMode] = useState(false);

  const payload = JSON.parse(atob(token.split('.')[1]));
  const isManager = ['RELEASE_MANAGER', 'ADMIN'].includes(payload.role);
  // For non-managers (TEAM_LEAD), derive their team so focus mode can be scoped to it
  const myFocusTeam = !isManager
    ? teams.find((t: any) => t.members?.some((m: any) => m.userId === payload.sub || m.user?.id === payload.sub)) ?? null
    : null;

  const [goStatus, setGoStatus] = useState<Record<string, GoStatus>>({});
  const [goDetails, setGoDetails] = useState<Record<string, { incomplete: number; blocked: number; blockedNoReason: string[] }>>({});

  const headers = { Authorization: `Bearer ${token}` };

  const allTasks: any[] = useMemo(() =>
    (version?.phases ?? []).flatMap((p: any) =>
      (p.subPhases ?? []).flatMap((sp: any) =>
        (sp.tasks ?? []).map((t: any) => ({
          ...t,
          _phaseEnv: p.environment,
          _phaseOrderIndex: p.orderIndex,
          _phaseName: p.name,
          _phaseId: p.id,
          _subPhaseName: sp.name,
          _subPhaseId: sp.id,
        }))
      )
    ),
  [version]);

  // Active phase: first phase that still has non-terminal tasks
  const TERMINAL = ['DONE', 'FAILED', 'ROLLED_BACK'];

  // Same phase-gate rule as tasks.service.ts/TeamView — a task in a later
  // phase can't be opened/started while an earlier phase still has
  // incomplete work. The status <select> below has no gate at all otherwise
  // (unlike TeamView's dedicated buttons), so a manager could freely jump
  // straight to a later phase from here even with the server-side fix.
  const blockedPhaseTaskIds = useMemo((): Set<string> => {
    const result = new Set<string>();
    if (!['ACTIVE', 'REHEARSAL'].includes(version?.status) || !version?.phases?.length) return result;
    const now = Date.now();
    const phases = [...version.phases].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
    for (let i = 1; i < phases.length; i++) {
      const phaseStartArrived = version.status === 'ACTIVE' && phases[i].plannedStart != null && new Date(phases[i].plannedStart).getTime() <= now;
      if (phaseStartArrived) continue;
      const prevIncomplete = phases.slice(0, i).some((p: any) =>
        (p.subPhases ?? []).some((sp: any) => (sp.tasks ?? []).some((t: any) => !TERMINAL.includes(t.status)))
      );
      if (prevIncomplete) {
        for (const sp of phases[i].subPhases ?? []) {
          for (const t of sp.tasks ?? []) result.add(t.id);
        }
      }
    }
    return result;
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const { focusTasks, focusAllPhaseTasks, focusActivePhaseName, focusNextPhaseInfo } = useMemo(() => {
    if (!allTasks.length) return { focusTasks: [], focusAllPhaseTasks: [], focusActivePhaseName: '', focusNextPhaseInfo: null as { name: string; startTime: string | null } | null };

    const phaseMap: Record<number, any[]> = {};
    for (const t of allTasks) {
      const key: number = t._phaseOrderIndex ?? 0;
      if (!phaseMap[key]) phaseMap[key] = [];
      phaseMap[key].push(t);
    }

    const sortedKeys = Object.keys(phaseMap).map(Number).sort((a, b) => a - b);
    const activeKey = sortedKeys.find(k => phaseMap[k].some((t: any) => !TERMINAL.includes(t.status)));

    if (activeKey === undefined) return { focusTasks: [], focusAllPhaseTasks: [], focusActivePhaseName: '', focusNextPhaseInfo: null };

    const sorted = [...(phaseMap[activeKey] as any[])].sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    // Non-terminal tasks for the button badge count
    const active = sorted.filter((t: any) => !TERMINAL.includes(t.status));
    const phaseName = sorted[0]?._phaseName ?? '';

    // Next phase — for the completion banner. Use the earliest task time within it
    // (rehearsal-specific when set) rather than Phase.plannedStart, which only ever
    // reflects the production schedule.
    const nextKey = sortedKeys.find(k => k > activeKey);
    let nextPhaseInfo: { name: string; startTime: string | null } | null = null;
    if (nextKey !== undefined) {
      const nextPhaseTasks = phaseMap[nextKey];
      const times = nextPhaseTasks
        .map((t: any) => t.rehearsalPlannedStart ?? t.plannedStart)
        .filter(Boolean)
        .map((d: any) => new Date(d).getTime());
      const earliest = times.length ? new Date(Math.min(...times)).toISOString() : null;
      nextPhaseInfo = { name: nextPhaseTasks[0]?._phaseName ?? '', startTime: earliest };
    }

    return { focusTasks: active, focusAllPhaseTasks: sorted, focusActivePhaseName: phaseName, focusNextPhaseInfo: nextPhaseInfo };
  }, [allTasks]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusAction = async (taskId: string, status: string, reason?: string) => {
    setUpdatingTaskId(taskId);
    try {
      await axios.patch(`${API}/tasks/${taskId}/status`,
        { status, ...(reason !== undefined && { blockedReason: reason }) },
        { headers });
      await fetchData(true);
    } catch (err: any) {
      console.error(err);
      window.alert(err?.response?.data?.message || 'שגיאה בעדכון סטטוס המשימה');
    }
    finally { setUpdatingTaskId(null); }
  };

  const fetchDataRef = React.useRef<(silent?: boolean) => Promise<void>>(undefined);

  const fetchData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [versionRes, teamsRes] = await Promise.all([
        axios.get(`${API}/versions/${versionId}`, { headers }),
        axios.get(`${API}/teams`, { headers }),
      ]);
      const v = versionRes.data;
      setVersion(v);
      setTeams(teamsRes.data);
      setGoStatus({});
      setGoDetails({});
    } catch (err) { console.error(err); }
    finally { if (!silent) setLoading(false); }
  };

  fetchDataRef.current = fetchData;

  useEffect(() => { fetchData(); }, [versionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const socket = io(process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`, { transports: ['websocket'] });
    socket.on('TASK_UPDATED', () => fetchDataRef.current?.(true));
    socket.on('TASK_BLOCKED', () => fetchDataRef.current?.(true));
    return () => { socket.disconnect(); };
  }, []);

  useEffect(() => { if (refreshSignal) fetchDataRef.current?.(true); }, [refreshSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const interval = setInterval(() => fetchDataRef.current?.(true), 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const h = { Authorization: `Bearer ${token}` };
    axios.get(`${API}/push/subscribed-users`, { headers: h }).then(r => setSubscribedUserIds(r.data)).catch(() => {});
    axios.get(`${API}/push/status`, { headers: h }).then(r => setPushEnabled(r.data.enabled)).catch(() => {});
  }, [token]);

  // Use the same traversal as the plan view to guarantee count consistency
  const getEnvTasks = (env: string) =>
    (version?.phases ?? [])
      .filter((p: any) => p.environment === env)
      .flatMap((p: any) => (p.subPhases ?? []).flatMap((sp: any) => sp.tasks ?? []));

  const checkGoForEnv = (env: string) => {
    setGoStatus(prev => ({ ...prev, [env]: 'checking' }));

    // Derive directly from version.phases (same source as plan view) to guarantee consistency
    const phases = [...(version?.phases ?? [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
    const targetPhase = phases.find((p: any) => p.environment === env);
    const targetOrderIndex = targetPhase?.orderIndex ?? 999;

    const requiredPhases = phases.filter((p: any) => p.orderIndex <= targetOrderIndex);

    // Group by phase ID (not orderIndex) — prevents merging phases that share the same orderIndex
    const phasesSeen = new Map<string, { name: string; orderIndex: number; done: number; total: number }>();
    for (const p of requiredPhases) {
      phasesSeen.set(p.id, { name: p.name, orderIndex: p.orderIndex, done: 0, total: 0 });
    }

    const allRequired: any[] = [];
    for (const p of requiredPhases) {
      const entry = phasesSeen.get(p.id)!;
      for (const sp of (p.subPhases ?? [])) {
        for (const t of (sp.tasks ?? [])) {
          allRequired.push({ ...t, _phaseId: p.id });
          entry.total++;
          if (t.status === 'DONE') entry.done++;
        }
      }
    }

    const incompleteList = allRequired.filter((t: any) => t.status !== 'DONE' && !t.goNoGoWaived);
    const incomplete = incompleteList.length;
    const blocked = incompleteList.filter((t: any) => t.status === 'BLOCKED' || t.status === 'FAILED').length;
    const blockedNoReason = incompleteList
      .filter((t: any) => t.status === 'BLOCKED' && !t.blockedReason)
      .map((t: any) => t.title);

    const statusLabel: Record<string, string> = {
      WAITING: 'ממתין', OPEN: 'פתוח', IN_PROGRESS: 'בביצוע',
      BLOCKED: 'חסום', FAILED: 'נכשל',
    };
    const incompleteTasks = incompleteList.slice(0, 10).map((t: any) => ({
      title: t.title,
      team: t.assignedTeam?.name ?? t.assignedTeamId ?? '',
      phase: phasesSeen.get(t._phaseId ?? '')?.name ?? '',
      status: statusLabel[t.status] ?? t.status,
    }));

    const missingByEnv: string[] = Array.from(phasesSeen.values())
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .filter(p => p.done < p.total)
      .map(p => `${p.name}: ${p.done}/${p.total} הושלמו`);

    setGoDetails(prev => ({ ...prev, [env]: { blocked, incomplete, blockedNoReason, missingByEnv, incompleteTasks } as any }));
    setTimeout(() => {
      setGoStatus(prev => ({
        ...prev,
        [env]: allRequired.length > 0 && incomplete === 0 ? 'go' : 'nogo',
      }));
    }, 1200);
  };

  const getTeamStats = (teamId: string) => {
    const teamTasks = allTasks.filter(t => t.assignedTeamId === teamId);
    return {
      total: teamTasks.length,
      done: teamTasks.filter(t => t.status === 'DONE').length,
      inProgress: teamTasks.filter(t => t.status === 'IN_PROGRESS').length,
      blocked: teamTasks.filter(t => t.status === 'BLOCKED').length,
      failed: teamTasks.filter(t => t.status === 'FAILED').length,
      waiting: teamTasks.filter(t => t.status === 'WAITING').length,
      open: teamTasks.filter(t => t.status === 'OPEN').length,
    };
  };

  const totalTasks = allTasks.length;
  const doneTasks = allTasks.filter(t => t.status === 'DONE').length;
  const blockedTasks = allTasks.filter(t => t.status === 'BLOCKED').length;
  const inProgressTasks = allTasks.filter(t => t.status === 'IN_PROGRESS').length;
  const progressPercent = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const TASK_STATUSES = [
    { value: 'WAITING',     label: 'ממתין',   color: C.statusWaiting },
    { value: 'OPEN',        label: 'פתוח',     color: C.statusOpen },
    { value: 'IN_PROGRESS', label: 'בביצוע',   color: C.statusInProgress },
    { value: 'DONE',        label: 'הושלם',    color: C.statusDone },
    { value: 'BLOCKED',     label: 'חסום',     color: C.statusBlocked },
    { value: 'FAILED',      label: 'נכשל',     color: C.statusFailed },
    { value: 'ROLLED_BACK', label: 'Rollback', color: C.statusRollback },
  ];

  const ROLLBACK_MAP: Record<string, string> = {
    FAILED: 'IN_PROGRESS', DONE: 'IN_PROGRESS', IN_PROGRESS: 'OPEN',
    OPEN: 'WAITING', ROLLED_BACK: 'IN_PROGRESS', BLOCKED: 'OPEN',
  };

  const rollbackTaskStatus = async (taskId: string) => {
    setUpdatingTaskId(taskId);
    try {
      await axios.patch(`${API}/tasks/${taskId}/rollback-status`, {}, { headers });
      await fetchData(true);
    } catch (err) { console.error(err); }
    finally { setUpdatingTaskId(null); }
  };

  const waiveTask = async (taskId: string, reason?: string) => {
    try {
      await axios.patch(`${API}/tasks/${taskId}/waive-gonogo`, { reason }, { headers });
      await fetchData(true);
    } catch (err) { console.error(err); }
  };

  const toggleWaiverHistory = async (taskId: string) => {
    if (waiverHistoryOpenId === taskId) { setWaiverHistoryOpenId(null); return; }
    setWaiverHistoryOpenId(taskId);
    if (!waiverHistoryData[taskId]) {
      try {
        const res = await axios.get(`${API}/tasks/${taskId}/waiver-history`, { headers });
        setWaiverHistoryData(prev => ({ ...prev, [taskId]: res.data }));
      } catch { setWaiverHistoryData(prev => ({ ...prev, [taskId]: [] })); }
    }
  };

  const getGoRequiredTasks = (env: string) => {
    const phases = [...(version?.phases ?? [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
    const targetOrderIndex = phases.find((p: any) => p.environment === env)?.orderIndex ?? 999;
    return phases
      .filter((p: any) => p.orderIndex <= targetOrderIndex)
      .flatMap((p: any) => (p.subPhases ?? []).flatMap((sp: any) => sp.tasks ?? []));
  };

  const updateTaskStatus = async (taskId: string, status: string, blockedReason?: string, blockedSeverity?: string) => {
    if (status === 'BLOCKED' && blockedReason === undefined) {
      const task = allTasks.find(t => t.id === taskId);
      setBlockingTask({ id: taskId, title: task?.title || taskId });
      setBlockingReason('');
      setBlockingSeverity('MEDIUM');
      return;
    }
    setUpdatingTaskId(taskId);
    try {
      await axios.patch(`${API}/tasks/${taskId}/status`, { status, ...(blockedReason !== undefined && { blockedReason, blockedSeverity }) }, { headers });
      await fetchData();
    } catch (err: any) {
      console.error(err);
      // Phase-gate rejections (and any other server-side validation) were
      // silently swallowed here before — the dropdown just snapped back with
      // no explanation, which is how a blocked phase-4 task looked like it
      // "didn't work" instead of "isn't allowed yet."
      window.alert(err?.response?.data?.message || 'שגיאה בעדכון סטטוס המשימה');
    }
    finally { setUpdatingTaskId(null); }
  };

  const ENV_COLORS: Record<string, { bg: string; color: string }> = {
    HOT:    { bg: 'rgba(248,81,73,0.12)',  color: C.statusBlocked },
    HOTNET: { bg: 'rgba(45,125,210,0.12)', color: C.statusOpen },
    BOTH:   { bg: C.bgHover,               color: C.textMuted },
  };

  if (loading) return (
    <div className="text-center p-[60px] text-subtle-foreground">
      טוען War Room...
    </div>
  );

  return (
    <div>

      {/* באנר חזרה גנרלית */}
      {isRehearsal && (
        <div className="rounded-[10px] py-3 px-5 mb-4 flex items-center gap-3 text-white" style={{ background: 'linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%)' }}>
          <span className="text-[28px]">🎭</span>
          <div>
            <div className="font-bold text-[17px]">מצב חזרה גנרלית</div>
            <div className="text-[15px] opacity-90">סימולציה של לילה אמיתי — בסיום ניתן להוציא סיכום ולאפס את הגרסה ל"מאושר"</div>
          </div>
        </div>
      )}

      {/* כותרת */}
      <div
        className="rounded-xl p-6 mb-5 border shadow-sm"
        style={{
          background: isRehearsal ? 'linear-gradient(135deg, #4c1d95 0%, #7c3aed 100%)' : C.bgCard,
          borderColor: isRehearsal ? 'rgba(139,92,246,0.50)' : C.border,
        }}>
        <div className="flex justify-between items-center">
          <div>
            <h2 className="m-0 mb-1 text-[22px]" style={{ color: isRehearsal ? 'white' : C.textPrimary }}>
              {isRehearsal ? '🎭 ' : ''}War Room —{' '}
              <span
                onClick={onGoToHub}
                title={onGoToHub ? 'עבור לדף הנחיתה' : undefined}
                className={cn(onGoToHub ? 'cursor-pointer underline decoration-dotted' : 'cursor-default no-underline')}
              >{versionName}</span>
            </h2>
            <p className="m-0 text-[15px]" style={{ color: isRehearsal ? 'rgba(255,255,255,0.75)' : C.textMuted }}>
              {isRehearsal ? 'חזרה גנרלית — בזמן אמת' : 'מבט-על בזמן אמת'}
            </p>
            {version?.reviewMeetingTime && (
              <p className="mt-1 mb-0 text-[15px] font-semibold" style={{ color: isRehearsal ? 'rgba(255,255,255,0.90)' : C.info }}>
                🗓 ישיבת מעבר: {formatDateTime(version.reviewMeetingTime)}
              </p>
            )}
          </div>
          <div className="flex gap-2 items-center">
            {isManager && (
              <button
                disabled={pushToggling}
                onClick={async () => {
                  setPushToggling(true);
                  try {
                    const r = await axios.post(`${API}/push/toggle`, { enabled: !pushEnabled }, { headers });
                    setPushEnabled(r.data.enabled);
                  } catch {} finally { setPushToggling(false); }
                }}
                title={pushEnabled ? 'כבה התראות Push לכולם' : 'הפעל התראות Push לכולם'}
                className={cn('py-1.5 px-3.5 rounded-lg text-[15px] font-bold border-none', pushToggling ? 'cursor-not-allowed' : 'cursor-pointer')}
                style={{ background: pushEnabled ? C.successBg : C.dangerBg, color: pushEnabled ? C.statusDone : C.statusFailed }}>
                {pushEnabled ? '🔔 Push פעיל' : '🔕 Push כבוי'}
              </button>
            )}
            {version?.phases?.length > 0 && (
              <button onClick={() => setFocusMode(true)} className="py-1.5 px-4 text-white border-none rounded-lg cursor-pointer text-[15px] font-bold" style={{ background: C.brand }}>
                ⚡ מצב הרצה{focusTasks.length > 0 ? ` (${focusTasks.length})` : ''}
              </button>
            )}
            <button onClick={() => fetchData()} className="py-1.5 px-4 bg-muted text-muted-foreground rounded-lg cursor-pointer text-[15px] border" style={{ borderColor: C.borderEm }}>
              רענן
            </button>
          </div>
        </div>

        {/* בר התקדמות מפולח לפי שלבים */}
        {(() => {
          const phases = [...(version?.phases ?? [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
          if (phases.length === 0 || totalTasks === 0) return (
            <div className="mt-5">
              <div className="flex justify-between mb-1.5 text-[15px]" style={{ color: isRehearsal ? 'rgba(255,255,255,0.80)' : C.textSecondary }}>
                <span>התקדמות כללית</span>
                <span>{doneTasks}/{totalTasks} משימות ({progressPercent}%)</span>
              </div>
              <div className="rounded-lg h-2.5 overflow-hidden" style={{ background: isRehearsal ? 'rgba(0,0,0,0.20)' : C.bgHover }}>
                <div className="h-full rounded-lg transition-[width] duration-500 ease-in-out" style={{ background: progressPercent === 100 ? C.statusDone : C.brand, width: `${progressPercent}%` }} />
              </div>
            </div>
          );
          const phaseStats = phases.map((p: any) => {
            const pTasks = (p.subPhases ?? []).flatMap((sp: any) => sp.tasks ?? []);
            const done = pTasks.filter((t: any) => TERMINAL.includes(t.status)).length;
            const inProg = pTasks.filter((t: any) => t.status === 'IN_PROGRESS').length;
            const blocked = pTasks.filter((t: any) => t.status === 'BLOCKED').length;
            const total = pTasks.length;
            const pct = total > 0 ? done / total : 0;
            const isActive = total > 0 && done < total && (inProg > 0 || blocked > 0 || pTasks.some((t: any) => t.status === 'OPEN'));
            const isDone = total > 0 && done === total;
            return { id: p.id, name: p.name, done, inProg, blocked, total, pct, isActive, isDone };
          }).filter((p: any) => p.total > 0);
          const totalAll = phaseStats.reduce((s: number, p: any) => s + p.total, 0);
          return (
            <div className="mt-5">
              <div className="flex justify-between mb-1.5 text-[15px]" style={{ color: isRehearsal ? 'rgba(255,255,255,0.80)' : C.textSecondary }}>
                <span>התקדמות כללית</span>
                <span>{doneTasks}/{totalTasks} משימות ({progressPercent}%)</span>
              </div>
              {/* Segmented bar */}
              <div className="flex gap-0.5 h-3 rounded-lg overflow-hidden" style={{ background: isRehearsal ? 'rgba(0,0,0,0.20)' : C.bgHover }}>
                {phaseStats.map((p: any, i: number) => {
                  const segWidth = totalAll > 0 ? (p.total / totalAll) * 100 : 0;
                  const fillColor = p.isDone ? C.statusDone : p.isActive ? C.statusInProgress : C.brand;
                  const fillPct = p.pct * 100;
                  return (
                    <div key={p.id} title={`${p.name}: ${p.done}/${p.total}`}
                      className="relative overflow-hidden"
                      style={{
                        flex: `${segWidth} 0 0%`,
                        background: isRehearsal ? 'rgba(255,255,255,0.08)' : C.bgHover,
                        borderInlineStart: i > 0 ? `2px solid ${isRehearsal ? 'rgba(0,0,0,0.3)' : C.bgApp}` : 'none',
                      }}>
                      <div className="absolute inset-y-0 start-0 h-full transition-[width] duration-500 ease-in-out" style={{ width: `${fillPct}%`, background: fillColor }} />
                    </div>
                  );
                })}
              </div>
              {/* Phase labels */}
              <div className="flex gap-0.5 mt-[5px]">
                {phaseStats.map((p: any) => {
                  const segWidth = totalAll > 0 ? (p.total / totalAll) * 100 : 0;
                  const labelColor = p.isDone ? C.statusDone : p.isActive ? C.statusInProgress : isRehearsal ? 'rgba(255,255,255,0.45)' : C.textDisabled;
                  return (
                    <div key={p.id} title={`${p.name}: ${p.done}/${p.total}`} className="overflow-hidden text-center" style={{ flex: `${segWidth} 0 0%` }}>
                      <span className="text-xs whitespace-nowrap block overflow-hidden text-ellipsis" style={{ color: labelColor }}>
                        {p.isActive ? '▶ ' : p.isDone ? '✓ ' : ''}{p.name} {p.done}/{p.total}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        <div className="flex gap-2.5 mt-4 flex-wrap">
          {[
            { label: 'הושלמו', value: doneTasks,                                              color: C.statusDone },
            { label: 'בביצוע', value: inProgressTasks,                                        color: C.statusInProgress },
            { label: 'פתוחות', value: allTasks.filter(t => t.status === 'OPEN').length,       color: C.statusOpen },
            { label: 'ממתינות', value: allTasks.filter(t => t.status === 'WAITING').length,   color: C.statusWaiting },
            { label: 'חסומות', value: blockedTasks,                                            color: C.statusBlocked },
            { label: 'סה"כ',  value: totalTasks,                                              color: isRehearsal ? 'white' : C.textPrimary },
          ].map(stat => (
            <div key={stat.label} className="rounded-lg py-2.5 px-3.5 text-center min-w-[70px] border"
              style={{ background: isRehearsal ? 'rgba(0,0,0,0.20)' : C.bgNested, borderColor: isRehearsal ? 'rgba(255,255,255,0.12)' : C.border }}>
              <div className="text-[22px] font-bold" style={{ color: stat.color }}>{stat.value}</div>
              <div className="text-[13px]" style={{ color: isRehearsal ? 'rgba(255,255,255,0.65)' : C.textMuted }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* GO/NO GO — מפוצל לפי סביבה */}
      {(can('action:gonogo') || isManager) && !hideGoNogo && (
        <div className="rounded-xl p-5 mb-5 border" style={{ background: isRehearsal ? 'rgba(124,58,237,0.06)' : C.bgCard, borderColor: isRehearsal ? 'rgba(139,92,246,0.28)' : C.border }}>
          <div className="flex items-center gap-2.5 mb-4">
            <h3 className="m-0 text-base" style={{ color: isRehearsal ? '#7c3aed' : C.textPrimary }}>GO / NO GO — {isRehearsal ? 'חזרה גנרלית' : 'לפי סביבה'}</h3>
            {isRehearsal && <span className="text-sm rounded-[20px] py-0.5 px-2.5 border" style={{ color: '#7c3aed', background: 'rgba(124,58,237,0.10)', borderColor: 'rgba(124,58,237,0.25)' }}>אינו מחליף GO/NO GO אמיתי</span>}
          </div>
          <div className="flex gap-4 flex-wrap">
            <GoNoGoPanel env="HOTNET" label="פעילות לילה — HOTNET" status={goStatus['HOTNET']} details={goDetails['HOTNET']} envTasks={getEnvTasks('HOTNET')} onCheck={checkGoForEnv}
              failedTasks={getGoRequiredTasks('HOTNET').filter(t => t.status === 'FAILED')} onWaive={waiveTask}
              onRequestWaive={(id, title) => { setWaivingTask({ id, title }); setWaivingReason(''); }}
              onToggleHistory={toggleWaiverHistory} historyOpenId={waiverHistoryOpenId} historyData={waiverHistoryData}
              isManager={isManager} isRehearsal={isRehearsal} />
            <GoNoGoPanel env="HOT" label="פעילות לילה — HOT" status={goStatus['HOT']} details={goDetails['HOT']} envTasks={getEnvTasks('HOT')} onCheck={checkGoForEnv}
              failedTasks={getGoRequiredTasks('HOT').filter(t => t.status === 'FAILED')} onWaive={waiveTask}
              onRequestWaive={(id, title) => { setWaivingTask({ id, title }); setWaivingReason(''); }}
              onToggleHistory={toggleWaiverHistory} historyOpenId={waiverHistoryOpenId} historyData={waiverHistoryData}
              isManager={isManager} isRehearsal={isRehearsal} />
          </div>
        </div>
      )}

      {/* בחירת תצוגה */}
      <div className="flex gap-2 mb-5">
        {[
          { key: 'overview',   label: '👥 סקירת צוותים' },
          { key: 'connected',  label: `🟢 מחוברים (${onlineUsers.length})` },
          { key: 'plan',       label: '📋 תוכנית ביצוע' },
        ].map(tab => (
          <button key={tab.key} onClick={() => setPlanView(tab.key as any)}
            className="py-2.5 px-5 font-bold text-[15px] rounded-lg cursor-pointer border"
            style={{
              borderColor: planView === tab.key ? C.brand : C.border,
              background: planView === tab.key ? C.brandDim : C.bgNested,
              color: planView === tab.key ? C.textPrimary : C.textSecondary,
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* תוכנית ביצוע */}
      {planView === 'plan' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <h3 className="m-0 text-base text-foreground">תוכנית ביצוע</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setCollapsedPhases(new Set(version?.phases?.map((p: any) => p.id) ?? []))}
                className="py-1.5 px-3.5 bg-muted border border-border rounded-md cursor-pointer text-[15px] text-muted-foreground">
                ▶ קפל הכל
              </button>
              <button
                onClick={() => setCollapsedPhases(new Set())}
                className="py-1.5 px-3.5 bg-muted border border-border rounded-md cursor-pointer text-[15px] text-muted-foreground">
                ▼ פתח הכל
              </button>
            </div>
          </div>
          {(version?.phases ?? []).map((phase: any) => {
            const envStyle = ENV_COLORS[phase.environment] ?? ENV_COLORS.BOTH;
            const phaseTasks = phase.subPhases?.flatMap((sp: any) => sp.tasks ?? []) ?? [];
            const phaseDone = phaseTasks.filter((t: any) => t.status === 'DONE').length;
            const isCollapsed = collapsedPhases.has(phase.id);
            return (
              <div key={phase.id} className="bg-card rounded-xl py-4 px-5 mb-3 border border-border">
                <div onClick={() => setCollapsedPhases(prev => { const n = new Set(prev); n.has(phase.id) ? n.delete(phase.id) : n.add(phase.id); return n; })}
                  className={cn('flex items-center gap-2.5 cursor-pointer', isCollapsed ? 'mb-0' : 'mb-3')}>
                  <span className="text-sm text-subtle-foreground">{isCollapsed ? '►' : '▼'}</span>
                  <span className="py-0.5 px-2 rounded text-sm font-bold" style={{ background: envStyle.bg, color: envStyle.color }}>{phase.environment}</span>
                  <span className="font-bold text-foreground text-base">{phase.name}</span>
                  <span className="text-sm font-bold" style={{ color: phaseDone === phaseTasks.length && phaseTasks.length > 0 ? C.statusDone : C.textMuted }}>
                    {phaseDone}/{phaseTasks.length} ✓
                  </span>
                </div>
                {!isCollapsed && phase.subPhases?.map((sub: any) => {
                  const subDone = (sub.tasks ?? []).filter((t: any) => t.status === 'DONE').length;
                  return (
                    <div key={sub.id} className="mb-2.5 ps-4 border-s-[3px]" style={{ borderColor: C.borderEm }}>
                      <div className="font-bold text-muted-foreground text-[15px] mb-1.5 flex items-center gap-2">
                        {sub.name}
                        <span className="text-[13px] text-subtle-foreground font-normal">{subDone}/{sub.tasks?.length ?? 0}</span>
                      </div>
                      {(sub.tasks ?? []).map((task: any) => {
                        const statusDef = TASK_STATUSES.find(s => s.value === task.status) ?? TASK_STATUSES[0];
                        const isBlocked = task.status === 'BLOCKED' || task.status === 'FAILED';
                        return (
                          <div key={task.id}
                            className="rounded-lg py-2 px-3 mb-1 flex justify-between items-center gap-2 border-s-[3px]"
                            style={{
                              background: isBlocked ? C.bgBlocked : C.bgNested,
                              borderInlineStartColor: statusDef.color,
                              border: `1px solid ${isBlocked ? C.statusFailed + '44' : C.border}`,
                              borderInlineStartWidth: '3px',
                            }}>
                            <div className="flex-1 min-w-0">
                              <div className={cn('text-[15px] text-foreground', task.status === 'IN_PROGRESS' ? 'font-bold' : 'font-normal')}>{task.title}</div>
                              <div className="flex gap-1.5 flex-wrap mt-0.5">
                                {task.assignedUserName && (
                                  <span className="text-[13px] text-subtle-foreground flex items-center gap-[3px]">
                                    👤 {task.assignedUserName}
                                    {task.assignedUserId && !subscribedUserIds.includes(task.assignedUserId) && (
                                      <span title="משתמש לא מנוי להתראות — שקול להתקשר" className="text-white rounded py-0 px-1 text-xs font-bold whitespace-nowrap" style={{ background: C.statusFailed }}>📵 להתקשר</span>
                                    )}
                                  </span>
                                )}
                                {task.assignedTeam?.name && <span className="text-[13px] text-subtle-foreground">👥 {task.assignedTeam.name}</span>}
                                {task.duration && <span className="text-[13px]" style={{ color: C.statusInProgress }}>⏱ {task.duration}</span>}
                                {task.blockedReason && <span className="text-[13px]" style={{ color: C.statusFailed }}>סיבה: {task.blockedReason}</span>}
                              </div>
                            </div>
                            <select
                              value={task.status}
                              disabled={updatingTaskId === task.id}
                              title={blockedPhaseTaskIds.has(task.id) ? 'השלב הקודם טרם הסתיים — פתיחה/התחלה חסומות' : undefined}
                              onChange={e => updateTaskStatus(task.id, e.target.value)}
                              className="py-1 px-2 rounded-md text-sm font-bold cursor-pointer min-w-[90px] border-2"
                              style={{ borderColor: statusDef.color, color: statusDef.color, background: statusDef.color + '22' }}>
                              {TASK_STATUSES.map(s => (
                                <option key={s.value} value={s.value}
                                  disabled={['OPEN', 'IN_PROGRESS'].includes(s.value) && blockedPhaseTaskIds.has(task.id)}
                                  style={{ background: C.bgNested, color: C.textPrimary }}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                            {isManager && ROLLBACK_MAP[task.status] && (
                              <button
                                onClick={() => rollbackTaskStatus(task.id)}
                                disabled={updatingTaskId === task.id}
                                title={`החזר ל-${ROLLBACK_MAP[task.status]}`}
                                className="py-1 px-2 rounded-md text-sm whitespace-nowrap font-bold cursor-pointer border"
                                style={{ borderColor: '#e67e22', background: 'rgba(230,126,34,0.12)', color: '#e67e22' }}>
                                ◀ החזר
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* ── לוח מחוברים ── */}
      {planView === 'connected' && (() => {
        const onlineIds = new Set(onlineUsers.map(u => u.userId));
        const onlineNames = new Set(onlineUsers.map(u => u.fullName));

        // Build deduplicated user map: prefer userId as key; fall back to name.
        // Prevents duplicate cards when the same person has tasks with and without a userId.
        const planUserMap = new Map<string, { key: string; name: string }>();
        const nameToKey = new Map<string, string>(); // normalised name → map key

        allTasks.forEach(t => {
          const userId   = t.assignedUserId;
          const userName = (t.assignedUserName || '').trim();
          const normName = userName.toLowerCase();

          if (userId) {
            if (!planUserMap.has(userId)) {
              planUserMap.set(userId, { key: userId, name: userName || userId });
              if (normName) nameToKey.set(normName, userId);
            }
          } else if (userName) {
            // Only add a name-only entry if no userId entry already covers this person
            if (!nameToKey.has(normName)) {
              planUserMap.set(userName, { key: userName, name: userName });
              nameToKey.set(normName, userName);
            }
          }
        });
        const planUsers = Array.from(planUserMap.values());

        const inPlanOnline  = planUsers.filter(u => onlineIds.has(u.key) || onlineNames.has(u.name));
        const inPlanOffline = planUsers.filter(u => !onlineIds.has(u.key) && !onlineNames.has(u.name));
        const notInPlan     = onlineUsers.filter(u => !planUserMap.has(u.userId) && !planUsers.some(p => p.name === u.fullName));

        const renderUserCard = (
          name: string,
          key: string,
          dot: React.ReactNode,
          cardStyle: React.CSSProperties,
        ) => {
          const normName = name.trim().toLowerCase();
          // Match tasks by userId OR by name (case-insensitive), to unify both data shapes
          const userTasks = allTasks.filter(t =>
            (t.assignedUserId && t.assignedUserId === key) ||
            (!t.assignedUserId && (t.assignedUserName || '').trim().toLowerCase() === normName)
          );
          const uDone       = userTasks.filter(t => t.status === 'DONE').length;
          const uInProgress = userTasks.filter(t => t.status === 'IN_PROGRESS').length;
          const uBlocked    = userTasks.filter(t => t.status === 'BLOCKED').length;
          const uWaiting    = userTasks.filter(t => t.status === 'WAITING').length;
          const uOpen       = userTasks.filter(t => t.status === 'OPEN').length;
          const uTotal      = userTasks.length;
          const uProgress   = uTotal > 0 ? Math.round((uDone / uTotal) * 100) : 0;

          return (
            <div key={key} className="bg-card rounded-xl p-5 border" style={{ borderColor: uBlocked > 0 ? C.statusFailed : C.border, borderWidth: uBlocked > 0 ? '2px' : '1px', ...cardStyle }}>
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                  {dot}
                  <h4 className="m-0 text-foreground text-base">{name}</h4>
                </div>
                {uBlocked > 0 && (
                  <span className="rounded-xl text-sm font-bold py-0.5 px-2" style={{ background: C.bgBlocked, color: C.statusFailed }}>
                    {uBlocked} חסום
                  </span>
                )}
              </div>

              {uTotal === 0 ? (
                <div className="rounded-lg py-2.5 px-3.5 text-subtle-foreground text-[15px] text-center" style={{ background: C.bgNested }}>
                  ללא משימות בגרסה
                </div>
              ) : (
                <>
                  <div className="mb-3">
                    <div className="flex justify-between text-sm text-subtle-foreground mb-1">
                      <span>{uDone}/{uTotal} משימות</span>
                      <span>{uProgress}%</span>
                    </div>
                    <div className="rounded h-2 overflow-hidden" style={{ background: C.bgHover }}>
                      <div className="h-full rounded transition-[width] duration-300" style={{ background: uProgress === 100 ? C.statusDone : C.brand, width: `${uProgress}%` }} />
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {[
                      { label: 'הושלם', value: uDone,       color: C.statusDone },
                      { label: 'בביצוע', value: uInProgress, color: C.statusInProgress },
                      { label: 'פתוח',   value: uOpen,       color: C.statusOpen },
                      { label: 'ממתין',  value: uWaiting,    color: C.statusWaiting },
                      { label: 'חסום',   value: uBlocked,    color: C.statusBlocked },
                    ].filter(s => s.value > 0).map(s => (
                      <span key={s.label} className="rounded-xl text-sm font-bold py-0.5 px-2" style={{ background: s.color + '22', color: s.color }}>
                        {s.value} {s.label}
                      </span>
                    ))}
                  </div>
                  {uInProgress > 0 && (
                    <div className="mt-2.5 pt-2 border-t border-border">
                      {userTasks.filter(t => t.status === 'IN_PROGRESS').map(t => (
                        <div key={t.id} className="text-sm flex items-center gap-1 mb-0.5" style={{ color: C.statusInProgress }}>
                          <span>▶</span> {t.title}
                        </div>
                      ))}
                    </div>
                  )}
                  {uBlocked > 0 && (
                    <div className="mt-1.5">
                      {userTasks.filter(t => t.status === 'BLOCKED').map(t => (
                        <div key={t.id} className="text-sm flex items-start gap-1 mb-0.5" style={{ color: C.statusFailed }}>
                          <span>⛔</span>
                          <span>{t.title}{t.blockedReason ? ` — ${t.blockedReason}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        };

        return (
          <div>
            <div className="flex items-center gap-5 mb-5 flex-wrap">
              <h3 className="m-0 text-foreground text-base">משתתפי התוכנית</h3>
              <div className="flex gap-4 text-[15px] text-subtle-foreground">
                <span><span className="inline-block w-2.5 h-2.5 rounded-full me-1" style={{ background: C.statusDone, boxShadow: `0 0 5px ${C.statusDone}` }} />מחובר ({inPlanOnline.length})</span>
                <span><span className="inline-block w-2.5 h-2.5 rounded-full me-1" style={{ background: C.statusFailed }} />לא מחובר ({inPlanOffline.length})</span>
                {notInPlan.length > 0 && <span><span className="inline-block w-2.5 h-2.5 rounded-full me-1" style={{ background: C.textDisabled }} />מחובר ללא משימות ({notInPlan.length})</span>}
              </div>
            </div>

            {planUsers.length === 0 && onlineUsers.length === 0 ? (
              <div className="text-center py-[60px] text-subtle-foreground bg-card rounded-xl border border-border">
                <div className="text-4xl mb-3">👥</div>
                <div className="text-[17px]">אין משתמשים מחוברים כרגע</div>
              </div>
            ) : (
              <>
                {inPlanOnline.length > 0 && (
                  <div className="mb-6">
                    <div className="text-[15px] font-semibold mb-2.5 flex items-center gap-1.5" style={{ color: C.statusDone }}>
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: C.statusDone }} />
                      מחוברים ובתוכנית
                    </div>
                    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                      {inPlanOnline.map(u => renderUserCard(
                        u.name, u.key,
                        <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ background: C.statusDone, boxShadow: `0 0 6px ${C.statusDone}` }} />,
                        {},
                      ))}
                    </div>
                  </div>
                )}

                {inPlanOffline.length > 0 && (
                  <div className="mb-6">
                    <div className="text-[15px] font-semibold mb-2.5 flex items-center gap-1.5" style={{ color: C.statusFailed }}>
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: C.statusFailed }} />
                      בתוכנית — לא מחובר
                    </div>
                    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                      {inPlanOffline.map(u => renderUserCard(
                        u.name, u.key,
                        <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0 border-2" style={{ background: C.bgHover, borderColor: C.statusFailed }} />,
                        { opacity: 0.85, borderColor: C.statusFailed, borderWidth: '2px' },
                      ))}
                    </div>
                  </div>
                )}

                {notInPlan.length > 0 && (
                  <div>
                    <div className="text-[15px] font-semibold mb-2.5 flex items-center gap-1.5" style={{ color: C.textMuted }}>
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: C.textDisabled }} />
                      מחוברים — לא חלק מהתוכנית
                    </div>
                    <div className="flex flex-wrap gap-2.5">
                      {notInPlan.map(u => (
                        <div key={u.userId} className="bg-muted border border-border rounded-lg py-2 px-3.5 flex items-center gap-2 text-subtle-foreground text-[15px]">
                          <span className="w-2 h-2 rounded-full inline-block" style={{ background: C.textDisabled }} />
                          {u.fullName}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {planView === 'overview' && <>
      {/* כרטיסיות צוותים */}
      <h3 className="text-foreground mb-4 text-base">
        סטטוס צוותים
        {onTeamClick && <span className="text-sm text-subtle-foreground font-normal me-2">— לחץ על שם הצוות לפרטי משימות</span>}
      </h3>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {teams.map(team => {
          const stats = getTeamStats(team.id);
          if (stats.total === 0) return null;
          const teamProgress = Math.round((stats.done / stats.total) * 100);
          const isSelected = selectedTeam === team.id;
          const hasAlert = stats.blocked > 0 || stats.failed > 0;

          return (
            <div key={team.id}
              onClick={() => setSelectedTeam(isSelected ? null : team.id)}
              className="bg-card rounded-xl p-5 cursor-pointer transition-all duration-200 border"
              style={{ borderColor: hasAlert ? C.statusFailed : isSelected ? C.brand : C.border, borderWidth: hasAlert || isSelected ? '2px' : '1px' }}>

              <div className="flex justify-between items-center mb-3">
                <h4
                  className={cn('m-0 text-base', onTeamClick ? 'underline cursor-pointer' : 'no-underline cursor-default')}
                  style={{ color: onTeamClick ? C.brand : C.textPrimary }}
                  onClick={e => {
                    if (onTeamClick) {
                      e.stopPropagation();
                      onTeamClick(team.id, team.name);
                    }
                  }}
                >
                  {team.name}
                </h4>
                <div className="flex gap-1.5 items-center">
                  {stats.failed > 0 && <span className="rounded-xl text-sm font-bold py-0.5 px-2" style={{ background: C.bgFailed, color: C.statusFailed }}>{stats.failed} נכשל</span>}
                  {stats.blocked > 0 && <span className="rounded-xl text-sm font-bold py-0.5 px-2" style={{ background: C.bgBlocked, color: C.statusBlocked }}>{stats.blocked} חסום</span>}
                  <span className="text-[15px] text-subtle-foreground">{isSelected ? '▲' : '▼'}</span>
                </div>
              </div>

              <div className="mb-3">
                <div className="flex justify-between text-sm text-subtle-foreground mb-1">
                  <span>{stats.done}/{stats.total}</span>
                  <span>{teamProgress}%</span>
                </div>
                <div className="rounded h-2 overflow-hidden" style={{ background: C.bgHover }}>
                  <div className="h-full rounded transition-[width] duration-300" style={{ background: teamProgress === 100 ? C.statusDone : C.brand, width: `${teamProgress}%` }} />
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                {[
                  { label: 'הושלם', value: stats.done,       color: C.statusDone },
                  { label: 'בביצוע', value: stats.inProgress, color: C.statusInProgress },
                  { label: 'פתוח',  value: stats.open,        color: C.statusOpen },
                  { label: 'ממתין', value: stats.waiting,     color: C.statusWaiting },
                  { label: 'נכשל',  value: stats.failed,      color: C.statusFailed },
                ].filter(s => s.value > 0).map(s => (
                  <span key={s.label} className="rounded-xl text-sm font-bold py-0.5 px-2" style={{ background: s.color + '22', color: s.color }}>
                    {s.value} {s.label}
                  </span>
                ))}
              </div>

              {team.members && team.members.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-border flex flex-wrap gap-2">
                  {team.members.map((m: any) => {
                    const isOnline = onlineUsers.some(u => u.userId === m.user?.id);
                    return (
                      <div key={m.user?.id} className="flex items-center gap-[5px]">
                        <span className={cn('w-2 h-2 rounded-full inline-block shrink-0', isOnline ? 'border-none' : 'border')} style={{ background: isOnline ? C.statusDone : C.bgHover, borderColor: C.border }} />
                        <span className={cn('text-sm', isOnline ? 'font-semibold' : 'font-normal')} style={{ color: isOnline ? C.textPrimary : C.textMuted }}>
                          {m.user?.fullName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {isSelected && (
                <div className="mt-4 pt-3 border-t border-border">
                  <h5 className="mb-2 mt-0 text-muted-foreground text-[15px]">משימות פעילות:</h5>
                  {allTasks.filter(t => t.assignedTeamId === team.id && t.status !== 'DONE' && t.status !== 'WAITING').length === 0 ? (
                    <div className="text-[15px] text-subtle-foreground">אין משימות פעילות כרגע</div>
                  ) : (
                    allTasks
                      .filter(t => t.assignedTeamId === team.id && t.status !== 'DONE' && t.status !== 'WAITING')
                      .map(task => (
                        <div key={task.id} className="rounded-md py-2 px-3 mb-1.5 flex justify-between items-center border border-border" style={{ background: C.bgNested }}>
                          <div>
                            <div className="text-[15px] font-bold text-foreground">{task.title}</div>
                            {task.assignedUserName && <div className="text-[13px] text-subtle-foreground">👤 {task.assignedUserName}</div>}
                            {task.plannedStart && (
                              <div className="text-[13px]" style={{ color: C.statusInProgress }}>
                                {formatTime(task.plannedStart)}
                                {task.plannedEnd && ` — ${formatTime(task.plannedEnd)}`}
                              </div>
                            )}
                            {task.blockedReason && <div className="text-[13px] mt-0.5" style={{ color: C.statusFailed }}>סיבה: {task.blockedReason}</div>}
                          </div>
                          <span className="text-[13px] py-0.5 px-2 rounded-lg font-bold whitespace-nowrap"
                            style={{ background: statusBg(task.status), color: statusColor(task.status) }}>
                            {task.status === 'IN_PROGRESS' ? 'בביצוע' : task.status === 'BLOCKED' ? 'חסום' : 'פתוח'}
                          </span>
                        </div>
                      ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* משימות חסומות */}
      {blockedTasks > 0 && (
        <div className="bg-card rounded-xl p-5 mt-5 border-2" style={{ borderColor: C.statusFailed }}>
          <h3 className="mb-4 mt-0 text-base" style={{ color: C.statusFailed }}>משימות חסומות — דורשות טיפול!</h3>
          {allTasks.filter(t => t.status === 'BLOCKED').map(task => (
            <div key={task.id} className="rounded-lg p-3 mb-2 flex justify-between items-center border" style={{ background: C.bgBlocked, borderColor: `${C.statusFailed}44` }}>
              <div>
                <div className="font-bold" style={{ color: C.statusFailed }}>{task.title}</div>
                <div className="text-[15px] text-subtle-foreground mt-1">
                  {task.assignedTeam?.name && <span>צוות: {task.assignedTeam.name} | </span>}
                  {task.blockedReason && <span>סיבה: {task.blockedReason}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {(task as any).blockedSeverity && (
                  <span className="rounded-lg text-sm font-bold py-1 px-2.5" style={{ background: severityBg((task as any).blockedSeverity), color: severityColor((task as any).blockedSeverity) }}>
                    {severityLabel((task as any).blockedSeverity)}
                  </span>
                )}
                <span className="text-white rounded-lg text-sm py-1 px-2.5" style={{ background: C.statusFailed }}>חסום</span>
              </div>
            </div>
          ))}
        </div>
      )}
      </>}

      {/* ── מצד הרצה — רשימת משימות ── */}
      {focusMode && (() => {
        const myUserId = payload.sub;
        const myName = (payload.fullName || '').trim().toLowerCase();

        const isMyTask = (t: any) =>
          (t.assignedUserId && t.assignedUserId === myUserId) ||
          (t.assignedUserName && t.assignedUserName.trim().toLowerCase() === myName);

        // For non-managers: scope to own team only; managers see all
        const scopedPhaseTasks = (!isManager && myFocusTeam)
          ? focusAllPhaseTasks.filter((t: any) => t.assignedTeamId === myFocusTeam.id)
          : focusAllPhaseTasks;

        const myActiveTasks = scopedPhaseTasks.filter((t: any) =>
          isMyTask(t) && !TERMINAL.includes(t.status)
        );

        // Tasks eligible for batch open: WAITING + all deps terminal (or no deps)
        const openableWaiting = scopedPhaseTasks.filter((t: any) =>
          t.status === 'WAITING' &&
          !(t.dependencies ?? []).some((d: any) => !TERMINAL.includes(d.dependsOn?.status ?? ''))
        );

        const openAllNoDeps = async () => {
          await Promise.all(
            openableWaiting.map((t: any) =>
              axios.patch(`${API}/tasks/${t.id}/status`, { status: 'OPEN' }, { headers }).catch(() => {})
            )
          );
          await fetchData(true);
        };

        return (
          <FocusModeModal
            phaseLabel={focusActivePhaseName}
            tasks={scopedPhaseTasks}
            spotlightTasks={myActiveTasks}
            canOpenWaiting={isManager}
            updatingTaskId={updatingTaskId}
            onAction={focusAction}
            onBatchOpen={openAllNoDeps}
            openableCount={openableWaiting.length}
            onClose={() => { setFocusMode(false); onGoHome?.(); }}
            isMine={isMyTask}
            nextPhaseInfo={focusNextPhaseInfo}
          />
        );
      })()}

      {/* ── דיאלוג סיבת חסימה ── */}
      {blockingTask && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setBlockingTask(null)}
        >
          <div
            className="rounded-2xl py-7 px-8 min-w-[380px] max-w-[480px] border bg-card"
            style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)', borderColor: C.border }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <span className="text-[22px]">🚨</span>
              <h3 className="m-0 text-[17px]" style={{ color: C.statusFailed }}>סיבת חסימה</h3>
            </div>
            <p className="mb-4 mt-0 text-[15px] text-subtle-foreground">
              משימה: <strong className="text-foreground">{blockingTask.title}</strong>
            </p>
            <textarea
              autoFocus
              value={blockingReason}
              onChange={e => setBlockingReason(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  updateTaskStatus(blockingTask.id, 'BLOCKED', blockingReason.trim(), blockingSeverity);
                  setBlockingTask(null);
                }
              }}
              placeholder="הזן את סיבת החסימה... (חובה)"
              rows={3}
              className="w-full py-2.5 px-3 rounded-lg text-[15px] resize-y outline-none bg-muted text-foreground border"
              style={{ borderColor: C.borderEm }}
            />
            <div className="mt-3.5">
              <div className="text-sm text-subtle-foreground mb-1.5">חומרת החסימה</div>
              <div className="flex gap-1.5">
                {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map(sev => (
                  <button
                    key={sev}
                    onClick={() => setBlockingSeverity(sev)}
                    className="flex-1 py-[7px] px-1 rounded-lg cursor-pointer text-sm font-bold border-[1.5px]"
                    style={{
                      borderColor: blockingSeverity === sev ? severityColor(sev) : C.border,
                      background: blockingSeverity === sev ? severityBg(sev) : C.bgNested,
                      color: blockingSeverity === sev ? severityColor(sev) : C.textSecondary,
                    }}
                  >{severityLabel(sev)}</button>
                ))}
              </div>
            </div>
            <div className="flex gap-2.5 mt-4 justify-end">
              <button
                onClick={() => setBlockingTask(null)}
                className="py-2.5 px-5 rounded-lg bg-muted text-muted-foreground cursor-pointer text-[15px] border" style={{ borderColor: C.border }}
              >ביטול</button>
              <button
                onClick={() => {
                  updateTaskStatus(blockingTask.id, 'BLOCKED', blockingReason.trim(), blockingSeverity);
                  setBlockingTask(null);
                }}
                disabled={!blockingReason.trim()}
                className={cn('py-2.5 px-[22px] rounded-lg border-none font-bold text-[15px]', blockingReason.trim() ? 'cursor-pointer text-white' : 'cursor-not-allowed')}
                style={{ background: blockingReason.trim() ? C.statusFailed : C.bgHover, color: blockingReason.trim() ? 'white' : C.textDisabled }}
              >אשר חסימה</button>
            </div>
          </div>
        </div>
      )}

      {waivingTask && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setWaivingTask(null)}
        >
          <div
            className="rounded-2xl py-7 px-8 min-w-[380px] max-w-[480px] border bg-card"
            style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)', borderColor: C.border }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <span className="text-[22px]">🎭</span>
              <h3 className="m-0 text-[17px]" style={{ color: '#8b5cf6' }}>אישור דילוג GO/NO-GO</h3>
            </div>
            <p className="mb-4 mt-0 text-[15px] text-subtle-foreground">
              משימה: <strong className="text-foreground">{waivingTask.title}</strong><br />
              פעולה זו נרשמת בהיסטוריה — נא נמק מדוע ניתן להמשיך למרות שהמשימה נכשלה.
            </p>
            <textarea
              autoFocus
              value={waivingReason}
              onChange={e => setWaivingReason(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && waivingReason.trim()) {
                  e.preventDefault();
                  waiveTask(waivingTask.id, waivingReason.trim());
                  setWaivingTask(null);
                }
              }}
              placeholder="הזן את הסיבה לדילוג... (חובה)"
              rows={3}
              className="w-full py-2.5 px-3 rounded-lg text-[15px] resize-y outline-none bg-muted text-foreground border"
              style={{ borderColor: C.borderEm }}
            />
            <div className="flex gap-2.5 mt-4 justify-end">
              <button
                onClick={() => setWaivingTask(null)}
                className="py-2.5 px-5 rounded-lg bg-muted text-muted-foreground cursor-pointer text-[15px] border" style={{ borderColor: C.border }}
              >ביטול</button>
              <button
                onClick={() => {
                  waiveTask(waivingTask.id, waivingReason.trim());
                  setWaivingTask(null);
                }}
                disabled={!waivingReason.trim()}
                className={cn('py-2.5 px-[22px] rounded-lg border-none font-bold text-[15px]', waivingReason.trim() ? 'cursor-pointer text-white' : 'cursor-not-allowed')}
                style={{ background: waivingReason.trim() ? '#8b5cf6' : C.bgHover, color: waivingReason.trim() ? 'white' : C.textDisabled }}
              >אשר דילוג</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
