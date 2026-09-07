import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';
import { DefectDetailScreen } from '../quality-hub/OpenProdDefectsView';
import { hasHebrew, PersonAvatar, NameBadge, useColumnFilters, EnumFilterButton } from '../shared/defectFieldDisplay';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Defect {
  id: string; title: string; severity: string; status: string; assignedTo: string; discoveryDate: string;
  priority: string; reporter: string; environment: string; testPhase: string; defectType: string;
  system: string; responsibility: string; crHbrNumberReference: string; fixType: string; reason: string;
  reopenYn: string; description: string; notes: string; targetRelease: string;
}

type ColumnKey = keyof Defect;
const ALL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'id', label: 'תקלה' },
  { key: 'title', label: 'כותרת' },
  { key: 'severity', label: 'חומרה' },
  { key: 'status', label: 'סטטוס' },
  { key: 'assignedTo', label: 'אחראי' },
  { key: 'discoveryDate', label: 'תאריך גילוי' },
  { key: 'priority', label: 'עדיפות' },
  { key: 'reporter', label: 'מדווח' },
  { key: 'environment', label: 'סביבה' },
  { key: 'testPhase', label: 'שלב בדיקה' },
  { key: 'defectType', label: 'סוג תקלה' },
  { key: 'system', label: 'פרויקט / מערכת' },
  { key: 'responsibility', label: 'צוות אחראי' },
  { key: 'crHbrNumberReference', label: 'CR/HBR' },
  { key: 'fixType', label: 'סוג תיקון' },
  { key: 'reason', label: 'סיבה' },
  { key: 'reopenYn', label: 'נפתח מחדש' },
  { key: 'description', label: 'תיאור' },
  { key: 'notes', label: 'הערות' },
  { key: 'targetRelease', label: 'יעד (גרסה הבאה)' },
];
const DEFAULT_COLUMNS: ColumnKey[] = ['id', 'title', 'severity', 'status', 'assignedTo', 'discoveryDate'];
const COLUMNS_STORAGE_KEY = 'deploycenter_defect_drilldown_columns_v1';

const columnMoveBtnStyle: React.CSSProperties = {
  padding: '4px 10px', background: C.bgNested, color: C.textPrimary,
  border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: 'pointer',
  fontSize: '13px', fontFamily: FONT, minWidth: '36px',
};

// Same "Select Columns" UX already established in IncidentsView.tsx's
// SelectColumnsDialog (mirrors the reference ALM/QC dialog) — retyped here
// for Defect. Kept as a separate copy rather than a shared generic: the two
// column sets (ImportCandidate vs Defect) don't overlap enough to be worth
// the added indirection of a shared generic component (2026-08-29).
function SelectColumnsDialog({ visibleKeys, onApply, onClose }: {
  visibleKeys: ColumnKey[]; onApply: (keys: ColumnKey[]) => void; onClose: () => void;
}) {
  const [visible, setVisible] = useState(
    visibleKeys.map(k => ALL_COLUMNS.find(c => c.key === k)).filter((c): c is { key: ColumnKey; label: string } => !!c)
  );
  const [available, setAvailable] = useState(ALL_COLUMNS.filter(c => !visibleKeys.includes(c.key)));
  const [selAvailable, setSelAvailable] = useState<Set<ColumnKey>>(new Set());
  const [selVisible, setSelVisible] = useState<Set<ColumnKey>>(new Set());

  const toggle = (set: Set<ColumnKey>, key: ColumnKey, setFn: (s: Set<ColumnKey>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setFn(next);
  };

  const moveToVisible = () => {
    if (selAvailable.size === 0) return;
    setVisible(v => [...v, ...available.filter(c => selAvailable.has(c.key))]);
    setAvailable(a => a.filter(c => !selAvailable.has(c.key)));
    setSelAvailable(new Set());
  };
  const moveToAvailable = () => {
    if (selVisible.size === 0) return;
    setAvailable(a => [...a, ...visible.filter(c => selVisible.has(c.key))]);
    setVisible(v => v.filter(c => !selVisible.has(c.key)));
    setSelVisible(new Set());
  };
  const moveAllToVisible = () => { setVisible(v => [...v, ...available]); setAvailable([]); setSelAvailable(new Set()); };
  const moveAllToAvailable = () => { setAvailable(a => [...a, ...visible]); setVisible([]); setSelVisible(new Set()); };

  const reorder = (dir: -1 | 1) => {
    if (selVisible.size !== 1) return;
    const key = Array.from(selVisible)[0];
    const idx = visible.findIndex(c => c.key === key);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= visible.length) return;
    const next = [...visible];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    setVisible(next);
  };

  const listBoxStyle: React.CSSProperties = {
    border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, height: '280px',
    overflowY: 'auto', background: C.bgNested,
  };
  const itemStyle = (selected: boolean): React.CSSProperties => ({
    padding: '4px 8px', fontSize: '13px', cursor: 'pointer',
    background: selected ? C.brandDim : 'transparent', color: C.textPrimary,
  });

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.bgCard, borderRadius: RADIUS.lg, padding: '20px', width: '660px', maxWidth: '94vw', boxShadow: '0 20px 48px rgba(0,0,0,.25)', fontFamily: FONT }}>
        <div style={{ fontSize: '15px', fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '14px', textAlign: 'right' }}>בחירת עמודות</div>
        <div style={{ display: 'flex', gap: '10px', direction: 'ltr' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', color: C.textMuted, marginBottom: '4px' }}>Available Columns:</div>
            <div style={listBoxStyle}>
              {available.map(c => (
                <div key={c.key} onClick={() => toggle(selAvailable, c.key, setSelAvailable)} style={itemStyle(selAvailable.has(c.key))}>
                  {c.label}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6px' }}>
            <button onClick={moveToVisible} style={columnMoveBtnStyle}>&gt;</button>
            <button onClick={moveAllToVisible} style={columnMoveBtnStyle}>&gt;&gt;</button>
            <button onClick={moveToAvailable} style={columnMoveBtnStyle}>&lt;</button>
            <button onClick={moveAllToAvailable} style={columnMoveBtnStyle}>&lt;&lt;</button>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '12px', color: C.textMuted }}>Visible Columns:</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button onClick={() => reorder(-1)} style={{ ...columnMoveBtnStyle, padding: '2px 8px' }}>↑</button>
                <button onClick={() => reorder(1)} style={{ ...columnMoveBtnStyle, padding: '2px 8px' }}>↓</button>
              </div>
            </div>
            <div style={listBoxStyle}>
              {visible.map(c => (
                <div key={c.key} onClick={() => toggle(selVisible, c.key, setSelVisible)} style={itemStyle(selVisible.has(c.key))}>
                  {c.label}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button onClick={onClose} style={{ padding: '8px 20px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontFamily: FONT }}>ביטול</button>
          <button onClick={() => onApply(visible.map(c => c.key))} style={{ padding: '8px 20px', background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontWeight: WEIGHT.semibold, fontFamily: FONT }}>אישור</button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  token: string;
  versionId: string;
  screen: string;
  filter: string;
  value?: string;
  title: string;
  onClose: () => void;
}

const SEVERITY_COLOR: Record<string, string> = {
  'Show Stopper': C.danger, Severe: C.danger, Medium: '#D97706', Low: C.textMuted,
};

// Local — matches this file's existing "duplicate small helpers rather than a
// shared refactor" convention (see SEVERITY_COLOR/STATUS_COLOR). Soft pill
// badge: the field's own colour as text over a 14%-alpha wash of it.
function hexTint(hex: string, alpha = 0.14): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return C.bgNested;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
function SoftBadge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      fontSize: '12px', fontWeight: WEIGHT.semibold, color, background: hexTint(color),
      borderRadius: '999px', padding: '2px 10px', display: 'inline-block', whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  );
}

// Per-column display widths — Title has none (absorbs the slack under auto
// table-layout); everything else is compact and nowrap so the 6 default
// columns fit a desktop modal with no horizontal scroll (UX spec 2026-09-06).
const COL_WIDTH: Partial<Record<ColumnKey, string>> = {
  id: '78px', severity: '104px', status: '116px', priority: '96px', reopenYn: '96px',
  assignedTo: '164px', reporter: '164px', discoveryDate: '112px', responsibility: '150px',
};

// Same mapping as OpenProdDefectsView.tsx's STATUS_COLOR (kept as a separate
// local copy, matching this file's existing SEVERITY_COLOR duplication
// pattern rather than a shared-module refactor) — colored-background badge
// for the status column, matching the defect-detail screen (spec confirmed
// 2026-09-03).
const STATUS_COLOR: Record<string, string> = {
  New: C.statusOpen, Open: C.statusOpen,
  Pending: C.statusInProgress, 'At Work': C.statusInProgress,
  Fixed_Dev: C.warning, Fixed_Test: C.success, Fixed: C.success, Closed: C.success,
  Reopen: C.danger, Rejected: C.textMuted, Canceled: C.textMuted,
};
const DEFAULT_STATUS_COLOR = C.textMuted;

// Person fields resolve to an avatar; team/queue fields get the flat NameBadge.
// `assignedTo` = BG_RESPONSIBLE is a TEAM/queue name in this QC instance
// ("HOT Design Team"…), not a person — user-confirmed 2026-09-07; kept in sync
// with OpenProdDefectsView.tsx's identical sets.
const PERSON_BADGE_FIELDS = new Set<ColumnKey>(['reporter']);
const TEAM_BADGE_FIELDS = new Set<ColumnKey>(['assignedTo', 'responsibility']);
// Fixed-vocabulary/status-like columns — centered rather than L/R-aligned by
// language, since they're short enum values, not prose (spec confirmed
// 2026-09-03).
const STATUS_LIKE_FIELDS = new Set<ColumnKey>(['severity', 'status', 'priority', 'reopenYn']);
function renderCellValue(key: ColumnKey, value: unknown, severity: string) {
  const s = String(value ?? '');
  if (!s) return '—';
  if (PERSON_BADGE_FIELDS.has(key)) return <PersonAvatar name={s} full />;
  if (TEAM_BADGE_FIELDS.has(key)) return <NameBadge name={s} />;
  // Subtle text identifier, not a filled blue block (UX spec 2026-09-06).
  if (key === 'id') return <span style={{ color: C.brand, fontWeight: WEIGHT.semibold, direction: 'ltr' }}>#{s}</span>;
  if (key === 'status') return <SoftBadge text={s} color={STATUS_COLOR[s] ?? DEFAULT_STATUS_COLOR} />;
  if (key === 'severity') return <SoftBadge text={s} color={SEVERITY_COLOR[severity] ?? C.textSecondary} />;
  return s;
}

// Shared drill-down for every defect-count card/bar across the release-
// intelligence module (spec confirmed 2026-08-29) — one modal, fed by
// /release-intelligence/defects-drilldown, which re-derives the exact same
// filter each screen's aggregate already computes so the list can never
// disagree with the number that was clicked. Sortable + column-configurable
// (spec confirmed 2026-08-29, mid-build) — column set/order persists per
// browser via localStorage, same convention as IncidentsView's import-column
// picker; sort state is session-only (not worth persisting — the filter/list
// changes every time this opens).
export const DefectDrilldownModal: React.FC<Props> = ({ token, versionId, screen, filter, value, title, onClose }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [defects, setDefects] = useState<Defect[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: ColumnKey; dir: 'asc' | 'desc' } | null>(null);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [columns, setColumns] = useState<ColumnKey[]>(() => {
    try {
      const saved = localStorage.getItem(COLUMNS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore malformed storage */ }
    return DEFAULT_COLUMNS;
  });
  const applyColumns = (keys: ColumnKey[]) => {
    setColumns(keys);
    try { localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(keys)); } catch { /* ignore quota errors */ }
    setShowColumnPicker(false);
  };

  // Same full-detail screen "תקלות ייצור פתוחות" already opens per defect ID
  // — reused as-is (spec confirmed 2026-08-29) rather than a second copy, so
  // it reads the same admin-configured field set from the same config
  // endpoint everywhere it's opened.
  const [selectedDefectId, setSelectedDefectId] = useState<string | null>(null);
  const [detailFields, setDetailFields] = useState<string[]>([]);
  useEffect(() => {
    axios.get(`${API}/qc/open-prod-defects-config`, { headers })
      .then(r => setDetailFields(r.data?.detailFields ?? []))
      .catch(() => setDetailFields([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    axios.get(`${API}/release-intelligence/defects-drilldown/${versionId}`, { headers, params: { screen, filter, value } })
      .then(res => setDefects(res.data ?? []))
      .catch(e => setError(e?.response?.data?.message || e.message || 'שגיאה בטעינת התקלות'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, screen, filter, value, token]);

  const filters = useColumnFilters(defects as any, columns);
  const [q, setQ] = useState('');
  const [hoverRow, setHoverRow] = useState<string | null>(null);

  const sorted = useMemo(() => {
    if (!defects) return defects;
    const needle = q.trim().toLowerCase();
    const filtered = defects.filter(d =>
      filters.matches(d as any) &&
      (!needle || `${d.id} ${d.title} ${d.assignedTo} ${d.reporter} ${d.responsibility}`.toLowerCase().includes(needle)),
    );
    if (!sort) return filtered;
    const { key, dir } = sort;
    return [...filtered].sort((a, b) => {
      const av = String(a[key] ?? ''); const bv = String(b[key] ?? '');
      const cmp = av.localeCompare(bv, 'he');
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [defects, sort, filters.matches, q]);

  const toggleSort = (key: ColumnKey) => {
    setSort(prev => prev?.key === key ? (prev.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' });
  };

  // Must map over `columns` itself (the user's persisted, reorderable
  // order), not filter the fixed ALL_COLUMNS master list — filtering only
  // preserves ALL_COLUMNS' own declaration order, so no reorder the picker
  // makes ever has any visible effect (found 2026-09-03: whichever column
  // sits last in ALL_COLUMNS, e.g. "notes", could never be moved out of the
  // last position no matter how many times the user reordered it).
  const visibleColumns = columns
    .map(key => ALL_COLUMNS.find(c => c.key === key))
    .filter((c): c is { key: ColumnKey; label: string } => !!c);

  if (selectedDefectId) {
    // DefectDetailScreen has no fixed positioning of its own — in
    // OpenProdDefectsView it reads as full-page only because it's the sole
    // thing rendered there. Mounted as a conditional child inside one of
    // this module's screens instead, it rendered as a normal block sibling
    // and the origin screen's own content (KPI cards etc.) stayed visible
    // around it — reading exactly like "went back" instead of drilling in
    // (bug reported 2026-08-29). Same fixed-overlay wrapper as the list view
    // below fixes it.
    return (
      <div style={{ position: 'fixed', inset: 0, background: C.bgApp, zIndex: 1001, overflow: 'auto' }}>
        <DefectDetailScreen
          defectId={selectedDefectId}
          detailFields={detailFields}
          token={token}
          onBack={() => setSelectedDefectId(null)}
        />
      </div>
    );
  }

  // Full-page, not a centered modal — matches the existing drill-in
  // convention in this module (IncidentsView's import-candidates screen /
  // CategoryBreakdownView: fixed inset:0, solid bg, "→ חזרה" back button),
  // not a dialog-with-backdrop (feedback 2026-08-29: a modal read as
  // inconsistent with how the rest of the module already opens sub-screens).
  return (
    <div style={{ position: 'fixed', inset: 0, background: C.bgApp, zIndex: 1001, display: 'flex', flexDirection: 'column', fontFamily: FONT, direction: 'rtl' }}>
      <div style={{ background: C.bgCard, borderBottom: `1px solid ${C.border}`, padding: `${SP[3]} ${SP[5]}`, display: 'flex', alignItems: 'center', gap: SP[3], flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', padding: '6px 12px', color: C.textSecondary, fontFamily: FONT, ...TEXT.sm }}>
          → חזרה
        </button>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary, flex: 1 }}>🪲 {title}</div>
        <button
          onClick={() => setShowColumnPicker(true)}
          style={{ padding: '6px 14px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold }}
        >
          ⚙ בחירת עמודות
        </button>
      </div>

      {/* ── סרגל סינון מאוחד — מחוץ למבנה הטבלה (UX spec 2026-09-06) ── */}
      <div style={{ background: C.bgCard, borderBottom: `1px solid ${C.border}`, padding: `10px ${SP[5]}`, display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', flexShrink: 0 }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="חיפוש חופשי (כותרת, מזהה, אחראי, מדווח)…"
          style={{
            flex: '1 1 280px', minWidth: 0, boxSizing: 'border-box', fontSize: '13px', padding: '6px 10px',
            border: `1px solid ${C.border}`, borderRadius: RADIUS.md, fontFamily: FONT, color: C.textPrimary, background: C.bgApp,
          }}
        />
        {visibleColumns.filter(c => c.key !== 'title' && filters.isEnum(c.key)).map(c => (
          <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <span style={{ fontSize: '12px', color: C.textMuted, whiteSpace: 'nowrap' }}>{c.label}</span>
            <div style={{ minWidth: '96px' }}>
              <EnumFilterButton
                label={c.label}
                options={filters.distinctValues(c.key)}
                selected={filters.enumSelected(c.key)}
                onToggle={v => filters.toggleEnumValue(c.key, v)}
              />
            </div>
          </div>
        ))}
        {(q || visibleColumns.some(c => filters.enumSelected(c.key).size > 0)) && (
          <button
            onClick={() => { setQ(''); visibleColumns.forEach(c => filters.enumSelected(c.key).forEach(v => filters.toggleEnumValue(c.key, v))); }}
            style={{ fontSize: '12px', padding: '5px 10px', background: 'none', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: 'pointer', color: C.textSecondary, fontFamily: FONT, flexShrink: 0 }}
          >
            נקה סינון
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: SP[5] }}>
          {loading ? (
            <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[6] }}>טוען...</div>
          ) : error ? (
            <div style={{ ...TEXT.sm, color: C.danger, textAlign: 'center', padding: SP[6] }}>⚠️ {error}</div>
          ) : !sorted || sorted.length === 0 ? (
            <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[6] }}>אין תקלות ברשימה זו</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto', ...TEXT.sm }}>
              <thead>
                <tr style={{ background: C.bgNested }}>
                  {visibleColumns.map(c => (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      style={{
                        padding: '10px', textAlign: 'right', fontWeight: WEIGHT.semibold, color: C.textSecondary,
                        borderBottom: `1px solid ${C.border}`, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none',
                        width: COL_WIDTH[c.key], minWidth: c.key === 'title' ? '300px' : undefined,
                      }}
                    >
                      {c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(d => (
                  <tr
                    key={d.id}
                    onClick={() => setSelectedDefectId(d.id)}
                    onMouseEnter={() => setHoverRow(d.id)}
                    onMouseLeave={() => setHoverRow(r => (r === d.id ? null : r))}
                    style={{ cursor: 'pointer', background: hoverRow === d.id ? C.bgNested : undefined }}
                  >
                    {visibleColumns.map(c => {
                      const isBadge = PERSON_BADGE_FIELDS.has(c.key) || TEAM_BADGE_FIELDS.has(c.key);
                      const isCentered = STATUS_LIKE_FIELDS.has(c.key) || c.key === 'id';
                      const isTitle = c.key === 'title';
                      const raw = String(d[c.key] ?? '');
                      const rtl = isBadge || isCentered ? false : hasHebrew(raw);
                      return (
                        <td
                          key={c.key}
                          title={isTitle ? raw : undefined}
                          style={{
                            padding: '12px 10px', borderBottom: `1px solid ${C.border}`, fontFamily: FONT,
                            width: COL_WIDTH[c.key], minWidth: isTitle ? '300px' : undefined,
                            // Title wraps (2-line clamp + native tooltip for the rest);
                            // every other column stays a single compact line.
                            ...(isTitle
                              ? { whiteSpace: 'normal', wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4 }
                              : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
                            color: isBadge || c.key === 'severity' || c.key === 'id' ? undefined : (isTitle ? C.textPrimary : C.textSecondary),
                            fontWeight: isTitle ? WEIGHT.semibold : WEIGHT.normal,
                            direction: isCentered ? undefined : (rtl ? 'rtl' : 'ltr'),
                            textAlign: isCentered ? 'center' : (rtl ? 'right' : 'left'),
                          }}
                        >
                          {renderCellValue(c.key, d[c.key], d.severity)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      <div style={{ padding: `${SP[3]} ${SP[5]}`, borderTop: `1px solid ${C.border}`, ...TEXT.xs, color: C.textMuted, textAlign: 'left', flexShrink: 0 }}>
        {defects ? `${defects.length} תקלות` : ''}
      </div>

      {showColumnPicker && (
        <SelectColumnsDialog visibleKeys={columns} onApply={applyColumns} onClose={() => setShowColumnPicker(false)} />
      )}
    </div>
  );
};
