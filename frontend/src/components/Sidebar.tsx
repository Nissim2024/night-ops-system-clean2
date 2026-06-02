import React from 'react';
import { C, FONT } from '../theme';

export interface Stage {
  key: string;
  label: string;
  icon: string;
  description: string;
  step: number;
}

interface Props {
  stages: Stage[];
  activeStage: string;
  onStageChange: (key: string) => void;
}

export const Sidebar: React.FC<Props> = ({ stages, activeStage, onStageChange }) => {
  const activeIndex = stages.findIndex(s => s.key === activeStage);

  return (
    <div style={{
      width: '220px',
      minWidth: '220px',
      background: C.bgCard,
      borderRight: `1px solid ${C.border}`,
      padding: '20px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      fontFamily: FONT,
    }}>
      <div style={{
        fontSize: '11px', color: C.textMuted, fontWeight: '600',
        marginBottom: '12px', textAlign: 'center',
        letterSpacing: '1px', textTransform: 'uppercase',
      }}>
        שלבים בגרסה
      </div>

      {stages.map((stage, idx) => {
        const isActive = stage.key === activeStage;
        const isDone   = idx < activeIndex;

        return (
          <button
            key={stage.key}
            onClick={() => onStageChange(stage.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '11px 14px',
              borderRadius: '10px',
              cursor: 'pointer',
              border: isActive ? `1px solid ${C.brand}` : `1px solid transparent`,
              background: isActive ? C.brandDim : 'transparent',
              textAlign: 'right',
              direction: 'rtl',
              width: '100%',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => {
              if (!isActive) e.currentTarget.style.background = C.bgHover;
            }}
            onMouseLeave={e => {
              if (!isActive) e.currentTarget.style.background = 'transparent';
            }}
          >
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              background: isActive ? 'rgba(255,255,255,0.15)' : isDone ? C.statusDone : C.bgNested,
              color: isActive ? 'white' : isDone ? 'white' : C.textMuted,
              fontWeight: '600',
              fontSize: '12px',
            }}>
              {isDone ? '✓' : stage.step}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{
                fontWeight: '600',
                fontSize: '13px',
                color: isActive ? C.textPrimary : isDone ? C.statusDone : C.textSecondary,
              }}>
                {stage.icon} {stage.label}
              </div>
              <div style={{
                fontSize: '11px',
                color: isActive ? 'rgba(255,255,255,0.5)' : C.textMuted,
                marginTop: '2px',
              }}>
                {stage.description}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};
