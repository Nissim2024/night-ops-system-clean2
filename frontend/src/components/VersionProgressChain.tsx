import React from 'react';
import { C, FONT, TEXT, WEIGHT, EASE, RADIUS, SHADOW } from '../theme';

interface Props {
  versionStatus: string;
  activeRunPhase?: number;
  rehearsalDone?: boolean;
  summaryBeforeMorning?: boolean;
  onStageClick?: (stageId: string) => void;
}

const STATUS_ORDER = [
  'DRAFT', 'COLLECTING', 'CR_REVIEW', 'REFINING', 'REVIEW', 'APPROVED',
  'REHEARSAL',
  'ACTIVE', 'MORNING_AFTER',
  'COMPLETED',
];

// Colors aligned with theme.ts tokens
const STAGE_COLOR = {
  prep:      { main: C.info,    glow: 'rgba(69,115,210,0.20)'  },
  rehearsal: { main: '#F0883E', glow: 'rgba(240,136,62,0.20)'  },
  run:       { main: C.brand,   glow: 'rgba(240,106,106,0.20)' },
  done:      { main: C.success, glow: 'rgba(55,196,122,0.20)'  },
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

function subState(subStatus: string, current: string, rehearsalDone = false): NodeState {
  if (subStatus === 'REHEARSAL' && rehearsalDone && current === 'APPROVED') return 'done';
  const ci = STATUS_ORDER.indexOf(current);
  const si = STATUS_ORDER.indexOf(subStatus);
  if (ci === -1 || si === -1) return 'pending';
  if (ci > si) return 'done';
  if (ci === si) return 'active';
  return 'pending';
}

function runSubStateByPhase(subIdx: number, current: string, activeRunPhase: number): NodeState {
  if (!['ACTIVE', 'REHEARSAL'].includes(current)) return subState(STAGES[2].subs[subIdx].status, current);
  if (subIdx < 3) {
    const phaseNum = subIdx + 1;
    if (phaseNum < activeRunPhase) return 'done';
    if (phaseNum === activeRunPhase) return 'active';
    return 'pending';
  }
  return 'pending';
}

function mainState(subs: { status: string }[], current: string, stageId: string, activeRunPhase: number, rehearsalDone = false): NodeState {
  const states = subs.map((s, i) =>
    stageId === 'run' ? runSubStateByPhase(i, current, activeRunPhase) : subState(s.status, current, rehearsalDone)
  );
  if (states.every(s => s === 'done')) return 'done';
  if (states.some(s => s === 'done' || s === 'active')) return 'active';
  return 'pending';
}

const STAGE_LABEL: Record<string, string> = {
  DRAFT: 'טיוטה', COLLECTING: 'איסוף משימות', CR_REVIEW: 'סקירת CR',
  REFINING: 'טיוב תוכנית', REVIEW: 'ישיבת מעבר', APPROVED: 'תוכנית מאושרת',
  REHEARSAL: 'חזרה גנרלית', ACTIVE: 'לילה פעיל', MORNING_AFTER: 'בוקר שלאחר',
  COMPLETED: 'הושלם', ROLLED_BACK: 'Rollback',
};

export const VersionProgressChain: React.FC<Props> = ({
  versionStatus, activeRunPhase = 1, rehearsalDone = false,
  summaryBeforeMorning = false, onStageClick,
}) => {
  const effective    = versionStatus === 'ROLLED_BACK' ? 'MORNING_AFTER' : versionStatus;
  const isRolledBack = versionStatus === 'ROLLED_BACK';
  const currentLabel = STAGE_LABEL[versionStatus] ?? versionStatus;

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
    <div style={{
      background: C.bgCard,
      borderBottom: `1px solid ${C.border}`,
      padding: '14px 28px 16px',
      direction: 'rtl',
      boxShadow: SHADOW.xs,
    }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>

        {/* Right side: current stage label (anchored to RTL start = visual right) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, marginLeft: '20px' }}>
          <span style={{
            ...TEXT.xs, fontWeight: WEIGHT.medium, fontFamily: FONT,
            color: C.textMuted, whiteSpace: 'nowrap',
          }}>
            שלב נוכחי:
          </span>
          <span style={{
            ...TEXT.xs, fontWeight: WEIGHT.semibold, fontFamily: FONT,
            color: isRolledBack ? C.danger : C.textSecondary,
            background: isRolledBack ? C.dangerBg : C.bgHover,
            padding: '2px 8px', borderRadius: RADIUS.full,
            border: `1px solid ${isRolledBack ? `${C.danger}30` : C.border}`,
            whiteSpace: 'nowrap',
          }}>
            {isRolledBack ? '🔄 ' : ''}{currentLabel}
          </span>

          {rehearsalDone && versionStatus === 'APPROVED' && (
            <span style={{
              ...TEXT.xs, fontFamily: FONT, color: '#F0883E',
              background: 'rgba(240,136,62,0.10)', padding: '2px 8px',
              borderRadius: RADIUS.full, border: '1px solid rgba(240,136,62,0.25)',
              whiteSpace: 'nowrap',
            }}>
              ✓ חזרה הושלמה
            </span>
          )}
        </div>

        {/* Chain stretches across remaining space */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          {STAGES_DISPLAY.map((stage, si) => {
            const mState = mainState(stage.subs, effective, stage.id, activeRunPhase, rehearsalDone);
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
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    gap: '4px', flexShrink: 0, cursor: isClickable ? 'pointer' : 'default',
                  }}
                >
                  <div style={{
                    width: '42px', height: '42px', borderRadius: '50%',
                    background: bubbleBg,
                    border: `2px solid ${bubbleBorder}`,
                    boxShadow: mState === 'active'
                      ? `0 0 0 4px ${stage.glow}, ${SHADOW.xs}`
                      : mState === 'done'
                      ? `0 0 0 2px rgba(55,196,122,0.15)`
                      : 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '16px', flexShrink: 0, position: 'relative',
                    transition: EASE.slow,
                  }}>
                    {mState === 'done' && !isRolledBack
                      ? (
                        <svg width="14" height="12" viewBox="0 0 12 10" fill="none">
                          <path d="M1 5L4.5 8.5L11 1.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )
                      : <span style={{ lineHeight: 1 }}>{stage.icon}</span>
                    }

                    {mState === 'active' && (
                      <span style={{
                        position: 'absolute', inset: '-6px', borderRadius: '50%',
                        border: `1.5px solid ${stage.main}`,
                        opacity: 0.45,
                        animation: 'chain-pulse 2.2s ease-in-out infinite',
                        pointerEvents: 'none',
                      }} />
                    )}
                  </div>

                  <span style={{
                    fontSize: '12px', fontWeight: mState === 'active' ? WEIGHT.semibold : WEIGHT.normal,
                    fontFamily: FONT, whiteSpace: 'nowrap',
                    color: labelColor,
                    transition: EASE.fast,
                  }}>
                    {isRolledBack && si === 2 ? 'Rollback' : stage.label}
                  </span>
                </div>

                {/* ── Sub-stages + connector row ── */}
                {si < STAGES.length - 1 && (() => {
                  const elements: React.ReactNode[] = [];

                  stage.subs.forEach((sub, subIdx) => {
                    const sState = stage.id === 'run'
                      ? runSubStateByPhase(subIdx, effective, activeRunPhase)
                      : subState(sub.status, effective, rehearsalDone);

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
                      <div key={`pre-${subIdx}`} style={{
                        flex: 1, height: '1.5px', background: lineColor,
                        minWidth: '6px', transition: EASE.slow,
                      }} />
                    );

                    elements.push(
                      <div key={`sub-${subIdx}`}
                        title={sub.label}
                        style={{
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', gap: '3px', flexShrink: 0,
                        }}
                      >
                        <div style={{
                          width: '20px', height: '20px', borderRadius: '50%',
                          background: dotBg,
                          border: `1.5px solid ${dotColor}`,
                          boxShadow: sState === 'active' ? `0 0 6px ${stage.glow}` : 'none',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: EASE.slow,
                        }}>
                          {sState === 'done' && (
                            <svg width="8" height="7" viewBox="0 0 7 6" fill="none">
                              <path d="M1 3L2.8 4.8L6 1.2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                          {sState === 'active' && (
                            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'white', opacity: 0.95 }} />
                          )}
                        </div>
                        <span style={{
                          fontSize: '11px', fontFamily: FONT, whiteSpace: 'nowrap',
                          color: sState === 'active' ? stage.main
                               : sState === 'done'   ? `${C.success}CC`
                               : C.textDisabled,
                          fontWeight: sState === 'active' ? WEIGHT.semibold : WEIGHT.normal,
                          transition: EASE.fast,
                        }}>
                          {sub.label}
                        </span>
                      </div>
                    );
                  });

                  const nextStage  = STAGES_DISPLAY[si + 1];
                  const nextMState = mainState(nextStage.subs, effective, nextStage.id, activeRunPhase, rehearsalDone);
                  const postLineColor =
                    nextMState === 'done'   ? `${C.success}80` :
                    nextMState === 'active' ? `${nextStage.main}50` :
                    C.border;

                  elements.push(
                    <div key="post" style={{
                      flex: 1, height: '1.5px', background: postLineColor,
                      minWidth: '6px', transition: EASE.slow,
                    }} />
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
