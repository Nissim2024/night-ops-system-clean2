import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';
import { RcaWizardModal } from './RcaWizardModal';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

export interface IncidentRow {
  id: string;
  qcDefectId: string;
  title: string;
  description: string | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  status: 'NEW' | 'ANALYZING' | 'RCA_DONE' | 'CLOSED';
  defectType: string | null;
  mainModule: string | null;
  subModule: string | null;
  systemComponent: string | null;
  impact: string | null;
  affectedUsersCount: number | null;
  customerFacing: boolean | null;
  downtimeMinutes: number | null;
  groupId: string | null;
  createdAt: string;
  evidence: { id: string; type: string }[];
  rca: { id: string; method: string; rootCause: string | null } | null;
  actions: { id: string; status: string; team: string }[];
  group: { id: string; reason: string } | null;
}

// Mirrors backend TargetDefectDto (qc.service.ts) 1:1 — getGoLiveIncidents
// returns the same full real BUG-table field set TARGET's defects screen
// does (just filtered to Production-phase instead of targeted-at-release),
// so the import picker can show the same breadth of real fields instead of
// a narrow hand-picked subset (2026-08-09, explicit product decision after
// the user compared this screen to VersionOverview.tsx's TARGET-defects table).
interface ImportCandidate {
  qcDefectId: string; title: string; status: string; severity: string;
  system: string; crReferenceNumber: string; assignedTo: string;
  subject: string; summary: string; description: string; notes: string; reproducible: string;
  priority: string; detectedBy: string; detectedOnDate: string; estimatedFixTime: string;
  actualFixTime: string; environment: string; responsibility: string; testPhase: string;
  defectType: string; closedBy: string; deploymentReason: string; fixedUntil: string;
  crHbrNumberReference: string; vendorStatus: string; responseDate: string;
  supportReferenceNumber: string; subModule: string; fixedInProd: string; mainModule: string;
  reason: string; supportStatus: string; vendorAssignTo: string; category: string;
  itemType: string; estimateFixTime: string; platform: string; modified: string;
  detectedInRelease: string; detectedInCycle: string; targetRelease: string; targetCycle: string;
  crStatus: string; dropNumber: string; reopenYn: string; influence: string; fixType: string;
  qaTester: string; secondaryPriority: string; releaseDefect: string; businessProcess: string;
  foundByAutomation: string; mainBusinessProcess: string; impact: string; productionReason: string;
  environmentComponent: string; willBeTestAtGoLive: string; deploymentCategory: string;
  defectResponsible: string; targetReleaseReason: string; targetType: string;
  systemComponent: string; forRegressionTest: string; escDefectResponsible: string;
  toBeTestedOnProd: string; deploymentDateProd: string; targetScopeApproved: string;
}

// Column catalog for the import-candidates picker's "Select Columns" dialog —
// same two-listbox pattern (and same English labels, matching the reference
// ALM/QC "Select Columns" dialog) as VersionOverview.tsx's TARGET-defect
// picker (SelectColumnsDialog/TARGET_DEFECT_COLUMNS there), duplicated here
// rather than shared since it's typed to a different row shape (qcDefectId
// vs id).
const IMPORT_CANDIDATE_COLUMNS: { key: keyof ImportCandidate; label: string }[] = [
  { key: 'qcDefectId', label: 'Defect ID' },
  { key: 'assignedTo', label: 'Assigned To' },
  { key: 'qaTester', label: 'QA' },
  { key: 'crReferenceNumber', label: 'CR Reference Number' },
  { key: 'system', label: 'Project' },
  { key: 'subject', label: 'Subject' },
  { key: 'summary', label: 'Summary' },
  { key: 'description', label: 'Description' },
  { key: 'notes', label: 'Comments' },
  { key: 'reproducible', label: 'Reproducible Y/N' },
  { key: 'status', label: 'Bug Status' },
  { key: 'severity', label: 'Severity' },
  { key: 'priority', label: 'Priority' },
  { key: 'detectedBy', label: 'Detected By' },
  { key: 'detectedOnDate', label: 'Detected on Date' },
  { key: 'estimatedFixTime', label: 'Estimated Fix Time' },
  { key: 'actualFixTime', label: 'Fix Time' },
  { key: 'environment', label: 'Environment' },
  { key: 'responsibility', label: 'Responsibility' },
  { key: 'testPhase', label: 'Test Phase' },
  { key: 'defectType', label: 'Bug Type' },
  { key: 'closedBy', label: 'Closed By' },
  { key: 'deploymentReason', label: 'Deployment Reason' },
  { key: 'fixedUntil', label: 'Fixed Until' },
  { key: 'crHbrNumberReference', label: 'CR/HBR Number reference' },
  { key: 'vendorStatus', label: 'Vendor Status' },
  { key: 'responseDate', label: 'Response Date' },
  { key: 'supportReferenceNumber', label: 'Support Reference Number' },
  { key: 'subModule', label: 'Sub Module' },
  { key: 'fixedInProd', label: 'Fixed in Prod' },
  { key: 'mainModule', label: 'Main Module' },
  { key: 'reason', label: 'Reason' },
  { key: 'supportStatus', label: 'Support Status' },
  { key: 'vendorAssignTo', label: 'Assign To (Vendor)' },
  { key: 'category', label: 'Category' },
  { key: 'itemType', label: 'Item Type' },
  { key: 'estimateFixTime', label: 'Estimate Fix Time' },
  { key: 'platform', label: 'Platform' },
  { key: 'modified', label: 'Modified' },
  { key: 'detectedInRelease', label: 'Detected in Release' },
  { key: 'detectedInCycle', label: 'Detected in Cycle' },
  { key: 'targetRelease', label: 'Target Release' },
  { key: 'targetCycle', label: 'Target Cycle' },
  { key: 'crStatus', label: 'CR Status' },
  { key: 'dropNumber', label: 'Drop#' },
  { key: 'reopenYn', label: 'Reopen Y/N' },
  { key: 'influence', label: 'Influence' },
  { key: 'fixType', label: 'Fix Type' },
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

// Same default set as VersionOverview.tsx's DEFAULT_TARGET_DEFECT_COLUMNS
// (just id → qcDefectId) — matches the look the user asked for verbatim.
const DEFAULT_IMPORT_CANDIDATE_COLUMNS: (keyof ImportCandidate)[] = [
  'qcDefectId', 'detectedOnDate', 'severity', 'detectedBy', 'assignedTo', 'qaTester',
  'status', 'summary', 'responsibility', 'crHbrNumberReference', 'environment',
  'subModule', 'willBeTestAtGoLive', 'secondaryPriority', 'targetScopeApproved',
  'fixType', 'detectedInRelease', 'targetRelease', 'crReferenceNumber',
  'forRegressionTest', 'dropNumber', 'testPhase',
];
const IMPORT_CANDIDATE_COLUMNS_STORAGE_KEY = 'deploycenter_incident_import_columns_v2';

const columnMoveBtnStyle: React.CSSProperties = {
  padding: '4px 10px', background: C.bgNested, color: C.textPrimary,
  border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: 'pointer',
  fontSize: '13px', fontFamily: FONT, minWidth: '36px',
};

// "Select Columns" picker — mirrors VersionOverview.tsx's SelectColumnsDialog
// (same reference ALM/QC "Select Columns" dialog UX), retyped for ImportCandidate.
function SelectColumnsDialog({
  allColumns, visibleKeys, onApply, onClose,
}: {
  allColumns: { key: keyof ImportCandidate; label: string }[];
  visibleKeys: (keyof ImportCandidate)[];
  onApply: (keys: (keyof ImportCandidate)[]) => void;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(
    visibleKeys.map(k => allColumns.find(c => c.key === k)).filter((c): c is { key: keyof ImportCandidate; label: string } => !!c)
  );
  const [available, setAvailable] = useState(allColumns.filter(c => !visibleKeys.includes(c.key)));
  const [selAvailable, setSelAvailable] = useState<Set<keyof ImportCandidate>>(new Set());
  const [selVisible, setSelVisible] = useState<Set<keyof ImportCandidate>>(new Set());

  const toggle = (set: Set<keyof ImportCandidate>, key: keyof ImportCandidate, setFn: (s: Set<keyof ImportCandidate>) => void) => {
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
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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

interface Metrics {
  total: number; closed: number; open: number; recurrenceRate: number;
  timeToRcaHoursAvg: number | null; actionsOnTimePct: number | null;
  openActionsCount: number; overdueActionsCount: number;
}

const SEVERITY_COLOR: Record<string, string> = { LOW: C.success, MEDIUM: C.warning, HIGH: C.danger, CRITICAL: C.danger };
const STATUS_LABEL: Record<string, string> = { NEW: 'חדש', ANALYZING: 'בניתוח', RCA_DONE: 'RCA הושלם', CLOSED: 'סגור' };
const STATUS_COLOR: Record<string, string> = { NEW: C.textMuted, ANALYZING: C.warning, RCA_DONE: C.info, CLOSED: C.success };

// "פילוח לפי קטגוריית גורם שורש" — Root Cause Category rollup (see
// incidents.service.ts's getCategoryBreakdown). Cross-version by default —
// the BI-over-time view from the Deployment_Lessons_Learned.pptx reference
// deck's slide 2, built from real Rca.category data instead of a manually
// compiled report.
interface CategoryBreakdownIncident {
  id: string; qcDefectId: string; title: string; severity: string | null;
  versionName: string; rootCauseReason: string | null; rcaStatus: string;
}
interface CategoryBreakdownRow { category: string; count: number; pct: number; incidents: CategoryBreakdownIncident[]; }
interface CategoryBreakdown { total: number; categories: CategoryBreakdownRow[]; }
// Same categorical palette as VersionOverview.tsx's treemap (CATEGORY_COLORS)
// — kept in sync so a given root-cause category reads with a consistent hue
// across screens — extended to 12 colors since the real taxonomy has 12
// categories (root-cause-taxonomy.ts) vs. the treemap's 8-slice cap.
const CATEGORY_BAR_COLORS = ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948', '#0f9b8e', '#8e44ad', '#c2185b', '#5d4037'];

function MetricTile({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '12px 16px', flex: '1 1 140px', minWidth: '140px' }}>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: accent ?? C.textPrimary }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
    </div>
  );
}

const BREAKDOWN_RCA_STATUS_LABEL: Record<string, string> = { OPEN: 'פתוח', INVESTIGATION: 'בתחקור', COMPLETED: 'הושלם', CANCELLED: 'בוטל' };

// Root Cause Category rollup — see getCategoryBreakdown's comment. Full-screen
// with back button, same convention as the import-candidates picker.
const CategoryBreakdownView: React.FC<{
  scope: 'version' | 'all'; setScope: (s: 'version' | 'all') => void;
  data: CategoryBreakdown | null; loading: boolean;
  onClose: () => void; onOpenIncident: (id: string) => void;
}> = ({ scope, setScope, data, loading, onClose, onOpenIncident }) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (cat: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    return next;
  });
  const maxCount = data?.categories[0]?.count ?? 0;

  return (
    <div style={{ position: 'fixed', inset: 0, background: C.bgApp, zIndex: 1001, display: 'flex', flexDirection: 'column', fontFamily: FONT, direction: 'rtl' }}>
      <div style={{ background: C.bgCard, borderBottom: `1px solid ${C.border}`, padding: `${SP[3]} ${SP[5]}`, display: 'flex', alignItems: 'center', gap: SP[3], flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', padding: '6px 12px', color: C.textSecondary, fontFamily: FONT, ...TEXT.sm }}>
          → חזרה
        </button>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary, flex: 1 }}>📊 פילוח לפי קטגוריית גורם שורש</div>
        <div style={{ display: 'flex', gap: '4px', background: C.bgNested, borderRadius: RADIUS.md, padding: '3px' }}>
          {(['all', 'version'] as const).map(s => (
            <button
              key={s} onClick={() => setScope(s)}
              style={{ padding: '5px 12px', borderRadius: RADIUS.sm, border: 'none', cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.bold, background: scope === s ? C.brand : 'transparent', color: scope === s ? 'white' : C.textSecondary }}
            >
              {s === 'all' ? 'כל הגרסאות' : 'הגרסה הנוכחית'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: SP[5] }}>
        {loading ? (
          <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[6] }}>טוען...</div>
        ) : !data || data.categories.length === 0 ? (
          <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[6] }}>אין עדיין תקלות עם RCA שכולל סיווג קטגוריית גורם שורש{scope === 'version' ? ' בגרסה זו' : ''}.</div>
        ) : (
          <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: SP[2] }}>
            <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: SP[2] }}>{data.total} תקלות עם RCA מסווג · {data.categories.length} קטגוריות</div>
            {data.categories.map((row, i) => {
              const color = CATEGORY_BAR_COLORS[i % CATEGORY_BAR_COLORS.length];
              const isOpen = expanded.has(row.category);
              return (
                <div key={row.category} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflow: 'hidden' }}>
                  <div onClick={() => toggle(row.category)} style={{ display: 'flex', alignItems: 'center', gap: SP[3], padding: '12px 16px', cursor: 'pointer' }}>
                    <span style={{ ...TEXT.xs, color: C.textMuted, width: '14px' }}>{isOpen ? '▾' : '▸'}</span>
                    <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, minWidth: '140px' }}>{row.category}</span>
                    <div style={{ flex: 1, height: '18px', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden' }}>
                      <div style={{ width: `${maxCount ? (row.count / maxCount) * 100 : 0}%`, height: '100%', background: color, borderRadius: RADIUS.sm, transition: 'width 0.3s' }} />
                    </div>
                    <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, minWidth: '70px', textAlign: 'left' }}>{row.count} ({row.pct}%)</span>
                  </div>
                  {isOpen && (
                    <div style={{ borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column' }}>
                      {row.incidents.map(inc => (
                        <div
                          key={inc.id} onClick={() => onOpenIncident(inc.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: SP[3], padding: '8px 16px 8px 40px', cursor: 'pointer', borderTop: `1px solid ${C.border}` }}
                        >
                          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: inc.severity ? SEVERITY_COLOR[inc.severity] : C.textMuted, flexShrink: 0 }} />
                          <span style={{ ...TEXT.xs, color: C.textMuted, minWidth: '56px' }}>#{inc.qcDefectId}</span>
                          <span style={{ ...TEXT.sm, color: C.textPrimary, flex: 1 }}>{inc.title}</span>
                          {inc.rootCauseReason && <span style={{ ...TEXT.xs, color: C.textSecondary, background: C.bgNested, borderRadius: RADIUS.sm, padding: '2px 8px' }}>{inc.rootCauseReason}</span>}
                          {scope === 'all' && <span style={{ ...TEXT.xs, color: C.textMuted, minWidth: '90px' }}>{inc.versionName}</span>}
                          <span style={{ ...TEXT.xs, color: C.textMuted }}>{BREAKDOWN_RCA_STATUS_LABEL[inc.rcaStatus] ?? inc.rcaStatus}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

interface Props { token: string; versionId?: string; role: string; }

export const IncidentsView: React.FC<Props> = ({ token, versionId, role }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importColumns, setImportColumns] = useState<(keyof ImportCandidate)[]>(() => {
    try {
      const saved = localStorage.getItem(IMPORT_CANDIDATE_COLUMNS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore malformed storage */ }
    return DEFAULT_IMPORT_CANDIDATE_COLUMNS;
  });
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const applyImportColumns = (keys: (keyof ImportCandidate)[]) => {
    setImportColumns(keys);
    localStorage.setItem(IMPORT_CANDIDATE_COLUMNS_STORAGE_KEY, JSON.stringify(keys));
    setShowColumnPicker(false);
  };
  const [suggestedGroups, setSuggestedGroups] = useState<{ reason: string; incidentIds: string[] }[] | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [breakdownScope, setBreakdownScope] = useState<'version' | 'all'>('all');
  const [breakdown, setBreakdown] = useState<CategoryBreakdown | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  const load = useCallback(() => {
    if (!versionId) return;
    setLoading(true);
    Promise.all([
      axios.get(`${API}/incidents/golive/${versionId}`, { headers }),
      axios.get(`${API}/incidents/golive/${versionId}/metrics`, { headers }),
    ]).then(([incRes, metRes]) => { setIncidents(incRes.data); setMetrics(metRes.data); })
      .catch(() => { setIncidents([]); setMetrics(null); })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);

  useEffect(() => { load(); }, [load]);

  const loadBreakdown = useCallback(() => {
    setBreakdownLoading(true);
    const params = breakdownScope === 'version' && versionId ? { versionId } : {};
    axios.get(`${API}/incidents/category-breakdown`, { headers, params })
      .then(r => setBreakdown(r.data))
      .catch(() => setBreakdown(null))
      .finally(() => setBreakdownLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakdownScope, versionId, token]);

  useEffect(() => { if (showBreakdown) loadBreakdown(); }, [showBreakdown, loadBreakdown]);

  const openImport = () => {
    if (!versionId) return;
    setShowImport(true);
    setSelectedCandidates([]);
    axios.get(`${API}/incidents/golive/${versionId}/import-preview`, { headers })
      .then(r => setCandidates(r.data))
      .catch(() => setCandidates([]));
  };

  const doImport = async () => {
    if (!versionId || !selectedCandidates.length) return;
    setImporting(true);
    try {
      await axios.post(`${API}/incidents/golive/${versionId}/import`, { qcIds: selectedCandidates }, { headers });
      setShowImport(false);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.message || 'שגיאה בייבוא');
    }
    setImporting(false);
  };

  const doSuggestGroups = () => {
    if (!versionId) return;
    axios.get(`${API}/incidents/golive/${versionId}/suggest-groups`, { headers })
      .then(r => setSuggestedGroups(r.data))
      .catch(() => setSuggestedGroups([]));
  };

  const createGroup = async (g: { reason: string; incidentIds: string[] }) => {
    if (!versionId) return;
    await axios.post(`${API}/incidents/golive/${versionId}/groups`, g, { headers });
    setSuggestedGroups(prev => (prev ?? []).filter(x => x !== g));
    load();
  };

  if (!versionId) {
    return (
      <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>
        יש לבחור גרסה כדי להציג את תקלות ה-Go-Live שלה.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: SP[2] }}>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🧯 תקלות ו-RCA — Go-Live</div>
        <div style={{ display: 'flex', gap: SP[2] }}>
          <button onClick={() => setShowBreakdown(true)} style={{ padding: '8px 14px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontFamily: FONT, ...TEXT.sm }}>
            📊 פילוח לפי קטגוריית גורם שורש
          </button>
          <button onClick={doSuggestGroups} style={{ padding: '8px 14px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontFamily: FONT, ...TEXT.sm }}>
            🔗 הצע קיבוץ תקלות דומות
          </button>
          <button onClick={openImport} style={{ padding: '8px 14px', background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.bold }}>
            ⬇ בחר תקלות לתחקור
          </button>
        </div>
      </div>

      {metrics && (
        <div style={{ display: 'flex', gap: SP[2], flexWrap: 'wrap' }}>
          <MetricTile label="סה״כ תקלות" value={metrics.total} />
          <MetricTile label="פתוחות" value={metrics.open} accent={metrics.open > 0 ? C.warning : C.success} />
          <MetricTile label="סגורות" value={metrics.closed} accent={C.success} />
          <MetricTile label="שיעור הישנות (מקובצות)" value={`${metrics.recurrenceRate}%`} />
          <MetricTile label="זמן ממוצע ל-RCA (שעות)" value={metrics.timeToRcaHoursAvg ?? '—'} />
          <MetricTile label="פעולות שהושלמו בזמן" value={metrics.actionsOnTimePct != null ? `${metrics.actionsOnTimePct}%` : '—'} />
          <MetricTile label="פעולות באיחור" value={metrics.overdueActionsCount} accent={metrics.overdueActionsCount > 0 ? C.danger : undefined} />
        </div>
      )}

      {suggestedGroups && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[3] }}>
          <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textSecondary, marginBottom: SP[2] }}>הצעות קיבוץ (היוריסטי — לפי גורם שורש משותף, רק לתקלות שהושלם עבורן תחקיר)</div>
          {suggestedGroups.length === 0 ? (
            <div style={{ ...TEXT.xs, color: C.textMuted }}>לא נמצאו תקלות עם גורם שורש דומה לקיבוץ (קיבוץ מתבצע רק לאחר השלמת תחקיר).</div>
          ) : suggestedGroups.map((g, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: i > 0 ? `1px solid ${C.border}` : 'none' }}>
              <div style={{ ...TEXT.xs, color: C.textSecondary }}>{g.reason} · {g.incidentIds.length} תקלות</div>
              <button onClick={() => createGroup(g)} style={{ padding: '4px 10px', background: C.brandDim, color: C.brand, border: 'none', borderRadius: RADIUS.sm, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.bold }}>
                צור קבוצה
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>טוען...</div>
        ) : incidents.length === 0 ? (
          <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>אין תקלות לגרסה זו. בחרו תקלות לתחקור כדי להתחיל.</div>
        ) : (
          incidents.map((inc, i) => {
            const component = [inc.mainModule, inc.subModule || inc.systemComponent].filter(Boolean).join(' / ');
            const facts: string[] = [];
            if (component) facts.push(`רכיב חשוד: ${component}`);
            if (inc.impact) facts.push(`השפעה עסקית: ${inc.impact}`);
            if (inc.affectedUsersCount != null) facts.push(`${inc.affectedUsersCount} משתמשים מושפעים`);
            if (inc.customerFacing != null) facts.push(inc.customerFacing ? '📢 משפיע על לקוחות' : 'לא משפיע על לקוחות');
            if (inc.downtimeMinutes != null) facts.push(`${inc.downtimeMinutes} דק' אי-זמינות`);

            return (
              <div
                key={inc.id}
                onClick={() => setSelectedIncidentId(inc.id)}
                style={{
                  display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px 14px', cursor: 'pointer',
                  borderTop: i > 0 ? `1px solid ${C.border}` : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: SP[3] }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: inc.severity ? SEVERITY_COLOR[inc.severity] : C.textMuted, flexShrink: 0 }} />
                  <span style={{ ...TEXT.xs, color: C.textMuted, minWidth: '60px' }}>#{inc.qcDefectId}</span>
                  <span style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, flex: 1 }}>{inc.title}</span>
                  {inc.defectType && <span style={{ ...TEXT.xs, color: C.textSecondary, background: C.bgNested, borderRadius: RADIUS.sm, padding: '2px 8px' }}>{inc.defectType}</span>}
                  {inc.group && <span style={{ ...TEXT.xs, color: C.brand, background: C.brandDim, borderRadius: RADIUS.full, padding: '2px 8px' }}>🔗 {inc.group.reason}</span>}
                  <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: STATUS_COLOR[inc.status], background: `${STATUS_COLOR[inc.status]}22`, borderRadius: RADIUS.full, padding: '3px 10px' }}>
                    {STATUS_LABEL[inc.status]}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: SP[3], paddingRight: '20px', ...TEXT.xs, color: C.textMuted, flexWrap: 'wrap' }}>
                  {facts.length > 0 ? facts.map((f, fi) => <span key={fi}>{f}</span>) : <span style={{ fontStyle: 'italic' }}>אין פרטי השפעה עסקית — למלא בזמן התחקיר</span>}
                  <span style={{ marginRight: 'auto' }}>{inc.evidence.length} ראיות · {inc.actions.length} פעולות</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showImport && (
        <div style={{ position: 'fixed', inset: 0, background: C.bgApp, zIndex: 1001, display: 'flex', flexDirection: 'column', fontFamily: FONT, direction: 'rtl' }}>
          <div style={{ background: C.bgCard, borderBottom: `1px solid ${C.border}`, padding: `${SP[3]} ${SP[5]}`, display: 'flex', alignItems: 'center', gap: SP[3], flexShrink: 0 }}>
            <button onClick={() => setShowImport(false)} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', padding: '6px 12px', color: C.textSecondary, fontFamily: FONT, ...TEXT.sm }}>
              → חזרה
            </button>
            <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary, flex: 1 }}>בחר תקלות לתחקור</div>
            <button
              onClick={() => setShowColumnPicker(true)}
              style={{ padding: '6px 14px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontFamily: FONT, ...TEXT.sm }}
            >
              ⚙ בחירת עמודות
            </button>
            <button onClick={() => setShowImport(false)} style={{ padding: '8px 16px', background: 'none', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', color: C.textMuted, fontFamily: FONT, ...TEXT.sm }}>
              ביטול
            </button>
            <button
              onClick={doImport}
              disabled={!selectedCandidates.length || importing}
              style={{ padding: '8px 20px', background: !selectedCandidates.length ? C.textDisabled : C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: !selectedCandidates.length ? 'not-allowed' : 'pointer', fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.bold }}
            >
              {importing ? 'מייבא...' : `ייבא (${selectedCandidates.length})`}
            </button>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: SP[4] }}>
            {candidates.length === 0 ? (
              <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[6] }}>אין תקלות חדשות לייבוא (כולן כבר יובאו, או שאין תקלות ב-QC לגרסה זו).</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', ...TEXT.sm }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'right', padding: '8px 10px', width: '30px', position: 'sticky', top: 0, background: C.bgApp }} />
                    {importColumns.map(key => (
                      <th
                        key={key}
                        style={{
                          textAlign: 'right', padding: '8px 10px', color: C.textMuted, fontWeight: WEIGHT.bold,
                          borderBottom: `2px solid ${C.border}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: C.bgApp,
                        }}
                      >
                        {IMPORT_CANDIDATE_COLUMNS.find(c => c.key === key)?.label ?? key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {candidates.map(c => {
                    const checked = selectedCandidates.includes(c.qcDefectId);
                    const toggle = () => setSelectedCandidates(prev => prev.includes(c.qcDefectId) ? prev.filter(x => x !== c.qcDefectId) : [...prev, c.qcDefectId]);
                    return (
                      <tr key={c.qcDefectId} onClick={toggle} style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer', background: checked ? C.brandDim : 'transparent' }}>
                        <td style={{ padding: '7px 10px' }} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={checked} onChange={toggle} />
                        </td>
                        {importColumns.map(key => (
                          <td key={key} style={{ padding: '7px 10px', color: C.textSecondary, whiteSpace: 'nowrap', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right' }}>
                            {String(c[key] ?? '') || '—'}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {showColumnPicker && (
            <SelectColumnsDialog
              allColumns={IMPORT_CANDIDATE_COLUMNS}
              visibleKeys={importColumns}
              onApply={applyImportColumns}
              onClose={() => setShowColumnPicker(false)}
            />
          )}
        </div>
      )}

      {showBreakdown && (
        <CategoryBreakdownView
          scope={breakdownScope} setScope={setBreakdownScope}
          data={breakdown} loading={breakdownLoading}
          onClose={() => setShowBreakdown(false)}
          onOpenIncident={(id) => { setShowBreakdown(false); setSelectedIncidentId(id); }}
        />
      )}

      {selectedIncidentId && (
        <RcaWizardModal
          token={token}
          role={role}
          incidentId={selectedIncidentId}
          onClose={() => setSelectedIncidentId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
};
