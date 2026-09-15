import React, { useState, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { formatDateTime } from '../../utils/dateFormat';

interface Props {
  plannedStart?: string | null;
  status: string;
}

// Live-ticking days/hours/minutes/seconds until go-live — no page refresh
// needed. Shared between the manager's HomeDashboard hero card and the QA
// tester's home view.
//
// Colors here are intentionally raw white/black-alpha values, not theme
// tokens: this badge always renders on top of a colored hero card background
// (independent of the app's light/dark theme), so it can't use
// foreground/border tokens that flip with the theme.
export const GoLiveCountdown: React.FC<Props> = ({ plannedStart, status }) => {
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!plannedStart || ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(status)) return null;

  const goLive = new Date(plannedStart);
  const msLeft = goLive.getTime() - nowTick;
  const dateLabel = formatDateTime(goLive);
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
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <span
        className={cn(
          'rounded-[10px] border px-2.5 py-0.5 text-xs font-bold tabular-nums text-white',
          overdue ? 'border-[rgba(240,106,106,0.4)] bg-[rgba(240,106,106,0.25)]' : 'border-white/[0.22] bg-white/[0.14]'
        )}
      >
        {countdownLabel}
      </span>
      <span className="text-xs text-white/60">
        עלייה לאוויר: {dateLabel}
      </span>
    </div>
  );
};
