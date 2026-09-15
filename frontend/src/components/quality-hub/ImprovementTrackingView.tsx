import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { Select } from '../ui';

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

const th = 'py-2 px-2.5 text-right font-semibold text-muted-foreground border-b border-border whitespace-nowrap';
const td = 'py-2 px-2.5 border-b border-border text-foreground align-top text-sm';

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

  return (
    <div className="flex flex-col gap-4">
      <div className="text-lg font-bold text-foreground">✅ משימות שיפור — מעקב חוצה-גרסאות</div>
      <div className="text-sm text-subtle-foreground">
        כל משימות השיפור שנוספו בכל מסכי ה-KPI, מכל הגרסאות, במקום אחד.
      </div>

      <div className="flex gap-3 flex-wrap">
        <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="ALL">כל הסטטוסים</option>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select value={releaseFilter} onChange={e => setReleaseFilter(e.target.value)}>
          <option value="ALL">כל הגרסאות</option>
          {releases.map(r => <option key={r} value={r}>{r}</option>)}
        </Select>
        <Select value={kpiFilter} onChange={e => setKpiFilter(e.target.value)}>
          <option value="ALL">כל ה-KPI-ים</option>
          {kpis.map(k => <option key={k} value={k}>{k}</option>)}
        </Select>
      </div>

      {loading ? (
        <div className="text-sm text-subtle-foreground p-6">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-subtle-foreground text-center p-6">אין שורות תואמות</div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          <table className="w-full border-collapse min-w-[960px]">
            <thead>
              <tr className="bg-muted">
                <th className={th}>גרסה</th>
                <th className={th}>KPI</th>
                <th className={th}>שיפורים נדרשים</th>
                <th className={th}>פיתוחים עיקריים</th>
                <th className={th}>אחריות</th>
                <th className={th}>סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(task => (
                <tr key={task.id}>
                  <td className={`${td} font-mono font-semibold`}>{task.releaseName}</td>
                  <td className={td}>{task.kpiName}</td>
                  <td className={`${td} whitespace-pre-wrap`}>{task.requiredImprovement || '—'}</td>
                  <td className={`${td} whitespace-pre-wrap`}>{task.mainDevelopments || '—'}</td>
                  <td className={td}>{task.responsibility || '—'}</td>
                  <td className={td}>
                    {canEdit ? (
                      <select
                        value={task.status}
                        onChange={e => changeStatus(task.id, e.target.value)}
                        className="h-8 rounded-md border border-border bg-card px-2 text-sm font-semibold cursor-pointer"
                        style={{ color: statusLabel(task.status).color }}
                      >
                        {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <span className="font-semibold" style={{ color: statusLabel(task.status).color }}>{statusLabel(task.status).label}</span>
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
