import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, EASE, statusColor, statusLabel, severityColor, severityBg, severityLabel } from '../theme';
import { Avatar, StatusChip, Divider } from './ui';
import { FEATURES } from '../featureFlags';
import { useDialog } from '../context/DialogContext';
import { DateTimeField } from './DatePicker';

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
const fmtDT = (iso: string) =>
  iso ? new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

const DateInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}> = ({ value, onChange, disabled, style }) => (
  <DateTimeField value={value} onChange={onChange} disabled={disabled} style={{ ...inp, ...style }} />
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

const Req = () => <span style={{ color: C.danger, marginRight: '2px' }}>*</span>;

const Label: React.FC<{ children: React.ReactNode; required?: boolean }> = ({ children, required }) => (
  <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, fontWeight: WEIGHT.semibold, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: SP[1] }}>
    {required && <Req />}{children}
  </div>
);

const inp: React.CSSProperties = {
  fontFamily: FONT, fontSize: '15px', color: C.textPrimary,
  background: C.bgNested, border: `1px solid ${C.borderEm}`,
  borderRadius: RADIUS.md, padding: '7px 12px',
  outline: 'none', width: '100%', boxSizing: 'border-box', transition: EASE.fast,
};
const errInp = (err: boolean): React.CSSProperties => ({
  ...inp, border: `1px solid ${err ? C.danger : C.borderEm}`,
});

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
    const fmt = (iso: string) => new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
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
    <div style={{ width: '100%', height: '100%', background: C.bgCard, display: 'flex', flexDirection: 'column', borderRadius: '16px', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], padding: `${SP[3]} ${SP[4]}`, borderBottom: `1px solid ${C.border}`, background: C.bgElevated, flexShrink: 0 }}>
        <span style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textSecondary, fontFamily: FONT, flex: 1 }}>
          {isAdd ? '+ משימה חדשה' : 'פרטי משימה'}
        </span>
        {saving && <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>שומר...</span>}
        {saveOk && <span style={{ ...TEXT.xs, color: C.success, fontFamily: FONT }}>✓ נשמר</span>}
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '20px', lineHeight: 1, padding: SP[1] }}>✕</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: SP[4], display: 'flex', flexDirection: 'column', gap: SP[4] }}>

        {/* Validation summary */}
        {errors.size > 0 && (
          <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}44`, borderRadius: RADIUS.md, padding: `${SP[2]} ${SP[3]}`, ...TEXT.xs, color: C.danger, fontFamily: FONT }}>
            יש למלא את כל שדות החובה (מסומנים ב-*)
          </div>
        )}

        {/* ── Proposals ── */}
        {isAdd && FEATURES.TEAM_LEAD_PROPOSAL && proposals.length > 0 && (
          <div style={{ background: C.bgDone + '22', border: `2px solid ${C.success}44`, borderRadius: RADIUS.lg, padding: SP[3] }}>
            <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.success, marginBottom: SP[2], textTransform: 'uppercase', letterSpacing: '0.06em' }}>💡 הצעות ראשי צוותים</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: SP[1], maxHeight: '180px', overflowY: 'auto' }}>
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
                  })()} style={{ padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, cursor: 'pointer', background: isSel ? C.success : C.bgElevated, border: `1px solid ${isSel ? C.success : C.border}`, transition: EASE.fast }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], marginBottom: '3px' }}>
                      {p.crNumber && <span style={{ fontSize: '13px', background: C.infoBg, color: C.info, padding: '1px 7px', borderRadius: RADIUS.sm, fontWeight: WEIGHT.semibold }}>{p.crNumber}</span>}
                      <span style={{ fontSize: '15px', fontWeight: WEIGHT.semibold, color: isSel ? 'white' : C.textPrimary, flex: 1 }}>{p.title}</span>
                    </div>
                    <div style={{ display: 'flex', gap: SP[2], flexWrap: 'wrap' }}>
                      {submittingTeamName && <span style={{ fontSize: '13px', color: isSel ? 'rgba(255,255,255,0.8)' : C.textMuted }}>מגיש: {submittingTeamName}</span>}
                      {responsibleTeamName && responsibleTeamName !== submittingTeamName && (
                        <span style={{ fontSize: '13px', color: isSel ? 'rgba(255,255,255,0.9)' : C.brand, fontWeight: WEIGHT.semibold }}>אחראי: {responsibleTeamName}</span>
                      )}
                      {p.app && <span style={{ fontSize: '13px', color: isSel ? 'rgba(255,255,255,0.7)' : C.textMuted }}>{p.app}</span>}
                      {p.estimatedMins && <span style={{ fontSize: '13px', color: isSel ? 'rgba(255,255,255,0.7)' : C.warning }}>⏱ {p.estimatedMins} דק'</span>}
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
            style={{ ...inp, ...fieldErr('title'), resize: 'none', lineHeight: '1.5', fontWeight: WEIGHT.semibold, fontSize: '16px' }} />
        </div>

        <Divider />

        {/* ── Status (edit only) ── */}
        {!isAdd && (
          <div>
            <Label>סטטוס</Label>
            {readonlyStatus
              ? <span style={{ ...TEXT.sm, fontFamily: FONT, color: C.textMuted, padding: '3px 10px', borderRadius: RADIUS.full, background: C.bgNested, border: `1px solid ${C.border}`, display: 'inline-block' }}>ממתין</span>
              : <div style={{ display: 'flex', flexWrap: 'wrap', gap: SP[1] }}>
                  {STATUSES.map(s => { const sc = statusColor(s), isA = status === s; return (
                    <button key={s} onClick={() => handleStatusSave(s)} style={{ fontFamily: FONT, ...TEXT.xs, fontWeight: isA ? WEIGHT.semibold : WEIGHT.normal, padding: '4px 10px', borderRadius: RADIUS.full, cursor: 'pointer', background: isA ? sc+'20' : 'transparent', color: isA ? sc : C.textMuted, border: `1px solid ${isA ? sc+'60' : C.border}` }}>{statusLabel(s)}</button>
                  );})}
                </div>
            }
          </div>
        )}

        {/* ── צוות + אחראי ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: SP[3] }}>
          <div>
            <Label required>צוות</Label>
            <input value={teamFilter} onChange={e => setTeamFilter(e.target.value)} placeholder="סנן..."
              style={{ ...inp, fontSize: '13px', padding: '4px 8px', borderRadius: `${RADIUS.sm} ${RADIUS.sm} 0 0`, borderBottom: 'none' }} />
            <select value={teamId} onChange={e => { setTeamId(e.target.value); setAssignee(''); setApp(''); setTeamCrItems([]); }}
              disabled={!editable}
              style={{ ...inp, ...fieldErr('teamId'), cursor: 'pointer', borderRadius: `0 0 ${RADIUS.sm} ${RADIUS.sm}`, borderTop: 'none' }}>
              <option value="">— בחר צוות —</option>
              {activeTeams.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <Label required>אחראי</Label>
            <input value={userFilter} onChange={e => setUserFilter(e.target.value)} placeholder="סנן..."
              style={{ ...inp, fontSize: '13px', padding: '4px 8px', borderRadius: `${RADIUS.sm} ${RADIUS.sm} 0 0`, borderBottom: 'none' }} />
            <select value={assignee} onChange={e => setAssignee(e.target.value)}
              disabled={!editable}
              style={{ ...inp, ...fieldErr('assignee'), cursor: 'pointer', borderRadius: `0 0 ${RADIUS.sm} ${RADIUS.sm}`, borderTop: 'none' }}>
              <option value="">— בחר אחראי —</option>
              {filteredUsers.map((u: any) => <option key={u.id ?? u.fullName} value={u.fullName}>{u.fullName}</option>)}
            </select>
          </div>
        </div>

        {/* ── אפליקציה + סביבה ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: SP[3] }}>
          <div>
            <Label required>אפליקציה</Label>
            <input value={appFilter} onChange={e => setAppFilter(e.target.value)} placeholder="סנן..."
              style={{ ...inp, fontSize: '13px', padding: '4px 8px', borderRadius: `${RADIUS.sm} ${RADIUS.sm} 0 0`, borderBottom: 'none' }} />
            <select value={application} onChange={e => setApp(e.target.value)}
              disabled={!editable}
              style={{ ...inp, ...fieldErr('application'), cursor: 'pointer', borderRadius: `0 0 ${RADIUS.sm} ${RADIUS.sm}`, borderTop: 'none' }}>
              <option value="">— בחר אפליקציה —</option>
              {filteredApps.map((a: string) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <Label required>סביבה</Label>
            <select value={environment} onChange={e => setEnv(e.target.value)}
              disabled={!editable} style={{ ...inp, cursor: 'pointer' }}>
              <option value="BOTH">HOT + HOTNET</option>
              <option value="HOT">HOT בלבד</option>
              <option value="HOTNET">HOTNET בלבד</option>
            </select>
          </div>
        </div>

        {/* ── פיתוחים בגרסה (CR) ── */}
        <div>
          <Label>פיתוחים בגרסה</Label>
          <div style={{ ...errInp(errors.has('crList')), display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center', padding: '6px 10px', minHeight: '40px' }}>
            {crList.map((cr: string) => {
              const match = activeCrItems.find(c => c.id === cr);
              return (
                <span key={cr} title={match?.label ?? cr} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', background: C.infoBg, color: C.info, borderRadius: RADIUS.sm, padding: '2px 8px', fontSize: '15px', maxWidth: '260px' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{match?.label ?? cr}</span>
                  {editable && <button onClick={() => setCrList(l => l.filter(c => c !== cr))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.info, padding: 0, lineHeight: 1, fontSize: '16px', flexShrink: 0 }}>×</button>}
                </span>
              );
            })}
            {editable && (
              <input list="cr-datalist-panel" value={crInput}
                onChange={e => {
                  setCrInput(e.target.value);
                  const match = activeCrItems.find(c => c.id === e.target.value || c.label === e.target.value);
                  if (match && !crList.includes(match.id)) { setCrList(l => [...l, match.id]); setCrInput(''); }
                }}
                onKeyDown={e => { if (e.key === 'Enter' && crInput.trim()) { e.preventDefault(); if (!crList.includes(crInput.trim())) setCrList(l => [...l, crInput.trim()]); setCrInput(''); } }}
                placeholder={crList.length ? '+ הוסף' : 'הקלד CR# והקש Enter'}
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '15px', flex: 1, minWidth: '120px', color: C.textPrimary, fontFamily: FONT }}
              />
            )}
            <datalist id="cr-datalist-panel">
              {activeCrItems.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </datalist>
          </div>
          {!teamId && <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, marginTop: '3px' }}>בחר צוות כדי לסנן את הרשימה</div>}
        </div>

        {/* ── משך + התחלה + סיום (שורה אחת) ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: SP[3] }}>
          <div>
            <Label required>משך (דק')</Label>
            <input type="number" min="1" max="999" value={durationMins}
              onChange={e => { const v = e.target.value.slice(0,3); setDur(v); const m = parseInt(v); if (m > 0 && plannedStart) setEnd(calcEnd(plannedStart, m)); }}
              disabled={!editable}
              style={{ ...inp, ...fieldErr('durationMins'), textAlign: 'center', fontWeight: WEIGHT.semibold }} placeholder="דק'" />
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
          <div style={{ background: '#fff3cd', border: '1px solid #f59e0b', borderRadius: RADIUS.md, padding: `${SP[2]} ${SP[3]}`, display: 'flex', alignItems: 'flex-start', gap: SP[2] }}>
            <span style={{ fontSize: '17px', flexShrink: 0 }}>⚠️</span>
            <div>
              <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: '#92400e', fontFamily: FONT, marginBottom: '2px' }}>
                התאריך חורג מלוח הזמנים של השלב
              </div>
              <div style={{ ...TEXT.xs, color: '#78350f', fontFamily: FONT }}>{timeWarning}</div>
            </div>
          </div>
        )}

        {/* Actual dates */}
        {!isAdd && (task?.actualStart || task?.actualFinish) && (
          <div style={{ display: 'flex', gap: SP[4] }}>
            {task.actualStart  && <span style={{ ...TEXT.xs, color: C.statusDone, fontFamily: FONT }}>▶ התחיל: {fmtDT(task.actualStart)}</span>}
            {task.actualFinish && <span style={{ ...TEXT.xs, color: C.statusDone, fontFamily: FONT }}>■ הסתיים: {fmtDT(task.actualFinish)}</span>}
          </div>
        )}

        {/* ── תלויות ── */}
        <div>
          <Label>תלויות</Label>
          {deps.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: SP[2] }}>
              {deps.map((d: any) => {
                const dep = d.dependsOn; const isDone = dep?.status === 'DONE';
                return (
                  <div key={d.dependsOnTaskId} style={{ display: 'flex', alignItems: 'center', gap: SP[2], padding: '5px 10px', borderRadius: RADIUS.md, background: isDone ? C.bgDone : C.bgBlocked, border: `1px solid ${isDone ? C.statusDone+'33' : C.statusBlocked+'33'}` }}>
                    <span style={{ color: isDone ? C.statusDone : C.statusBlocked, flexShrink: 0 }}>{isDone ? '✓' : '⏳'}</span>
                    <span style={{ ...TEXT.xs, color: C.textPrimary, fontFamily: FONT, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dep?.title}</span>
                    {dep && <StatusChip status={dep.status} size="xs" />}
                    {editable && <button onClick={() => removeDep(d.dependsOnTaskId)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.danger, fontSize: '15px', padding: 0, lineHeight: 1 }}>✕</button>}
                  </div>
                );
              })}
            </div>
          )}
          {editable && eligibleTasks.filter((t: any) => !linkedIds.has(t.id)).length > 0 && (
            <div style={{ display: 'flex', gap: SP[2] }}>
              <select value={depAddId} onChange={e => setDepAddId(e.target.value)} style={{ ...inp, flex: 1, fontSize: '15px', cursor: 'pointer' }}>
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
                style={{ padding: '7px 16px', background: depAddId ? C.brand : C.bgNested, color: depAddId ? 'white' : C.textDisabled, border: 'none', borderRadius: RADIUS.md, cursor: depAddId ? 'pointer' : 'not-allowed', fontSize: '15px', fontWeight: WEIGHT.semibold, whiteSpace: 'nowrap' }}>
                + הוסף
              </button>
            </div>
          )}
        </div>

        {/* ── הערת תלות + הערות ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: SP[3] }}>
          <div>
            <Label>הערת תלות</Label>
            <input value={depNote} onChange={e => setDepNote(e.target.value)} disabled={!editable} placeholder="תלוי ב..." style={inp} />
          </div>
          <div>
            <Label>הערות כלליות</Label>
            <input value={notes} onChange={e => setNotes(e.target.value)} disabled={!editable} placeholder="הערה..." style={inp} />
          </div>
        </div>

        {/* ── סדר משימות ── */}
        <div>
          <Label>סדר בתוך תת-השלב</Label>
          <input type="number" value={orderIndex} onChange={e => setOrderIndex(e.target.value)} disabled={!editable} style={{ ...inp, width: '100px' }} />
        </div>

        {/* Alert boxes */}
        {!isAdd && task?.blockedReason && <div style={{ background: C.bgBlocked, borderRadius: RADIUS.md, padding: `${SP[2]} ${SP[3]}`, border: `1px solid ${C.statusBlocked}44` }}><div style={{ ...TEXT.xs, color: C.textOnBlockedBg, fontWeight: WEIGHT.semibold, marginBottom: '4px', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: SP[2] }}>🚫 סיבת חסימה{task?.blockedSeverity && <span style={{ background: severityBg(task.blockedSeverity), color: severityColor(task.blockedSeverity), padding: '1px 8px', borderRadius: RADIUS.full, fontWeight: WEIGHT.semibold }}>{severityLabel(task.blockedSeverity)}</span>}</div><div style={{ ...TEXT.sm, color: C.textOnBlockedBg, fontFamily: FONT }}>{task.blockedReason}</div></div>}
        {!isAdd && task?.failedReason && <div style={{ background: C.bgFailed, borderRadius: RADIUS.md, padding: `${SP[2]} ${SP[3]}`, border: `1px solid ${C.statusFailed}44` }}><div style={{ ...TEXT.xs, color: C.statusFailed, fontWeight: WEIGHT.semibold, marginBottom: '4px', fontFamily: FONT }}>✗ סיבת כישלון</div><div style={{ ...TEXT.sm, color: C.statusFailed, fontFamily: FONT }}>{task.failedReason}</div></div>}
      </div>

      {/* Footer */}
      {editable && (
        <div style={{ flexShrink: 0, padding: `${SP[3]} ${SP[4]}`, borderTop: `1px solid ${C.border}`, background: C.bgElevated, display: 'flex', direction: 'ltr', gap: SP[2], justifyContent: 'flex-end', alignItems: 'center' }}>
          {errors.size > 0 && <span style={{ ...TEXT.xs, color: C.danger, fontFamily: FONT, flex: 1, direction: 'rtl', textAlign: 'right' }}>* יש למלא את כל שדות החובה</span>}
          <button onClick={onClose} style={{ padding: '8px 20px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.lg, cursor: 'pointer', fontSize: '15px', fontFamily: FONT }}>ביטול</button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '8px 24px', background: saveOk ? C.success : C.brand, color: 'white', border: 'none', borderRadius: RADIUS.lg, cursor: saving ? 'not-allowed' : 'pointer', fontSize: '15px', fontWeight: WEIGHT.semibold, minWidth: '90px', transition: EASE.fast, fontFamily: FONT }}>
            {saving ? '...' : saveOk ? '✓ נשמר' : isAdd ? 'הוסף משימה' : 'שמור שינויים'}
          </button>
        </div>
      )}
    </div>
  );
};
