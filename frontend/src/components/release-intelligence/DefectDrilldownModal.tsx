import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { JIRA } from '../../theme';
import { DefectDetailScreen } from '../quality-hub/OpenProdDefectsView';
import {
  hasHebrew, PersonAvatar, NameBadge, useColumnWidths, ColumnResizeHandle, useColumnFilters, ColumnFilterRow,
  IssueKeyLink, StatusBadge, SeverityBadge, PriorityCell, SelectColumnsDialog,
} from '../shared/defectFieldDisplay';
import { BackLink } from '../ui';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Field set mirrors backend DefectDto (qc.service.ts) 1:1 — extended
// 2026-09-14 to bring this screen's column-picker breadth and label
// language (English, matching the reference ALM/QC "Select Columns" dialog)
// in line with VersionOverview's TARGET-defect screen; both ultimately read
// the same BUG table (feedback: "כל התקלות שדווחו" had far fewer columns,
// in Hebrew, even though the underlying data is the same).
interface Defect {
  id: string; title: string; severity: string; status: string; assignedTo: string; discoveryDate: string;
  priority: string; reporter: string; environment: string; testPhase: string; defectType: string;
  system: string; responsibility: string; crHbrNumberReference: string; crReferenceNumber: string;
  fixType: string; reason: string; reopenYn: string; description: string; notes: string; targetRelease: string;
  subject: string; qaTester: string; estimatedFixTime: string; actualFixTime: string; closedBy: string;
  deploymentReason: string; fixedUntil: string; vendorStatus: string; responseDate: string;
  supportReferenceNumber: string; subModule: string; fixedInProd: string; mainModule: string;
  supportStatus: string; vendorAssignTo: string; category: string; itemType: string; estimateFixTime: string;
  platform: string; modified: string; detectedInRelease: string; detectedInCycle: string; targetCycle: string;
  crStatus: string; dropNumber: string; influence: string; secondaryPriority: string; releaseDefect: string;
  businessProcess: string; foundByAutomation: string; mainBusinessProcess: string; impact: string;
  productionReason: string; environmentComponent: string; willBeTestAtGoLive: string; deploymentCategory: string;
  defectResponsible: string; targetReleaseReason: string; targetType: string; systemComponent: string;
  forRegressionTest: string; escDefectResponsible: string; toBeTestedOnProd: string; deploymentDateProd: string;
  targetScopeApproved: string;
}

type ColumnKey = keyof Defect;
const ALL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'id', label: 'Defect ID' },
  { key: 'title', label: 'Title' },
  { key: 'subject', label: 'Subject' },
  { key: 'severity', label: 'Severity' },
  { key: 'status', label: 'Bug Status' },
  { key: 'assignedTo', label: 'Assigned To' },
  { key: 'qaTester', label: 'Tester' },
  { key: 'discoveryDate', label: 'Detected on Date' },
  { key: 'priority', label: 'Priority' },
  { key: 'reporter', label: 'Detected By' },
  { key: 'environment', label: 'Environment' },
  { key: 'testPhase', label: 'Test Phase' },
  { key: 'defectType', label: 'Bug Type' },
  { key: 'system', label: 'Project' },
  { key: 'responsibility', label: 'Responsibility' },
  { key: 'crHbrNumberReference', label: 'CR/HBR Number reference' },
  { key: 'crReferenceNumber', label: 'CR Reference Number' },
  { key: 'fixType', label: 'Fix Type' },
  { key: 'reason', label: 'Reason' },
  { key: 'reopenYn', label: 'Reopen Y/N' },
  { key: 'description', label: 'Description' },
  { key: 'notes', label: 'Comments' },
  { key: 'targetRelease', label: 'Target Release' },
  { key: 'estimatedFixTime', label: 'Estimated Fix Time' },
  { key: 'actualFixTime', label: 'Fix Time' },
  { key: 'closedBy', label: 'Closed By' },
  { key: 'deploymentReason', label: 'Deployment Reason' },
  { key: 'fixedUntil', label: 'Fixed Until' },
  { key: 'vendorStatus', label: 'Vendor Status' },
  { key: 'responseDate', label: 'Response Date' },
  { key: 'supportReferenceNumber', label: 'Support Reference Number' },
  { key: 'subModule', label: 'Sub Module' },
  { key: 'fixedInProd', label: 'Fixed in Prod' },
  { key: 'mainModule', label: 'Main Module' },
  { key: 'supportStatus', label: 'Support Status' },
  { key: 'vendorAssignTo', label: 'Assign To (Vendor)' },
  { key: 'category', label: 'Category' },
  { key: 'itemType', label: 'Item Type' },
  { key: 'estimateFixTime', label: 'Estimate Fix Time' },
  { key: 'platform', label: 'Platform' },
  { key: 'modified', label: 'Modified' },
  { key: 'detectedInRelease', label: 'Detected in Release' },
  { key: 'detectedInCycle', label: 'Detected in Cycle' },
  { key: 'targetCycle', label: 'Target Cycle' },
  { key: 'crStatus', label: 'CR Status' },
  { key: 'dropNumber', label: 'Drop#' },
  { key: 'influence', label: 'Influence' },
  { key: 'secondaryPriority', label: 'Secondary Priority' },
  { key: 'releaseDefect', label: 'Release Defect' },
  { key: 'businessProcess', label: 'Business Process' },
  { key: 'foundByAutomation', label: 'Found By Automation' },
  { key: 'mainBusinessProcess', label: 'Main Business Process' },
  { key: 'impact', label: 'Impact' },
  { key: 'productionReason', label: 'Production Reason' },
  { key: 'environmentComponent', label: 'Environment Component' },
  { key: 'willBeTestAtGoLive', label: 'Will Be Test At Go Live' },
  { key: 'deploymentCategory', label: 'Deployment Category' },
  { key: 'defectResponsible', label: 'Defect Responsible' },
  { key: 'targetReleaseReason', label: 'Target Release Reason' },
  { key: 'targetType', label: 'Target Type' },
  { key: 'systemComponent', label: 'System Component' },
  { key: 'forRegressionTest', label: 'For Regression Test' },
  { key: 'escDefectResponsible', label: 'Esc Defect Responsible' },
  { key: 'toBeTestedOnProd', label: 'To Be Tested On Prod' },
  { key: 'deploymentDateProd', label: 'Deployment Date (Prod)' },
  { key: 'targetScopeApproved', label: 'Target Scope Approved' },
];
const DEFAULT_COLUMNS: ColumnKey[] = ['id', 'title', 'severity', 'status', 'assignedTo', 'discoveryDate'];
const COLUMNS_STORAGE_KEY = 'deploycenter_defect_drilldown_columns_v1';


interface Props {
  token: string;
  versionId: string;
  screen: string;
  filter: string;
  value?: string;
  title: string;
  onClose: () => void;
}

// Column widths are user-resizable (see useColumnWidths below) — Title is
// the one exception, kept flexible/wrapping rather than a fixed resizable
// width (UX spec 2026-09-06).
const COLUMN_WIDTHS_STORAGE_KEY = 'deploycenter_defect_drilldown_column_widths_v1';
const DEFAULT_COLUMN_WIDTH = 130;

// Person fields resolve to an avatar; team/queue fields get the flat NameBadge.
// `assignedTo`/BG_RESPONSIBLE was treated as team/queue here (user-confirmed
// 2026-09-07) — reversed 2026-09-18, user confirmed it does hold a person's
// name after seeing real resolved values live; kept in sync with
// OpenProdDefectsView.tsx's identical sets.
const PERSON_BADGE_FIELDS = new Set<ColumnKey>(['reporter', 'assignedTo', 'qaTester', 'closedBy', 'defectResponsible', 'escDefectResponsible', 'vendorAssignTo']);
const TEAM_BADGE_FIELDS = new Set<ColumnKey>(['responsibility']);
// Fixed-vocabulary/status-like columns — centered rather than L/R-aligned by
// language, since they're short enum values, not prose (spec confirmed
// 2026-09-03).
const STATUS_LIKE_FIELDS = new Set<ColumnKey>(['severity', 'status', 'priority', 'reopenYn']);
// Jira-style cell rendering, shared with every other defect table in the app
// (VersionOverview's TARGET list, OpenProdDefectsView, KpiDetailView) via
// shared/defectFieldDisplay — one consistent look everywhere (feedback
// 2026-09-10: "אני רוצה שתעצב את כל טבלאות התקלות לפי ההנחיות" [Jira]).
function renderCellValue(key: ColumnKey, value: unknown) {
  const s = String(value ?? '');
  if (!s) return key === 'priority' ? <PriorityCell value="" /> : '—';
  if (PERSON_BADGE_FIELDS.has(key)) return <PersonAvatar name={s} full />;
  if (TEAM_BADGE_FIELDS.has(key)) return <NameBadge name={s} />;
  if (key === 'id') return <IssueKeyLink id={s} />;
  if (key === 'status') return <StatusBadge status={s} />;
  if (key === 'severity') return <SeverityBadge severity={s} />;
  if (key === 'priority') return <PriorityCell value={s} />;
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
  const { getWidth: getColWidth, startResize } = useColumnWidths(COLUMN_WIDTHS_STORAGE_KEY, DEFAULT_COLUMN_WIDTH);
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
  const [hoverRow, setHoverRow] = useState<string | null>(null);

  const sorted = useMemo(() => {
    if (!defects) return defects;
    const filtered = defects.filter(d => filters.matches(d as any));
    if (!sort) return filtered;
    const { key, dir } = sort;
    return [...filtered].sort((a, b) => {
      const av = String(a[key] ?? ''); const bv = String(b[key] ?? '');
      const cmp = av.localeCompare(bv, 'he');
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [defects, sort, filters.matches]);

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
      <div className="fixed inset-0 z-[1001] overflow-auto bg-background">
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
    <div dir="rtl" className="fixed inset-0 z-[1001] flex flex-col bg-background font-sans">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border bg-card px-5 py-3">
        <BackLink onClick={onClose} />
        <div className="flex-1 text-lg font-bold text-foreground">🪲 {title}</div>
        <button
          onClick={() => setShowColumnPicker(true)}
          className="cursor-pointer rounded-md border border-border bg-muted px-3.5 py-1.5 font-sans text-xs font-semibold text-muted-foreground"
        >
          ⚙ בחירת עמודות
        </button>
      </div>

      {/* Table sits on its own white card surface over the page's grey
          background (bg-background on the outer shell) — Jira's "card & panel
          surfaces" convention (feedback 2026-09-10), matching how the
          TARGET-defect list and OpenProdDefectsView already present theirs. */}
      <div className="flex-1 overflow-auto p-5">
          {loading ? (
            <div className="p-6 text-center text-sm text-subtle-foreground">טוען...</div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-danger">⚠️ {error}</div>
          ) : !sorted || sorted.length === 0 ? (
            <div className="p-6 text-center text-sm text-subtle-foreground">אין תקלות ברשימה זו</div>
          ) : (
            <div className="overflow-hidden rounded-lg bg-card" style={{ border: `1px solid ${JIRA.greyN40}` }}>
              <table className="w-full border-collapse text-[13px]" style={{ tableLayout: 'auto', color: JIRA.text }}>
                <thead>
                  <tr>
                    {visibleColumns.map(c => (
                      <th
                        key={c.key}
                        onClick={() => toggleSort(c.key)}
                        className="relative cursor-pointer select-none overflow-hidden text-ellipsis whitespace-nowrap px-2.5 py-2 text-end text-[11px] font-bold tracking-wide"
                        style={{
                          color: JIRA.textSubtle,
                          borderBottom: `2px solid ${JIRA.greyN40}`,
                          width: c.key === 'title' ? undefined : getColWidth(c.key), minWidth: c.key === 'title' ? '300px' : undefined,
                        }}
                      >
                        {c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        {c.key !== 'title' && <ColumnResizeHandle onMouseDown={e => startResize(c.key, e)} />}
                      </th>
                    ))}
                  </tr>
                  <ColumnFilterRow columns={visibleColumns} getWidth={getColWidth} filters={filters} />
                </thead>
                <tbody>
                  {sorted.map(d => (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedDefectId(d.id)}
                      onMouseEnter={() => setHoverRow(d.id)}
                      onMouseLeave={() => setHoverRow(r => (r === d.id ? null : r))}
                      className="cursor-pointer"
                      style={{ background: hoverRow === d.id ? JIRA.rowHover : undefined }}
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
                            className={isTitle ? 'font-semibold' : 'font-normal'}
                            style={{
                              padding: '8px 10px', borderBottom: `1px solid ${JIRA.greyN40}`,
                              width: isTitle ? undefined : getColWidth(c.key), minWidth: isTitle ? '300px' : undefined,
                              // Title wraps (2-line clamp + native tooltip for the rest);
                              // every other column stays a single compact line.
                              ...(isTitle
                                ? { whiteSpace: 'normal', wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4 }
                                : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
                              color: isBadge || c.key === 'severity' || c.key === 'id' || c.key === 'priority' ? undefined : JIRA.text,
                              direction: isCentered ? undefined : (rtl ? 'rtl' : 'ltr'),
                              textAlign: isCentered ? 'center' : (rtl ? 'right' : 'left'),
                            }}
                          >
                            {renderCellValue(c.key, d[c.key])}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      <div className="flex-shrink-0 border-t border-border px-5 py-3 text-start text-xs text-subtle-foreground">
        {defects ? `${defects.length} תקלות` : ''}
      </div>

      {showColumnPicker && (
        <SelectColumnsDialog allColumns={ALL_COLUMNS} visibleKeys={columns} onApply={applyColumns} onClose={() => setShowColumnPicker(false)} />
      )}
    </div>
  );
};
