import React, { useState } from 'react';
import { C, FONT, WEIGHT, RADIUS, SHADOW, statusColor } from '../theme';

const TERMINAL = ['DONE', 'FAILED', 'ROLLED_BACK'];
const STATUS_LABEL: Record<string, string> = {
  DONE: 'הושלם', IN_PROGRESS: 'בביצוע', OPEN: 'פתוח', WAITING: 'ממתין', BLOCKED: 'חסום', FAILED: 'נכשל', ROLLED_BACK: 'Rollback',
};

const fmtTime = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : null;

const TaskRow: React.FC<{
  task: any;
  isMine: boolean;
  isUpdating: boolean;
  isBlocking: boolean;
  canOpenWaiting: boolean;
  onAction: (taskId: string, status: string, reason?: string) => void;
  onStartBlock: (taskId: string) => void;
  onCancelBlock: () => void;
  blockReason: string;
  setBlockReason: (v: string) => void;
}> = ({ task, isMine, isUpdating, isBlocking, canOpenWaiting, onAction, onStartBlock, onCancelBlock, blockReason, setBlockReason }) => {
  const isDone = TERMINAL.includes(task.status);
  const isIP = task.status === 'IN_PROGRESS';
  const isOpen = task.status === 'OPEN';
  const isWait = task.status === 'WAITING';
  const isBlocked = task.status === 'BLOCKED';
  const hasBlockingDeps = (task.dependencies ?? []).some((d: any) => !TERMINAL.includes(d.dependsOn?.status ?? ''));
  const sColor = statusColor(task.status);
  const btnBase: React.CSSProperties = {
    fontFamily: FONT, fontSize: '15px', fontWeight: WEIGHT.bold,
    padding: '7px 12px', border: 'none', borderRadius: RADIUS.sm,
    cursor: isUpdating ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap', opacity: isUpdating ? 0.6 : 1,
    width: '100%', textAlign: 'center' as const,
  };

  return (
    <div style={{
      borderRight: `3px solid ${sColor}`, borderBottom: `1px solid ${C.border}`,
      background: isDone ? C.bgNested : isMine ? `${sColor}0d` : C.bgCard,
      opacity: isDone ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', minHeight: '54px', gap: 0 }}>
        <div style={{ flex: 1, minWidth: 0, padding: '8px 12px 8px 4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' as const }}>
            {isMine && !isDone && <span style={{ color: C.brand, fontSize: '15px' }}>★</span>}
            <span style={{ fontSize: '17px', fontWeight: isMine && !isDone ? WEIGHT.bold : WEIGHT.medium, color: isDone ? C.textDisabled : C.textPrimary }}>
              {task.title}
            </span>
            {task.crNumber && <span style={{ fontSize: '14px', color: C.info, background: C.infoBg, padding: '2px 7px', borderRadius: RADIUS.sm, whiteSpace: 'nowrap' as const, flexShrink: 0 }}>{task.crNumber}</span>}
          </div>
          <div style={{ display: 'flex', gap: '9px', fontSize: '15px', color: C.textMuted, flexWrap: 'wrap' as const, alignItems: 'center' }}>
            {task.assignedTeam?.name && <span style={{ color: C.brand, background: C.brandDim, padding: '1px 7px', borderRadius: RADIUS.sm }}>{task.assignedTeam.name}</span>}
            {task.assignedUserName && <span>{task.assignedUserName.split(' ')[0]}</span>}
            {task.application && <span>{task.application}</span>}
            {task.duration && <span>⏱ {task.duration}</span>}
            {(() => {
              const pStart = task.rehearsalPlannedStart ?? task.plannedStart;
              const pEnd   = task.rehearsalPlannedEnd   ?? task.plannedEnd;
              if (!pStart && !pEnd) return null;
              return (
                <span style={{ color: C.textSecondary, background: C.bgNested, padding: '2px 8px', borderRadius: RADIUS.sm, whiteSpace: 'nowrap' as const }}>
                  🕐 {pStart ? fmtTime(pStart) : '?'}
                  {pEnd && ` — ${fmtTime(pEnd)}`}
                </span>
              );
            })()}
            {isBlocked && task.blockedReason && <span style={{ color: C.statusFailed }}>⛔ {task.blockedReason}</span>}
          </div>
          {(task.dependencies ?? []).length > 0 && (
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' as const, alignItems: 'center', marginTop: '2px' }}>
              <span style={{ fontSize: '14px', color: C.textDisabled, flexShrink: 0 }}>תלוי ב:</span>
              {(task.dependencies ?? []).map((d: any) => {
                const depStatus = d.dependsOn?.status ?? '';
                const done = TERMINAL.includes(depStatus);
                const dc = done ? C.statusDone : statusColor(depStatus);
                return (
                  <span key={d.id} style={{ fontSize: '14px', color: dc, background: dc + '22', padding: '2px 7px', borderRadius: RADIUS.sm, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, display: 'inline-block', flexShrink: 0 }}>
                    {done ? '✓' : '○'} {d.dependsOn?.title ?? '?'}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ width: '78px', flexShrink: 0, padding: '0 6px', textAlign: 'center' }}>
          <span style={{ fontSize: '14px', fontWeight: WEIGHT.semibold, color: sColor, background: sColor + '22', padding: '3px 8px', borderRadius: RADIUS.full, whiteSpace: 'nowrap' as const, display: 'inline-block' }}>
            {STATUS_LABEL[task.status] ?? task.status}
          </span>
        </div>

        <div style={{ width: '108px', flexShrink: 0, padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {!isDone && !isBlocking ? (
            <>
              {isOpen && (
                <button disabled={isUpdating} onClick={() => onAction(task.id, 'IN_PROGRESS')}
                  style={{ ...btnBase, background: C.statusInProgress, color: 'white' }}>▶ התחל</button>
              )}
              {isIP && (
                <button disabled={isUpdating} onClick={() => onAction(task.id, 'DONE')}
                  style={{ ...btnBase, background: C.statusDone, color: 'white' }}>✓ סיים</button>
              )}
              {isBlocked && (
                <button disabled={isUpdating} onClick={() => onAction(task.id, 'IN_PROGRESS')}
                  style={{ ...btnBase, background: 'transparent', color: C.statusDone, border: `1px solid ${C.statusDone}44` }}>♻️ חזור</button>
              )}
              {(isOpen || isIP) && (
                <button disabled={isUpdating} onClick={() => onStartBlock(task.id)}
                  style={{ ...btnBase, background: 'transparent', color: C.statusFailed, border: `1px solid ${C.statusFailed}55` }}>🚫 חסום</button>
              )}
              {isWait && !hasBlockingDeps && canOpenWaiting && (
                <button disabled={isUpdating} onClick={() => onAction(task.id, 'OPEN')}
                  style={{ ...btnBase, background: C.brand, color: 'white' }}>▷ פתח</button>
              )}
            </>
          ) : isDone ? (
            <span style={{ fontSize: '22px', textAlign: 'center', display: 'block', opacity: 0.5 }}>
              {task.status === 'DONE' ? '✓' : task.status === 'FAILED' ? '✗' : '⏪'}
            </span>
          ) : null}
        </div>
      </div>

      {isBlocking && (
        <div style={{ padding: '10px 12px 12px', borderTop: `1px solid ${C.border}` }}>
          <textarea autoFocus value={blockReason} onChange={e => setBlockReason(e.target.value)}
            placeholder="סיבת חסימה (חובה)..." rows={2}
            style={{ width: '100%', padding: '9px 12px', borderRadius: RADIUS.sm, border: `1px solid ${C.statusFailed}66`, fontSize: '16px', resize: 'none', boxSizing: 'border-box', direction: 'rtl', fontFamily: FONT, background: C.bgNested, color: C.textPrimary, outline: 'none', marginBottom: '8px' }}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onCancelBlock}
              style={{ flex: 1, padding: '8px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: 'pointer', fontFamily: FONT, fontSize: '15px' }}>
              ביטול
            </button>
            <button disabled={!blockReason.trim() || isUpdating}
              onClick={() => onAction(task.id, 'BLOCKED', blockReason.trim())}
              style={{ flex: 2, padding: '8px', background: blockReason.trim() ? C.statusFailed : C.bgNested, color: blockReason.trim() ? 'white' : C.textDisabled, border: 'none', borderRadius: RADIUS.sm, cursor: blockReason.trim() ? 'pointer' : 'not-allowed', fontWeight: WEIGHT.bold, fontFamily: FONT, fontSize: '15px' }}>
              אשר חסימה 🚫
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export interface FocusModeModalProps {
  phaseLabel?: string | null;
  tasks: any[]; // already scoped; each may carry _subPhaseName / _phaseName for grouping
  spotlightTasks?: any[];
  spotlightLabel?: string;
  canOpenWaiting?: boolean;
  updatingTaskId: string | null;
  onAction: (taskId: string, status: string, reason?: string) => void;
  onBatchOpen?: () => void;
  openableCount?: number;
  onClose: () => void;
  isMine: (task: any) => boolean;
  // Shown as a completion banner once every task here is done — tells the user
  // what's coming next instead of leaving them looking at an empty list.
  nextPhaseInfo?: { name: string; startTime?: string | Date | null } | null;
}

export const FocusModeModal: React.FC<FocusModeModalProps> = ({
  phaseLabel, tasks, spotlightTasks = [], spotlightLabel = '★ המשימות שלי',
  canOpenWaiting = false, updatingTaskId, onAction, onBatchOpen, openableCount = 0,
  onClose, isMine, nextPhaseInfo,
}) => {
  const [nearOnly, setNearOnly] = useState(false);
  const [blockTaskId, setBlockTaskId] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const NEAR_MINUTES = 15;

  const handleAction = (taskId: string, status: string, reason?: string) => {
    onAction(taskId, status, reason);
    if (status === 'BLOCKED') { setBlockTaskId(null); setBlockReason(''); }
  };

  const done = tasks.filter(t => TERMINAL.includes(t.status)).length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const phaseComplete = total > 0 && done === total;

  const now = Date.now();
  const isNear = (t: any) => {
    if (['OPEN', 'IN_PROGRESS', 'BLOCKED'].includes(t.status)) return true;
    if (!TERMINAL.includes(t.status) && t.plannedStart) {
      const ms = new Date(t.plannedStart).getTime() - now;
      return ms >= 0 && ms <= NEAR_MINUTES * 60_000;
    }
    return false;
  };
  const filterList = (list: any[]) => nearOnly ? list.filter(isNear) : list;

  const filteredSpotlight = filterList(spotlightTasks);
  const groups: { subName: string; tasks: any[] }[] = [];
  for (const t of tasks) {
    if (spotlightTasks.includes(t)) continue; // don't double-list spotlighted tasks
    const name = t._subPhaseName || t._phaseName || '';
    let g = groups.find(x => x.subName === name);
    if (!g) { g = { subName: name, tasks: [] }; groups.push(g); }
    g.tasks.push(t);
  }
  const filteredGroups = groups.map(g => ({ ...g, tasks: filterList(g.tasks) })).filter(g => g.tasks.length > 0);
  const nearCount = tasks.filter(isNear).length;

  const rowProps = (task: any) => ({
    task, isMine: isMine(task), isUpdating: updatingTaskId === task.id,
    isBlocking: blockTaskId === task.id, canOpenWaiting,
    onAction: handleAction,
    onStartBlock: (id: string) => { setBlockTaskId(id); setBlockReason(''); },
    onCancelBlock: () => { setBlockTaskId(null); setBlockReason(''); },
    blockReason, setBlockReason,
  });

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: C.bgOverlay, zIndex: 20000, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl', fontFamily: FONT }}
      onClick={onClose}
    >
      <div
        style={{ width: '100%', maxWidth: '860px', height: '90vh', margin: '0 16px', display: 'flex', flexDirection: 'column', background: C.bgApp, borderRadius: RADIUS.xl, boxShadow: SHADOW.lg, overflow: 'hidden', border: `1px solid ${C.border}` }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header — big, unambiguous title with the phase as a clear subtitle */}
        <div style={{ background: C.brand, padding: '18px 22px', flexShrink: 0, boxShadow: SHADOW.sm }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontSize: '28px' }}>⚡</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '22px', fontWeight: WEIGHT.bold, color: 'white', lineHeight: 1.15 }}>מצב הרצה</div>
              {phaseLabel && (
                <div style={{ fontSize: '16px', color: 'rgba(255,255,255,0.85)', marginTop: '2px', fontWeight: WEIGHT.medium }}>
                  {phaseLabel}
                </div>
              )}
            </div>
            <span style={{ fontSize: '17px', fontWeight: WEIGHT.bold, color: 'white', background: 'rgba(255,255,255,0.18)', padding: '5px 14px', borderRadius: RADIUS.md, whiteSpace: 'nowrap' as const }}>
              {done}/{total}
            </span>
            <button onClick={onClose}
              style={{ background: 'rgba(255,255,255,0.18)', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px', width: '34px', height: '34px', borderRadius: RADIUS.md, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              ×
            </button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '15px', color: 'rgba(255,255,255,0.85)', userSelect: 'none' as const, marginTop: '12px' }}>
            <input type="checkbox" checked={nearOnly} onChange={e => setNearOnly(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: 'white', cursor: 'pointer' }} />
            <span style={{ fontWeight: nearOnly ? WEIGHT.bold : WEIGHT.normal }}>
              {NEAR_MINUTES} דקות קרובות בלבד
              {nearOnly && <span style={{ marginRight: '6px' }}>({nearCount})</span>}
            </span>
          </label>
        </div>

        {/* Progress bar */}
        <div style={{ padding: '12px 22px', background: C.bgCard, borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ flex: 1, height: '9px', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? C.statusDone : `linear-gradient(90deg, ${C.brand}, ${C.statusInProgress})`, borderRadius: RADIUS.sm, transition: 'width 0.5s ease' }} />
          </div>
          <span style={{ fontSize: '16px', fontWeight: WEIGHT.semibold, color: C.textSecondary, whiteSpace: 'nowrap' as const }}>{pct}%</span>
          {canOpenWaiting && openableCount > 0 && onBatchOpen && (
            <button disabled={!!updatingTaskId} onClick={onBatchOpen}
              style={{ padding: '7px 16px', background: C.bgInProgress ?? C.statusInProgress + '22', color: '#8a6d00', border: `1px solid ${C.statusInProgress}55`, borderRadius: RADIUS.md, cursor: updatingTaskId ? 'not-allowed' : 'pointer', fontWeight: WEIGHT.bold, fontSize: '15px', fontFamily: FONT, whiteSpace: 'nowrap' as const, opacity: updatingTaskId ? 0.6 : 1 }}>
              🔓 פתח ללא תלות ({openableCount})
            </button>
          )}
        </div>

        {/* Phase-complete banner */}
        {phaseComplete && (
          <div style={{ padding: '14px 22px', background: C.successBg, borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>✅</span>
            <div>
              <div style={{ fontSize: '17px', fontWeight: WEIGHT.bold, color: C.statusDone }}>
                {phaseLabel ? `השלב "${phaseLabel}" הושלם!` : 'השלב הושלם!'}
              </div>
              <div style={{ fontSize: '15px', color: C.textSecondary, marginTop: '2px' }}>
                {nextPhaseInfo
                  ? (nextPhaseInfo.startTime
                      ? `ממתינים לשלב הבא — "${nextPhaseInfo.name}" יחל בשעה ${fmtTime(nextPhaseInfo.startTime)}`
                      : `ממתינים לשלב הבא — "${nextPhaseInfo.name}"`)
                  : 'ממתינים להנחיות להמשך'}
              </div>
            </div>
          </div>
        )}

        {/* Task list */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {total === 0 ? (
            <div style={{ padding: '60px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
              <div style={{ fontSize: '18px', fontWeight: WEIGHT.bold, color: C.statusDone }}>כל השלבים הושלמו!</div>
            </div>
          ) : (
            <>
              {filteredSpotlight.length > 0 && (
                <div>
                  <div style={{ fontSize: '15px', fontWeight: WEIGHT.bold, color: C.brand, padding: '10px 18px', background: C.brandDim, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {spotlightLabel} ({filteredSpotlight.length})
                  </div>
                  {filteredSpotlight.map((t: any) => <TaskRow key={t.id} {...rowProps(t)} />)}
                </div>
              )}

              {filteredGroups.map(grp => {
                const grpDone = grp.tasks.filter((t: any) => TERMINAL.includes(t.status)).length;
                return (
                  <div key={grp.subName}>
                    <div style={{ fontSize: '15px', fontWeight: WEIGHT.bold, color: C.textSecondary, padding: '9px 18px', background: C.bgNested, borderBottom: `1px solid ${C.border}`, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{grp.subName}</span>
                      <span style={{ color: grpDone === grp.tasks.length ? C.statusDone : C.textMuted }}>{grpDone}/{grp.tasks.length}</span>
                    </div>
                    {grp.tasks.map((t: any) => <TaskRow key={t.id} {...rowProps(t)} />)}
                  </div>
                );
              })}

              {nearOnly && nearCount === 0 && !phaseComplete && (
                <div style={{ padding: '48px', textAlign: 'center', color: C.textMuted }}>
                  <div style={{ fontSize: '32px', marginBottom: '10px' }}>⏳</div>
                  <div style={{ fontSize: '16px' }}>אין משימות פעילות בטווח {NEAR_MINUTES} הדקות הקרובות</div>
                  <button onClick={() => setNearOnly(false)}
                    style={{ marginTop: '14px', padding: '9px 20px', background: C.bgNested, color: C.textPrimary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '15px', fontFamily: FONT }}>
                    הצג כל המשימות
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer stats */}
        <div style={{ background: C.bgCard, borderTop: `1px solid ${C.border}`, padding: '10px 22px', display: 'flex', gap: '18px', fontSize: '15px', color: C.textMuted, flexShrink: 0, flexWrap: 'wrap' as const }}>
          {[
            { label: 'הושלם', count: tasks.filter(t => t.status === 'DONE').length, color: C.statusDone },
            { label: 'בביצוע', count: tasks.filter(t => t.status === 'IN_PROGRESS').length, color: C.statusInProgress },
            { label: 'פתוח', count: tasks.filter(t => t.status === 'OPEN').length, color: C.statusOpen },
            { label: 'ממתין', count: tasks.filter(t => t.status === 'WAITING').length, color: C.statusWaiting },
            { label: 'חסום', count: tasks.filter(t => t.status === 'BLOCKED').length, color: C.statusFailed },
          ].filter(s => s.count > 0).map(s => (
            <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: s.color, display: 'inline-block' }} />
              <span style={{ color: s.color, fontWeight: WEIGHT.bold }}>{s.count}</span>
              <span>{s.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
