import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API = 'http://localhost:3000';

const STATUS_COLORS: Record<string, string> = {
  WAITING: '#9b59b6', OPEN: '#3498db', IN_PROGRESS: '#f39c12',
  BLOCKED: '#e74c3c', DONE: '#27ae60', FAILED: '#c0392b', ROLLED_BACK: '#7f8c8d',
};
const STATUS_LABELS: Record<string, string> = {
  WAITING: 'ממתין', OPEN: 'פתוח', IN_PROGRESS: 'בביצוע',
  BLOCKED: 'חסום', DONE: 'הושלם', FAILED: 'נכשל', ROLLED_BACK: 'Rollback',
};

interface Props {
  token: string;
  teamId: string;
  teamName: string;
  onTaskUpdated?: () => void;
}

export const TeamView: React.FC<Props> = ({ token, teamId, teamName, onTaskUpdated }) => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState('');
  const [showBlockedInput, setShowBlockedInput] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/tasks`, { headers });
      const allTasks = res.data.filter((t: any) => t.assignedTeam?.id === teamId || t.assignedTeamId === teamId);
      setTasks(allTasks);
      return;
      
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchTasks(); }, [teamId]);

  const updateStatus = async (taskId: string, status: string, reason?: string) => {
    setUpdatingId(taskId);
    try {
      await axios.patch(`${API}/tasks/${taskId}/status`, { status }, { headers });
      if (reason) {
        await axios.patch(`${API}/tasks/${taskId}`, { blockedReason: reason }, { headers });
      }
      setShowBlockedInput(null);
      setBlockedReason('');
      fetchTasks();
      onTaskUpdated?.();
    } catch (err) { console.error(err); }
    finally { setUpdatingId(null); }
  };

  const statusCounts = tasks.reduce((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const openTasks = tasks.filter(t => t.status === 'OPEN' || t.status === 'IN_PROGRESS');
  const waitingTasks = tasks.filter(t => t.status === 'WAITING');
  const doneTasks = tasks.filter(t => t.status === 'DONE');
  const blockedTasks = tasks.filter(t => t.status === 'BLOCKED' || t.status === 'FAILED');

  return (
    <div style={{ direction: 'rtl', fontFamily: 'Arial' }}>
      {/* כותרת */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <h2 style={{ margin: '0 0 12px', color: '#1a2332' }}>👥 {teamName} — תצוגת צוות</h2>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {Object.entries(STATUS_LABELS).map(([status, label]) => (
            <div key={status} style={{ background: STATUS_COLORS[status] + '22', border: `2px solid ${STATUS_COLORS[status]}`, borderRadius: '8px', padding: '8px 16px', textAlign: 'center', minWidth: '80px' }}>
              <div style={{ fontSize: '22px', fontWeight: 'bold', color: STATUS_COLORS[status] }}>{statusCounts[status] || 0}</div>
              <div style={{ fontSize: '11px', color: '#666' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>טוען...</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* משימות פתוחות ובביצוע */}
          {openTasks.length > 0 && (
            <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
              <h3 style={{ margin: '0 0 16px', color: '#1a2332', fontSize: '16px' }}>🟢 פעיל עכשיו ({openTasks.length})</h3>
              {openTasks.map(task => (
                <div key={task.id} style={{ border: `2px solid ${STATUS_COLORS[task.status]}`, borderRadius: '10px', padding: '16px', marginBottom: '12px', background: STATUS_COLORS[task.status] + '11' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', fontSize: '15px', color: '#1a2332', marginBottom: '6px' }}>{task.title}</div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '12px' }}>
                        {task.crNumber && <span style={{ background: '#e8f4fd', color: '#2980b9', padding: '2px 8px', borderRadius: '4px' }}>{task.crNumber}</span>}
                        {task.application && <span style={{ background: '#f0f0f0', color: '#555', padding: '2px 8px', borderRadius: '4px' }}>{task.application}</span>}
                        {task.assignedUserName && <span style={{ color: '#666' }}>👤 {task.assignedUserName}</span>}
                        {task.plannedStart && task.plannedEnd && (
                          <span style={{ background: '#fff3e0', color: '#e65100', padding: '2px 8px', borderRadius: '4px' }}>
                            ⏰ {task.plannedStart.slice(11,16)} — {task.plannedEnd.slice(11,16)}
                          </span>
                        )}
                      </div>
                      {task.notes && <div style={{ marginTop: '8px', fontSize: '13px', color: '#666', fontStyle: 'italic' }}>📝 {task.notes}</div>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '120px' }}>
                      <span style={{ background: STATUS_COLORS[task.status], color: 'white', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold', textAlign: 'center' }}>
                        {STATUS_LABELS[task.status]}
                      </span>
                      {task.status === 'OPEN' && (
                        <button onClick={() => updateStatus(task.id, 'IN_PROGRESS')} disabled={updatingId === task.id} style={{ padding: '8px', background: '#f39c12', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
                          ▶ התחל
                        </button>
                      )}
                      {task.status === 'IN_PROGRESS' && (
                        <button onClick={() => updateStatus(task.id, 'DONE')} disabled={updatingId === task.id} style={{ padding: '8px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
                          ✅ סיים
                        </button>
                      )}
                      <button onClick={() => setShowBlockedInput(task.id)} style={{ padding: '8px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px' }}>
                        🚫 חסום
                      </button>
                    </div>
                  </div>
                  {showBlockedInput === task.id && (
                    <div style={{ marginTop: '12px', padding: '12px', background: '#fee', borderRadius: '8px', border: '1px solid #fcc' }}>
                      <input placeholder="סיבת החסימה *" value={blockedReason} onChange={e => setBlockedReason(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', marginBottom: '8px', boxSizing: 'border-box' }} />
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => updateStatus(task.id, 'BLOCKED', blockedReason)} disabled={!blockedReason} style={{ padding: '6px 16px', background: blockedReason ? '#e74c3c' : '#ccc', color: 'white', border: 'none', borderRadius: '6px', cursor: blockedReason ? 'pointer' : 'not-allowed', fontSize: '13px' }}>דווח חסימה</button>
                        <button onClick={() => setShowBlockedInput(null)} style={{ padding: '6px 16px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>ביטול</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ממתינות */}
          {waitingTasks.length > 0 && (
            <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
              <h3 style={{ margin: '0 0 16px', color: '#9b59b6', fontSize: '16px' }}>⏳ ממתין לביצוע ({waitingTasks.length})</h3>
              {waitingTasks.map(task => (
                <div key={task.id} style={{ background: '#f8f0ff', borderRadius: '8px', padding: '12px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 'bold', color: '#444', fontSize: '14px' }}>{task.title}</div>
                    {task.assignedUserName && <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>👤 {task.assignedUserName}</div>}
                  </div>
                  <span style={{ fontSize: '12px', color: '#9b59b6', fontWeight: 'bold' }}>ממתין לתלות</span>
                </div>
              ))}
            </div>
          )}

          {/* חסומות */}
          {blockedTasks.length > 0 && (
            <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: '2px solid #e74c3c' }}>
              <h3 style={{ margin: '0 0 16px', color: '#e74c3c', fontSize: '16px' }}>🚫 חסומות ({blockedTasks.length})</h3>
              {blockedTasks.map(task => (
                <div key={task.id} style={{ background: '#fee', borderRadius: '8px', padding: '12px', marginBottom: '8px' }}>
                  <div style={{ fontWeight: 'bold', color: '#c0392b', fontSize: '14px' }}>{task.title}</div>
                  {task.blockedReason && <div style={{ fontSize: '13px', color: '#e74c3c', marginTop: '4px' }}>סיבה: {task.blockedReason}</div>}
                  <button onClick={() => updateStatus(task.id, 'IN_PROGRESS')} style={{ marginTop: '8px', padding: '6px 14px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
                    ♻️ חזור לביצוע
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* הושלמו */}
          {doneTasks.length > 0 && (
            <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
              <h3 style={{ margin: '0 0 16px', color: '#27ae60', fontSize: '16px' }}>✅ הושלמו ({doneTasks.length})</h3>
              {doneTasks.map(task => (
                <div key={task.id} style={{ background: '#f0fff4', borderRadius: '8px', padding: '10px 14px', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#27ae60', fontSize: '14px' }}>✓ {task.title}</span>
                  {task.completedAt && <span style={{ fontSize: '12px', color: '#666' }}>{task.completedAt.slice(11,16)}</span>}
                </div>
              ))}
            </div>
          )}

          {tasks.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px', color: '#666', background: 'white', borderRadius: '12px' }}>
              <div style={{ fontSize: '48px' }}>📭</div>
              <p>אין משימות לצוות זה</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};