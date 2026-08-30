import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface ImprovementTask {
  id: string;
  releaseName: string;
  kpiName: string;
  responsibility: string | null;
  requiredImprovement: string | null;
  mainDevelopments: string | null;
  status: string;
}

interface Props { token: string; role: string; }

const STATUS_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'OPEN', label: 'פתוח', color: C.danger },
  { value: 'IN_PROGRESS', label: 'בטיפול', color: '#e8af00' },
  { value: 'DONE', label: 'הושלם', color: C.success },
];
function statusLabel(status: string): { label: string; color: string } {
  const opt = STATUS_OPTIONS.find(o => o.value === status);
  return opt ? { label: opt.label, color: opt.color } : { label: status, color: C.textMuted };
}

const NOTE_EDITOR_ROLES = ['ADMIN', 'RELEASE_MANAGER'];

const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'right', fontWeight: WEIGHT.semibold, color: C.textSecondary, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: `1px solid ${C.border}`, color: C.textPrimary, verticalAlign: 'top', ...TEXT.sm };

export const ImprovementTrackingView: React.FC<Props> = ({ token, role }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [tasks, setTasks] = useState<ImprovementTask[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [releaseFilter, setReleaseFilter] = useState<string>('ALL');
  const [kpiFilter, setKpiFilter] = useState<string>('ALL');
  const canEdit = NOTE_EDITOR_ROLES.includes(role);

  const load = () => {
    setLoading(true);
    axios.get(`${API}/quality-hub/improvement-tasks`, { headers })
      .then(res => setTasks(res.data ?? []))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  };

  useEffect(load, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeStatus = async (id: string, status: string) => {
    setTasks(prev => prev ? prev.map(t => t.id === id ? { ...t, status } : t) : prev);
    await axios.patch(`${API}/quality-hub/improvement-tasks/${id}`, { status }, { headers }).catch(load);
  };

  const releases = Array.from(new Set((tasks ?? []).map(t => t.releaseName))).sort().reverse();
  const kpis = Array.from(new Set((tasks ?? []).map(t => t.kpiName))).sort();

  const filtered = (tasks ?? []).filter(t =>
    (statusFilter === 'ALL' || t.status === statusFilter) &&
    (releaseFilter === 'ALL' || t.releaseName === releaseFilter) &&
    (kpiFilter === 'ALL' || t.kpiName === kpiFilter)
  );

  const selectStyle: React.CSSProperties = { fontFamily: FONT, padding: '6px 10px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgCard, color: C.textPrimary, ...TEXT.sm };

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>✅ משימות שיפור — מעקב חוצה-גרסאות</div>
      <div style={{ ...TEXT.sm, color: C.textMuted }}>
        כל משימות השיפור שנוספו בכל מסכי ה-KPI, מכל הגרסאות, במקום אחד.
      </div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <select style={selectStyle} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="ALL">כל הסטטוסים</option>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select style={selectStyle} value={releaseFilter} onChange={e => setReleaseFilter(e.target.value)}>
          <option value="ALL">כל הגרסאות</option>
          {releases.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select style={selectStyle} value={kpiFilter} onChange={e => setKpiFilter(e.target.value)}>
          <option value="ALL">כל ה-KPI-ים</option>
          {kpis.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6] }}>טוען...</div>
      ) : filtered.length === 0 ? (
        <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[6] }}>אין שורות תואמות</div>
      ) : (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '960px' }}>
            <thead>
              <tr style={{ background: C.bgNested }}>
                <th style={th}>גרסה</th>
                <th style={th}>KPI</th>
                <th style={th}>שיפורים נדרשים</th>
                <th style={th}>פיתוחים עיקריים</th>
                <th style={th}>אחריות</th>
                <th style={th}>סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(task => (
                <tr key={task.id}>
                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: WEIGHT.semibold }}>{task.releaseName}</td>
                  <td style={td}>{task.kpiName}</td>
                  <td style={{ ...td, whiteSpace: 'pre-wrap' }}>{task.requiredImprovement || '—'}</td>
                  <td style={{ ...td, whiteSpace: 'pre-wrap' }}>{task.mainDevelopments || '—'}</td>
                  <td style={td}>{task.responsibility || '—'}</td>
                  <td style={td}>
                    {canEdit ? (
                      <select
                        value={task.status}
                        onChange={e => changeStatus(task.id, e.target.value)}
                        style={{ ...selectStyle, padding: '3px 8px', color: statusLabel(task.status).color, fontWeight: WEIGHT.semibold }}
                      >
                        {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <span style={{ color: statusLabel(task.status).color, fontWeight: WEIGHT.semibold }}>{statusLabel(task.status).label}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
