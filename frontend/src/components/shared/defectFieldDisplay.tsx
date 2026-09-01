import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import { C, FONT, WEIGHT, RADIUS } from '../../theme';
import { Avatar } from '../ui';
import { formatDateTime } from '../../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Shared building blocks for "defect detail" screens across the app —
// extracted from VersionOverview.tsx's TARGET-defect work (2026-08-30) so
// every defect-detail screen (TARGET, open-production defects via
// DefectDetailScreen/DefectDrilldownModal, and future ones) gets the same
// language-aware alignment, person/team badges, notes parsing, and
// field/category picker instead of N drifting copies. Field keys are plain
// strings here (not keyof SomeDefect) since different screens have
// genuinely different field-shape interfaces — see the investigation
// 2026-08-30 that found ~9 backend DTOs / ~12 frontend interfaces for
// "defect" across the app.

export function hasHebrew(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x0590 && c <= 0x05ff) return true;
  }
  return false;
}

// Stable hash-per-name palette — same as UnifiedGoLivePlanView's teamColor,
// centralized here so every screen's person/team badges use one consistent
// mapping instead of each file re-hashing its own.
export const TEAM_PALETTE = ['#4573D2', '#9C6ADE', '#37C47A', '#E8AF00', '#F0883E', '#14B8A6', '#EC6BAD', '#6366F1'];
export function teamColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TEAM_PALETTE[hash % TEAM_PALETTE.length];
}

export function NameBadge({ name }: { name: string }) {
  return (
    <span style={{
      fontSize: '12px', fontWeight: WEIGHT.semibold, color: '#fff',
      background: teamColor(name), borderRadius: RADIUS.sm, padding: '2px 8px',
      whiteSpace: 'nowrap', display: 'inline-block',
    }}>
      {name}
    </span>
  );
}

// Avatar-circle + first-name, matching the implementation-plan module's
// pattern (ui.tsx's Avatar). Only reads well when `name` is a real "First
// Last" string — a raw QC login (no space) degrades gracefully to a single
// letter + the login itself.
export function PersonAvatar({ name }: { name: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', direction: 'ltr' }}>
      <Avatar name={name} size={20} />
      <span style={{ fontSize: '13px', color: C.textSecondary }}>{name.split(' ')[0]}</span>
    </span>
  );
}

// QC's Notes/dev-comments field concatenates one history entry per prior
// comment, each separated by a run of underscores and headed by
// "Name <login>, DD/MM/YYYY:" — e.g. "________...Maamon Alwan <maamona>,
// 18/01/2026:בוצע בדיקה ללקוח". Split on the underscore runs, pull the
// header off each chunk when present, and render header (left/ltr) + forced
// line break + body (right/rtl if it has any Hebrew, left/ltr if pure
// English). A chunk that doesn't match the header shape (e.g. legacy free
// text before the first separator) falls back to plain hasHebrew-based
// alignment.
const NOTE_ENTRY_HEADER_RE = /^\s*(.+?)\s*<([^<>]+)>\s*,\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*:\s*/;
export function renderNotesField(raw: string | null | undefined) {
  if (!raw?.trim()) return '—';
  const chunks = raw.split(/_{5,}/).map(c => c.trim()).filter(Boolean);
  if (chunks.length === 0) return '—';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {chunks.map((chunk, i) => {
        const m = chunk.match(NOTE_ENTRY_HEADER_RE);
        if (m) {
          const header = `${m[1]} <${m[2]}>, ${m[3]}:`;
          const body = chunk.slice(m[0].length).trim();
          const bodyRtl = hasHebrew(body);
          return (
            <div key={i} style={{ borderTop: i > 0 ? `1px dashed ${C.border}` : 'none', paddingTop: i > 0 ? '10px' : 0 }}>
              <div style={{ direction: 'ltr', textAlign: 'left', fontSize: '15px', fontWeight: WEIGHT.semibold, color: C.textMuted }}>{header}</div>
              <div style={{
                direction: bodyRtl ? 'rtl' : 'ltr', textAlign: bodyRtl ? 'right' : 'left',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '4px',
                fontSize: bodyRtl ? '16px' : undefined,
              }}>
                {body || '—'}
              </div>
            </div>
          );
        }
        const rtl = hasHebrew(chunk);
        return (
          <div key={i} style={{ direction: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: rtl ? '16px' : undefined }}>
            {chunk}
          </div>
        );
      })}
    </div>
  );
}

export interface DetailGroup { title: string; fields: string[] }

const columnMoveBtnStyle: React.CSSProperties = {
  padding: '4px 10px', background: C.bgNested, color: C.textPrimary,
  border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: 'pointer',
  fontSize: '13px', fontFamily: FONT, minWidth: '36px',
};

// Field→category assignment editor for a defect-detail form — lets a user
// hide fields entirely and reassign which group each shown field appears
// under, including creating/renaming/deleting groups outright. `storageKey`
// is per-screen so each defect-detail screen keeps its own independent
// customization (they don't share the same field set).
export function DetailGroupsDialog({
  allColumns, groups, defaultGroups, onApply, onClose,
}: {
  allColumns: { key: string; label: string }[];
  groups: DetailGroup[];
  defaultGroups: DetailGroup[];
  onApply: (groups: DetailGroup[]) => void;
  onClose: () => void;
}) {
  const [categories, setCategories] = useState<string[]>(groups.map(g => g.title));
  const [assignment, setAssignment] = useState<Record<string, string | null>>(() => {
    const map: Record<string, string | null> = {};
    allColumns.forEach(c => { map[c.key] = null; });
    groups.forEach(g => g.fields.forEach(k => { map[k] = g.title; }));
    return map;
  });
  const [newCategoryName, setNewCategoryName] = useState('');

  const resetToDefault = () => {
    setCategories(defaultGroups.map(g => g.title));
    setAssignment(() => {
      const map: Record<string, string | null> = {};
      allColumns.forEach(c => { map[c.key] = null; });
      defaultGroups.forEach(g => g.fields.forEach(k => { map[k] = g.title; }));
      return map;
    });
    setNewCategoryName('');
  };

  const addCategory = () => {
    const name = newCategoryName.trim();
    if (!name || categories.includes(name)) return;
    setCategories(c => [...c, name]);
    setNewCategoryName('');
  };
  const renameCategory = (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || categories.includes(trimmed)) return;
    setCategories(c => c.map(x => x === oldName ? trimmed : x));
    setAssignment(a => {
      const next = { ...a };
      Object.keys(next).forEach(k => { if (next[k] === oldName) next[k] = trimmed; });
      return next;
    });
  };
  const removeCategory = (name: string) => {
    setCategories(c => c.filter(x => x !== name));
    setAssignment(a => {
      const next = { ...a };
      Object.keys(next).forEach(k => { if (next[k] === name) next[k] = null; });
      return next;
    });
  };

  const apply = () => {
    const result: DetailGroup[] = categories
      .map(title => ({ title, fields: allColumns.filter(c => assignment[c.key] === title).map(c => c.key) }))
      .filter(g => g.fields.length > 0);
    onApply(result);
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.bgCard, borderRadius: RADIUS.lg, padding: '20px', width: '640px', maxWidth: '94vw', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 48px rgba(0,0,0,.25)', fontFamily: FONT, direction: 'rtl' }}>
        <div style={{ fontSize: '15px', fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '4px' }}>התאמת שדות וקטגוריות בטופס פרטי התקלה</div>
        <div style={{ fontSize: '12px', color: C.textMuted, marginBottom: '14px' }}>לכל שדה בחרו קטגוריה (או "הסתר") — ניתן גם להוסיף, לשנות שם, או למחוק קטגוריות.</div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px', paddingBottom: '14px', borderBottom: `1px solid ${C.border}` }}>
          {categories.map(cat => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: '3px 6px' }}>
              <input
                defaultValue={cat}
                onBlur={e => renameCategory(cat, e.target.value)}
                style={{ border: 'none', background: 'transparent', fontSize: '12px', color: C.textPrimary, width: `${Math.max(cat.length, 4)}ch`, fontFamily: FONT }}
              />
              <button onClick={() => removeCategory(cat)} style={{ border: 'none', background: 'transparent', color: C.danger, cursor: 'pointer', fontSize: '12px', padding: 0 }}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '4px' }}>
            <input
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCategory(); }}
              placeholder="קטגוריה חדשה..."
              style={{ fontSize: '12px', padding: '3px 8px', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, fontFamily: FONT, width: '110px' }}
            />
            <button onClick={addCategory} style={{ ...columnMoveBtnStyle, padding: '2px 10px' }}>+</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {allColumns.map(c => (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '4px 2px' }}>
              <span style={{ fontSize: '13px', color: C.textSecondary }}>{c.label}</span>
              <select
                value={assignment[c.key] ?? ''}
                onChange={e => setAssignment(a => ({ ...a, [c.key]: e.target.value || null }))}
                style={{ fontSize: '12px', padding: '3px 6px', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, fontFamily: FONT, minWidth: '150px' }}
              >
                <option value="">— הסתר —</option>
                {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '16px', paddingTop: '12px', borderTop: `1px solid ${C.border}` }}>
          <button onClick={resetToDefault} style={{ padding: '8px 16px', background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontFamily: FONT }}>↺ איפוס לברירת מחדל</button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={{ padding: '8px 20px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontFamily: FONT }}>Cancel</button>
            <button onClick={apply} style={{ padding: '8px 20px', background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontWeight: WEIGHT.semibold, fontFamily: FONT }}>OK</button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface DefectFieldChange {
  changeTime: string;
  changedBy: string;
  propertyName: string;
  oldValue: string;
  newValue: string;
}


// Change-history section for a defect-detail screen — fetches /qc/defect-
// field-history and renders a filterable table (מתי השתנה | מי שינה | שדה |
// ערך ישן | ערך חדש). Backed by QC's AUDIT_LOG/AUDIT_PROPERTIES tables (see
// DEFECT_FIELD_HISTORY_SQL in qc.service.ts) — AU_USER/AP_OLD_VALUE are
// unverified against any real instance beyond the mock fallback.
export function FieldChangeHistorySection({ defectId, token }: { defectId: string; token: string }) {
  const [fieldHistory, setFieldHistory] = useState<DefectFieldChange[] | null>(null);
  const [historyFieldFilter, setHistoryFieldFilter] = useState('');

  useEffect(() => {
    setFieldHistory(null);
    setHistoryFieldFilter('');
    axios.get(`${API}/qc/defect-field-history`, { headers: { Authorization: `Bearer ${token}` }, params: { defectId } })
      .then(r => setFieldHistory(r.data))
      .catch(() => setFieldHistory([]));
  }, [defectId, token]);

  return (
    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ fontSize: '14px', fontWeight: WEIGHT.bold, color: C.textMuted }}>היסטוריית שינויים</div>
        {fieldHistory && fieldHistory.length > 0 && (
          <select
            value={historyFieldFilter}
            onChange={e => setHistoryFieldFilter(e.target.value)}
            style={{ fontSize: '13px', padding: '4px 8px', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, fontFamily: FONT }}
          >
            <option value="">כל השדות</option>
            {Array.from(new Set(fieldHistory.map(h => h.propertyName))).sort().map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}
      </div>
      {!fieldHistory ? (
        <div style={{ textAlign: 'center', padding: '16px', color: C.textMuted, fontSize: '13px' }}>טוען...</div>
      ) : fieldHistory.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '16px', color: C.textMuted, fontSize: '13px' }}>אין היסטוריית שינויים זמינה לתקלה זו</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: C.bgNested }}>
                {['מתי השתנה', 'מי שינה', 'שדה', 'ערך ישן', 'ערך חדש'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'right', color: C.textMuted, fontWeight: WEIGHT.semibold, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fieldHistory
                .filter(h => !historyFieldFilter || h.propertyName === historyFieldFilter)
                .map((h, i) => {
                  const oldRtl = hasHebrew(h.oldValue);
                  const newRtl = hasHebrew(h.newValue);
                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '6px 10px', color: C.textSecondary, whiteSpace: 'nowrap', direction: 'ltr', textAlign: 'left' }}>{formatDateTime(h.changeTime)}</td>
                      <td style={{ padding: '6px 10px', color: C.textSecondary, whiteSpace: 'nowrap', direction: 'ltr', textAlign: 'left' }}>{h.changedBy || '—'}</td>
                      <td style={{ padding: '6px 10px', color: C.textPrimary, fontWeight: WEIGHT.semibold, whiteSpace: 'nowrap', direction: 'ltr', textAlign: 'left' }}>{h.propertyName || '—'}</td>
                      <td style={{ padding: '6px 10px', color: C.textSecondary, direction: oldRtl ? 'rtl' : 'ltr', textAlign: oldRtl ? 'right' : 'left' }}>{h.oldValue || '—'}</td>
                      <td style={{ padding: '6px 10px', color: C.textSecondary, direction: newRtl ? 'rtl' : 'ltr', textAlign: newRtl ? 'right' : 'left' }}>{h.newValue || '—'}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Resizable columns ────────────────────────────────────────────────────
// Drag-to-resize column widths for the app's defect tables (TARGET table,
// DefectDrilldownModal, OpenProdDefectsView) — none of them had any width
// control before this. Persisted per-user per-table via localStorage
// (`storageKey` is table-specific so each table keeps its own widths).
// RTL note: these tables are direction:'rtl' and the column-key array is in
// right-to-left reading order (first key = rightmost column), so the
// boundary between column N and column N+1 sits at column N's LEFT edge —
// the resize handle lives there, and dragging left (negative clientX delta)
// grows the column while dragging right shrinks it (spec confirmed
// 2026-08-31).
const MIN_COLUMN_WIDTH = 60;

export function useColumnWidths(storageKey: string, defaultWidth = 140) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore malformed storage */ }
    return {};
  });
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const getWidth = useCallback((key: string) => widths[key] ?? defaultWidth, [widths, defaultWidth]);

  const startResize = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthsRef.current[key] ?? defaultWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const next = Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth - delta));
      setWidths(w => ({ ...w, [key]: next }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try { localStorage.setItem(storageKey, JSON.stringify(widthsRef.current)); } catch { /* ignore quota errors */ }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [storageKey, defaultWidth]);

  return { getWidth, startResize };
}

// Thin drag handle on a header cell's left edge (see RTL note above). The
// `<th>` it's placed in needs `position: 'relative'`.
export function ColumnResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <span
      onMouseDown={onMouseDown}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', top: 0, bottom: 0, left: '-3px', width: '6px',
        cursor: 'col-resize', zIndex: 1,
      }}
    />
  );
}

// ── Per-column filtering — fixed-value columns vs free-text columns ─────
// Fields whose values come from a small, fixed set (Severity, Status,
// Reproducible Y/N, team names, ...) get a multi-select checklist; genuinely
// free-text fields (Summary, Description, Notes, ...) keep a substring
// search box. "Fixed" isn't hand-classified per field (that would mean
// maintaining a list across ~60+ fields spanning 3 different tables with
// overlapping-but-not-identical sets) — it's detected from the actual data:
// a column counts as fixed/enum when it has few distinct non-empty values
// (≤ENUM_MAX_DISTINCT) AND fewer distinct values than rows (so a column that
// only LOOKS small because there are few rows doesn't get misclassified).
// Session-only (not persisted), same as sort state in these tables (spec
// corrected 2026-08-31).
const ENUM_MAX_DISTINCT = 12;

// Explicit overrides for fields where the dynamic distinct-count heuristic
// can get the wrong answer for a given dataset — e.g. "סוג תקלה" (Bug Type)
// exceeded ENUM_MAX_DISTINCT in a real release so it fell back to free-text
// search even though it's clearly a fixed field; CR/HBR reference numbers
// happened to have few distinct values in a small table so they were
// misclassified as enum even though they're really a free-text reference
// field. Covers the full field vocabulary shared across all 3 tables
// (VersionOverview's TARGET_DEFECT_COLUMNS, DefectDrilldownModal's
// ALL_COLUMNS, openProdDefectsFields' TABLE_COLUMN_FIELDS/DETAIL_FIELDS —
// same key names except OpenProdDefectsView's own table using `bugType`
// where the others use `defectType`). Only semantically unambiguous fields
// are forced either way; genuinely data-dependent ones (person names,
// module/component pickers, business-process names) are left to the
// dynamic heuristic since there's no single right answer for those (spec
// corrected 2026-08-31).
const FORCE_ENUM_FIELDS = new Set([
  // Y/N flags — always exactly 2 possible values.
  'reproducible', 'reopenYn', 'fixedInProd', 'willBeTestAtGoLive', 'forRegressionTest',
  'toBeTestedOnProd', 'targetScopeApproved', 'foundByAutomation',
  // Fixed QC dropdown fields whose real vocabulary can exceed ENUM_MAX_DISTINCT
  // in production data even though they're conceptually a closed set.
  'status', 'statusAtMonth', 'currentStatus', 'severity', 'priority', 'testPhase',
  'defectType', 'bugType', 'fixType', 'environment', 'vendorStatus', 'supportStatus',
  'crStatus', 'category', 'itemType', 'platform', 'influence', 'secondaryPriority',
  'impact', 'deploymentCategory', 'targetType', 'reason', 'deploymentReason', 'productionReason',
]);
const FORCE_TEXT_FIELDS = new Set([
  // IDs/reference numbers — unique or near-unique by nature, never useful as a checklist.
  'id', 'defectId', 'crReferenceNumber', 'crHbrNumberReference', 'supportReferenceNumber', 'dropNumber',
  // Free-form prose.
  'title', 'subject', 'area',
  // Dates/times/durations — inherently high-cardinality; a small dataset
  // coincidentally having few distinct values doesn't make a date field a
  // sensible checklist.
  'detectedOnDate', 'detectedDate', 'discoveryDate', 'estimatedFixTime', 'actualFixTime',
  'estimateFixTime', 'fixedUntil', 'responseDate', 'modified', 'deploymentDateProd',
  'detectedInRelease', 'detectedInCycle', 'targetRelease', 'targetCycle',
]);

export function useColumnFilters(allRows: Record<string, unknown>[] | null | undefined, columnKeys: string[]) {
  const rows = allRows ?? [];
  const keysSignature = columnKeys.join('|');
  const distinctMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const key of keysSignature ? keysSignature.split('|') : []) {
      const set = new Set<string>();
      for (const r of rows) {
        const v = r[key];
        if (v !== null && v !== undefined && v !== '') set.add(String(v));
      }
      map[key] = Array.from(set).sort((a, b) => a.localeCompare(b, 'he'));
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, keysSignature]);

  const isEnum = useCallback((key: string) => {
    const distinct = distinctMap[key];
    if (!distinct || distinct.length === 0) return false;
    if (FORCE_TEXT_FIELDS.has(key)) return false;
    if (FORCE_ENUM_FIELDS.has(key)) return true;
    return distinct.length <= ENUM_MAX_DISTINCT && distinct.length < rows.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distinctMap, rows.length]);

  const [textTerms, setTextTerms] = useState<Record<string, string>>({});
  const [enumSel, setEnumSel] = useState<Record<string, Set<string>>>({});

  const setTextTerm = useCallback((key: string, value: string) => {
    setTextTerms(t => (value ? { ...t, [key]: value } : (() => { const n = { ...t }; delete n[key]; return n; })()));
  }, []);
  const toggleEnumValue = useCallback((key: string, value: string) => {
    setEnumSel(s => {
      const next = { ...s };
      const set = new Set(next[key] ?? []);
      if (set.has(value)) set.delete(value); else set.add(value);
      if (set.size === 0) delete next[key]; else next[key] = set;
      return next;
    });
  }, []);

  const matches = useCallback((row: Record<string, unknown>) => {
    for (const [key, term] of Object.entries(textTerms)) {
      if (!String(row[key] ?? '').toLowerCase().includes(term.toLowerCase())) return false;
    }
    for (const [key, set] of Object.entries(enumSel)) {
      if (set.size > 0 && !set.has(String(row[key] ?? ''))) return false;
    }
    return true;
  }, [textTerms, enumSel]);

  return {
    isEnum,
    distinctValues: (key: string) => distinctMap[key] ?? [],
    textTerm: (key: string) => textTerms[key] ?? '',
    setTextTerm,
    enumSelected: (key: string) => enumSel[key] ?? new Set<string>(),
    toggleEnumValue,
    matches,
  };
}

export type ColumnFiltersApi = ReturnType<typeof useColumnFilters>;

function EnumFilterButton({ label, options, selected, onToggle }: {
  label: string; options: string[]; selected: Set<string>; onToggle: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const buttonLabel = selected.size === 0 ? 'הכל' : `${selected.size} נבחרו`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          width: '100%', boxSizing: 'border-box', fontSize: '12px', padding: '3px 6px', textAlign: 'right',
          border: `1px solid ${selected.size > 0 ? C.brand : C.border}`, borderRadius: RADIUS.sm, fontFamily: FONT,
          color: selected.size > 0 ? C.brand : C.textSecondary, background: C.bgApp, cursor: 'pointer',
        }}
      >
        {buttonLabel} ▾
      </button>
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: '2px', zIndex: 20,
            background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.md,
            boxShadow: '0 8px 24px rgba(0,0,0,.18)', minWidth: '160px', maxHeight: '240px', overflowY: 'auto',
            padding: '4px',
          }}
        >
          {options.map(opt => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px', fontSize: '12px', color: C.textPrimary, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={selected.has(opt)} onChange={() => onToggle(opt)} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function ColumnFilterRow({
  columns, getWidth, filters,
}: {
  columns: { key: string; label: string }[];
  getWidth: (key: string) => number;
  filters: ColumnFiltersApi;
}) {
  return (
    <tr style={{ background: C.bgCard }}>
      {columns.map(c => (
        <th key={c.key} style={{ padding: '4px 6px', borderBottom: `1px solid ${C.border}`, width: getWidth(c.key) }}>
          {filters.isEnum(c.key) ? (
            <EnumFilterButton
              label={c.label}
              options={filters.distinctValues(c.key)}
              selected={filters.enumSelected(c.key)}
              onToggle={value => filters.toggleEnumValue(c.key, value)}
            />
          ) : (
            <input
              value={filters.textTerm(c.key)}
              onChange={e => filters.setTextTerm(c.key, e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="חיפוש..."
              style={{
                width: '100%', boxSizing: 'border-box', fontSize: '12px', padding: '3px 6px',
                border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, fontFamily: FONT,
                color: C.textPrimary, background: C.bgApp,
              }}
            />
          )}
        </th>
      ))}
    </tr>
  );
}
