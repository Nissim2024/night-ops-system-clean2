import React, { useEffect, useMemo, useState } from 'react';
import { autoFitColumns, FitResult } from './autoFitColumns';

// One hook for every defect table in the app (2026-10-06, user: "שתמיד תהיה
// מותאמת" — whichever module the table is opened from): measures the table's
// scroll box and fits the columns to it (see autoFitColumns). Hand-resized
// columns (useColumnWidths) keep their width.
//
// Usage: const fit = useAutoFitTable({...});
//   <div ref={fit.boxRef} className="overflow-auto">…<table style={fit.tableStyle}>
//   width: fit.colWidth(key); fit.wraps(key) → render the cell as wrapping text.
export interface WidthsApi {
  getWidth: (key: string) => number;
  hasManual: (key: string) => boolean;
}

export function useAutoFitTable<Row>(opts: {
  rows: Row[] | null | undefined;
  columns: { key: string; label: string }[];
  getValue: (row: Row, key: string) => unknown;
  widths: WidthsApi;
  /** Extra px a cell draws around its text (badge, avatar, icon). */
  extra?: (key: string) => number;
  /** Fixed-width leading column (e.g. a checkbox) not part of `columns`. */
  leadingWidth?: number;
}) {
  const { rows, columns, getValue, widths, extra, leadingWidth = 0 } = opts;
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    if (!box) return;
    const update = () => setBoxWidth(box.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(box);
    return () => ro.disconnect();
  }, [box]);

  const colKey = columns.map(c => c.key).join(',');
  const fit: FitResult | null = useMemo(() => {
    if (!rows || !boxWidth) return null;
    // measure with the font the table really renders in
    const family = (box && getComputedStyle(box).fontFamily) || getComputedStyle(document.body).fontFamily || 'sans-serif';
    return autoFitColumns(columns.map(c => ({
      key: c.key,
      header: c.label,
      values: rows.map(r => String(getValue(r, c.key) ?? '')),
      extra: extra?.(c.key) ?? 0,
      manualWidth: widths.hasManual(c.key) ? widths.getWidth(c.key) : undefined,
    })), boxWidth - leadingWidth - 2, family);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, boxWidth, colKey, widths.hasManual, widths.getWidth, leadingWidth, box]);

  const colWidth = (key: string) => fit?.widths[key] ?? widths.getWidth(key);
  const wraps = (key: string) => !!fit?.wrap.has(key);
  const tableStyle: React.CSSProperties = {
    tableLayout: 'fixed',
    width: fit ? fit.total + leadingWidth : '100%',
  };
  return { boxRef: setBox, colWidth, wraps, tableStyle, fitted: !!fit };
}

// Cell style for a wrapping text column: up to 3 lines, then "…" (full text in
// the cell's title tooltip). Applied to an inner <div>, never the <td> itself
// (display:-webkit-box on a td breaks the table layout).
export const WRAP_CLAMP_STYLE: React.CSSProperties = {
  whiteSpace: 'normal', overflowWrap: 'anywhere', display: '-webkit-box',
  WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
};
