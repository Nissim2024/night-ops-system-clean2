import React from 'react';

const TOWER_NAV   = '#5fb3f5';
const WAVE_NAV    = '#90caf9';
const TOWER_LOGIN = '#2d4a7a';
const WAVE_LOGIN  = '#3498db';
const WIN         = 'rgba(255,255,255,0.38)';

const Tower: React.FC<{ size: number; tower: string; wave: string }> = ({ size, tower, wave }) => (
  <svg width={size} height={size} viewBox="0 0 44 58" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Signal arcs — radiate upward from top of cab */}
    <path d="M18,12 A4,4 0 0,1 26,12"    stroke={wave} strokeWidth="2.8" strokeLinecap="round"/>
    <path d="M14,12 A8,8 0 0,1 30,12"    stroke={wave} strokeWidth="2"   strokeLinecap="round"/>
    <path d="M10,12 A12,12 0 0,1 34,12"  stroke={wave} strokeWidth="1.4" strokeLinecap="round"/>
    {/* Observation cab */}
    <rect x="5"  y="12" width="34" height="8"  rx="2" fill={tower}/>
    {/* Cab windows */}
    <rect x="9"  y="14.5" width="5" height="3.5" rx="1" fill={WIN}/>
    <rect x="16" y="14.5" width="5" height="3.5" rx="1" fill={WIN}/>
    <rect x="23" y="14.5" width="5" height="3.5" rx="1" fill={WIN}/>
    <rect x="30" y="14.5" width="5" height="3.5" rx="1" fill={WIN}/>
    {/* Neck */}
    <rect x="19" y="20" width="6"  height="7"  fill={tower}/>
    {/* Main shaft */}
    <rect x="13" y="27" width="18" height="16" rx="1" fill={tower}/>
    {/* Shaft horizontal detail */}
    <rect x="13" y="34" width="18" height="1.5" fill="rgba(255,255,255,0.12)"/>
    {/* Base */}
    <rect x="2"  y="43" width="40" height="9"  rx="2" fill={tower}/>
    {/* Base top highlight */}
    <rect x="2"  y="43" width="40" height="1.5" rx="0" fill="rgba(255,255,255,0.14)"/>
  </svg>
);

interface Props {
  variant?: 'nav' | 'login';
}

export const DeployCenterLogo: React.FC<Props> = ({ variant = 'nav' }) => {
  if (variant === 'login') {
    return (
      <div style={{ textAlign: 'center' }}>
        <Tower size={76} tower={TOWER_LOGIN} wave={WAVE_LOGIN} />
        <h1 style={{
          color: '#1a2332', margin: '10px 0 4px', fontSize: '30px', fontWeight: '900',
          fontFamily: "'Arial Black', Arial, sans-serif", letterSpacing: '-1px',
          lineHeight: 1,
        }}>
          Deploy<span style={{ color: WAVE_LOGIN }}>Center</span>
        </h1>
        <p style={{ color: '#777', margin: 0, fontSize: '12px', letterSpacing: '0.5px' }}>
          מרכז שליטה ופריסה בזמן אמת
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <Tower size={34} tower={TOWER_NAV} wave={WAVE_NAV} />
      <span style={{
        color: 'white', fontSize: '19px', fontWeight: '900',
        fontFamily: "'Arial Black', Arial, sans-serif", letterSpacing: '-0.5px',
      }}>
        Deploy<span style={{ color: WAVE_NAV }}>Center</span>
      </span>
    </div>
  );
};
