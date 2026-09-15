import React, { useState, useEffect } from 'react';
import { formatDate } from '../../utils/dateFormat';
import { cn } from '../../lib/utils';

interface Cycle {
  cycleType: string;
  plannedStart: string;
  plannedEnd: string;
}

interface Props {
  version: {
    status: string;
    integrationStart?: string | null;
    integrationEnd?: string | null;
    plannedRehearsalStart?: string | null;
    plannedStart?: string | null;
  };
  cycles: Cycle[] | undefined | null;
}

// Evenly-spaced stage cards — one per real stage of the release (integration,
// each testing round, UAT, rehearsal, go-live), each showing its own
// start/end window. Not proportional to real elapsed time: with this many
// stages a real-date-proportional layout either crushes close-together
// rounds into unreadable clusters or wastes most of its width on long quiet
// gaps — an even grid reads as a clear stage-by-stage story instead, at the
// cost of not showing relative duration at a glance. Shared between the
// manager's HomeDashboard hero card and the QA tester's home view so both
// read the same release calendar.
export const VersionMilestoneTimeline: React.FC<Props> = ({ version, cycles }) => {
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  type Stage = { label: string; start: Date; end: Date };
  const stages: Stage[] = [];
  if (version.integrationStart && version.integrationEnd) {
    stages.push({ label: 'אינטגרציה', start: new Date(version.integrationStart), end: new Date(version.integrationEnd) });
  }

  // Per-round testing-cycle dates (incl. Stand Alone) + UAT + rehearsal —
  // sourced from the QA work plan's actual computed cycles, not the
  // version's own (often-empty) planning fields, since the work plan is
  // what actually drives these dates once a plan has been generated.
  const cycleByType = new Map((cycles ?? []).map(c => [c.cycleType, c]));
  const ROUND_LABEL: Record<string, string> = {
    STAND_ALONE: 'Stand Alone', CYCLE_1: 'סבב 1', CYCLE_2: 'סבב 2', CYCLE_3: 'סבב 3',
  };
  for (const ct of ['STAND_ALONE', 'CYCLE_1', 'CYCLE_2']) {
    const c = cycleByType.get(ct);
    if (c) stages.push({ label: ROUND_LABEL[ct], start: new Date(c.plannedStart), end: new Date(c.plannedEnd) });
  }
  const uat = cycleByType.get('UAT');
  if (uat) stages.push({ label: 'UAT', start: new Date(uat.plannedStart), end: new Date(uat.plannedEnd) });
  const cycle3 = cycleByType.get('CYCLE_3');
  if (cycle3) stages.push({ label: ROUND_LABEL.CYCLE_3, start: new Date(cycle3.plannedStart), end: new Date(cycle3.plannedEnd) });

  // Rehearsal: prefer the work plan's actual REHEARSAL cycle (kept in sync
  // by the scheduler) over the version's own plannedRehearsalStart, which
  // is often left unset even once a real rehearsal date exists downstream.
  const rehearsalCycle = cycleByType.get('REHEARSAL');
  if (rehearsalCycle) stages.push({ label: 'חזרה גנרלית', start: new Date(rehearsalCycle.plannedStart), end: new Date(rehearsalCycle.plannedStart) });
  else if (version.plannedRehearsalStart) stages.push({ label: 'חזרה גנרלית', start: new Date(version.plannedRehearsalStart), end: new Date(version.plannedRehearsalStart) });

  // Go-live stays sourced from the version's own plannedStart (the field
  // the rest of the app treats as authoritative), not the work plan's
  // GO_LIVE cycle — that one is just "day after rehearsal" cascaded
  // mechanically by the scheduler and can drift from the real date.
  if (version.plannedStart) stages.push({ label: 'עלייה לאוויר', start: new Date(version.plannedStart), end: new Date(version.plannedStart) });
  if (stages.length === 0) return null;
  // Sort by actual start date, not fixed process order — rehearsal and QA
  // windows can genuinely overlap, and the timeline should read as real
  // chronology, not an idealized stage sequence.
  stages.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Fixed-order categorical palette (dark-mode steps, dataviz skill's
  // validated default) — assigned by stage position, never re-cycled per
  // render, so a given stage keeps a stable identity color.
  const STAGE_COLORS = ['#3987e5', '#199e70', '#d55181', '#c98500', '#9085e9', '#d95926', '#e66767', '#008300'];
  const fmt = (d: Date) => formatDate(d);

  return (
    <div className="relative mt-4 flex gap-0.5">
      {/* One continuous rail behind every dot — simpler and more robust than
          computing a per-column connector, and correct regardless of how
          many stages there are or how wide each column ends up. */}
      <div
        className="absolute top-1.5 h-0.5 bg-white/15"
        style={{ right: `${100 / stages.length / 2}%`, left: `${100 / stages.length / 2}%` }}
      />
      {stages.map((s, i) => {
        const isPast = s.end.getTime() <= nowTick;
        const isNext = !isPast && stages.slice(0, i).every(ss => ss.end.getTime() <= nowTick);
        const color = STAGE_COLORS[i % STAGE_COLORS.length];
        return (
          <div key={i} title={`${s.label} — ${fmt(s.start)} – ${fmt(s.end)}`} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
            <div
              className={cn('h-[13px] w-[13px] shrink-0 rounded-full border-2 z-10', isNext ? 'border-white' : 'border-[#1c1d3d]')}
              style={{
                background: isPast || isNext ? color : `${color}4d`,
                boxShadow: isNext ? `0 0 0 3px ${color}55` : 'none',
              }}
            />
            <div className={cn('mt-2 whitespace-nowrap text-[11px] leading-[15px] text-white/85', isPast ? 'opacity-60' : 'opacity-100')}>
              {fmt(s.end)}
            </div>
            <div className={cn('whitespace-nowrap text-[11px] leading-[15px] text-white/50', isPast ? 'opacity-60' : 'opacity-100')}>
              {fmt(s.start)}
            </div>
            <div className={cn('mt-1.5 text-[12px]', isNext ? 'font-semibold text-white' : 'font-medium text-white/75', isPast ? 'opacity-60' : 'opacity-100')}>
              {s.label}
            </div>
          </div>
        );
      })}
    </div>
  );
};
