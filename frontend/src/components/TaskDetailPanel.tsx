import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { C, statusColor, statusLabel, severityColor, severityBg, severityLabel } from '../theme';
import { StatusChip, Divider } from './ui';
import { FEATURES } from '../featureFlags';
import { useDialog } from '../context/DialogContext';
import { DateTimeField } from './DatePicker';
import { formatDateTime as fmtDateTimeShared } from '../utils/dateFormat';
import { cn } from '../lib/utils';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const APPS_FALLBACK = [
  'BILI', 'CRM', 'OSB', 'DP', 'WEB-RETAIL', 'WEB-NEXT', 'WEB-HOT',
  'TOP', 'IRB', 'NC', 'ERP', 'CONNECT', 'CREDIT GUARD', 'ARCHIVE',
  'PRINT BOSS', 'NIFI', 'CAWA', 'BEERI', 'IVR', 'MEDIATION',
  'PROVISIONING LDAP', 'PROVISIONING TIBCO', 'PROVISIONING NAGRA',
  'PROVISIONING OTT', 'PROVISIONING TEL', 'REMEDY', 'ZOO', 'אחר',
];

const STATUSES = ['WAITING', 'OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'FAILED', 'ROLLED_BACK'];

const REQUIRED_FIELDS = ['title', 'teamId', 'assignee', 'application', 'durationMins', 'plannedStart', 'crList'] as const;

const utcToLocal = (iso: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const toUtcIso = (s: string) => { const d = new Date(s); return isNaN(d.getTime()) ? undefined : d.toISOString(); };
const minsToStr = (m: number) => m < 60 ? `${m} דק'` : m % 60 ? `${Math.floor(m/60)}ש' ${m%60}דק'` : `${Math.floor(m/60)}ש'`;
const calcEnd = (start: string, mins: number) => {
  const d = new Date(new Date(start).getTime() + mins * 60000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const parseMins = (dur: string): number => {
  if (!dur) return 0;
  const h = dur.match(/(\d+)ש/)?.[1], m = dur.match(/(\d+)ד/)?.[1];
  if (h || m) return (parseInt(h||'0')*60) + parseInt(m||'0');
  const col = dur.match(/^(\d+):(\d{2})$/);
  if (col) return parseInt(col[1])*60 + parseInt(col[2]);
  return parseInt(dur) || 0;
};
const fmtDT = (iso: string) => iso ? fmtDateTimeShared(iso) : '—';

// DateTimeField/DateField already carry their own converted className styling
// (DatePicker.tsx) — this `inpStyle` object only supplies the handful of
// this-panel-specific overrides (muted background, error border, etc.) via
// the external `style` prop, since that component boundary takes a
// CSSProperties object rather than a className.
const inpStyle: React.CSSProperties = { background: C.bgNested };

const DateInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}> = ({ value, onChange, disabled, style }) => (
  <DateTimeField value={value} onChange={onChange} disabled={disabled} style={{ ...inpStyle, ...style }} />
);

interface Props {
  task: any | null;
  subPhaseId?: string;
  versionId?: string;
  token: string;
  isLocked?: boolean;
  readonlyStatus?: boolean;
  teams: any[];
  users: { id: string; fullName: string }[];
  crItems: { id: string; label: string }[];
  proposals?: any[];
  versionPhases?: any[];
  currentPhaseOrder?: number;
  phaseStart?: string;
  phaseEnd?: string;
  onClose: () => void;
  onSave: () => void;
}

const Req = () => <span className="ms-0.5 text-danger">*</span>;

const Label: React.FC<{ children: React.ReactNode; required?: boolean }> = ({ children, required }) => (
  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.05em] text-subtle-foreground">
    {required && <Req />}{children}
  </div>
);

const inpClass = 'box-border w-full rounded-md border border-border bg-muted px-3 py-[7px] text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-fast ease-out';
const fieldErrClass = (err: boolean) => err ? 'border-danger' : '';

export const TaskDetailPanel: React.FC<Props> = ({
  task, subPhaseId, versionId, token, isLocked = false, readonlyStatus = false,
  teams, users, crItems, proposals = [], versionPhases = [], currentPhaseOrder = 0,
  phaseStart, phaseEnd,
  onClose, onSave,
}) => {
  const isAdd = task === null;
  const editable = !isLocked || isAdd;
  const headers = { Authorization: `Bearer ${token}` };
  const dialog = useDialog();

  // ── State ─────────────────────────────────────────────────────────────────────
  const [title, setTitle]       = useState(task?.title ?? '');
  const [durationMins, setDur]  = useState(task?.duration ? String(parseMins(task.duration)) : '');
  // When adding a new task (no task yet), seed the start time from the phase's
  // own schedule instead of leaving it blank — matches the sub-phase's timing.
  const [plannedStart, setStart]= useState(utcToLocal(task?.plannedStart ?? (isAdd ? phaseStart ?? '' : '')));
  const [plannedEnd,   setEnd]  = useState(utcToLocal(task?.plannedEnd   ?? ''));
  const [teamId,  setTeamId]    = useState(task?.assignedTeam?.id ?? task?.assignedTeamId ?? '');
  const [assignee, setAssignee] = useState(task?.assignedUserName ?? '');
  const [application, setApp]   = useState(task?.application ?? '');
  const [environment, setEnv]   = useState(task?.environment ?? 'BOTH');
  const [crInput, setCrInput]   = useState('');
  const [crInputError, setCrInputError] = useState<string | null>(null);
  const [crList,  setCrList]    = useState<string[]>(
    (task?.crNumber || '').split(',').map((s: string) => s.trim()).filter(Boolean)
  );
  const [depNote,  setDepNote]  = useState(task?.dependencyNote ?? '');
  const [notes,    setNotes]    = useState(task?.notes ?? '');
  const [orderIndex, setOrderIndex] = useState(String(task?.orderIndex ?? 0));
  const [deps,     setDeps]     = useState<any[]>(task?.dependencies ?? []);
  const [depAddId, setDepAddId] = useState('');
  const [status,   setStatus]   = useState(task?.status ?? 'WAITING');
  const [saving,      setSaving]      = useState(false);
  const [saveOk,      setSaveOk]      = useState(false);
  const [errors,      setErrors]      = useState<Set<string>>(new Set());
  const [timeWarning, setTimeWarning] = useState<string | null>(null);
  const [selectedProposal, setProposal] = useState<string | null>(null);
  const [teamFilter, setTeamFilter]   = useState('');
  const [userFilter, setUserFilter]   = useState('');
  const [appFilter,  setAppFilter]    = useState('');
  const [teamCrItems, setTeamCrItems] = useState<{ id: string; label: string }[]>([]);

  // ── Reset on task change ───────────────────────────────────────────────────────
  useEffect(() => {
    if (task) {
      setTitle(task.title ?? '');
      setDur(task.duration ? String(parseMins(task.duration)) : '');
      setStart(utcToLocal(task.plannedStart ?? ''));
      setEnd(utcToLocal(task.plannedEnd ?? ''));
      setTeamId(task.assignedTeam?.id ?? task.assignedTeamId ?? '');
      setAssignee(task.assignedUserName ?? '');
      setApp(task.application ?? '');
      setEnv(task.environment ?? 'BOTH');
      setCrList((task.crNumber || '').split(',').map((s: string) => s.trim()).filter(Boolean));
      setDepNote(task.dependencyNote ?? '');
      setNotes(task.notes ?? '');
      setOrderIndex(String(task.orderIndex ?? 0));
      setDeps(task.dependencies ?? []);
      setStatus(task.status ?? 'WAITING');
      setErrors(new Set());
    }
  }, [task?.id]); // eslint-disable-line

  // ── Fetch CRs for selected team ────────────────────────────────────────────────
  useEffect(() => {
    if (!versionId || !teamId) { setTeamCrItems([]); return; }
    axios.get(`${API}/version-cr-assignments/version/${versionId}`, { headers })
      .then(r => {
        const forTeam = (r.data as any[]).filter(a => a.teamId === teamId);
        if (forTeam.length === 0) { setTeamCrItems([]); return; }
        const ids = new Set(forTeam.map(a => a.crNumber ?? a.crId ?? a.id));
        const filtered = crItems.filter(c => ids.has(c.id) || ids.has(c.label));
        setTeamCrItems(filtered.length > 0 ? filtered : crItems);
      })
      .catch(() => setTeamCrItems(crItems));
  }, [versionId, teamId]); // eslint-disable-line

  // ── Derived lists (always include current value) ────────────────────────────────
  const team = teams.find((t: any) => t.id === teamId);

  // ── Phase time validation ──────────────────────────────────────────────────────
  const checkTimeAgainstPhase = (startVal: string, endVal: string) => {
    if (!phaseStart && !phaseEnd) { setTimeWarning(null); return; }
    const phS = phaseStart ? new Date(phaseStart).getTime() : null;
    const phE = phaseEnd   ? new Date(phaseEnd).getTime()   : null;
    const tS  = startVal   ? new Date(startVal).getTime()   : null;
    const tE  = endVal     ? new Date(endVal).getTime()     : null;
    const fmt = (iso: string) => fmtDateTimeShared(iso);
    const warns: string[] = [];
    if (tS !== null && phS !== null && tS < phS) warns.push(`התחלה ${fmt(startVal)} לפני תחילת השלב ${fmt(phaseStart!)}`);
    if (tS !== null && phE !== null && tS > phE) warns.push(`התחלה ${fmt(startVal)} אחרי סיום השלב ${fmt(phaseEnd!)}`);
    if (tE !== null && phE !== null && tE > phE) warns.push(`סיום ${fmt(endVal)} חורג מסיום השלב ${fmt(phaseEnd!)}`);
    setTimeWarning(warns.length ? warns.join(' · ') : null);
  };

  const teamMembers: any[] = teamId
    ? (team?.members || []).map((m: any) => m.user).filter(Boolean)
    : users;
  const assigneePool = (assignee && !teamMembers.some((u: any) => u.fullName === assignee))
    ? [{ id: '__current__', fullName: assignee }, ...teamMembers]
    : teamMembers;
  const filteredUsers = assigneePool.filter((u: any) =>
    !userFilter || u.fullName.toLowerCase().startsWith(userFilter.toLowerCase())
  );

  const baseApps: string[] = teamId
    ? (team?.apps?.length ? team.apps : APPS_FALLBACK)
    : APPS_FALLBACK;
  const appPool = application && !baseApps.includes(application) ? [application, ...baseApps] : baseApps;
  const filteredApps = appPool.filter((a: string) =>
    !appFilter || a.toLowerCase().startsWith(appFilter.toLowerCase())
  );

  const activeCrItems = (versionId && teamId && teamCrItems.length > 0) ? teamCrItems : crItems;

  const activeTeams = teams.filter((t: any) => t.active &&
    (!teamFilter || t.name.toLowerCase().startsWith(teamFilter.toLowerCase()))
  );

  // ── Dep picker ─────────────────────────────────────────────────────────────────
  const linkedIds = new Set(deps.map((d: any) => d.dependsOnTaskId));
  const eligibleTasks = versionPhases
    .filter((p: any) => p.orderIndex <= currentPhaseOrder)
    .flatMap((p: any) => (p.subPhases || []).flatMap((s: any) =>
      (s.tasks || []).map((t: any) => ({ ...t, _phaseName: p.name }))
    ))
    .filter((t: any) => t.id !== task?.id);

  const addDep = (depTask: any) => {
    if (!depTask) return;
    setDeps(prev => [...prev, { dependsOnTaskId: depTask.id, dependsOn: { id: depTask.id, title: depTask.title, status: depTask.status } }]);
    const depEnd = depTask.plannedEnd ? utcToLocal(depTask.plannedEnd) : null;
    if (depEnd) { setStart(depEnd); const m = parseInt(durationMins); if (m > 0) setEnd(calcEnd(depEnd, m)); }
    setDepAddId('');
  };
  const removeDep = (id: string) => setDeps(prev => prev.filter((d: any) => d.dependsOnTaskId !== id));

  // ── Validation ─────────────────────────────────────────────────────────────────
  const validate = (): boolean => {
    const errs = new Set<string>();
    if (!title.trim())   errs.add('title');
    if (!teamId)         errs.add('teamId');
    if (!assignee)       errs.add('assignee');
    if (!application)    errs.add('application');
    if (!durationMins || parseInt(durationMins) <= 0) errs.add('durationMins');
    if (!plannedStart)   errs.add('plannedStart');
    setErrors(errs);
    return errs.size === 0;
  };

  const fieldErr = (f: string) => errors.has(f)
    ? { border: `1px solid ${C.danger}` } : {};

  // ── Save ────────────────────────────────────────────────────────────────────────
  const buildPayload = () => {
    const mins = parseInt(durationMins);
    const dur   = mins > 0 ? minsToStr(mins) : undefined;
    const endV  = mins > 0 && plannedStart ? calcEnd(plannedStart, mins) : plannedEnd;
    // assignee is tracked as a plain name string (the <select> below is keyed
    // by fullName, not id) — resolve it back to a real userId here so the
    // task's assignedUserId foreign key actually follows the reassignment.
    // Without this, only the denormalized assignedUserName changes and
    // anything keyed off assignedUserId (notifications, "my tasks" filters)
    // keeps pointing at whoever was assigned before.
    const matchedUser = users.find((u: any) => u.fullName === assignee);
    return {
      title: title.trim(),
      assignedTeamId:  teamId      || undefined,
      assignedUserName: assignee   || undefined,
      assignedUserId:  assignee ? (matchedUser?.id ?? null) : null,
      application:     application || undefined,
      environment:     environment || 'BOTH',
      crNumber:        crList.join(',') || undefined,
      dependencyNote:  depNote     || undefined,
      notes:           notes       || undefined,
      duration:        dur,
      plannedStart:    plannedStart ? toUtcIso(plannedStart) : undefined,
      plannedEnd:      endV        ? toUtcIso(endV)         : undefined,
      orderIndex:      orderIndex !== '' ? parseInt(orderIndex) : undefined,
    };
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const depFailures: string[] = [];
      if (isAdd) {
        const res = await axios.post(`${API}/versions/sub-phases/${subPhaseId}/tasks`, buildPayload(), { headers });
        const newId = res.data.id;
        if (selectedProposal && FEATURES.TEAM_LEAD_PROPOSAL)
          await axios.patch(`${API}/task-proposals/${selectedProposal}/mark-used`, { taskId: newId }, { headers }).catch(() => {});
        if (deps.length)
          await Promise.all(deps.map(d =>
            axios.post(`${API}/versions/tasks/${newId}/dependencies`, { dependsOnTaskId: d.dependsOnTaskId }, { headers })
              .catch(e => { depFailures.push(e?.response?.data?.message || d.dependsOn?.title || d.dependsOnTaskId); })
          ));
      } else {
        await axios.patch(`${API}/tasks/${task.id}`, buildPayload(), { headers });
        const origIds = (task?.dependencies ?? []).map((d: any) => d.dependsOnTaskId as string);
        const curIds  = deps.map((d: any) => d.dependsOnTaskId as string);
        const origSet = new Set(origIds);
        const curSet  = new Set(curIds);
        await Promise.all([
          ...origIds.filter((id: string) => !curSet.has(id)).map((id: string) =>
            axios.post(`${API}/versions/tasks/${task.id}/dependencies/remove`, { dependsOnTaskId: id }, { headers })
              .catch(e => { depFailures.push(e?.response?.data?.message || id); })),
          ...curIds.filter((id: string) => !origSet.has(id)).map((id: string) =>
            axios.post(`${API}/versions/tasks/${task.id}/dependencies`, { dependsOnTaskId: id }, { headers })
              .catch(e => { depFailures.push(e?.response?.data?.message || id); })),
        ]);
      }
      if (depFailures.length) {
        dialog.alert(`המשימה נשמרה, אך התלויות הבאות לא נשמרו:\n${depFailures.join('\n')}`, 'שגיאה בשמירת תלויות', 'danger');
      }
      setSaveOk(true);
      setTimeout(() => { setSaveOk(false); onSave(); }, 700);
    } catch (err: any) {
      console.error(err);
      dialog.alert(err?.response?.data?.message || 'שגיאה בשמירת המשימה — הנתונים לא נשמרו', 'שגיאה בשמירה', 'danger');
    }
    finally { setSaving(false); }
  };

  const handleStatusSave = async (s: string) => {
    setStatus(s);
    if (!isAdd && task?.id)
      await axios.patch(`${API}/tasks/${task.id}/status`, { status: s }, { headers }).catch(console.error);
    onSave();
  };

  // ── Render ─────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-card">

      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-3">
        <span className="flex-1 text-sm font-semibold text-muted-foreground">
          {isAdd ? '+ משימה חדשה' : 'פרטי משימה'}
        </span>
        {saving && <span className="text-xs text-subtle-foreground">שומר...</span>}
        {saveOk && <span className="text-xs text-success">✓ נשמר</span>}
        <button onClick={onClose} className="cursor-pointer border-none bg-transparent p-1 text-xl leading-none text-subtle-foreground">✕</button>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">

        {/* Validation summary */}
        {errors.size > 0 && (
          <div className="rounded-md border border-danger/[0.27] bg-danger-bg px-3 py-2 text-xs text-danger">
            יש למלא את כל שדות החובה (מסומנים ב-*)
          </div>
        )}

        {/* ── Proposals ── */}
        {isAdd && FEATURES.TEAM_LEAD_PROPOSAL && proposals.length > 0 && (
          <div className="rounded-lg border-2 border-success/[0.27] bg-transparent p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-success">💡 הצעות ראשי צוותים</div>
            <div className="flex max-h-[180px] flex-col gap-1 overflow-y-auto">
              {proposals.map((p: any) => {
                const isSel = selectedProposal === p.id;
                const submittingTeamName = teams.find((t: any) => t.id === p.teamId)?.name ?? '';
                const responsibleTeamName = (p as any).responsibleTeamId
                  ? (teams.find((t: any) => t.id === (p as any).responsibleTeamId)?.name ?? '')
                  : '';
                const teamName = responsibleTeamName || submittingTeamName;
                return (
                  <div key={p.id} onClick={() => isSel ? setProposal(null) : (() => {
                    setProposal(p.id);
                    setTitle(p.title ?? title);
                    setApp(p.app ?? '');
                    setCrList((p.crNumber || '').split(',').map((s: string) => s.trim()).filter(Boolean));
                    setDur(p.estimatedMins ? String(p.estimatedMins) : '');
                    setNotes(p.notes ?? '');
                    if (p.assignedUserName) setAssignee(p.assignedUserName);
                    // use responsibleTeamId if set (team lead designated a different team), else submitting teamId
                    setTeamId((p as any).responsibleTeamId || p.teamId || '');
                  })()} className={cn(
                    'cursor-pointer rounded-md px-3 py-2 transition-[background,border-color] duration-fast ease-out border',
                    isSel ? 'border-success bg-success' : 'border-border bg-card'
                  )}>
                    <div className="mb-[3px] flex items-center gap-2">
                      {p.crNumber && <span className="rounded-sm bg-info-bg px-1.5 py-px text-[13px] font-semibold text-info">{p.crNumber}</span>}
                      <span className={cn('flex-1 text-[15px] font-semibold', isSel ? 'text-white' : 'text-foreground')}>{p.title}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {submittingTeamName && <span className={cn('text-[13px]', isSel ? 'text-white/80' : 'text-subtle-foreground')}>מגיש: {submittingTeamName}</span>}
                      {responsibleTeamName && responsibleTeamName !== submittingTeamName && (
                        <span className={cn('text-[13px] font-semibold', isSel ? 'text-white/90' : 'text-primary')}>אחראי: {responsibleTeamName}</span>
                      )}
                      {p.app && <span className={cn('text-[13px]', isSel ? 'text-white/70' : 'text-subtle-foreground')}>{p.app}</span>}
                      {p.estimatedMins && <span className={cn('text-[13px]', isSel ? 'text-white/70' : 'text-warning')}>⏱ {p.estimatedMins} דק'</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Title ── */}
        <div>
          <Label required>שם משימה</Label>
          <textarea value={title} onChange={e => setTitle(e.target.value)} rows={2} disabled={!editable}
            className={cn(inpClass, fieldErrClass(errors.has('title')), 'resize-none text-base font-semibold leading-[1.5]')} />
        </div>

        <Divider />

        {/* ── Status (edit only) ── */}
        {!isAdd && (
          <div>
            <Label>סטטוס</Label>
            {readonlyStatus
              ? <span className="inline-block rounded-full border border-border bg-muted px-2.5 py-[3px] text-sm text-subtle-foreground">ממתין</span>
              : <div className="flex flex-wrap gap-1">
                  {STATUSES.map(s => { const sc = statusColor(s), isA = status === s; return (
                    <button
                      key={s}
                      onClick={() => handleStatusSave(s)}
                      className={cn('cursor-pointer rounded-full px-2.5 py-1 text-xs', isA ? 'font-semibold' : 'font-normal')}
                      style={{ background: isA ? sc + '20' : 'transparent', color: isA ? sc : C.textMuted, border: `1px solid ${isA ? sc + '60' : C.border}` }}
                    >{statusLabel(s)}</button>
                  );})}
                </div>
            }
          </div>
        )}

        {/* ── צוות + אחראי ── */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label required>צוות</Label>
            <input value={teamFilter} onChange={e => setTeamFilter(e.target.value)} placeholder="סנן..."
              className={cn(inpClass, 'rounded-b-none border-b-0 px-2 py-1 text-[13px]')} />
            <select value={teamId} onChange={e => { setTeamId(e.target.value); setAssignee(''); setApp(''); setTeamCrItems([]); }}
              disabled={!editable}
              className={cn(inpClass, fieldErrClass(errors.has('teamId')), 'cursor-pointer rounded-t-none border-t-0')}>
              <option value="">— בחר צוות —</option>
              {activeTeams.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <Label required>אחראי</Label>
            <input value={userFilter} onChange={e => setUserFilter(e.target.value)} placeholder="סנן..."
              className={cn(inpClass, 'rounded-b-none border-b-0 px-2 py-1 text-[13px]')} />
            <select value={assignee} onChange={e => setAssignee(e.target.value)}
              disabled={!editable}
              className={cn(inpClass, fieldErrClass(errors.has('assignee')), 'cursor-pointer rounded-t-none border-t-0')}>
              <option value="">— בחר אחראי —</option>
              {filteredUsers.map((u: any) => <option key={u.id ?? u.fullName} value={u.fullName}>{u.fullName}</option>)}
            </select>
          </div>
        </div>

        {/* ── אפליקציה + סביבה ── */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label required>אפליקציה</Label>
            <input value={appFilter} onChange={e => setAppFilter(e.target.value)} placeholder="סנן..."
              className={cn(inpClass, 'rounded-b-none border-b-0 px-2 py-1 text-[13px]')} />
            <select value={application} onChange={e => setApp(e.target.value)}
              disabled={!editable}
              className={cn(inpClass, fieldErrClass(errors.has('application')), 'cursor-pointer rounded-t-none border-t-0')}>
              <option value="">— בחר אפליקציה —</option>
              {filteredApps.map((a: string) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <Label required>סביבה</Label>
            <select value={environment} onChange={e => setEnv(e.target.value)}
              disabled={!editable} className={cn(inpClass, 'cursor-pointer')}>
              <option value="BOTH">HOT + HOTNET</option>
              <option value="HOT">HOT בלבד</option>
              <option value="HOTNET">HOTNET בלבד</option>
            </select>
          </div>
        </div>

        {/* ── פיתוחים בגרסה (CR) ── */}
        <div>
          <Label>פיתוחים בגרסה</Label>
          <div className={cn(inpClass, fieldErrClass(errors.has('crList')), 'flex min-h-10 flex-wrap items-center gap-1.5 px-2.5 py-1.5')}>
            {crList.map((cr: string) => {
              const match = activeCrItems.find(c => c.id === cr);
              return (
                <span key={cr} title={match?.label ?? cr} className="inline-flex max-w-[260px] items-center gap-1 rounded-sm bg-info-bg px-2 py-0.5 text-sm text-info">
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{match?.label ?? cr}</span>
                  {editable && <button onClick={() => setCrList(l => l.filter(c => c !== cr))} className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-base leading-none text-info">×</button>}
                </span>
              );
            })}
            {editable && (
              <input list="cr-datalist-panel" value={crInput}
                onChange={e => {
                  setCrInput(e.target.value);
                  setCrInputError(null);
                  const match = activeCrItems.find(c => c.id === e.target.value || c.label === e.target.value);
                  if (match && !crList.includes(match.id)) { setCrList(l => [...l, match.id]); setCrInput(''); }
                }}
                onKeyDown={e => {
                  if (e.key !== 'Enter' || !crInput.trim()) return;
                  e.preventDefault();
                  // Auto-fill against the real CR list for this version — typing a
                  // number that doesn't match a real, in-scope CR shouldn't silently
                  // add a bogus entry.
                  const typed = crInput.trim();
                  const match = activeCrItems.find(c => c.id === typed || c.label === typed);
                  if (match) {
                    if (!crList.includes(match.id)) setCrList(l => [...l, match.id]);
                    setCrInput('');
                  } else {
                    setCrInputError(`CR ${typed} לא נמצא ברשימת הפיתוחים של גרסה זו`);
                  }
                }}
                placeholder={crList.length ? '+ הוסף' : 'הקלד CR# והקש Enter'}
                className="min-w-[120px] flex-1 border-none bg-transparent text-sm text-foreground outline-none"
              />
            )}
            <datalist id="cr-datalist-panel">
              {activeCrItems.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </datalist>
          </div>
          {!teamId && <div className="mt-[3px] text-xs text-subtle-foreground">בחר צוות כדי לסנן את הרשימה</div>}
          {crInputError && <div className="mt-[3px] text-xs text-danger">⚠ {crInputError}</div>}
        </div>

        {/* ── משך + התחלה + סיום (שורה אחת) ── */}
        <div className="grid grid-cols-[90px_1fr_1fr] gap-3">
          <div>
            <Label required>משך (דק')</Label>
            <input type="number" min="1" max="999" value={durationMins}
              onChange={e => { const v = e.target.value.slice(0,3); setDur(v); const m = parseInt(v); if (m > 0 && plannedStart) setEnd(calcEnd(plannedStart, m)); }}
              disabled={!editable}
              className={cn(inpClass, fieldErrClass(errors.has('durationMins')), 'text-center font-semibold')} placeholder="דק'" />
          </div>
          <div>
            <Label required>התחלה מתוכננת</Label>
            <DateInput
              value={plannedStart}
              onChange={v => {
                setStart(v);
                const m = parseInt(durationMins);
                const newEnd = m > 0 && v ? calcEnd(v, m) : plannedEnd;
                if (m > 0 && v) setEnd(newEnd);
                checkTimeAgainstPhase(v, m > 0 && v ? calcEnd(v, m) : plannedEnd);
              }}
              disabled={!editable}
              style={fieldErr('plannedStart')}
            />
          </div>
          <div>
            <Label>סיום מתוכנן</Label>
            <DateInput
              value={plannedEnd}
              onChange={v => { setEnd(v); checkTimeAgainstPhase(plannedStart, v); }}
              disabled={!editable}
              style={{ color: plannedEnd ? C.statusInProgress : C.textDisabled }}
            />
          </div>
        </div>

        {/* Phase time warning */}
        {timeWarning && (
          <div className="flex items-start gap-2 rounded-md border border-warning bg-warning-bg px-3 py-2">
            <span className="shrink-0 text-sm">⚠️</span>
            <div>
              <div className="mb-0.5 text-xs font-semibold text-warning">
                התאריך חורג מלוח הזמנים של השלב
              </div>
              <div className="text-xs text-warning">{timeWarning}</div>
            </div>
          </div>
        )}

        {/* Actual dates */}
        {!isAdd && (task?.actualStart || task?.actualFinish) && (
          <div className="flex gap-4">
            {task.actualStart  && <span className="text-xs" style={{ color: C.statusDone }}>▶ התחיל: {fmtDT(task.actualStart)}</span>}
            {task.actualFinish && <span className="text-xs" style={{ color: C.statusDone }}>■ הסתיים: {fmtDT(task.actualFinish)}</span>}
          </div>
        )}

        {/* ── תלויות ── */}
        <div>
          <Label>תלויות</Label>
          {deps.length > 0 && (
            <div className="mb-2 flex flex-col gap-1">
              {deps.map((d: any) => {
                const dep = d.dependsOn; const isDone = dep?.status === 'DONE';
                return (
                  <div
                    key={d.dependsOnTaskId}
                    className="flex items-center gap-2 rounded-md px-2.5 py-1.5"
                    style={{ background: isDone ? C.bgDone : C.bgBlocked, border: `1px solid ${isDone ? C.statusDone + '33' : C.statusBlocked + '33'}` }}
                  >
                    <span className="shrink-0" style={{ color: isDone ? C.statusDone : C.statusBlocked }}>{isDone ? '✓' : '⏳'}</span>
                    <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-foreground">{dep?.title}</span>
                    {dep && <StatusChip status={dep.status} size="xs" />}
                    {editable && <button onClick={() => removeDep(d.dependsOnTaskId)} className="cursor-pointer border-none bg-transparent p-0 text-sm leading-none text-danger">✕</button>}
                  </div>
                );
              })}
            </div>
          )}
          {editable && eligibleTasks.filter((t: any) => !linkedIds.has(t.id)).length > 0 && (
            <div className="flex gap-2">
              <select value={depAddId} onChange={e => setDepAddId(e.target.value)} className={cn(inpClass, 'flex-1 cursor-pointer text-sm')}>
                <option value="">— בחר משימה תלויה —</option>
                {versionPhases.filter((p: any) => p.orderIndex <= currentPhaseOrder).map((p: any) => (
                  <optgroup key={p.id} label={p.name}>
                    {(p.subPhases || []).flatMap((s: any) =>
                      (s.tasks || []).filter((t: any) => t.id !== task?.id && !linkedIds.has(t.id))
                        .map((t: any) => <option key={t.id} value={t.id}>{t.title}</option>)
                    )}
                  </optgroup>
                ))}
              </select>
              <button disabled={!depAddId} onClick={() => addDep(eligibleTasks.find((t: any) => t.id === depAddId))}
                className={cn(
                  'whitespace-nowrap rounded-md border-none px-4 py-[7px] text-sm font-semibold',
                  depAddId ? 'cursor-pointer bg-primary text-white' : 'cursor-not-allowed bg-muted text-subtle-foreground'
                )}>
                + הוסף
              </button>
            </div>
          )}
        </div>

        {/* ── הערת תלות + הערות ── */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>הערת תלות</Label>
            <input value={depNote} onChange={e => setDepNote(e.target.value)} disabled={!editable} placeholder="תלוי ב..." className={inpClass} />
          </div>
          <div>
            <Label>הערות כלליות</Label>
            <input value={notes} onChange={e => setNotes(e.target.value)} disabled={!editable} placeholder="הערה..." className={inpClass} />
          </div>
        </div>

        {/* ── סדר משימות ── */}
        <div>
          <Label>סדר בתוך תת-השלב</Label>
          <input type="number" value={orderIndex} onChange={e => setOrderIndex(e.target.value)} disabled={!editable} className={cn(inpClass, 'w-[100px]')} />
        </div>

        {/* Alert boxes */}
        {!isAdd && task?.blockedReason && (
          <div className="rounded-md px-3 py-2" style={{ background: C.bgBlocked, border: `1px solid ${C.statusBlocked}44` }}>
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold" style={{ color: C.textOnBlockedBg }}>
              🚫 סיבת חסימה{task?.blockedSeverity && <span style={{ background: severityBg(task.blockedSeverity), color: severityColor(task.blockedSeverity) }} className="rounded-full px-2 py-px font-semibold">{severityLabel(task.blockedSeverity)}</span>}
            </div>
            <div className="text-sm" style={{ color: C.textOnBlockedBg }}>{task.blockedReason}</div>
          </div>
        )}
        {!isAdd && task?.failedReason && (
          <div className="rounded-md px-3 py-2" style={{ background: C.bgFailed, border: `1px solid ${C.statusFailed}44` }}>
            <div className="mb-1 text-xs font-semibold" style={{ color: C.statusFailed }}>✗ סיבת כישלון</div>
            <div className="text-sm" style={{ color: C.statusFailed }}>{task.failedReason}</div>
          </div>
        )}
      </div>

      {/* Footer */}
      {editable && (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-card px-4 py-3 [direction:ltr]">
          {errors.size > 0 && <span className="flex-1 text-right text-xs text-danger [direction:rtl]">* יש למלא את כל שדות החובה</span>}
          <button onClick={onClose} className="cursor-pointer rounded-lg border border-border bg-muted px-5 py-2 text-sm text-muted-foreground">ביטול</button>
          <button onClick={handleSave} disabled={saving}
            className={cn(
              'min-w-[90px] rounded-lg border-none px-6 py-2 text-sm font-semibold text-white transition-[background] duration-fast ease-out',
              saving ? 'cursor-not-allowed' : 'cursor-pointer',
              saveOk ? 'bg-success' : 'bg-primary'
            )}>
            {saving ? '...' : saveOk ? '✓ נשמר' : isAdd ? 'הוסף משימה' : 'שמור שינויים'}
          </button>
        </div>
      )}
    </div>
  );
};
