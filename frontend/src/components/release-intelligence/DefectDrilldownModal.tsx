import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { JIRA } from '../../theme';
import { useAutoFitTable, WRAP_CLAMP_STYLE } from '../shared/useAutoFitTable';
import { DefectDetailScreen } from '../quality-hub/OpenProdDefectsView';
import {
  hasHebrew, PersonAvatar, NameBadge, useColumnWidths, ColumnResizeHandle, useColumnFilters, ColumnFilterRow,
  IssueKeyLink, StatusBadge, SeverityBadge, PriorityCell, SelectColumnsDialog, PERSON_FIELDS } from '../shared/defectFieldDisplay';
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
  crStatus: string; dropNumber: string; influence: string;
  detectedApkVersion: string; detectedHotAppApk: string; targetHotAppApk: string; secondaryPriority: string; releaseDefect: string;
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
  { key: 'detectedApkVersion', label: 'Detected At APK Version' },
  { key: 'detectedHotAppApk', label: 'Detected in HOT APP APK' },
  { key: 'targetHotAppApk', label: 'Target HOT APP APK' },
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
// Investigation-dashboard drill-downs (idList mode) have their own default set
// (spec 2026-10-06: ID, Summary, Severity, Status, Owner, Created, Last Update,
// Release, Team) and their own saved choice, so the other screens' lists keep theirs.
const INVESTIGATION_DEFAULT_COLUMNS: ColumnKey[] = ['id', 'title', 'severity', 'status', 'assignedTo', 'discoveryDate', 'modified', 'detectedInRelease', 'responsibility'];
const INVESTIGATION_COLUMNS_STORAGE_KEY = 'deploycenter_defect_drilldown_columns_investigation_v1';


interface Props {
  token: string;
  // versionId omitted (2026-09-23) → cross-version mode: fetches
  // /qc/all-defects-filtered (field=filter, value) instead of the per-version
  // /release-intelligence/defects-drilldown/:versionId endpoint. Added for
  // DefectsHubView's system-wide Defects module, which has no single version
  // to scope to — reuses this component (full column picker, sort, resize)
  // instead of a separate, poorer reimplementation (user feedback verbatim:
  // "למה לא להשתמש במשהו טוב?"). `screen` is meaningless in this mode and
  // ignored.
  versionId?: string;
  screen: string;
  filter: string;
  value?: string;
  // Full URL to fetch the defect list from directly, bypassing both the
  // versionId and cross-version paths above (2026-09-23, fixes-batch item J)
  // — for callers whose list doesn't come from either of those two
  // dispatchers, e.g. Quality Hub's /qc/defects-by-kpi (keyed by versionId
  // OR relId, not by release-intelligence's Version-only screen/filter/value
  // scheme). When set, `screen`/`filter`/`value` are not used for fetching —
  // kept as required/optional props unchanged so every existing caller needs
  // no changes; pass empty strings for them from an `endpoint`-mode caller.
  endpoint?: string;
  title: string;
  onClose: () => void;
  // Optional multi-select mode (2026-10-03, IncidentsView's "בחר תקלות
  // לתחקור"): the SAME list — columns, picker, sort, filters, row click into
  // the defect — plus a checkbox column and an action button. Absent → the
  // list behaves exactly as before.
  selection?: {
    selectedIds: string[];
    onChange: (ids: string[]) => void;
    actionLabel: string;
    onConfirm: () => void;
    busy?: boolean;
  };
  // Cross-version mode (no versionId / endpoint) is server-paged, newest
  // first (2026-10-05) - with the defects module's year / release filters
  // and an optional search (defect id or title text).
  crossVersion?: { years?: number[]; releases?: string[]; search?: string };
  // Investigation-dashboard mode (2026-10-06): the dashboard already knows the
  // exact defect ids behind the number that was clicked — page through them
  // (POST /qc/defects-by-ids, server re-checks the caller's scope).
  idList?: string[];
}

const PAGE_SIZE = 100;

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
const PERSON_BADGE_FIELDS: Set<string> = PERSON_FIELDS;
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
export const DefectDrilldownModal: React.FC<Props> = ({ token, versionId, screen, filter, value, endpoint, title, onClose, selection, crossVersion, idList }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [defects, setDefects] = useState<Defect[] | null>(null);
  const [loading, setLoading] = useState(true);
  const paged = !!idList || (!endpoint && !versionId);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState(crossVersion?.search ?? '');
  const [search, setSearch] = useState(crossVersion?.search ?? '');
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: ColumnKey; dir: 'asc' | 'desc' } | null>(null);
  const colWidthsApi = useColumnWidths(COLUMN_WIDTHS_STORAGE_KEY, DEFAULT_COLUMN_WIDTH);
  const { startResize, manualCount, resetAll: resetColWidths } = colWidthsApi;
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const columnsKey = idList ? INVESTIGATION_COLUMNS_STORAGE_KEY : COLUMNS_STORAGE_KEY;
  const [columns, setColumns] = useState<ColumnKey[]>(() => {
    try {
      const saved = localStorage.getItem(columnsKey);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore malformed storage */ }
    return idList ? INVESTIGATION_DEFAULT_COLUMNS : DEFAULT_COLUMNS;
  });
  const applyColumns = (keys: ColumnKey[]) => {
    setColumns(keys);
    try { localStorage.setItem(columnsKey, JSON.stringify(keys)); } catch { /* ignore quota errors */ }
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
    const request = idList
      ? axios.post(`${API}/qc/defects-by-ids`, { ids: idList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) }, { headers })
          .then(res => ({ data: { rows: res.data ?? [], total: idList.length } }))
      : endpoint
      ? axios.get(endpoint, { headers })
      : versionId
      ? axios.get(`${API}/release-intelligence/defects-drilldown/${versionId}`, { headers, params: { screen, filter, value } })
      : axios.get(`${API}/qc/all-defects-list`, { headers, params: {
          field: filter, value, page, pageSize: PAGE_SIZE, search: search || undefined,
          years: crossVersion?.years?.length ? crossVersion.years.join(',') : undefined,
          releases: crossVersion?.releases?.length ? crossVersion.releases.join(',') : undefined,
        } });
    request
      .then(res => {
        if (paged) { setDefects(res.data?.rows ?? []); setTotal(res.data?.total ?? 0); }
        else setDefects(res.data ?? []);
      })
      .catch(e => setError(e?.response?.data?.message || e.message || 'שגיאה בטעינת התקלות'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, versionId, screen, filter, value, token, page, search, crossVersion?.years?.join(','), crossVersion?.releases?.join(','), idList]);

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

  // Auto-fit to the card (2026-10-06) — shared with every defect table.
  const fit = useAutoFitTable({
    rows: sorted,
    columns: visibleColumns,
    getValue: (d, key) => d[key as ColumnKey],
    widths: colWidthsApi,
    extra: key => (PERSON_BADGE_FIELDS.has(key) ? 30 : TEAM_BADGE_FIELDS.has(key as ColumnKey) ? 20 : STATUS_LIKE_FIELDS.has(key as ColumnKey) ? 22 : key === 'id' ? 30 : 0),
    leadingWidth: selection ? 36 : 0,
  });
  const colWidth = fit.colWidth;

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
        {manualCount > 0 && (
          <button onClick={resetColWidths} title="בטל רוחבים שנקבעו ידנית והתאם את כל העמודות אוטומטית לרוחב המסך"
            className="cursor-pointer rounded-md border border-border bg-muted px-3.5 py-1.5 font-sans text-xs font-semibold text-muted-foreground">
            ↔ התאם רוחב
          </button>
        )}
        {selection && (
          <>
            <button onClick={onClose} className="cursor-pointer rounded-md border border-border bg-transparent px-4 py-1.5 font-sans text-xs text-subtle-foreground">
              ביטול
            </button>
            <button
              onClick={selection.onConfirm}
              disabled={selection.selectedIds.length === 0 || selection.busy}
              className={`rounded-md border-none px-5 py-1.5 font-sans text-xs font-bold text-white ${selection.selectedIds.length === 0 || selection.busy ? 'cursor-not-allowed bg-subtle-foreground' : 'cursor-pointer bg-primary'}`}
            >
              {selection.busy ? '⏳ ' : ''}{selection.actionLabel} ({selection.selectedIds.length})
            </button>
          </>
        )}
      </div>

      {/* Table sits on its own white card surface over the page's grey
          background (bg-background on the outer shell) — Jira's "card & panel
          surfaces" convention (feedback 2026-09-10), matching how the
          TARGET-defect list and OpenProdDefectsView already present theirs. */}
      {/* The table card itself is the scroll area (both axes) — it used to be
          overflow-hidden for its rounded corners, which silently CLIPPED every
          column past the screen width (user report 2026-10-06: "לא מופיעות כל
          העמודות שנבחרו"). Header row stays frozen while scrolling down. */}
      <div className="flex min-h-0 flex-1 flex-col p-5">
          {loading ? (
            <div className="p-6 text-center text-sm text-subtle-foreground">טוען...</div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-danger">⚠️ {error}</div>
          ) : !sorted || sorted.length === 0 ? (
            <div className="p-6 text-center text-sm text-subtle-foreground">אין תקלות ברשימה זו</div>
          ) : (
            <div ref={fit.boxRef} className="min-h-0 flex-1 overflow-auto rounded-lg bg-card" style={{ border: `1px solid ${JIRA.greyN40}` }}>
              <table className="border-collapse text-[13px]" style={{ ...fit.tableStyle, color: JIRA.text }}>
                <thead className="sticky top-0 z-[3] bg-card" style={{ boxShadow: `0 1px 0 ${JIRA.greyN40}` }}>
                  <tr>
                    {selection && (() => {
                      // Select-all acts on the rows currently shown (after column filters).
                      const shownIds = (sorted ?? []).map(d => d.id);
                      const allShown = shownIds.length > 0 && shownIds.every(id => selection.selectedIds.includes(id));
                      return (
                        <th className="w-9 px-2.5 py-2 text-center" style={{ borderBottom: `2px solid ${JIRA.greyN40}` }}>
                          <input
                            type="checkbox"
                            checked={allShown}
                            title={allShown ? 'בטל בחירה' : 'בחר הכל'}
                            onChange={() => selection.onChange(allShown
                              ? selection.selectedIds.filter(id => !shownIds.includes(id))
                              : Array.from(new Set([...selection.selectedIds, ...shownIds])))}
                          />
                        </th>
                      );
                    })()}
                    {visibleColumns.map(c => (
                      <th
                        key={c.key}
                        onClick={() => toggleSort(c.key)}
                        className="relative cursor-pointer select-none px-2.5 py-2 text-end text-[11px] font-bold tracking-wide whitespace-normal break-words align-bottom leading-tight"
                        style={{
                          color: JIRA.textSubtle,
                          borderBottom: `2px solid ${JIRA.greyN40}`,
                          width: colWidth(c.key),
                        }}
                      >
                        {c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        <ColumnResizeHandle onMouseDown={e => startResize(c.key, e, colWidth(c.key))} />
                      </th>
                    ))}
                  </tr>
                  <ColumnFilterRow columns={visibleColumns} getWidth={colWidth} filters={filters} leadingCell={!!selection} />
                </thead>
                <tbody>
                  {sorted.map(d => (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedDefectId(d.id)}
                      onMouseEnter={() => setHoverRow(d.id)}
                      onMouseLeave={() => setHoverRow(r => (r === d.id ? null : r))}
                      className="cursor-pointer"
                      style={{ background: selection?.selectedIds.includes(d.id) ? JIRA.blueBg : hoverRow === d.id ? JIRA.rowHover : undefined }}
                    >
                      {selection && (
                        <td className="w-9 px-2.5 text-center" style={{ borderBottom: `1px solid ${JIRA.greyN40}` }} onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selection.selectedIds.includes(d.id)}
                            onChange={() => selection.onChange(selection.selectedIds.includes(d.id)
                              ? selection.selectedIds.filter(id => id !== d.id)
                              : [...selection.selectedIds, d.id])}
                          />
                        </td>
                      )}
                      {visibleColumns.map(c => {
                        const isBadge = PERSON_BADGE_FIELDS.has(c.key) || TEAM_BADGE_FIELDS.has(c.key);
                        const isCentered = STATUS_LIKE_FIELDS.has(c.key) || c.key === 'id';
                        const isTitle = c.key === 'title';
                        const raw = String(d[c.key] ?? '');
                        const rtl = isBadge || isCentered ? false : hasHebrew(raw);
                        // Long free text wraps (up to 3 lines, full text on hover);
                        // short columns stay one compact line (auto-fit sizes them to fit).
                        const wraps = fit.wraps(c.key);
                        return (
                          <td
                            key={c.key}
                            title={wraps || isTitle ? raw : undefined}
                            className={isTitle ? 'font-semibold' : 'font-normal'}
                            style={{
                              padding: '8px 10px', borderBottom: `1px solid ${JIRA.greyN40}`,
                              width: colWidth(c.key), verticalAlign: 'top', lineHeight: 1.45,
                              ...(wraps ? {} : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
                              color: isBadge || c.key === 'severity' || c.key === 'id' || c.key === 'priority' ? undefined : JIRA.text,
                              direction: isCentered ? undefined : (rtl ? 'rtl' : 'ltr'),
                              textAlign: isCentered ? 'center' : (rtl ? 'right' : 'left'),
                            }}
                          >
                            {wraps ? (
                              <div style={WRAP_CLAMP_STYLE}>
                                {renderCellValue(c.key, d[c.key])}
                              </div>
                            ) : renderCellValue(c.key, d[c.key])}
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
        {paged ? (
          <div className="flex flex-wrap items-center gap-3">
            {!idList && <form onSubmit={e => { e.preventDefault(); setPage(1); setSearch(searchInput.trim()); }} className="flex items-center gap-1.5">
              <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="חיפוש: מספר תקלה או טקסט בכותרת"
                className="w-[240px] rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground" />
              <button type="submit" className="cursor-pointer rounded-md border border-border bg-card px-2 py-1 text-xs">🔍 חפש</button>
              {search && <button type="button" onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }} className="cursor-pointer border-none bg-transparent text-xs text-primary">נקה</button>}
            </form>}
            <span>
              {total === 0 ? '0 תקלות' : `מציג ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} מתוך ${total.toLocaleString()} תקלות${idList ? '' : ' · מהחדשה לישנה'}`}
            </span>
            <div className="flex items-center gap-1">
              <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}
                className="cursor-pointer rounded-md border border-border bg-card px-2 py-0.5 text-xs disabled:cursor-default disabled:opacity-40">› הקודם</button>
              <span className="px-1">עמוד {page} מתוך {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
              <button type="button" disabled={page * PAGE_SIZE >= total || loading} onClick={() => setPage(p => p + 1)}
                className="cursor-pointer rounded-md border border-border bg-card px-2 py-0.5 text-xs disabled:cursor-default disabled:opacity-40">הבא ‹</button>
            </div>
            <span className="text-[11px]">מיון וסינון בכותרות העמודות חלים על העמוד המוצג</span>
          </div>
        ) : (defects ? `${defects.length} תקלות` : '')}
        {selection && selection.selectedIds.length > 0 && ` · ${selection.selectedIds.length} נבחרו`}
      </div>

      {showColumnPicker && (
        <SelectColumnsDialog allColumns={ALL_COLUMNS} visibleKeys={columns} onApply={applyColumns} onClose={() => setShowColumnPicker(false)} />
      )}
    </div>
  );
};
