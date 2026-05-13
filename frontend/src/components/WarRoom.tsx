import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API = 'http://localhost:3000';

interface Props {
  token: string;
  versionId: string;
  versionName: string;
}

export const WarRoom: React.FC<Props> = ({ token, versionId, versionName }) => {
  const [version, setVersion] = useState<any>(null);
  const [allTasks, setAllTasks] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [goStatus, setGoStatus] = useState<'checking' | 'go' | 'nogo' | null>(null);
  const [goDetails, setGoDetails] = useState<{ incomplete: number; blocked: number } | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [versionRes, tasksRes, teamsRes] = await Promise.all([
        axios.get(`${API}/versions/${versionId}`, { headers }),
        axios.get(`${API}/tasks`, { headers }),
        axios.get(`${API}/teams`, { headers }),
      ]);
      setVersion(versionRes.data);
      setAllTasks(tasksRes.data);
      setTeams(teamsRes.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [versionId]);

  const checkGoNoGo = async () => {
    setGoStatus('checking');
    try {
      const res = await axios.get(`${API}/tasks`, { headers });
      const freshTasks = res.data;
      const blockedCount = freshTasks.filter((t: any) => t.status === 'BLOCKED' || t.status === 'FAILED').length;
      const incompleteCount = freshTasks.filter((t: any) => t.status !== 'DONE' && t.status !== 'WAITING').length;
      setGoDetails({ incomplete: incompleteCount, blocked: blockedCount });
      setTimeout(() => {
        if (blockedCount > 0 || incompleteCount > 0) {
          setGoStatus('nogo');
        } else {
          setGoStatus('go');
        }
      }, 1500);
    } catch (err) {
      console.error(err);
      setGoStatus(null);
    }
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

  if (loading) return <div style={{ textAlign: 'center', padding: '60px', color: '#666' }}>טוען War Room...</div>;

  return (
    <div style={{ direction: 'rtl', fontFamily: 'Arial' }}>

      {/* כותרת */}
      <div style={{ background: 'linear-gradient(135deg, #1a2332 0%, #2d4a7a 100%)', borderRadius: '12px', padding: '24px', marginBottom: '20px', color: 'white' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '24px' }}>War Room — {versionName}</h2>
            <p style={{ margin: 0, opacity: 0.8, fontSize: '14px' }}>מבט-על בזמן אמת</p>
          </div>
          <button onClick={fetchData} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
            רענן
          </button>
        </div>

        {/* Progress Bar */}
        <div style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
            <span>התקדמות כללית</span>
            <span>{doneTasks}/{totalTasks} משימות ({progressPercent}%)</span>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: '8px', height: '12px', overflow: 'hidden' }}>
            <div style={{ background: progressPercent === 100 ? '#27ae60' : '#3498db', width: `${progressPercent}%`, height: '100%', borderRadius: '8px', transition: 'width 0.5s ease' }} />
          </div>
        </div>

        {/* סטטיסטיקות */}
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

      {/* GO/NO GO */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <h3 style={{ margin: '0 0 16px', color: '#1a2332' }}>GO / NO GO</h3>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={checkGoNoGo} style={{ padding: '12px 24px', background: '#1a2332', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
            בדוק GO/NO GO
          </button>
          {goStatus === 'checking' && <span style={{ color: '#f39c12', fontWeight: 'bold' }}>בודק תנאים...</span>}
          {goStatus === 'go' && (
            <div style={{ background: '#d5f0dc', border: '2px solid #27ae60', borderRadius: '8px', padding: '12px 24px' }}>
              <span style={{ color: '#27ae60', fontWeight: 'bold', fontSize: '18px' }}>GO! — ניתן להמשיך</span>
            </div>
          )}
          {goStatus === 'nogo' && (
            <div style={{ background: '#fee', border: '2px solid #e74c3c', borderRadius: '8px', padding: '12px 24px' }}>
              <span style={{ color: '#e74c3c', fontWeight: 'bold', fontSize: '18px' }}>NO GO — לא כל המשימות הושלמו</span>
              {goDetails && (
                <div style={{ fontSize: '13px', color: '#e74c3c', marginTop: '8px' }}>
                  {goDetails.incomplete > 0 && <div>{goDetails.incomplete} משימות עדיין פתוחות</div>}
                  {goDetails.blocked > 0 && <div>{goDetails.blocked} משימות חסומות</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* כרטיסיות צוותים */}
      <h3 style={{ color: '#1a2332', marginBottom: '16px' }}>סטטוס צוותים — לחץ על צוות לפרטים</h3>
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
                <h4 style={{ margin: 0, color: '#1a2332' }}>{team.name}</h4>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {stats.blocked > 0 && <span style={{ background: '#fee', color: '#e74c3c', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>{stats.blocked} חסום</span>}
                  <span style={{ fontSize: '16px' }}>{isSelected ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Progress */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                  <span>{stats.done}/{stats.total}</span>
                  <span>{teamProgress}%</span>
                </div>
                <div style={{ background: '#f0f0f0', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                  <div style={{ background: teamProgress === 100 ? '#27ae60' : '#3498db', width: `${teamProgress}%`, height: '100%', borderRadius: '4px', transition: 'width 0.3s' }} />
                </div>
              </div>

              {/* Stats */}
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

              {/* פרטי משימות כשנבחר */}
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
                            {task.plannedStart && task.plannedEnd && (
                              <div style={{ fontSize: '11px', color: '#e65100' }}>
                                {task.plannedStart.slice(11, 16)} — {task.plannedEnd.slice(11, 16)}
                              </div>
                            )}
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
    </div>
  );
};