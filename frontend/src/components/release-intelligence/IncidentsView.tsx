import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { RcaWizardModal } from './RcaWizardModal';
import { DefectIdBadge } from '../shared/defectFieldDisplay';
import { DefectDrilldownModal } from './DefectDrilldownModal';
import { BackLink } from '../ui';
import { useDialog } from '../../context/DialogContext';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

export interface IncidentRow {
  canRemove?: boolean;   // no investigation work yet - may be removed (server-computed)
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


interface Metrics {
  total: number; closed: number; open: number; recurrenceRate: number;
  timeToRcaHoursAvg: number | null; actionsOnTimePct: number | null;
  openActionsCount: number; overdueActionsCount: number;
}

const SEVERITY_DOT_CLASS: Record<string, string> = { LOW: 'bg-success', MEDIUM: 'bg-warning', HIGH: 'bg-danger', CRITICAL: 'bg-danger' };
const STATUS_LABEL: Record<string, string> = { NEW: 'חדש', ANALYZING: 'בניתוח', RCA_DONE: 'RCA הושלם', CLOSED: 'סגור' };
const STATUS_BADGE_CLASS: Record<string, string> = {
  NEW: 'text-subtle-foreground bg-muted',
  ANALYZING: 'text-warning bg-warning-bg',
  RCA_DONE: 'text-info bg-info-bg',
  CLOSED: 'text-success bg-success-bg',
};

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

function MetricTile({ label, value, accentClass }: { label: string; value: string | number; accentClass?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3 flex-[1_1_140px] min-w-[140px]">
      <div className={`text-xl font-bold ${accentClass ?? 'text-foreground'}`}>{value}</div>
      <div className="text-xs text-subtle-foreground mt-[3px]">{label}</div>
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
    <div className="fixed inset-0 bg-background z-[1001] flex flex-col">
      <div className="bg-card border-b border-border px-5 py-3 flex items-center gap-3 shrink-0">
        <BackLink onClick={onClose} />
        <div className="text-lg font-bold text-foreground flex-1">📊 פילוח לפי קטגוריית גורם שורש</div>
        <div className="flex gap-1 bg-muted rounded-md p-[3px]">
          {(['all', 'version'] as const).map(s => (
            <button
              key={s} onClick={() => setScope(s)}
              className={`px-3 py-[5px] rounded-sm border-none cursor-pointer text-xs font-bold ${scope === s ? 'bg-primary text-white' : 'bg-transparent text-muted-foreground'}`}
            >
              {s === 'all' ? 'כל הגרסאות' : 'הגרסה הנוכחית'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5">
        {loading ? (
          <div className="text-sm text-subtle-foreground text-center p-6">טוען...</div>
        ) : !data || data.categories.length === 0 ? (
          <div className="text-sm text-subtle-foreground text-center p-6">אין עדיין תקלות עם RCA שכולל סיווג קטגוריית גורם שורש{scope === 'version' ? ' בגרסה זו' : ''}.</div>
        ) : (
          <div className="max-w-[900px] mx-auto flex flex-col gap-2">
            <div className="text-xs text-subtle-foreground mb-2">{data.total} תקלות עם RCA מסווג · {data.categories.length} קטגוריות</div>
            {data.categories.map((row, i) => {
              const color = CATEGORY_BAR_COLORS[i % CATEGORY_BAR_COLORS.length];
              const isOpen = expanded.has(row.category);
              return (
                <div key={row.category} className="bg-card border border-border rounded-lg overflow-hidden">
                  <div onClick={() => toggle(row.category)} className="flex items-center gap-3 px-4 py-3 cursor-pointer">
                    <span className="text-xs text-subtle-foreground w-3.5">{isOpen ? '▾' : '▸'}</span>
                    <span className="text-sm font-bold text-foreground min-w-[140px]">{row.category}</span>
                    <div className="flex-1 h-[18px] bg-muted rounded-sm overflow-hidden">
                      <div className="h-full rounded-sm transition-[width] duration-standard ease-out" style={{ width: `${maxCount ? (row.count / maxCount) * 100 : 0}%`, background: color }} />
                    </div>
                    <span className="text-sm font-bold text-foreground min-w-[70px] text-left">{row.count} ({row.pct}%)</span>
                  </div>
                  {isOpen && (
                    <div className="border-t border-border flex flex-col">
                      {row.incidents.map(inc => (
                        <div
                          key={inc.id} onClick={() => onOpenIncident(inc.id)}
                          className="flex items-center gap-3 py-2 ps-10 pe-4 cursor-pointer border-t border-border"
                        >
                          <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${inc.severity ? SEVERITY_DOT_CLASS[inc.severity] : 'bg-subtle-foreground'}`} />
                          <span className="min-w-[56px]"><DefectIdBadge id={inc.qcDefectId} /></span>
                          <span className="text-sm text-foreground flex-1">{inc.title}</span>
                          {inc.rootCauseReason && <span className="text-xs text-muted-foreground bg-muted rounded-sm px-2 py-0.5">{inc.rootCauseReason}</span>}
                          {scope === 'all' && <span className="text-xs text-subtle-foreground min-w-[90px]">{inc.versionName}</span>}
                          <span className="text-xs text-subtle-foreground">{BREAKDOWN_RCA_STATUS_LABEL[inc.rcaStatus] ?? inc.rcaStatus}</span>
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
  const dialog = useDialog();
  const headers = { Authorization: `Bearer ${token}` };
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
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
  };

  const doImport = async () => {
    if (!versionId || !selectedCandidates.length) return;
    setImporting(true);
    try {
      await axios.post(`${API}/incidents/golive/${versionId}/import`, { qcIds: selectedCandidates }, { headers });
      setShowImport(false);
      load();
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message || 'שגיאה בייבוא', 'שגיאה', 'danger');
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
      <div className="text-sm text-subtle-foreground p-6 text-center">
        יש לבחור גרסה כדי להציג את תקלות ה-Go-Live שלה.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="text-lg font-bold text-foreground">🧯 תקלות ו-RCA — Go-Live</div>
        <div className="flex gap-2">
          <button onClick={() => setShowBreakdown(true)} className="px-3.5 py-2 bg-muted text-muted-foreground border border-border rounded-md cursor-pointer text-sm">
            📊 פילוח לפי קטגוריית גורם שורש
          </button>
          <button onClick={doSuggestGroups} className="px-3.5 py-2 bg-muted text-muted-foreground border border-border rounded-md cursor-pointer text-sm">
            🔗 הצע קיבוץ תקלות דומות
          </button>
          <button onClick={openImport} className="px-3.5 py-2 bg-primary text-white border-none rounded-md cursor-pointer text-sm font-bold">
            ⬇ בחר תקלות לתחקור
          </button>
        </div>
      </div>

      {metrics && (
        <div className="flex gap-2 flex-wrap">
          <MetricTile label="סה״כ תקלות" value={metrics.total} />
          <MetricTile label="פתוחות" value={metrics.open} accentClass={metrics.open > 0 ? 'text-warning' : 'text-success'} />
          <MetricTile label="סגורות" value={metrics.closed} accentClass="text-success" />
          <MetricTile label="שיעור הישנות (מקובצות)" value={`${metrics.recurrenceRate}%`} />
          <MetricTile label="זמן ממוצע ל-RCA (שעות)" value={metrics.timeToRcaHoursAvg ?? '—'} />
          <MetricTile label="פעולות שהושלמו בזמן" value={metrics.actionsOnTimePct != null ? `${metrics.actionsOnTimePct}%` : '—'} />
          <MetricTile label="פעולות באיחור" value={metrics.overdueActionsCount} accentClass={metrics.overdueActionsCount > 0 ? 'text-danger' : undefined} />
        </div>
      )}

      {suggestedGroups && (
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-sm font-semibold text-muted-foreground mb-2">הצעות קיבוץ (היוריסטי — לפי גורם שורש משותף, רק לתקלות שהושלם עבורן תחקיר)</div>
          {suggestedGroups.length === 0 ? (
            <div className="text-xs text-subtle-foreground">לא נמצאו תקלות עם גורם שורש דומה לקיבוץ (קיבוץ מתבצע רק לאחר השלמת תחקיר).</div>
          ) : suggestedGroups.map((g, i) => (
            <div key={i} className={`flex justify-between items-center py-1.5 ${i > 0 ? 'border-t border-border' : ''}`}>
              <div className="text-xs text-muted-foreground">{g.reason} · {g.incidentIds.length} תקלות</div>
              <button onClick={() => createGroup(g)} className="px-2.5 py-1 bg-primary-50 text-primary border-none rounded-sm cursor-pointer text-xs font-bold">
                צור קבוצה
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="text-sm text-subtle-foreground p-6 text-center">טוען...</div>
        ) : incidents.length === 0 ? (
          <div className="text-sm text-subtle-foreground p-6 text-center">אין תקלות לגרסה זו. בחרו תקלות לתחקור כדי להתחיל.</div>
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
                className={`flex flex-col gap-1 px-3.5 py-2.5 cursor-pointer ${i > 0 ? 'border-t border-border' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${inc.severity ? SEVERITY_DOT_CLASS[inc.severity] : 'bg-subtle-foreground'}`} />
                  <span className="min-w-[60px]"><DefectIdBadge id={inc.qcDefectId} /></span>
                  <span className="text-sm font-semibold text-foreground flex-1">{inc.title}</span>
                  {inc.defectType && <span className="text-xs text-muted-foreground bg-muted rounded-sm px-2 py-0.5">{inc.defectType}</span>}
                  {inc.group && <span className="text-xs text-primary bg-primary-50 rounded-full px-2 py-0.5">🔗 {inc.group.reason}</span>}
                  <span className={`text-xs font-bold rounded-full px-2.5 py-[3px] ${STATUS_BADGE_CLASS[inc.status]}`}>
                    {STATUS_LABEL[inc.status]}
                  </span>
                  {/* remove a defect picked by mistake - only before any
                      investigation work (server enforces too, 2026-10-05) */}
                  {inc.canRemove && ['ADMIN', 'RELEASE_MANAGER', 'TEAM_LEAD'].includes(role) && (
                    <button
                      type="button"
                      title="הסר מרשימת התחקור (לא בוצע בה תחקיר)"
                      onClick={async e => {
                        e.stopPropagation();
                        if (!await dialog.confirm(`להסיר את תקלה ${inc.qcDefectId} מרשימת התחקור?`, 'הסרה מרשימת התחקור', 'danger')) return;
                        try {
                          await axios.delete(`${API}/incidents/${inc.id}`, { headers });
                          load();
                        } catch (err: any) {
                          dialog.alert(err?.response?.data?.message || 'ההסרה נכשלה', 'שגיאה', 'danger');
                        }
                      }}
                      className="cursor-pointer rounded-sm border border-border bg-card px-1.5 py-0.5 text-xs text-muted-foreground hover:border-danger hover:text-danger"
                    >🗑</button>
                  )}
                </div>
                <div className="flex items-center gap-3 pe-5 text-xs text-subtle-foreground flex-wrap">
                  {facts.length > 0 ? facts.map((f, fi) => <span key={fi}>{f}</span>) : <span className="italic">אין פרטי השפעה עסקית — למלא בזמן התחקיר</span>}
                  <span className="ms-auto">{inc.evidence.length} ראיות · {inc.actions.length} פעולות</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Same defect list every other module opens (DefectDrilldownModal —
          columns, picker, sort, filters, row click into the defect), plus
          selection (user ask 2026-10-03). Fetches the not-yet-imported Go-Live
          defects itself via `endpoint`. */}
      {showImport && versionId && (
        <DefectDrilldownModal
          token={token}
          screen=""
          filter=""
          endpoint={`${API}/incidents/golive/${versionId}/import-preview`}
          title="בחר תקלות לתחקור"
          onClose={() => setShowImport(false)}
          selection={{
            selectedIds: selectedCandidates,
            onChange: setSelectedCandidates,
            actionLabel: importing ? 'מייבא' : 'ייבא לתחקור',
            onConfirm: doImport,
            busy: importing,
          }}
        />
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
