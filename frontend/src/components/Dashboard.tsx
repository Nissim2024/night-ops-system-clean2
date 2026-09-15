import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { VersionsView } from './VersionsView';
import { TeamView } from './TeamView';
import { WarRoom } from './WarRoom';
import { ImportView } from './ImportView';
import { formatDate } from '../utils/dateFormat';
import { NightSummary } from './NightSummary';
import { DeployCenterLogo } from './DeployCenterLogo';
import { CrReviewView } from './CrReviewView';
import { C, statusColor, statusLabel } from '../theme';
import { cn } from '../lib/utils';

const SummaryVersionPicker: React.FC<{ token: string }> = ({ token }) => {
  const [versions, setVersions] = React.useState<any[]>([]);
  const [selectedId, setSelectedId] = React.useState('');
  const headers = { Authorization: `Bearer ${token}` };

  React.useEffect(() => {
    axios.get(`${API}/versions`, { headers }).then(r => setVersions(r.data));
  }, []);

  const selected = versions.find(v => v.id === selectedId);

  return (
    <div className="font-sans [direction:rtl]">
      {!selectedId ? (
        <div className="max-w-[600px]">
          <h2 className="mb-5 text-foreground">בחר גרסה לסיכום</h2>
          <div className="flex flex-col gap-3">
            {versions.map(v => (
              <div key={v.id} onClick={() => setSelectedId(v.id)}
                className="flex cursor-pointer items-center justify-between rounded-lg bg-card px-5 py-4 shadow-xs"
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.15)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)')}>
                <div>
                  <div className="text-sm font-bold text-foreground">{v.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{formatDate(v.createdAt)}</div>
                </div>
                <span className="rounded-lg bg-foreground px-3 py-1 text-xs text-white">{v.status}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <button onClick={() => setSelectedId('')} className="mb-4 cursor-pointer rounded-md border-none bg-muted px-4 py-2">→ חזור לבחירת גרסה</button>
          <NightSummary token={token} versionId={selectedId} versionName={selected?.name || ''} isRehearsal={selected?.status === 'REHEARSAL'} />
        </div>
      )}
    </div>
  );
};
import { useSocket } from '../hooks/useSocket';
import { usePushNotifications } from '../hooks/usePushNotifications';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'WAITING', 'DONE', 'FAILED', 'ROLLED_BACK'];

const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'נמוך', MEDIUM: 'בינוני', HIGH: 'גבוה',
  CRITICAL: 'קריטי', PRODUCTION_BLOCKER: 'חוסם Production',
};
const PRIORITY_COLORS: Record<string, string> = {
  LOW: C.priorityLow, MEDIUM: C.priorityMedium, HIGH: C.priorityHigh,
  CRITICAL: C.danger, PRODUCTION_BLOCKER: C.statusWaiting,
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

  const push = usePushNotifications(token);

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
    { key: 'cr-review', label: 'סקירת CR' },
    { key: 'import', label: 'ייבוא Excel' },
    { key: 'summary', label: 'סיכום לילה' },
    { key: 'tasks', label: 'משימות' },
    { key: 'teams', label: 'צוותים' },
    { key: 'new-task', label: 'משימה חדשה' },
  ];

  return (
    <div className="min-h-screen bg-background font-sans [direction:rtl]">
      <div
        className="flex h-16 items-center justify-between px-6 shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
        style={{ background: 'linear-gradient(135deg, #1a2332 0%, #2d4a7a 100%)' }}
      >
        {/* Right side: logo + push bell + online + logout — always visible */}
        <div className="flex shrink-0 items-center gap-2">
          <DeployCenterLogo variant="nav" />
          <button
            onClick={push.subscribed ? push.unsubscribe : push.subscribe}
            disabled={push.loading || !push.supported}
            title={!push.supported ? 'דפדפן זה אינו תומך ב-Push (נסה Chrome)' : push.subscribed ? 'בטל התראות Push' : 'הפעל התראות Push'}
            className={cn(
              'rounded-md border-none px-3 py-[7px] text-lg transition-[background] duration-fast',
              push.supported ? 'cursor-pointer' : 'cursor-not-allowed',
              push.subscribed ? 'bg-success/30' : 'bg-white/[0.12]',
              push.supported ? 'text-white' : 'text-white/40'
            )}
          >
            {push.loading ? '⏳' : push.subscribed ? '🔔' : '🔕'}
          </button>
          <div className="flex items-center gap-1 rounded-md bg-white/10 px-3 py-1.5">
            <span className="text-xs text-success">●</span>
            <span className="text-sm text-white/90">{onlineUsers.length} מחוברים</span>
          </div>
          <button onClick={onLogout} className="cursor-pointer rounded-md border-none bg-danger/70 px-4 py-2 text-white">יציאה</button>
        </div>
        {/* Left side: nav items + alerts */}
        <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5 pe-3">
          {lastAlert && (
            <div className="shrink-0 rounded-md bg-danger/90 px-4 py-2 text-sm font-bold text-white">
              {lastAlert}
            </div>
          )}
          {navItems.map(item => (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={cn(
                'cursor-pointer whitespace-nowrap rounded-md border border-white/30 px-4 py-2 text-sm text-white',
                view === item.key ? 'bg-white/25 font-bold' : 'bg-transparent font-normal'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] p-6">
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
            : <div className="p-20 text-center text-muted-foreground">
                <div className="mb-4 text-5xl">🌙</div>
                <div className="mb-2 text-lg font-bold">אין לילה פעיל כרגע</div>
                <div className="text-sm">הפעל גרסה (או חזרה גנרלית) ממסך "גרסאות"</div>
              </div>
        )}
        {view === 'cr-review' && <CrReviewView token={token} />}
        {view === 'import' && <ImportView token={token} onImportSuccess={() => setView('versions')} />}
         {view === 'summary' && (
          <SummaryVersionPicker token={token} />
        )}
        {view === 'team-view' && <TeamView token={token} teamId="a44d973d-a8aa-463e-9fce-5f1fe5cc8488" teamName="QA Team" onTaskUpdated={fetchData} />}

        {view === 'tasks' && (
          <div>
            <div className="mb-6 flex flex-wrap gap-3">
              {TASK_STATUSES.map((status) => (
                <div key={status} className="min-w-[100px] flex-1 rounded-lg bg-card px-5 py-4 text-center shadow-xs" style={{ borderTop: `4px solid ${statusColor(status)}` }}>
                  <div className="text-3xl font-bold" style={{ color: statusColor(status) }}>{statusCounts[status] || 0}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{statusLabel(status)}</div>
                </div>
              ))}
            </div>
            <h2 className="mb-4 text-foreground">כל המשימות ({tasks.length})</h2>
            {loading ? <div className="p-16 text-center">טוען...</div> :
              <div className="flex flex-col gap-3">
                {tasks.map(task => (
                  <div key={task.id} className="flex items-center justify-between gap-4 rounded-lg bg-card p-5 shadow-xs" style={{ borderRight: `5px solid ${statusColor(task.status)}` }}>
                    <div className="flex-1">
                      <div className="mb-1.5 text-sm font-bold text-foreground">{task.title}</div>
                      <div className="flex gap-3 text-sm text-muted-foreground">
                        {task.assignedTeam && <span>צוות: {task.assignedTeam.name}</span>}
                        <span style={{ color: PRIORITY_COLORS[task.priority] }}>{PRIORITY_LABELS[task.priority]}</span>
                      </div>
                    </div>
                    <select value={task.status} onChange={e => updateStatus(task.id, e.target.value)} className="rounded-md border border-border px-2.5 py-1.5 text-sm">
                      {TASK_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            }
          </div>
        )}

        {view === 'teams' && (
          <div>
            <h2 className="mb-4 text-foreground">צוותים ({teams.length})</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
              {teams.map(team => (
                <div key={team.id} className="rounded-lg border-t-4 border-t-[#2d4a7a] bg-card p-6 shadow-xs">
                  <h3 className="m-0 mb-3 text-foreground">{team.name}</h3>
                  <div className="text-sm text-muted-foreground">{team.members.length} חברים | {team._count.tasks} משימות</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === 'new-task' && (
          <div className="max-w-[600px]">
            <h2 className="mb-4 text-foreground">משימה חדשה</h2>
            <div className="rounded-lg bg-card p-8 shadow-xs">
              <form onSubmit={createTask}>
                <div className="mb-4">
                  <label className="mb-1.5 block font-bold">כותרת *</label>
                  <input type="text" required value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} className="box-border w-full rounded-md border-2 border-neutral-300 p-2.5 text-sm" />
                </div>
                <div className="mb-4">
                  <label className="mb-1.5 block font-bold">CR Number</label>
                  <input type="text" value={newTask.crNumber} onChange={e => setNewTask({ ...newTask, crNumber: e.target.value })} className="box-border w-full rounded-md border-2 border-neutral-300 p-2.5 text-sm" />
                </div>
                <div className="mb-4">
                  <label className="mb-1.5 block font-bold">Application</label>
                  <select value={newTask.application} onChange={e => setNewTask({ ...newTask, application: e.target.value })} className="w-full rounded-md border-2 border-neutral-300 p-2.5 text-sm">
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
                <div className="mb-4">
                  <label className="mb-1.5 block font-bold">עדיפות</label>
                  <select value={newTask.priority} onChange={e => setNewTask({ ...newTask, priority: e.target.value })} className="w-full rounded-md border-2 border-neutral-300 p-2.5 text-sm">
                    <option value="LOW">נמוך</option>
                    <option value="MEDIUM">בינוני</option>
                    <option value="HIGH">גבוה</option>
                    <option value="CRITICAL">קריטי</option>
                    <option value="PRODUCTION_BLOCKER">חוסם Production</option>
                  </select>
                </div>
                <div className="mb-6">
                  <label className="mb-1.5 block font-bold">צוות</label>
                  <select value={newTask.assignedTeamId} onChange={e => setNewTask({ ...newTask, assignedTeamId: e.target.value })} className="w-full rounded-md border-2 border-neutral-300 p-2.5 text-sm">
                    <option value="">בחר צוות</option>
                    {teams.filter((team: any) => team.active).map((team: any) => <option key={team.id} value={team.id}>{team.name}</option>)}
                  </select>
                </div>
                <button type="submit" className="w-full cursor-pointer rounded-md border-none bg-foreground p-3.5 text-sm font-bold text-white">צור משימה</button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};