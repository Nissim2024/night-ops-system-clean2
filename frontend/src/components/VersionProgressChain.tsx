import React from 'react';

interface Props {
  versionStatus: string;
  activeRunPhase?: number; // 1-4: which phase is currently active within ACTIVE/REHEARSAL
}

const STATUS_ORDER = [
  'DRAFT', 'COLLECTING', 'REFINING', 'REVIEW', 'APPROVED',
  'REHEARSAL',
  'ACTIVE', 'MORNING_AFTER',
  'COMPLETED',
];

const STAGES = [
  {
    id: 'prep',
    label: 'הכנת התוכנית',
    icon: '📋',
    color: '#2d4a7a',
    subs: [
      { label: 'טיוטא',              status: 'DRAFT'      },
      { label: 'מעבר על התוכנית',   status: 'COLLECTING'  },
      { label: 'בחינת תוכנית',      status: 'REFINING'    },
      { label: 'סקירת תוכנית',      status: 'REVIEW'      },
      { label: 'אישור תוכנית',      status: 'APPROVED'    },
    ],
  },
  {
    id: 'rehearsal',
    label: 'חזרה גנרלית',
    icon: '🎭',
    color: '#e67e22',
    subs: [
      { label: 'שלב 1 — בוקר גרסה',   status: 'REHEARSAL' },
      { label: 'שלב 2 — לילה HOTNET',  status: 'REHEARSAL' },
      { label: 'שלב 3 — לילה HOT',     status: 'REHEARSAL' },
      { label: 'שלב 4 — בוקר לאחר',   status: 'REHEARSAL' },
      { label: 'אישור סיכום פעילות',   status: 'REHEARSAL' },
    ],
  },
  {
    id: 'run',
    label: 'הרצה בפועל',
    icon: '🚀',
    color: '#c0392b',
    subs: [
      { label: 'שלב 1 — בוקר גרסה',      status: 'ACTIVE'        },
      { label: 'שלב 2 — לילה HOTNET',     status: 'ACTIVE'        },
      { label: 'שלב 3 — לילה HOT',        status: 'ACTIVE'        },
      { label: 'שלב 4 — בוקר לאחר גרסה', status: 'MORNING_AFTER' },
      { label: 'אישור סיכום פעילות',      status: 'MORNING_AFTER' },
    ],
  },
  {
    id: 'done',
    label: 'גרסה הוטמעה',
    icon: '🎉',
    color: '#27ae60',
    subs: [
      { label: 'הוטמעה בהצלחה', status: 'COMPLETED' },
    ],
  },
];

type NodeState = 'done' | 'active' | 'pending';

function subState(subStatus: string, current: string): NodeState {
  const ci = STATUS_ORDER.indexOf(current);
  const si = STATUS_ORDER.indexOf(subStatus);
  if (ci === -1 || si === -1) return 'pending';
  if (ci > si) return 'done';
  if (ci === si) return 'active';
  return 'pending';
}

// For the 'run' stage subs 0-2 (phases 1-3, all mapped to 'ACTIVE' status),
// use activeRunPhase to distinguish done vs active vs pending within the same status.
function runSubStateByPhase(subIdx: number, current: string, activeRunPhase: number): NodeState {
  if (!['ACTIVE', 'REHEARSAL'].includes(current)) return subState(STAGES[2].subs[subIdx].status, current);
  if (subIdx < 3) {
    const phaseNum = subIdx + 1; // 1-based
    if (phaseNum < activeRunPhase) return 'done';
    if (phaseNum === activeRunPhase) return 'active';
    return 'pending';
  }
  // subs 3-4 (MORNING_AFTER): pending while still ACTIVE/REHEARSAL
  return 'pending';
}

function mainState(subs: { status: string }[], current: string, stageId: string, activeRunPhase: number): NodeState {
  const states = subs.map((s, i) =>
    stageId === 'run' ? runSubStateByPhase(i, current, activeRunPhase) : subState(s.status, current)
  );
  if (states.every(s => s === 'done')) return 'done';
  if (states.some(s => s === 'done' || s === 'active')) return 'active';
  return 'pending';
}

const DONE_COLOR  = '#27ae60';
const ACTIVE_RING = '0 0 0 3px rgba(255,255,255,0.9), 0 0 0 5px';
const GRAY        = '#c8d0d8';

function circleStyle(state: NodeState, color: string, size: number): React.CSSProperties {
  const bg =
    state === 'done'   ? DONE_COLOR :
    state === 'active' ? color :
    '#e8ecf0';
  const border =
    state === 'done'   ? `2px solid ${DONE_COLOR}` :
    state === 'active' ? `2px solid ${color}` :
    '2px solid #c0c8d0';
  const shadow =
    state === 'active' ? `${ACTIVE_RING} ${color}66` : 'none';
  return {
    width: size, height: size, borderRadius: '50%',
    background: bg, border, boxShadow: shadow,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, position: 'relative',
    transition: 'all 0.3s ease',
  };
}

function lineStyle(state: NodeState, color: string): React.CSSProperties {
  const bg =
    state === 'done'   ? DONE_COLOR :
    state === 'active' ? `${color}80` :
    GRAY;
  return {
    flex: 1, height: 3, background: bg,
    transition: 'background 0.3s ease',
    minWidth: 12,
  };
}

export const VersionProgressChain: React.FC<Props> = ({ versionStatus, activeRunPhase = 1 }) => {
  const effective = versionStatus === 'ROLLED_BACK' ? 'MORNING_AFTER' : versionStatus;
  const isRolledBack = versionStatus === 'ROLLED_BACK';

  return (
    <div style={{
      background: 'white',
      borderBottom: '1px solid #e0e4e8',
      padding: '10px 32px 6px',
      direction: 'rtl',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
        {STAGES.map((stage, si) => {
          const mState = mainState(stage.subs, effective, stage.id, activeRunPhase);
          return (
            <React.Fragment key={stage.id}>
              {/* ── Main stage node ── */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                <div style={circleStyle(mState, stage.color, 38)}>
                  {mState === 'done' && !isRolledBack
                    ? <span style={{ fontSize: 16 }}>✓</span>
                    : <span style={{ fontSize: 15 }}>{stage.icon}</span>
                  }
                  {/* Pulse ring for active main stage */}
                  {mState === 'active' && (
                    <span style={{
                      position: 'absolute', inset: -5, borderRadius: '50%',
                      border: `2px solid ${stage.color}`,
                      opacity: 0.4, animation: 'pulse 1.8s infinite',
                      pointerEvents: 'none',
                    }} />
                  )}
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 'bold', whiteSpace: 'nowrap',
                  color: mState === 'active' ? stage.color : mState === 'done' ? DONE_COLOR : '#9aaabb',
                  letterSpacing: '0.2px',
                }}>
                  {isRolledBack && si === 2 ? '🔄 Rollback' : stage.label}
                </span>
              </div>

              {/* ── Sub-stages + connector to next main stage ── */}
              {si < STAGES.length - 1 && (() => {
                const elements: React.ReactNode[] = [];
                stage.subs.forEach((sub, subIdx) => {
                  const sState = stage.id === 'run'
                    ? runSubStateByPhase(subIdx, effective, activeRunPhase)
                    : subState(sub.status, effective);
                  // connector before sub
                  elements.push(
                    <div key={`line-pre-${subIdx}`} style={lineStyle(sState, stage.color)} />
                  );
                  // sub circle
                  elements.push(
                    <div key={`sub-${subIdx}`} title={sub.label}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                      <div style={circleStyle(sState, stage.color, 22)}>
                        {sState === 'done' && (
                          <span style={{ fontSize: 10, color: 'white' }}>✓</span>
                        )}
                        {sState === 'active' && (
                          <span style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: 'white', opacity: 0.9,
                            animation: 'pulse 1.4s infinite',
                          }} />
                        )}
                      </div>
                      <span style={{
                        fontSize: 9, whiteSpace: 'nowrap', maxWidth: 64,
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        color: sState === 'active' ? stage.color : sState === 'done' ? DONE_COLOR : '#b0bec5',
                      }}>
                        {sub.label}
                      </span>
                    </div>
                  );
                });
                // connector after last sub (before next main stage)
                const nextStage = STAGES[si + 1];
                const nextMState = mainState(nextStage.subs, effective, nextStage.id, activeRunPhase);
                elements.push(
                  <div key="line-post" style={lineStyle(nextMState, nextStage.color)} />
                );
                return elements;
              })()}
            </React.Fragment>
          );
        })}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.12); }
        }
      `}</style>
    </div>
  );
};
