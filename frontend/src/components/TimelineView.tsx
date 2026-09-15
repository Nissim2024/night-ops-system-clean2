import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { statusColor } from '../theme';
import { formatTime } from '../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// ── Delay Calculator types ───────────────────────────────────────────
interface CalcTask {
  id: string;
  title: string;
  plannedStart: string;
  plannedEnd: string;
  assignedTeamName?: string;
  phaseName: string;
  subPhaseName: string;
}

interface ImpactRow {
  task: CalcTask;
  shiftMin: number;
  projectedStart: Date;
  projectedEnd: Date;
  isCritical: boolean; // starts within 5 min of the delayed task's end
}

interface Props {
  token: string;
  versionId: string;
  versionName: string;
}

export const TimelineView: React.FC<Props> = ({ token, versionId, versionName }) => {
  const [version,      setVersion]      = useState<any>(null);
  const [loading,      setLoading]      = useState(true);
  const [now,          setNow]          = useState(new Date());
  const [collapsed,    setCollapsed]    = useState<Set<string>>(new Set());

  // ── Delay Calculator state ───────────────────────────────────────────
  const [calcOpen,     setCalcOpen]     = useState(false);
  const [calcTaskId,   setCalcTaskId]   = useState('');
  const [calcDelay,    setCalcDelay]    = useState(30);
  const [impactRows,   setImpactRows]   = useState<ImpactRow[]>([]);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    load();
    const iv = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(iv);
  }, [versionId]); // eslint-disable-line

  const load = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/versions/${versionId}`, { headers });
      setVersion(r.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const toggle = (id: string) =>
    setCollapsed(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const fmt = (d: Date) => formatTime(d);

  // ── Collect all timed tasks ──────────────────────────────────────────
  const allTasks: any[] = (version?.phases ?? []).flatMap((p: any) =>
    (p.subPhases ?? []).flatMap((sp: any) =>
      (sp.tasks ?? []).filter((t: any) => t.plannedStart && t.plannedEnd)
    )
  );

  // ── Time range ───────────────────────────────────────────────────────
  const ts   = (s: string) => new Date(s).getTime();
  const PAD  = 30 * 60_000;
  const allStarts = allTasks.map(t => ts(t.plannedStart));
  const allEnds   = [
    ...allTasks.map(t => ts(t.plannedEnd)),
    ...allTasks.filter(t => t.completedAt).map(t => ts(t.completedAt)),
  ];
  const minTs = allStarts.length ? Math.min(...allStarts) - PAD : now.getTime() - 3_600_000;
  const maxTs = allEnds.length   ? Math.max(...allEnds)   + PAD : now.getTime() + 3_600_000;
  const span  = maxTs - minTs;

  // NOTE: pct() drives every bar/tick position on the Gantt below via inline
  // `left`/`width` styles computed from real dates — this is the read-only
  // Gantt pixel-math flagged as migration-risk. Left completely untouched;
  // only static decorative styling around it was converted to Tailwind.
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - minTs) / span) * 100));
  const nowPct     = pct(now.getTime());
  const nowVisible = nowPct >= 0 && nowPct <= 100;

  // ── Hour ticks ───────────────────────────────────────────────────────
  const ticks: Date[] = [];
  {
    const c = new Date(minTs);
    c.setMinutes(0, 0, 0);
    c.setHours(c.getHours() + 1);
    while (c.getTime() <= maxTs) { ticks.push(new Date(c)); c.setHours(c.getHours() + 1); }
  }

  // ── Delay helper ─────────────────────────────────────────────────────
  const delay = (task: any): number | null => {
    const end = ts(task.plannedEnd);
    if (task.completedAt) return Math.round((ts(task.completedAt) - end) / 60_000);
    if (task.status !== 'DONE' && now.getTime() > end)
      return Math.round((now.getTime() - end) / 60_000);
    return null;
  };

  const fmtMin = (m: number) => {
    const a = Math.abs(m);
    return a >= 60 ? `${Math.floor(a/60)}ש'${a%60 ? ` ${a%60}ד'` : ''}` : `${a} ד'`;
  };

  // ── Stats ────────────────────────────────────────────────────────────
  const statDone    = allTasks.filter(t => t.status === 'DONE').length;
  const statLate    = allTasks.filter(t => { const d = delay(t); return d !== null && d > 0; }).length;
  const statBlocked = allTasks.filter(t => t.status === 'BLOCKED' || t.status === 'FAILED').length;

  // ── Calculator: flat list of tasks with context ──────────────────────
  const calcTasks = useMemo<CalcTask[]>(() =>
    (version?.phases ?? []).flatMap((p: any) =>
      (p.subPhases ?? []).flatMap((sp: any) =>
        (sp.tasks ?? [])
          .filter((t: any) => t.plannedStart && t.plannedEnd)
          .map((t: any) => ({
            id:              t.id,
            title:           t.title,
            plannedStart:    t.plannedStart,
            plannedEnd:      t.plannedEnd,
            assignedTeamName: t.assignedTeam?.name,
            phaseName:       p.name,
            subPhaseName:    sp.name,
          }))
      )
    ),
  [version]);

  // ── Calculator: run impact simulation ───────────────────────────────
  const runCalc = () => {
    const src = calcTasks.find(t => t.id === calcTaskId);
    if (!src) return;

    const delayMs      = calcDelay * 60_000;
    const origEnd      = new Date(src.plannedEnd).getTime();
    const newSrcEnd    = origEnd + delayMs;

    // tasks that start at or after original end of the delayed task
    const downstream = calcTasks
      .filter(t => t.id !== src.id && new Date(t.plannedStart).getTime() >= origEnd)
      .sort((a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime());

    // cascade: each task shifts by the delay (they were waiting for this slot)
    const rows: ImpactRow[] = downstream.map(t => {
      const ps        = new Date(t.plannedStart).getTime();
      const pe        = new Date(t.plannedEnd).getTime();
      const duration  = pe - ps;
      const gap       = ps - origEnd;            // how long after our task they were supposed to start
      const newStart  = newSrcEnd + gap;         // preserve the gap
      return {
        task:           t,
        shiftMin:       calcDelay,
        projectedStart: new Date(newStart),
        projectedEnd:   new Date(newStart + duration),
        isCritical:     gap <= 5 * 60_000,       // starts within 5 min of our task ending
      };
    });

    setImpactRows(rows);
  };

  // ── Heights ──────────────────────────────────────────────────────────
  const H_PHASE    = 36;
  const H_SUBPHASE = 30;
  const H_TASK     = 46;
  const LABEL_W    = 340;

  // ── Reusable grid + now-line ─────────────────────────────────────────
  // Tick/now-line positions (`left: ${pct}%`) are computed from real dates —
  // untouched. Only the static line colors became Tailwind-token backgrounds.
  const grid = (h: number) => (
    <>
      {ticks.map((tick, i) => (
        <div key={i} className="absolute top-0 w-px bg-border" style={{ left: `${pct(tick.getTime())}%`, height: h }} />
      ))}
      {nowVisible && (
        <div className="absolute top-0 z-[4] w-0.5 bg-danger/45" style={{ left: `${nowPct}%`, height: h }} />
      )}
    </>
  );

  // ── Sticky label cell ─────────────────────────────────────────────────
  const labelCell = (children: React.ReactNode, bg: string, h: number, indent = 0, extra?: React.CSSProperties) => (
    <div
      className="sticky end-0 z-10 box-border flex items-center border-e-2 border-border"
      style={{ width: LABEL_W, minWidth: LABEL_W, height: h, background: bg, padding: `0 10px 0 ${10 + indent}px`, ...extra }}
    >
      {children}
    </div>
  );

  if (loading) return (
    <div className="p-20 text-center text-muted-foreground">טוען ציר זמן...</div>
  );

  if (allTasks.length === 0) return (
    <div className="rounded-xl bg-card p-20 text-center shadow-xs">
      <div className="text-6xl">⏱️</div>
      <h3 className="mt-3 text-foreground">אין משימות עם תזמון</h3>
      <p className="text-subtle-foreground">הוסף שעות התחלה וסיום למשימות בשלב ההכנה</p>
    </div>
  );

  return (
    <div dir="rtl" className="font-sans">

      {/* ── Stats header ─────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gradient-to-br from-neutral-900 to-primary-700 p-4 text-white">
        <div>
          <div className="text-lg font-bold">⏱ ציר זמן — {version?.name || versionName}</div>
          <div className="mt-1 text-[15px] opacity-70">
            {fmt(new Date(minTs))} — {fmt(new Date(maxTs))}
            <span className="mx-2.5 opacity-40">|</span>
            עכשיו: <strong className="text-danger">{fmt(now)}</strong>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {[
            { v: allTasks.length, l: 'מתוזמנות', c: 'text-primary-300' },
            { v: statDone,        l: 'הושלמו',   c: 'text-success' },
            { v: statLate,        l: 'מאחרות',   c: 'text-danger' },
            { v: statBlocked,     l: 'חסומות',   c: 'text-warning' },
          ].map(s => (
            <div key={s.l} className="rounded-md bg-white/10 px-3.5 py-2 text-center">
              <div className={`text-xl font-bold ${s.c}`}>{s.v}</div>
              <div className="text-[13px] opacity-75">{s.l}</div>
            </div>
          ))}
          <button onClick={load} className="rounded-md border border-white/30 bg-white/15 px-3.5 py-2 text-white transition-colors duration-fast ease-out hover:bg-white/25">
            ↻ רענן
          </button>
          <button
            onClick={() => { setCalcOpen(o => !o); setImpactRows([]); }}
            className={`rounded-md border border-warning px-3.5 py-2 font-bold text-white transition-colors duration-fast ease-out ${calcOpen ? 'bg-warning' : 'bg-warning/25 hover:bg-warning/40'}`}
          >
            ⏳ מחשבון עיכוב
          </button>
        </div>
      </div>

      {/* ── Delay Calculator panel ───────────────────────────────────── */}
      {calcOpen && (
        <div className="mb-4 rounded-xl border-2 border-warning bg-card p-5 shadow-sm">
          <div className="mb-3.5 text-[17px] font-bold text-warning">
            ⏳ מחשבון השפעת עיכוב — סימולציה
          </div>

          {/* Inputs */}
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="flex-[1_1_280px]">
              <label className="mb-1 block text-sm text-muted-foreground">
                משימה מעוכבת
              </label>
              <select
                value={calcTaskId}
                onChange={e => { setCalcTaskId(e.target.value); setImpactRows([]); }}
                className="w-full rounded-md border border-input bg-muted px-2.5 py-2 text-[15px] text-foreground"
              >
                <option value=''>— בחר משימה —</option>
                {calcTasks.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.phaseName} › {t.subPhaseName} › {t.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-[0_0_160px]">
              <label className="mb-1 block text-sm text-muted-foreground">
                עיכוב (דקות)
              </label>
              <input
                type='number'
                min={1}
                max={480}
                value={calcDelay}
                onChange={e => { setCalcDelay(Number(e.target.value)); setImpactRows([]); }}
                className="box-border w-full rounded-md border border-input px-2.5 py-2 text-[15px] text-foreground"
              />
            </div>

            <button
              onClick={runCalc}
              disabled={!calcTaskId}
              className={`rounded-md px-5 py-2.5 text-[15px] font-bold text-white transition-colors duration-fast ease-out ${calcTaskId ? 'cursor-pointer bg-warning hover:brightness-95' : 'cursor-default bg-neutral-300'}`}
            >
              חשב השפעה
            </button>
          </div>

          {/* Results */}
          {impactRows.length > 0 && (() => {
            const critical   = impactRows.filter(r => r.isCritical);
            const lastEnd    = impactRows.reduce((mx, r) => r.projectedEnd > mx ? r.projectedEnd : mx, new Date(0));
            const srcTask    = calcTasks.find(t => t.id === calcTaskId);
            const origLastEnd = calcTasks
              .filter(t => impactRows.some(r => r.task.id === t.id))
              .reduce((mx, t) => new Date(t.plannedEnd) > mx ? new Date(t.plannedEnd) : mx, new Date(0));
            const totalSlip  = Math.round((lastEnd.getTime() - origLastEnd.getTime()) / 60_000);

            return (
              <div>
                {/* Summary bar */}
                <div className="mb-3.5 flex flex-wrap gap-2.5">
                  {[
                    { label: 'משימות מושפעות', value: impactRows.length, color: 'text-warning' },
                    { label: 'קריטיות (ישירות)', value: critical.length,  color: 'text-danger' },
                    { label: 'החלקת סיום',       value: `${totalSlip > 0 ? '+' : ''}${fmtMin(totalSlip)}`, color: totalSlip > 0 ? 'text-danger' : 'text-success' },
                    { label: 'צפי סיום חדש',     value: fmt(lastEnd),     color: 'text-foreground' },
                  ].map(s => (
                    <div key={s.label} className="min-w-[110px] rounded-md border border-border bg-muted px-3.5 py-2 text-center">
                      <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                      <div className="mt-0.5 text-[13px] text-subtle-foreground">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Selected task info */}
                {srcTask && (
                  <div className="mb-2.5 rounded-md border border-warning bg-warning-bg px-3.5 py-2 text-[15px] text-warning">
                    <strong>{srcTask.title}</strong> — מתוכנן לסיים ב-{fmt(new Date(srcTask.plannedEnd))},
                    יסיים ב-<strong>{fmt(new Date(new Date(srcTask.plannedEnd).getTime() + calcDelay * 60_000))}</strong> (עיכוב {calcDelay} ד')
                  </div>
                )}

                {/* Impact table */}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[15px]">
                    <thead>
                      <tr className="bg-muted text-end">
                        {['משימה', 'שלב', 'תחילה מתוכנן', 'סיום מתוכנן', 'תחילה חדשה', 'סיום חדש', 'הזזה'].map(h => (
                          <th key={h} className="whitespace-nowrap border-b-2 border-border px-3 py-2.5 text-[15px] font-bold text-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {impactRows.map((row, i) => (
                        <tr key={row.task.id} className={`border-s-[3px] ${row.isCritical ? 'border-s-danger bg-danger-bg' : `border-s-transparent ${i % 2 === 0 ? 'bg-card' : 'bg-muted'}`}`}>
                          <td className="max-w-[280px] overflow-hidden text-ellipsis whitespace-nowrap border-b border-border px-3 py-2.5">
                            {row.isCritical && <span className="me-1 text-sm text-danger">●</span>}
                            <span className="font-medium text-foreground">{row.task.title}</span>
                            {row.task.assignedTeamName && (
                              <span className="ms-1.5 text-sm text-muted-foreground"> ({row.task.assignedTeamName})</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap border-b border-border px-3 py-2.5 text-muted-foreground">
                            {row.task.phaseName}
                          </td>
                          <td className="whitespace-nowrap border-b border-border px-3 py-2.5 text-muted-foreground">
                            {fmt(new Date(row.task.plannedStart))}
                          </td>
                          <td className="whitespace-nowrap border-b border-border px-3 py-2.5 text-muted-foreground">
                            {fmt(new Date(row.task.plannedEnd))}
                          </td>
                          <td className="whitespace-nowrap border-b border-border px-3 py-2.5 font-bold text-warning">
                            {fmt(row.projectedStart)}
                          </td>
                          <td className="whitespace-nowrap border-b border-border px-3 py-2.5 font-bold text-danger">
                            {fmt(row.projectedEnd)}
                          </td>
                          <td className="whitespace-nowrap border-b border-border px-3 py-2.5 font-bold text-danger">
                            +{fmtMin(row.shiftMin)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  ● = משימה קריטית (מתחילה עד 5 דקות אחרי סיום המשימה המעוכבת) | הסימולציה מניחה שמשך המשימות נשמר
                </div>
              </div>
            );
          })()}

          {calcTaskId && impactRows.length === 0 && (
            <div className="text-[15px] italic text-subtle-foreground">
              לחץ "חשב השפעה" לראות אילו משימות יושפעו
            </div>
          )}
        </div>
      )}

      {/* ── Gantt ────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl bg-card shadow-xs">
        <div style={{ minWidth: '800px' }}>

          {/* ── Time axis (sticky top) ─── */}
          <div className="sticky top-0 z-20 flex h-12 border-b-2 border-border bg-card">
            {labelCell(
              <span className="text-[15px] font-bold text-foreground">משימה / זמן</span>,
              'var(--tw-color-muted, hsl(var(--muted)))', 48
            )}
            <div className="relative flex-1">
              {/* Tick x-positions (`left: ${pct}%`) come from real dates — untouched. */}
              {ticks.map((tick, i) => {
                const x = pct(tick.getTime());
                return (
                  <div key={i} className="absolute top-0 h-full" style={{ left: `${x}%` }}>
                    <div className="h-full w-px bg-border" />
                    <span className="absolute bottom-1 end-1 whitespace-nowrap text-[13px] text-muted-foreground">
                      {fmt(tick)}
                    </span>
                  </div>
                );
              })}
              {nowVisible && (
                <div className="absolute top-0 z-[6] h-full w-0.5 bg-danger" style={{ left: `${nowPct}%` }}>
                  <span className="absolute top-1 end-1 whitespace-nowrap text-xs font-bold text-danger">
                    עכשיו
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ── Phases ─── */}
          {(version?.phases ?? []).map((phase: any) => (
            <React.Fragment key={phase.id}>

              {/* Phase row */}
              <div className="flex cursor-pointer" style={{ height: H_PHASE }} onClick={() => toggle(phase.id)}>
                {labelCell(
                  <>
                    <span className="me-1 text-xs text-white/50">
                      {collapsed.has(phase.id) ? '►' : '▼'}
                    </span>
                    <span className="me-1.5 whitespace-nowrap text-sm font-bold text-primary-300">
                      {phase.environment}
                    </span>
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm text-white/90">
                      {phase.name}
                    </span>
                  </>,
                  'hsl(var(--foreground))', H_PHASE
                )}
                <div className="relative flex-1 border-b border-primary-700/20 bg-foreground/[0.06]">
                  {grid(H_PHASE)}
                </div>
              </div>

              {/* Sub-phases */}
              {!collapsed.has(phase.id) && (phase.subPhases ?? []).map((sp: any) => {
                const spTasks = (sp.tasks ?? []).filter((t: any) => t.plannedStart && t.plannedEnd);
                return (
                  <React.Fragment key={sp.id}>

                    {/* Sub-phase row */}
                    <div className="flex cursor-pointer" style={{ height: H_SUBPHASE }} onClick={() => toggle(sp.id)}>
                      {labelCell(
                        <>
                          <span className="me-1 text-xs text-muted-foreground">
                            {collapsed.has(sp.id) ? '►' : '▼'}
                          </span>
                          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-bold text-foreground">
                            {sp.name}
                          </span>
                          <span className="ms-auto me-1 whitespace-nowrap text-[13px] text-muted-foreground">
                            ({spTasks.length})
                          </span>
                        </>,
                        'hsl(var(--muted))', H_SUBPHASE, 18,
                        { borderBottom: '1px solid hsl(var(--border))' }
                      )}
                      <div className="relative flex-1 border-b border-border bg-primary-50">
                        {grid(H_SUBPHASE)}
                      </div>
                    </div>

                    {/* Task rows */}
                    {!collapsed.has(sp.id) && spTasks.map((task: any) => {
                      const ps  = pct(ts(task.plannedStart));
                      const pe  = pct(ts(task.plannedEnd));
                      const pw  = pe - ps;

                      const as_ = task.startedAt    ? pct(ts(task.startedAt))    : null;
                      const ae_ = task.completedAt  ? pct(ts(task.completedAt))
                                : task.status === 'IN_PROGRESS' ? nowPct : null;
                      const aw  = as_ !== null && ae_ !== null ? Math.max(0, ae_ - as_) : null;

                      const d  = delay(task);
                      const sc = statusColor(task.status);

                      return (
                        <div key={task.id} className="flex" style={{ height: H_TASK }}>

                          {/* Label */}
                          {labelCell(
                            <>
                              <div className="flex-1 overflow-hidden">
                                <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-medium text-foreground" title={task.title}>
                                  {task.title}
                                </div>
                                <div className="mt-0.5 text-[13px] text-muted-foreground">
                                  {task.assignedTeam?.name && `👥 ${task.assignedTeam.name}`}
                                  {task.assignedUserName && ` · ${task.assignedUserName}`}
                                </div>
                              </div>
                              {d !== null && (
                                <span className={`ms-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-bold ${d > 0 ? 'bg-danger-bg text-danger' : 'bg-success-bg text-success'}`}>
                                  {d > 0 ? `+${fmtMin(d)}` : `-${fmtMin(d)}`}
                                </span>
                              )}
                            </>,
                            'hsl(var(--card))', H_TASK, 32,
                            { borderBottom: '1px solid hsl(var(--border))' }
                          )}

                          {/* Chart cell — bar positions (`left`/`width` from pct()) and
                              `sc` (statusColor(), a runtime hex) are business-driven and
                              stay as inline style; only static box shape became classes. */}
                          <div className="relative flex-1 border-b border-border">
                            {grid(H_TASK)}

                            {/* Planned bar — outline */}
                            {pw > 0 && (
                              <div
                                title={`מתוכנן: ${fmt(new Date(task.plannedStart))} — ${fmt(new Date(task.plannedEnd))}`}
                                className="absolute z-[2] box-border rounded"
                                style={{
                                  left: `${ps}%`, width: `${pw}%`,
                                  top: 13, height: 20,
                                  border: `2px solid ${sc}`,
                                  background: `${sc}20`,
                                }}
                              />
                            )}

                            {/* Actual bar — filled */}
                            {aw !== null && aw > 0 && as_ !== null && (
                              <div
                                title={`בפועל: ${fmt(new Date(task.startedAt))}${task.completedAt ? ` — ${fmt(new Date(task.completedAt))}` : ' (בביצוע)'}`}
                                className="absolute z-[3] rounded-sm opacity-90"
                                style={{ left: `${as_}%`, width: `${aw}%`, top: 19, height: 8, background: statusColor(task.status) }}
                              />
                            )}

                            {/* Overrun marker: red shading past planned end */}
                            {d !== null && d > 0 && task.completedAt && (
                              <div
                                className="absolute z-[1] border-s-2 border-danger bg-danger/15"
                                style={{ left: `${pe}%`, width: `${Math.max(0, pct(ts(task.completedAt)) - pe)}%`, top: 13, height: 20 }}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          ))}

          {/* ── Legend ─── */}
          <div className="flex flex-wrap items-center gap-5 border-t-2 border-border bg-muted px-4 py-3">
            <span className="text-sm font-bold text-muted-foreground">מקרא:</span>
            {([
              { label: 'מתוכנן',  el: <div className="h-3.5 w-9 rounded border-2 border-primary bg-primary/10" /> },
              { label: 'הושלם',   el: <div className="h-2 w-9 rounded bg-success" /> },
              { label: 'בביצוע',  el: <div className="h-2 w-9 rounded bg-warning" /> },
              { label: 'חסום',    el: <div className="h-2 w-9 rounded bg-danger" /> },
              { label: 'חריגה',   el: <div className="h-3.5 w-5 rounded-s border-s-2 border-danger bg-danger/20" /> },
              { label: 'עכשיו',   el: <div className="h-5 w-0.5 bg-danger" /> },
            ] as const).map(({ label, el }) => (
              <div key={label} className="flex items-center gap-1.5">
                {el}
                <span className="text-sm text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
};
