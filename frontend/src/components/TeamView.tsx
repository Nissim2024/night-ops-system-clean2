import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { usePermissions } from '../context/PermissionsContext';
import { FEATURES } from '../featureFlags';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE, statusColor, statusBg, statusLabel, severityColor, severityBg, severityLabel } from '../theme';
import { StatusChip, Badge, Avatar, Button, Spinner } from './ui';
import { formatTime } from '../utils/dateFormat';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';
import { useDialog } from '../context/DialogContext';
import { FocusModeModal } from './FocusModeModal';
import { DateTimeField } from './DatePicker';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const APPS = [
  'BILI', 'CRM', 'OSB', 'DP', 'WEB-RETAIL', 'WEB-NEXT', 'WEB-HOT',
  'TOP', 'IRB', 'NC', 'ERP', 'CONNECT', 'CREDIT GUARD', 'ARCHIVE',
  'PRINT BOSS', 'NIFI', 'CAWA', 'BEERI', 'IVR', 'MEDIATION',
  'PROVISIONING LDAP', 'PROVISIONING TIBCO', 'PROVISIONING NAGRA',
  'PROVISIONING OTT', 'PROVISIONING TEL', 'REMEDY', 'ZOO', 'אחר',
];
const TEAM_APPS: Record<string, string[]> = {
  'NETC Team':               ['BILI', 'IRB'],
  'CRM Dev Team':            ['CRM', 'TOP', 'CONNECT'],
  'EAI Team':                ['OSB', 'DP', 'MEDIATION', 'PROVISIONING LDAP', 'PROVISIONING TIBCO', 'PROVISIONING NAGRA', 'PROVISIONING OTT', 'PROVISIONING TEL'],
  'Web Dev Team':            ['WEB-RETAIL', 'WEB-NEXT', 'WEB-HOT'],
  'Operations Team':         ['NIFI', 'CAWA', 'BEERI', 'IVR', 'REMEDY', 'ZOO'],
  'Billing Operations Team': ['CREDIT GUARD', 'ARCHIVE', 'PRINT BOSS', 'BEERI'],
  'SHOB Team':               ['NIFI', 'CAWA'],
  'IVR Team':                ['IVR'],
  'OSS Team':                ['REMEDY', 'ZOO'],
};

// ── Table column widths (shared between header and rows) ──────────────────────
const COL_W = {
  check:    40,
  duration: 82,
  start:    96,
  end:      96,
  team:     116,
  assignee: 126,
  app:      100,
  status:   108,
  actions:  152,
};

interface ColDef { label: string; width?: number; flex?: boolean; center?: boolean }
const ColHead: React.FC<ColDef> = ({ label, width, flex, center }) => (
  <div style={{
    width: width ? `${width}px` : undefined,
    flex: flex ? 1 : undefined,
    flexShrink: flex ? undefined : 0,
    padding: `0 ${SP[2]}`,
    ...TEXT.xs, fontWeight: WEIGHT.semibold,
    color: C.textMuted, fontFamily: FONT,
    textAlign: (center ? 'center' : 'right') as any,
    textTransform: 'uppercase' as any,
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap' as any,
  }}>{label}</div>
);

const TaskTableHeader: React.FC<{ showActions: boolean }> = ({ showActions }) => (
  <div style={{
    display: 'flex', alignItems: 'center',
    background: C.bgCard,
    borderBottom: `2px solid ${C.border}`,
    padding: `${SP[1]} 0`,
    position: 'sticky', top: 0, zIndex: 5,
    userSelect: 'none' as any,
  }}>
    <div style={{ width: `${COL_W.check}px`, flexShrink: 0 }} />
    <ColHead label="שם משימה" flex />
    <ColHead label="משך"       width={COL_W.duration} center />
    <ColHead label="התחלה"    width={COL_W.start} />
    <ColHead label="סיום"     width={COL_W.end} />
    <ColHead label="צוות"     width={COL_W.team} />
    <ColHead label="אחראי"    width={COL_W.assignee} />
    <ColHead label="אפליקציה" width={COL_W.app} />
    <ColHead label="סטטוס"    width={COL_W.status} />
    {showActions && <ColHead label="פעולות" width={COL_W.actions} />}
  </div>
);

// Module-level component — avoids re-mount on parent re-render, fixing focus loss
const BlockedReasonForm: React.FC<{
  onSubmit: (reason: string, severity: string) => void;
  onCancel: () => void;
}> = ({ onSubmit, onCancel }) => {
  const [reason, setReason] = useState('');
  const [severity, setSeverity] = useState('MEDIUM');
  return (
    <div style={{ marginTop: '8px', padding: '10px', background: C.bgBlocked, borderRadius: '8px', border: `1px solid ${C.statusBlocked}66` }}>
      <input
        autoFocus
        placeholder="סיבת החסימה *"
        value={reason}
        onChange={e => setReason(e.target.value)}
        style={{ width: '100%', padding: '7px', border: `1px solid ${C.border}`, borderRadius: '6px', fontSize: '15px', marginBottom: '6px', boxSizing: 'border-box', background: C.bgNested, color: C.textPrimary, fontFamily: FONT }}
      />
      <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
        {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map(sev => (
          <button key={sev} onClick={() => setSeverity(sev)}
            style={{
              flex: 1, padding: '4px 2px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', fontFamily: FONT,
              border: `1.5px solid ${severity === sev ? severityColor(sev) : C.border}`,
              background: severity === sev ? severityBg(sev) : C.bgNested,
              color: severity === sev ? severityColor(sev) : C.textSecondary,
            }}>
            {severityLabel(sev)}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={() => onSubmit(reason, severity)} disabled={!reason}
          style={{ padding: '5px 14px', background: reason ? C.statusBlocked : C.textDisabled, color: 'white', border: 'none', borderRadius: '6px', cursor: reason ? 'pointer' : 'not-allowed', fontSize: '14px' }}>
          דווח חסימה
        </button>
        <button onClick={onCancel}
          style={{ padding: '5px 14px', background: C.bgNested, color: C.textPrimary, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>
          ביטול
        </button>
      </div>
    </div>
  );
};

// Keep for backwards compat with any remaining inline usage
const STATUS_COLORS: Record<string, string> = {
  WAITING: C.statusWaiting, OPEN: C.statusOpen, IN_PROGRESS: C.statusInProgress,
  BLOCKED: C.statusBlocked, DONE: C.statusDone, FAILED: C.statusFailed, ROLLED_BACK: C.statusRollback,
};
const STATUS_LABELS: Record<string, string> = {
  WAITING: 'ממתין', OPEN: 'פתוח', IN_PROGRESS: 'בביצוע',
  BLOCKED: 'חסום', DONE: 'הושלם', FAILED: 'נכשל', ROLLED_BACK: 'Rollback',
};

const DELAY_THRESHOLD = 2;

const DELAY_REASONS = [
  'תקלה טכנית בלתי צפויה',
  'תלות שלא הושלמה בזמן',
  'בדיקות / Rollback נדרשו',
  'בעיית גישה / הרשאות',
  'עיכוב בצוות / לא ענו',
  'בעיית תקשורת / רשת',
  'בעיית סביבה / תשתית',
  'תיאום בעיה עם צוות אחר',
  'לא סומן בזמן (בוצע אך לא עודכן)',
  'אחר',
];

const TERMINAL = new Set(['DONE', 'FAILED', 'ROLLED_BACK']);

const sortTasks = (list: any[]): any[] =>
  [...list].sort((a, b) => {
    const aDone = TERMINAL.has(a.status) ? 1 : 0;
    const bDone = TERMINAL.has(b.status) ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
  });

const parseDurationMins = (dur: string): number | null => {
  if (!dur) return null;
  const hM = dur.match(/(\d+)ש/);
  const mM = dur.match(/(\d+)ד/);
  if (hM || mM) return (hM ? +hM[1] * 60 : 0) + (mM ? +mM[1] : 0);
  const eng = dur.match(/(\d+)\s*min/i);
  if (eng) return +eng[1];
  const n = parseInt(dur);
  return isNaN(n) ? null : n;
};

// While a task has rehearsal-specific planned times (only populated during an active
// rehearsal — cleared on endRehearsal), compare actuals against those instead of the
// production plannedStart/End, which may fall on a completely different day/time.
const effPlannedStart = (task: any): string | null => task.rehearsalPlannedStart ?? task.plannedStart ?? null;
const effPlannedEnd   = (task: any): string | null => task.rehearsalPlannedEnd   ?? task.plannedEnd   ?? null;

const plannedMins = (task: any): number | null => {
  const f = parseDurationMins(task.duration || '');
  if (f) return f;
  const start = effPlannedStart(task), end = effPlannedEnd(task);
  if (start && end) {
    const d = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
    return d > 0 ? d : null;
  }
  return null;
};

const actualMins = (task: any): number | null => {
  if (!task.actualStart) return null;
  const end = task.actualFinish ? new Date(task.actualFinish) : new Date();
  const d = Math.round((end.getTime() - new Date(task.actualStart).getTime()) / 60000);
  return d > 0 ? d : null;
};

const isDelayed = (task: any): boolean => {
  const p = plannedMins(task);
  const a = actualMins(task);
  return !!(p && a && a >= p * DELAY_THRESHOLD);
};

const fmtTime = (iso: string) => iso ? formatTime(iso) : '';

// Task hasn't started yet but planned start has already passed
const isOverdue = (task: any): boolean => {
  const start = effPlannedStart(task);
  if (!start) return false;
  if (['IN_PROGRESS', 'DONE', 'FAILED', 'ROLLED_BACK'].includes(task.status)) return false;
  return new Date(start) < new Date();
};

// Task is still running but planned end has already passed
const isOvertime = (task: any): boolean => {
  if (task.status !== 'IN_PROGRESS') return false;
  const start = effPlannedStart(task);
  const endIso = effPlannedEnd(task) || (() => {
    const mins = parseDurationMins(task.duration || '');
    if (mins && start) return new Date(new Date(start).getTime() + mins * 60000).toISOString();
    return null;
  })();
  return !!(endIso && new Date(endIso) < new Date());
};

// Task started after its planned start time
const isLateStart = (task: any): boolean => {
  const start = effPlannedStart(task);
  if (!start || !task.actualStart) return false;
  return new Date(task.actualStart) > new Date(new Date(start).getTime() + 5 * 60000);
};

interface Props {
  token: string;
  teamId?: string;
  teamName?: string;
  versionId?: string;
  userId?: string;
  userName?: string;
  refreshKey?: number;
  hideAddTask?: boolean;
  hideFocusMode?: boolean;
  onTaskUpdated?: () => void;
  onSummaryReady?: (ready: boolean) => void;
  onCurrentPhaseChange?: (phaseName: string | null) => void;
  onOpenReschedule?: () => void;
  onGoHome?: () => void;
}

const emptyForm = { title: '', notes: '', crNumber: '', application: '', priority: 'MEDIUM', assignedUserName: '' };

// ── Sub-components at module level — stable references prevent unmount/remount on parent re-render ──

interface DelayPanelProps {
  task: any;
  delayState: Record<string, { category: string; freeText: string }>;
  setDelayState: React.Dispatch<React.SetStateAction<Record<string, { category: string; freeText: string }>>>;
  onSave: (taskId: string) => void;
}

const DelayPanel: React.FC<DelayPanelProps> = ({ task, delayState, setDelayState, onSave }) => {
  if (task.delayReason) {
    return (
      <div style={{ marginTop: '6px', fontSize: '14px', color: C.statusInProgress, background: C.bgInProgress, padding: '5px 10px', borderRadius: '6px' }}>
        ⚠️ סיבת עיכוב: {task.delayReason}
      </div>
    );
  }
  if (!isDelayed(task)) return null;
  const ds = delayState[task.id] || { category: '', freeText: '' };
  return (
    <div style={{ marginTop: '8px', padding: '10px', background: C.bgInProgress, borderRadius: '8px', border: `1px solid ${C.statusInProgress}66` }}>
      <div style={{ fontSize: '14px', fontWeight: 'bold', color: C.statusInProgress, marginBottom: '6px' }}>
        ⚠️ עיכוב: {actualMins(task)} דק' בפועל / {plannedMins(task)} דק' מתוכנן — נא לציין סיבה
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <select
          value={ds.category}
          onChange={e => setDelayState(p => ({ ...p, [task.id]: { ...ds, category: e.target.value } }))}
          style={{ padding: '5px', border: `1px solid ${C.border}`, borderRadius: '6px', fontSize: '14px', direction: 'rtl', background: C.bgNested, color: C.textPrimary }}
        >
          <option value="">— בחר סיבה —</option>
          {DELAY_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <input
          placeholder="פירוט נוסף (אופציונלי)"
          value={ds.freeText}
          onChange={e => setDelayState(p => ({ ...p, [task.id]: { ...ds, freeText: e.target.value } }))}
          style={{ flex: 1, minWidth: '150px', padding: '5px 8px', border: `1px solid ${C.border}`, borderRadius: '6px', fontSize: '14px', background: C.bgNested, color: C.textPrimary }}
        />
        <button
          onClick={() => onSave(task.id)}
          disabled={!ds.category}
          style={{ padding: '5px 12px', background: ds.category ? C.statusInProgress : C.textDisabled, color: 'white', border: 'none', borderRadius: '6px', cursor: ds.category ? 'pointer' : 'not-allowed', fontSize: '14px', fontWeight: 'bold', whiteSpace: 'nowrap' }}
        >
          שמור
        </button>
      </div>
    </div>
  );
};

interface FailureReasonItem { id: string; reason: string; requiresRollback: boolean; }

interface TaskRowSharedProps {
  isExecutionMode: boolean;
  isManager: boolean;
  blockedPhaseTaskIds: Set<string>;
  selectedTaskIds: Set<string>;
  onToggleSelect: (id: string) => void;
  updatingId: string | null;
  onUpdateStatus: (taskId: string, status: string, reason?: string, failedReason?: string, severity?: string) => void;
  showBlockedInput: string | null;
  onSetShowBlockedInput: (id: string | null) => void;
  delayState: Record<string, { category: string; freeText: string }>;
  setDelayState: React.Dispatch<React.SetStateAction<Record<string, { category: string; freeText: string }>>>;
  onSaveDelayReason: (taskId: string) => void;
  failureReasons: FailureReasonItem[];
  onRollbackWarning: (taskTitle: string, reason: string) => void;
}

const TaskRow: React.FC<{ task: any } & TaskRowSharedProps> = ({
  task, isExecutionMode, isManager, blockedPhaseTaskIds, selectedTaskIds, onToggleSelect, updatingId,
  onUpdateStatus, showBlockedInput, onSetShowBlockedInput,
  delayState, setDelayState, onSaveDelayReason,
  failureReasons, onRollbackWarning,
}) => {
  const [showFailedDialog, setShowFailedDialog] = useState(false);
  const [selectedFailedReason, setSelectedFailedReason] = useState('');

  const isSelected = selectedTaskIds.has(task.id);
  const delayed = isDelayed(task);
  const overdue = isOverdue(task);
  const overtime = isOvertime(task);
  const isActive = task.status === 'OPEN' || task.status === 'IN_PROGRESS';
  const isDone = TERMINAL.has(task.status);

  const submitFailed = () => {
    const chosen = failureReasons.find(r => r.reason === selectedFailedReason);
    onUpdateStatus(task.id, 'FAILED', undefined, selectedFailedReason || undefined);
    if (chosen?.requiresRollback) onRollbackWarning(task.title, selectedFailedReason);
    setShowFailedDialog(false);
    setSelectedFailedReason('');
  };

  const sColor = statusColor(task.status);
  const [hov, setHov] = useState(false);

  return (
    <div id={`task-row-${task.id}`} style={{ borderRight: `3px solid ${sColor}` }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>

      {/* ── Table row ── */}
      <div style={{
        display: 'flex', alignItems: 'center', minHeight: '40px',
        background: isSelected ? C.bgActive : overtime ? C.bgBlocked : overdue ? 'rgba(232,175,0,0.06)' : hov ? C.bgHover : C.bgCard,
        borderBottom: `1px solid ${C.border}`,
        transition: EASE.fast,
        boxShadow: isSelected ? SHADOW.brand : undefined,
        cursor: 'default',
      }}>

        {/* Col: Checkbox */}
        <div style={{ width: `${COL_W.check}px`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {isExecutionMode ? (
            <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(task.id)}
              style={{ cursor: 'pointer', width: '15px', height: '15px', accentColor: C.brand }} />
          ) : (
            <div style={{
              width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
              border: `2px solid ${sColor}55`, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {isDone && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke={sColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </div>
          )}
        </div>

        {/* Col: Name */}
        <div style={{ flex: 1, minWidth: 0, padding: `0 ${SP[2]}`, display: 'flex', alignItems: 'center', gap: SP[2] }}>
          <span style={{
            ...TEXT.sm, fontWeight: WEIGHT.medium, fontFamily: FONT,
            color: isDone ? C.textDisabled : C.textPrimary,
            textDecoration: isDone ? 'line-through' : 'none',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          }}>
            {task.isCritical && <span style={{ color: C.statusBlocked, marginLeft: '4px', fontSize: '11px' }}>●</span>}
            {task.title}
          </span>
          {task.crNumber && <span style={{ ...TEXT.xs, color: C.info, background: C.infoBg, padding: '1px 6px', borderRadius: RADIUS.sm, whiteSpace: 'nowrap', flexShrink: 0 }}>{task.crNumber}</span>}
          {overtime && <span style={{ ...TEXT.xs, background: C.bgBlocked, color: C.statusBlocked, padding: '1px 5px', borderRadius: RADIUS.sm, whiteSpace: 'nowrap', flexShrink: 0 }}>⏱ חריגה</span>}
          {overdue && !overtime && <span style={{ ...TEXT.xs, background: C.bgInProgress, color: C.warning, padding: '1px 5px', borderRadius: RADIUS.sm, whiteSpace: 'nowrap', flexShrink: 0 }}>🕐 מאחר</span>}
          {delayed && !task.delayReason && !overtime && <span style={{ ...TEXT.xs, background: C.bgBlocked, color: C.statusBlocked, padding: '1px 5px', borderRadius: RADIUS.sm, whiteSpace: 'nowrap', flexShrink: 0 }}>⚠️ עיכוב</span>}
        </div>

        {/* Col: Duration */}
        <div style={{ width: `${COL_W.duration}px`, flexShrink: 0, padding: `0 ${SP[2]}`, textAlign: 'center' }}>
          <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>{task.duration || '—'}</span>
        </div>

        {/* Col: Start */}
        <div style={{ width: `${COL_W.start}px`, flexShrink: 0, padding: `0 ${SP[2]}` }}>
          {task.plannedStart && (
            <span style={{ ...TEXT.xs, color: overdue ? C.warning : C.textMuted, fontFamily: FONT, display: 'block' }}>
              {fmtTime(task.plannedStart)}
            </span>
          )}
          {task.actualStart && isExecutionMode && (
            <span style={{ ...TEXT.xs, color: C.statusDone, fontFamily: FONT, display: 'block' }}>▶ {fmtTime(task.actualStart)}</span>
          )}
        </div>

        {/* Col: End */}
        <div style={{ width: `${COL_W.end}px`, flexShrink: 0, padding: `0 ${SP[2]}` }}>
          {task.plannedEnd && (
            <span style={{ ...TEXT.xs, color: overtime ? C.statusBlocked : C.textMuted, fontFamily: FONT, display: 'block' }}>
              {fmtTime(task.plannedEnd)}
            </span>
          )}
          {task.actualFinish && isExecutionMode && (
            <span style={{ ...TEXT.xs, color: C.statusDone, fontFamily: FONT, display: 'block' }}>■ {fmtTime(task.actualFinish)}</span>
          )}
        </div>

        {/* Col: Team */}
        <div style={{ width: `${COL_W.team}px`, flexShrink: 0, padding: `0 ${SP[2]}`, overflow: 'hidden' }}>
          {task.assignedTeam?.name && (
            <span style={{
              ...TEXT.xs, color: C.brand, background: C.brandDim, fontFamily: FONT,
              padding: '2px 7px', borderRadius: RADIUS.sm,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
            }}>
              {task.assignedTeam.name}
            </span>
          )}
        </div>

        {/* Col: Assignee */}
        <div style={{ width: `${COL_W.assignee}px`, flexShrink: 0, padding: `0 ${SP[2]}`, display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden', direction: 'ltr' }}>
          {task.assignedUserName && (
            <>
              <Avatar name={task.assignedUserName} size={20} />
              <span style={{ ...TEXT.xs, color: C.textSecondary, fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {task.assignedUserName.split(' ')[0]}
              </span>
            </>
          )}
        </div>

        {/* Col: Application */}
        <div style={{ width: `${COL_W.app}px`, flexShrink: 0, padding: `0 ${SP[2]}`, overflow: 'hidden' }}>
          {task.application && (
            <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
              {task.application}
            </span>
          )}
        </div>

        {/* Col: Status */}
        <div style={{ width: `${COL_W.status}px`, flexShrink: 0, padding: `0 ${SP[2]}` }}>
          <StatusChip status={task.status} size="xs" dot />
        </div>

        {/* Col: Actions (execution only) */}
        {isExecutionMode && (
          <div style={{ width: `${COL_W.actions}px`, flexShrink: 0, padding: `${SP[1]} ${SP[2]}`, display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {!isDone ? (
              <>
                {task.status === 'WAITING' && isManager && (() => {
                  const phaseBlocked = blockedPhaseTaskIds.has(task.id);
                  return (
                    <button onClick={() => !phaseBlocked && onUpdateStatus(task.id, 'OPEN')}
                      disabled={updatingId === task.id || phaseBlocked}
                      title={phaseBlocked ? 'השלב הקודם טרם הסתיים' : undefined}
                      style={{
                        fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold,
                        padding: '6px 8px',
                        background: phaseBlocked ? C.bgActive : `linear-gradient(135deg,${C.brand},#2563eb)`,
                        color: phaseBlocked ? C.textDisabled : 'white',
                        border: 'none', borderRadius: RADIUS.md,
                        cursor: phaseBlocked ? 'not-allowed' : 'pointer',
                        boxShadow: phaseBlocked ? 'none' : `0 2px 6px rgba(56,139,253,0.30)`,
                      }}>
                      {phaseBlocked ? '⏳ ממתין' : '▷ פתח לביצוע'}
                    </button>
                  );
                })()}
                {task.status === 'OPEN' && (() => {
                  const phaseBlocked = blockedPhaseTaskIds.has(task.id);
                  return (
                    <button onClick={() => !phaseBlocked && onUpdateStatus(task.id, 'IN_PROGRESS')}
                      disabled={updatingId === task.id || phaseBlocked}
                      title={phaseBlocked ? 'השלב הקודם טרם הסתיים' : undefined}
                      style={{
                        fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold, padding: '6px 8px',
                        background: phaseBlocked ? C.bgActive : `linear-gradient(135deg,${C.statusInProgress},#b07d1e)`,
                        color: phaseBlocked ? C.textDisabled : 'white',
                        border: 'none', borderRadius: RADIUS.md,
                        cursor: phaseBlocked ? 'not-allowed' : 'pointer',
                        boxShadow: phaseBlocked ? 'none' : `0 2px 6px rgba(227,179,65,0.25)`,
                      }}>
                      {phaseBlocked ? '⏳ ממתין' : '▶ התחל'}
                    </button>
                  );
                })()}
                {task.status === 'IN_PROGRESS' && (
                  <button onClick={() => onUpdateStatus(task.id, 'DONE')} disabled={updatingId === task.id}
                    style={{ fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold, padding: '6px 8px', background: `linear-gradient(135deg,${C.statusDone},#2ea043)`, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', boxShadow: `0 2px 6px rgba(86,211,100,0.22)` }}>
                    ✓ סיים
                  </button>
                )}
                {task.status === 'BLOCKED' && (
                  <button onClick={() => onUpdateStatus(task.id, 'IN_PROGRESS')} disabled={updatingId === task.id}
                    style={{ fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold, padding: '6px 8px', background: C.bgActive, color: C.success, border: `1px solid ${C.success}44`, borderRadius: RADIUS.md, cursor: 'pointer' }}>
                    ♻️ חזור לביצוע
                  </button>
                )}
                {(task.status === 'OPEN' || task.status === 'IN_PROGRESS') && (
                  <button onClick={() => onSetShowBlockedInput(task.id)}
                    style={{ fontFamily: FONT, ...TEXT.xs, padding: '5px 8px', background: 'transparent', color: C.statusBlocked, border: `1px solid ${C.statusBlocked}`, borderRadius: RADIUS.md, cursor: 'pointer' }}>
                    🚫 חסום
                  </button>
                )}
                {task.status === 'BLOCKED' && (
                  <button onClick={() => failureReasons.length > 0 ? setShowFailedDialog(true) : onUpdateStatus(task.id, 'FAILED')} disabled={updatingId === task.id}
                    style={{ fontFamily: FONT, ...TEXT.xs, padding: '5px 8px', background: 'transparent', color: C.statusRollback, border: `1px solid ${C.statusRollback}`, borderRadius: RADIUS.md, cursor: 'pointer' }}>
                    ✗ נכשל
                  </button>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', fontSize: '22px', color: sColor, lineHeight: 1 }}>
                {task.status === 'DONE' ? '✓' : task.status === 'FAILED' ? '✗' : '↩'}
              </div>
            )}
          </div>
        )}
      </div>{/* end table row */}

      {/* ── Sub-row: blocked reason input ── */}
      {showBlockedInput === task.id && (
        <BlockedReasonForm
          onSubmit={(reason, severity) => { onUpdateStatus(task.id, 'BLOCKED', reason, undefined, severity); }}
          onCancel={() => onSetShowBlockedInput(null)}
        />
      )}
      {task.blockedReason && task.status === 'BLOCKED' && (
        <div style={{ ...TEXT.xs, color: C.textOnBlockedBg, background: C.bgBlocked, padding: `${SP[1]} ${SP[4]}`, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: SP[2] }}>
          🚫 {task.blockedReason}
          {task.blockedSeverity && (
            <span style={{ background: severityBg(task.blockedSeverity), color: severityColor(task.blockedSeverity), padding: '1px 8px', borderRadius: RADIUS.full, fontWeight: WEIGHT.semibold }}>
              {severityLabel(task.blockedSeverity)}
            </span>
          )}
        </div>
      )}


      {/* Failure reason dialog */}
      {showFailedDialog && (
        <div style={{ marginTop: '8px', padding: '12px', background: C.bgBlocked, borderRadius: '8px', border: `1px solid ${C.statusBlocked}66` }}>
          <div style={{ fontSize: '14px', fontWeight: 'bold', color: C.statusBlocked, marginBottom: '8px' }}>
            ✗ סיבת כישלון — בחר מהרשימה *
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px', maxHeight: '180px', overflowY: 'auto' }}>
            {failureReasons.map(fr => (
              <label key={fr.id}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer',
                  background: selectedFailedReason === fr.reason ? (fr.requiresRollback ? C.bgBlocked : C.bgNested) : 'transparent',
                  border: `1px solid ${selectedFailedReason === fr.reason ? (fr.requiresRollback ? C.statusBlocked : C.brand) : C.border}` }}>
                <input type="radio" name={`failed-${task.id}`} value={fr.reason}
                  checked={selectedFailedReason === fr.reason}
                  onChange={() => setSelectedFailedReason(fr.reason)}
                  style={{ cursor: 'pointer' }} />
                <span style={{ fontSize: '14px', color: C.textPrimary, flex: 1 }}>{fr.reason}</span>
                {fr.requiresRollback && (
                  <span style={{ fontSize: '12px', background: C.statusBlocked, color: 'white', padding: '1px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                    ⚠️ מחייב Rollback
                  </span>
                )}
              </label>
            ))}
          </div>
          {selectedFailedReason && failureReasons.find(r => r.reason === selectedFailedReason)?.requiresRollback && (
            <div style={{ fontSize: '13px', color: C.statusBlocked, background: C.bgBlocked, padding: '6px 10px', borderRadius: '6px', marginBottom: '8px', border: `1px solid ${C.statusBlocked}44` }}>
              ⚠️ סיבה זו מחייבת ביצוע Rollback לגרסה. לאחר שמירה, פנה למנהל הלילה לביצוע Rollback.
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={submitFailed} disabled={!selectedFailedReason || updatingId === task.id}
              style={{ padding: '5px 16px', background: selectedFailedReason ? C.statusBlocked : C.textDisabled, color: 'white', border: 'none', borderRadius: '6px', cursor: selectedFailedReason ? 'pointer' : 'not-allowed', fontSize: '14px', fontWeight: 'bold' }}>
              ✗ אשר כישלון
            </button>
            <button onClick={() => { setShowFailedDialog(false); setSelectedFailedReason(''); }}
              style={{ padding: '5px 12px', background: C.bgNested, color: C.textPrimary, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>
              ביטול
            </button>
          </div>
        </div>
      )}

      {/* Show stored failed reason */}
      {task.failedReason && task.status === 'FAILED' && (
        <div style={{ marginTop: '5px', fontSize: '14px', color: C.statusFailed, display: 'flex', alignItems: 'center', gap: '6px' }}>
          ✗ סיבת כישלון: <strong>{task.failedReason}</strong>
          {failureReasons.find(r => r.reason === task.failedReason)?.requiresRollback && (
            <span style={{ background: C.statusBlocked, color: 'white', fontSize: '12px', padding: '1px 6px', borderRadius: '4px' }}>⚠️ מחייב Rollback</span>
          )}
        </div>
      )}

      <DelayPanel task={task} delayState={delayState} setDelayState={setDelayState} onSave={onSaveDelayReason} />
    </div>
  );
};

export const TeamView: React.FC<Props> = ({ token, teamId, teamName, versionId, userId, userName, refreshKey, hideAddTask, hideFocusMode, onTaskUpdated, onSummaryReady, onCurrentPhaseChange, onOpenReschedule, onGoHome }) => {
  const dialog  = useDialog();
  const { can } = usePermissions();
  const canSelectAll = can('action:select_all_tasks');
  const payload = JSON.parse(atob(token.split('.')[1]));
  const myUserId = userId ?? payload.sub;
  const myUserName = (userName ?? payload.fullName ?? '').trim().toLowerCase();
  const [tasks, setTasks]           = useState<any[]>([]);
  const [versionData, setVersionData] = useState<any>(null);
  const [loading, setLoading]       = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [focusMode, setFocusMode]   = useState(false);
  const [showBlockedInput, setShowBlockedInput] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm]             = useState(emptyForm);
  const [adding, setAdding]         = useState(false);
  const [addError, setAddError]     = useState<string | null>(null);
  const [proposals, setProposals]   = useState<any[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [delayState, setDelayState] = useState<Record<string, { category: string; freeText: string }>>({});
  const [localTeamFilter, setLocalTeamFilter] = useState<string | null>(teamId || null);
  const [localStatusFilter, setLocalStatusFilter] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [collapsedSubs, setCollapsedSubs] = useState<Set<string>>(new Set());
  const initialCollapseSet = React.useRef(false);
  const [expandedCompleted, setExpandedCompleted] = useState<Set<string>>(new Set()); // per subPhaseId or 'flat'
  const [users, setUsers] = useState<{ id: string; fullName: string }[]>([]);
  const [teamData, setTeamData] = useState<any>(null);
  const [failureReasons, setFailureReasons] = useState<FailureReasonItem[]>([]);
  const [rollbackWarning, setRollbackWarning] = useState<{ taskTitle: string; reason: string } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<DialogConfig | null>(null);
  const [showAnomalies, setShowAnomalies] = useState(false);
  const [anomalyEditIdx, setAnomalyEditIdx] = useState<number | null>(null);
  const [anomalyEditForm, setAnomalyEditForm] = useState({
    plannedStart: '', plannedEnd: '', duration: '',
    assignedUserName: '', blockedReason: '', delayReason: '',
  });

  const openAnomalyEdit = (idx: number, task: any) => {
    setAnomalyEditIdx(prev => prev === idx ? null : idx);
    setAnomalyEditForm({
      plannedStart: task.plannedStart ? new Date(task.plannedStart).toISOString().slice(0, 16) : '',
      plannedEnd:   task.plannedEnd   ? new Date(task.plannedEnd).toISOString().slice(0, 16)   : '',
      duration:     task.duration || '',
      assignedUserName: task.assignedUserName || '',
      blockedReason:    task.blockedReason    || '',
      delayReason:      task.delayReason      || '',
    });
  };

  const saveAnomalyFields = async (taskId: string, fields: Record<string, any>) => {
    await axios.patch(`${API}/tasks/${taskId}`, fields, { headers });
    setAnomalyEditIdx(null);
    fetchTasks();
  };

  const [depToast, setDepToast] = useState<{ subPhaseName: string; phaseName: string; deltaMinutes: number }[] | null>(null);
  const depToastTimer = React.useRef<any>(null);
  const showDepToast = (affected: any[]) => {
    if (!affected?.length) return;
    if (depToastTimer.current) clearTimeout(depToastTimer.current);
    setDepToast(affected);
    depToastTimer.current = setTimeout(() => setDepToast(null), 6000);
  };

  const removeDependency = async (taskId: string, dependsOnTaskId: string) => {
    const res = await axios.post(`${API}/versions/tasks/${taskId}/dependencies/remove`, { dependsOnTaskId }, { headers });
    const affected = res.data?.affected ?? [];
    showDepToast(affected.length > 0 ? affected : [{ subPhaseName: '', phaseName: '', deltaMinutes: 0, action: 'הסרה' }]);
    fetchTasks();
  };

  const [autoScheduling, setAutoScheduling] = useState(false);
  const [autoScheduleResult, setAutoScheduleResult] = useState<{ count: number; names: string[]; cycles: string[] } | null>(null);

  const autoSchedule = async () => {
    setAutoScheduling(true);
    try {
      // 1. Topological sort עם זיהוי מעגלים
      const color: Record<string, 0 | 1 | 2> = {};
      const topoOrder: string[] = [];
      const cycleTaskIds = new Set<string>();
      const getDepIds = (t: any): string[] => t.dependencies?.map((d: any) => d.dependsOnTaskId) || [];

      const dfs = (id: string) => {
        if (color[id] === 2) return;
        if (color[id] === 1) { cycleTaskIds.add(id); return; }
        color[id] = 1;
        const t = tasks.find(x => x.id === id);
        for (const depId of getDepIds(t)) {
          if (color[depId] === 1) cycleTaskIds.add(depId);
          dfs(depId);
          if (cycleTaskIds.has(depId)) cycleTaskIds.add(id);
        }
        color[id] = 2;
        topoOrder.push(id);
      };
      for (const t of tasks) dfs(t.id);

      // 2. מעבר לפי סדר טופולוגי — חישוב זמנים
      const computed = new Map<string, { start: Date | null; end: Date | null }>();
      const versionStart = versionData?.plannedStart ? new Date(versionData.plannedStart) : null;

      for (const taskId of topoOrder) {
        const task = tasks.find(t => t.id === taskId);
        if (!task) continue;

        // משימה שכבר בביצוע או הושלמה — משמשת כעוגן בלבד, לא נשנה אותה
        if (task.status === 'IN_PROGRESS' || task.status === 'DONE' || task.startedAt) {
          const anchorStart = task.startedAt ? new Date(task.startedAt)
            : (task.plannedStart ? new Date(task.plannedStart) : null);
          const anchorEnd = task.completedAt ? new Date(task.completedAt)
            : (task.plannedEnd ? new Date(task.plannedEnd) : null);
          computed.set(taskId, { start: anchorStart, end: anchorEnd });
          continue;
        }

        let start: Date | null = task.plannedStart ? new Date(task.plannedStart) : null;

        // דחוף את ההתחלה אחרי סיום כל התלויות
        for (const dep of (task.dependencies || [])) {
          const depComp = computed.get(dep.dependsOnTaskId);
          const depEnd = depComp?.end
            ?? (dep.dependsOn?.plannedEnd ? new Date(dep.dependsOn.plannedEnd) : null);
          if (depEnd && (!start || depEnd > start)) {
            start = new Date(depEnd.getTime());
          }
        }

        // אם עדיין אין שעת התחלה — השתמש בשעת תחילת הגרסה כברירת מחדל
        if (!start && versionStart) {
          start = new Date(versionStart.getTime());
        }

        let end: Date | null = null;
        if (start) {
          const mins = parseDurationMins(task.duration || '');
          if (mins) {
            end = new Date(start.getTime() + mins * 60000);
          } else if (task.plannedEnd) {
            end = new Date(task.plannedEnd);
          }
        }

        computed.set(taskId, { start, end });
      }

      // 3. עדכון רק משימות שהשתנו (ולא כאלה שבביצוע / הושלמו)
      const updatedNames: string[] = [];
      await Promise.all(
        Array.from(computed.entries()).map(([taskId, { start, end }]) => {
          const task = tasks.find(t => t.id === taskId);
          if (!task) return Promise.resolve();
          if (task.status === 'IN_PROGRESS' || task.status === 'DONE' || task.startedAt) return Promise.resolve();
          const fields: any = {};
          const existStart = task.plannedStart ? new Date(task.plannedStart).getTime() : null;
          const existEnd   = task.plannedEnd   ? new Date(task.plannedEnd).getTime()   : null;
          if (start && start.getTime() !== existStart) fields.plannedStart = start.toISOString();
          if (end   && end.getTime()   !== existEnd)   fields.plannedEnd   = end.toISOString();
          if (!Object.keys(fields).length) return Promise.resolve();
          updatedNames.push(task.title);
          return axios.patch(`${API}/tasks/${taskId}`, fields, { headers }).catch(console.error);
        })
      );

      const cycleNames = Array.from(cycleTaskIds)
        .map(id => tasks.find(t => t.id === id)?.title)
        .filter(Boolean) as string[];

      setAutoScheduleResult({ count: updatedNames.length, names: updatedNames, cycles: cycleNames });
      fetchTasks();
      onTaskUpdated?.();
    } finally {
      setAutoScheduling(false);
    }
  };

  const headers = { Authorization: `Bearer ${token}` };

  const fetchTasks = async () => {
    setLoading(true);
    try {
      if (versionId) {
        const [tasksRes, verRes] = await Promise.all([
          axios.get(`${API}/tasks?versionId=${versionId}`, { headers }),
          axios.get(`${API}/versions/${versionId}`, { headers }),
        ]);
        setTasks(tasksRes.data);
        setVersionData(verRes.data);
        // Collapse all phases by default on first load
        if (!initialCollapseSet.current && verRes.data?.phases?.length) {
          initialCollapseSet.current = true;
          setCollapsedPhases(new Set(verRes.data.phases.map((p: any) => p.id)));
        }
      } else {
        const params = new URLSearchParams();
        if (teamId) params.set('teamId', teamId);
        const res = await axios.get(`${API}/tasks?${params.toString()}`, { headers });
        setTasks(res.data);
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchTasks();
    axios.get(`${API}/users`, { headers })
      .then(r => setUsers(r.data.filter((u: any) => u.active).sort((a: any, b: any) => a.fullName.localeCompare(b.fullName, 'he'))))
      .catch(() => {});
    if (teamId) {
      axios.get(`${API}/teams/${teamId}`, { headers })
        .then(r => setTeamData(r.data))
        .catch(() => {});
    }
    axios.get(`${API}/failure-reasons`, { headers })
      .then(r => setFailureReasons(r.data.filter((fr: any) => fr.isActive)))
      .catch(() => {});
  }, [teamId, versionId, refreshKey]); // eslint-disable-line

  const fetchProposals = async () => {
    if (!FEATURES.TEAM_LEAD_PROPOSAL || !versionId) return;
    try {
      const res = await axios.get(`${API}/task-proposals/version/${versionId}`, { headers });
      setProposals(res.data.filter((p: any) => !p.usedInTaskId));
    } catch { /* silent — EMPLOYEE role will get 403, that's fine */ }
  };

  // Auto-open anomaly panel in planning mode; clear stale task selection
  useEffect(() => {
    if (versionData && !['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(versionData.status)) {
      setShowAnomalies(true);
      setSelectedTaskIds(new Set());
      fetchProposals();
    }
  }, [versionData?.id]); // eslint-disable-line

  // Notify parent when all required tasks are done (for "go to summary" button)
  // Also report current phase name
  useEffect(() => {
    if (!versionData || tasks.length === 0) return;
    const vStatus = versionData.status;

    // Build subPhaseId → phase.orderIndex and phase.name maps
    const subToOrder: Record<string, number> = {};
    const subToPhase: Record<string, string> = {};
    for (const phase of (versionData.phases || [])) {
      for (const sub of (phase.subPhases || [])) {
        subToOrder[sub.id] = phase.orderIndex;
        subToPhase[sub.id] = phase.name;
      }
    }

    if (onSummaryReady) {
      if (vStatus === 'REHEARSAL') {
        onSummaryReady(tasks.every((t: any) => t.status === 'DONE'));
      } else if (vStatus === 'ACTIVE') {
        const first3 = tasks.filter((t: any) => (subToOrder[t.subPhaseId] ?? 99) <= 3);
        onSummaryReady(first3.length > 0 && first3.every((t: any) => t.status === 'DONE'));
      } else if (vStatus === 'MORNING_AFTER') {
        onSummaryReady(tasks.length > 0 && tasks.every((t: any) => t.status === 'DONE'));
      } else {
        onSummaryReady(false);
      }
    }

    if (onCurrentPhaseChange && (vStatus === 'ACTIVE' || vStatus === 'MORNING_AFTER' || vStatus === 'REHEARSAL')) {
      // Find lowest-orderIndex phase that still has non-terminal tasks
      const sortedPhases = [...(versionData.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
      let currentPhase: string | null = null;
      for (const phase of sortedPhases) {
        const phaseTasks = tasks.filter((t: any) => subToOrder[t.subPhaseId] === phase.orderIndex);
        if (phaseTasks.length > 0 && phaseTasks.some((t: any) => !TERMINAL.has(t.status))) {
          currentPhase = phase.name;
          break;
        }
      }
      onCurrentPhaseChange(currentPhase);
    }
  }, [tasks, versionData]); // eslint-disable-line

  const updateStatus = async (taskId: string, status: string, reason?: string, failedReason?: string, severity?: string) => {
    setUpdatingId(taskId);
    try {
      const res = await axios.patch(`${API}/tasks/${taskId}/status`, {
        status,
        ...(reason && { blockedReason: reason, blockedSeverity: severity }),
        ...(failedReason && { failedReason }),
      }, { headers });
      if (res.data?.requiresRollback) {
        const task = tasks.find(t => t.id === taskId);
        setRollbackWarning({ taskTitle: task?.title ?? taskId, reason: failedReason ?? '' });
      }
      setShowBlockedInput(null);
      fetchTasks();
      onTaskUpdated?.();
    } catch (err: any) {
      dialog.alert(err?.response?.data?.message || 'שגיאה בעדכון סטטוס', 'שגיאה', 'danger');
    }
    finally { setUpdatingId(null); }
  };

  const openNoDeps = async () => {
    const eligible = tasks.filter(t =>
      t.status === 'WAITING' &&
      (!t.dependencies?.length || t.dependencies.every((d: any) => d.dependsOn?.status === 'DONE'))
    );
    if (eligible.length === 0) return;

    if (versionData?.phases?.length) {
      const TERMINAL = new Set(['DONE', 'FAILED', 'ROLLED_BACK']);
      const taskStatusMap = new Map(tasks.map((t: any) => [t.id, t.status]));

      // Map each task to its phase orderIndex
      const taskPhaseOrder = new Map<string, number>();
      for (const phase of versionData.phases) {
        for (const sp of phase.subPhases || []) {
          for (const t of sp.tasks || []) {
            taskPhaseOrder.set(t.id, phase.orderIndex);
          }
        }
      }

      // Find the first phase (by orderIndex) that still has any non-terminal task.
      // That is the "current active phase" — we must not skip ahead to the next one.
      const sorted = [...versionData.phases].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
      const currentPhase = sorted.find(phase =>
        (phase.subPhases || []).some((sp: any) =>
          (sp.tasks || []).some((t: any) => !TERMINAL.has(taskStatusMap.get(t.id) ?? t.status))
        )
      );
      if (!currentPhase) return;

      // Open only eligible tasks that belong to the current phase
      const toOpen = eligible.filter(t => taskPhaseOrder.get(t.id) === currentPhase.orderIndex);
      if (toOpen.length === 0) return;

      await Promise.all(toOpen.map(t =>
        axios.patch(`${API}/tasks/${t.id}/status`, { status: 'OPEN' }, { headers }).catch(() => {})
      ));
    } else {
      await Promise.all(eligible.map(t =>
        axios.patch(`${API}/tasks/${t.id}/status`, { status: 'OPEN' }, { headers }).catch(() => {})
      ));
    }

    fetchTasks();
    onTaskUpdated?.();
  };

  const bulkUpdateStatus = async (status: 'IN_PROGRESS' | 'DONE') => {
    await Promise.all(
      Array.from(selectedTaskIds).map(id =>
        axios.patch(`${API}/tasks/${id}/status`, { status }, { headers }).catch(() => {})
      )
    );
    setSelectedTaskIds(new Set());
    fetchTasks();
    onTaskUpdated?.();
  };

  const bulkUpdateGroup = async (ids: string[], status: 'IN_PROGRESS' | 'DONE') => {
    await Promise.all(
      ids.map(id => axios.patch(`${API}/tasks/${id}/status`, { status }, { headers }).catch(() => {}))
    );
    setSelectedTaskIds(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next; });
    fetchTasks();
    onTaskUpdated?.();
  };

  const saveDelayReason = async (taskId: string) => {
    const ds = delayState[taskId];
    if (!ds?.category) return;
    const finalReason = ds.freeText?.trim()
      ? `${ds.category}: ${ds.freeText.trim()}`
      : ds.category;
    try {
      await axios.patch(`${API}/tasks/${taskId}`, { delayReason: finalReason }, { headers });
      setDelayState(prev => { const n = { ...prev }; delete n[taskId]; return n; });
      fetchTasks();
    } catch (err) { console.error(err); }
  };

  const addTask = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setAdding(true); setAddError(null);
    try {
      const res = await axios.post(`${API}/tasks`, {
        title: form.title.trim(),
        notes: form.notes.trim() || undefined,
        crNumber: form.crNumber.trim() || undefined,
        application: form.application || undefined,
        priority: form.priority,
        assignedUserName: form.assignedUserName.trim() || undefined,
        assignedTeamId: teamId,
        ...(versionId && { versionId }),
      }, { headers });
      // mark proposal as used if this task came from one
      if (FEATURES.TEAM_LEAD_PROPOSAL && selectedProposalId) {
        await axios.patch(`${API}/task-proposals/${selectedProposalId}/mark-used`, { taskId: res.data.id }, { headers }).catch(() => {});
        setSelectedProposalId(null);
      }
      setForm(emptyForm); setShowAddForm(false);
      fetchTasks(); fetchProposals(); onTaskUpdated?.();
    } catch (err: any) {
      setAddError(err?.response?.data?.message || 'שגיאה בהוספת המשימה');
    } finally { setAdding(false); }
  };

  // Teams present in tasks (for filter bar)
  const teamsInTasks: { id: string; name: string }[] = Array.from(
    new Map(
      tasks.filter(t => t.assignedTeamId && t.assignedTeam?.name)
           .map(t => [t.assignedTeamId, { id: t.assignedTeamId, name: t.assignedTeam.name }])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const teamFilteredTasks = localTeamFilter
    ? tasks.filter(t => t.assignedTeamId === localTeamFilter)
    : tasks;

  // Returns true if this task belongs to the current user (or is unassigned / team-wide)
  const matchesUser = (t: any): boolean => {
    if (!userId) return true;
    if (!t.assignedUserId && !t.assignedUserName) return true; // team-wide
    if (t.assignedUserId === userId) return true;
    if (!t.assignedUserId && userName &&
        t.assignedUserName?.trim().toLowerCase() === userName.trim().toLowerCase()) return true;
    return false;
  };

  const userFilteredTasks = userId ? teamFilteredTasks.filter(matchesUser) : teamFilteredTasks;

  const displayTasks = localStatusFilter
    ? userFilteredTasks.filter(t => t.status === localStatusFilter)
    : userFilteredTasks;

  const statusCounts = userFilteredTasks.reduce((acc: Record<string, number>, t: any) => {
    acc[t.status] = (acc[t.status] || 0) + 1; return acc;
  }, {} as Record<string, number>);

  // subPhaseId → tasks
  const taskBySub: Record<string, any[]> = tasks.reduce((acc: any, t: any) => {
    const k = t.subPhaseId || '__none__';
    (acc[k] = acc[k] || []).push(t); return acc;
  }, {});

  // Compute earliest start / latest end across a list of tasks
  const calcSpanStart = (list: any[]): Date | null => {
    const ms = list.filter(t => t.plannedStart).map(t => new Date(t.plannedStart).getTime());
    return ms.length ? new Date(Math.min(...ms)) : null;
  };
  const calcSpanEnd = (list: any[]): Date | null => {
    const ms = list.map(t => {
      if (t.plannedEnd) return new Date(t.plannedEnd).getTime();
      if (t.plannedStart && t.duration) {
        const m = parseDurationMins(t.duration);
        if (m) return new Date(t.plannedStart).getTime() + m * 60000;
      }
      return null;
    }).filter(Boolean) as number[];
    return ms.length ? new Date(Math.max(...ms)) : null;
  };
  const fmtDurMins = (mins: number): string => {
    if (mins < 60) return `${mins} דק'`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}ש' ${m}דק'` : `${h}ש'`;
  };
  const fmtSpan = (list: any[]): { time: string; dur: string } | null => {
    const s = calcSpanStart(list);
    const e = calcSpanEnd(list);
    if (!s && !e) return null;
    const sf = s ? fmtTime(s.toISOString()) : '?';
    const ef = e ? fmtTime(e.toISOString()) : '?';
    const durStr = (s && e) ? fmtDurMins(Math.round((e.getTime() - s.getTime()) / 60000)) : '';
    return { time: `${sf} — ${ef}`, dur: durStr };
  };

  const toggleSelect = (id: string) =>
    setSelectedTaskIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectGroup = (ids: string[]) =>
    setSelectedTaskIds(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });

  const deselectGroup = (ids: string[]) =>
    setSelectedTaskIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });

  const togglePhase = (id: string) =>
    setCollapsedPhases(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleSub = (id: string) =>
    setCollapsedSubs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleCompleted = (key: string) =>
    setExpandedCompleted(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // ── Anomaly detection ──
  type Severity = 'high' | 'medium' | 'low';
  interface Anomaly { task: any; type: string; reason: string; severity: Severity }

  const detectAnomalies = (): Anomaly[] => {
    const now = new Date();
    const result: Anomaly[] = [];
    // Runtime checks (overtime, overdue, delays) only make sense when the deployment is live
    const isExecMode = ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(versionData?.status);

    // ── Helper: compute planned end time of a task (ms) ──
    const plannedEndMs = (t: any): number | null => {
      if (t.plannedEnd) return new Date(t.plannedEnd).getTime();
      if (t.plannedStart && t.duration) {
        const mins = parseDurationMins(t.duration);
        if (mins) return new Date(t.plannedStart).getTime() + mins * 60000;
      }
      return null;
    };

    // ── Circular dependency detection (DFS coloring) ──
    const depMap: Record<string, string[]> = {};
    for (const t of tasks) {
      depMap[t.id] = t.dependencies?.map((d: any) => d.dependsOnTaskId) || [];
    }
    // 0=unvisited, 1=on-stack, 2=done
    const color: Record<string, number> = {};
    const cycleNodes = new Set<string>();

    const dfsColor = (id: string): boolean => {
      if (color[id] === 1) return true;
      if (color[id] === 2) return false;
      color[id] = 1;
      let inCycle = false;
      for (const nid of (depMap[id] || [])) {
        if (dfsColor(nid)) { inCycle = true; cycleNodes.add(nid); }
      }
      color[id] = 2;
      if (inCycle) cycleNodes.add(id);
      return inCycle;
    };
    for (const t of tasks) { if (!color[t.id]) dfsColor(t.id); }

    for (const t of tasks) {
      if (['DONE', 'ROLLED_BACK'].includes(t.status)) continue;

      // ── Runtime anomalies (execution mode only) ──
      if (isExecMode) {
        if (t.status === 'BLOCKED' && !t.blockedReason) {
          result.push({ task: t, type: 'חסום ללא סיבה', severity: 'high',
            reason: 'משימה חסומה אך לא הוזנה סיבת חסימה' });
        }
        if (t.status === 'BLOCKED' && t.blockedReason) {
          result.push({ task: t, type: 'חסומה', severity: 'high',
            reason: `סיבה: ${t.blockedReason}` });
        }
        if (isOvertime(t)) {
          result.push({ task: t, type: 'חריגת זמן', severity: 'high',
            reason: `בביצוע מעבר לשעת הסיום המתוכננת${t.plannedEnd ? ` (${fmtTime(t.plannedEnd)})` : ''}` });
        }
        if (isOverdue(t)) {
          const delayMins = Math.round((now.getTime() - new Date(t.plannedStart).getTime()) / 60000);
          result.push({ task: t, type: 'טרם התחילה', severity: delayMins > 30 ? 'high' : 'medium',
            reason: `הייתה אמורה להתחיל ב-${fmtTime(t.plannedStart)} — איחור של ${delayMins} דק'` });
        }
        if (isDelayed(t) && !t.delayReason) {
          result.push({ task: t, type: 'עיכוב משמעותי', severity: 'medium',
            reason: `${actualMins(t)} דק' בפועל לעומת ${plannedMins(t)} דק' מתוכנן` });
        }
        if (isLateStart(t) && !t.delayReason) {
          const lateBy = Math.round((new Date(t.actualStart).getTime() - new Date(t.plannedStart).getTime()) / 60000);
          result.push({ task: t, type: 'התחיל באיחור', severity: 'low',
            reason: `התחיל ${lateBy} דק' לאחר הזמן (תוכנן ${fmtTime(t.plannedStart)}, התחיל ${fmtTime(t.actualStart)})` });
        }

        // Runtime dependency anomalies
        if (['OPEN', 'IN_PROGRESS'].includes(t.status) && t.dependencies?.some((d: any) => d.dependsOn?.status !== 'DONE')) {
          const pending = t.dependencies
            .filter((d: any) => d.dependsOn?.status !== 'DONE')
            .map((d: any) => d.dependsOn?.title || '?')
            .join(', ');
          result.push({ task: t, type: 'תלות לא הושלמה', severity: 'medium',
            reason: `תלויה במשימות שטרם סיימו: ${pending}` });
        }
        if (t.actualStart && t.dependencies?.length) {
          const startedEarlyDeps = t.dependencies.filter((d: any) => {
            const dep = d.dependsOn;
            return dep?.actualFinish && new Date(t.actualStart) < new Date(dep.actualFinish);
          });
          if (startedEarlyDeps.length) {
            const names = startedEarlyDeps.map((d: any) => d.dependsOn?.title || '?').join(', ');
            result.push({ task: t, type: 'הופעלה לפני תלות', severity: 'high',
              reason: `החלה לפני שהתלויות שלה הסתיימו: ${names}` });
          }
        }
        if (['OPEN', 'IN_PROGRESS'].includes(t.status) && !t.assignedUserId && !t.assignedUserName) {
          result.push({ task: t, type: 'ללא אחראי', severity: 'low',
            reason: 'משימה פעילה ללא עובד משוייך' });
        }
      }

      // ── Planning dependency anomalies ──
      // Scheduling conflict: task planned to start before its dependency ends
      if (t.plannedStart && t.dependencies?.length) {
        const tStart = new Date(t.plannedStart).getTime();
        for (const d of t.dependencies) {
          const dep = d.dependsOn;
          if (!dep) continue;
          const depEnd = plannedEndMs(dep);
          if (depEnd && tStart < depEnd) {
            result.push({ task: t, type: 'קונפליקט תזמון', severity: 'high',
              reason: `מתוזמנת להתחיל ב-${fmtTime(t.plannedStart)} אך תלויה ב"${dep.title}" שמסתיימת ב-${fmtTime(new Date(depEnd).toISOString())}` });
            break;
          }
        }
      }

      // ── Circular dependency ──
      if (cycleNodes.has(t.id)) {
        const cycleDeps = t.dependencies
          ?.filter((d: any) => cycleNodes.has(d.dependsOnTaskId))
          .map((d: any) => d.dependsOn?.title || '?')
          .join(', ');
        result.push({ task: t, type: 'תלות מעגלית', severity: 'high',
          reason: cycleDeps
            ? `יוצרת מעגל עם: ${cycleDeps}`
            : 'תלות מעגלית — המשימה תלויה (בעקיפין) בעצמה' });
      }

    }

    // ── Phase-level overrun checks ──
    if (versionData?.phases?.length) {
      for (const phase of versionData.phases) {
        const cutoffMs: number | null = phase.plannedEnd
          ? new Date(phase.plannedEnd).getTime()
          : null;
        if (!cutoffMs) continue;

        const phaseTasks: any[] = (phase.subPhases || []).flatMap((s: any) => s.tasks || []);
        const active = phaseTasks.filter((t: any) =>
          !['DONE', 'ROLLED_BACK'].includes(t.status) &&
          parseDurationMins(t.duration || '') !== null,
        );
        let latestEndMs = 0;
        let lastTask: any = null;
        for (const t of active) {
          const endMs = plannedEndMs(t);
          if (endMs && endMs > latestEndMs) { latestEndMs = endMs; lastTask = t; }
        }
        if (lastTask && latestEndMs > cutoffMs) {
          const overrunMins = Math.round((latestEndMs - cutoffMs) / 60000);
          result.push({
            task: lastTask,
            type: 'חריגת שלב',
            severity: 'medium',
            reason: `שלב "${phase.name}" צפוי לסיים ב-${fmtTime(new Date(latestEndMs).toISOString())} — חורג ב-${overrunMins} דק' מהמועד ${fmtTime(new Date(cutoffMs).toISOString())}`,
          });
        }
      }
    }

    const sevOrder: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
    return result.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
  };

  const anomalies = useMemo(detectAnomalies, [tasks, versionData]); // eslint-disable-line
  const anomalyCount = anomalies.length;
  const highCount = anomalies.filter(a => a.severity === 'high').length;

  // Team-scoped users — members only (fallback: all users when team has no members)
  const teamUserList = useMemo(() => {
    if (!teamData?.members?.length) return users;
    const memberIds = new Set(teamData.members.map((m: any) => m.userId));
    const filtered = users.filter(u => memberIds.has(u.id));
    return filtered.length > 0 ? filtered : users;
  }, [teamData, users]);

  // Team-scoped apps — DB config → static map → full list
  const teamAppList = useMemo(() => {
    const withOther = (list: string[]) => list.includes('אחר') ? list : [...list, 'אחר'];
    if (teamData?.apps?.length) return withOther(teamData.apps as string[]);
    const staticApps = TEAM_APPS[teamName || ''];
    if (staticApps) return withOther(staticApps);
    return APPS;
  }, [teamData, teamName]);

  // Tasks in a phase where at least one previous phase has an incomplete task
  // AND this phase's plannedStart has not yet arrived.
  // If plannedStart arrived → allow opening even if previous phase is still running.
  // (must be before any early return to satisfy Rules of Hooks)
  const blockedPhaseTaskIds = useMemo((): Set<string> => {
    const result = new Set<string>();
    const versionStatus = versionData?.status;
    // Applies in both ACTIVE and REHEARSAL — a rehearsal exists to drill the
    // real phase order, so skipping the gate there defeats the point. Only
    // the time-based early-unlock below is ACTIVE-only (a rehearsal doesn't
    // run against the real night's clock).
    if (!['ACTIVE', 'REHEARSAL'].includes(versionStatus) || !versionData?.phases?.length) return result;
    const DONE_STATUSES = ['DONE', 'FAILED', 'ROLLED_BACK'];
    const taskStatusMap = new Map(tasks.map((t: any) => [t.id, t.status]));
    const now = Date.now();
    const phases = [...versionData.phases].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
    for (let i = 1; i < phases.length; i++) {
      const phaseStartArrived = versionStatus === 'ACTIVE' && phases[i].plannedStart != null && new Date(phases[i].plannedStart).getTime() <= now;
      if (phaseStartArrived) continue; // time-based unlock — allow regardless
      const prevIncomplete = phases.slice(0, i).some((p: any) =>
        p.subPhases.some((sp: any) =>
          sp.tasks.some((t: any) => !DONE_STATUSES.includes(taskStatusMap.get(t.id) ?? t.status))
        )
      );
      if (prevIncomplete) {
        for (const sp of phases[i].subPhases) {
          for (const t of sp.tasks) result.add(t.id);
        }
      }
    }
    return result;
  }, [versionData, tasks]);

  if (loading) return <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, fontFamily: FONT }}>טוען...</div>;

  const usePhaseView = !!(versionData?.phases?.length);
  const allPhasesCollapsed = usePhaseView && (versionData?.phases?.length ?? 0) > 0 && collapsedPhases.size >= (versionData?.phases?.length ?? 0);
  const isLocked = versionData?.status === 'ACTIVE';
  const isExecutionMode = ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(versionData?.status);
  const isManager = can('action:open_task_for_execution');

  // ── Focus mode ("מצב הרצה") — annotate tasks with phase/sub-phase names for grouping ──
  const TERMINAL_FOCUS = ['DONE', 'FAILED', 'ROLLED_BACK'];
  const focusPhaseNameById = new Map<string, { phaseName: string; subPhaseName: string }>();
  for (const ph of (versionData?.phases ?? [])) {
    for (const sp of (ph.subPhases ?? [])) {
      for (const t of (sp.tasks ?? [])) {
        focusPhaseNameById.set(t.id, { phaseName: ph.name, subPhaseName: sp.name });
      }
    }
  }
  const focusTasks = tasks.map(t => ({
    ...t,
    _phaseName: focusPhaseNameById.get(t.id)?.phaseName,
    _subPhaseName: focusPhaseNameById.get(t.id)?.subPhaseName,
  }));
  const isMyFocusTask = (t: any) =>
    (t.assignedUserId && t.assignedUserId === myUserId) ||
    (t.assignedUserName && t.assignedUserName.trim().toLowerCase() === myUserName);
  const focusOpenableWaiting = focusTasks.filter(t =>
    t.status === 'WAITING' && (!t.dependencies?.length || t.dependencies.every((d: any) => d.dependsOn?.status === 'DONE'))
  );

  // Delay summary counters
  const overdueCount  = tasks.filter(t => isOverdue(t)).length;
  const overtimeCount = tasks.filter(t => isOvertime(t)).length;
  const needReasonCount = tasks.filter(t => isDelayed(t) && !t.delayReason).length;
  const hasDelayAlerts = overdueCount > 0 || overtimeCount > 0 || needReasonCount > 0;

  const taskRowProps: TaskRowSharedProps = {
    isExecutionMode,
    isManager,
    blockedPhaseTaskIds,
    selectedTaskIds,
    onToggleSelect: toggleSelect,
    updatingId,
    onUpdateStatus: updateStatus,
    showBlockedInput,
    onSetShowBlockedInput: setShowBlockedInput,
    delayState,
    setDelayState,
    onSaveDelayReason: saveDelayReason,
    failureReasons,
    onRollbackWarning: (taskTitle, reason) => setRollbackWarning({ taskTitle, reason }),
  };

  const inputStyle: React.CSSProperties = {
    padding: '7px', border: `1px solid ${C.border}`, borderRadius: '6px', fontSize: '15px',
    background: C.bgNested, color: C.textPrimary, fontFamily: FONT,
  };

  return (
    <div style={{ direction: 'rtl', fontFamily: FONT }}>

      {/* ── Rollback required warning ── */}
      {rollbackWarning && (
        <div style={{ background: C.bgBlocked, border: `2px solid ${C.statusBlocked}`, borderRadius: '10px', padding: '12px 16px', marginBottom: '10px', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
          <span style={{ fontSize: '22px', flexShrink: 0 }}>🔴</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', color: C.statusBlocked, fontSize: '15px', marginBottom: '4px' }}>
              ⚠️ נדרש Rollback לגרסה!
            </div>
            <div style={{ color: C.textSecondary, fontSize: '14px' }}>
              המשימה <strong style={{ color: C.textPrimary }}>"{rollbackWarning.taskTitle}"</strong> נכשלה עם הסיבה: <strong>{rollbackWarning.reason}</strong>.
              <br />סיבה זו מחייבת ביצוע Rollback לגרסה. פנה למנהל הלילה מיידית.
            </div>
          </div>
          <button onClick={() => setRollbackWarning(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '18px', flexShrink: 0 }}>
            ✕
          </button>
        </div>
      )}

      {/* ── Lock banner ── */}
      {isLocked && (
        <div style={{ background: C.bgInProgress, border: `2px solid ${C.statusInProgress}`, borderRadius: '10px', padding: '10px 16px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>🔒</span>
          <div>
            <span style={{ fontWeight: 'bold', color: C.statusInProgress, fontSize: '15px' }}>גרסה פעילה — מצב ביצוע</span>
            <span style={{ color: C.textSecondary, fontSize: '14px', marginRight: '8px' }}>לא ניתן להוסיף משימות או לערוך פרטים</span>
          </div>
        </div>
      )}

      {/* ── Delay summary panel ── */}
      {hasDelayAlerts && (
        <div style={{ background: C.bgInProgress, border: `1px solid ${C.statusInProgress}66`, borderRadius: '10px', padding: '10px 16px', marginBottom: '10px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontWeight: 'bold', color: C.statusInProgress, fontSize: '15px' }}>⚠️ עיכובים:</span>
          {overdueCount > 0 && (
            <span style={{ background: C.bgNested, color: C.statusInProgress, padding: '3px 10px', borderRadius: '12px', fontSize: '14px', fontWeight: 'bold', border: `1px solid ${C.statusInProgress}44` }}>
              🕐 {overdueCount} טרם התחילו (איחור)
            </span>
          )}
          {overtimeCount > 0 && (
            <span style={{ background: C.bgNested, color: C.statusBlocked, padding: '3px 10px', borderRadius: '12px', fontSize: '14px', fontWeight: 'bold', border: `1px solid ${C.statusBlocked}44` }}>
              🔴 {overtimeCount} חרגו מזמן הסיום
            </span>
          )}
          {needReasonCount > 0 && (
            <span style={{ background: C.bgNested, color: C.statusInProgress, padding: '3px 10px', borderRadius: '12px', fontSize: '14px', fontWeight: 'bold', border: `1px solid ${C.statusInProgress}44` }}>
              📝 {needReasonCount} ממתינות לסיבת עיכוב
            </span>
          )}
        </div>
      )}

      {/* ── Anomaly panel ── */}
      {showAnomalies && (
        <div style={{ background: C.bgCard, borderRadius: '12px', padding: '16px 20px', marginBottom: '12px', border: `2px solid ${highCount > 0 ? C.statusBlocked : anomalyCount > 0 ? C.statusInProgress : C.statusDone}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '18px' }}>🔍</span>
              <span style={{ fontWeight: 'bold', color: C.textPrimary, fontSize: '16px' }}>
                בדיקת חריגות
              </span>
              <span style={{ fontSize: '14px', color: C.textMuted }}>
                {anomalyCount === 0 ? '✅ לא נמצאו חריגות' : `נמצאו ${anomalyCount} חריגות`}
              </span>
              {highCount > 0 && (
                <span style={{ background: C.bgBlocked, color: C.statusBlocked, padding: '2px 8px', borderRadius: '10px', fontSize: '14px', fontWeight: 'bold', border: `1px solid ${C.statusBlocked}44` }}>
                  {highCount} דחופות
                </span>
              )}
            </div>
            <button onClick={() => setShowAnomalies(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: C.textMuted, lineHeight: 1 }}>
              ✕
            </button>
          </div>

          {anomalyCount === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: C.statusDone, fontSize: '15px' }}>
              ✅ כל המשימות תקינות — אין חריגות
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {anomalies.map((a, i) => {
                const sevStyle: Record<Severity, { bg: string; border: string; badge: string; badgeBg: string; icon: string }> = {
                  high:   { bg: C.bgBlocked,    border: C.statusBlocked + '66',    badge: 'דחוף',   badgeBg: C.statusBlocked,    icon: '🔴' },
                  medium: { bg: C.bgInProgress,  border: C.statusInProgress + '66', badge: 'בינוני', badgeBg: C.statusInProgress, icon: '🟡' },
                  low:    { bg: C.bgNested,       border: C.border,                  badge: 'נמוך',   badgeBg: C.textMuted,        icon: '🔵' },
                };
                const s = sevStyle[a.severity];
                return (
                  <div key={i} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: '8px', padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span style={{ fontSize: '17px', flexShrink: 0, marginTop: '1px' }}>{s.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '3px' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '15px', color: C.textPrimary }}>
                          {a.task.title}
                        </span>
                        <span style={{ background: s.badgeBg, color: 'white', fontSize: '12px', fontWeight: 'bold', padding: '1px 7px', borderRadius: '8px' }}>
                          {a.type}
                        </span>
                        <span style={{ background: s.badgeBg + '22', color: s.badgeBg, fontSize: '12px', padding: '1px 7px', borderRadius: '8px', border: `1px solid ${s.badgeBg}44` }}>
                          {s.badge}
                        </span>
                      </div>
                      <div style={{ fontSize: '14px', color: C.textSecondary }}>
                        {a.reason}
                        {a.task.assignedTeam?.name && (
                          <span style={{ color: C.textMuted, marginRight: '8px' }}>· {a.task.assignedTeam.name}</span>
                        )}
                        {a.task.assignedUserName && (
                          <span style={{ color: C.textMuted, marginRight: '4px' }}>· {a.task.assignedUserName}</span>
                        )}
                      </div>
                    </div>
                    {a.type === 'חריגת שלב' && onOpenReschedule ? (
                      <button
                        onClick={onOpenReschedule}
                        style={{ flexShrink: 0, padding: '4px 12px', background: C.brand, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                      >
                        📅 תזמון מחדש
                      </button>
                    ) : (
                      <button
                        onClick={() => openAnomalyEdit(i, a.task)}
                        style={{ flexShrink: 0, padding: '4px 12px', background: anomalyEditIdx === i ? C.bgHover : C.brandDim, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                      >
                        {anomalyEditIdx === i ? '✕ סגור' : '✏️ ערוך'}
                      </button>
                    )}
                    </div>{/* end inner row */}

                  {/* ── Inline anomaly edit form ── */}
                  {anomalyEditIdx === i && (
                    <div style={{ marginTop: '10px', background: C.bgNested, borderRadius: '8px', padding: '12px 14px', border: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: '12px' }}>

                      {/* Time fields */}
                      {['קונפליקט תזמון', 'טרם התחילה', 'חריגת זמן', 'עיכוב משמעותי'].includes(a.type) && (
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '14px', color: C.brand, marginBottom: '8px' }}>⏰ עדכון זמנים</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                            <div>
                              <label style={{ fontSize: '13px', color: C.textMuted, display: 'block', marginBottom: '2px' }}>תחילה מתוכננת</label>
                              <DateTimeField value={anomalyEditForm.plannedStart}
                                onChange={v => setAnomalyEditForm(f => ({ ...f, plannedStart: v }))}
                                style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: '13px', color: C.textMuted, display: 'block', marginBottom: '2px' }}>סיום מתוכנן</label>
                              <DateTimeField value={anomalyEditForm.plannedEnd}
                                onChange={v => setAnomalyEditForm(f => ({ ...f, plannedEnd: v }))}
                                style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: '13px', color: C.textMuted, display: 'block', marginBottom: '2px' }}>משך (45ד׳ / 1ש׳ 30ד׳)</label>
                              <input value={anomalyEditForm.duration}
                                onChange={e => setAnomalyEditForm(f => ({ ...f, duration: e.target.value }))}
                                placeholder="לדוגמה: 45ד'"
                                style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
                            </div>
                          </div>
                          <button onClick={() => saveAnomalyFields(a.task.id, {
                              plannedStart: anomalyEditForm.plannedStart || null,
                              plannedEnd:   anomalyEditForm.plannedEnd   || null,
                              duration:     anomalyEditForm.duration     || null,
                            })}
                            style={{ padding: '5px 16px', background: C.brand, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>
                            שמור זמנים
                          </button>
                        </div>
                      )}

                      {/* Dependency list with remove buttons */}
                      {['תלות מעגלית', 'קונפליקט תזמון', 'הופעלה לפני תלות', 'תלות לא הושלמה'].includes(a.type) && a.task.dependencies?.length > 0 && (
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '14px', color: C.brand, marginBottom: '6px' }}>🔗 תלויות — הסר קישורים שגויים</div>
                          {a.task.dependencies.map((d: any) => {
                            const dep = d.dependsOn;
                            const isProblematic = (() => {
                              if (!dep) return false;
                              if (a.type === 'תלות מעגלית') return true;
                              if (a.type === 'תלות לא הושלמה') return dep.status !== 'DONE';
                              if ((a.type === 'קונפליקט תזמון' || a.type === 'הופעלה לפני תלות') && a.task.plannedStart && dep.plannedStart) {
                                const depEndMs = dep.plannedEnd
                                  ? new Date(dep.plannedEnd).getTime()
                                  : (() => { const m = parseDurationMins(dep.duration || ''); return m && dep.plannedStart ? new Date(dep.plannedStart).getTime() + m * 60000 : null; })();
                                return !!(depEndMs && new Date(a.task.plannedStart).getTime() < depEndMs);
                              }
                              return false;
                            })();
                            return (
                              <div key={d.dependsOnTaskId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', background: isProblematic ? C.bgBlocked : C.bgCard, borderRadius: '6px', marginBottom: '4px', border: `1px solid ${isProblematic ? C.statusBlocked + '66' : C.border}` }}>
                                <span style={{ fontSize: '14px', color: C.textSecondary }}>
                                  {isProblematic ? '⚠️' : '🔗'} {dep?.title || d.dependsOnTaskId}
                                  {dep?.plannedEnd && <span style={{ color: C.textMuted, marginRight: '6px', fontSize: '13px' }}>· סיום: {fmtTime(dep.plannedEnd)}</span>}
                                </span>
                                <button onClick={() => removeDependency(a.task.id, d.dependsOnTaskId)}
                                  style={{ padding: '2px 10px', background: C.statusBlocked, color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                                  הסר
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* User assignment */}
                      {a.type === 'ללא אחראי' && (
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '14px', color: C.brand, marginBottom: '6px' }}>👤 שיוך עובד אחראי</div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <select value={anomalyEditForm.assignedUserName}
                              onChange={e => setAnomalyEditForm(f => ({ ...f, assignedUserName: e.target.value }))}
                              style={{ flex: 1, ...inputStyle, direction: 'rtl' }}>
                              <option value="">— בחר עובד —</option>
                              {teamUserList.map(u => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
                            </select>
                            <button onClick={() => saveAnomalyFields(a.task.id, { assignedUserName: anomalyEditForm.assignedUserName })}
                              disabled={!anomalyEditForm.assignedUserName}
                              style={{ padding: '5px 16px', background: anomalyEditForm.assignedUserName ? C.statusDone : C.textDisabled, color: 'white', border: 'none', borderRadius: '6px', cursor: anomalyEditForm.assignedUserName ? 'pointer' : 'not-allowed', fontSize: '14px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                              שמור
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Blocked reason */}
                      {['חסום ללא סיבה', 'חסומה'].includes(a.type) && (
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '14px', color: C.brand, marginBottom: '6px' }}>🚫 סיבת חסימה</div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <input value={anomalyEditForm.blockedReason} placeholder="הזן סיבת חסימה"
                              onChange={e => setAnomalyEditForm(f => ({ ...f, blockedReason: e.target.value }))}
                              style={{ flex: 1, ...inputStyle }} />
                            <button onClick={() => saveAnomalyFields(a.task.id, { blockedReason: anomalyEditForm.blockedReason })}
                              disabled={!anomalyEditForm.blockedReason}
                              style={{ padding: '5px 16px', background: anomalyEditForm.blockedReason ? C.statusBlocked : C.textDisabled, color: 'white', border: 'none', borderRadius: '6px', cursor: anomalyEditForm.blockedReason ? 'pointer' : 'not-allowed', fontSize: '14px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                              שמור
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Delay reason */}
                      {['התחיל באיחור'].includes(a.type) && (
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '14px', color: C.brand, marginBottom: '6px' }}>⚠️ סיבת עיכוב</div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <select value={anomalyEditForm.delayReason}
                              onChange={e => setAnomalyEditForm(f => ({ ...f, delayReason: e.target.value }))}
                              style={{ flex: 1, ...inputStyle, direction: 'rtl' }}>
                              <option value="">— בחר סיבה —</option>
                              {DELAY_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <button onClick={() => saveAnomalyFields(a.task.id, { delayReason: anomalyEditForm.delayReason })}
                              disabled={!anomalyEditForm.delayReason}
                              style={{ padding: '5px 16px', background: anomalyEditForm.delayReason ? C.statusInProgress : C.textDisabled, color: 'white', border: 'none', borderRadius: '6px', cursor: anomalyEditForm.delayReason ? 'pointer' : 'not-allowed', fontSize: '14px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                              שמור
                            </button>
                          </div>
                        </div>
                      )}

                    </div>
                  )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Header + stats ── */}
      <div style={{ background: C.bgCard, borderRadius: '12px', padding: '14px 20px', marginBottom: '12px', border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h2 style={{ margin: 0, color: C.textPrimary, fontSize: '17px' }}>
            {isExecutionMode ? '🎯 ביצוע פעילות' : '📋 סקירת תוכנית'}
            {versionData && <span style={{ fontSize: '15px', color: C.textMuted, fontWeight: 'normal', marginRight: '8px' }}>— {versionData.name}</span>}
            {teamName && !versionData && <span style={{ fontSize: '15px', color: C.textMuted, fontWeight: 'normal', marginRight: '8px' }}>— {teamName}</span>}
          </h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            {usePhaseView && (
              <>
                <button onClick={() => setCollapsedPhases(new Set(versionData.phases.map((p: any) => p.id)))}
                  style={{ padding: '6px 12px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
                  ▶ קפל הכל
                </button>
                <button onClick={() => { setCollapsedPhases(new Set()); setCollapsedSubs(new Set()); }}
                  style={{ padding: '6px 12px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
                  ▼ פתח הכל
                </button>
              </>
            )}
            {isExecutionMode && tasks.some(t => t.status === 'WAITING' && (!t.dependencies?.length || t.dependencies.every((d: any) => d.dependsOn?.status === 'DONE'))) && (
              <button onClick={openNoDeps}
                style={{ padding: '6px 14px', background: C.statusWaiting, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
                🔓 פתח ללא תלות
              </button>
            )}
            {isExecutionMode && !hideFocusMode && (
              <button onClick={() => setFocusMode(true)}
                style={{ padding: '6px 14px', background: C.brand, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
                ⚡ מצב הרצה
              </button>
            )}
            {!allPhasesCollapsed && !isLocked && !hideAddTask && <button onClick={() => { setShowAddForm(v => !v); setAddError(null); }}
              style={{ padding: '6px 14px', background: showAddForm ? C.bgHover : C.brand, color: showAddForm ? C.textPrimary : 'white', border: `1px solid ${showAddForm ? C.border : C.brand}`, borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
              {showAddForm ? '✕ ביטול' : '+ משימה'}
            </button>}
            {!allPhasesCollapsed && !isExecutionMode && versionData && (
              <button
                onClick={autoSchedule}
                disabled={autoScheduling}
                title="חשב שעות סיום לפי משך, והתחל משימות תלויות אחרי שהתלות שלהן מסתיימת"
                style={{ padding: '6px 14px', background: autoScheduling ? C.textDisabled : C.statusWaiting, color: 'white', border: 'none', borderRadius: '8px', cursor: autoScheduling ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '15px', whiteSpace: 'nowrap' }}
              >
                {autoScheduling ? '...' : '📅 חשב לוחות זמנים'}
              </button>
            )}
            {!allPhasesCollapsed && !isExecutionMode && (
              <button
                onClick={() => setShowAnomalies(v => !v)}
                style={{
                  position: 'relative', padding: '6px 14px', border: 'none', borderRadius: '8px', cursor: 'pointer',
                  fontWeight: 'bold', fontSize: '15px',
                  background: showAnomalies ? C.statusFailed : highCount > 0 ? C.statusBlocked : anomalyCount > 0 ? C.statusInProgress : C.statusDone,
                  color: 'white',
                }}
              >
                🔍 חריגות
                {anomalyCount > 0 && (
                  <span style={{
                    position: 'absolute', top: '-6px', left: '-6px',
                    background: highCount > 0 ? '#7b0000' : C.bgHover,
                    color: 'white', borderRadius: '10px', fontSize: '12px', fontWeight: 'bold',
                    padding: '1px 5px', minWidth: '16px', textAlign: 'center',
                  }}>
                    {anomalyCount}
                  </span>
                )}
              </button>
            )}
            <button onClick={fetchTasks}
              style={{ padding: '6px 12px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '15px' }}>
              ↻
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {Object.entries(STATUS_LABELS).map(([status, label]) =>
            statusCounts[status] > 0 ? (
              <div key={status} style={{ background: STATUS_COLORS[status] + '22', border: `2px solid ${STATUS_COLORS[status]}`, borderRadius: '8px', padding: '3px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: '17px', fontWeight: 'bold', color: status === 'IN_PROGRESS' ? '#7a5c00' : STATUS_COLORS[status] }}>{statusCounts[status]}</div>
                <div style={{ fontSize: '12px', color: C.textMuted }}>{label}</div>
              </div>
            ) : null
          )}
        </div>
      </div>

      {/* ── Auto-schedule result ── */}
      {autoScheduleResult && (
        <div style={{ marginBottom: '10px' }}>
          <div style={{ background: C.bgDone, border: `2px solid ${C.statusDone}`, borderRadius: autoScheduleResult.cycles.length > 0 ? '10px 10px 0 0' : '10px', padding: '10px 16px', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <span style={{ fontSize: '20px', flexShrink: 0 }}>📅</span>
            <div style={{ flex: 1 }}>
              <strong style={{ color: C.statusDone, fontSize: '15px' }}>
                {autoScheduleResult.count === 0
                  ? 'לא נמצאו שינויים — כל הזמנים כבר מחושבים'
                  : `עודכנו ${autoScheduleResult.count} משימות:`}
              </strong>
              {autoScheduleResult.names.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '5px' }}>
                  {autoScheduleResult.names.map((name, i) => (
                    <span key={i} style={{ background: C.bgNested, color: C.statusDone, padding: '2px 8px', borderRadius: '10px', fontSize: '14px', border: `1px solid ${C.statusDone}44` }}>
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setAutoScheduleResult(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '17px', color: C.textMuted, lineHeight: 1, flexShrink: 0 }}>
              ✕
            </button>
          </div>
          {autoScheduleResult.cycles.length > 0 && (
            <div style={{ background: C.bgBlocked, border: `2px solid ${C.statusBlocked}`, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '10px 16px', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ fontSize: '17px', flexShrink: 0 }}>🔁</span>
              <div>
                <strong style={{ color: C.statusBlocked, fontSize: '15px' }}>נמצאו תלויות מעגליות — המשימות הבאות לא חושבו:</strong>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '5px' }}>
                  {autoScheduleResult.cycles.map((name, i) => (
                    <span key={i} style={{ background: C.bgNested, color: C.statusBlocked, padding: '2px 8px', borderRadius: '10px', fontSize: '14px', border: `1px solid ${C.statusBlocked}44` }}>
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Team filter ── */}
      {teamsInTasks.length > 1 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px', background: C.bgCard, borderRadius: '10px', padding: '8px 14px', border: `1px solid ${C.border}`, alignItems: 'center' }}>
          <span style={{ fontSize: '14px', color: C.textMuted, marginLeft: '4px' }}>סנן:</span>
          {[{ id: null, name: 'כולם', count: tasks.length }, ...teamsInTasks.map(t => ({ ...t, count: tasks.filter(x => x.assignedTeamId === t.id).length }))].map(t => (
            <button key={t.id ?? '__all__'}
              onClick={() => setLocalTeamFilter(t.id)}
              style={{ padding: '3px 11px', borderRadius: '20px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', border: `1px solid ${localTeamFilter === t.id ? C.brand : C.border}`, background: localTeamFilter === t.id ? C.brand : C.bgNested, color: localTeamFilter === t.id ? 'white' : C.textSecondary }}>
              {t.name} ({t.count})
            </button>
          ))}
        </div>
      )}

      {/* ── Status filter ── */}
      {Object.keys(statusCounts).length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px', background: C.bgCard, borderRadius: '10px', padding: '8px 14px', border: `1px solid ${C.border}`, alignItems: 'center' }}>
          <span style={{ fontSize: '14px', color: C.textMuted, marginLeft: '4px' }}>סטטוס:</span>
          <button
            onClick={() => setLocalStatusFilter(null)}
            style={{ padding: '3px 11px', borderRadius: '20px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', border: `1px solid ${localStatusFilter === null ? C.brand : C.border}`, background: localStatusFilter === null ? C.brand : C.bgNested, color: localStatusFilter === null ? 'white' : C.textSecondary }}>
            הכל ({teamFilteredTasks.length})
          </button>
          {Object.entries(STATUS_LABELS).map(([status, label]) => {
            const count = statusCounts[status];
            if (!count) return null;
            const color = STATUS_COLORS[status];
            const isActive = localStatusFilter === status;
            // For light colors (amber/yellow) white-on-color has low contrast — use dark text instead
            const isLightColor = status === 'IN_PROGRESS';
            return (
              <button key={status}
                onClick={() => setLocalStatusFilter(isActive ? null : status)}
                style={{
                  padding: '3px 11px', borderRadius: '20px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer',
                  border: `1px solid ${color}`,
                  background: isActive ? color : color + '22',
                  color: isActive ? (isLightColor ? '#1a1a1a' : 'white') : (isLightColor ? '#7a5c00' : color),
                }}>
                {label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* ── Multi-select toolbar (execution mode only) ── */}
      {isExecutionMode && selectedTaskIds.size > 0 && (
        <div style={{ position: 'sticky', top: '68px', zIndex: 50, background: C.bgHover, color: C.textPrimary, borderRadius: '10px', padding: '9px 16px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)', flexWrap: 'wrap', border: `1px solid ${C.borderEm}` }}>
          <span style={{ fontWeight: 'bold', fontSize: '15px' }}>{selectedTaskIds.size} נבחרו</span>
          <button onClick={() => bulkUpdateStatus('IN_PROGRESS')}
            style={{ padding: '5px 14px', background: C.statusInProgress, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
            ▶ התחל הכל
          </button>
          <button onClick={() => bulkUpdateStatus('DONE')}
            style={{ padding: '5px 14px', background: C.statusDone, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
            ✓ סיים הכל
          </button>
          <button onClick={() => setSelectedTaskIds(new Set())}
            style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.1)', color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '15px' }}>
            ✕ בטל
          </button>
        </div>
      )}

      {/* ── Add task form ── */}
      {showAddForm && (
        <form onSubmit={addTask} style={{ background: C.bgCard, borderRadius: '12px', padding: '14px 16px', marginBottom: '12px', border: `2px solid ${C.brand}` }}>
          <h3 style={{ margin: '0 0 10px', color: C.textPrimary, fontSize: '15px' }}>➕ הוספת משימה</h3>
          {/* proposals from team leads */}
          {FEATURES.TEAM_LEAD_PROPOSAL && proposals.length > 0 && (
            <div style={{ marginBottom: '12px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ fontSize: '14px', fontWeight: 'bold', color: C.brand, marginBottom: '8px' }}>
                📋 משימות שהוגשו ע"י ראשי צוותים ({proposals.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '180px', overflowY: 'auto' }}>
                {proposals.map((p: any) => (
                  <div
                    key={p.id}
                    onClick={() => {
                      setSelectedProposalId(p.id);
                      setForm(f => ({
                        ...f,
                        title: p.title,
                        crNumber: p.crNumber ?? '',
                        application: p.app ?? '',
                        notes: p.notes ?? '',
                      }));
                    }}
                    style={{
                      padding: '7px 12px', borderRadius: '6px', cursor: 'pointer',
                      background: selectedProposalId === p.id ? C.brandDim : C.bgCard,
                      color: C.textPrimary,
                      border: `1px solid ${selectedProposalId === p.id ? C.brand : C.border}`,
                      fontSize: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}
                  >
                    <span style={{ fontWeight: 'bold' }}>{p.title}</span>
                    <span style={{ fontSize: '13px', opacity: 0.7 }}>
                      {p.app && `${p.app} · `}{p.estimatedMins ? `${p.estimatedMins} דק'` : ''}{p.crNumber ? ` · ${p.crNumber}` : ''}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '6px', fontSize: '13px', color: C.textMuted }}>
                לחץ על הצעה לטעינה אוטומטית לטופס — או מלא ידנית מטה
              </div>
              {selectedProposalId && (
                <button type="button" onClick={() => { setSelectedProposalId(null); setForm(emptyForm); }}
                  style={{ marginTop: '6px', fontSize: '13px', color: C.statusBlocked, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  ✕ נקה בחירה
                </button>
              )}
            </div>
          )}
          {addError && <div style={{ background: C.bgBlocked, border: `1px solid ${C.statusBlocked}66`, borderRadius: '6px', padding: '5px 10px', marginBottom: '8px', color: C.statusBlocked, fontSize: '14px' }}>{addError}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '7px', marginBottom: '7px' }}>
            <input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="שם המשימה *" style={inputStyle} />
            <input value={form.crNumber} onChange={e => setForm(f => ({ ...f, crNumber: e.target.value }))} placeholder="CR#" style={inputStyle} />
            <select value={form.application} onChange={e => setForm(f => ({ ...f, application: e.target.value }))} style={inputStyle}>
              <option value="">מערכת</option>
              {teamAppList.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={form.assignedUserName} onChange={e => setForm(f => ({ ...f, assignedUserName: e.target.value }))} style={inputStyle}>
              <option value="">-- אחראי --</option>
              {teamUserList.map(u => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" disabled={adding || !form.title.trim()}
              style={{ padding: '7px 18px', background: adding || !form.title.trim() ? C.textDisabled : C.statusDone, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
              {adding ? 'מוסיף...' : '✓ הוסף'}
            </button>
            <button type="button" onClick={() => { setShowAddForm(false); setForm(emptyForm); setAddError(null); }}
              style={{ padding: '7px 14px', background: C.bgNested, color: C.textPrimary, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '15px' }}>
              ביטול
            </button>
          </div>
        </form>
      )}

      {/* ── Table header ── */}
      {displayTasks.length > 0 && (
        <TaskTableHeader showActions={isExecutionMode} />
      )}

      {/* ── Phase-based view ── */}
      {usePhaseView ? (
        versionData.phases.map((phase: any) => {
          const subs = phase.subPhases || [];
          const phaseTasks = subs.flatMap((sp: any) =>
            (taskBySub[sp.id] || []).filter((t: any) =>
              (!localTeamFilter || t.assignedTeamId === localTeamFilter) &&
              matchesUser(t) &&
              (!localStatusFilter || t.status === localStatusFilter)
            )
          );
          if (phaseTasks.length === 0) return null;

          const doneCount = phaseTasks.filter((t: any) => t.status === 'DONE').length;
          const blockedCount = phaseTasks.filter((t: any) => t.status === 'BLOCKED').length;
          const inProgCount = phaseTasks.filter((t: any) => t.status === 'IN_PROGRESS').length;
          const isCollapsed = collapsedPhases.has(phase.id);
          const selectableIds = phaseTasks.filter((t: any) => !TERMINAL.has(t.status)).map((t: any) => t.id);
          // "בחר הכל" excludes WAITING — only OPEN/IN_PROGRESS/BLOCKED can be bulk-selected
          const selectableForBulkIds = phaseTasks.filter((t: any) => !TERMINAL.has(t.status) && t.status !== 'WAITING').map((t: any) => t.id);

          const envColor = phase.environment === 'HOT' ? C.statusBlocked : phase.environment === 'HOTNET' ? C.statusOpen : C.textSecondary;
          const envBg   = phase.environment === 'HOT' ? C.bgBlocked : phase.environment === 'HOTNET' ? C.bgOpen : C.bgNested;
          const progress = Math.round((doneCount / phaseTasks.length) * 100);

          return (
            <div key={phase.id} style={{
              background: C.bgCard, borderRadius: RADIUS.xl,
              marginBottom: SP[3], border: `1px solid ${C.border}`, overflow: 'hidden',
              boxShadow: SHADOW.sm,
            }}>
              {/* Phase header */}
              <div onClick={() => togglePhase(phase.id)} style={{
                padding: `${SP[3]} ${SP[4]}`, display: 'flex', alignItems: 'center', gap: SP[2],
                cursor: 'pointer',
                background: `linear-gradient(135deg, ${C.bgElevated} 0%, ${C.bgCard} 100%)`,
                borderBottom: isCollapsed ? 'none' : `1px solid ${C.border}`,
                userSelect: 'none' as any,
                transition: EASE.fast,
              }}>
                {/* Collapse chevron */}
                <span style={{ color: C.textDisabled, fontSize: '12px', flexShrink: 0, transition: EASE.fast, transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0)' }}>▼</span>

                {/* Env badge */}
                <Badge color={envColor} bg={envBg}
                  style={{ flexShrink: 0, letterSpacing: '0.04em', textTransform: 'uppercase' as any }}>
                  {phase.environment}
                </Badge>

                {/* Phase name */}
                <span style={{ ...TEXT.md, fontWeight: WEIGHT.semibold, color: C.textPrimary, flex: 1 }}>
                  {phase.name}
                </span>

                {/* Time span */}
                {(() => { const span = fmtSpan(phaseTasks.filter((t: any) => parseDurationMins(t.duration || '') !== null)); return span ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: SP[1], ...TEXT.xs, color: C.textSecondary, background: C.bgActive, border: `1px solid ${C.border}`, padding: '3px 10px', borderRadius: RADIUS.full, flexShrink: 0 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    {span.time}
                    {span.dur && <span style={{ color: C.statusWaiting, fontWeight: WEIGHT.semibold }}>{span.dur}</span>}
                  </span>
                ) : null; })()}

                {/* Stats */}
                <div style={{ display: 'flex', gap: SP[2], alignItems: 'center', flexShrink: 0 }}>
                  {/* Progress bar */}
                  <div style={{ width: '56px', height: '5px', background: C.bgActive, borderRadius: RADIUS.full, overflow: 'hidden' }}>
                    <div style={{
                      width: `${progress}%`, height: '100%',
                      background: progress === 100 ? C.success : C.brand,
                      borderRadius: RADIUS.full, transition: 'width 0.4s ease',
                      boxShadow: progress === 100 ? `0 0 4px ${C.success}` : `0 0 4px ${C.brand}`,
                    }} />
                  </div>
                  <span style={{ ...TEXT.xs, color: C.textMuted, whiteSpace: 'nowrap' }}>{doneCount}/{phaseTasks.length}</span>
                  {inProgCount > 0 && <Badge color={C.warning} bg={C.bgInProgress}>{inProgCount} בביצוע</Badge>}
                  {blockedCount > 0 && <Badge color={C.statusBlocked} bg={C.bgBlocked}>{blockedCount} חסום</Badge>}
                  {isExecutionMode && canSelectAll && selectableForBulkIds.length > 0 && (() => {
                    const selectedInPhase = selectableIds.filter((id: string) => selectedTaskIds.has(id)).length;
                    return (
                      <>
                        {selectedInPhase > 0 && (
                          <>
                            <button onClick={e => { e.stopPropagation(); deselectGroup(selectableIds); }}
                              style={{ fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold, padding: '3px 8px', background: C.bgBlocked, color: C.statusBlocked, border: `1px solid ${C.statusBlocked}40`, borderRadius: RADIUS.md, cursor: 'pointer' }}>
                              ✕ בטל ({selectedInPhase})
                            </button>
                            <button onClick={e => { e.stopPropagation(); bulkUpdateGroup(selectableIds.filter((id: string) => selectedTaskIds.has(id)), 'IN_PROGRESS'); }}
                              style={{ fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold, padding: '3px 8px', background: C.statusInProgress, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer' }}>
                              ▶ התחל
                            </button>
                            <button onClick={e => { e.stopPropagation(); bulkUpdateGroup(selectableIds.filter((id: string) => selectedTaskIds.has(id)), 'DONE'); }}
                              style={{ fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold, padding: '3px 8px', background: C.statusDone, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer' }}>
                              ✓ סיים
                            </button>
                          </>
                        )}
                        <button onClick={e => {
                          e.stopPropagation();
                          setConfirmDialog({
                            title: 'בחר הכל בשלב',
                            message: `הפעולה תסמן ${selectableForBulkIds.length} משימות (OPEN/בביצוע/חסום) בשלב "${phase.name}".\nמשימות "ממתין לפתיחה" לא יסומנו.\nהאם להמשיך?`,
                            confirmLabel: `☑ סמן ${selectableForBulkIds.length} משימות`,
                            cancelLabel: 'ביטול',
                            variant: 'info',
                            onConfirm: () => { selectGroup(selectableForBulkIds); setConfirmDialog(null); },
                            onCancel: () => setConfirmDialog(null),
                          });
                        }}
                          style={{ padding: '2px 8px', background: C.bgOpen, color: C.statusOpen, border: `1px solid ${C.statusOpen}44`, borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                          ☑ בחר הכל
                        </button>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* SubPhases */}
              {!isCollapsed && subs.map((sub: any) => {
                const allSubTasks = sortTasks(
                  (taskBySub[sub.id] || []).filter((t: any) =>
                    (!localTeamFilter || t.assignedTeamId === localTeamFilter) &&
                    matchesUser(t) &&
                    (!localStatusFilter || t.status === localStatusFilter)
                  )
                );
                if (allSubTasks.length === 0) return null;

                const activeTasks = allSubTasks.filter((t: any) => !TERMINAL.has(t.status));
                const doneTasks   = allSubTasks.filter((t: any) => TERMINAL.has(t.status));
                const subDone     = doneTasks.length;
                const isSubCollapsed = collapsedSubs.has(sub.id);

                return (
                  <div key={sub.id} style={{ padding: '4px 16px 10px', borderBottom: `1px solid ${C.border}` }}>
                    {/* SubPhase header — clickable to collapse */}
                    <div
                      onClick={() => toggleSub(sub.id)}
                      style={{ padding: '7px 0 5px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}
                    >
                      <span style={{ color: C.textMuted, fontSize: '13px' }}>{isSubCollapsed ? '►' : '▼'}</span>
                      <span style={{ fontSize: '15px', fontWeight: 'bold', color: C.textPrimary }}>{sub.name}</span>
                      {(() => { const span = fmtSpan(allSubTasks.filter((t: any) => parseDurationMins(t.duration || '') !== null)); return span ? (
                        <span style={{ fontSize: '13px', color: C.textSecondary, background: C.bgNested, border: `1px solid ${C.border}`, padding: '1px 8px', borderRadius: '6px', fontWeight: 'bold', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                          ⏰ {span.time}
                          {span.dur && <span style={{ color: C.statusWaiting, background: C.bgWaiting, padding: '1px 6px', borderRadius: '5px', fontSize: '12px' }}>{span.dur}</span>}
                        </span>
                      ) : null; })()}
                      <span style={{ fontSize: '13px', color: subDone === allSubTasks.length ? C.statusDone : C.textMuted }}>
                        {subDone}/{allSubTasks.length}
                      </span>
                      {activeTasks.length > 0 && (
                        <span style={{ fontSize: '13px', background: C.bgOpen, color: C.statusOpen, padding: '1px 7px', borderRadius: '10px' }}>
                          {activeTasks.length} פעילות
                        </span>
                      )}
                      {isExecutionMode && canSelectAll && (() => {
                        const selectableSubIds = activeTasks.filter((t: any) => t.status !== 'WAITING').map((t: any) => t.id);
                        const selectedInSub = selectableSubIds.filter((id: string) => selectedTaskIds.has(id)).length;
                        if (selectableSubIds.length === 0) return null;
                        return (
                          <>
                            {selectedInSub > 0 && (
                              <>
                                <button onClick={e => { e.stopPropagation(); deselectGroup(selectableSubIds); }}
                                  style={{ padding: '1px 7px', background: C.bgBlocked, color: C.statusBlocked, border: `1px solid ${C.statusBlocked}44`, borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                                  ✕ בטל ({selectedInSub})
                                </button>
                                <button onClick={e => { e.stopPropagation(); bulkUpdateGroup(selectableSubIds.filter((id: string) => selectedTaskIds.has(id)), 'IN_PROGRESS'); }}
                                  style={{ padding: '1px 7px', background: C.statusInProgress, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                                  ▶ התחל הכל
                                </button>
                                <button onClick={e => { e.stopPropagation(); bulkUpdateGroup(selectableSubIds.filter((id: string) => selectedTaskIds.has(id)), 'DONE'); }}
                                  style={{ padding: '1px 7px', background: C.statusDone, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                                  ✓ סיים הכל
                                </button>
                              </>
                            )}
                            <button onClick={e => { e.stopPropagation(); selectGroup(selectableSubIds); }}
                              style={{ padding: '1px 7px', background: C.bgOpen, color: C.statusOpen, border: `1px solid ${C.statusOpen}44`, borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                              ☑ בחר הכל
                            </button>
                          </>
                        );
                      })()}
                    </div>

                    {!isSubCollapsed && (
                      <>
                        {/* Active tasks first */}
                        {activeTasks.map((task: any) => <TaskRow key={task.id} task={task} {...taskRowProps} />)}

                        {/* Done tasks — collapsible section at bottom */}
                        {doneTasks.length > 0 && (
                          <div style={{ marginTop: activeTasks.length > 0 ? '8px' : '0' }}>
                            <button
                              onClick={e => { e.stopPropagation(); toggleCompleted(sub.id); }}
                              style={{ width: '100%', padding: '9px 16px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', color: C.textMuted }}
                            >
                              <span>{expandedCompleted.has(sub.id) ? '▼' : '►'}</span>
                              <span style={{ fontWeight: 'bold' }}>הושלמו</span>
                              <span style={{ background: C.bgHover, color: C.textSecondary, padding: '1px 8px', borderRadius: '10px', fontSize: '14px' }}>{doneTasks.length}</span>
                            </button>
                            {expandedCompleted.has(sub.id) && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                                {doneTasks.map((task: any) => <TaskRow key={task.id} task={task} {...taskRowProps} />)}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })
      ) : (
        /* Flat view (EmployeeDashboard — no version) */
        (() => {
          const sorted      = sortTasks(displayTasks);
          const activeTasks = sorted.filter(t => !TERMINAL.has(t.status));
          const doneTasks   = sorted.filter(t => TERMINAL.has(t.status));
          const showDone    = expandedCompleted.has('flat');

          if (sorted.length === 0) return (
            <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, background: C.bgCard, borderRadius: '12px', border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: '48px' }}>📭</div>
              <p>אין משימות לצוות זה</p>
              {!isLocked && (
                <button onClick={() => setShowAddForm(true)}
                  style={{ marginTop: '12px', padding: '10px 24px', background: C.brand, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold' }}>
                  + הוסף משימה ראשונה
                </button>
              )}
            </div>
          );

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {/* Active tasks */}
              {activeTasks.map(task => <TaskRow key={task.id} task={task} {...taskRowProps} />)}

              {/* Completed section — collapsed by default */}
              {doneTasks.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  <button
                    onClick={() => toggleCompleted('flat')}
                    style={{ width: '100%', padding: '9px 16px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', color: C.textMuted }}
                  >
                    <span>{showDone ? '▼' : '►'}</span>
                    <span style={{ fontWeight: 'bold' }}>הושלמו</span>
                    <span style={{ background: C.bgHover, color: C.textSecondary, padding: '1px 8px', borderRadius: '10px', fontSize: '14px' }}>{doneTasks.length}</span>
                  </button>
                  {showDone && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                      {doneTasks.map(task => <TaskRow key={task.id} task={task} {...taskRowProps} />)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()
      )}
    {confirmDialog && <ConfirmDialog config={confirmDialog} onClose={() => setConfirmDialog(null)} />}
    {depToast && depToast.length > 0 && (
      <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9998, display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '340px' }}>
        {depToast.map((item: any, i) => {
          const noTiming = item.deltaMinutes === 0;
          const shortened = item.deltaMinutes < 0;
          const absMins = Math.abs(item.deltaMinutes);
          const label = item.subPhaseName ? `"${item.subPhaseName}"` : item.phaseName ? `"${item.phaseName}"` : '';
          const verb = shortened ? 'קוצר' : 'הוארך';
          const bg = noTiming ? '#e8f4fd' : shortened ? '#d4edda' : '#fff3cd';
          const border = noTiming ? '#17a2b8' : shortened ? '#28a745' : '#ffc107';
          const textColor = noTiming ? '#0c5460' : shortened ? '#155724' : '#856404';
          const icon = noTiming ? '🔗' : shortened ? '⏫' : '⏬';
          return (
            <div key={i} style={{ background: bg, border: `1px solid ${border}`, borderRadius: '10px', padding: '10px 14px', fontSize: '15px', color: textColor, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'flex-start', gap: '8px', direction: 'rtl' }}>
              <span style={{ fontSize: '17px', lineHeight: 1 }}>{icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>
                  {noTiming ? 'תלות הוסרה' : 'עדכון לוחות זמנים'}
                </div>
                {!noTiming && label && <div>תת-שלב {label} <strong>{verb} ב-{absMins} דק'</strong></div>}
                {!noTiming && item.phaseName && item.subPhaseName && <div style={{ fontSize: '13px', opacity: 0.8, marginTop: '2px' }}>שלב: {item.phaseName}</div>}
                {noTiming && <div style={{ fontSize: '14px', opacity: 0.8 }}>אין משימות עם לוח זמנים מוגדר</div>}
              </div>
              <button onClick={() => setDepToast(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: textColor, fontSize: '17px', padding: 0, lineHeight: 1, opacity: 0.6 }}>✕</button>
            </div>
          );
        })}
      </div>
    )}
    {focusMode && (
      <FocusModeModal
        tasks={focusTasks}
        spotlightTasks={focusTasks.filter(t => isMyFocusTask(t) && !TERMINAL_FOCUS.includes(t.status))}
        canOpenWaiting={isManager}
        updatingTaskId={updatingId}
        onAction={updateStatus}
        onBatchOpen={openNoDeps}
        openableCount={focusOpenableWaiting.length}
        onClose={() => { setFocusMode(false); onGoHome?.(); }}
        isMine={isMyFocusTask}
      />
    )}
    </div>
  );
};
