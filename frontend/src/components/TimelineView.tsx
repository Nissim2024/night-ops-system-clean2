import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const STATUS_COLOR: Record<string, string> = {
  OPEN: '#3498db', IN_PROGRESS: '#f39c12', BLOCKED: '#e74c3c',
  WAITING: '#9b59b6', DONE: '#27ae60', FAILED: '#c0392b', ROLLED_BACK: '#7f8c8d',
};

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

  const fmt = (d: Date) =>
    `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

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
  const LABEL_W    = 230;

  // ── Reusable grid + now-line ─────────────────────────────────────────
  const grid = (h: number) => (
    <>
      {ticks.map((tick, i) => (
        <div key={i} style={{ position: 'absolute', left: `${pct(tick.getTime())}%`, top: 0, width: 1, height: h, background: '#f0f0f0' }} />
      ))}
      {nowVisible && (
        <div style={{ position: 'absolute', left: `${nowPct}%`, top: 0, width: 2, height: h, background: 'rgba(231,76,60,0.45)', zIndex: 4 }} />
      )}
    </>
  );

  // ── Sticky label cell ─────────────────────────────────────────────────
  const labelCell = (children: React.ReactNode, bg: string, h: number, indent = 0, extra?: React.CSSProperties) => (
    <div style={{
      width: LABEL_W, minWidth: LABEL_W, height: h,
      position: 'sticky', left: 0, zIndex: 10,
      background: bg, borderLeft: '2px solid #e0e0e0',
      display: 'flex', alignItems: 'center',
      padding: `0 10px 0 ${10 + indent}px`,
      boxSizing: 'border-box', ...extra,
    }}>
      {children}
    </div>
  );

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '80px', color: '#666' }}>טוען ציר זמן...</div>
  );

  if (allTasks.length === 0) return (
    <div style={{ textAlign: 'center', padding: '80px', background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
      <div style={{ fontSize: '64px' }}>⏱️</div>
      <h3 style={{ color: '#1a2332', marginTop: '12px' }}>אין משימות עם תזמון</h3>
      <p style={{ color: '#888' }}>הוסף שעות התחלה וסיום למשימות בשלב ההכנה</p>
    </div>
  );

  return (
    <div style={{ direction: 'rtl', fontFamily: 'Arial' }}>

      {/* ── Stats header ─────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #1a2332, #2d4a7a)',
        borderRadius: '12px', padding: '16px 20px', marginBottom: '16px',
        color: 'white', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', flexWrap: 'wrap', gap: '12px',
      }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 'bold' }}>⏱ ציר זמן — {version?.name || versionName}</div>
          <div style={{ fontSize: '13px', opacity: 0.7, marginTop: '4px' }}>
            {fmt(new Date(minTs))} — {fmt(new Date(maxTs))}
            <span style={{ margin: '0 10px', opacity: 0.4 }}>|</span>
            עכשיו: <strong style={{ color: '#e74c3c' }}>{fmt(now)}</strong>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {[
            { v: allTasks.length, l: 'מתוזמנות', c: '#3498db' },
            { v: statDone,        l: 'הושלמו',   c: '#27ae60' },
            { v: statLate,        l: 'מאחרות',   c: '#e74c3c' },
            { v: statBlocked,     l: 'חסומות',   c: '#e67e22' },
          ].map(s => (
            <div key={s.l} style={{ background: 'rgba(255,255,255,0.12)', borderRadius: '8px', padding: '8px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: s.c }}>{s.v}</div>
              <div style={{ fontSize: '11px', opacity: 0.75 }}>{s.l}</div>
            </div>
          ))}
          <button onClick={load} style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: 'white', borderRadius: '8px', cursor: 'pointer' }}>
            ↻ רענן
          </button>
          <button
            onClick={() => { setCalcOpen(o => !o); setImpactRows([]); }}
            style={{
              padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold',
              background: calcOpen ? '#f39c12' : 'rgba(243,156,18,0.25)',
              border: '1px solid #f39c12', color: 'white',
            }}
          >
            ⏳ מחשבון עיכוב
          </button>
        </div>
      </div>

      {/* ── Delay Calculator panel ───────────────────────────────────── */}
      {calcOpen && (
        <div style={{
          background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          padding: '20px', marginBottom: '16px', border: '2px solid #f39c12',
        }}>
          <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#7d5500', marginBottom: '14px' }}>
            ⏳ מחשבון השפעת עיכוב — סימולציה
          </div>

          {/* Inputs */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '16px' }}>
            <div style={{ flex: '1 1 280px' }}>
              <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
                משימה מעוכבת
              </label>
              <select
                value={calcTaskId}
                onChange={e => { setCalcTaskId(e.target.value); setImpactRows([]); }}
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: '8px',
                  border: '1px solid #ddd', fontSize: '13px', background: '#f8f9fa',
                }}
              >
                <option value=''>— בחר משימה —</option>
                {calcTasks.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.phaseName} › {t.subPhaseName} › {t.title}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ flex: '0 0 160px' }}>
              <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
                עיכוב (דקות)
              </label>
              <input
                type='number'
                min={1}
                max={480}
                value={calcDelay}
                onChange={e => { setCalcDelay(Number(e.target.value)); setImpactRows([]); }}
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: '8px',
                  border: '1px solid #ddd', fontSize: '13px', boxSizing: 'border-box',
                }}
              />
            </div>

            <button
              onClick={runCalc}
              disabled={!calcTaskId}
              style={{
                padding: '9px 20px', background: calcTaskId ? '#e67e22' : '#ccc',
                color: 'white', border: 'none', borderRadius: '8px',
                cursor: calcTaskId ? 'pointer' : 'default', fontWeight: 'bold', fontSize: '14px',
              }}
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
                <div style={{
                  display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px',
                }}>
                  {[
                    { label: 'משימות מושפעות', value: impactRows.length, color: '#e67e22' },
                    { label: 'קריטיות (ישירות)', value: critical.length,  color: '#e74c3c' },
                    { label: 'החלקת סיום',       value: `${totalSlip > 0 ? '+' : ''}${fmtMin(totalSlip)}`, color: totalSlip > 0 ? '#e74c3c' : '#27ae60' },
                    { label: 'צפי סיום חדש',     value: fmt(lastEnd),     color: '#1a2332' },
                  ].map(s => (
                    <div key={s.label} style={{
                      background: '#f8f9fa', border: '1px solid #e0e0e0',
                      borderRadius: '8px', padding: '8px 14px', textAlign: 'center', minWidth: '110px',
                    }}>
                      <div style={{ fontSize: '18px', fontWeight: 'bold', color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Selected task info */}
                {srcTask && (
                  <div style={{
                    background: '#fff8e1', border: '1px solid #f39c12', borderRadius: '8px',
                    padding: '8px 14px', marginBottom: '10px', fontSize: '13px', color: '#7d5500',
                  }}>
                    <strong>{srcTask.title}</strong> — מתוכנן לסיים ב-{fmt(new Date(srcTask.plannedEnd))},
                    יסיים ב-<strong>{fmt(new Date(new Date(srcTask.plannedEnd).getTime() + calcDelay * 60_000))}</strong> (עיכוב {calcDelay} ד')
                  </div>
                )}

                {/* Impact table */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f4f6f8', textAlign: 'right' }}>
                        {['משימה', 'שלב', 'תחילה מתוכנן', 'סיום מתוכנן', 'תחילה חדשה', 'סיום חדש', 'הזזה'].map(h => (
                          <th key={h} style={{ padding: '8px 10px', borderBottom: '2px solid #e0e0e0', fontWeight: 'bold', color: '#555', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {impactRows.map((row, i) => (
                        <tr key={row.task.id} style={{
                          background: row.isCritical ? '#fff5f5' : (i % 2 === 0 ? 'white' : '#fafafa'),
                          borderRight: row.isCritical ? '3px solid #e74c3c' : '3px solid transparent',
                        }}>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #eee', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.isCritical && <span style={{ color: '#e74c3c', marginLeft: '4px', fontSize: '11px' }}>●</span>}
                            {row.task.title}
                            {row.task.assignedTeamName && (
                              <span style={{ color: '#aaa', fontSize: '11px', marginRight: '6px' }}>({row.task.assignedTeamName})</span>
                            )}
                          </td>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #eee', color: '#666', whiteSpace: 'nowrap' }}>
                            {row.task.phaseName}
                          </td>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #eee', color: '#888', whiteSpace: 'nowrap' }}>
                            {fmt(new Date(row.task.plannedStart))}
                          </td>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #eee', color: '#888', whiteSpace: 'nowrap' }}>
                            {fmt(new Date(row.task.plannedEnd))}
                          </td>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #eee', fontWeight: 'bold', color: '#e67e22', whiteSpace: 'nowrap' }}>
                            {fmt(row.projectedStart)}
                          </td>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #eee', fontWeight: 'bold', color: '#e74c3c', whiteSpace: 'nowrap' }}>
                            {fmt(row.projectedEnd)}
                          </td>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #eee', color: '#e74c3c', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                            +{fmtMin(row.shiftMin)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: '11px', color: '#aaa', marginTop: '8px' }}>
                  ● = משימה קריטית (מתחילה עד 5 דקות אחרי סיום המשימה המעוכבת) | הסימולציה מניחה שמשך המשימות נשמר
                </div>
              </div>
            );
          })()}

          {calcTaskId && impactRows.length === 0 && (
            <div style={{ color: '#888', fontSize: '13px', fontStyle: 'italic' }}>
              לחץ "חשב השפעה" לראות אילו משימות יושפעו
            </div>
          )}
        </div>
      )}

      {/* ── Gantt ────────────────────────────────────────────────────── */}
      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', overflowX: 'auto' }}>
        <div style={{ minWidth: '800px' }}>

          {/* ── Time axis (sticky top) ─── */}
          <div style={{ display: 'flex', height: 48, borderBottom: '2px solid #ddd', position: 'sticky', top: 0, zIndex: 20, background: 'white' }}>
            {labelCell(
              <span style={{ fontSize: '12px', color: '#999', fontWeight: 'bold' }}>משימה / זמן</span>,
              '#f8f9fa', 48
            )}
            <div style={{ flex: 1, position: 'relative' }}>
              {ticks.map((tick, i) => {
                const x = pct(tick.getTime());
                return (
                  <div key={i} style={{ position: 'absolute', left: `${x}%`, top: 0, height: '100%' }}>
                    <div style={{ width: 1, height: '100%', background: '#e0e0e0' }} />
                    <span style={{ position: 'absolute', bottom: 5, left: 4, fontSize: '11px', color: '#555', whiteSpace: 'nowrap' }}>
                      {fmt(tick)}
                    </span>
                  </div>
                );
              })}
              {nowVisible && (
                <div style={{ position: 'absolute', left: `${nowPct}%`, top: 0, height: '100%', width: 2, background: '#e74c3c', zIndex: 6 }}>
                  <span style={{ position: 'absolute', top: 4, left: 4, fontSize: '10px', color: '#e74c3c', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
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
              <div style={{ display: 'flex', height: H_PHASE, cursor: 'pointer' }} onClick={() => toggle(phase.id)}>
                {labelCell(
                  <>
                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginLeft: '4px' }}>
                      {collapsed.has(phase.id) ? '►' : '▼'}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#7ecfff', marginLeft: '6px', whiteSpace: 'nowrap' }}>
                      {phase.environment}
                    </span>
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.65)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {phase.name}
                    </span>
                  </>,
                  '#1a2332', H_PHASE
                )}
                <div style={{ flex: 1, position: 'relative', background: 'rgba(26,35,50,0.06)', borderBottom: '1px solid #2d4a7a33' }}>
                  {grid(H_PHASE)}
                </div>
              </div>

              {/* Sub-phases */}
              {!collapsed.has(phase.id) && (phase.subPhases ?? []).map((sp: any) => {
                const spTasks = (sp.tasks ?? []).filter((t: any) => t.plannedStart && t.plannedEnd);
                return (
                  <React.Fragment key={sp.id}>

                    {/* Sub-phase row */}
                    <div style={{ display: 'flex', height: H_SUBPHASE, cursor: 'pointer' }} onClick={() => toggle(sp.id)}>
                      {labelCell(
                        <>
                          <span style={{ fontSize: '9px', color: '#aaa', marginLeft: '4px' }}>
                            {collapsed.has(sp.id) ? '►' : '▼'}
                          </span>
                          <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {sp.name}
                          </span>
                          <span style={{ fontSize: '10px', color: '#aaa', marginRight: 'auto', marginLeft: '4px', whiteSpace: 'nowrap' }}>
                            ({spTasks.length})
                          </span>
                        </>,
                        '#f4f7fa', H_SUBPHASE, 18,
                        { borderBottom: '1px solid #e0e8f0' }
                      )}
                      <div style={{ flex: 1, position: 'relative', background: 'rgba(52,152,219,0.04)', borderBottom: '1px solid #e0e8f0' }}>
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
                      const sc = STATUS_COLOR[task.status] || '#3498db';

                      return (
                        <div key={task.id} style={{ display: 'flex', height: H_TASK }}>

                          {/* Label */}
                          {labelCell(
                            <>
                              <div style={{ flex: 1, overflow: 'hidden' }}>
                                <div style={{ fontSize: '12px', color: '#1a2332', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={task.title}>
                                  {task.title}
                                </div>
                                <div style={{ fontSize: '10px', color: '#aaa', marginTop: '2px' }}>
                                  {task.assignedTeam?.name && `👥 ${task.assignedTeam.name}`}
                                  {task.assignedUserName && ` · ${task.assignedUserName}`}
                                </div>
                              </div>
                              {d !== null && (
                                <span style={{
                                  fontSize: '10px', fontWeight: 'bold', padding: '1px 5px', borderRadius: '4px',
                                  whiteSpace: 'nowrap', marginRight: '4px',
                                  background: d > 0 ? '#fee' : '#f0fff4',
                                  color:      d > 0 ? '#e74c3c' : '#27ae60',
                                }}>
                                  {d > 0 ? `+${fmtMin(d)}` : `-${fmtMin(d)}`}
                                </span>
                              )}
                            </>,
                            'white', H_TASK, 32,
                            { borderBottom: '1px solid #f5f5f5' }
                          )}

                          {/* Chart cell */}
                          <div style={{ flex: 1, position: 'relative', borderBottom: '1px solid #f5f5f5' }}>
                            {grid(H_TASK)}

                            {/* Planned bar — outline */}
                            {pw > 0 && (
                              <div
                                title={`מתוכנן: ${fmt(new Date(task.plannedStart))} — ${fmt(new Date(task.plannedEnd))}`}
                                style={{
                                  position: 'absolute', left: `${ps}%`, width: `${pw}%`,
                                  top: 13, height: 20,
                                  border: `2px solid ${sc}`, borderRadius: 4,
                                  background: `${sc}20`, boxSizing: 'border-box', zIndex: 2,
                                }}
                              />
                            )}

                            {/* Actual bar — filled */}
                            {aw !== null && aw > 0 && as_ !== null && (
                              <div
                                title={`בפועל: ${fmt(new Date(task.startedAt))}${task.completedAt ? ` — ${fmt(new Date(task.completedAt))}` : ' (בביצוע)'}`}
                                style={{
                                  position: 'absolute', left: `${as_}%`, width: `${aw}%`,
                                  top: 19, height: 8,
                                  background: task.status === 'DONE'    ? '#27ae60'
                                            : task.status === 'BLOCKED' ? '#e74c3c'
                                            : '#f39c12',
                                  borderRadius: 3, zIndex: 3, opacity: 0.88,
                                }}
                              />
                            )}

                            {/* Overrun marker: red shading past planned end */}
                            {d !== null && d > 0 && task.completedAt && (
                              <div style={{
                                position: 'absolute', left: `${pe}%`,
                                width: `${Math.max(0, pct(ts(task.completedAt)) - pe)}%`,
                                top: 13, height: 20,
                                background: 'rgba(231,76,60,0.15)',
                                borderRight: '2px solid #e74c3c',
                                zIndex: 1,
                              }} />
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
          <div style={{ display: 'flex', gap: '20px', padding: '12px 16px', borderTop: '2px solid #e0e0e0', background: '#fafafa', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: '#666', fontWeight: 'bold' }}>מקרא:</span>
            {([
              { label: 'מתוכנן',  el: <div style={{ width: 36, height: 14, border: '2px solid #3498db', borderRadius: 3, background: '#3498db18' }} /> },
              { label: 'הושלם',   el: <div style={{ width: 36, height:  8, background: '#27ae60', borderRadius: 3 }} /> },
              { label: 'בביצוע',  el: <div style={{ width: 36, height:  8, background: '#f39c12', borderRadius: 3 }} /> },
              { label: 'חסום',    el: <div style={{ width: 36, height:  8, background: '#e74c3c', borderRadius: 3 }} /> },
              { label: 'חריגה',   el: <div style={{ width: 20, height: 14, background: 'rgba(231,76,60,0.2)', borderRight: '2px solid #e74c3c', borderRadius: '0 3px 3px 0' }} /> },
              { label: 'עכשיו',   el: <div style={{ width:  2, height: 20, background: '#e74c3c' }} /> },
            ] as const).map(({ label, el }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {el}
                <span style={{ fontSize: '12px', color: '#555' }}>{label}</span>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
};
