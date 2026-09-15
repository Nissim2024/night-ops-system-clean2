import React, { useState } from 'react';
import { C, statusColor } from '../theme';
import { formatTime } from '../utils/dateFormat';

const TERMINAL = ['DONE', 'FAILED', 'ROLLED_BACK'];
const STATUS_LABEL: Record<string, string> = {
  DONE: 'הושלם', IN_PROGRESS: 'בביצוע', OPEN: 'פתוח', WAITING: 'ממתין', BLOCKED: 'חסום', FAILED: 'נכשל', ROLLED_BACK: 'Rollback',
};

const fmtTime = (d?: string | Date | null) => d ? formatTime(d) : null;

// Task-status colors (7 distinct states) have no equivalent in the semantic
// success/warning/danger/info token set — kept as real per-status hex via
// the existing statusColor() helper, applied through inline style (same
// treatment as other runtime/data-driven color palettes in this migration).
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
  const btnBaseClass = `text-[15px] font-bold px-3 py-[7px] border-none rounded-sm whitespace-nowrap w-full text-center ${isUpdating ? 'cursor-not-allowed opacity-60' : 'cursor-pointer opacity-100'}`;

  return (
    <div
      className={`border-b border-border ${isDone ? 'opacity-55' : 'opacity-100'}`}
      style={{ borderInlineStart: `3px solid ${sColor}`, background: isDone ? undefined : isMine ? `${sColor}0d` : undefined }}
    >
      <div className="flex items-center gap-0 min-h-[54px]">
        <div className="flex-1 min-w-0 pe-1 ps-3 py-2 flex flex-col gap-1">
          <div className="flex items-center gap-[7px] flex-wrap">
            {isMine && !isDone && <span className="text-primary text-[15px]">★</span>}
            <span className={`text-[17px] ${isMine && !isDone ? 'font-bold' : 'font-medium'} ${isDone ? 'text-subtle-foreground' : 'text-foreground'}`}>
              {task.title}
            </span>
            {task.crNumber && <span className="text-sm text-info bg-info-bg px-[7px] py-0.5 rounded-sm whitespace-nowrap shrink-0">{task.crNumber}</span>}
          </div>
          <div className="flex gap-[9px] text-[15px] text-subtle-foreground flex-wrap items-center">
            {task.assignedTeam?.name && <span className="text-primary bg-primary-50 px-[7px] py-px rounded-sm">{task.assignedTeam.name}</span>}
            {task.assignedUserName && <span>{task.assignedUserName.split(' ')[0]}</span>}
            {task.application && <span>{task.application}</span>}
            {task.duration && <span>⏱ {task.duration}</span>}
            {(() => {
              const pStart = task.rehearsalPlannedStart ?? task.plannedStart;
              const pEnd   = task.rehearsalPlannedEnd   ?? task.plannedEnd;
              if (!pStart && !pEnd) return null;
              return (
                <span className="text-muted-foreground bg-muted px-2 py-0.5 rounded-sm whitespace-nowrap">
                  🕐 {pStart ? fmtTime(pStart) : '?'}
                  {pEnd && ` — ${fmtTime(pEnd)}`}
                </span>
              );
            })()}
            {isBlocked && task.blockedReason && <span className="text-danger">⛔ {task.blockedReason}</span>}
          </div>
          {(task.dependencies ?? []).length > 0 && (
            <div className="flex gap-1.5 flex-wrap items-center mt-0.5">
              <span className="text-sm text-subtle-foreground shrink-0">תלוי ב:</span>
              {(task.dependencies ?? []).map((d: any) => {
                const depStatus = d.dependsOn?.status ?? '';
                const done = TERMINAL.includes(depStatus);
                const dc = done ? C.statusDone : statusColor(depStatus);
                return (
                  <span key={d.id} className="text-sm px-[7px] py-0.5 rounded-sm max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap inline-block shrink-0" style={{ color: dc, background: dc + '22' }}>
                    {done ? '✓' : '○'} {d.dependsOn?.title ?? '?'}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="w-[78px] shrink-0 px-1.5 text-center">
          <span className="text-sm font-semibold px-2 py-[3px] rounded-full whitespace-nowrap inline-block" style={{ color: sColor, background: sColor + '22' }}>
            {STATUS_LABEL[task.status] ?? task.status}
          </span>
        </div>

        <div className="w-[108px] shrink-0 px-2 py-1 flex flex-col gap-1">
          {!isDone && !isBlocking ? (
            <>
              {isOpen && (
                <button disabled={isUpdating} onClick={() => onAction(task.id, 'IN_PROGRESS')}
                  className={btnBaseClass} style={{ background: C.statusInProgress, color: 'white' }}>▶ התחל</button>
              )}
              {isIP && (
                <button disabled={isUpdating} onClick={() => onAction(task.id, 'DONE')}
                  className={btnBaseClass} style={{ background: C.statusDone, color: 'white' }}>✓ סיים</button>
              )}
              {isBlocked && (
                <button disabled={isUpdating} onClick={() => onAction(task.id, 'IN_PROGRESS')}
                  className={btnBaseClass} style={{ background: 'transparent', color: C.statusDone, border: `1px solid ${C.statusDone}44` }}>♻️ חזור</button>
              )}
              {(isOpen || isIP) && (
                <button disabled={isUpdating} onClick={() => onStartBlock(task.id)}
                  className={btnBaseClass} style={{ background: 'transparent', color: C.statusFailed, border: `1px solid ${C.statusFailed}55` }}>🚫 חסום</button>
              )}
              {isWait && !hasBlockingDeps && canOpenWaiting && (
                <button disabled={isUpdating} onClick={() => onAction(task.id, 'OPEN')}
                  className={`${btnBaseClass} bg-primary text-white`}>▷ פתח</button>
              )}
            </>
          ) : isDone ? (
            <span className="text-[22px] text-center block opacity-50">
              {task.status === 'DONE' ? '✓' : task.status === 'FAILED' ? '✗' : '⏪'}
            </span>
          ) : null}
        </div>
      </div>

      {isBlocking && (
        <div className="px-3 pt-2.5 pb-3 border-t border-border">
          <textarea autoFocus value={blockReason} onChange={e => setBlockReason(e.target.value)}
            placeholder="סיבת חסימה (חובה)..." rows={2}
            className="w-full px-3 py-[9px] rounded-sm text-base resize-none box-border bg-muted text-foreground outline-none mb-2"
            style={{ border: `1px solid ${C.statusFailed}66` }}
          />
          <div className="flex gap-2">
            <button onClick={onCancelBlock}
              className="flex-1 p-2 bg-muted text-muted-foreground border border-border rounded-sm cursor-pointer text-[15px]">
              ביטול
            </button>
            <button disabled={!blockReason.trim() || isUpdating}
              onClick={() => onAction(task.id, 'BLOCKED', blockReason.trim())}
              className="flex-[2] p-2 border-none rounded-sm font-bold text-[15px]"
              style={{ background: blockReason.trim() ? C.statusFailed : undefined, color: blockReason.trim() ? 'white' : undefined, cursor: blockReason.trim() ? 'pointer' : 'not-allowed' }}
            >
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
      className="fixed inset-0 bg-foreground/45 z-[20000] flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[860px] h-[90vh] mx-4 flex flex-col bg-background rounded-xl shadow-lg overflow-hidden border border-border"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — big, unambiguous title with the phase as a clear subtitle */}
        <div className="bg-primary px-[22px] py-[18px] shrink-0 shadow-sm">
          <div className="flex items-center gap-3.5">
            <span className="text-[28px]">⚡</span>
            <div className="flex-1 min-w-0">
              <div className="text-[22px] font-bold text-white leading-tight">מצב הרצה</div>
              {phaseLabel && (
                <div className="text-base text-white/85 mt-0.5 font-medium">
                  {phaseLabel}
                </div>
              )}
            </div>
            <span className="text-[17px] font-bold text-white bg-white/[.18] px-3.5 py-[5px] rounded-md whitespace-nowrap">
              {done}/{total}
            </span>
            <button onClick={onClose}
              className="bg-white/[.18] border-none text-white cursor-pointer text-xl w-[34px] h-[34px] rounded-md flex items-center justify-center shrink-0">
              ×
            </button>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-[15px] text-white/85 select-none mt-3">
            <input type="checkbox" checked={nearOnly} onChange={e => setNearOnly(e.target.checked)}
              className="w-4 h-4 accent-white cursor-pointer" />
            <span className={nearOnly ? 'font-bold' : 'font-normal'}>
              {NEAR_MINUTES} דקות קרובות בלבד
              {nearOnly && <span className="me-1.5">({nearCount})</span>}
            </span>
          </label>
        </div>

        {/* Progress bar */}
        <div className="px-[22px] py-3 bg-card border-b border-border shrink-0 flex items-center gap-3.5">
          <div className="flex-1 h-[9px] bg-muted rounded-sm overflow-hidden">
            <div
              className="h-full rounded-sm transition-[width] duration-slow ease-out"
              style={{ width: `${pct}%`, background: pct === 100 ? C.statusDone : `linear-gradient(90deg, ${C.brand}, ${C.statusInProgress})` }}
            />
          </div>
          <span className="text-base font-semibold text-muted-foreground whitespace-nowrap">{pct}%</span>
          {canOpenWaiting && openableCount > 0 && onBatchOpen && (
            <button disabled={!!updatingTaskId} onClick={onBatchOpen}
              className={`px-4 py-[7px] rounded-md font-bold text-[15px] whitespace-nowrap ${updatingTaskId ? 'cursor-not-allowed opacity-60' : 'cursor-pointer opacity-100'}`}
              style={{ background: C.bgInProgress ?? C.statusInProgress + '22', color: '#8a6d00', border: `1px solid ${C.statusInProgress}55` }}
            >
              🔓 פתח ללא תלות ({openableCount})
            </button>
          )}
        </div>

        {/* Phase-complete banner */}
        {phaseComplete && (
          <div className="px-[22px] py-3.5 bg-success-bg border-b border-border shrink-0 flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <div>
              <div className="text-[17px] font-bold text-success">
                {phaseLabel ? `השלב "${phaseLabel}" הושלם!` : 'השלב הושלם!'}
              </div>
              <div className="text-[15px] text-muted-foreground mt-0.5">
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
        <div className="flex-1 overflow-y-auto min-h-0">
          {total === 0 ? (
            <div className="p-[60px] text-center">
              <div className="text-5xl mb-3">✅</div>
              <div className="text-lg font-bold text-success">כל השלבים הושלמו!</div>
            </div>
          ) : (
            <>
              {filteredSpotlight.length > 0 && (
                <div>
                  <div className="text-[15px] font-bold text-primary px-[18px] py-2.5 bg-primary-50 border-b border-border flex items-center gap-1.5">
                    {spotlightLabel} ({filteredSpotlight.length})
                  </div>
                  {filteredSpotlight.map((t: any) => <TaskRow key={t.id} {...rowProps(t)} />)}
                </div>
              )}

              {filteredGroups.map(grp => {
                const grpDone = grp.tasks.filter((t: any) => TERMINAL.includes(t.status)).length;
                return (
                  <div key={grp.subName}>
                    <div className="text-[15px] font-bold text-muted-foreground px-[18px] py-[9px] bg-muted border-b border-t border-border flex justify-between items-center">
                      <span>{grp.subName}</span>
                      <span className={grpDone === grp.tasks.length ? 'text-success' : 'text-subtle-foreground'}>{grpDone}/{grp.tasks.length}</span>
                    </div>
                    {grp.tasks.map((t: any) => <TaskRow key={t.id} {...rowProps(t)} />)}
                  </div>
                );
              })}

              {nearOnly && nearCount === 0 && !phaseComplete && (
                <div className="p-12 text-center text-subtle-foreground">
                  <div className="text-[32px] mb-2.5">⏳</div>
                  <div className="text-base">אין משימות פעילות בטווח {NEAR_MINUTES} הדקות הקרובות</div>
                  <button onClick={() => setNearOnly(false)}
                    className="mt-3.5 px-5 py-[9px] bg-muted text-foreground border border-border rounded-md cursor-pointer text-[15px]">
                    הצג כל המשימות
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer stats */}
        <div className="bg-card border-t border-border px-[22px] py-2.5 flex gap-[18px] text-[15px] text-subtle-foreground shrink-0 flex-wrap">
          {[
            { label: 'הושלם', count: tasks.filter(t => t.status === 'DONE').length, color: C.statusDone },
            { label: 'בביצוע', count: tasks.filter(t => t.status === 'IN_PROGRESS').length, color: C.statusInProgress },
            { label: 'פתוח', count: tasks.filter(t => t.status === 'OPEN').length, color: C.statusOpen },
            { label: 'ממתין', count: tasks.filter(t => t.status === 'WAITING').length, color: C.statusWaiting },
            { label: 'חסום', count: tasks.filter(t => t.status === 'BLOCKED').length, color: C.statusFailed },
          ].filter(s => s.count > 0).map(s => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: s.color }} />
              <span className="font-bold" style={{ color: s.color }}>{s.count}</span>
              <span>{s.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
