// Single source of truth for date/time DISPLAY formatting across the app —
// before this, ~40 files each had their own local fmtDate/fmtDateTime/formatDate
// helper (or an inline .toLocaleDateString/.toLocaleString call), producing at
// least 9 different date-only shapes and 6 different date+time shapes for the
// same underlying data (24/08, 24.8.2026, 24/08/26, D/M with no zero-pad,
// etc. — audited 2026-08-31). Manual digit formatting (not toLocaleDateString)
// so the output never depends on locale/options being passed correctly at
// each call site — DatePicker.tsx's formatDMY uses the same manual-digit
// approach for the same reason, but only accepts a bare 'YYYY-MM-DD' string
// (editable-field contract); this accepts anything a real timestamp shows up
// as (Date object, full ISO datetime string, etc).
function toDate(value: Date | string | number | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// DD/MM/YYYY — date-only fields.
export function formatDate(value: Date | string | number | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// DD/MM/YYYY HH:MM (24h, zero-padded) — date+time fields.
export function formatDateTime(value: Date | string | number | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// HH:MM only — for the handful of places that show just a time (e.g. a
// same-day schedule row) with no date component.
export function formatTime(value: Date | string | number | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
