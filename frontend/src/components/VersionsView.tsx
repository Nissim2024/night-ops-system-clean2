import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API = 'http://localhost:3000';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#95a5a6', COLLECTING: '#3498db', REFINING: '#e67e22',
  REVIEW: '#9b59b6', APPROVED: '#27ae60', ACTIVE: '#e74c3c',
  COMPLETED: '#1a5c2a', ROLLED_BACK: '#7f8c8d',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'טיוטה', COLLECTING: 'איסוף משימות', REFINING: 'טיוב תלויות',
  REVIEW: 'ישיבת מעבר', APPROVED: 'מאושר', ACTIVE: 'פעיל',
  COMPLETED: 'הושלם', ROLLED_BACK: 'Rollback',
};

const NEXT_STATUS: Record<string, string> = {
  DRAFT: 'COLLECTING', COLLECTING: 'REFINING', REFINING: 'REVIEW',
  REVIEW: 'APPROVED', APPROVED: 'ACTIVE', ACTIVE: 'COMPLETED',
};

const NEXT_LABEL: Record<string, string> = {
  DRAFT: 'פתח לאיסוף משימות', COLLECTING: 'עבור לטיוב',
  REFINING: 'פתח ישיבת מעבר', REVIEW: 'אשר תוכנית',
  APPROVED: 'הפעל לילה', ACTIVE: 'סיים לילה',
};

const APPS = ['WIZ', 'CRM', 'EAI', 'OSB', 'DP', 'NC', 'ERP', 'ETL', 'OTHER'];

interface Version {
  id: string;
  name: string;
  description: string;
  status: string;
  plannedStart: string;
  createdAt: string;
  creator: { fullName: string };
}

interface Props {
  token: string;
}

export const VersionsView: React.FC<Props> = ({ token }) => {
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newVersion, setNewVersion] = useState({ name: '', description: '', plannedStart: '' });
  const [creating, setCreating] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchVersions = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/versions`, { headers });
      setVersions(res.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchVersion = async (id: string) => {
    try {
      const res = await axios.get(`${API}/versions/${id}`, { headers });
      setSelected(res.data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchVersions(); }, []);

  const createVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await axios.post(`${API}/versions`, newVersion, { headers });
      const versionId = res.data.id;
      setShowNew(false);
      setNewVersion({ name: '', description: '', plannedStart: '' });
      await fetchVersions();
      await fetchVersion(versionId);
    } catch (err) { console.error(err); }
    finally { setCreating(false); }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await axios.patch(`${API}/versions/${id}/status`, { status }, { headers });
      await fetchVersions();
      await fetchVersion(id);
    } catch (err) { console.error(err); }
  };

  if (selected) {
    return (
      <VersionDetail
        version={selected}
        token={token}
        onBack={() => { setSelected(null); fetchVersions(); }}
        onRefresh={() => fetchVersion(selected.id)}
        onStatusChange={(status) => updateStatus(selected.id, status)}
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ color: '#1a2332', margin: 0 }}>גרסאות ({versions.length})</h2>
        <button onClick={() => setShowNew(true)} style={{ padding: '10px 20px', background: '#1a2332', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
          + גרסה חדשה
        </button>
      </div>

      {showNew && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '24px', marginBottom: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', border: '2px solid #1a2332' }}>
          <h3 style={{ margin: '0 0 20px', color: '#1a2332' }}>יצירת גרסה חדשה</h3>
          <form onSubmit={createVersion}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: '#333', fontSize: '14px' }}>שם גרסה *</label>
                <input required value={newVersion.name} onChange={e => setNewVersion({ ...newVersion, name: e.target.value })} placeholder="לדוגמה: ITv04-2026" style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: '#333', fontSize: '14px' }}>תאריך מתוכנן</label>
                <input type="datetime-local" value={newVersion.plannedStart} onChange={e => setNewVersion({ ...newVersion, plannedStart: e.target.value })} style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: '#333', fontSize: '14px' }}>תיאור</label>
                <input value={newVersion.description} onChange={e => setNewVersion({ ...newVersion, description: e.target.value })} placeholder="תיאור קצר" style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <button type="submit" disabled={creating} style={{ padding: '10px 24px', background: creating ? '#999' : '#27ae60', color: 'white', border: 'none', borderRadius: '8px', cursor: creating ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>
                {creating ? 'יוצר...' : 'צור גרסה ריקה'}
              </button>
              <button type="button" onClick={() => setShowNew(false)} style={{ padding: '10px 24px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>ביטול</button>
              <span style={{ fontSize: '12px', color: '#999' }}>לאחר היצירה — ייבא תוכנית מ-Excel או הוסף שלבים ידנית</span>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#666' }}>טוען...</div>
      ) : versions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#666' }}>
          <div style={{ fontSize: '48px' }}>📋</div>
          <p>אין גרסאות עדיין — צור את הראשונה!</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {versions.map(v => (
            <div
              key={v.id}
              onClick={() => fetchVersion(v.id)}
              style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', borderRight: `5px solid ${STATUS_COLORS[v.status]}`, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.15)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)')}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 'bold', fontSize: '18px', color: '#1a2332' }}>{v.name}</span>
                  <span style={{ background: STATUS_COLORS[v.status], color: 'white', padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>{STATUS_LABELS[v.status]}</span>
                </div>
                <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: '#666' }}>
                  {v.description && <span>{v.description}</span>}
                  {v.plannedStart && <span>📅 {new Date(v.plannedStart).toLocaleDateString('he-IL')}</span>}
                  <span>👤 {v.creator?.fullName}</span>
                  <span>🗓 {new Date(v.createdAt).toLocaleDateString('he-IL')}</span>
                </div>
              </div>
              <span style={{ color: '#999', fontSize: '20px' }}>←</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const VersionDetail: React.FC<{ version: any; token: string; onBack: () => void; onRefresh: () => void; onStatusChange: (s: string) => void }> = ({ version, token, onBack, onRefresh, onStatusChange }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [addingTask, setAddingTask] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<any | null>(null);
  const [newTask, setNewTask] = useState<any>({ title: '', assignedUserName: '', crNumber: '', application: '', environment: 'BOTH', notes: '', plannedStart: '', plannedEnd: '' });
  const [teams, setTeams] = useState<any[]>([]);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [collapsedSubPhases, setCollapsedSubPhases] = useState<Set<string>>(new Set());
  const [filterTeam, setFilterTeam] = useState<string | null>(null);

  useEffect(() => {
    axios.get(`${API}/teams`, { headers }).then(r => setTeams(r.data));
  }, []);

  const togglePhase = (id: string) => {
    setCollapsedPhases(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleSubPhase = (id: string) => {
    setCollapsedSubPhases(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const formatTime = (iso: string) => iso ? iso.slice(11, 16) : '';
  const calcDuration = (start: string, end: string) => {
    if (!start || !end) return null;
    const diff = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
    if (diff <= 0) return null;
    return diff >= 60 ? `${Math.floor(diff / 60)}ש' ${diff % 60}דק'` : `${diff} דק'`;
  };

  const addTask = async (subPhaseId: string) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const taskData = {
        ...newTask,
        assignedTeamId: selectedTeam,
        versionId: version.id,
        plannedStart: newTask.plannedStart ? `${today}T${newTask.plannedStart}:00.000Z` : undefined,
        plannedEnd: newTask.plannedEnd ? `${today}T${newTask.plannedEnd}:00.000Z` : undefined,
      };
      await axios.post(`${API}/versions/sub-phases/${subPhaseId}/tasks`, taskData, { headers });
      setAddingTask(null);
      setNewTask({ title: '', assignedUserName: '', crNumber: '', application: '', environment: 'BOTH', notes: '', plannedStart: '', plannedEnd: '' });
      setSelectedTeam('');
      onRefresh();
    } catch (err) { console.error(err); }
  };

  const deleteTask = async (taskId: string) => {
    if (!window.confirm('למחוק את המשימה?')) return;
    try {
      await axios.delete(`${API}/tasks/${taskId}`, { headers });
      onRefresh();
    } catch (err) { console.error(err); }
  };

  const updateTask = async (taskId: string, data: any) => {
    try {
      await axios.patch(`${API}/tasks/${taskId}`, data, { headers });
      setEditingTask(null);
      onRefresh();
    } catch (err) { console.error(err); }
  };

  const nextStatus = NEXT_STATUS[version.status];
  const nextLabel = NEXT_LABEL[version.status];

  return (
    <div>
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button onClick={onBack} style={{ padding: '8px 16px', background: '#f0f0f0', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>→ חזור</button>
            <div>
              <h2 style={{ margin: 0, color: '#1a2332' }}>{version.name}</h2>
              {version.description && <p style={{ margin: '4px 0 0', color: '#666', fontSize: '14px' }}>{version.description}</p>}
            </div>
            <span style={{ background: STATUS_COLORS[version.status], color: 'white', padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: 'bold' }}>{STATUS_LABELS[version.status]}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={() => { setCollapsedPhases(new Set(version.phases?.map((p: any) => p.id))); }} style={{ padding: '6px 14px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>קפל הכל</button>
            <button onClick={() => { setCollapsedPhases(new Set()); setCollapsedSubPhases(new Set()); }} style={{ padding: '6px 14px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>פתח הכל</button>
            {version.status !== 'DRAFT' && version.status !== 'ACTIVE' && version.status !== 'COMPLETED' && (
              <button onClick={() => onStatusChange('DRAFT')} style={{ padding: '8px 16px', background: '#f0f0f0', color: '#666', border: '1px solid #ddd', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>← איפוס לטיוטה</button>
            )}
            {nextStatus && (
              <button onClick={() => onStatusChange(nextStatus)} style={{ padding: '10px 20px', background: STATUS_COLORS[nextStatus], color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
                {nextLabel} →
              </button>
            )}
          </div>
        </div>

        {version.submissions?.length > 0 && (
          <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: '#999' }}>סנן לפי צוות:</span>
            <span onClick={() => setFilterTeam(null)} style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', background: filterTeam === null ? '#1a2332' : '#f0f0f0', color: filterTeam === null ? 'white' : '#666' }}>כולם</span>
            {version.submissions.map((sub: any) => (
              <span key={sub.id} onClick={() => setFilterTeam(filterTeam === sub.team.id ? null : sub.team.id)}
                style={{
                  padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer',
                  background: filterTeam === sub.team.id ? '#1a2332' : sub.status === 'SUBMITTED' ? '#d5f0dc' : sub.status === 'IN_PROGRESS' ? '#fff0e0' : '#f0f0f0',
                  color: filterTeam === sub.team.id ? 'white' : sub.status === 'SUBMITTED' ? '#1a5c2a' : sub.status === 'IN_PROGRESS' ? '#8b4000' : '#666',
                  border: filterTeam === sub.team.id ? '2px solid #1a2332' : '2px solid transparent',
                }}>
                {sub.team.name}: {sub.status === 'SUBMITTED' ? 'הגיש' : sub.status === 'IN_PROGRESS' ? 'בתהליך' : 'לא התחיל'}
              </span>
            ))}
          </div>
        )}
      </div>

      {version.phases?.map((phase: any) => (
        <div key={phase.id} style={{ background: 'white', borderRadius: '12px', padding: '20px', marginBottom: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <h3 onClick={() => togglePhase(phase.id)} style={{ margin: '0 0 16px', color: '#1a2332', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' as any }}>
            <span style={{ fontSize: '14px', color: '#999' }}>{collapsedPhases.has(phase.id) ? '►' : '▼'}</span>
            <span style={{ background: phase.environment === 'HOT' ? '#fee' : phase.environment === 'HOTNET' ? '#e8f4fd' : '#f0f0f0', color: phase.environment === 'HOT' ? '#c0392b' : phase.environment === 'HOTNET' ? '#2980b9' : '#666', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>{phase.environment}</span>
            {phase.name}
            <span style={{ fontSize: '12px', color: '#999', fontWeight: 'normal' }}>({phase.subPhases?.length || 0} תת-שלבים)</span>
          </h3>

          {!collapsedPhases.has(phase.id) && phase.subPhases?.map((sub: any) => (
            <div key={sub.id} style={{ marginBottom: '12px', paddingRight: '16px', borderRight: '3px solid #e0e0e0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h4 onClick={() => toggleSubPhase(sub.id)} style={{ margin: 0, color: '#444', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', userSelect: 'none' as any }}>
                  <span style={{ fontSize: '11px', color: '#bbb' }}>{collapsedSubPhases.has(sub.id) ? '►' : '▼'}</span>
                  {sub.name}
                  <span style={{ fontSize: '11px', color: '#bbb', fontWeight: 'normal' }}>({sub.tasks?.length || 0})</span>
                </h4>
                <button onClick={() => setAddingTask(sub.id)} style={{ padding: '4px 12px', background: '#1a2332', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>+ משימה</button>
              </div>

              {!collapsedSubPhases.has(sub.id) && sub.tasks
                ?.filter((task: any) => !filterTeam || task.assignedTeam?.id === filterTeam || task.assignedTeamId === filterTeam)
                .map((task: any) => (
                  editingTask?.id === task.id ? (
                    <div key={task.id} style={{ background: '#f0f7ff', borderRadius: '8px', padding: '14px', marginBottom: '6px', border: '1px solid #bee3f8' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                        <input value={editingTask.title} onChange={e => setEditingTask({ ...editingTask, title: e.target.value })} style={{ padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                        <input value={editingTask.assignedUserName || ''} onChange={e => setEditingTask({ ...editingTask, assignedUserName: e.target.value })} placeholder="עובד" style={{ padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                        <select value={editingTask.assignedTeamId || ''} onChange={e => setEditingTask({ ...editingTask, assignedTeamId: e.target.value })} style={{ padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}>
                          <option value="">צוות</option>
                          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr', gap: '8px', marginBottom: '8px' }}>
                        <input value={editingTask.crNumber || ''} onChange={e => setEditingTask({ ...editingTask, crNumber: e.target.value })} placeholder="CR#" style={{ padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                        <select value={editingTask.application || ''} onChange={e => setEditingTask({ ...editingTask, application: e.target.value })} style={{ padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}>
                          <option value="">Application</option>
                          {APPS.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                        <select value={editingTask.environment || 'BOTH'} onChange={e => setEditingTask({ ...editingTask, environment: e.target.value })} style={{ padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}>
                          <option value="BOTH">HOT + HOTNET</option>
                          <option value="HOT">HOT בלבד</option>
                          <option value="HOTNET">HOTNET בלבד</option>
                        </select>
                        <input value={editingTask.notes || ''} onChange={e => setEditingTask({ ...editingTask, notes: e.target.value })} placeholder="הערות" style={{ padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => updateTask(task.id, editingTask)} style={{ padding: '7px 16px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>שמור</button>
                        <button onClick={() => setEditingTask(null)} style={{ padding: '7px 16px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>ביטול</button>
                      </div>
                    </div>
                  ) : (
                    <div key={task.id} style={{ background: '#f8f9fa', borderRadius: '8px', padding: '10px 14px', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 'bold', color: '#1a2332', fontSize: '14px' }}>{task.title}</span>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                          {task.assignedUserName && <span style={{ fontSize: '12px', color: '#666' }}>👤 {task.assignedUserName}</span>}
                          {task.assignedTeam && <span style={{ fontSize: '12px', color: '#666' }}>👥 {task.assignedTeam.name}</span>}
                          {task.crNumber && <span style={{ fontSize: '12px', background: '#e8f4fd', color: '#2980b9', padding: '1px 6px', borderRadius: '4px' }}>{task.crNumber}</span>}
                          {task.application && <span style={{ fontSize: '12px', background: '#f0f0f0', color: '#555', padding: '1px 6px', borderRadius: '4px' }}>{task.application}</span>}
                          <span style={{ fontSize: '12px', background: task.environment === 'HOT' ? '#fee' : task.environment === 'HOTNET' ? '#e8f4fd' : '#f0f0f0', color: '#555', padding: '1px 6px', borderRadius: '4px' }}>{task.environment}</span>
                          {(task.plannedStart || task.plannedEnd) && (
                            <span style={{ fontSize: '12px', background: '#fff3e0', color: '#e65100', padding: '1px 6px', borderRadius: '4px' }}>
                              ⏰ {formatTime(task.plannedStart)} — {formatTime(task.plannedEnd)}
                              {calcDuration(task.plannedStart, task.plannedEnd) && ` (${calcDuration(task.plannedStart, task.plannedEnd)})`}
                            </span>
                          )}
                          {task.startedAt && task.completedAt && (
                            <span style={{ fontSize: '12px', background: '#e8f5e9', color: '#2e7d32', padding: '1px 6px', borderRadius: '4px' }}>
                              ✅ {formatTime(task.startedAt)} — {formatTime(task.completedAt)}
                              {calcDuration(task.startedAt, task.completedAt) && ` (${calcDuration(task.startedAt, task.completedAt)})`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', background: '#e8f4fd', color: '#2980b9', padding: '3px 8px', borderRadius: '12px' }}>{task.status}</span>
                        <button onClick={() => setEditingTask({ ...task, assignedTeamId: task.assignedTeam?.id || task.assignedTeamId })} style={{ padding: '4px 10px', background: '#f39c12', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>עריכה</button>
                        <button onClick={() => deleteTask(task.id)} style={{ padding: '4px 10px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>מחק</button>
                      </div>
                    </div>
                  )
                ))}

              {addingTask === sub.id && (
                <div style={{ background: '#f0f7ff', borderRadius: '8px', padding: '16px', marginTop: '8px', border: '1px solid #bee3f8' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                    <input placeholder="שם המשימה *" value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                    <input placeholder="עובד אחראי" value={newTask.assignedUserName} onChange={e => setNewTask({ ...newTask, assignedUserName: e.target.value })} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                    <select value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}>
                      <option value="">צוות</option>
                      {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr', gap: '8px', marginBottom: '8px' }}>
                    <input placeholder="CR#" value={newTask.crNumber} onChange={e => setNewTask({ ...newTask, crNumber: e.target.value })} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                    <select value={newTask.application} onChange={e => setNewTask({ ...newTask, application: e.target.value })} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}>
                      <option value="">Application</option>
                      {APPS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <select value={newTask.environment} onChange={e => setNewTask({ ...newTask, environment: e.target.value })} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}>
                      <option value="BOTH">HOT + HOTNET</option>
                      <option value="HOT">HOT בלבד</option>
                      <option value="HOTNET">HOTNET בלבד</option>
                    </select>
                    <input placeholder="הערות" value={newTask.notes} onChange={e => setNewTask({ ...newTask, notes: e.target.value })} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <label style={{ fontSize: '13px', color: '#555', whiteSpace: 'nowrap' }}>התחלה צפויה:</label>
                      <input type="time" value={newTask.plannedStart} onChange={e => setNewTask({ ...newTask, plannedStart: e.target.value })} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', flex: 1 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <label style={{ fontSize: '13px', color: '#555', whiteSpace: 'nowrap' }}>סיום צפוי:</label>
                      <input type="time" value={newTask.plannedEnd} onChange={e => setNewTask({ ...newTask, plannedEnd: e.target.value })} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', flex: 1 }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => addTask(sub.id)} disabled={!newTask.title} style={{ padding: '8px 16px', background: newTask.title ? '#27ae60' : '#ccc', color: 'white', border: 'none', borderRadius: '6px', cursor: newTask.title ? 'pointer' : 'not-allowed', fontSize: '13px', fontWeight: 'bold' }}>הוסף</button>
                    <button onClick={() => setAddingTask(null)} style={{ padding: '8px 16px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>ביטול</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};