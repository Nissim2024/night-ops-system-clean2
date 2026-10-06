import React, { useEffect, useRef, useState } from 'react';
import { C } from '../../theme';
import { Group } from './analytics';

// Charts for the defects investigation dashboard (2026-10-06) — plain SVG/HTML,
// no chart library. Palette = the dataviz skill's validated reference
// categorical order (fixed order, never cycled; 9th+ folds into "אחר"), and an
// ordinal severity scale validated with its validator (all checks pass).
export const CAT_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export const OTHER_COLOR = '#9497AC';
export const SEVERITY_CHART_COLOR: Record<string, string> = {
  'Show Stopper': '#a51d24', Severe: '#eb6834', Medium: '#4a3aa7', Low: '#2a78d6',
};
const SINGLE = C.brand;

// Color follows the entity, never its rank: callers pass a stable label→color map.
export function colorMap(labels: string[], fixed?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  let k = 0;
  for (const l of labels) {
    if (fixed?.[l]) { out[l] = fixed[l]; continue; }
    if (l.startsWith('אחר')) { out[l] = OTHER_COLOR; continue; }
    out[l] = k < CAT_PALETTE.length ? CAT_PALETTE[k++] : OTHER_COLOR;
  }
  return out;
}


// Draw at the container's real pixel width — a fixed viewBox scaled to the
// card made text tiny in narrow cards and huge in wide ones.
function useWidth(ref: React.RefObject<HTMLDivElement | null>, fallback = 600): number {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(Math.max(260, Math.floor(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

// ── Tooltip ────────────────────────────────────────────────────────────────
// exported for other dashboards (bug dashboard, 2026-10-06)
export function useChartTooltip() { return useTip(); }
function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: React.ReactNode } | null>(null);
  const show = (e: React.MouseEvent, text: React.ReactNode) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text });
  };
  const hide = () => setTip(null);
  const node = tip ? (
    <div className="pointer-events-none absolute z-20 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: tip.x, top: tip.y - 10, transform: 'translate(-50%, -100%)', background: C.sidebarBg, color: C.sidebarText }}>
      {tip.text}
    </div>
  ) : null;
  return { ref, show, hide, node };
}

const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : '');

// ── Horizontal bars (categorical) ──────────────────────────────────────────
export const HBarChart: React.FC<{ groups: Group[]; total: number; onPick: (g: Group) => void; color?: string; maxHeight?: number }> = ({ groups, total, onPick, color, maxHeight = 340 }) => {
  const t = useTip();
  const max = Math.max(1, ...groups.map(g => g.idx.length));
  if (!groups.length) return <Empty />;
  return (
    <div ref={t.ref} className="relative">
      <div className="flex flex-col gap-1.5 overflow-y-auto pl-1" style={{ maxHeight, scrollbarGutter: 'stable' }}>
        {groups.map(g => (
          <button key={g.label} onClick={() => onPick(g)}
            onMouseMove={e => t.show(e, <><b>{g.label}</b> · {g.idx.length.toLocaleString()} ({pct(g.idx.length, total)})</>)} onMouseLeave={t.hide}
            className="group flex w-full cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-right">
            <span className="w-[150px] flex-shrink-0 truncate text-left text-xs text-muted-foreground" title={g.label}>{g.label}</span>
            <span className="flex h-4 min-w-0 flex-1 items-center">
              <span className="h-full rounded-e-[4px] transition-opacity group-hover:opacity-80"
                style={{ width: `${Math.max(1.5, (g.idx.length / max) * 100)}%`, background: color ?? SINGLE }} />
            </span>
            <span className="w-14 flex-shrink-0 text-left text-xs tabular-nums text-foreground">{g.idx.length.toLocaleString()}</span>
          </button>
        ))}
      </div>
      {t.node}
    </div>
  );
};

// ── Vertical bars (time / ordinal) ─────────────────────────────────────────
export const VBarChart: React.FC<{ groups: Group[]; onPick: (g: Group) => void; color?: string; height?: number; labelFmt?: (l: string) => string }> = ({ groups, onPick, color, height = 220, labelFmt }) => {
  const t = useTip();
  const cw = useWidth(t.ref);
  if (!groups.length) return <Empty />;
  const W = cw, H = height, pad = { l: 40, r: 8, t: 14, b: 28 };
  const max = Math.max(1, ...groups.map(g => g.idx.length));
  const bw = (W - pad.l - pad.r) / groups.length;
  const ticks = niceTicks(max);
  const y = (v: number) => H - pad.b - ((H - pad.t - pad.b) * v) / ticks[ticks.length - 1];
  return (
    <div ref={t.ref} className="relative overflow-x-auto">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ direction: 'ltr', display: 'block' }}>
        <Grid ticks={ticks} y={y} x1={pad.l} x2={W - pad.r} />
        {groups.map((g, i) => {
          const x = pad.l + i * bw;
          const top = y(g.idx.length);
          return (
            <g key={g.label} onClick={() => onPick(g)} style={{ cursor: 'pointer' }}
              onMouseMove={e => t.show(e, <><b>{labelFmt ? labelFmt(g.label) : g.label}</b> · {g.idx.length.toLocaleString()}</>)} onMouseLeave={t.hide}>
              <rect x={x} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              <path d={roundTop(x + bw * 0.18, top, bw * 0.64, H - pad.b - top, 4)} fill={color ?? SINGLE} />
              {i % labelStep(bw) === 0 && <text x={x + bw / 2} y={H - 8} fontSize="12" fill={C.textMuted} textAnchor="middle">{labelFmt ? labelFmt(g.label) : g.label}</text>}
            </g>
          );
        })}
      </svg>
      {t.node}
    </div>
  );
};

// ── Line (time dims) ───────────────────────────────────────────────────────
export const LineChart: React.FC<{ groups: Group[]; onPick: (g: Group) => void; color?: string; height?: number; labelFmt?: (l: string) => string }> = ({ groups, onPick, color, height = 220, labelFmt }) => {
  const t = useTip();
  const cw = useWidth(t.ref);
  if (!groups.length) return <Empty />;
  const W = cw, H = height, pad = { l: 40, r: 14, t: 14, b: 28 };
  const max = Math.max(1, ...groups.map(g => g.idx.length));
  const ticks = niceTicks(max);
  const step = groups.length > 1 ? (W - pad.l - pad.r) / (groups.length - 1) : 0;
  const x = (i: number) => pad.l + (groups.length > 1 ? i * step : (W - pad.l - pad.r) / 2);
  const y = (v: number) => H - pad.b - ((H - pad.t - pad.b) * v) / ticks[ticks.length - 1];
  const pts = groups.map((g, i) => `${x(i)},${y(g.idx.length)}`).join(' ');
  return (
    <div ref={t.ref} className="relative overflow-x-auto">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ direction: 'ltr', display: 'block' }}>
        <Grid ticks={ticks} y={y} x1={pad.l} x2={W - pad.r} />
        <polyline points={pts} fill="none" stroke={color ?? SINGLE} strokeWidth={2} strokeLinejoin="round" />
        {groups.map((g, i) => (
          <g key={g.label} onClick={() => onPick(g)} style={{ cursor: 'pointer' }}
            onMouseMove={e => t.show(e, <><b>{labelFmt ? labelFmt(g.label) : g.label}</b> · {g.idx.length.toLocaleString()}</>)} onMouseLeave={t.hide}>
            <circle cx={x(i)} cy={y(g.idx.length)} r={12} fill="transparent" />
            <circle cx={x(i)} cy={y(g.idx.length)} r={4} fill={color ?? SINGLE} stroke={C.bgCard} strokeWidth={2} />
            {i % labelStep(step || W) === 0 && <text x={x(i)} y={H - 8} fontSize="12" fill={C.textMuted} textAnchor="middle">{labelFmt ? labelFmt(g.label) : g.label}</text>}
          </g>
        ))}
      </svg>
      {t.node}
    </div>
  );
};

// ── Donut ──────────────────────────────────────────────────────────────────
export const PieChart: React.FC<{ groups: Group[]; total: number; colors: Record<string, string>; onPick: (g: Group) => void }> = ({ groups, total, colors, onPick }) => {
  const t = useTip();
  if (!groups.length || !total) return <Empty />;
  const R = 80, r = 48, cx = 90, cy = 90;
  let a0 = -Math.PI / 2;
  const sum = groups.reduce((s, g) => s + g.idx.length, 0);
  return (
    <div ref={t.ref} className="relative flex flex-wrap items-center justify-center gap-5">
      <svg width={180} height={180} viewBox="0 0 180 180">
        {groups.map(g => {
          const frac = g.idx.length / sum;
          const a1 = a0 + frac * Math.PI * 2;
          const path = arcPath(cx, cy, R, r, a0, a1);
          a0 = a1;
          return (
            <path key={g.label} d={path} fill={colors[g.label] ?? OTHER_COLOR} stroke={C.bgCard} strokeWidth={2}
              style={{ cursor: 'pointer' }} onClick={() => onPick(g)}
              onMouseMove={e => t.show(e, <><b>{g.label}</b> · {g.idx.length.toLocaleString()} ({pct(g.idx.length, sum)})</>)} onMouseLeave={t.hide} />
          );
        })}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="18" fontWeight="700" fill={C.textPrimary}>{total.toLocaleString()}</text>
        <text x={cx} y={cy + 15} textAnchor="middle" fontSize="10" fill={C.textMuted}>תקלות</text>
      </svg>
      <Legend items={groups.map(g => ({ label: g.label, color: colors[g.label] ?? OTHER_COLOR, value: `${g.idx.length.toLocaleString()} · ${pct(g.idx.length, sum)}`, onClick: () => onPick(g) }))} vertical />
      {t.node}
    </div>
  );
};

// ── Stacked horizontal bars (group × split) ────────────────────────────────
export interface StackRow { label: string; idx: number[]; parts: { label: string; idx: number[] }[] }
export const StackedBarChart: React.FC<{ rows: StackRow[]; colors: Record<string, string>; splitLabels: string[]; onPick: (title: string, idx: number[]) => void; maxHeight?: number }> = ({ rows, colors, splitLabels, onPick, maxHeight = 340 }) => {
  const t = useTip();
  if (!rows.length) return <Empty />;
  const max = Math.max(1, ...rows.map(r => r.idx.length));
  return (
    <div ref={t.ref} className="relative">
      <Legend items={splitLabels.map(l => ({ label: l, color: colors[l] ?? OTHER_COLOR }))} />
      <div className="mt-2 flex flex-col gap-1.5 overflow-y-auto pl-1" style={{ maxHeight, scrollbarGutter: 'stable' }}>
        {rows.map(row => (
          <div key={row.label} className="flex items-center gap-2">
            <button onClick={() => onPick(row.label, row.idx)} className="w-[150px] flex-shrink-0 cursor-pointer truncate border-none bg-transparent p-0 text-left text-xs text-muted-foreground" title={row.label}>{row.label}</button>
            <div className="flex h-4 min-w-0 flex-1 gap-[2px]">
              <div className="flex h-full gap-[2px]" style={{ width: `${Math.max(1.5, (row.idx.length / max) * 100)}%` }}>
                {row.parts.map((p, k) => (
                  <div key={p.label} onClick={() => onPick(`${row.label} · ${p.label}`, p.idx)}
                    onMouseMove={e => t.show(e, <><b>{row.label}</b> · {p.label}: {p.idx.length.toLocaleString()}</>)} onMouseLeave={t.hide}
                    className={`h-full cursor-pointer hover:opacity-80 ${k === row.parts.length - 1 ? 'rounded-e-[4px]' : ''}`}
                    style={{ flexGrow: p.idx.length, flexBasis: 0, background: colors[p.label] ?? OTHER_COLOR }} />
                ))}
              </div>
            </div>
            <span className="w-14 flex-shrink-0 text-left text-xs tabular-nums text-foreground">{row.idx.length.toLocaleString()}</span>
          </div>
        ))}
      </div>
      {t.node}
    </div>
  );
};

// ── Trend: opened vs closed (grouped bars) — backlog gets its own chart
// (different magnitude; never a second y-axis). ───────────────────────────
export interface TrendPoint { label: string; opened: number[]; closed: number[]; openAtEnd: number }
export const TrendBars: React.FC<{ points: TrendPoint[]; onPick: (title: string, idx: number[]) => void; height?: number }> = ({ points, onPick, height = 220 }) => {
  const t = useTip();
  const cw = useWidth(t.ref);
  if (!points.length) return <Empty />;
  const W = cw, H = height, pad = { l: 40, r: 8, t: 14, b: 28 };
  const max = Math.max(1, ...points.map(p => Math.max(p.opened.length, p.closed.length)));
  const ticks = niceTicks(max);
  const bw = (W - pad.l - pad.r) / points.length;
  const y = (v: number) => H - pad.b - ((H - pad.t - pad.b) * v) / ticks[ticks.length - 1];
  const OPEN_C = CAT_PALETTE[1], CLOSE_C = CAT_PALETTE[0];
  return (
    <div ref={t.ref} className="relative overflow-x-auto">
      <Legend items={[{ label: 'נפתחו', color: OPEN_C }, { label: 'נסגרו', color: CLOSE_C }]} />
      <div>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ direction: 'ltr', display: 'block' }}>
          <Grid ticks={ticks} y={y} x1={pad.l} x2={W - pad.r} />
          {points.map((p, i) => {
            const x = pad.l + i * bw;
            const w = bw * 0.32;
            const oTop = y(p.opened.length), cTop = y(p.closed.length);
            return (
              <g key={p.label}>
                <path d={roundTop(x + bw * 0.16, oTop, w, H - pad.b - oTop, 3)} fill={OPEN_C} style={{ cursor: 'pointer' }}
                  onClick={() => onPick(`נפתחו · ${p.label}`, p.opened)}
                  onMouseMove={e => t.show(e, <><b>{p.label}</b> · נפתחו {p.opened.length.toLocaleString()}</>)} onMouseLeave={t.hide} />
                <path d={roundTop(x + bw * 0.16 + w + 2, cTop, w, H - pad.b - cTop, 3)} fill={CLOSE_C} style={{ cursor: 'pointer' }}
                  onClick={() => onPick(`נסגרו · ${p.label}`, p.closed)}
                  onMouseMove={e => t.show(e, <><b>{p.label}</b> · נסגרו {p.closed.length.toLocaleString()}</>)} onMouseLeave={t.hide} />
                {i % labelStep(bw) === 0 && <text x={x + bw / 2} y={H - 8} fontSize="12" fill={C.textMuted} textAnchor="middle">{p.label}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      {t.node}
    </div>
  );
};

export const BacklogLine: React.FC<{ points: TrendPoint[]; onPick: (p: TrendPoint) => void; height?: number }> = ({ points, onPick, height = 150 }) => {
  const t = useTip();
  const cw = useWidth(t.ref);
  if (!points.length) return <Empty />;
  const W = cw, H = height, pad = { l: 40, r: 14, t: 14, b: 24 };
  const max = Math.max(1, ...points.map(p => p.openAtEnd));
  const ticks = niceTicks(max);
  const bw = (W - pad.l - pad.r) / points.length;
  const x = (i: number) => pad.l + i * bw + bw / 2;
  const y = (v: number) => H - pad.b - ((H - pad.t - pad.b) * v) / ticks[ticks.length - 1];
  const color = CAT_PALETTE[6];
  return (
    <div ref={t.ref} className="relative overflow-x-auto">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ direction: 'ltr', display: 'block' }}>
        <Grid ticks={ticks} y={y} x1={pad.l} x2={W - pad.r} />
        <polyline points={points.map((p, i) => `${x(i)},${y(p.openAtEnd)}`).join(' ')} fill="none" stroke={color} strokeWidth={2} />
        {points.map((p, i) => (
          <g key={p.label} style={{ cursor: 'pointer' }} onClick={() => onPick(p)}
            onMouseMove={e => t.show(e, <><b>{p.label}</b> · פתוחות בסוף התקופה {p.openAtEnd.toLocaleString()}</>)} onMouseLeave={t.hide}>
            <circle cx={x(i)} cy={y(p.openAtEnd)} r={12} fill="transparent" />
            <circle cx={x(i)} cy={y(p.openAtEnd)} r={4} fill={color} stroke={C.bgCard} strokeWidth={2} />
            {i % labelStep(bw) === 0 && <text x={x(i)} y={H - 6} fontSize="12" fill={C.textMuted} textAnchor="middle">{p.label}</text>}
          </g>
        ))}
      </svg>
      {t.node}
    </div>
  );
};

// ── Heat map (rows × columns, single-hue sequential red) ───────────────────
export const HeatMap: React.FC<{ rows: string[]; cols: string[]; cell: (r: string, c: string) => number[]; onPick: (title: string, idx: number[]) => void; colColors?: Record<string, string> }> = ({ rows, cols, cell, onPick, colColors }) => {
  const values = rows.map(r => cols.map(c => cell(r, c)));
  const max = Math.max(1, ...values.flat().map(v => v.length));
  // light → dark red; text flips to white on the dark half
  const shade = (n: number) => {
    if (!n) return { bg: C.bgNested, fg: C.textDisabled };
    const k = n / max;
    const l = 96 - k * 58;          // lightness 96% → 38%
    return { bg: `hsl(2, ${55 + k * 25}%, ${l}%)`, fg: k > 0.5 ? '#fff' : C.textPrimary };
  };
  if (!rows.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-separate" style={{ borderSpacing: 2, minWidth: 140 + cols.length * 80 + 70 }}>
        <colgroup>
          <col style={{ width: 170 }} />
          {cols.map(c => <col key={c} />)}
          <col style={{ width: 70 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="px-2 py-1.5 text-right text-xs font-semibold text-subtle-foreground">מערכת</th>
            {cols.map(c => (
              <th key={c} className="px-2 py-1.5 text-center text-xs font-semibold" style={{ color: colColors?.[c] ?? C.textSecondary }}>{c}</th>
            ))}
            <th className="px-2 py-1.5 text-center text-xs font-semibold text-subtle-foreground">סה״כ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => {
            const rowAll = values[ri].flat();
            return (
              <tr key={r}>
                <td className="max-w-[200px] truncate px-2 py-1.5 text-xs text-foreground" title={r}>{r}</td>
                {cols.map((c, ci) => {
                  const ids = values[ri][ci];
                  const s = shade(ids.length);
                  return (
                    <td key={c} onClick={() => ids.length && onPick(`${r} · ${c}`, ids)} title={`${r} · ${c}: ${ids.length}`}
                      className={`rounded-md px-2 py-1.5 text-center text-xs font-semibold tabular-nums ${ids.length ? 'cursor-pointer hover:outline hover:outline-2 hover:outline-offset-[-2px]' : ''}`}
                      style={{ background: s.bg, color: s.fg, minWidth: 70, outlineColor: C.textPrimary }}>
                      {ids.length ? ids.length.toLocaleString() : '—'}
                    </td>
                  );
                })}
                <td onClick={() => onPick(r, rowAll)} className="cursor-pointer px-2 py-1.5 text-center text-xs font-bold tabular-nums text-foreground">{rowAll.length.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ── bits ───────────────────────────────────────────────────────────────────
export const Legend: React.FC<{ items: { label: string; color: string; value?: string; onClick?: () => void }[]; vertical?: boolean }> = ({ items, vertical }) => (
  <div className={`flex ${vertical ? 'flex-col gap-1.5' : 'flex-wrap gap-x-4 gap-y-1'}`}>
    {items.map(it => (
      <button key={it.label} onClick={it.onClick} disabled={!it.onClick}
        className={`flex items-center gap-1.5 border-none bg-transparent p-0 text-xs text-muted-foreground ${it.onClick ? 'cursor-pointer hover:text-foreground' : 'cursor-default'}`}>
        <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: it.color }} />
        <span className="max-w-[180px] truncate" title={it.label}>{it.label}</span>
        {it.value && <span className="tabular-nums text-foreground">{it.value}</span>}
      </button>
    ))}
  </div>
);

const Empty = () => <div className="p-6 text-center text-xs text-subtle-foreground">אין נתונים לסינון הנוכחי</div>;

const Grid: React.FC<{ ticks: number[]; y: (v: number) => number; x1: number; x2: number }> = ({ ticks, y, x1, x2 }) => (
  <g>
    {ticks.map(v => (
      <g key={v}>
        <line x1={x1} x2={x2} y1={y(v)} y2={y(v)} stroke={C.border} strokeWidth={1} />
        <text x={x1 - 6} y={y(v) + 4} fontSize="12" fill={C.textMuted} textAnchor="end">{v.toLocaleString()}</text>
      </g>
    ))}
  </g>
);

// Show every k-th x label so ~44px labels never collide.
const labelStep = (slot: number) => Math.max(1, Math.ceil(44 / Math.max(1, slot)));

function niceTicks(max: number): number[] {
  const raw = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001 || out.length < 2; v += step) out.push(Math.round(v));
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

function roundTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

function arcPath(cx: number, cy: number, R: number, r: number, a0: number, a1: number): string {
  if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad: number, a: number) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
  return `M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z`;
}
