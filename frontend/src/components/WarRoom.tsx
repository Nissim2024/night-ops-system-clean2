import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { usePermissions } from '../context/PermissionsContext';
import { C, FONT, statusColor, statusBg } from '../theme';

const API = 'http://localhost:3000';

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
}

type GoStatus = 'checking' | 'go' | 'nogo' | null;

interface GoNoPanelProps {
  env: string;
  label: string;
  status: GoStatus;
  details: { incomplete: number; blocked: number; blockedNoReason: string[] } | undefined;
  envTasks: any[];
  onCheck: (env: string) => void;
  failedTasks?: any[];
  onWaive?: (taskId: string) => void;
  isManager?: boolean;
}

const GoNoGoPanel: React.FC<GoNoPanelProps> = ({ env, label, status, details, envTasks, onCheck, failedTasks = [], onWaive, isManager }) => {
  const canCheck = envTasks.length > 0;
  const unwaived = failedTasks.filter((t: any) => !t.goNoGoWaived);
  const waived = failedTasks.filter((t: any) => t.goNoGoWaived);
  return (
    <div style={{ background: C.bgNested, borderRadius: '10px', padding: '16px', border: `1px solid ${C.border}`, minWidth: '280px', flex: 1 }}>
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
          background: !canCheck ? C.bgHover : status === 'go' ? C.statusDone : status === 'nogo' ? C.statusFailed : C.brand,
          color: !canCheck ? C.textDisabled : 'white', width: '100%',
        }}
      >
        {status === 'checking' ? 'בודק...' : status === 'go' ? '✅ GO!' : status === 'nogo' ? '❌ NO GO' : 'בדוק GO/NO GO'}
      </button>
      {status === 'go' && (
        <div style={{ marginTop: '10px', background: C.bgDone, borderRadius: '6px', padding: '8px 12px', color: C.statusDone, fontWeight: 'bold', fontSize: '13px', border: `1px solid ${C.statusDone}44` }}>
          כל משימות {label} הושלמו — ניתן להמשיך!
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
                style={{ padding: '2px 8px', fontSize: '11px', background: '#e67e22', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
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

export const WarRoom: React.FC<Props> = ({ token, versionId, versionName, isRehearsal = false, hideGoNogo = false, onTeamClick, onlineUsers = [], onVersionEnded, refreshSignal }) => {
  const { can } = usePermissions();
  const [version, setVersion] = useState<any>(null);
  const [allTasks, setAllTasks] = useState<any[]>([]);
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

  const payload = JSON.parse(atob(token.split('.')[1]));
  const isManager = ['RELEASE_MANAGER', 'ADMIN'].includes(payload.role);

  const [goStatus, setGoStatus] = useState<Record<string, GoStatus>>({});
  const [goDetails, setGoDetails] = useState<Record<string, { incomplete: number; blocked: number; blockedNoReason: string[] }>>({});

  const headers = { Authorization: `Bearer ${token}` };

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
      const tasks = (v.phases ?? []).flatMap((p: any) =>
        (p.subPhases ?? []).flatMap((sp: any) =>
          (sp.tasks ?? []).map((t: any) => ({
            ...t,
            _phaseEnv: p.environment,
            _phaseOrderIndex: p.orderIndex,
            _phaseName: p.name,
          }))
        )
      );
      setAllTasks(tasks);
      setTeams(teamsRes.data);
      setGoStatus({});
      setGoDetails({});
    } catch (err) { console.error(err); }
    finally { if (!silent) setLoading(false); }
  };

  fetchDataRef.current = fetchData;

  useEffect(() => { fetchData(); }, [versionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const socket = io('http://localhost:3000', { transports: ['websocket'] });
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

  const getEnvTasks = (env: string) =>
    allTasks.filter(t => t._phaseEnv === env);

  const checkGoForEnv = (env: string) => {
    setGoStatus(prev => ({ ...prev, [env]: 'checking' }));

    const targetOrderIndex = allTasks.find(t => t._phaseEnv === env)?._phaseOrderIndex ?? 999;
    const allRequired = allTasks.filter(t => t._phaseOrderIndex <= targetOrderIndex);

    const incomplete = allRequired.filter(t => t.status !== 'DONE' && !t.goNoGoWaived).length;
    const blocked = allRequired.filter(t => (t.status === 'BLOCKED' || t.status === 'FAILED') && !t.goNoGoWaived).length;
    const blockedNoReason = allRequired
      .filter(t => t.status === 'BLOCKED' && !t.blockedReason)
      .map((t: any) => t.title);

    const phasesSeen = new Map<number, { name: string; done: number; total: number }>();
    for (const t of allRequired) {
      const key = t._phaseOrderIndex;
      if (!phasesSeen.has(key)) phasesSeen.set(key, { name: t._phaseName, done: 0, total: 0 });
      const p = phasesSeen.get(key)!;
      p.total++;
      if (t.status === 'DONE') p.done++;
    }
    const missingByEnv: string[] = Array.from(phasesSeen.entries())
      .sort((a, b) => a[0] - b[0])
      .filter(([, p]) => p.done < p.total)
      .map(([, p]) => `${p.name}: ${p.done}/${p.total} הושלמו`);

    setGoDetails(prev => ({ ...prev, [env]: { blocked, incomplete, blockedNoReason, missingByEnv } as any }));
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
    const targetOrderIndex = allTasks.find(t => t._phaseEnv === env)?._phaseOrderIndex ?? 999;
    return allTasks.filter(t => t._phaseOrderIndex <= targetOrderIndex);
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
        <div style={{ background: 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)', borderRadius: '10px', padding: '12px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', color: 'white' }}>
          <span style={{ fontSize: '28px' }}>🎭</span>
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '16px' }}>מצב חזרה גנרלית</div>
            <div style={{ fontSize: '13px', opacity: 0.9 }}>סימולציה של לילה אמיתי — בסיום ניתן להוציא סיכום ולאפס את הגרסה ל"מאושר"</div>
          </div>
        </div>
      )}

      {/* כותרת */}
      <div style={{
        background: isRehearsal ? 'linear-gradient(135deg, #3d1c00 0%, #7a3500 100%)' : C.headerBg,
        borderRadius: '12px', padding: '24px', marginBottom: '20px', color: 'white',
        border: `1px solid ${C.border}`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '24px', color: C.textPrimary }}>{isRehearsal ? '🎭 ' : ''}War Room — {versionName}</h2>
            <p style={{ margin: 0, color: C.textMuted, fontSize: '14px' }}>{isRehearsal ? 'חזרה גנרלית — בזמן אמת' : 'מבט-על בזמן אמת'}</p>
            {version?.reviewMeetingTime && (
              <p style={{ margin: '4px 0 0', color: '#58a6ff', fontSize: '13px', fontWeight: '600' }}>
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
                  padding: '8px 14px', borderRadius: '8px', cursor: pushToggling ? 'not-allowed' : 'pointer',
                  fontSize: '13px', fontWeight: 'bold', border: 'none', fontFamily: FONT,
                  background: pushEnabled ? 'rgba(63,185,80,0.25)' : 'rgba(248,81,73,0.25)',
                  color: pushEnabled ? C.statusDone : C.statusFailed,
                }}>
                {pushEnabled ? '🔔 Push פעיל' : '🔕 Push כבוי'}
              </button>
            )}
            <button onClick={() => fetchData()} style={{
              padding: '8px 16px', background: 'rgba(255,255,255,0.1)', color: C.textSecondary,
              border: `1px solid ${C.borderEm}`, borderRadius: '8px', cursor: 'pointer',
              fontSize: '14px', fontFamily: FONT,
            }}>
              רענן
            </button>
          </div>
        </div>

        <div style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px', color: C.textSecondary }}>
            <span>התקדמות כללית</span>
            <span>{doneTasks}/{totalTasks} משימות ({progressPercent}%)</span>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '8px', height: '12px', overflow: 'hidden' }}>
            <div style={{ background: progressPercent === 100 ? C.statusDone : C.brand, width: `${progressPercent}%`, height: '100%', borderRadius: '8px', transition: 'width 0.5s ease' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
          {[
            { label: 'הושלמו', value: doneTasks,                                              color: C.statusDone },
            { label: 'בביצוע', value: inProgressTasks,                                        color: C.statusInProgress },
            { label: 'פתוחות', value: allTasks.filter(t => t.status === 'OPEN').length,       color: C.statusOpen },
            { label: 'ממתינות', value: allTasks.filter(t => t.status === 'WAITING').length,   color: C.statusWaiting },
            { label: 'חסומות', value: blockedTasks,                                            color: C.statusBlocked },
            { label: 'סה"כ',  value: totalTasks,                                              color: C.textPrimary },
          ].map(stat => (
            <div key={stat.label} style={{ background: 'rgba(255,255,255,0.07)', borderRadius: '8px', padding: '10px 16px', textAlign: 'center', minWidth: '70px', border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
              <div style={{ fontSize: '11px', color: C.textMuted }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* GO/NO GO — מפוצל לפי סביבה */}
      {(can('action:gonogo') || isManager) && !hideGoNogo && (
        <div style={{ background: C.bgCard, borderRadius: '12px', padding: '20px', marginBottom: '20px', border: `1px solid ${C.border}` }}>
          <h3 style={{ margin: '0 0 16px', color: C.textPrimary, fontSize: '15px' }}>GO / NO GO — לפי סביבה</h3>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <GoNoGoPanel env="HOTNET" label="פעילות לילה — HOTNET" status={goStatus['HOTNET']} details={goDetails['HOTNET']} envTasks={getEnvTasks('HOTNET')} onCheck={checkGoForEnv}
              failedTasks={getGoRequiredTasks('HOTNET').filter(t => t.status === 'FAILED')} onWaive={waiveTask} isManager={isManager} />
            <GoNoGoPanel env="HOT" label="פעילות לילה — HOT" status={goStatus['HOT']} details={goDetails['HOT']} envTasks={getEnvTasks('HOT')} onCheck={checkGoForEnv}
              failedTasks={getGoRequiredTasks('HOT').filter(t => t.status === 'FAILED')} onWaive={waiveTask} isManager={isManager} />
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

        const planUserMap = new Map<string, { key: string; name: string }>();
        allTasks.forEach(t => {
          const key = t.assignedUserId || t.assignedUserName;
          if (key && !planUserMap.has(key)) {
            planUserMap.set(key, { key, name: t.assignedUserName || key });
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
          const userTasks = allTasks.filter(t =>
            t.assignedUserId === key ||
            (!t.assignedUserId && t.assignedUserName === name)
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
