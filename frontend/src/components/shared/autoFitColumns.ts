// Auto-fit column widths for the defect tables (user ask 2026-10-06): use the
// space the screen actually has, size every column to its content, wrap only
// long free text, and fall back to horizontal scroll only when nothing else fits.
//
//  1. Each column's natural width = widest of its header and its values on the
//     current page (measured with canvas text metrics, + room for badges/avatars).
//  2. Short columns (id, dates, status, people...) never wrap — they get their
//     natural width.
//  3. "Wrappable" columns (known long-text fields, or any column whose natural
//     width exceeds SHORT_CAP) wrap onto up to 3 lines and can shrink to WRAP_MIN.
//  4. Leftover space goes to the wrappable columns (or to all columns when
//     there are none), so the table fills the card exactly.
//  5. Still too wide at WRAP_MIN → the table is wider than the card → scroll.
// Columns the user resized by hand keep their manual width.

export const SHORT_CAP = 260;      // above this a column is treated as wrappable text
export const WRAP_MIN = 220;       // narrowest a wrapping column may get
export const WRAP_MAX = 640;       // widest a wrapping column is sized for its content
export const LONG_TEXT_KEYS = new Set([
  'title', 'summary', 'description', 'notes', 'comments', 'reason', 'productionReason', 'deploymentReason',
  'targetReleaseReason', 'businessProcess', 'mainBusinessProcess', 'impact', 'subject',
]);

let ctx: CanvasRenderingContext2D | null = null;
function measure(text: string, font: string): number {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * 7;
  ctx.font = font;
  return ctx.measureText(text).width;
}

export interface FitColumn {
  key: string;
  header: string;
  values: string[];
  extra?: number;              // fixed extra px for the cell's decoration (badge padding, avatar)
  manualWidth?: number;        // user-set width → kept as-is
}

export interface FitResult { widths: Record<string, number>; wrap: Set<string>; total: number }

export function autoFitColumns(cols: FitColumn[], available: number, fontFamily: string): FitResult {
  const cellFont = `400 13px ${fontFamily}`;
  const headFont = `700 11px ${fontFamily}`;
  const CELL_PAD = 28;   // 10px each side + safety for font/rounding differences
  const natural: Record<string, number> = {};
  const wrap = new Set<string>();

  for (const c of cols) {
    // Headers may wrap onto two lines, so only their longest WORD sets a floor.
    const longestWord = c.header.split(/\s+/).reduce((m, wd) => Math.max(m, measure(wd, headFont)), 0);
    let w = longestWord + 30;   // + sort arrow / resize handle
    for (const v of c.values) {
      if (!v) continue;
      w = Math.max(w, measure(v, cellFont) + CELL_PAD + (c.extra ?? 0));
    }
    natural[c.key] = Math.ceil(Math.max(56, w));
    if (LONG_TEXT_KEYS.has(c.key) || natural[c.key] > SHORT_CAP) wrap.add(c.key);
  }

  const widths: Record<string, number> = {};
  let fixedSum = 0;
  const flexKeys: string[] = [];
  for (const c of cols) {
    if (c.manualWidth != null) { widths[c.key] = c.manualWidth; fixedSum += c.manualWidth; wrap.delete(c.key); continue; }
    if (wrap.has(c.key)) { flexKeys.push(c.key); continue; }
    widths[c.key] = natural[c.key];
    fixedSum += natural[c.key];
  }

  const wanted = (k: string) => Math.min(WRAP_MAX, Math.max(WRAP_MIN, natural[k]));
  const wantedSum = flexKeys.reduce((s, k) => s + wanted(k), 0);
  const room = available - fixedSum;

  if (flexKeys.length === 0) {
    // nothing wraps — spread any leftover across the auto columns
    const autoKeys = cols.filter(c => c.manualWidth == null).map(c => c.key);
    if (room > 0 && autoKeys.length) {
      const base = autoKeys.reduce((s, k) => s + widths[k], 0);
      for (const k of autoKeys) widths[k] = Math.floor(widths[k] + (room * widths[k]) / base);
    }
  } else if (room >= wantedSum) {
    // everything fits at its natural width — the extra goes to the text columns
    const extra = room - wantedSum;
    for (const k of flexKeys) widths[k] = Math.floor(wanted(k) + (extra * wanted(k)) / wantedSum);
  } else {
    // shrink text columns toward WRAP_MIN, proportionally to how much each can give
    const give = flexKeys.reduce((s, k) => s + (wanted(k) - WRAP_MIN), 0);
    const deficit = wantedSum - Math.max(room, flexKeys.length * WRAP_MIN);
    for (const k of flexKeys) {
      const share = give > 0 ? ((wanted(k) - WRAP_MIN) / give) * deficit : 0;
      widths[k] = Math.max(WRAP_MIN, Math.floor(wanted(k) - share));
    }
  }

  const total = cols.reduce((s, c) => s + widths[c.key], 0);
  return { widths, wrap, total };
}
