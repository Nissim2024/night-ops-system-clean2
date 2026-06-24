import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { usePermissions } from '../context/PermissionsContext';
import { C, FONT, SHADOW, statusColor, statusBg } from '../theme';

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
  isManager?: boolean;
  isRehearsal?: boolean;
}

const GoNoGoPanel: React.FC<GoNoPanelProps> = ({ env, label, status, details, envTasks, onCheck, failedTasks = [], onWaive, isManager, isRehearsal }) => {
  const canCheck = envTasks.length > 0;
  const unwaived = failedTasks.filter((t: any) => !t.goNoGoWaived);
  const waived = failedTasks.filter((t: any) => t.goNoGoWaived);
  const rehearsalBorder = isRehearsal ? '1px solid rgba(124,58,237,0.40)' : `1px solid ${C.border}`;
  return (
    <div style={{ background: isRehearsal ? 'rgba(109,40,217,0.07)' : C.bgNested, borderRadius: '10px', padding: '16px', border: rehearsalBorder, minWidth: '280px', flex: 1 }}>
      {isRehearsal && (
        <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#6d28d9', background: 'rgba(109,40,217,0.12)', padding: '3px 10px', borderRadius: '20px', display: 'inline-block', marginBottom: '8px', border: '1px solid rgba(109,40,217,0.30)' }}>
          🎭 חזרה גנרלית
        </div>
      )}
      <div style={{ fontWeight: 'bold', color: C.textPrimary, marginBottom: '10px', fontSize: '14px' }}>{label}</div>
      <div style={{ fontSize: '12px', color: C.textMuted, marginBottom: '10px' }}>
        {envTasks.length} משימות · {envTasks.filter((t: any) => t.status === 'DONE').length} הושלמו
      </div>
      <button
        onClick={() => canCheck && onCheck(env)}
        disabled={!canCheck}
        style={{
          padding: '10px 20px', fontWeight: 'bold', fontSize: '14px', border: 'none', borderRadius: '8px',
          cursor: canCheck ? 'pointer' : 'not-allowed', fontFamily: FONT,
          background: !canCheck ? C.bgHover : status === 'go' ? C.statusDone : status === 'nogo' ? C.statusFailed : isRehearsal ? '#7c3aed' : C.brand,
          color: !canCheck ? C.textDisabled : 'white', width: '100%',
        }}
      >
        {status === 'checking' ? 'בודק...' : status === 'go' ? (isRehearsal ? '✅ GO — חזרה!' : '✅ GO!') : status === 'nogo' ? '❌ NO GO' : isRehearsal ? 'בדוק GO/NO GO (חזרה)' : 'בדוק GO/NO GO'}
      </button>
      {status === 'go' && (
        <div style={{ marginTop: '10px', background: C.bgDone, borderRadius: '6px', padding: '8px 12px', color: C.statusDone, fontWeight: 'bold', fontSize: '13px', border: `1px solid ${C.statusDone}44` }}>
          {isRehearsal ? `✅ חזרה הצליחה ב-${label}!` : `כל משימות ${label} הושלמו — ניתן להמשיך!`}
        </div>
      )}
      {status === 'nogo' && details && (
        <div style={{ marginTop: '10px', background: C.bgBlocked, borderRadius: '6px', padding: '8px 12px', color: C.statusFailed, fontSize: '13px', border: `1px solid ${C.statusFailed}44` }}>
          {(details as any).missingByEnv?.length > 0 && (
            <div style={{ marginBottom: '6px' }}>
              {(details as any).missingByEnv.map((line: string, i: number) => (
                <div key={i}>⚠️ {line}</div>
              ))}
            </div>
          )}
          {details.blocked > 0 && <div>{details.blocked} משימות חסומות/נכשלו</div>}
          {details.blockedNoReason?.length > 0 && (
            <div style={{ marginTop: '6px', borderTop: `1px solid ${C.statusFailed}44`, paddingTop: '6px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>⚠️ חסומות ללא סיבה:</div>
              {details.blockedNoReason.map((title: string, i: number) => (
                <div key={i} style={{ fontSize: '12px' }}>• {title}</div>
              ))}
            </div>
          )}
          {(details as any).incompleteTasks?.length > 0 && (
            <div style={{ marginTop: '6px', borderTop: `1px solid ${C.statusFailed}44`, paddingTop: '6px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px', fontSize: '12px' }}>⏳ משימות שטרם הושלמו:</div>
              {(details as any).incompleteTasks.map((t: any, i: number) => (
                <div key={i} style={{ fontSize: '11px', marginBottom: '3px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ background: C.statusFailed + '22', color: C.statusFailed, padding: '1px 5px', borderRadius: '4px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{t.status}</span>
                  <span style={{ flex: 1 }}>{t.title}</span>
                  <span style={{ color: C.textMuted, whiteSpace: 'nowrap' }}>{t.team}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {isManager && failedTasks.length > 0 && (
        <div style={{ marginTop: '12px', borderTop: `1px solid ${C.border}`, paddingTop: '10px' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: C.statusFailed, marginBottom: '6px' }}>
            ⚠️ משימות נכשלות ({failedTasks.length})
          </div>
          {unwaived.map((t: any) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', background: C.bgBlocked, borderRadius: '6px', padding: '4px 8px' }}>
              <span style={{ flex: 1, fontSize: '12px', color: C.statusFailed }}>{t.title}</span>
              <button onClick={() => onWaive?.(t.id)}
                style={{ padding: '2px 8px', fontSize: '11px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                ✓ אשר דילוג
              </button>
            </div>
          ))}
          {waived.length > 0 && (
            <div style={{ marginTop: '4px' }}>
              <div style={{ fontSize: '11px', color: C.textMuted, marginBottom: '3px' }}>מאושרים לדילוג:</div>
              {waived.map((t: any) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', background: C.bgDone, borderRadius: '6px', padding: '3px 8px' }}>
                  <span style={{ flex: 1, fontSize: '12px', color: C.statusDone }}>✓ {t.title}</span>
                  <button onClick={() => onWaive?.(t.id)}
                    style={{ padding: '2px 6px', fontSize: '10px', background: C.bgHover, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    בטל
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const WarRoom: React.FC<Props> = ({ token, versionId, versionName, isRehearsal = false, hideGoNogo = false, onTeamClick, onlineUsers = [], onVersionEnded, refreshSignal, onGoToHub }) => {
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
  const [focusMode, setFocusMode] = useState(false);
  const [focusBlockTaskId, setFocusBlockTaskId] = useState<string | null>(null);
  const [focusBlockReason, setFocusBlockReason] = useState('');
  const [focusNearOnly, setFocusNearOnly] = useState(true);
  const NEAR_MINUTES = 15;

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

  const { focusTasks, focusAllPhaseTasks, focusActivePhaseName } = useMemo(() => {
    if (!allTasks.length) return { focusTasks: [], focusAllPhaseTasks: [], focusActivePhaseName: '' };

    const phaseMap: Record<number, any[]> = {};
    for (const t of allTasks) {
      const key: number = t._phaseOrderIndex ?? 0;
      if (!phaseMap[key]) phaseMap[key] = [];
      phaseMap[key].push(t);
    }

    const sortedKeys = Object.keys(phaseMap).map(Number).sort((a, b) => a - b);
    const activeKey = sortedKeys.find(k => phaseMap[k].some((t: any) => !TERMINAL.includes(t.status)));

    if (activeKey === undefined) return { focusTasks: [], focusAllPhaseTasks: [], focusActivePhaseName: '' };

    const sorted = [...(phaseMap[activeKey] as any[])].sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    // Non-terminal tasks for the button badge count
    const active = sorted.filter((t: any) => !TERMINAL.includes(t.status));
    const phaseName = sorted[0]?._phaseName ?? '';
    return { focusTasks: active, focusAllPhaseTasks: sorted, focusActivePhaseName: phaseName };
  }, [allTasks]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusAction = async (taskId: string, status: string, reason?: string) => {
    setUpdatingTaskId(taskId);
    try {
      await axios.patch(`${API}/tasks/${taskId}/status`,
        { status, ...(reason !== undefined && { blockedReason: reason }) },
        { headers });
      await fetchData(true);
      if (focusBlockTaskId === taskId) {
        setFocusBlockTaskId(null);
        setFocusBlockReason('');
      }
    } catch (err) { console.error(err); }
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

  const waiveTask = async (taskId: string) => {
    try {
      await axios.patch(`${API}/tasks/${taskId}/waive-gonogo`, {}, { headers });
      await fetchData(true);
    } catch (err) { console.error(err); }
  };

  const getGoRequiredTasks = (env: string) => {
    const phases = [...(version?.phases ?? [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
    const targetOrderIndex = phases.find((p: any) => p.environment === env)?.orderIndex ?? 999;
    return phases
      .filter((p: any) => p.orderIndex <= targetOrderIndex)
      .flatMap((p: any) => (p.subPhases ?? []).flatMap((sp: any) => sp.tasks ?? []));
  };

  const updateTaskStatus = async (taskId: string, status: string, blockedReason?: string) => {
    if (status === 'BLOCKED' && blockedReason === undefined) {
      const task = allTasks.find(t => t.id === taskId);
      setBlockingTask({ id: taskId, title: task?.title || taskId });
      setBlockingReason('');
      return;
    }
    setUpdatingTaskId(taskId);
    try {
      await axios.patch(`${API}/tasks/${taskId}/status`, { status, ...(blockedReason !== undefined && { blockedReason }) }, { headers });
      await fetchData();
    } catch (err) { console.error(err); }
    finally { setUpdatingTaskId(null); }
  };

  const ENV_COLORS: Record<string, { bg: string; color: string }> = {
    HOT:    { bg: 'rgba(248,81,73,0.12)',  color: C.statusBlocked },
    HOTNET: { bg: 'rgba(45,125,210,0.12)', color: C.statusOpen },
    BOTH:   { bg: C.bgHover,               color: C.textMuted },
  };

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, fontFamily: FONT }}>
      טוען War Room...
    </div>
  );

  return (
    <div style={{ direction: 'rtl', fontFamily: FONT }}>

      {/* באנר חזרה גנרלית */}
      {isRehearsal && (
        <div style={{ background: 'linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)', borderRadius: '10px', padding: '12px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', color: 'white' }}>
          <span style={{ fontSize: '28px' }}>🎭</span>
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '16px' }}>מצב חזרה גנרלית</div>
            <div style={{ fontSize: '13px', opacity: 0.9 }}>סימולציה של לילה אמיתי — בסיום ניתן להוציא סיכום ולאפס את הגרסה ל"מאושר"</div>
          </div>
        </div>
      )}

      {/* כותרת */}
      <div style={{
        background: isRehearsal
          ? 'linear-gradient(135deg, #3b0764 0%, #6d28d9 100%)'
          : C.bgCard,
        borderRadius: '12px', padding: '24px', marginBottom: '20px',
        border: isRehearsal ? `1px solid rgba(124,58,237,0.50)` : `1px solid ${C.border}`,
        boxShadow: SHADOW.sm,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '22px', color: isRehearsal ? 'white' : C.textPrimary }}>
              {isRehearsal ? '🎭 ' : ''}War Room —{' '}
              <span
                onClick={onGoToHub}
                title={onGoToHub ? 'עבור לדף הנחיתה' : undefined}
                style={{ cursor: onGoToHub ? 'pointer' : 'default', textDecoration: onGoToHub ? 'underline dotted' : 'none' }}
              >{versionName}</span>
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: isRehearsal ? 'rgba(255,255,255,0.75)' : C.textMuted }}>
              {isRehearsal ? 'חזרה גנרלית — בזמן אמת' : 'מבט-על בזמן אמת'}
            </p>
            {version?.reviewMeetingTime && (
              <p style={{ margin: '4px 0 0', color: isRehearsal ? 'rgba(255,255,255,0.90)' : C.info, fontSize: '13px', fontWeight: '600' }}>
                🗓 ישיבת מעבר: {new Date(version.reviewMeetingTime).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
                style={{
                  padding: '7px 14px', borderRadius: '8px', cursor: pushToggling ? 'not-allowed' : 'pointer',
                  fontSize: '13px', fontWeight: 'bold', border: 'none', fontFamily: FONT,
                  background: pushEnabled ? C.successBg : C.dangerBg,
                  color: pushEnabled ? C.statusDone : C.statusFailed,
                }}>
                {pushEnabled ? '🔔 Push פעיל' : '🔕 Push כבוי'}
              </button>
            )}
            {version?.phases?.length > 0 && (
              <button onClick={() => { setFocusMode(true); setFocusBlockTaskId(null); setFocusBlockReason(''); }} style={{
                padding: '7px 16px', background: C.brand, color: 'white',
                border: 'none', borderRadius: '8px', cursor: 'pointer',
                fontSize: '13px', fontFamily: FONT, fontWeight: 'bold',
              }}>
                ⚡ מצב הרצה{focusTasks.length > 0 ? ` (${focusTasks.length})` : ''}
              </button>
            )}
            <button onClick={() => fetchData()} style={{
              padding: '7px 16px', background: C.bgNested, color: C.textSecondary,
              border: `1px solid ${C.borderEm}`, borderRadius: '8px', cursor: 'pointer',
              fontSize: '13px', fontFamily: FONT,
            }}>
              רענן
            </button>
          </div>
        </div>

        {/* בר התקדמות מפולח לפי שלבים */}
        {(() => {
          const phases = [...(version?.phases ?? [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
          if (phases.length === 0 || totalTasks === 0) return (
            <div style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px', color: isRehearsal ? 'rgba(255,255,255,0.80)' : C.textSecondary }}>
                <span>התקדמות כללית</span>
                <span>{doneTasks}/{totalTasks} משימות ({progressPercent}%)</span>
              </div>
              <div style={{ background: isRehearsal ? 'rgba(0,0,0,0.20)' : C.bgHover, borderRadius: '8px', height: '10px', overflow: 'hidden' }}>
                <div style={{ background: progressPercent === 100 ? C.statusDone : C.brand, width: `${progressPercent}%`, height: '100%', borderRadius: '8px', transition: 'width 0.5s ease' }} />
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
            <div style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px', color: isRehearsal ? 'rgba(255,255,255,0.80)' : C.textSecondary }}>
                <span>התקדמות כללית</span>
                <span>{doneTasks}/{totalTasks} משימות ({progressPercent}%)</span>
              </div>
              {/* Segmented bar */}
              <div style={{ display: 'flex', gap: '2px', height: '12px', borderRadius: '8px', overflow: 'hidden', background: isRehearsal ? 'rgba(0,0,0,0.20)' : C.bgHover }}>
                {phaseStats.map((p: any, i: number) => {
                  const segWidth = totalAll > 0 ? (p.total / totalAll) * 100 : 0;
                  const fillColor = p.isDone ? C.statusDone : p.isActive ? C.statusInProgress : C.brand;
                  const fillPct = p.pct * 100;
                  return (
                    <div key={p.id} title={`${p.name}: ${p.done}/${p.total}`} style={{ flex: `${segWidth} 0 0%`, position: 'relative', background: isRehearsal ? 'rgba(255,255,255,0.08)' : C.bgHover, borderLeft: i > 0 ? `2px solid ${isRehearsal ? 'rgba(0,0,0,0.3)' : C.bgApp}` : 'none', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${fillPct}%`, background: fillColor, transition: 'width 0.5s ease' }} />
                    </div>
                  );
                })}
              </div>
              {/* Phase labels */}
              <div style={{ display: 'flex', gap: '2px', marginTop: '5px' }}>
                {phaseStats.map((p: any) => {
                  const segWidth = totalAll > 0 ? (p.total / totalAll) * 100 : 0;
                  const labelColor = p.isDone ? C.statusDone : p.isActive ? C.statusInProgress : isRehearsal ? 'rgba(255,255,255,0.45)' : C.textDisabled;
                  return (
                    <div key={p.id} title={`${p.name}: ${p.done}/${p.total}`} style={{ flex: `${segWidth} 0 0%`, overflow: 'hidden', textAlign: 'center' }}>
                      <span style={{ fontSize: '10px', color: labelColor, whiteSpace: 'nowrap', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.isActive ? '▶ ' : p.isDone ? '✓ ' : ''}{p.name} {p.done}/{p.total}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
          {[
            { label: 'הושלמו', value: doneTasks,                                              color: C.statusDone },
            { label: 'בביצוע', value: inProgressTasks,                                        color: C.statusInProgress },
            { label: 'פתוחות', value: allTasks.filter(t => t.status === 'OPEN').length,       color: C.statusOpen },
            { label: 'ממתינות', value: allTasks.filter(t => t.status === 'WAITING').length,   color: C.statusWaiting },
            { label: 'חסומות', value: blockedTasks,                                            color: C.statusBlocked },
            { label: 'סה"כ',  value: totalTasks,                                              color: isRehearsal ? 'white' : C.textPrimary },
          ].map(stat => (
            <div key={stat.label} style={{
              background: isRehearsal ? 'rgba(0,0,0,0.20)' : C.bgNested,
              borderRadius: '8px', padding: '10px 14px', textAlign: 'center', minWidth: '70px',
              border: `1px solid ${isRehearsal ? 'rgba(255,255,255,0.12)' : C.border}`,
            }}>
              <div style={{ fontSize: '22px', fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
              <div style={{ fontSize: '11px', color: isRehearsal ? 'rgba(255,255,255,0.65)' : C.textMuted }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* GO/NO GO — מפוצל לפי סביבה */}
      {(can('action:gonogo') || isManager) && !hideGoNogo && (
        <div style={{ background: isRehearsal ? 'rgba(109,40,217,0.06)' : C.bgCard, borderRadius: '12px', padding: '20px', marginBottom: '20px', border: isRehearsal ? '1px solid rgba(124,58,237,0.28)' : `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, color: isRehearsal ? '#6d28d9' : C.textPrimary, fontSize: '15px' }}>GO / NO GO — {isRehearsal ? 'חזרה גנרלית' : 'לפי סביבה'}</h3>
            {isRehearsal && <span style={{ fontSize: '12px', color: '#6d28d9', background: 'rgba(109,40,217,0.10)', padding: '2px 10px', borderRadius: '20px', border: '1px solid rgba(109,40,217,0.25)' }}>אינו מחליף GO/NO GO אמיתי</span>}
          </div>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <GoNoGoPanel env="HOTNET" label="פעילות לילה — HOTNET" status={goStatus['HOTNET']} details={goDetails['HOTNET']} envTasks={getEnvTasks('HOTNET')} onCheck={checkGoForEnv}
              failedTasks={getGoRequiredTasks('HOTNET').filter(t => t.status === 'FAILED')} onWaive={waiveTask} isManager={isManager} isRehearsal={isRehearsal} />
            <GoNoGoPanel env="HOT" label="פעילות לילה — HOT" status={goStatus['HOT']} details={goDetails['HOT']} envTasks={getEnvTasks('HOT')} onCheck={checkGoForEnv}
              failedTasks={getGoRequiredTasks('HOT').filter(t => t.status === 'FAILED')} onWaive={waiveTask} isManager={isManager} isRehearsal={isRehearsal} />
          </div>
        </div>
      )}

      {/* בחירת תצוגה */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {[
          { key: 'overview',   label: '👥 סקירת צוותים' },
          { key: 'connected',  label: `🟢 מחוברים (${onlineUsers.length})` },
          { key: 'plan',       label: '📋 תוכנית ביצוע' },
        ].map(tab => (
          <button key={tab.key} onClick={() => setPlanView(tab.key as any)}
            style={{
              padding: '10px 20px', fontWeight: 'bold', fontSize: '14px', borderRadius: '8px', cursor: 'pointer',
              fontFamily: FONT,
              border: planView === tab.key ? `1px solid ${C.brand}` : `1px solid ${C.border}`,
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, color: C.textPrimary, fontSize: '15px' }}>תוכנית ביצוע</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setCollapsedPhases(new Set(version?.phases?.map((p: any) => p.id) ?? []))}
                style={{ padding: '6px 14px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: C.textSecondary, fontFamily: FONT }}>
                ▶ קפל הכל
              </button>
              <button
                onClick={() => setCollapsedPhases(new Set())}
                style={{ padding: '6px 14px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: C.textSecondary, fontFamily: FONT }}>
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
              <div key={phase.id} style={{ background: C.bgCard, borderRadius: '12px', padding: '16px 20px', marginBottom: '12px', border: `1px solid ${C.border}` }}>
                <div onClick={() => setCollapsedPhases(prev => { const n = new Set(prev); n.has(phase.id) ? n.delete(phase.id) : n.add(phase.id); return n; })}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: isCollapsed ? 0 : '12px' }}>
                  <span style={{ fontSize: '12px', color: C.textMuted }}>{isCollapsed ? '►' : '▼'}</span>
                  <span style={{ background: envStyle.bg, color: envStyle.color, padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>{phase.environment}</span>
                  <span style={{ fontWeight: 'bold', color: C.textPrimary, fontSize: '15px' }}>{phase.name}</span>
                  <span style={{ fontSize: '12px', color: phaseDone === phaseTasks.length && phaseTasks.length > 0 ? C.statusDone : C.textMuted, fontWeight: 'bold' }}>
                    {phaseDone}/{phaseTasks.length} ✓
                  </span>
                </div>
                {!isCollapsed && phase.subPhases?.map((sub: any) => {
                  const subDone = (sub.tasks ?? []).filter((t: any) => t.status === 'DONE').length;
                  return (
                    <div key={sub.id} style={{ marginBottom: '10px', paddingRight: '16px', borderRight: `3px solid ${C.borderEm}` }}>
                      <div style={{ fontWeight: 'bold', color: C.textSecondary, fontSize: '13px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {sub.name}
                        <span style={{ fontSize: '11px', color: C.textMuted, fontWeight: 'normal' }}>{subDone}/{sub.tasks?.length ?? 0}</span>
                      </div>
                      {(sub.tasks ?? []).map((task: any) => {
                        const statusDef = TASK_STATUSES.find(s => s.value === task.status) ?? TASK_STATUSES[0];
                        const isBlocked = task.status === 'BLOCKED' || task.status === 'FAILED';
                        return (
                          <div key={task.id} style={{
                            background: isBlocked ? C.bgBlocked : C.bgNested,
                            borderRadius: '8px', padding: '8px 12px', marginBottom: '4px',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px',
                            borderRight: `3px solid ${statusDef.color}`,
                            border: `1px solid ${isBlocked ? C.statusFailed + '44' : C.border}`,
                            borderRightWidth: '3px',
                          }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: task.status === 'IN_PROGRESS' ? 'bold' : 'normal', color: C.textPrimary, fontSize: '13px' }}>{task.title}</div>
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
                                {task.assignedUserName && (
                                  <span style={{ fontSize: '11px', color: C.textMuted, display: 'flex', alignItems: 'center', gap: '3px' }}>
                                    👤 {task.assignedUserName}
                                    {task.assignedUserId && !subscribedUserIds.includes(task.assignedUserId) && (
                                      <span title="משתמש לא מנוי להתראות — שקול להתקשר" style={{
                                        background: C.statusFailed, color: 'white', borderRadius: '4px',
                                        padding: '0 4px', fontSize: '10px', fontWeight: 'bold', whiteSpace: 'nowrap',
                                      }}>📵 להתקשר</span>
                                    )}
                                  </span>
                                )}
                                {task.assignedTeam?.name && <span style={{ fontSize: '11px', color: C.textMuted }}>👥 {task.assignedTeam.name}</span>}
                                {task.duration && <span style={{ fontSize: '11px', color: C.statusInProgress }}>⏱ {task.duration}</span>}
                                {task.blockedReason && <span style={{ fontSize: '11px', color: C.statusFailed }}>סיבה: {task.blockedReason}</span>}
                              </div>
                            </div>
                            <select
                              value={task.status}
                              disabled={updatingTaskId === task.id}
                              onChange={e => updateTaskStatus(task.id, e.target.value)}
                              style={{
                                padding: '4px 8px', borderRadius: '6px', border: `2px solid ${statusDef.color}`,
                                fontSize: '12px', fontWeight: 'bold', color: statusDef.color,
                                background: statusDef.color + '22', cursor: 'pointer', minWidth: '90px',
                                fontFamily: FONT,
                              }}>
                              {TASK_STATUSES.map(s => <option key={s.value} value={s.value} style={{ background: C.bgNested, color: C.textPrimary }}>{s.label}</option>)}
                            </select>
                            {isManager && ROLLBACK_MAP[task.status] && (
                              <button
                                onClick={() => rollbackTaskStatus(task.id)}
                                disabled={updatingTaskId === task.id}
                                title={`החזר ל-${ROLLBACK_MAP[task.status]}`}
                                style={{ padding: '4px 8px', borderRadius: '6px', border: `1px solid #e67e22`, background: 'rgba(230,126,34,0.12)', color: '#e67e22', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap', fontWeight: 'bold', fontFamily: FONT }}>
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
            <div key={key} style={{
              background: C.bgCard, borderRadius: '12px', padding: '20px',
              border: uBlocked > 0 ? `2px solid ${C.statusFailed}` : `1px solid ${C.border}`,
              ...cardStyle,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {dot}
                  <h4 style={{ margin: 0, color: C.textPrimary, fontSize: '15px' }}>{name}</h4>
                </div>
                {uBlocked > 0 && (
                  <span style={{ background: C.bgBlocked, color: C.statusFailed, padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>
                    {uBlocked} חסום
                  </span>
                )}
              </div>

              {uTotal === 0 ? (
                <div style={{ background: C.bgNested, borderRadius: '8px', padding: '10px 14px', color: C.textMuted, fontSize: '13px', textAlign: 'center' }}>
                  ללא משימות בגרסה
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: C.textMuted, marginBottom: '4px' }}>
                      <span>{uDone}/{uTotal} משימות</span>
                      <span>{uProgress}%</span>
                    </div>
                    <div style={{ background: C.bgHover, borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                      <div style={{ background: uProgress === 100 ? C.statusDone : C.brand, width: `${uProgress}%`, height: '100%', borderRadius: '4px', transition: 'width 0.3s' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {[
                      { label: 'הושלם', value: uDone,       color: C.statusDone },
                      { label: 'בביצוע', value: uInProgress, color: C.statusInProgress },
                      { label: 'פתוח',   value: uOpen,       color: C.statusOpen },
                      { label: 'ממתין',  value: uWaiting,    color: C.statusWaiting },
                      { label: 'חסום',   value: uBlocked,    color: C.statusBlocked },
                    ].filter(s => s.value > 0).map(s => (
                      <span key={s.label} style={{ background: s.color + '22', color: s.color, padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>
                        {s.value} {s.label}
                      </span>
                    ))}
                  </div>
                  {uInProgress > 0 && (
                    <div style={{ marginTop: '10px', borderTop: `1px solid ${C.border}`, paddingTop: '8px' }}>
                      {userTasks.filter(t => t.status === 'IN_PROGRESS').map(t => (
                        <div key={t.id} style={{ fontSize: '12px', color: C.statusInProgress, display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                          <span>▶</span> {t.title}
                        </div>
                      ))}
                    </div>
                  )}
                  {uBlocked > 0 && (
                    <div style={{ marginTop: '6px' }}>
                      {userTasks.filter(t => t.status === 'BLOCKED').map(t => (
                        <div key={t.id} style={{ fontSize: '12px', color: C.statusFailed, display: 'flex', alignItems: 'flex-start', gap: '4px', marginBottom: '2px' }}>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '20px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, color: C.textPrimary, fontSize: '15px' }}>משתתפי התוכנית</h3>
              <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: C.textMuted }}>
                <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: C.statusDone, marginLeft: '4px', boxShadow: `0 0 5px ${C.statusDone}` }} />מחובר ({inPlanOnline.length})</span>
                <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: C.statusFailed, marginLeft: '4px' }} />לא מחובר ({inPlanOffline.length})</span>
                {notInPlan.length > 0 && <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: C.textDisabled, marginLeft: '4px' }} />מחובר ללא משימות ({notInPlan.length})</span>}
              </div>
            </div>

            {planUsers.length === 0 && onlineUsers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, background: C.bgCard, borderRadius: '12px', border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>👥</div>
                <div style={{ fontSize: '16px' }}>אין משתמשים מחוברים כרגע</div>
              </div>
            ) : (
              <>
                {inPlanOnline.length > 0 && (
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: C.statusDone, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: C.statusDone, display: 'inline-block' }} />
                      מחוברים ובתוכנית
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                      {inPlanOnline.map(u => renderUserCard(
                        u.name, u.key,
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: C.statusDone, display: 'inline-block', flexShrink: 0, boxShadow: `0 0 6px ${C.statusDone}` }} />,
                        {},
                      ))}
                    </div>
                  </div>
                )}

                {inPlanOffline.length > 0 && (
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: C.statusFailed, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: C.statusFailed, display: 'inline-block' }} />
                      בתוכנית — לא מחובר
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                      {inPlanOffline.map(u => renderUserCard(
                        u.name, u.key,
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: C.bgHover, border: `2px solid ${C.statusFailed}`, display: 'inline-block', flexShrink: 0 }} />,
                        { opacity: 0.85, borderColor: C.statusFailed, borderWidth: '2px' },
                      ))}
                    </div>
                  </div>
                )}

                {notInPlan.length > 0 && (
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: C.textMuted, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: C.textDisabled, display: 'inline-block' }} />
                      מחוברים — לא חלק מהתוכנית
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                      {notInPlan.map(u => (
                        <div key={u.userId} style={{ background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '8px', color: C.textMuted, fontSize: '13px' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: C.textDisabled, display: 'inline-block' }} />
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
      <h3 style={{ color: C.textPrimary, marginBottom: '16px', fontSize: '15px' }}>
        סטטוס צוותים
        {onTeamClick && <span style={{ fontSize: '12px', color: C.textMuted, fontWeight: 'normal', marginRight: '8px' }}>— לחץ על שם הצוות לפרטי משימות</span>}
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
        {teams.map(team => {
          const stats = getTeamStats(team.id);
          if (stats.total === 0) return null;
          const teamProgress = Math.round((stats.done / stats.total) * 100);
          const isSelected = selectedTeam === team.id;
          const hasAlert = stats.blocked > 0 || stats.failed > 0;

          return (
            <div key={team.id}
              onClick={() => setSelectedTeam(isSelected ? null : team.id)}
              style={{
                background: C.bgCard, borderRadius: '12px', padding: '20px',
                border: hasAlert ? `2px solid ${C.statusFailed}` : isSelected ? `2px solid ${C.brand}` : `1px solid ${C.border}`,
                cursor: 'pointer', transition: 'all 0.2s',
              }}>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4
                  style={{ margin: 0, color: onTeamClick ? C.brand : C.textPrimary, textDecoration: onTeamClick ? 'underline' : 'none', cursor: onTeamClick ? 'pointer' : 'default', fontSize: '15px' }}
                  onClick={e => {
                    if (onTeamClick) {
                      e.stopPropagation();
                      onTeamClick(team.id, team.name);
                    }
                  }}
                >
                  {team.name}
                </h4>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {stats.failed > 0 && <span style={{ background: C.bgFailed, color: C.statusFailed, padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>{stats.failed} נכשל</span>}
                  {stats.blocked > 0 && <span style={{ background: C.bgBlocked, color: C.statusBlocked, padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>{stats.blocked} חסום</span>}
                  <span style={{ fontSize: '14px', color: C.textMuted }}>{isSelected ? '▲' : '▼'}</span>
                </div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: C.textMuted, marginBottom: '4px' }}>
                  <span>{stats.done}/{stats.total}</span>
                  <span>{teamProgress}%</span>
                </div>
                <div style={{ background: C.bgHover, borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                  <div style={{ background: teamProgress === 100 ? C.statusDone : C.brand, width: `${teamProgress}%`, height: '100%', borderRadius: '4px', transition: 'width 0.3s' }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  { label: 'הושלם', value: stats.done,       color: C.statusDone },
                  { label: 'בביצוע', value: stats.inProgress, color: C.statusInProgress },
                  { label: 'פתוח',  value: stats.open,        color: C.statusOpen },
                  { label: 'ממתין', value: stats.waiting,     color: C.statusWaiting },
                  { label: 'נכשל',  value: stats.failed,      color: C.statusFailed },
                ].filter(s => s.value > 0).map(s => (
                  <span key={s.label} style={{ background: s.color + '22', color: s.color, padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>
                    {s.value} {s.label}
                  </span>
                ))}
              </div>

              {team.members && team.members.length > 0 && (
                <div style={{ marginTop: '12px', borderTop: `1px solid ${C.border}`, paddingTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {team.members.map((m: any) => {
                    const isOnline = onlineUsers.some(u => u.userId === m.user?.id);
                    return (
                      <div key={m.user?.id} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isOnline ? C.statusDone : C.bgHover, border: isOnline ? 'none' : `1px solid ${C.border}`, display: 'inline-block', flexShrink: 0 }} />
                        <span style={{ fontSize: '12px', color: isOnline ? C.textPrimary : C.textMuted, fontWeight: isOnline ? '600' : 'normal' }}>
                          {m.user?.fullName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {isSelected && (
                <div style={{ marginTop: '16px', borderTop: `1px solid ${C.border}`, paddingTop: '12px' }}>
                  <h5 style={{ margin: '0 0 8px', color: C.textSecondary, fontSize: '13px' }}>משימות פעילות:</h5>
                  {allTasks.filter(t => t.assignedTeamId === team.id && t.status !== 'DONE' && t.status !== 'WAITING').length === 0 ? (
                    <div style={{ fontSize: '13px', color: C.textMuted }}>אין משימות פעילות כרגע</div>
                  ) : (
                    allTasks
                      .filter(t => t.assignedTeamId === team.id && t.status !== 'DONE' && t.status !== 'WAITING')
                      .map(task => (
                        <div key={task.id} style={{ background: C.bgNested, borderRadius: '6px', padding: '8px 12px', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `1px solid ${C.border}` }}>
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 'bold', color: C.textPrimary }}>{task.title}</div>
                            {task.assignedUserName && <div style={{ fontSize: '11px', color: C.textMuted }}>👤 {task.assignedUserName}</div>}
                            {task.plannedStart && (
                              <div style={{ fontSize: '11px', color: C.statusInProgress }}>
                                {new Date(task.plannedStart).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                                {task.plannedEnd && ` — ${new Date(task.plannedEnd).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`}
                              </div>
                            )}
                            {task.blockedReason && <div style={{ fontSize: '11px', color: C.statusFailed, marginTop: '2px' }}>סיבה: {task.blockedReason}</div>}
                          </div>
                          <span style={{
                            fontSize: '11px', padding: '2px 8px', borderRadius: '8px', fontWeight: 'bold', whiteSpace: 'nowrap',
                            background: statusBg(task.status),
                            color: statusColor(task.status),
                          }}>
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
        <div style={{ background: C.bgCard, borderRadius: '12px', padding: '20px', marginTop: '20px', border: `2px solid ${C.statusFailed}` }}>
          <h3 style={{ margin: '0 0 16px', color: C.statusFailed, fontSize: '15px' }}>משימות חסומות — דורשות טיפול!</h3>
          {allTasks.filter(t => t.status === 'BLOCKED').map(task => (
            <div key={task.id} style={{ background: C.bgBlocked, borderRadius: '8px', padding: '12px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `1px solid ${C.statusFailed}44` }}>
              <div>
                <div style={{ fontWeight: 'bold', color: C.statusFailed }}>{task.title}</div>
                <div style={{ fontSize: '13px', color: C.textMuted, marginTop: '4px' }}>
                  {task.assignedTeam?.name && <span>צוות: {task.assignedTeam.name} | </span>}
                  {task.blockedReason && <span>סיבה: {task.blockedReason}</span>}
                </div>
              </div>
              <span style={{ background: C.statusFailed, color: 'white', padding: '4px 10px', borderRadius: '8px', fontSize: '12px' }}>חסום</span>
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

        const phaseDone = scopedPhaseTasks.filter((t: any) => TERMINAL.includes(t.status)).length;
        const phaseTotal = scopedPhaseTasks.length;
        const phasePct = phaseTotal > 0 ? Math.round((phaseDone / phaseTotal) * 100) : 0;

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

        // Group tasks by sub-phase for list display
        const subPhaseGroups: { subName: string; tasks: any[] }[] = [];
        for (const t of scopedPhaseTasks) {
          const name = t._subPhaseName || t._phaseName || '';
          let grp = subPhaseGroups.find(g => g.subName === name);
          if (!grp) { grp = { subName: name, tasks: [] }; subPhaseGroups.push(grp); }
          grp.tasks.push(t);
        }

        const TaskRow = ({ task }: { task: any }) => {
          const isUpdating = updatingTaskId === task.id;
          const isMine = isMyTask(task);
          const isBlocking = focusBlockTaskId === task.id;
          const isDone = TERMINAL.includes(task.status);
          const isIP = task.status === 'IN_PROGRESS';
          const isOpen = task.status === 'OPEN';
          const isWait = task.status === 'WAITING';
          const isBlocked = task.status === 'BLOCKED';
          const hasBlockingDeps = (task.dependencies ?? []).some(
            (d: any) => !TERMINAL.includes(d.dependsOn?.status ?? '')
          );
          const sColor = statusColor(task.status);
          const btnBase: React.CSSProperties = {
            fontFamily: FONT, fontSize: '12px', fontWeight: 'bold',
            padding: '5px 10px', border: 'none', borderRadius: '6px',
            cursor: isUpdating ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap', opacity: isUpdating ? 0.6 : 1,
            width: '100%', textAlign: 'center',
          };

          return (
            <div key={task.id} style={{
              borderRight: `3px solid ${sColor}`,
              borderBottom: `1px solid rgba(255,255,255,0.06)`,
              background: isDone ? 'rgba(255,255,255,0.02)' :
                isMine ? (isIP ? 'rgba(56,139,253,0.12)' : isOpen ? 'rgba(227,179,65,0.10)' : 'rgba(240,106,106,0.07)') :
                (isIP ? 'rgba(56,139,253,0.06)' : isBlocked ? 'rgba(240,106,106,0.08)' : '#172030'),
              opacity: isDone ? 0.45 : 1,
            }}>
              {/* Main row */}
              <div style={{ display: 'flex', alignItems: 'center', minHeight: '44px', gap: '0' }}>

                {/* Col: Title (flex, right in RTL) */}
                <div style={{ flex: 1, minWidth: 0, padding: '6px 10px 6px 4px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    {isMine && !isDone && <span style={{ color: C.brand, fontSize: '11px' }}>★</span>}
                    <span style={{ fontSize: '13px', fontWeight: isMine && !isDone ? 'bold' : 'normal', color: isDone ? C.textDisabled : 'white' }}>
                      {task.title}
                    </span>
                    {task.crNumber && <span style={{ fontSize: '10px', color: C.info, background: C.infoBg ?? 'rgba(56,139,253,0.15)', padding: '1px 5px', borderRadius: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>{task.crNumber}</span>}
                  </div>
                  {/* Sub-info row */}
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
                  {/* Dependencies row — shown for any task that has deps */}
                  {(task.dependencies ?? []).length > 0 && (
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', marginTop: '3px' }}>
                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.30)', flexShrink: 0 }}>תלוי ב:</span>
                      {(task.dependencies ?? []).map((d: any) => {
                        const depStatus = d.dependsOn?.status ?? '';
                        const done = TERMINAL.includes(depStatus);
                        const dc = done ? C.statusDone : statusColor(depStatus);
                        return (
                          <span key={d.id} style={{
                            fontSize: '10px', color: dc, background: dc + '22',
                            padding: '1px 6px', borderRadius: '4px',
                            maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            display: 'inline-block', flexShrink: 0,
                          }}>
                            {done ? '✓' : '○'} {d.dependsOn?.title ?? '?'}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Col: Status chip */}
                <div style={{ width: '64px', flexShrink: 0, padding: '0 4px', textAlign: 'center' }}>
                  <span style={{ fontSize: '10px', color: sColor, background: sColor + '22', padding: '2px 6px', borderRadius: '8px', whiteSpace: 'nowrap', display: 'inline-block' }}>
                    {task.status === 'DONE' ? 'הושלם' : task.status === 'IN_PROGRESS' ? 'בביצוע' : task.status === 'OPEN' ? 'פתוח' : task.status === 'WAITING' ? 'ממתין' : task.status === 'BLOCKED' ? 'חסום' : task.status === 'FAILED' ? 'נכשל' : 'Rollback'}
                  </span>
                </div>

                {/* Col: Action buttons (stacked, left in RTL) */}
                <div style={{ width: '90px', flexShrink: 0, padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {!isDone && !isBlocking ? (
                    <>
                      {isOpen && (
                        <button disabled={isUpdating} onClick={() => focusAction(task.id, 'IN_PROGRESS')}
                          style={{ ...btnBase, background: `linear-gradient(135deg,${C.statusInProgress},#b07d1e)`, color: 'white', boxShadow: '0 2px 6px rgba(227,179,65,0.25)' }}>
                          ▶ התחל
                        </button>
                      )}
                      {isIP && (
                        <button disabled={isUpdating} onClick={() => focusAction(task.id, 'DONE')}
                          style={{ ...btnBase, background: `linear-gradient(135deg,${C.statusDone},#2ea043)`, color: 'white', boxShadow: '0 2px 6px rgba(86,211,100,0.22)' }}>
                          ✓ סיים
                        </button>
                      )}
                      {isBlocked && (
                        <button disabled={isUpdating} onClick={() => focusAction(task.id, 'IN_PROGRESS')}
                          style={{ ...btnBase, background: 'transparent', color: C.statusDone, border: `1px solid ${C.statusDone}44` }}>
                          ♻️ חזור
                        </button>
                      )}
                      {(isOpen || isIP) && (
                        <button disabled={isUpdating} onClick={() => { setFocusBlockTaskId(task.id); setFocusBlockReason(''); }}
                          style={{ ...btnBase, background: 'transparent', color: C.statusFailed, border: `1px solid ${C.statusFailed}55` }}>
                          🚫 חסום
                        </button>
                      )}
                      {isWait && !hasBlockingDeps && isManager && (
                        <button disabled={isUpdating} onClick={() => focusAction(task.id, 'OPEN')}
                          style={{ ...btnBase, background: `linear-gradient(135deg,${C.brand},#2563eb)`, color: 'white', boxShadow: '0 2px 6px rgba(56,139,253,0.30)' }}>
                          ▷ פתח
                        </button>
                      )}
                    </>
                  ) : isDone ? (
                    <span style={{ fontSize: '18px', textAlign: 'center', display: 'block', opacity: 0.5 }}>
                      {task.status === 'DONE' ? '✓' : task.status === 'FAILED' ? '✗' : '⏪'}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Block reason input (inline) */}
              {isBlocking && (
                <div style={{ padding: '8px 10px 10px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <textarea autoFocus value={focusBlockReason} onChange={e => setFocusBlockReason(e.target.value)}
                    placeholder="סיבת חסימה (חובה)..." rows={2}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: `1px solid ${C.statusFailed}66`, fontSize: '13px', resize: 'none', boxSizing: 'border-box', direction: 'rtl', fontFamily: FONT, background: C.bgCard, color: 'white', outline: 'none', marginBottom: '7px' }}
                  />
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => { setFocusBlockTaskId(null); setFocusBlockReason(''); }}
                      style={{ flex: 1, padding: '6px', background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', cursor: 'pointer', fontFamily: FONT, fontSize: '12px' }}>
                      ביטול
                    </button>
                    <button disabled={!focusBlockReason.trim() || isUpdating}
                      onClick={() => focusAction(task.id, 'BLOCKED', focusBlockReason.trim())}
                      style={{ flex: 2, padding: '6px', background: focusBlockReason.trim() ? C.statusFailed : 'rgba(255,255,255,0.05)', color: focusBlockReason.trim() ? 'white' : 'rgba(255,255,255,0.25)', border: 'none', borderRadius: '6px', cursor: focusBlockReason.trim() ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontFamily: FONT, fontSize: '12px' }}>
                      אשר חסימה 🚫
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        };

        // ── Near-tasks filter ──
        const now = Date.now();
        const isNearTask = (t: any) => {
          if (t.status === 'OPEN' || t.status === 'IN_PROGRESS' || t.status === 'BLOCKED') return true;
          if (!TERMINAL.includes(t.status) && t.plannedStart) {
            const ms = new Date(t.plannedStart).getTime() - now;
            return ms >= 0 && ms <= NEAR_MINUTES * 60_000;
          }
          return false;
        };

        const filterTasks = (tasks: any[]) =>
          focusNearOnly ? tasks.filter(isNearTask) : tasks;

        const filteredMyActive = filterTasks(myActiveTasks);
        const filteredGroups = subPhaseGroups.map(grp => ({
          ...grp,
          tasks: filterTasks(grp.tasks),
        })).filter(grp => grp.tasks.length > 0);

        const nearCount = scopedPhaseTasks.filter(isNearTask).length;

        // ── Dark panel colors (matching board dark theme) ──
        const PNL = {
          bg:       '#0f1923',   // deep navy
          header:   '#0b1420',   // darker header strip
          card:     '#172030',   // task card bg
          section:  '#13243a',   // sub-phase header
          border:   'rgba(255,255,255,0.08)',
          text:     '#e8edf2',
          muted:    'rgba(255,255,255,0.45)',
        };

        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 20000, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl', fontFamily: FONT }}
            onClick={() => setFocusMode(false)}
          >
            <div
              style={{ width: '100%', maxWidth: '820px', height: '90vh', margin: '0 16px', display: 'flex', flexDirection: 'column', background: PNL.bg, borderRadius: '16px', boxShadow: '0 24px 64px rgba(0,0,0,0.7)', overflow: 'hidden', border: `1px solid ${PNL.border}` }}
              onClick={e => e.stopPropagation()}
            >

              {/* ── Header bar ── */}
              <div style={{ background: PNL.header, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: `1px solid ${PNL.border}`, flexShrink: 0 }}>
                <span style={{ fontSize: '18px' }}>⚡</span>
                <span style={{ fontSize: '16px', fontWeight: 'bold', color: PNL.text }}>מצב הרצה</span>
                {focusActivePhaseName && (
                  <span style={{ fontSize: '13px', color: PNL.muted, background: 'rgba(255,255,255,0.07)', padding: '3px 12px', borderRadius: '20px', border: `1px solid ${PNL.border}` }}>
                    {focusActivePhaseName}
                  </span>
                )}
                <div style={{ flex: 1 }} />
                {/* Near-only toggle */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', fontSize: '13px', color: PNL.muted, userSelect: 'none' as const }}>
                  <input
                    type="checkbox"
                    checked={focusNearOnly}
                    onChange={e => setFocusNearOnly(e.target.checked)}
                    style={{ width: '15px', height: '15px', accentColor: C.brand, cursor: 'pointer' }}
                  />
                  <span style={{ color: focusNearOnly ? C.brand : PNL.muted, fontWeight: focusNearOnly ? 'bold' : 'normal' }}>
                    {NEAR_MINUTES} דקות קרובות בלבד
                    {focusNearOnly && <span style={{ marginRight: '6px', color: C.statusWaiting }}>({nearCount})</span>}
                  </span>
                </label>
                <span style={{ color: PNL.muted, fontSize: '12px', background: 'rgba(255,255,255,0.06)', padding: '3px 10px', borderRadius: '10px' }}>
                  {phaseDone}/{phaseTotal} ✓
                </span>
                <button onClick={() => setFocusMode(false)}
                  style={{ background: 'rgba(255,255,255,0.07)', border: `1px solid ${PNL.border}`, color: PNL.muted, cursor: 'pointer', fontSize: '18px', width: '30px', height: '30px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  ×
                </button>
              </div>

              {/* ── Progress bar ── */}
              <div style={{ padding: '10px 20px', background: PNL.header, borderBottom: `1px solid ${PNL.border}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ flex: 1, height: '7px', background: 'rgba(255,255,255,0.10)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${phasePct}%`, background: phasePct === 100 ? C.statusDone : `linear-gradient(90deg, ${C.brand}, ${C.statusInProgress})`, borderRadius: '4px', transition: 'width 0.5s ease' }} />
                </div>
                <span style={{ fontSize: '12px', color: PNL.muted, whiteSpace: 'nowrap' }}>{phasePct}%</span>
                {isManager && openableWaiting.length > 0 && (
                  <button disabled={!!updatingTaskId} onClick={openAllNoDeps}
                    style={{ padding: '5px 14px', background: '#4a3a00', color: '#f0c040', border: '1px solid #7a6010', borderRadius: '7px', cursor: updatingTaskId ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '12px', fontFamily: FONT, whiteSpace: 'nowrap', opacity: updatingTaskId ? 0.6 : 1 }}>
                    🔓 פתח ללא תלות ({openableWaiting.length})
                  </button>
                )}
              </div>

              {/* ── Task list (scrollable) ── */}
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                {phaseTotal === 0 ? (
                  <div style={{ padding: '60px', textAlign: 'center' }}>
                    <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: C.statusDone }}>כל השלבים הושלמו!</div>
                  </div>
                ) : (
                  <>
                    {/* My tasks */}
                    {filteredMyActive.length > 0 && (
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 'bold', color: C.brand, padding: '8px 16px', background: 'rgba(240,106,106,0.10)', borderBottom: `1px solid rgba(240,106,106,0.15)`, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          ★ המשימות שלי ({filteredMyActive.length})
                        </div>
                        {filteredMyActive.map((t: any) => <TaskRow key={t.id} task={t} />)}
                      </div>
                    )}

                    {/* By sub-phase */}
                    {filteredGroups.map(grp => {
                      const grpDone = grp.tasks.filter((t: any) => TERMINAL.includes(t.status)).length;
                      return (
                        <div key={grp.subName}>
                          <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'rgba(255,255,255,0.55)', padding: '7px 16px', background: PNL.section, borderBottom: `1px solid ${PNL.border}`, borderTop: `1px solid ${PNL.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{grp.subName}</span>
                            <span style={{ color: grpDone === grp.tasks.length ? C.statusDone : PNL.muted }}>{grpDone}/{grp.tasks.length}</span>
                          </div>
                          {grp.tasks.map((t: any) => <TaskRow key={t.id} task={t} />)}
                        </div>
                      );
                    })}

                    {focusNearOnly && nearCount === 0 && (
                      <div style={{ padding: '48px', textAlign: 'center', color: PNL.muted }}>
                        <div style={{ fontSize: '32px', marginBottom: '10px' }}>⏳</div>
                        <div style={{ fontSize: '14px' }}>אין משימות פעילות בטווח {NEAR_MINUTES} הדקות הקרובות</div>
                        <button onClick={() => setFocusNearOnly(false)}
                          style={{ marginTop: '14px', padding: '7px 18px', background: 'rgba(255,255,255,0.08)', color: PNL.text, border: `1px solid ${PNL.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontFamily: FONT }}>
                          הצג כל המשימות
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Footer status strip ── */}
              <div style={{ background: PNL.header, borderTop: `1px solid ${PNL.border}`, padding: '8px 20px', display: 'flex', gap: '16px', fontSize: '12px', color: PNL.muted, flexShrink: 0, flexWrap: 'wrap' }}>
                {[
                  { label: 'הושלם', count: scopedPhaseTasks.filter((t: any) => t.status === 'DONE').length, color: C.statusDone },
                  { label: 'בביצוע', count: scopedPhaseTasks.filter((t: any) => t.status === 'IN_PROGRESS').length, color: C.statusInProgress },
                  { label: 'פתוח',  count: scopedPhaseTasks.filter((t: any) => t.status === 'OPEN').length, color: C.statusOpen },
                  { label: 'ממתין', count: scopedPhaseTasks.filter((t: any) => t.status === 'WAITING').length, color: C.statusWaiting },
                  { label: 'חסום',  count: scopedPhaseTasks.filter((t: any) => t.status === 'BLOCKED').length, color: C.statusFailed },
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
        );
      })()}

      {/* ── דיאלוג סיבת חסימה ── */}
      {blockingTask && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
          onClick={() => setBlockingTask(null)}
        >
          <div
            style={{ background: C.bgCard, borderRadius: '14px', padding: '28px 32px', minWidth: '380px', maxWidth: '480px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', direction: 'rtl', border: `1px solid ${C.border}` }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '22px' }}>🚨</span>
              <h3 style={{ margin: 0, color: C.statusFailed, fontSize: '17px' }}>סיבת חסימה</h3>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: C.textMuted }}>
              משימה: <strong style={{ color: C.textPrimary }}>{blockingTask.title}</strong>
            </p>
            <textarea
              autoFocus
              value={blockingReason}
              onChange={e => setBlockingReason(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  updateTaskStatus(blockingTask.id, 'BLOCKED', blockingReason.trim());
                  setBlockingTask(null);
                }
              }}
              placeholder="הזן את סיבת החסימה... (חובה)"
              rows={3}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                border: `1px solid ${C.borderEm}`, fontSize: '14px', resize: 'vertical',
                boxSizing: 'border-box', direction: 'rtl', fontFamily: FONT,
                background: C.bgNested, color: C.textPrimary, outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setBlockingTask(null)}
                style={{ padding: '9px 20px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.bgNested, color: C.textSecondary, cursor: 'pointer', fontSize: '14px', fontFamily: FONT }}
              >ביטול</button>
              <button
                onClick={() => {
                  updateTaskStatus(blockingTask.id, 'BLOCKED', blockingReason.trim());
                  setBlockingTask(null);
                }}
                disabled={!blockingReason.trim()}
                style={{ padding: '9px 22px', borderRadius: '8px', border: 'none', background: blockingReason.trim() ? C.statusFailed : C.bgHover, color: blockingReason.trim() ? 'white' : C.textDisabled, cursor: blockingReason.trim() ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontSize: '14px', fontFamily: FONT }}
              >אשר חסימה</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
