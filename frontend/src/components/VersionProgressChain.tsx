import React from 'react';
import { C, FONT, TEXT, WEIGHT, EASE } from '../theme';

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

const STAGES = [
  {
    id: 'prep', label: 'תכנון', icon: '📋',
    color: '#388bfd', glowColor: 'rgba(56,139,253,0.30)',
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
    color: '#f0883e', glowColor: 'rgba(240,136,62,0.30)',
    subs: [
      { label: 'שלב 1', status: 'REHEARSAL', key: 'r1' },
      { label: 'שלב 2', status: 'REHEARSAL', key: 'r2' },
      { label: 'שלב 3', status: 'REHEARSAL', key: 'r3' },
      { label: 'שלב 4', status: 'REHEARSAL', key: 'r4' },
      { label: 'סיכום', status: 'REHEARSAL', key: 'r5' },
    ],
  },
  {
    id: 'run', label: 'הטמעה', icon: '🚀',
    color: '#ff7b72', glowColor: 'rgba(255,123,114,0.30)',
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
    color: '#56d364', glowColor: 'rgba(86,211,100,0.30)',
    subs: [{ label: 'בייצור', status: 'COMPLETED', key: 'completed' }],
  },
];

type NodeState = 'done' | 'active' | 'pending';

function subState(subStatus: string, current: string, rehearsalDone = false): NodeState {
  // החזרה הגנרלית הושלמה — הגרסה חזרה ל-APPROVED, אבל REHEARSAL צריך להיות done
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

export const VersionProgressChain: React.FC<Props> = ({ versionStatus, activeRunPhase = 1, rehearsalDone = false, summaryBeforeMorning = false, onStageClick }) => {
  const effective    = versionStatus === 'ROLLED_BACK' ? 'MORNING_AFTER' : versionStatus;
  const isRolledBack = versionStatus === 'ROLLED_BACK';

  // סדר דינמי: סיכום לפני בוקר כשאושר לפני שמשימות הבוקר הסתיימו
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

  const currentLabel = STAGE_LABEL[versionStatus] ?? versionStatus;

  return (
    <div style={{
      background: `linear-gradient(180deg, ${C.bgElevated} 0%, ${C.bgCard} 100%)`,
      borderBottom: `1px solid ${C.border}`,
      padding: '8px 32px 10px',
      direction: 'rtl',
      boxShadow: '0 2px 8px rgba(0,0,0,0.20)',
      position: 'relative',
    }}>
      {/* Subtle top highlight */}
      <div style={{
        position: 'absolute', top: 0, right: 0, left: 0, height: '1px',
        background: 'linear-gradient(90deg, transparent, rgba(56,139,253,0.20), transparent)',
      }} />

      {/* "נמצאים ב" indicator */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
        <span style={{ fontSize: '11px', color: C.textMuted, fontFamily: FONT }}>
          📍 שלב נוכחי: <strong style={{ color: C.textSecondary }}>{currentLabel}</strong>
          {rehearsalDone && versionStatus === 'APPROVED' && (
            <span style={{ marginRight: '8px', color: '#f0883e', fontSize: '10px' }}>✓ חזרה גנרלית הושלמה</span>
          )}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', position: 'relative', overflow: 'hidden' }}>
        {STAGES_DISPLAY.map((stage, si) => {
          const mState = mainState(stage.subs, effective, stage.id, activeRunPhase, rehearsalDone);
          const isClickable = onStageClick && (mState === 'done' || mState === 'active');

          const nodeBg =
            mState === 'done'   ? C.success :
            mState === 'active' ? stage.color :
            C.bgActive;

          const nodeColor = mState === 'pending' ? C.textDisabled : 'white';

          return (
            <React.Fragment key={stage.id}>
              {/* ── Main stage bubble ── */}
              <div
                onClick={() => isClickable && onStageClick?.(stage.id)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', flexShrink: 0, cursor: isClickable ? 'pointer' : 'default' }}
              >
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: nodeBg,
                  border: mState === 'active'
                    ? `2px solid ${stage.color}`
                    : mState === 'done'
                    ? `2px solid ${C.success}`
                    : `2px solid ${C.borderEm}`,
                  boxShadow: mState === 'active'
                    ? `0 0 0 4px ${stage.glowColor}, 0 0 12px ${stage.glowColor}`
                    : mState === 'done'
                    ? `0 0 0 3px rgba(86,211,100,0.15)`
                    : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '15px', flexShrink: 0, position: 'relative',
                  transition: EASE.slow,
                  color: nodeColor,
                }}>
                  {mState === 'done' && !isRolledBack
                    ? <svg width="14" height="12" viewBox="0 0 14 12" fill="none"><path d="M1 6L5 10L13 2" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    : <span>{stage.icon}</span>
                  }

                  {/* Pulse ring for active */}
                  {mState === 'active' && (
                    <span style={{
                      position: 'absolute', inset: '-6px', borderRadius: '50%',
                      border: `2px solid ${stage.color}`,
                      opacity: 0.5,
                      animation: 'chain-pulse 2s ease-in-out infinite',
                      pointerEvents: 'none',
                    }} />
                  )}
                </div>

                <span style={{
                  ...TEXT.xs, fontWeight: WEIGHT.semibold,
                  fontFamily: FONT, whiteSpace: 'nowrap',
                  color: mState === 'active' ? stage.color
                       : mState === 'done'   ? C.success
                       : C.textDisabled,
                  transition: EASE.fast,
                }}>
                  {isRolledBack && si === 2 ? '🔄 Rollback' : stage.label}
                </span>
              </div>

              {/* ── Sub-stages connector row ── */}
              {si < STAGES.length - 1 && (() => {
                const elements: React.ReactNode[] = [];
                stage.subs.forEach((sub, subIdx) => {
                  const sState = stage.id === 'run'
                    ? runSubStateByPhase(subIdx, effective, activeRunPhase)
                    : subState(sub.status, effective, rehearsalDone);

                  const lineColor =
                    sState === 'done'   ? C.success :
                    sState === 'active' ? `${stage.color}70` :
                    C.bgActive;

                  elements.push(
                    <div key={`pre-${subIdx}`} style={{
                      flex: 1, height: '2px', background: lineColor,
                      minWidth: '8px', transition: EASE.slow,
                    }} />
                  );

                  elements.push(
                    <div key={`sub-${subIdx}`} title={sub.label}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', flexShrink: 0 }}
                    >
                      <div style={{
                        width: '18px', height: '18px', borderRadius: '50%',
                        background: sState === 'done' ? C.success : sState === 'active' ? stage.color : C.bgNested,
                        border: `1.5px solid ${sState === 'done' ? C.success : sState === 'active' ? stage.color : C.borderEm}`,
                        boxShadow: sState === 'active' ? `0 0 6px ${stage.glowColor}` : 'none',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: EASE.slow,
                      }}>
                        {sState === 'done' && (
                          <svg width="8" height="7" viewBox="0 0 8 7" fill="none">
                            <path d="M1 3.5L3 5.5L7 1.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                        {sState === 'active' && (
                          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'white', opacity: 0.9 }} />
                        )}
                      </div>
                      <span style={{
                        fontSize: '8px', fontFamily: FONT, whiteSpace: 'nowrap',
                        color: sState === 'active' ? stage.color : sState === 'done' ? C.success : C.textDisabled,
                        transition: EASE.fast,
                      }}>
                        {sub.label}
                      </span>
                    </div>
                  );
                });

                const nextStage  = STAGES_DISPLAY[si + 1];
                const nextMState = mainState(nextStage.subs, effective, nextStage.id, activeRunPhase, rehearsalDone);
                const postLineColor = nextMState === 'done' ? C.success : nextMState === 'active' ? `${nextStage.color}70` : C.bgActive;
                elements.push(
                  <div key="post" style={{ flex: 1, height: '2px', background: postLineColor, minWidth: '8px', transition: EASE.slow }} />
                );
                return elements;
              })()}
            </React.Fragment>
          );
        })}
      </div>

      <style>{`
        @keyframes chain-pulse {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.15); }
        }
      `}</style>
    </div>
  );
};
