import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, RADIUS } from '../../theme';
import { Card, Badge } from '../ui';
import { TABLE_COLUMN_FIELDS, TABLE_FIELD_LABEL, DETAIL_FIELDS, DETAIL_FIELD_LABEL } from './openProdDefectsFields';
import { hasHebrew, NameBadge, PersonAvatar, renderNotesField, DetailGroupsDialog, DetailGroup, FieldChangeHistorySection, useColumnWidths, ColumnResizeHandle, useColumnFilters, ColumnFilterRow } from '../shared/defectFieldDisplay';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// KPI 11 — "מצב תקלות ייצור פתוחות לאורך חודשים". Cross-release, all-history
// report (no version scoping) — matches the reference Power BI page, which
// filters by Responsibility/Status/Year/FixType/Type only, never by release.

interface OpenProdDefectMonthRow {
  monthDate: string;
  monthLabel: string;
  defectId: string;
  statusAtMonth: string;
  currentStatus: string;
  releaseId: string | null;
  severity: string | null;
  priority: string | null;
  responsibility: string | null;
  testPhase: string | null;
  detectedBy: string | null;
  detectedDate: string | null;
  reopenYn: string | null;
  area: string | null;
  bugType: string | null;
  fixType: string | null;
}

interface DefectStatusHistoryRow { status: string; changeTime: string; }

interface OpenProdDefectsConfig { tableColumns: string[]; detailFields: string[]; }

// Full ~50-field record — matches backend's TargetDefectDto (see
// qc.service.ts's DEFECT_BY_ID_SQL / mapRowToTargetDefect). Only the fields
// this screen actually renders are typed strictly; the rest come through as
// whatever DETAIL_FIELDS keys resolve to on the object.
interface DefectFullDetail { id: string; [key: string]: any; }

interface Props { token: string; }

// Person-owner fields render as an avatar (resolved name if a login happens
// to match a synced User.qcLogin, else the raw login degrades to a single
// letter + itself); `responsibility` is the team field and gets the flat
// color badge instead. Same convention as VersionOverview's TARGET-defect
// screen (spec confirmed 2026-08-30).
const PERSON_BADGE_FIELDS = new Set(['assignedTo', 'qaTester', 'detectedBy', 'closedBy', 'defectResponsible', 'escDefectResponsible', 'vendorAssignTo']);
const TEAM_BADGE_FIELDS = new Set(['responsibility']);

// title/description/notes always render in their own fixed spots (the big
// title line and the side-by-side text boxes) — never offered in the
// category picker.
const DETAIL_GROUPS_FIXED_FIELDS = new Set(['title', 'description', 'notes']);
const DETAIL_GROUPS_STORAGE_KEY = 'deploycenter_openprod_defect_detail_groups';

// Same 6-category layout as VersionOverview's TARGET-defect detail screen —
// DETAIL_FIELDS' key set overlaps almost entirely with TargetDefect's, so
// the same grouping logic (identification → detection → ownership → fix →
// target/release → business impact) applies here too (spec 2026-08-30).
const DEFAULT_OPEN_PROD_DETAIL_GROUPS: DetailGroup[] = [
  { title: 'זיהוי', fields: ['id', 'status', 'severity', 'priority', 'secondaryPriority', 'defectType', 'category', 'itemType'] },
  { title: 'גילוי', fields: ['detectedBy', 'detectedOnDate', 'detectedInRelease', 'detectedInCycle', 'reproducible', 'environment', 'environmentComponent', 'system', 'platform', 'subModule', 'mainModule', 'systemComponent'] },
  { title: 'אחריות', fields: ['assignedTo', 'qaTester', 'responsibility', 'defectResponsible', 'escDefectResponsible', 'vendorAssignTo', 'vendorStatus'] },
  { title: 'טיפול ותיקון', fields: ['fixType', 'estimatedFixTime', 'actualFixTime', 'estimateFixTime', 'fixedUntil', 'fixedInProd', 'closedBy', 'reopenYn', 'supportStatus', 'supportReferenceNumber', 'responseDate'] },
  { title: 'יעד וגרסה', fields: ['targetRelease', 'targetCycle', 'targetType', 'targetReleaseReason', 'targetScopeApproved', 'crStatus', 'crReferenceNumber', 'crHbrNumberReference', 'dropNumber', 'releaseDefect'] },
  { title: 'השפעה עסקית', fields: ['impact', 'influence', 'businessProcess', 'mainBusinessProcess', 'deploymentCategory', 'deploymentReason', 'productionReason', 'toBeTestedOnProd', 'deploymentDateProd', 'willBeTestAtGoLive', 'forRegressionTest', 'foundByAutomation', 'modified'] },
];

function renderFieldValue(key: string, value: unknown) {
  const s = value === null || value === undefined ? '' : String(value);
  if (!s) return '—';
  if (PERSON_BADGE_FIELDS.has(key)) return <PersonAvatar name={s} />;
  if (TEAM_BADGE_FIELDS.has(key)) return <NameBadge name={s} />;
  if (key === 'severity') return <span style={{ color: SEVERITY_COLOR[s] ?? C.textPrimary, fontWeight: WEIGHT.semibold }}>{s}</span>;
  return s;
}

// Full-screen drill-down for one defect — replaces the table view entirely
// (back button, same pattern as CycleProgressView's CycleDetailScreen)
// rather than an inline expand, per the explicit "מסך חדש" requirement.
// Renders whichever fields + order the admin configured (detailFields),
// falling back to every field with a value if the admin never configured one.
// Exported — also reused by release-intelligence/DefectDrilldownModal so
// every "click a defect ID, see full details" path in the app opens the same
// screen instead of a second, drifting copy (spec confirmed 2026-08-29).
export const DefectDetailScreen: React.FC<{
  defectId: string; detailFields: string[]; token: string; onBack: () => void;
}> = ({ defectId, detailFields, token, onBack }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [detail, setDetail] = useState<DefectFullDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);

  useEffect(() => {
    setDetail(null);
    setDetailLoading(true);
    axios.get(`${API}/qc/open-prod-defect-detail/${encodeURIComponent(defectId)}`, { headers })
      .then(r => setDetail(r.data ?? null))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defectId, token]);

  // The admin-configured field pool (AdminPanel's "עמודות תקלות ייצור" panel)
  // decides which fields are even available; the per-user category picker
  // below (independent, localStorage-persisted like VersionOverview's) only
  // decides how to show/group whichever of those are available — same
  // separation of concerns as the TARGET-defect screen's two independent
  // pickers (spec confirmed 2026-08-30).
  const fieldsToShow = detailFields.length > 0 ? detailFields : DETAIL_FIELDS.map(f => f.key);
  const titleShown = fieldsToShow.includes('title');
  const allColumns = useMemo(
    () => fieldsToShow.filter(k => !DETAIL_GROUPS_FIXED_FIELDS.has(k)).map(k => ({ key: k, label: DETAIL_FIELD_LABEL[k] ?? k })),
    [fieldsToShow],
  );
  const defaultGroups = useMemo(() => {
    const allowed = new Set(allColumns.map(c => c.key));
    return DEFAULT_OPEN_PROD_DETAIL_GROUPS
      .map(g => ({ ...g, fields: g.fields.filter(k => allowed.has(k)) }))
      .filter(g => g.fields.length > 0);
  }, [allColumns]);

  const [detailGroups, setDetailGroups] = useState<DetailGroup[]>(() => {
    try {
      const saved = localStorage.getItem(DETAIL_GROUPS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore malformed storage */ }
    return defaultGroups;
  });
  const [showGroupsPicker, setShowGroupsPicker] = useState(false);
  const applyDetailGroups = (groups: DetailGroup[]) => {
    setDetailGroups(groups);
    localStorage.setItem(DETAIL_GROUPS_STORAGE_KEY, JSON.stringify(groups));
    setShowGroupsPicker(false);
  };

  const showDescription = fieldsToShow.includes('description');
  const showNotes = fieldsToShow.includes('notes');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px 28px', fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={onBack}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', background: C.bgNested,
            color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer',
            fontSize: '13px', fontWeight: WEIGHT.semibold, padding: '6px 14px', fontFamily: FONT,
          }}
        >
          → חזרה לטבלה
        </button>
        <button
          onClick={() => setShowGroupsPicker(true)}
          style={{ padding: '6px 14px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontFamily: FONT }}
        >
          ⚙ התאמת שדות וקטגוריות
        </button>
      </div>

      {detailLoading && <Card><div style={{ textAlign: 'center', padding: '20px', color: C.textMuted }}>טוען...</div></Card>}
      {!detailLoading && !detail && (
        <Card><div style={{ textAlign: 'center', padding: '20px', color: C.textMuted }}>לא נמצא מידע מלא עבור תקלה זו</div></Card>
      )}

      {!detailLoading && detail && (
          <>
            {/* ── כותרת התקלה — בולטת, בראש המסך ── */}
            <Card>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <span style={{ fontSize: '28px', flexShrink: 0 }}>🐛</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '22px', fontWeight: WEIGHT.bold, color: C.textPrimary, lineHeight: 1.35, wordBreak: 'break-word' }}>
                    {titleShown ? (detail.title || 'ללא כותרת') : `תקלה ${defectId}`}
                  </div>
                  <div style={{ ...TEXT.sm, color: C.textMuted, marginTop: '4px' }}>תקלה {defectId}</div>
                </div>
              </div>
            </Card>

            {/* ── קטגוריות שדות — אותו עיצוב כמו טופס פרטי תקלת TARGET ── */}
            {detailGroups
              .map(group => ({ ...group, fields: group.fields.filter(k => detail[k] !== undefined) }))
              .filter(group => group.fields.length > 0)
              .map(group => (
                <Card key={group.title}>
                  <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textMuted, marginBottom: '10px' }}>{group.title}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px 16px', fontSize: '14px' }}>
                    {group.fields.map(key => (
                      // direction:ltr — same bidi-safety fix as VersionOverview's TARGET
                      // form: label+value are two spans, and without forcing ltr the
                      // Unicode bidi algorithm flips their order for neutral/atomic
                      // values (empty "—", a colored badge) inside this RTL page.
                      <div key={key} style={{ direction: 'ltr', textAlign: 'left' }}>
                        <span style={{ color: C.textMuted }}>{DETAIL_FIELD_LABEL[key] ?? key}: </span>
                        <span style={{ color: C.textSecondary, fontWeight: WEIGHT.semibold }}>{renderFieldValue(key, detail[key])}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}

            {/* ── תיאור והערות — זה לצד זה; הערות מפורקות לכותרת+גוף (renderNotesField) ── */}
            {(showDescription || showNotes) && (
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                {showDescription && (
                  <Card style={{ flex: '1 1 320px', minWidth: '320px' }}>
                    <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '8px' }}>{DETAIL_FIELD_LABEL.description ?? 'תיאור'}</div>
                    <div style={{
                      fontSize: '15px', color: C.textPrimary, direction: 'rtl', textAlign: 'right',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6,
                      minHeight: '120px', maxHeight: '360px', overflowY: 'auto',
                      background: C.bgNested, borderRadius: RADIUS.md, padding: '12px 14px',
                    }}>
                      {detail.description === null || detail.description === undefined || detail.description === '' ? '—' : String(detail.description)}
                    </div>
                  </Card>
                )}
                {showNotes && (
                  <Card style={{ flex: '1 1 320px', minWidth: '320px' }}>
                    <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '8px' }}>{DETAIL_FIELD_LABEL.notes ?? 'הערות'}</div>
                    <div style={{
                      fontSize: '15px', lineHeight: 1.6,
                      minHeight: '120px', maxHeight: '360px', overflowY: 'auto',
                      background: C.bgNested, borderRadius: RADIUS.md, padding: '12px 14px',
                    }}>
                      {renderNotesField(detail.notes)}
                    </div>
                  </Card>
                )}
              </div>
            )}

            {/* ── היסטוריית שינויים — אותו רכיב משותף כמו טופס TARGET ── */}
            <Card>
              <FieldChangeHistorySection defectId={defectId} token={token} />
            </Card>
          </>
      )}

      {showGroupsPicker && (
        <DetailGroupsDialog
          allColumns={allColumns}
          groups={detailGroups}
          defaultGroups={defaultGroups}
          onApply={applyDetailGroups}
          onClose={() => setShowGroupsPicker(false)}
        />
      )}
    </div>
  );
};

const SEVERITY_COLOR: Record<string, string> = {
  'Show Stopper': C.danger,
  'Severe':       C.statusFailed,
  'Medium':       C.statusInProgress,
  'Low':          C.textMuted,
};

const KpiCard: React.FC<{ label: string; value: string; color: string; onClick?: () => void }> = ({ label, value, color, onClick }) => (
  <Card padding={4} onClick={onClick} style={{ flex: 1, minWidth: '110px', textAlign: 'center' }}>
    <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, marginBottom: '4px', whiteSpace: 'nowrap' }}>{label}</div>
    <div style={{ fontSize: '32px', fontWeight: WEIGHT.bold, color, fontFamily: FONT, lineHeight: 1.1 }}>{value}</div>
  </Card>
);

const BreakdownPanel: React.FC<{ title: string; total: number; rows: { label: string; count: number }[] }> = ({ title, total, rows }) => {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <Card padding={4} style={{ flex: 1, minWidth: '260px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, fontFamily: FONT }}>{title}</div>
        <Badge color={C.textMuted} bg={C.bgHover}>{total}</Badge>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '340px', overflowY: 'auto' }}>
        {rows.length === 0 && <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>אין נתונים</div>}
        {rows.map(r => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ ...TEXT.xs, color: C.textSecondary, fontFamily: FONT, width: '140px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</div>
            <div style={{ flex: 1, height: '14px', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden' }}>
              <div style={{ width: `${(r.count / max) * 100}%`, height: '100%', background: C.brand, borderRadius: RADIUS.sm }} />
            </div>
            <div style={{ ...TEXT.xs, color: C.textPrimary, fontFamily: FONT, width: '24px', textAlign: 'left' }}>{r.count}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

const MIN_POINT_GAP = 26; // px between points before the chart starts scrolling instead of squeezing

const MonthlyTrendChart: React.FC<{
  data: { monthLabel: string; count: number }[];
  selectedMonth: string | null;
  onSelectMonth: (m: string) => void;
}> = ({ data, selectedMonth, onSelectMonth }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(760);

  // Measures the actual rendered width so the viewBox can match it exactly —
  // with few points (worst case: a single filtered month), the old fixed
  // 760px-minimum viewBox got stretched non-uniformly (preserveAspectRatio=
  // none) to fill a much wider real container, smearing text/circles
  // horizontally. Matching viewBox width to the real container keeps the
  // stretch factor at ~1 (no distortion) whenever there's room to.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (data.length === 0) {
    return <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, padding: '20px', textAlign: 'center' }}>אין נתוני מגמה</div>;
  }

  // padTop reserves room for the two-line tooltip above the highest point —
  // the wrapping div needs overflowX:auto for wide charts to scroll instead
  // of squeeze, and per the CSS overflow spec that silently forces overflowY
  // to 'auto' too (setting it to 'visible' explicitly does NOT override this
  // — confirmed live: the browser still clips), so anything drawn above y=0
  // gets cut off no matter what. Reserving enough top margin that even the
  // max-value point's tooltip box never goes negative is what actually fixes
  // it, not fighting the overflow computation.
  const height = 340, padX = 36, padTop = 50, padBottom = 24;
  const width = Math.max(containerWidth, padX * 2 + (data.length - 1) * MIN_POINT_GAP);
  const max = Math.max(1, ...data.map(d => d.count));
  const stepX = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = padX + i * stepX;
    const y = height - padBottom - (d.count / max) * (height - padTop - padBottom);
    return { x, y, d };
  });
  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');

  // Selective x-axis labels only — one point every ~90px, plus always the last
  // point — never a label on every point (that's what produced the unreadable
  // wall of overlapping text).
  const labelEvery = Math.max(1, Math.ceil(90 / (stepX || 90)));
  const activeIdx = hoverIdx ?? points.findIndex(p => p.d.monthLabel === selectedMonth);
  const activePoint = activeIdx >= 0 ? points[activeIdx] : null;

  return (
    <div ref={wrapRef} style={{ overflowX: 'auto' }}>
      {/* viewBox width now tracks the real measured container width (see
          ResizeObserver above), so preserveAspectRatio="none" below only
          ever stretches when there are more points than fit naturally —
          scroll (via minWidth) kicks in there instead of squeezing.
          With few points (viewBox width == container width), the stretch
          factor is ~1 and text/circles render undistorted — this is what
          fixes the "smeared" single-point chart (2026-08-27). Original
          "fill the card instead of sitting flush to one side" fix: found
          live in production 2026-08-05. */}
      <svg
        viewBox={`0 0 ${width} ${height + 10}`}
        preserveAspectRatio="none"
        style={{ overflow: 'visible', display: 'block', width: '100%', minWidth: width, height: height + 10 }}
      >
        <polyline points={polyline} fill="none" stroke={C.brand} strokeWidth={2} />
        {points.map((p, i) => {
          const isSelected = p.d.monthLabel === selectedMonth;
          const showLabel = i === points.length - 1 || i % labelEvery === 0;
          return (
            <g key={i}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelectMonth(p.d.monthLabel)}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {/* Wider invisible hit-target so hovering doesn't require pixel-perfect aim */}
              <rect x={p.x - stepX / 2} y={0} width={stepX || 20} height={height} fill="transparent" />
              <circle cx={p.x} cy={p.y} r={isSelected ? 6 : 3} fill={isSelected ? C.danger : C.brand} />
              {showLabel && (
                <text x={p.x} y={height - 4} fontSize="11" fill={isSelected ? C.danger : C.textMuted} fontWeight={isSelected ? 'bold' : 'normal'} textAnchor="middle" fontFamily={FONT}>
                  {p.d.monthLabel}
                </text>
              )}
            </g>
          );
        })}
        {/* Tooltip shown only for the hovered/selected point — never all of them
            at once. Shows both the month and the count together (not just the
            count) so hovering answers "which month, how many" in one glance. */}
        {activePoint && (
          <g pointerEvents="none">
            <rect x={activePoint.x - 34} y={activePoint.y - 42} width={68} height={32} rx={5} fill={C.textPrimary} />
            <text x={activePoint.x} y={activePoint.y - 27} fontSize="11" fill={C.bgCard} textAnchor="middle" fontFamily={FONT}>
              {activePoint.d.monthLabel}
            </text>
            <text x={activePoint.x} y={activePoint.y - 13} fontSize="13" fill={C.bgCard} textAnchor="middle" fontFamily={FONT} fontWeight="bold">
              {activePoint.d.count} תקלות
            </text>
          </g>
        )}
      </svg>
    </div>
  );
};

// Compact multi-select dropdown — "הכל" when nothing is picked (no filtering),
// otherwise a checkbox list of every option plus a live count of selections.
const MultiSelectFilter: React.FC<{
  label: string; options: string[]; selected: string[]; onChange: (next: string[]) => void;
}> = ({ label, options, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter(o => o !== opt) : [...selected, opt]);
  };

  const allSelected = options.length > 0 && selected.length === options.length;

  return (
    <div ref={ref} style={{ position: 'relative', flex: '1 1 0', minWidth: '150px' }}>
      <button onClick={() => setOpen(o => !o)} style={{ ...selectStyle, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', cursor: 'pointer' }}>
        <span>{label} — {selected.length === 0 ? 'הכל' : `נבחרו ${selected.length}`}</span>
        <span style={{ fontSize: '11px', color: C.textMuted }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, zIndex: 20, marginTop: '2px',
          background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.md,
          minWidth: '200px', maxHeight: '300px', overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          padding: '6px',
        }}>
          <div style={{ display: 'flex', gap: '10px', padding: '5px 8px', borderBottom: `1px solid ${C.border}`, marginBottom: '4px' }}>
            <span
              onClick={() => options.length > 0 && onChange(options)}
              style={{ ...TEXT.xs, color: allSelected ? C.textMuted : C.brand, cursor: options.length > 0 ? 'pointer' : 'default', fontFamily: FONT, fontWeight: WEIGHT.semibold }}
            >
              ✓ בחר הכל
            </span>
            <span
              onClick={() => selected.length > 0 && onChange([])}
              style={{ ...TEXT.xs, color: selected.length === 0 ? C.textMuted : C.brand, cursor: selected.length > 0 ? 'pointer' : 'default', fontFamily: FONT, fontWeight: WEIGHT.semibold }}
            >
              ✕ נקה הכל
            </span>
          </div>
          {options.map(o => (
            <label key={o} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 8px', cursor: 'pointer', fontFamily: FONT, ...TEXT.sm, color: C.textPrimary }}>
              <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
              {o}
            </label>
          ))}
          {options.length === 0 && <div style={{ ...TEXT.xs, color: C.textMuted, padding: '5px 8px' }}>אין אפשרויות</div>}
        </div>
      )}
    </div>
  );
};

function groupCount(items: OpenProdDefectMonthRow[], keyFn: (r: OpenProdDefectMonthRow) => string | null) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item) || 'ללא סיווג';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export const OpenProdDefectsView: React.FC<Props> = ({ token }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [rows, setRows] = useState<OpenProdDefectMonthRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qcMock, setQcMock] = useState(true);

  const [fResponsibility, setFResponsibility] = useState<string[]>([]);
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fYear, setFYear] = useState<string[]>([]);
  const [fFixType, setFFixType] = useState<string[]>([]);
  const [fBugType, setFBugType] = useState<string[]>([]);

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [detailDefectId, setDetailDefectId] = useState<string | null>(null);
  // Drill-down navigation: overview (KPI cards + chart + breakdown panels) →
  // click a KPI card → separate table page, optionally pre-filtered to that
  // card's severity (null = the "סה"כ" card, i.e. no severity restriction).
  const [tableOpen, setTableOpen] = useState(false);
  const [presetSeverity, setPresetSeverity] = useState<string | null>(null);
  const openTable = (severity: string | null) => { setPresetSeverity(severity); setTableOpen(true); };
  const [config, setConfig] = useState<OpenProdDefectsConfig | null>(null);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    axios.get(`${API}/qc/status`, { headers })
      .then(r => setQcMock(!r.data?.enabled))
      .catch(() => setQcMock(true));
  }, [headers]);

  useEffect(() => {
    axios.get(`${API}/qc/open-prod-defects-config`, { headers })
      .then(r => setConfig(r.data))
      .catch(() => setConfig(null));
  }, [headers]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    axios.get(`${API}/qc/open-production-defects-history`, { headers })
      .then(r => setRows(r.data ?? []))
      .catch(err => setError(err?.response?.data?.message || 'שגיאה בטעינת נתוני תקלות ייצור'))
      .finally(() => setLoading(false));
  }, [headers]);

  // ── Filter option lists (derived from the full dataset, not the filtered one) ──
  const responsibilityOptions = useMemo(() => Array.from(new Set(rows.map(r => r.responsibility).filter(Boolean))).sort() as string[], [rows]);
  const statusOptions         = useMemo(() => Array.from(new Set(rows.map(r => r.statusAtMonth).filter(Boolean))).sort() as string[], [rows]);
  const yearOptions           = useMemo(() => Array.from(new Set(rows.map(r => r.monthLabel.slice(0, 4)).filter(Boolean))).sort() as string[], [rows]);
  const fixTypeOptions        = useMemo(() => Array.from(new Set(rows.map(r => r.fixType).filter(Boolean))).sort() as string[], [rows]);
  const bugTypeOptions        = useMemo(() => Array.from(new Set(rows.map(r => r.bugType).filter(Boolean))).sort() as string[], [rows]);

  const filteredRows = useMemo(() => rows.filter(r =>
    (fResponsibility.length === 0 || fResponsibility.includes(r.responsibility || '')) &&
    (fStatus.length === 0 || fStatus.includes(r.statusAtMonth || '')) &&
    (fYear.length === 0 || fYear.some(y => r.monthLabel.startsWith(y))) &&
    (fFixType.length === 0 || fFixType.includes(r.fixType || '')) &&
    (fBugType.length === 0 || fBugType.includes(r.bugType || ''))
  ), [rows, fResponsibility, fStatus, fYear, fFixType, fBugType]);

  const monthlyTrend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of filteredRows) counts.set(r.monthLabel, (counts.get(r.monthLabel) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([monthLabel, count]) => ({ monthLabel, count }))
      .sort((a, b) => a.monthLabel.localeCompare(b.monthLabel));
  }, [filteredRows]);

  const latestMonth = monthlyTrend.length > 0 ? monthlyTrend[monthlyTrend.length - 1].monthLabel : null;
  const activeMonth = selectedMonth ?? latestMonth;

  const monthRows = useMemo(() => filteredRows.filter(r => r.monthLabel === activeMonth), [filteredRows, activeMonth]);

  const severityCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of monthRows) { const s = r.severity || 'ללא סיווג'; m.set(s, (m.get(s) ?? 0) + 1); }
    return m;
  }, [monthRows]);

  const toggleSort = useCallback((key: string) => {
    setSortDir(prevDir => (sortKey === key ? (prevDir === 'asc' ? 'desc' : 'asc') : 'asc'));
    setSortKey(key);
  }, [sortKey]);

  const tableColumns = config?.tableColumns && config.tableColumns.length > 0 ? config.tableColumns : ['defectId', 'severity', 'responsibility', 'area', 'bugType', 'statusAtMonth', 'detectedDate', 'reopenYn'];

  // The table page's dataset — monthRows further narrowed by whichever
  // severity KPI card the user clicked to get here (null = "סה"כ", no restriction).
  const baseRows = useMemo(
    () => presetSeverity ? monthRows.filter(r => r.severity === presetSeverity) : monthRows,
    [monthRows, presetSeverity],
  );

  const { getWidth: getMonthColWidth, startResize: startMonthColResize } = useColumnWidths('deploycenter_openprod_defect_column_widths');
  const monthFilters = useColumnFilters(baseRows as any, tableColumns);

  const sortedMonthRows = useMemo(() => {
    const filtered = baseRows.filter(r => monthFilters.matches(r as any));
    if (!sortKey) return filtered;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = String((a as any)[sortKey] ?? '');
      const bv = String((b as any)[sortKey] ?? '');
      return av.localeCompare(bv, 'he') * dir;
    });
  }, [baseRows, sortKey, sortDir, monthFilters.matches]);

  if (detailDefectId) {
    return (
      <DefectDetailScreen
        defectId={detailDefectId}
        detailFields={config?.detailFields ?? []}
        token={token}
        onBack={() => setDetailDefectId(null)}
      />
    );
  }

  // ── Table page — reached by clicking a KPI card on the overview below.
  // Same table as before, just on its own screen instead of always inline. ──
  if (tableOpen) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px 28px', fontFamily: FONT }}>
        <button
          onClick={() => setTableOpen(false)}
          style={{
            alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '6px', background: C.bgNested,
            color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer',
            fontSize: '13px', fontWeight: WEIGHT.semibold, padding: '6px 14px', fontFamily: FONT,
          }}
        >
          → חזרה לסקירה
        </button>
        <Card>
          <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, marginBottom: '10px' }}>
            תקלות פתוחות — {activeMonth ?? '—'}{presetSeverity ? ` — חומרה: ${presetSeverity}` : ''} ({baseRows.length}) — לחץ על כותרת עמודה למיון, לחץ על שורה לפרטים מלאים
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', ...TEXT.xs, fontFamily: FONT }}>
              <thead>
                <tr style={{ background: C.bgNested }}>
                  {tableColumns.map(key => (
                    <th
                      key={key}
                      onClick={() => toggleSort(key)}
                      style={{ position: 'relative', padding: '6px 8px', textAlign: 'right', fontWeight: WEIGHT.semibold, color: C.textSecondary, borderBottom: `1px solid ${C.border}`, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: getMonthColWidth(key) }}
                    >
                      {TABLE_FIELD_LABEL[key] ?? key}
                      {sortKey === key && <span style={{ marginRight: '4px', color: C.brand }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                      <ColumnResizeHandle onMouseDown={e => startMonthColResize(key, e)} />
                    </th>
                  ))}
                </tr>
                <ColumnFilterRow
                  columns={tableColumns.map(key => ({ key, label: TABLE_FIELD_LABEL[key] ?? key }))}
                  getWidth={getMonthColWidth}
                  filters={monthFilters}
                />
              </thead>
              <tbody>
                {sortedMonthRows.map(r => (
                  <tr
                    key={r.defectId}
                    onClick={() => setDetailDefectId(r.defectId)}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = C.bgHover)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {tableColumns.map(key => {
                      const value = (r as any)[key];
                      const isDefectCol = key === 'defectId';
                      const isSeverityCol = key === 'severity';
                      return (
                        <td
                          key={key}
                          style={{
                            padding: '6px 8px', borderBottom: `1px solid ${C.border}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            width: getMonthColWidth(key),
                            color: isDefectCol ? C.textLink : isSeverityCol ? (SEVERITY_COLOR[value ?? ''] ?? C.textPrimary) : C.textPrimary,
                            fontWeight: isDefectCol ? WEIGHT.semibold : WEIGHT.normal,
                          }}
                        >
                          {value ?? '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {sortedMonthRows.length === 0 && (
                  <tr><td colSpan={tableColumns.length} style={{ padding: '14px', textAlign: 'center', color: C.textMuted }}>אין תקלות פתוחות בחודש זה</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px 28px', fontFamily: FONT }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '27px' }}>📆</span>
          <div style={{ fontSize: '22px', fontWeight: WEIGHT.bold, color: C.textPrimary }}>תקלות ייצור פתוחות בכל חודש</div>
          {qcMock && (
            <span style={{ fontSize: '16px', background: C.bgInProgress, color: C.statusInProgress, padding: '3px 10px', borderRadius: '10px', border: `1px solid ${C.statusInProgress}44` }}>Mock — ממתין לחיבור QC</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <MultiSelectFilter label="Responsibility" options={responsibilityOptions} selected={fResponsibility} onChange={setFResponsibility} />
          <MultiSelectFilter label="Status" options={statusOptions} selected={fStatus} onChange={setFStatus} />
          <MultiSelectFilter label="Year" options={yearOptions} selected={fYear} onChange={setFYear} />
          <MultiSelectFilter label="Fix Type" options={fixTypeOptions} selected={fFixType} onChange={setFFixType} />
          <MultiSelectFilter label="Type" options={bugTypeOptions} selected={fBugType} onChange={setFBugType} />
        </div>
      </Card>

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: C.textMuted }}>טוען...</div>}
      {error && <div style={{ textAlign: 'center', padding: '24px', color: C.danger }}>{error}</div>}

      {!loading && !error && (
        <>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <KpiCard label={`סה"כ (${activeMonth ?? '—'})`} value={String(monthRows.length)} color={C.textPrimary} onClick={() => openTable(null)} />
            {(['Show Stopper', 'Severe', 'Medium', 'Low'] as const).map(s => (
              <KpiCard key={s} label={s} value={String(severityCounts.get(s) ?? 0)} color={SEVERITY_COLOR[s]} onClick={() => openTable(s)} />
            ))}
          </div>

          <Card>
            <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, marginBottom: '8px' }}>
              מגמה חודשית — לחץ על נקודה כדי לראות את התקלות של אותו חודש
            </div>
            <MonthlyTrendChart data={monthlyTrend} selectedMonth={activeMonth} onSelectMonth={setSelectedMonth} />
          </Card>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <BreakdownPanel title="לפי אזור" total={monthRows.length} rows={groupCount(monthRows, r => r.area)} />
            <BreakdownPanel title="לפי צוות" total={monthRows.length} rows={groupCount(monthRows, r => r.responsibility)} />
            <BreakdownPanel title="לפי סוג תקלה" total={monthRows.length} rows={groupCount(monthRows, r => r.bugType)} />
          </div>
        </>
      )}
    </div>
  );
};

const selectStyle: React.CSSProperties = {
  padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md,
  fontSize: '17px', background: C.bgCard, color: C.textPrimary, fontFamily: FONT, minWidth: '150px',
};

export default OpenProdDefectsView;
