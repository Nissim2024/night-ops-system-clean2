import React, { useState, useEffect } from 'react';
import { TEXT, WEIGHT } from '../../theme';

interface Props {
  plannedStart?: string | null;
  status: string;
}

// Live-ticking days/hours/minutes/seconds until go-live — no page refresh
// needed. Shared between the manager's HomeDashboard hero card and the QA
// tester's home view.
export const GoLiveCountdown: React.FC<Props> = ({ plannedStart, status }) => {
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!plannedStart || ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(status)) return null;

  const goLive = new Date(plannedStart);
  const msLeft = goLive.getTime() - nowTick;
  const dateLabel = `${goLive.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' })} · ${goLive.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
  const overdue = msLeft <= 0;
  const totalSeconds = Math.max(0, Math.floor(msLeft / 1000));
  const days    = Math.floor(totalSeconds / 86400);
  const hours   = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const countdownLabel = overdue
    ? '⚠ תאריך היעד חלף'
    : `🚀 ${days > 0 ? `${days} ${days === 1 ? 'יום' : 'ימים'}, ` : ''}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' as const }}>
      <span style={{
        ...TEXT.xs, fontWeight: WEIGHT.bold, color: 'white',
        background: overdue ? 'rgba(240,106,106,.25)' : 'rgba(255,255,255,.14)',
        border: `1px solid ${overdue ? 'rgba(240,106,106,.4)' : 'rgba(255,255,255,.22)'}`,
        borderRadius: '10px', padding: '2px 10px',
        fontVariantNumeric: 'tabular-nums' as const,
      }}>
        {countdownLabel}
      </span>
      <span style={{ ...TEXT.xs, color: 'rgba(255,255,255,.6)' }}>
        עלייה לאוויר: {dateLabel}
      </span>
    </div>
  );
};
