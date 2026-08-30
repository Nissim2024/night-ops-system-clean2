import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';
import { DefectDetailScreen } from '../quality-hub/OpenProdDefectsView';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Defect {
  id: string; title: string; severity: string; status: string; assignedTo: string; discoveryDate: string;
  priority: string; reporter: string; environment: string; testPhase: string; defectType: string;
  system: string; responsibility: string; crHbrNumberReference: string; fixType: string; reason: string;
  reopenYn: string; description: string; notes: string;
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
          <button onClick={onClose} style={{ padding: '8px 20px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontFamily: FONT }}>Cancel</button>
          <button onClick={() => onApply(visible.map(c => c.key))} style={{ padding: '8px 20px', background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontWeight: WEIGHT.semibold, fontFamily: FONT }}>OK</button>
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
  'Show Stopper': C.danger, Severe: C.danger, Medium: '#e8af00', Low: C.textMuted,
};

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

  const sorted = useMemo(() => {
    if (!defects || !sort) return defects;
    const { key, dir } = sort;
    return [...defects].sort((a, b) => {
      const av = String(a[key] ?? ''); const bv = String(b[key] ?? '');
      const cmp = av.localeCompare(bv, 'he');
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [defects, sort]);

  const toggleSort = (key: ColumnKey) => {
    setSort(prev => prev?.key === key ? (prev.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' });
  };

  const visibleColumns = ALL_COLUMNS.filter(c => columns.includes(c.key));

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
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary, flex: 1 }}>🐛 {title}</div>
        <button
          onClick={() => setShowColumnPicker(true)}
          style={{ padding: '6px 14px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold }}
        >
          ⚙ בחירת עמודות
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: SP[5] }}>
          {loading ? (
            <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[6] }}>טוען...</div>
          ) : error ? (
            <div style={{ ...TEXT.sm, color: C.danger, textAlign: 'center', padding: SP[6] }}>⚠️ {error}</div>
          ) : !sorted || sorted.length === 0 ? (
            <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[6] }}>אין תקלות ברשימה זו</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', ...TEXT.sm }}>
              <thead>
                <tr style={{ background: C.bgNested }}>
                  {visibleColumns.map(c => (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      style={{ padding: '8px 10px', textAlign: 'right', fontWeight: WEIGHT.semibold, color: C.textSecondary, borderBottom: `1px solid ${C.border}`, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}
                    >
                      {c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(d => (
                  <tr key={d.id} onClick={() => setSelectedDefectId(d.id)} style={{ cursor: 'pointer' }}>
                    {visibleColumns.map(c => (
                      <td
                        key={c.key}
                        style={{
                          padding: '7px 10px', borderBottom: `1px solid ${C.border}`, maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          color: c.key === 'id' ? C.textLink : c.key === 'severity' ? (SEVERITY_COLOR[d.severity] ?? C.textPrimary) : C.textSecondary,
                          fontWeight: c.key === 'id' || c.key === 'severity' ? WEIGHT.semibold : WEIGHT.normal,
                          fontFamily: c.key === 'id' ? 'monospace' : FONT,
                        }}
                      >
                        {String(d[c.key] ?? '') || '—'}
                      </td>
                    ))}
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
