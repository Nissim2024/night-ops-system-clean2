import React from 'react';

interface OwlProps {
  size: number;
  body: string;
  eyes: string;
  beak: string;
  iris: string;
  glint: string;
}

const Owl: React.FC<OwlProps> = ({ size, body, eyes, beak, iris, glint }) => (
  <svg width={size} height={size} viewBox="0 0 48 52" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Body */}
    <ellipse cx="24" cy="38" rx="14" ry="12" fill={body} />
    {/* Body feather lines */}
    <path d="M17 32 Q24 35 31 32" stroke="rgba(255,255,255,0.12)" strokeWidth="1" fill="none" />
    <path d="M15 37 Q24 41 33 37" stroke="rgba(255,255,255,0.10)" strokeWidth="1" fill="none" />

    {/* Head */}
    <circle cx="24" cy="18" r="14" fill={body} />

    {/* Ear tufts */}
    <polygon points="12,4 10,14 16,14" fill={body} />
    <polygon points="36,4 38,14 32,14" fill={body} />
    <polygon points="12,4 14,10 10,10" fill="rgba(255,255,255,0.08)" />
    <polygon points="36,4 34,10 38,10" fill="rgba(255,255,255,0.08)" />

    {/* Eye sockets */}
    <circle cx="17" cy="18" r="6.5" fill={eyes} />
    <circle cx="31" cy="18" r="6.5" fill={eyes} />

    {/* Iris */}
    <circle cx="17" cy="18" r="4" fill={iris} />
    <circle cx="31" cy="18" r="4" fill={iris} />

    {/* Pupils */}
    <circle cx="17" cy="18" r="2.2" fill="#0d0d1a" />
    <circle cx="31" cy="18" r="2.2" fill="#0d0d1a" />

    {/* Eye glints */}
    <circle cx="18.2" cy="16.8" r="1" fill={glint} />
    <circle cx="32.2" cy="16.8" r="1" fill={glint} />

    {/* Beak */}
    <polygon points="21,22 27,22 24,26.5" fill={beak} />

    {/* Wing edges */}
    <path d="M11,30 Q8,38 10,46" stroke="rgba(255,255,255,0.10)" strokeWidth="2" fill="none" strokeLinecap="round" />
    <path d="M37,30 Q40,38 38,46" stroke="rgba(255,255,255,0.10)" strokeWidth="2" fill="none" strokeLinecap="round" />

    {/* Talons left */}
    <path d="M17,49 Q15,51 13,52" stroke={body} strokeWidth="1.8" strokeLinecap="round" />
    <path d="M17,49 Q17,51 17,52" stroke={body} strokeWidth="1.8" strokeLinecap="round" />
    <path d="M17,49 Q19,51 21,52" stroke={body} strokeWidth="1.8" strokeLinecap="round" />

    {/* Talons right */}
    <path d="M31,49 Q29,51 27,52" stroke={body} strokeWidth="1.8" strokeLinecap="round" />
    <path d="M31,49 Q31,51 31,52" stroke={body} strokeWidth="1.8" strokeLinecap="round" />
    <path d="M31,49 Q33,51 35,52" stroke={body} strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

interface Props {
  variant?: 'nav' | 'login';
}

export const DeployCenterLogo: React.FC<Props> = ({ variant = 'nav' }) => {
  if (variant === 'login') {
    return (
      <div style={{ textAlign: 'center' }}>
        <Owl
          size={84}
          body="#2d4a7a"
          eyes="rgba(255,255,255,0.92)"
          iris="#3498db"
          beak="#e8a020"
          glint="rgba(255,255,255,0.95)"
        />
        <h1 style={{
          color: '#1a2332', margin: '10px 0 4px', fontSize: '30px', fontWeight: '900',
          fontFamily: "'Arial Black', Arial, sans-serif", letterSpacing: '-1px',
          lineHeight: 1,
        }}>
          Deploy<span style={{ color: '#3498db' }}>Center</span>
        </h1>
        <p style={{ color: '#777', margin: 0, fontSize: '12px', letterSpacing: '0.5px' }}>
          מרכז שליטה ופריסה בזמן אמת
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <Owl
        size={36}
        body="#2d4a7a"
        eyes="rgba(255,255,255,0.95)"
        iris="#3498db"
        beak="#f0a030"
        glint="white"
      />
      <span style={{
        fontSize: '19px', fontWeight: '900',
        fontFamily: "'Arial Black', Arial, sans-serif", letterSpacing: '-0.5px',
      }}>
        <span style={{ color: '#1a2332' }}>Deploy</span><span style={{ color: '#3498db' }}>Center</span>
      </span>
    </div>
  );
};
