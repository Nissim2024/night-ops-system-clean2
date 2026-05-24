import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { TeamView } from './TeamView';
import { VersionProgressChain } from './VersionProgressChain';
import { useSocket } from '../hooks/useSocket';
import { playTaskReady } from '../utils/sound';
import { DeployCenterLogo } from './DeployCenterLogo';

const API = 'http://localhost:3000';

interface Props {
  token: string;
  onLogout: () => void;
}

export const EmployeeDashboard: React.FC<Props> = ({ token, onLogout }) => {
  const [myTeam, setMyTeam]         = useState<any>(null);
  const [activeVersion, setActiveVersion] = useState<any>(null);
  const [loading, setLoading]       = useState(true);
  const [alert, setAlert]           = useState<string | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [taskStats, setTaskStats]   = useState({ done: 0, inProgress: 0, open: 0, waiting: 0, blocked: 0, total: 0 });

  const payload  = JSON.parse(atob(token.split('.')[1]));
  const fullName = localStorage.getItem('deploycenter_fullName') || payload.fullName || 'עובד';
  const headers  = { Authorization: `Bearer ${token}` };

  useSocket({
    userId: payload.sub,
    fullName,
    teamId: myTeam?.id,
    onTaskUpdated: (task) => {
      setRefreshKey(k => k + 1);
      if (task?.assignedUserId === payload.sub && task?.status === 'OPEN') {
        playTaskReady();
        setAlert(`🔔 משימה מוכנה להתחלה: ${task.title}`);
        setTimeout(() => setAlert(null), 8000);
      }
    },
    onTaskBlocked: (task) => {
      setAlert(`⚠️ משימה חסומה: ${task.title}`);
      setTimeout(() => setAlert(null), 6000);
    },
    onJoined:      (users) => setOnlineUsers(users.filter((u, i, arr) => arr.findIndex(x => x.userId === u.userId) === i)),
    onUserOnline:  (u) => setOnlineUsers(prev => [...prev.filter(x => x.userId !== u.userId), u]),
    onUserOffline: (u) => setOnlineUsers(prev => prev.filter(x => x.userId !== u.userId)),
  });

  const fetchTaskStats = async (versionId: string) => {
    try {
      // Use version endpoint (returns all phases/tasks, not filtered by team)
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
        const active = versionsRes.data.find((v: any) => ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(v.status));
        setActiveVersion(active || null);
        if (active) fetchTaskStats(active.id);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', fontFamily: 'Arial, sans-serif', direction: 'rtl' }}>

      {/* ─── Header ─── */}
      <div style={{
        background: 'linear-gradient(135deg, #1a2332 0%, #2d4a7a 100%)',
        padding: '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: '64px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <DeployCenterLogo variant="nav" />
          {myTeam && (
            <span style={{ background: 'rgba(255,255,255,0.15)', color: 'white', padding: '5px 14px', borderRadius: '12px', fontSize: '14px' }}>
              👥 {myTeam.name}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {alert && (
            <div style={{
              padding: '8px 16px', background: 'rgba(231,76,60,0.9)',
              color: 'white', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold',
            }}>
              {alert}
            </div>
          )}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            background: 'rgba(255,255,255,0.1)', padding: '6px 12px', borderRadius: '8px',
          }}>
            <span style={{ fontSize: '10px', color: '#2ecc71' }}>●</span>
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.9)' }}>{onlineUsers.length} מחוברים</span>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px' }}>👤 {fullName}</span>
          <button
            onClick={onLogout}
            style={{ padding: '8px 16px', background: 'rgba(231,76,60,0.7)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
          >
            יציאה
          </button>
        </div>
      </div>

      {/* ─── Progress chain (shown when an active version exists) ─── */}
      {activeVersion && (
        <VersionProgressChain versionStatus={activeVersion.status} />
      )}

      {/* ─── Content ─── */}
      <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '80px', color: '#666' }}>
            <div style={{ fontSize: '48px' }}>🌙</div>
            <p style={{ fontSize: '16px', marginTop: '12px' }}>טוען...</p>
          </div>
        ) : myTeam ? (
          <>
            {activeVersion ? (
              <>
                {/* ─── Overall progress graph ─── */}
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
                      { label: 'הושלמו',  value: taskStats.done,       color: '#27ae60' },
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
                <TeamView key={refreshKey} token={token} teamId={myTeam.id} teamName={myTeam.name} versionId={activeVersion.id} userId={payload.sub} userName={fullName} hideAddTask />
              </>
            ) : (
              <div style={{
                textAlign: 'center', padding: '80px', color: '#666',
                background: 'white', borderRadius: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              }}>
                <div style={{ fontSize: '64px' }}>🌙</div>
                <h2 style={{ color: '#1a2332', marginTop: '16px' }}>אין פעילות פעילה הלילה</h2>
                <p style={{ color: '#888' }}>הגרסה עדיין בשלב תכנון. המתן להנחיות מנהל הלילה.</p>
              </div>
            )}
          </>
        ) : (
          <div style={{
            textAlign: 'center', padding: '80px', color: '#666',
            background: 'white', borderRadius: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}>
            <div style={{ fontSize: '64px' }}>👤</div>
            <h2 style={{ color: '#1a2332', marginTop: '16px' }}>לא שויכת לצוות</h2>
            <p style={{ color: '#888' }}>פנה למנהל הלילה כדי להשתייך לצוות</p>
          </div>
        )}
      </div>
    </div>
  );
};
