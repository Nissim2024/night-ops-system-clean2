import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { usePermissions } from '../context/PermissionsContext';

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
}

type GoStatus = 'checking' | 'go' | 'nogo' | null;

interface GoNoPanelProps {
  env: string;
  label: string;
  status: GoStatus;
  details: { incomplete: number; blocked: number; blockedNoReason: string[] } | undefined;
  envTasks: any[];
  onCheck: (env: string) => void;
}

const GoNoGoPanel: React.FC<GoNoPanelProps> = ({ env, label, status, details, envTasks, onCheck }) => {
  const canCheck = envTasks.length > 0;
  return (
    <div style={{ background: '#f8f9fa', borderRadius: '10px', padding: '16px', border: '1px solid #e0e0e0', minWidth: '280px', flex: 1 }}>
      <div style={{ fontWeight: 'bold', color: '#1a2332', marginBottom: '10px', fontSize: '14px' }}>{label}</div>
      <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>
        {envTasks.length} משימות · {envTasks.filter((t: any) => t.status === 'DONE').length} הושלמו
      </div>
      <button
        onClick={() => canCheck && onCheck(env)}
        disabled={!canCheck}
        style={{
          padding: '10px 20px', fontWeight: 'bold', fontSize: '14px', border: 'none', borderRadius: '8px', cursor: canCheck ? 'pointer' : 'not-allowed',
          background: !canCheck ? '#ccc' : status === 'go' ? '#27ae60' : status === 'nogo' ? '#e74c3c' : '#1a2332',
          color: 'white', width: '100%',
        }}
      >
        {status === 'checking' ? 'בודק...' : status === 'go' ? '✅ GO!' : status === 'nogo' ? '❌ NO GO' : 'בדוק GO/NO GO'}
      </button>
      {status === 'go' && (
        <div style={{ marginTop: '10px', background: '#d5f0dc', borderRadius: '6px', padding: '8px 12px', color: '#1e8449', fontWeight: 'bold', fontSize: '13px' }}>
          כל משימות {label} הושלמו — ניתן להמשיך!
        </div>
      )}
      {status === 'nogo' && details && (
        <div style={{ marginTop: '10px', background: '#fee', borderRadius: '6px', padding: '8px 12px', color: '#c0392b', fontSize: '13px' }}>
          {(details as any).missingByEnv?.length > 0 && (
            <div style={{ marginBottom: '6px' }}>
              {(details as any).missingByEnv.map((line: string, i: number) => (
                <div key={i}>⚠️ {line}</div>
              ))}
            </div>
          )}
          {details.blocked > 0 && <div>{details.blocked} משימות חסומות</div>}
          {details.blockedNoReason?.length > 0 && (
            <div style={{ marginTop: '6px', borderTop: '1px solid #f5b7b1', paddingTop: '6px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>⚠️ חסומות ללא סיבה:</div>
              {details.blockedNoReason.map((title: string, i: number) => (
                <div key={i} style={{ fontSize: '12px' }}>• {title}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const WarRoom: React.FC<Props> = ({ token, versionId, versionName, isRehearsal = false, hideGoNogo = false, onTeamClick, onlineUsers = [], onVersionEnded }) => {
  const { can } = usePermissions();
  const [version, setVersion] = useState<any>(null);
  const [allTasks, setAllTasks] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [planView, setPlanView] = useState<'overview' | 'plan' | 'connected'>('overview');

  // GO/NO GO state per environment
  const [goStatus, setGoStatus] = useState<Record<string, GoStatus>>({});
  const [goDetails, setGoDetails] = useState<Record<string, { incomplete: number; blocked: number; blockedNoReason: string[] }>>({});

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
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
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [versionId]);

  // Tasks per environment (based on phase environment)
  const getEnvTasks = (env: string) =>
    allTasks.filter(t => t._phaseEnv === env);

  const checkGoForEnv = (env: string) => {
    setGoStatus(prev => ({ ...prev, [env]: 'checking' }));

    // Find the orderIndex of the clicked env's phase
    const targetOrderIndex = allTasks.find(t => t._phaseEnv === env)?._phaseOrderIndex ?? 999;

    // All tasks in phases UP TO AND INCLUDING the target phase (by order).
    // This correctly excludes post-night BOTH phases that come after HOT/HOTNET.
    const allRequired = allTasks.filter(t => t._phaseOrderIndex <= targetOrderIndex);

    const incomplete = allRequired.filter(t => t.status !== 'DONE').length;
    const blocked = allRequired.filter(t => t.status === 'BLOCKED' || t.status === 'FAILED').length;
    const blockedNoReason = allRequired
      .filter(t => t.status === 'BLOCKED' && !t.blockedReason)
      .map((t: any) => t.title);

    // Per-phase breakdown for the NO GO message
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
    { value: 'WAITING', label: 'ממתין', color: '#9b59b6' },
    { value: 'OPEN', label: 'פתוח', color: '#3498db' },
    { value: 'IN_PROGRESS', label: 'בביצוע', color: '#f39c12' },
    { value: 'DONE', label: 'הושלם', color: '#27ae60' },
    { value: 'BLOCKED', label: 'חסום', color: '#e74c3c' },
    { value: 'FAILED', label: 'נכשל', color: '#c0392b' },
    { value: 'ROLLED_BACK', label: 'Rollback', color: '#7f8c8d' },
  ];

  const updateTaskStatus = async (taskId: string, status: string) => {
    setUpdatingTaskId(taskId);
    try {
      await axios.patch(`${API}/tasks/${taskId}/status`, { status }, { headers });
      await fetchData();
    } catch (err) { console.error(err); }
    finally { setUpdatingTaskId(null); }
  };

  const ENV_COLORS: Record<string, { bg: string; color: string }> = {
    HOT: { bg: '#fee', color: '#c0392b' },
    HOTNET: { bg: '#e8f4fd', color: '#2980b9' },
    BOTH: { bg: '#f0f0f0', color: '#555' },
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '60px', color: '#666' }}>טוען War Room...</div>;

  return (
    <div style={{ direction: 'rtl', fontFamily: 'Arial' }}>

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
      <div style={{ background: isRehearsal ? 'linear-gradient(135deg, #8B4000 0%, #c0670a 100%)' : 'linear-gradient(135deg, #1a2332 0%, #2d4a7a 100%)', borderRadius: '12px', padding: '24px', marginBottom: '20px', color: 'white' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '24px' }}>{isRehearsal ? '🎭 ' : ''}War Room — {versionName}</h2>
            <p style={{ margin: 0, opacity: 0.8, fontSize: '14px' }}>{isRehearsal ? 'חזרה גנרלית — בזמן אמת' : 'מבט-על בזמן אמת'}</p>
          </div>
          <button onClick={fetchData} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
            רענן
          </button>
        </div>

        <div style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
            <span>התקדמות כללית</span>
            <span>{doneTasks}/{totalTasks} משימות ({progressPercent}%)</span>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: '8px', height: '12px', overflow: 'hidden' }}>
            <div style={{ background: progressPercent === 100 ? '#27ae60' : '#3498db', width: `${progressPercent}%`, height: '100%', borderRadius: '8px', transition: 'width 0.5s ease' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '16px', marginTop: '16px', flexWrap: 'wrap' }}>
          {[
            { label: 'הושלמו', value: doneTasks, color: '#27ae60' },
            { label: 'בביצוע', value: inProgressTasks, color: '#f39c12' },
            { label: 'פתוחות', value: allTasks.filter(t => t.status === 'OPEN').length, color: '#3498db' },
            { label: 'ממתינות', value: allTasks.filter(t => t.status === 'WAITING').length, color: '#9b59b6' },
            { label: 'חסומות', value: blockedTasks, color: '#e74c3c' },
            { label: 'סה"כ', value: totalTasks, color: 'white' },
          ].map(stat => (
            <div key={stat.label} style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '8px', padding: '10px 16px', textAlign: 'center', minWidth: '70px' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
              <div style={{ fontSize: '11px', opacity: 0.8 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* GO/NO GO — מפוצל לפי סביבה */}
      {can('action:gonogo') && !hideGoNogo && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <h3 style={{ margin: '0 0 16px', color: '#1a2332' }}>GO / NO GO — לפי סביבה</h3>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <GoNoGoPanel env="HOTNET" label="פעילות לילה — HOTNET" status={goStatus['HOTNET']} details={goDetails['HOTNET']} envTasks={getEnvTasks('HOTNET')} onCheck={checkGoForEnv} />
            <GoNoGoPanel env="HOT" label="פעילות לילה — HOT" status={goStatus['HOT']} details={goDetails['HOT']} envTasks={getEnvTasks('HOT')} onCheck={checkGoForEnv} />
          </div>
        </div>
      )}

      {/* בחירת תצוגה */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {[
          { key: 'overview', label: '👥 סקירת צוותים' },
          { key: 'connected', label: `🟢 מחוברים (${onlineUsers.length})` },
          { key: 'plan', label: '📋 תוכנית ביצוע' },
        ].map(tab => (
          <button key={tab.key} onClick={() => setPlanView(tab.key as any)}
            style={{ padding: '10px 20px', fontWeight: 'bold', fontSize: '14px', border: 'none', borderRadius: '8px', cursor: 'pointer',
              background: planView === tab.key ? '#1a2332' : '#f0f0f0',
              color: planView === tab.key ? 'white' : '#555' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* תוכנית ביצוע */}
      {planView === 'plan' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, color: '#1a2332' }}>תוכנית ביצוע</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setCollapsedPhases(new Set(version?.phases?.map((p: any) => p.id) ?? []))} style={{ padding: '6px 14px', background: '#e8ecf0', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>▶ קפל הכל</button>
              <button onClick={() => setCollapsedPhases(new Set())} style={{ padding: '6px 14px', background: '#e8ecf0', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>▼ פתח הכל</button>
            </div>
          </div>
          {(version?.phases ?? []).map((phase: any) => {
            const envStyle = ENV_COLORS[phase.environment] ?? ENV_COLORS.BOTH;
            const phaseTasks = phase.subPhases?.flatMap((sp: any) => sp.tasks ?? []) ?? [];
            const phaseDone = phaseTasks.filter((t: any) => t.status === 'DONE').length;
            const isCollapsed = collapsedPhases.has(phase.id);
            return (
              <div key={phase.id} style={{ background: 'white', borderRadius: '12px', padding: '16px 20px', marginBottom: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <div onClick={() => setCollapsedPhases(prev => { const n = new Set(prev); n.has(phase.id) ? n.delete(phase.id) : n.add(phase.id); return n; })}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: isCollapsed ? 0 : '12px' }}>
                  <span style={{ fontSize: '12px', color: '#aaa' }}>{isCollapsed ? '►' : '▼'}</span>
                  <span style={{ background: envStyle.bg, color: envStyle.color, padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>{phase.environment}</span>
                  <span style={{ fontWeight: 'bold', color: '#1a2332', fontSize: '15px' }}>{phase.name}</span>
                  <span style={{ fontSize: '12px', color: phaseDone === phaseTasks.length && phaseTasks.length > 0 ? '#27ae60' : '#999', fontWeight: 'bold' }}>
                    {phaseDone}/{phaseTasks.length} ✓
                  </span>
                </div>
                {!isCollapsed && phase.subPhases?.map((sub: any) => {
                  const subDone = (sub.tasks ?? []).filter((t: any) => t.status === 'DONE').length;
                  return (
                    <div key={sub.id} style={{ marginBottom: '10px', paddingRight: '16px', borderRight: '3px solid #e0e0e0' }}>
                      <div style={{ fontWeight: 'bold', color: '#444', fontSize: '13px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {sub.name}
                        <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 'normal' }}>{subDone}/{sub.tasks?.length ?? 0}</span>
                      </div>
                      {(sub.tasks ?? []).map((task: any) => {
                        const statusDef = TASK_STATUSES.find(s => s.value === task.status) ?? TASK_STATUSES[0];
                        return (
                          <div key={task.id} style={{ background: '#f8f9fa', borderRadius: '8px', padding: '8px 12px', marginBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px',
                            borderRight: `3px solid ${statusDef.color}` }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: task.status === 'IN_PROGRESS' ? 'bold' : 'normal', color: '#1a2332', fontSize: '13px' }}>{task.title}</div>
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
                                {task.assignedUserName && <span style={{ fontSize: '11px', color: '#666' }}>👤 {task.assignedUserName}</span>}
                                {task.assignedTeam?.name && <span style={{ fontSize: '11px', color: '#666' }}>👥 {task.assignedTeam.name}</span>}
                                {task.duration && <span style={{ fontSize: '11px', color: '#b7950b' }}>⏱ {task.duration}</span>}
                                {task.blockedReason && <span style={{ fontSize: '11px', color: '#e74c3c' }}>סיבה: {task.blockedReason}</span>}
                              </div>
                            </div>
                            <select
                              value={task.status}
                              disabled={updatingTaskId === task.id}
                              onChange={e => updateTaskStatus(task.id, e.target.value)}
                              style={{ padding: '4px 8px', borderRadius: '6px', border: `2px solid ${statusDef.color}`, fontSize: '12px', fontWeight: 'bold',
                                color: statusDef.color, background: statusDef.color + '18', cursor: 'pointer', minWidth: '90px' }}>
                              {TASK_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
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
        // Build set of plan users from allTasks
        const onlineIds = new Set(onlineUsers.map(u => u.userId));
        const onlineNames = new Set(onlineUsers.map(u => u.fullName));

        // Collect unique plan users (assignedUserId preferred, fall back to assignedUserName)
        const planUserMap = new Map<string, { key: string; name: string }>();
        allTasks.forEach(t => {
          const key = t.assignedUserId || t.assignedUserName;
          if (key && !planUserMap.has(key)) {
            planUserMap.set(key, { key, name: t.assignedUserName || key });
          }
        });
        const planUsers = Array.from(planUserMap.values());

        // Categorise
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
              background: 'white', borderRadius: '12px', padding: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              border: uBlocked > 0 ? '2px solid #e74c3c' : '1px solid #e0e0e0',
              ...cardStyle,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {dot}
                  <h4 style={{ margin: 0, color: '#1a2332', fontSize: '15px' }}>{name}</h4>
                </div>
                {uBlocked > 0 && (
                  <span style={{ background: '#fee', color: '#e74c3c', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>
                    {uBlocked} חסום
                  </span>
                )}
              </div>

              {uTotal === 0 ? (
                <div style={{ background: '#f8f9fa', borderRadius: '8px', padding: '10px 14px', color: '#888', fontSize: '13px', textAlign: 'center' }}>
                  ללא משימות בגרסה
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                      <span>{uDone}/{uTotal} משימות</span>
                      <span>{uProgress}%</span>
                    </div>
                    <div style={{ background: '#f0f0f0', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                      <div style={{ background: uProgress === 100 ? '#27ae60' : '#3498db', width: `${uProgress}%`, height: '100%', borderRadius: '4px', transition: 'width 0.3s' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {[
                      { label: 'הושלם', value: uDone,       color: '#27ae60' },
                      { label: 'בביצוע', value: uInProgress, color: '#f39c12' },
                      { label: 'פתוח',   value: uOpen,       color: '#3498db' },
                      { label: 'ממתין',  value: uWaiting,    color: '#9b59b6' },
                      { label: 'חסום',   value: uBlocked,    color: '#e74c3c' },
                    ].filter(s => s.value > 0).map(s => (
                      <span key={s.label} style={{ background: s.color + '22', color: s.color, padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>
                        {s.value} {s.label}
                      </span>
                    ))}
                  </div>
                  {uInProgress > 0 && (
                    <div style={{ marginTop: '10px', borderTop: '1px solid #f0f0f0', paddingTop: '8px' }}>
                      {userTasks.filter(t => t.status === 'IN_PROGRESS').map(t => (
                        <div key={t.id} style={{ fontSize: '12px', color: '#e65100', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                          <span>▶</span> {t.title}
                        </div>
                      ))}
                    </div>
                  )}
                  {uBlocked > 0 && (
                    <div style={{ marginTop: '6px' }}>
                      {userTasks.filter(t => t.status === 'BLOCKED').map(t => (
                        <div key={t.id} style={{ fontSize: '12px', color: '#c0392b', display: 'flex', alignItems: 'flex-start', gap: '4px', marginBottom: '2px' }}>
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
              <h3 style={{ margin: 0, color: '#1a2332' }}>משתתפי התוכנית</h3>
              <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: '#555' }}>
                <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: '#2ecc71', marginLeft: '4px', boxShadow: '0 0 5px #2ecc71' }} />מחובר ({inPlanOnline.length})</span>
                <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: '#e74c3c', marginLeft: '4px' }} />לא מחובר ({inPlanOffline.length})</span>
                {notInPlan.length > 0 && <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: '#bbb', marginLeft: '4px' }} />מחובר ללא משימות ({notInPlan.length})</span>}
              </div>
            </div>

            {planUsers.length === 0 && onlineUsers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', color: '#999', background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>👥</div>
                <div style={{ fontSize: '16px' }}>אין משתמשים מחוברים כרגע</div>
              </div>
            ) : (
              <>
                {/* משתתפים בתוכנית — מחוברים */}
                {inPlanOnline.length > 0 && (
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#27ae60', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#2ecc71', display: 'inline-block' }} />
                      מחוברים ובתוכנית
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                      {inPlanOnline.map(u => renderUserCard(
                        u.name, u.key,
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#2ecc71', display: 'inline-block', flexShrink: 0, boxShadow: '0 0 6px #2ecc71' }} />,
                        {},
                      ))}
                    </div>
                  </div>
                )}

                {/* משתתפים בתוכנית — לא מחוברים */}
                {inPlanOffline.length > 0 && (
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#c0392b', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#e74c3c', display: 'inline-block' }} />
                      בתוכנית — לא מחובר
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                      {inPlanOffline.map(u => renderUserCard(
                        u.name, u.key,
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#e0e0e0', border: '2px solid #e74c3c', display: 'inline-block', flexShrink: 0 }} />,
                        { opacity: 0.8, borderColor: '#e74c3c', borderWidth: '2px' },
                      ))}
                    </div>
                  </div>
                )}

                {/* מחוברים ללא משימות בתוכנית */}
                {notInPlan.length > 0 && (
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#888', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#bbb', display: 'inline-block' }} />
                      מחוברים — לא חלק מהתוכנית
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                      {notInPlan.map(u => (
                        <div key={u.userId} style={{ background: '#f5f5f5', border: '1px solid #ddd', borderRadius: '8px', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '8px', color: '#777', fontSize: '13px' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#bbb', display: 'inline-block' }} />
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
      <h3 style={{ color: '#1a2332', marginBottom: '16px' }}>
        סטטוס צוותים
        {onTeamClick && <span style={{ fontSize: '12px', color: '#888', fontWeight: 'normal', marginRight: '8px' }}>— לחץ על שם הצוות לפרטי משימות</span>}
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
        {teams.map(team => {
          const stats = getTeamStats(team.id);
          if (stats.total === 0) return null;
          const teamProgress = Math.round((stats.done / stats.total) * 100);
          const isSelected = selectedTeam === team.id;

          return (
            <div key={team.id}
              onClick={() => setSelectedTeam(isSelected ? null : team.id)}
              style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: stats.blocked > 0 ? '2px solid #e74c3c' : isSelected ? '2px solid #2d4a7a' : '1px solid #e0e0e0', cursor: 'pointer', transition: 'all 0.2s' }}>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4
                  style={{ margin: 0, color: onTeamClick ? '#2d4a7a' : '#1a2332', textDecoration: onTeamClick ? 'underline' : 'none', cursor: onTeamClick ? 'pointer' : 'default' }}
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
                  {stats.blocked > 0 && <span style={{ background: '#fee', color: '#e74c3c', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>{stats.blocked} חסום</span>}
                  <span style={{ fontSize: '16px' }}>{isSelected ? '▲' : '▼'}</span>
                </div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                  <span>{stats.done}/{stats.total}</span>
                  <span>{teamProgress}%</span>
                </div>
                <div style={{ background: '#f0f0f0', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                  <div style={{ background: teamProgress === 100 ? '#27ae60' : '#3498db', width: `${teamProgress}%`, height: '100%', borderRadius: '4px', transition: 'width 0.3s' }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  { label: 'הושלם', value: stats.done, color: '#27ae60' },
                  { label: 'בביצוע', value: stats.inProgress, color: '#f39c12' },
                  { label: 'פתוח', value: stats.open, color: '#3498db' },
                  { label: 'ממתין', value: stats.waiting, color: '#9b59b6' },
                ].filter(s => s.value > 0).map(s => (
                  <span key={s.label} style={{ background: s.color + '22', color: s.color, padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>
                    {s.value} {s.label}
                  </span>
                ))}
              </div>

              {/* חברי הצוות — סטטוס חיבור */}
              {team.members && team.members.length > 0 && (
                <div style={{ marginTop: '12px', borderTop: '1px solid #f0f0f0', paddingTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {team.members.map((m: any) => {
                    const isOnline = onlineUsers.some(u => u.userId === m.user?.id);
                    return (
                      <div key={m.user?.id} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isOnline ? '#2ecc71' : '#bdc3c7', display: 'inline-block', flexShrink: 0 }} />
                        <span style={{ fontSize: '12px', color: isOnline ? '#1a2332' : '#999', fontWeight: isOnline ? '600' : 'normal' }}>
                          {m.user?.fullName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {isSelected && (
                <div style={{ marginTop: '16px', borderTop: '1px solid #e0e0e0', paddingTop: '12px' }}>
                  <h5 style={{ margin: '0 0 8px', color: '#1a2332', fontSize: '13px' }}>משימות פעילות:</h5>
                  {allTasks.filter(t => t.assignedTeamId === team.id && t.status !== 'DONE' && t.status !== 'WAITING').length === 0 ? (
                    <div style={{ fontSize: '13px', color: '#999' }}>אין משימות פעילות כרגע</div>
                  ) : (
                    allTasks
                      .filter(t => t.assignedTeamId === team.id && t.status !== 'DONE' && t.status !== 'WAITING')
                      .map(task => (
                        <div key={task.id} style={{ background: '#f8f9fa', borderRadius: '6px', padding: '8px 12px', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#1a2332' }}>{task.title}</div>
                            {task.assignedUserName && <div style={{ fontSize: '11px', color: '#666' }}>👤 {task.assignedUserName}</div>}
                            {task.plannedStart && (
                              <div style={{ fontSize: '11px', color: '#e65100' }}>
                                {new Date(task.plannedStart).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                                {task.plannedEnd && ` — ${new Date(task.plannedEnd).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`}
                              </div>
                            )}
                            {task.blockedReason && <div style={{ fontSize: '11px', color: '#e74c3c', marginTop: '2px' }}>סיבה: {task.blockedReason}</div>}
                          </div>
                          <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '8px', fontWeight: 'bold', whiteSpace: 'nowrap',
                            background: task.status === 'IN_PROGRESS' ? '#fff3e0' : task.status === 'BLOCKED' ? '#fee' : '#e8f4fd',
                            color: task.status === 'IN_PROGRESS' ? '#e65100' : task.status === 'BLOCKED' ? '#c0392b' : '#2980b9'
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
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', marginTop: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: '2px solid #e74c3c' }}>
          <h3 style={{ margin: '0 0 16px', color: '#e74c3c' }}>משימות חסומות — דורשות טיפול!</h3>
          {allTasks.filter(t => t.status === 'BLOCKED').map(task => (
            <div key={task.id} style={{ background: '#fee', borderRadius: '8px', padding: '12px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 'bold', color: '#c0392b' }}>{task.title}</div>
                <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>
                  {task.assignedTeam?.name && <span>צוות: {task.assignedTeam.name} | </span>}
                  {task.blockedReason && <span>סיבה: {task.blockedReason}</span>}
                </div>
              </div>
              <span style={{ background: '#e74c3c', color: 'white', padding: '4px 10px', borderRadius: '8px', fontSize: '12px' }}>חסום</span>
            </div>
          ))}
        </div>
      )}
      </>}
    </div>
  );
};
