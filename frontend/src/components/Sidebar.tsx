import React from 'react';

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
      background: 'white',
      borderRight: '1px solid #e0e0e0',
      padding: '20px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      boxShadow: '-2px 0 8px rgba(0,0,0,0.06)',
    }}>
      <div style={{ fontSize: '12px', color: '#999', fontWeight: 'bold', marginBottom: '10px', textAlign: 'center', letterSpacing: '1px', textTransform: 'uppercase' }}>
        שלבים בגרסה
      </div>

      {stages.map((stage, idx) => {
        const isActive = stage.key === activeStage;
        const isDone = idx < activeIndex;

        return (
          <button
            key={stage.key}
            onClick={() => onStageChange(stage.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 14px',
              borderRadius: '12px',
              cursor: 'pointer',
              border: isActive ? '2px solid #2d4a7a' : '2px solid transparent',
              background: isActive ? '#1a2332' : isDone ? '#f0f7ff' : '#f8f9fa',
              textAlign: 'right',
              direction: 'rtl',
              width: '100%',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => {
              if (!isActive) e.currentTarget.style.background = isDone ? '#e0eefa' : '#f0f0f0';
            }}
            onMouseLeave={e => {
              if (!isActive) e.currentTarget.style.background = isDone ? '#f0f7ff' : '#f8f9fa';
            }}
          >
            <div style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isActive ? 'rgba(255,255,255,0.2)' : isDone ? '#27ae60' : '#e0e0e0',
              color: isActive ? 'white' : isDone ? 'white' : '#666',
              fontWeight: 'bold',
              fontSize: '13px',
              flexShrink: 0,
            }}>
              {isDone ? '✓' : stage.step}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{
                fontWeight: 'bold',
                fontSize: '14px',
                color: isActive ? 'white' : isDone ? '#1a5276' : '#333',
              }}>
                {stage.icon} {stage.label}
              </div>
              <div style={{
                fontSize: '11px',
                color: isActive ? 'rgba(255,255,255,0.65)' : '#999',
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
