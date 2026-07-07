/**
 * Shared date input components — replace native <input type="date"> so the
 * displayed format is always DD/MM/YYYY regardless of browser/OS locale
 * (native date inputs render in whatever format the OS is set to).
 *
 * Value/onChange use the same 'YYYY-MM-DD' ISO string shape as native
 * <input type="date">, so call sites can swap in a DateField with minimal
 * changes to surrounding state.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../theme';

const DAY_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']; // Sunday → Saturday
const MONTH_NAMES = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

const pad2 = (n: number) => String(n).padStart(2, '0');

function parseIso(iso?: string): { y: number; m: number; d: number } | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}

export function formatDMY(iso?: string): string {
  const p = parseIso(iso);
  return p ? `${pad2(p.d)}/${pad2(p.m + 1)}/${p.y}` : '';
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

// JS getDay(): Sunday=0 — matches DAY_LETTERS order directly (Israeli week starts Sunday)
function firstWeekday(y: number, m: number): number {
  return new Date(y, m, 1).getDay();
}

const inputBase: React.CSSProperties = {
  fontFamily: FONT, ...TEXT.sm, padding: '7px 10px',
  border: `1px solid ${C.border}`, borderRadius: RADIUS.md,
  background: C.bgCard, color: C.textPrimary, direction: 'ltr', textAlign: 'right',
};

const popoverBase: React.CSSProperties = {
  position: 'fixed', zIndex: 3000,
  background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg,
  boxShadow: SHADOW.lg, padding: SP[3], fontFamily: FONT,
};

function useOutsideClose(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // The calendar itself renders in a portal (document.body), so it's not a
      // DOM descendant of `ref` — treat clicks inside it as "inside" too,
      // otherwise picking a date would immediately close the popover.
      if (target.closest?.('[data-datepicker-popover]')) return;
      if (ref.current && !ref.current.contains(target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onClose]);
}

// Renders its children into document.body, positioned relative to `anchorRef`,
// so the calendar can never be clipped/scrolled-away by a parent modal's own
// overflow (position:fixed + fixed-size dialogs were hiding the popover behind
// a scrollbar instead of showing it). Flips above the anchor when there isn't
// enough room below the viewport.
const PopoverPortal: React.FC<{ anchorRef: React.RefObject<HTMLElement | null>; open: boolean; children: React.ReactNode; align?: 'start' | 'end' }> = ({ anchorRef, open, children, align = 'start' }) => {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) { setPos(null); return; }

    const recalc = () => {
      const rect = anchorRef.current!.getBoundingClientRect();
      const popH = popRef.current?.offsetHeight ?? 320;
      const popW = popRef.current?.offsetWidth ?? 260;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < popH + 12 && rect.top > popH + 12;
      const top = openUpward ? rect.top - popH - 6 : rect.bottom + 6;
      let left = align === 'end' ? rect.right - popW : rect.left;
      left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
      setPos({ top: Math.max(8, top), left });
    };

    recalc();
    window.addEventListener('resize', recalc);
    window.addEventListener('scroll', recalc, true);
    return () => {
      window.removeEventListener('resize', recalc);
      window.removeEventListener('scroll', recalc, true);
    };
  }, [open, anchorRef, align]);

  if (!open) return null;
  return createPortal(
    <div ref={popRef} data-datepicker-popover style={{ ...popoverBase, top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
};

interface MonthGridProps {
  year: number; month: number;
  isSelected: (y: number, m: number, d: number) => boolean;
  isInRange?: (y: number, m: number, d: number) => boolean;
  onPick: (y: number, m: number, d: number) => void;
  minIso?: string;
}

const MonthGrid: React.FC<MonthGridProps> = ({ year, month, isSelected, isInRange, onPick, minIso }) => {
  const total = daysInMonth(year, month);
  const startPad = firstWeekday(year, month);
  const cells: (number | null)[] = [...Array(startPad).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  const minP = parseIso(minIso);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
        {DAY_LETTERS.map(d => (
          <div key={d} style={{ ...TEXT.xs, textAlign: 'center', color: C.textMuted, fontWeight: WEIGHT.semibold, padding: '4px 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={`empty-${i}`} />;
          const disabled = !!minP && new Date(year, month, d) < new Date(minP.y, minP.m, minP.d);
          const selected = isSelected(year, month, d);
          const inRange = isInRange?.(year, month, d) && !selected;
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => onPick(year, month, d)}
              style={{
                ...TEXT.sm, padding: '6px 0', borderRadius: RADIUS.sm, border: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                background: selected ? C.brand : inRange ? C.brand + '22' : 'transparent',
                color: disabled ? C.textDisabled : selected ? '#fff' : C.textPrimary,
                fontWeight: selected ? WEIGHT.bold : WEIGHT.normal,
                transition: EASE.fast,
              }}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const MonthNav: React.FC<{ year: number; month: number; onPrev: () => void; onNext: () => void }> = ({ year, month, onPrev, onNext }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP[2] }}>
    <button type="button" onClick={onPrev} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: C.textSecondary, padding: '2px 6px' }}>‹</button>
    <span style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{MONTH_NAMES[month]} {year}</span>
    <button type="button" onClick={onNext} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: C.textSecondary, padding: '2px 6px' }}>›</button>
  </div>
);

// ── Single date field ────────────────────────────────────────────────────────

interface DateFieldProps {
  value: string; // ISO 'YYYY-MM-DD' or ''
  onChange: (iso: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minIso?: string;
  style?: React.CSSProperties;
}

export const DateField: React.FC<DateFieldProps> = ({ value, onChange, placeholder, disabled, minIso, style }) => {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const p = parseIso(value);
  const [viewY, setViewY] = useState(p?.y ?? today.getFullYear());
  const [viewM, setViewM] = useState(p?.m ?? today.getMonth());
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, () => setOpen(false));

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <input
        readOnly
        value={formatDMY(value)}
        placeholder={placeholder ?? 'dd/mm/yyyy'}
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        style={{ ...inputBase, width: '100%', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1, ...style }}
      />
      <PopoverPortal anchorRef={ref} open={open} align="start">
        <div style={{ minWidth: '260px' }}>
          <MonthNav
            year={viewY} month={viewM}
            onPrev={() => { const d = new Date(viewY, viewM - 1, 1); setViewY(d.getFullYear()); setViewM(d.getMonth()); }}
            onNext={() => { const d = new Date(viewY, viewM + 1, 1); setViewY(d.getFullYear()); setViewM(d.getMonth()); }}
          />
          <MonthGrid
            year={viewY} month={viewM} minIso={minIso}
            isSelected={(y, m, d) => !!p && p.y === y && p.m === m && p.d === d}
            onPick={(y, m, d) => { onChange(toIso(y, m, d)); setOpen(false); }}
          />
        </div>
      </PopoverPortal>
    </div>
  );
};

// ── Date range field (hotel-booking style: two months side by side) ────────

interface DateRangeFieldProps {
  startIso: string;
  endIso: string;
  onChange: (startIso: string, endIso: string) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export const DateRangeField: React.FC<DateRangeFieldProps> = ({ startIso, endIso, onChange, disabled, style }) => {
  const [open, setOpen] = useState(false);
  const sp = parseIso(startIso);
  const ep = parseIso(endIso);
  const today = new Date();
  const [viewY, setViewY] = useState(sp?.y ?? today.getFullYear());
  const [viewM, setViewM] = useState(sp?.m ?? today.getMonth());
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, () => setOpen(false));

  const nextMonthDate = new Date(viewY, viewM + 1, 1);

  const dateOf = (y: number, m: number, d: number) => new Date(y, m, d).getTime();
  const inRange = (y: number, m: number, d: number) => {
    if (!sp || !ep) return false;
    const t = dateOf(y, m, d);
    return t > dateOf(sp.y, sp.m, sp.d) && t < dateOf(ep.y, ep.m, ep.d);
  };
  const isSelected = (y: number, m: number, d: number) =>
    (!!sp && sp.y === y && sp.m === m && sp.d === d) || (!!ep && ep.y === y && ep.m === m && ep.d === d);

  const pick = (y: number, m: number, d: number) => {
    const iso = toIso(y, m, d);
    if (!sp || (sp && ep)) {
      // Start a fresh selection
      onChange(iso, '');
    } else {
      // Have a start only — this click sets the end (swap if picked before start)
      if (dateOf(y, m, d) < dateOf(sp.y, sp.m, sp.d)) onChange(iso, startIso);
      else onChange(startIso, iso);
    }
  };

  const nights = sp && ep ? Math.round((dateOf(ep.y, ep.m, ep.d) - dateOf(sp.y, sp.m, sp.d)) / 86400000) : null;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <div style={{ display: 'flex', gap: SP[2], width: '100%' }}>
        <input readOnly value={formatDMY(startIso)} placeholder="מתאריך" disabled={disabled}
          onClick={() => !disabled && setOpen(o => !o)}
          style={{ ...inputBase, flex: 1, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1, ...style }} />
        <input readOnly value={formatDMY(endIso)} placeholder="עד תאריך" disabled={disabled}
          onClick={() => !disabled && setOpen(o => !o)}
          style={{ ...inputBase, flex: 1, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1, ...style }} />
      </div>
      <PopoverPortal anchorRef={ref} open={open} align="end">
        <div style={{ minWidth: '560px' }}>
          {nights !== null && (
            <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: SP[2], textAlign: 'center' }}>
              {nights} {nights === 1 ? 'לילה' : 'לילות'}
            </div>
          )}
          <div style={{ display: 'flex', gap: SP[4] }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP[2] }}>
                <button type="button" onClick={() => { const d = new Date(viewY, viewM - 1, 1); setViewY(d.getFullYear()); setViewM(d.getMonth()); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: C.textSecondary, padding: '2px 6px' }}>‹</button>
                <span style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{MONTH_NAMES[viewM]} {viewY}</span>
                <span style={{ width: '22px' }} />
              </div>
              <MonthGrid year={viewY} month={viewM} isSelected={isSelected} isInRange={inRange} onPick={pick} />
            </div>
            <div style={{ width: '1px', background: C.border }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP[2] }}>
                <span style={{ width: '22px' }} />
                <span style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>
                  {MONTH_NAMES[nextMonthDate.getMonth()]} {nextMonthDate.getFullYear()}
                </span>
                <button type="button" onClick={() => { setViewY(nextMonthDate.getFullYear()); setViewM(nextMonthDate.getMonth()); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: C.textSecondary, padding: '2px 6px' }}>›</button>
              </div>
              <MonthGrid year={nextMonthDate.getFullYear()} month={nextMonthDate.getMonth()} isSelected={isSelected} isInRange={inRange} onPick={pick} />
            </div>
          </div>
          {sp && ep && (
            <div style={{ marginTop: SP[3], display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setOpen(false)}
                style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, background: C.brand, color: '#fff', border: 'none', borderRadius: RADIUS.md, padding: '7px 16px', cursor: 'pointer' }}>
                המשך
              </button>
            </div>
          )}
        </div>
      </PopoverPortal>
    </div>
  );
};

// ── Time field (replaces native <input type="time"> — that renders in
// whatever 12h/24h format the OS/browser locale dictates, and a 12h render
// with an AM/PM suffix doesn't fit the fixed-width box, clipping to one
// letter. This is always 24-hour HH:MM, so it never needs an AM/PM suffix.) ─

interface TimeFieldProps {
  value: string; // 'HH:MM' 24-hour
  onChange: (v: string) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export const TimeField: React.FC<TimeFieldProps> = ({ value, onChange, disabled, style }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const commit = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    if (!digits) { setDraft(''); onChange(''); return; }
    let h: number, m: number;
    if (digits.length <= 2) { h = parseInt(digits, 10); m = 0; }
    else { h = parseInt(digits.slice(0, digits.length - 2), 10); m = parseInt(digits.slice(-2), 10); }
    h = Math.min(23, Math.max(0, h || 0));
    m = Math.min(59, Math.max(0, m || 0));
    const formatted = `${pad2(h)}:${pad2(m)}`;
    setDraft(formatted);
    onChange(formatted);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft}
      disabled={disabled}
      placeholder="hh:mm"
      maxLength={5}
      onChange={e => setDraft(e.target.value)}
      onBlur={e => commit(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{ ...inputBase, width: '76px', textAlign: 'center', direction: 'ltr', cursor: disabled ? 'default' : 'text', opacity: disabled ? 0.6 : 1, ...style }}
    />
  );
};

// ── Date + time field (drop-in for native <input type="datetime-local">) ───
// Value/onChange use the same 'YYYY-MM-DDTHH:MM' shape as datetime-local.

interface DateTimeFieldProps {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export const DateTimeField: React.FC<DateTimeFieldProps> = ({ value, onChange, disabled, style }) => {
  const [datePart, timePart] = value ? value.split('T') : ['', ''];

  return (
    <div style={{ display: 'flex', gap: SP[2] }}>
      <div style={{ flex: 1 }}>
        <DateField
          value={datePart}
          disabled={disabled}
          style={style}
          onChange={iso => onChange(`${iso}T${timePart || '00:00'}`)}
        />
      </div>
      <TimeField
        value={timePart}
        disabled={disabled}
        onChange={t => onChange(`${datePart || new Date().toISOString().slice(0, 10)}T${t || '00:00'}`)}
      />
    </div>
  );
};
