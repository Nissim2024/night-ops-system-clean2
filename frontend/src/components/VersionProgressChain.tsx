import React from 'react';
import { C, SHADOW } from '../theme';
import { cn } from '../lib/utils';

interface Props {
  versionStatus: string;
  activeRunPhase?: number;
  rehearsalDone?: boolean;
  rehearsalSummaryApproved?: boolean;
  summaryBeforeMorning?: boolean;
  onStageClick?: (stageId: string) => void;
}

const STATUS_ORDER = [
  'DRAFT', 'COLLECTING', 'CR_REVIEW', 'REFINING', 'REVIEW', 'APPROVED',
  'REHEARSAL',
  'READY_FOR_RUN', // sentinel: APPROVED after rehearsal
  'ACTIVE', 'MORNING_AFTER',
  'COMPLETED',
];

// Colors aligned with theme.ts tokens
const STAGE_COLOR = {
  prep:      { main: C.info,      glow: 'rgba(69,115,210,0.20)'  },
  rehearsal: { main: '#F0883E',   glow: 'rgba(240,136,62,0.20)'  },
  ready:     { main: '#D4A017',   glow: 'rgba(212,160,23,0.22)'  },
  run:       { main: C.brand,     glow: 'rgba(240,106,106,0.20)' },
  done:      { main: C.success,   glow: 'rgba(55,196,122,0.20)'  },
};

const STAGES = [
  {
    id: 'prep', label: 'תכנון', icon: '📋',
    ...STAGE_COLOR.prep,
    subs: [
      { label: 'טיוטה',       status: 'DRAFT',      key: 'draft'      },
      { label: 'איסוף',       status: 'COLLECTING', key: 'collecting' },
      { label: 'סקירת CR',    status: 'CR_REVIEW',  key: 'cr_review'  },
      { label: 'טיוב',        status: 'REFINING',   key: 'refining'   },
      { label: 'ישיבת מעבר', status: 'REVIEW',     key: 'review'     },
      { label: 'אישור',       status: 'APPROVED',   key: 'approved'   },
    ],
  },
  {
    id: 'rehearsal', label: 'חזרה', icon: '🎭',
    ...STAGE_COLOR.rehearsal,
    subs: [
      { label: 'שלב 1', status: 'REHEARSAL', key: 'r1' },
      { label: 'שלב 2', status: 'REHEARSAL', key: 'r2' },
      { label: 'שלב 3', status: 'REHEARSAL', key: 'r3' },
      { label: 'שלב 4', status: 'REHEARSAL', key: 'r4' },
      { label: 'סיכום',  status: 'REHEARSAL', key: 'r5' },
    ],
  },
  {
    // Shown only after rehearsal completes (rehearsalDone=true, status=APPROVED)
    id: 'ready', label: 'ממתין', icon: '⏳',
    ...STAGE_COLOR.ready,
    subs: [
      { label: 'סיכום חזרה',  status: 'REHEARSAL_SUMMARY_APPROVED', key: 'ready_summary' },
      { label: 'אישור להרצה', status: 'READY_FOR_RUN',               key: 'ready_approve' },
    ],
  },
  {
    id: 'run', label: 'הטמעה', icon: '🚀',
    ...STAGE_COLOR.run,
    subs: [
      { label: 'שלב 1', status: 'ACTIVE',        key: 'phase1' },
      { label: 'שלב 2', status: 'ACTIVE',        key: 'phase2' },
      { label: 'שלב 3', status: 'ACTIVE',        key: 'phase3' },
      { label: 'בוקר',  status: 'MORNING_AFTER', key: 'morning' },
      { label: 'סיכום', status: 'MORNING_AFTER', key: 'summary' },
    ],
  },
  {
    id: 'done', label: 'הושלם', icon: '✅',
    ...STAGE_COLOR.done,
    subs: [{ label: 'בייצור', status: 'COMPLETED', key: 'completed' }],
  },
];

type NodeState = 'done' | 'active' | 'pending';

function subState(subStatus: string, current: string, rehearsalDone = false, summaryApproved = false): NodeState {
  if (subStatus === 'REHEARSAL' && rehearsalDone && current === 'APPROVED') return 'done';
  if (subStatus === 'REHEARSAL_SUMMARY_APPROVED') {
    if (!rehearsalDone) return 'pending';
    if (summaryApproved || ['ACTIVE', 'MORNING_AFTER', 'COMPLETED'].includes(current)) return 'done';
    return 'active';
  }
  if (subStatus === 'READY_FOR_RUN') {
    if (!rehearsalDone) return 'pending';
    if (['ACTIVE', 'MORNING_AFTER', 'COMPLETED'].includes(current)) return 'done';
    if (current === 'APPROVED') return 'active';
    return 'pending';
  }
  const ci = STATUS_ORDER.indexOf(current);
  const si = STATUS_ORDER.indexOf(subStatus);
  if (ci === -1 || si === -1) return 'pending';
  if (ci > si) return 'done';
  if (ci === si) return 'active';
  return 'pending';
}

// run stage is now at index 3 in STAGES
const RUN_STAGE_IDX = 3;

function runSubStateByPhase(subIdx: number, current: string, activeRunPhase: number): NodeState {
  // Only track phase progress during ACTIVE (real run) — not during REHEARSAL
  if (current !== 'ACTIVE') return subState(STAGES[RUN_STAGE_IDX].subs[subIdx].status, current);
  if (subIdx < 3) {
    const phaseNum = subIdx + 1;
    if (phaseNum < activeRunPhase) return 'done';
    if (phaseNum === activeRunPhase) return 'active';
    return 'pending';
  }
  return 'pending';
}

function mainState(subs: { status: string }[], current: string, stageId: string, activeRunPhase: number, rehearsalDone = false, summaryApproved = false): NodeState {
  const states = subs.map((s, i) =>
    stageId === 'run' ? runSubStateByPhase(i, current, activeRunPhase) : subState(s.status, current, rehearsalDone, summaryApproved)
  );
  if (states.every(s => s === 'done')) return 'done';
  if (states.some(s => s === 'done' || s === 'active')) return 'active';
  return 'pending';
}

const STAGE_LABEL: Record<string, string> = {
  DRAFT: 'טיוטה', COLLECTING: 'איסוף משימות', CR_REVIEW: 'סקירת CR',
  REFINING: 'טיוב תוכנית', REVIEW: 'ישיבת מעבר', APPROVED: 'תוכנית מאושרת',
  APPROVED_AFTER_REHEARSAL: 'ממתין להרצה',
  REHEARSAL: 'חזרה גנרלית', ACTIVE: 'לילה פעיל', MORNING_AFTER: 'בוקר שלאחר',
  COMPLETED: 'הושלם', ROLLED_BACK: 'Rollback',
};

// Linear order used for "next step" + completion % (READY_FOR_RUN inserted as a virtual waypoint)
const POSITION_ORDER = [
  'DRAFT', 'COLLECTING', 'CR_REVIEW', 'REFINING', 'REVIEW', 'APPROVED',
  'REHEARSAL', 'APPROVED_AFTER_REHEARSAL', 'ACTIVE', 'MORNING_AFTER', 'COMPLETED',
];

export const VersionProgressChain: React.FC<Props> = ({
  versionStatus, activeRunPhase = 1, rehearsalDone = false,
  rehearsalSummaryApproved = false, summaryBeforeMorning = false, onStageClick,
}) => {
  const effective       = versionStatus === 'ROLLED_BACK' ? 'MORNING_AFTER' : versionStatus;
  const isRolledBack    = versionStatus === 'ROLLED_BACK';
  const isReadyForRun   = rehearsalDone && versionStatus === 'APPROVED';
  const currentLabelKey = isReadyForRun ? 'APPROVED_AFTER_REHEARSAL' : versionStatus;
  const currentLabel    = STAGE_LABEL[currentLabelKey] ?? versionStatus;

  const positionIdx  = POSITION_ORDER.indexOf(currentLabelKey);
  const completionPct = positionIdx >= 0 ? Math.round((positionIdx / (POSITION_ORDER.length - 1)) * 100) : null;
  const nextStepLabel = positionIdx >= 0 && positionIdx < POSITION_ORDER.length - 1
    ? STAGE_LABEL[POSITION_ORDER[positionIdx + 1]]
    : null;

  const STAGES_DISPLAY = STAGES.map(stage => {
    if (stage.id !== 'run' || !summaryBeforeMorning) return stage;
    const subs = [...stage.subs];
    const morningIdx = subs.findIndex(s => s.key === 'morning');
    const summaryIdx = subs.findIndex(s => s.key === 'summary');
    if (morningIdx >= 0 && summaryIdx >= 0) {
      [subs[morningIdx], subs[summaryIdx]] = [subs[summaryIdx], subs[morningIdx]];
    }
    return { ...stage, subs };
  });

  return (
    <div className="bg-card border-b border-border pt-3.5 px-7 pb-4 shadow-xs">
      <div className="flex items-center">

        {/* Right side: current stage label (anchored to RTL start = visual right) */}
        <div className="flex items-center gap-1.5 shrink-0 me-5">
          <span className="text-xs font-medium text-subtle-foreground whitespace-nowrap">
            שלב נוכחי:
          </span>
          <span className={cn(
            'text-xs font-semibold rounded-full py-0.5 px-2 whitespace-nowrap border',
            isRolledBack
              ? 'text-danger bg-danger-bg border-danger/[18.82%]'
              : 'text-muted-foreground bg-muted border-border'
          )}>
            {isRolledBack ? '🔄 ' : ''}{currentLabel}
          </span>

          {isReadyForRun && (
            <span className="text-xs rounded-full py-0.5 px-2 whitespace-nowrap border text-[#D4A017] bg-[rgba(212,160,23,0.12)] border-[rgba(212,160,23,0.30)]">
              ✓ חזרה הושלמה — ממתין לפתיחת לילה
            </span>
          )}

          {!isRolledBack && nextStepLabel && (
            <span className="text-xs text-subtle-foreground whitespace-nowrap">
              ← שלב הבא: <strong className="text-muted-foreground">{nextStepLabel}</strong>
            </span>
          )}

          {!isRolledBack && completionPct !== null && (
            <span title="התקדמות במחזור חיי הגרסה" className="text-xs font-semibold rounded-full py-0.5 px-2 whitespace-nowrap border text-info bg-info-bg border-info/[18.82%]">
              {completionPct}%
            </span>
          )}
        </div>

        {/* Chain stretches across remaining space */}
        <div className="flex-1 flex items-center">
          {STAGES_DISPLAY.map((stage, si) => {
            const mState = mainState(stage.subs, effective, stage.id, activeRunPhase, rehearsalDone, rehearsalSummaryApproved);
            const isClickable = onStageClick && (mState === 'done' || mState === 'active');

            const bubbleBg =
              mState === 'done'   ? C.success :
              mState === 'active' ? stage.main :
              C.bgNested;

            const bubbleBorder =
              mState === 'done'   ? C.success :
              mState === 'active' ? stage.main :
              C.borderEm;

            const labelColor =
              mState === 'active' ? stage.main :
              mState === 'done'   ? C.success :
              C.textDisabled;

            return (
              <React.Fragment key={stage.id}>
                {/* ── Main stage bubble ── */}
                <div
                  onClick={() => isClickable && onStageClick?.(stage.id)}
                  title={stage.label}
                  className={cn('flex flex-col items-center gap-1 shrink-0', isClickable ? 'cursor-pointer' : 'cursor-default')}
                >
                  <div
                    className="w-[42px] h-[42px] rounded-full flex items-center justify-center text-[17px] shrink-0 relative transition-all duration-slow ease-out"
                    style={{
                      background: bubbleBg,
                      border: `2px solid ${bubbleBorder}`,
                      boxShadow: mState === 'active'
                        ? `0 0 0 4px ${stage.glow}, ${SHADOW.xs}`
                        : mState === 'done'
                        ? `0 0 0 2px rgba(55,196,122,0.15)`
                        : 'none',
                    }}
                  >
                    {mState === 'done' && !isRolledBack
                      ? (
                        <svg width="14" height="12" viewBox="0 0 12 10" fill="none">
                          <path d="M1 5L4.5 8.5L11 1.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )
                      : <span className="leading-none">{stage.icon}</span>
                    }

                    {mState === 'active' && (
                      <span
                        className="absolute -inset-1.5 rounded-full opacity-[0.45] pointer-events-none animate-[chain-pulse_2.2s_ease-in-out_infinite]"
                        style={{ border: `1.5px solid ${stage.main}` }}
                      />
                    )}
                  </div>

                  <span
                    className={cn('text-sm whitespace-nowrap transition-all duration-fast ease-out', mState === 'active' ? 'font-semibold' : 'font-normal')}
                    style={{ color: labelColor }}
                  >
                    {isRolledBack && si === 2 ? 'Rollback' : stage.label}
                  </span>
                </div>

                {/* ── Sub-stages + connector row ── */}
                {si < STAGES.length - 1 && (() => {
                  const elements: React.ReactNode[] = [];

                  stage.subs.forEach((sub, subIdx) => {
                    const sState = stage.id === 'run'
                      ? runSubStateByPhase(subIdx, effective, activeRunPhase)
                      : subState(sub.status, effective, rehearsalDone, rehearsalSummaryApproved);

                    const lineColor =
                      sState === 'done'   ? `${C.success}80` :
                      sState === 'active' ? `${stage.main}50` :
                      C.border;

                    const dotColor =
                      sState === 'done'   ? C.success :
                      sState === 'active' ? stage.main :
                      C.borderEm;

                    const dotBg =
                      sState === 'done'   ? C.success :
                      sState === 'active' ? stage.main :
                      C.bgNested;

                    elements.push(
                      <div key={`pre-${subIdx}`}
                        className="flex-1 h-[1.5px] min-w-1.5 transition-all duration-slow ease-out"
                        style={{ background: lineColor }}
                      />
                    );

                    elements.push(
                      <div key={`sub-${subIdx}`}
                        title={sub.label}
                        className="flex flex-col items-center gap-[3px] shrink-0"
                      >
                        <div
                          className="w-5 h-5 rounded-full flex items-center justify-center transition-all duration-slow ease-out"
                          style={{
                            background: dotBg,
                            border: `1.5px solid ${dotColor}`,
                            boxShadow: sState === 'active' ? `0 0 6px ${stage.glow}` : 'none',
                          }}
                        >
                          {sState === 'done' && (
                            <svg width="8" height="7" viewBox="0 0 7 6" fill="none">
                              <path d="M1 3L2.8 4.8L6 1.2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                          {sState === 'active' && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white opacity-95" />
                          )}
                        </div>
                        <span
                          className={cn('text-[13px] whitespace-nowrap transition-all duration-fast ease-out', sState === 'active' ? 'font-semibold' : 'font-normal')}
                          style={{ color: sState === 'active' ? stage.main : sState === 'done' ? `${C.success}CC` : C.textDisabled }}
                        >
                          {sub.label}
                        </span>
                      </div>
                    );
                  });

                  const nextStage  = STAGES_DISPLAY[si + 1];
                  const nextMState = mainState(nextStage.subs, effective, nextStage.id, activeRunPhase, rehearsalDone, rehearsalSummaryApproved);
                  const postLineColor =
                    nextMState === 'done'   ? `${C.success}80` :
                    nextMState === 'active' ? `${nextStage.main}50` :
                    C.border;

                  elements.push(
                    <div key="post"
                      className="flex-1 h-[1.5px] min-w-1.5 transition-all duration-slow ease-out"
                      style={{ background: postLineColor }}
                    />
                  );
                  return elements;
                })()}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <style>{`
        @keyframes chain-pulse {
          0%, 100% { opacity: 0.25; transform: scale(1); }
          50%       { opacity: 0.55; transform: scale(1.18); }
        }
      `}</style>
    </div>
  );
};
