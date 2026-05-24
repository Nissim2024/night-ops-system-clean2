import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { VersionsView } from './VersionsView';
import { TeamView } from './TeamView';
import { WarRoom } from './WarRoom';
import { ImportView } from './ImportView';
import { NightSummary } from './NightSummary';
import { DeployCenterLogo } from './DeployCenterLogo';const SummaryVersionPicker: React.FC<{ token: string }> = ({ token }) => {
  const [versions, setVersions] = React.useState<any[]>([]);
  const [selectedId, setSelectedId] = React.useState('');
  const headers = { Authorization: `Bearer ${token}` };

  React.useEffect(() => {
    axios.get(`${API}/versions`, { headers }).then(r => setVersions(r.data));
  }, []);

  const selected = versions.find(v => v.id === selectedId);

  return (
    <div style={{ direction: 'rtl', fontFamily: 'Arial' }}>
      {!selectedId ? (
        <div style={{ maxWidth: '600px' }}>
          <h2 style={{ color: '#1a2332', marginBottom: '20px' }}>בחר גרסה לסיכום</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {versions.map(v => (
              <div key={v.id} onClick={() => setSelectedId(v.id)}
                style={{ background: 'white', borderRadius: '12px', padding: '16px 20px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.15)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)')}>
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#1a2332' }}>{v.name}</div>
                  <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>{new Date(v.createdAt).toLocaleDateString('he-IL')}</div>
                </div>
                <span style={{ background: '#1a2332', color: 'white', padding: '4px 12px', borderRadius: '12px', fontSize: '12px' }}>{v.status}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <button onClick={() => setSelectedId('')} style={{ marginBottom: '16px', padding: '8px 16px', background: '#f0f0f0', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>→ חזור לבחירת גרסה</button>
          <NightSummary token={token} versionId={selectedId} versionName={selected?.name || ''} isRehearsal={selected?.status === 'REHEARSAL'} />
        </div>
      )}
    </div>
  );
};
import { useSocket } from '../hooks/useSocket';

const API = 'http://localhost:3000';

const STATUS_COLORS: Record<string, string> = {
  OPEN: '#3498db', IN_PROGRESS: '#f39c12', BLOCKED: '#e74c3c',
  WAITING: '#9b59b6', DONE: '#27ae60', FAILED: '#c0392b', ROLLED_BACK: '#7f8c8d',
};
const STATUS_LABELS: Record<string, string> = {
  OPEN: 'פתוח', IN_PROGRESS: 'בביצוע', BLOCKED: 'חסום',
  WAITING: 'ממתין', DONE: 'הושלם', FAILED: 'נכשל', ROLLED_BACK: 'Rollback',
};
const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'נמוך', MEDIUM: 'בינוני', HIGH: 'גבוה',
  CRITICAL: 'קריטי', PRODUCTION_BLOCKER: 'חוסם Production',
};
const PRIORITY_COLORS: Record<string, string> = {
  LOW: '#95a5a6', MEDIUM: '#3498db', HIGH: '#e67e22',
  CRITICAL: '#e74c3c', PRODUCTION_BLOCKER: '#8e44ad',
};

interface Props {
  token: string;
  onLogout: () => void;
}

export const Dashboard: React.FC<Props> = ({ token, onLogout }) => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [view, setView] = useState<string>('versions');
  const [loading, setLoading] = useState(true);
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [lastAlert, setLastAlert] = useState<string | null>(null);
  const [activeVersion, setActiveVersion] = useState<{ id: string; name: string; status: string } | null>(null);
  const [newTask, setNewTask] = useState({
    title: '', description: '', crNumber: '',
    application: '', priority: 'MEDIUM', assignedTeamId: '',
  });

  const headers = { Authorization: `Bearer ${token}` };
  const tokenPayload = JSON.parse(atob(token.split('.')[1]));

  useSocket({
    userId: tokenPayload.sub,
    fullName: tokenPayload.fullName || 'משתמש',
    onTaskUpdated: () => { fetchData(); },
    onTaskBlocked: (task) => {
      setLastAlert(`חסום: ${task.title}`);
      setTimeout(() => setLastAlert(null), 5000);
    },
    onGoDecision: (decision) => {
      setLastAlert(decision.go ? `GO! ${decision.message}` : `NO GO! ${decision.message}`);
    },
    onJoined:      (users) => setOnlineUsers(users.filter((u, i, arr) => arr.findIndex(x => x.userId === u.userId) === i)),
    onUserOnline: (user) => {
      setOnlineUsers(prev => [...prev.filter(u => u.userId !== user.userId), user]);
    },
    onUserOffline: (user) => {
      setOnlineUsers(prev => prev.filter(u => u.userId !== user.userId));
    },
  });

  const fetchActiveVersion = async () => {
    try {
      const res = await axios.get(`${API}/versions`, { headers });
      const found = res.data.find((v: any) => v.status === 'ACTIVE' || v.status === 'REHEARSAL');
      setActiveVersion(found ? { id: found.id, name: found.name, status: found.status } : null);
    } catch { /* ignore */ }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [tasksRes, teamsRes] = await Promise.all([
        axios.get(`${API}/tasks`, { headers }),
        axios.get(`${API}/teams`, { headers }),
      ]);
      setTasks(tasksRes.data);
      setTeams(teamsRes.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); fetchActiveVersion(); }, []);

  const updateStatus = async (taskId: string, status: string) => {
    try {
      await axios.patch(`${API}/tasks/${taskId}/status`, { status }, { headers });
      fetchData();
    } catch (err) { console.error(err); }
  };

  const createTask = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/tasks`, newTask, { headers });
      setNewTask({ title: '', description: '', crNumber: '', application: '', priority: 'MEDIUM', assignedTeamId: '' });
      setView('tasks');
      fetchData();
    } catch (err) { console.error(err); }
  };

  const statusCounts = tasks.reduce((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const navItems = [
    { key: 'versions', label: 'גרסאות' },
    { key: 'war-room', label: 'War Room' },
    { key: 'team-view', label: 'תצוגת צוות' },
    { key: 'import', label: 'ייבוא Excel' },
    { key: 'summary', label: 'סיכום לילה' },
    { key: 'tasks', label: 'משימות' },
    { key: 'teams', label: 'צוותים' },
    { key: 'new-task', label: 'משימה חדשה' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', fontFamily: 'Arial, sans-serif', direction: 'rtl' }}>
      <div style={{ background: 'linear-gradient(135deg, #1a2332 0%, #2d4a7a 100%)', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '64px', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
        <DeployCenterLogo variant="nav" />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {navItems.map(item => (
            <button key={item.key} onClick={() => setView(item.key)} style={{ padding: '8px 16px', background: view === item.key ? 'rgba(255,255,255,0.25)' : 'transparent', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '8px', cursor: 'pointer', fontWeight: view === item.key ? 'bold' : 'normal', fontSize: '14px' }}>
              {item.label}
            </button>
          ))}
          {lastAlert && (
            <div style={{ padding: '8px 16px', background: 'rgba(231,76,60,0.9)', color: 'white', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }}>
              {lastAlert}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', background: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}>
            <span style={{ fontSize: '10px', color: '#2ecc71' }}>●</span>
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.9)' }}>{onlineUsers.length} מחוברים</span>
          </div>
          <button onClick={onLogout} style={{ padding: '8px 16px', background: 'rgba(231,76,60,0.7)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>יציאה</button>
        </div>
      </div>

      <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
        {view === 'versions' && (
          <VersionsView
            token={token}
            onGoLive={(versionId, versionName, isRehearsal) => {
              setActiveVersion({ id: versionId, name: versionName, status: isRehearsal ? 'REHEARSAL' : 'ACTIVE' });
              setView('war-room');
            }}
          />
        )}
        {view === 'war-room' && (
          activeVersion
            ? <WarRoom token={token} versionId={activeVersion.id} versionName={activeVersion.name} isRehearsal={activeVersion.status === 'REHEARSAL'} onlineUsers={onlineUsers} onVersionEnded={fetchActiveVersion} />
            : <div style={{ textAlign: 'center', padding: '80px', color: '#666' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🌙</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>אין לילה פעיל כרגע</div>
                <div style={{ fontSize: '14px' }}>הפעל גרסה (או חזרה גנרלית) ממסך "גרסאות"</div>
              </div>
        )}
        {view === 'import' && <ImportView token={token} onImportSuccess={() => setView('versions')} />}
         {view === 'summary' && (
          <SummaryVersionPicker token={token} />
        )}
        {view === 'team-view' && <TeamView token={token} teamId="a44d973d-a8aa-463e-9fce-5f1fe5cc8488" teamName="QA Team" onTaskUpdated={fetchData} />}

        {view === 'tasks' && (
          <div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
              {Object.entries(STATUS_LABELS).map(([status, label]) => (
                <div key={status} style={{ background: 'white', borderRadius: '12px', padding: '16px 20px', flex: '1', minWidth: '100px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', borderTop: `4px solid ${STATUS_COLORS[status]}`, textAlign: 'center' }}>
                  <div style={{ fontSize: '28px', fontWeight: 'bold', color: STATUS_COLORS[status] }}>{statusCounts[status] || 0}</div>
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>{label}</div>
                </div>
              ))}
            </div>
            <h2 style={{ color: '#1a2332', marginBottom: '16px' }}>כל המשימות ({tasks.length})</h2>
            {loading ? <div style={{ textAlign: 'center', padding: '60px' }}>טוען...</div> :
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {tasks.map(task => (
                  <div key={task.id} style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', borderRight: `5px solid ${STATUS_COLORS[task.status]}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#1a2332', marginBottom: '6px' }}>{task.title}</div>
                      <div style={{ display: 'flex', gap: '12px', fontSize: '13px', color: '#666' }}>
                        {task.assignedTeam && <span>צוות: {task.assignedTeam.name}</span>}
                        <span style={{ color: PRIORITY_COLORS[task.priority] }}>{PRIORITY_LABELS[task.priority]}</span>
                      </div>
                    </div>
                    <select value={task.status} onChange={e => updateStatus(task.id, e.target.value)} style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '13px' }}>
                      {Object.entries(STATUS_LABELS).map(([s, l]) => <option key={s} value={s}>{l}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            }
          </div>
        )}

        {view === 'teams' && (
          <div>
            <h2 style={{ color: '#1a2332', marginBottom: '16px' }}>צוותים ({teams.length})</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
              {teams.map(team => (
                <div key={team.id} style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', borderTop: '4px solid #2d4a7a' }}>
                  <h3 style={{ margin: '0 0 12px', color: '#1a2332' }}>{team.name}</h3>
                  <div style={{ color: '#666', fontSize: '14px' }}>{team.members.length} חברים | {team._count.tasks} משימות</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === 'new-task' && (
          <div style={{ maxWidth: '600px' }}>
            <h2 style={{ color: '#1a2332', marginBottom: '16px' }}>משימה חדשה</h2>
            <div style={{ background: 'white', borderRadius: '12px', padding: '32px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
              <form onSubmit={createTask}>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>כותרת *</label>
                  <input type="text" required value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>CR Number</label>
                  <input type="text" value={newTask.crNumber} onChange={e => setNewTask({ ...newTask, crNumber: e.target.value })} style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>Application</label>
                  <select value={newTask.application} onChange={e => setNewTask({ ...newTask, application: e.target.value })} style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px' }}>
                    <option value="">בחר Application</option>
                    <option value="WIZ">WIZ</option>
                    <option value="CRM">CRM</option>
                    <option value="EAI">EAI</option>
                    <option value="OSB">OSB</option>
                    <option value="DP">DP</option>
                    <option value="NC">NC</option>
                    <option value="ERP">ERP</option>
                    <option value="ETL">ETL</option>
                    <option value="OTHER">אחר</option>
                  </select>
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>עדיפות</label>
                  <select value={newTask.priority} onChange={e => setNewTask({ ...newTask, priority: e.target.value })} style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px' }}>
                    <option value="LOW">נמוך</option>
                    <option value="MEDIUM">בינוני</option>
                    <option value="HIGH">גבוה</option>
                    <option value="CRITICAL">קריטי</option>
                    <option value="PRODUCTION_BLOCKER">חוסם Production</option>
                  </select>
                </div>
                <div style={{ marginBottom: '24px' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>צוות</label>
                  <select value={newTask.assignedTeamId} onChange={e => setNewTask({ ...newTask, assignedTeamId: e.target.value })} style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px' }}>
                    <option value="">בחר צוות</option>
                    {teams.filter((team: any) => team.active).map((team: any) => <option key={team.id} value={team.id}>{team.name}</option>)}
                  </select>
                </div>
                <button type="submit" style={{ width: '100%', padding: '14px', background: '#1a2332', color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>צור משימה</button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};