import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';
import { useReleaseCount } from './releaseCountSetting';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface KpiDetail {
  kpiName: string;
  releaseName: string;
  definition: { purpose: string | null; description: string | null; measuredEntity: string; dataSource: string | null; trend: string | null };
  target: number;
  grade: number | null;
  weight: number;
  relativeScorePct: number | null;
  contributionPct: number | null;
  scoreLostPct: number | null;
  yearAverageGrade: number | null;
  severity: { showStopper: number | null; severe: number | null; medium: number | null; low: number | null };
  trend: { releaseName: string; value: number | null }[];
  qualitativeNote: string | null;
}

const NOTE_EDITOR_ROLES = ['ADMIN', 'RELEASE_MANAGER'];

// Grade values ("בפועל"/ממוצע שנתי) — 3 decimal places, matching KpiMatrixView.
function fmt3(v: number | null): string {
  return v != null ? v.toFixed(3) : '—';
}

function fmtPct(v: number | null): string {
  return v != null ? `${v.toFixed(2)}%` : '—';
}

// Severity breakdown fields are defect COUNTS — always whole, non-negative.
function fmtCount(v: number | null): string {
  return v != null ? String(Math.round(Math.abs(v))) : '—';
}

function KpiCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '14px 16px', flex: 1, minWidth: '140px' }}>
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: valueColor ?? C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
    </div>
  );
}

const CHART_HEIGHT = 200;
const BAR_GAP = 60;

// Raw Grade values span wildly different scales (0.02-0.25 for %-type KPIs,
// up to 175+ for count-type ones) — round to a sensible precision per magnitude.
function roundGrade(v: number): number {
  if (Math.abs(v) < 10) return Math.round(v * 1000) / 1000;
  if (Math.abs(v) < 100) return Math.round(v * 10) / 10;
  return Math.round(v);
}

function GradeTrendChart({ points }: { points: { releaseName: string; value: number | null }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setContainerWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const usable = points.filter(p => p.value != null);
  if (usable.length === 0) {
    return <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>אין נתונים להצגה.</div>;
  }
  const maxVal = Math.max(...usable.map(p => p.value as number), 0.001);
  // Fill the full available width when there's room for all points; only
  // fall back to a fixed per-bar gap (with horizontal scroll) once there are
  // more points than comfortably fit, so bars never get squished unreadable.
  const naturalWidth = Math.max(400, points.length * BAR_GAP);
  const width = Math.max(naturalWidth, containerWidth);
  const gap = points.length > 1 ? (width - 32) / points.length : width;
  const barWidth = Math.min(32, gap * 0.6);

  return (
    <div ref={containerRef} style={{ overflowX: 'auto', width: '100%' }}>
      <svg width={width} height={CHART_HEIGHT + 40} style={{ display: 'block' }}>
        {points.map((p, i) => {
          const x = 16 + i * gap;
          if (p.value == null) return null;
          const barHeight = Math.max(2, (p.value / maxVal) * (CHART_HEIGHT - 30));
          const y = CHART_HEIGHT - barHeight;
          return (
            <g key={p.releaseName}>
              <rect x={x} y={y} width={barWidth} height={barHeight} fill={C.brand} rx={2} />
              <text x={x + barWidth / 2} y={y - 8} fontSize={14} fontWeight="bold" fill={C.textSecondary} textAnchor="middle">
                {roundGrade(p.value)}
              </text>
              <text x={x + barWidth / 2} y={CHART_HEIGHT + 18} fontSize={12} fill={C.textMuted} textAnchor="middle">
                {p.releaseName}
              </text>
            </g>
          );
        })}
        <line x1={8} y1={CHART_HEIGHT} x2={width - 8} y2={CHART_HEIGHT} stroke={C.border} strokeWidth={1} />
      </svg>
    </div>
  );
}

interface Props { token: string; role: string; kpiName: string; releaseName: string; onBack: () => void; }

export const KpiDetailView: React.FC<Props> = ({ token, role, kpiName, releaseName, onBack }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<KpiDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [releaseCount] = useReleaseCount();
  const canEditNote = NOTE_EDITOR_ROLES.includes(role);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Defect-level drill-down only exists for releases with a real linked QC/
  // Oracle release — most historical releases here are Excel-only rows with
  // no defect source to drill into.
  const [qcLink, setQcLink] = useState<{ versionId: string; hasQcData: boolean } | null>(null);
  const [defects, setDefects] = useState<any[] | null>(null);
  const [showDefects, setShowDefects] = useState(false);
  const [defectsLoading, setDefectsLoading] = useState(false);
  const [defectsError, setDefectsError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    axios.get(`${API}/quality-hub/kpi-detail/${encodeURIComponent(kpiName)}/${encodeURIComponent(releaseName)}`, { headers })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpiName, releaseName, token]);

  useEffect(() => {
    setQcLink(null);
    setShowDefects(false);
    setDefects(null);
    setDefectsError(null);
    axios.get(`${API}/quality-hub/qc-link/${encodeURIComponent(releaseName)}`, { headers })
      .then(res => setQcLink(res.data))
      .catch(() => setQcLink(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseName, token]);

  const toggleDefects = () => {
    if (showDefects) { setShowDefects(false); return; }
    setShowDefects(true);
    if (defects != null || defectsError || !qcLink?.versionId) return;
    setDefectsLoading(true);
    setDefectsError(null);
    axios.get(`${API}/qc/defects?versionId=${qcLink.versionId}`, { headers })
      .then(res => setDefects(res.data ?? []))
      .catch(e => setDefectsError(e?.response?.data?.message || e.message || 'שגיאה בטעינת התקלות'))
      .finally(() => setDefectsLoading(false));
  };

  const startEditNote = () => {
    setNoteDraft(data?.qualitativeNote ?? '');
    setEditingNote(true);
  };

  const saveNote = async () => {
    setSavingNote(true);
    try {
      const res = await axios.patch(
        `${API}/quality-hub/kpi-score/${encodeURIComponent(releaseName)}/${encodeURIComponent(kpiName)}/note`,
        { note: noteDraft },
        { headers },
      );
      setData(prev => prev ? { ...prev, qualitativeNote: res.data.qualitativeNote } : prev);
      setEditingNote(false);
    } finally {
      setSavingNote(false);
    }
  };

  const scoreColor = (pct: number | null) => {
    if (pct == null) return C.textMuted;
    if (pct >= 90) return C.success;
    if (pct >= 70) return '#e8af00';
    return C.danger;
  };

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🔍 {kpiName} — {releaseName}</div>
        <button
          onClick={onBack}
          style={{ padding: '8px 16px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', color: C.textSecondary, ...TEXT.sm, fontWeight: WEIGHT.semibold }}
        >
          → חזרה למטריצה
        </button>
      </div>

      {loading ? (
        <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6] }}>טוען...</div>
      ) : !data ? (
        <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6] }}>לא ניתן לטעון נתונים.</div>
      ) : (
        <>
          {data.definition.purpose && (
            <div style={{ ...TEXT.sm, color: C.textSecondary, background: C.bgNested, borderRadius: RADIUS.md, padding: SP[3] }}>
              {data.definition.purpose}{data.definition.description ? ` — ${data.definition.description}` : ''}
            </div>
          )}

          <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
            <KpiCard value={String(data.target)} label="יעד" />
            <KpiCard value={fmt3(data.grade)} label="בפועל (Grade)" />
            <KpiCard value={`${(data.weight * 100).toFixed(2)}%`} label="משקל" />
            <KpiCard value={fmtPct(data.relativeScorePct)} label="ציון יחסי" valueColor={scoreColor(data.relativeScorePct)} />
            <KpiCard value={fmtPct(data.contributionPct)} label="תרומה לציון" />
            <KpiCard value={fmtPct(data.scoreLostPct)} label="Score Lost" valueColor={data.scoreLostPct != null && data.scoreLostPct < 0 ? C.danger : C.success} />
            <KpiCard value={fmt3(data.yearAverageGrade)} label="ממוצע שנתי (Grade)" />
          </div>

          <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
            <KpiCard
              value={fmtCount(
                (data.severity.showStopper ?? 0) + (data.severity.severe ?? 0) + (data.severity.medium ?? 0) + (data.severity.low ?? 0)
              )}
              label='סה"כ תקלות'
            />
            <KpiCard value={fmtCount(data.severity.showStopper)} label="Show Stopper" valueColor={C.danger} />
            <KpiCard value={fmtCount(data.severity.severe)} label="Severe" valueColor="#e8af00" />
            <KpiCard value={fmtCount(data.severity.medium)} label="Medium" />
            <KpiCard value={fmtCount(data.severity.low)} label="Low" />
          </div>

          {qcLink?.hasQcData && (
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textSecondary }}>תקלות (QC) — {releaseName}</div>
                <button
                  onClick={toggleDefects}
                  style={{ padding: '6px 14px', background: C.brand, color: '#fff', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', ...TEXT.xs, fontWeight: WEIGHT.semibold }}
                >
                  {showDefects ? 'הסתר' : '🐛 צפה בתקלות'}
                </button>
              </div>
              {showDefects && (
                <div style={{ marginTop: SP[3], overflowX: 'auto' }}>
                  {defectsLoading ? (
                    <div style={{ ...TEXT.xs, color: C.textMuted, padding: SP[3] }}>טוען...</div>
                  ) : defectsError ? (
                    <div style={{ ...TEXT.xs, color: C.danger, padding: SP[3] }}>⚠️ שגיאה בטעינת התקלות: {defectsError}</div>
                  ) : !defects || defects.length === 0 ? (
                    <div style={{ ...TEXT.xs, color: C.textMuted, padding: SP[3] }}>אין תקלות זמינות לגרסה זו</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', ...TEXT.xs }}>
                      <thead>
                        <tr style={{ background: C.bgNested }}>
                          {['תקלה', 'כותרת', 'חומרה', 'סטטוס', 'אחראי', 'תאריך גילוי'].map(h => (
                            <th key={h} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: WEIGHT.semibold, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {defects.map(d => (
                          <tr key={d.id}>
                            <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, color: C.textLink, fontWeight: WEIGHT.semibold }}>{d.id}</td>
                            <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{d.title}</td>
                            <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{d.severity}</td>
                            <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{d.status}</td>
                            <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{d.assignedTo}</td>
                            <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{d.discoveryDate}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
            <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textSecondary, marginBottom: SP[3] }}>
              מגמת ערך בפועל (Grade) לאורך גרסאות — {releaseCount} הגרסאות האחרונות
            </div>
            <GradeTrendChart points={data.trend.slice(-releaseCount)} />
          </div>

          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP[2] }}>
              <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textSecondary }}>אחריות / שיפורים נדרשים / מאפייני הבעיות</div>
              {canEditNote && !editingNote && (
                <button
                  onClick={startEditNote}
                  style={{ padding: '4px 12px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', color: C.textSecondary, ...TEXT.xs, fontWeight: WEIGHT.semibold }}
                >
                  {data.qualitativeNote ? '✏️ ערוך' : '+ הוסף הערה'}
                </button>
              )}
            </div>

            {editingNote ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
                <textarea
                  value={noteDraft}
                  onChange={e => setNoteDraft(e.target.value)}
                  rows={4}
                  placeholder="מי אחראי, אילו שיפורים נדרשים, ומה מאפיין את התקלות בגרסה הזו..."
                  style={{ width: '100%', padding: SP[3], borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textPrimary, ...TEXT.sm, fontFamily: FONT, resize: 'vertical', boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: SP[2], justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setEditingNote(false)}
                    disabled={savingNote}
                    style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', color: C.textMuted, ...TEXT.xs, fontWeight: WEIGHT.semibold }}
                  >
                    ביטול
                  </button>
                  <button
                    onClick={saveNote}
                    disabled={savingNote}
                    style={{ padding: '6px 14px', background: C.brand, border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', color: '#fff', ...TEXT.xs, fontWeight: WEIGHT.semibold, opacity: savingNote ? 0.6 : 1 }}
                  >
                    {savingNote ? 'שומר...' : 'שמור'}
                  </button>
                </div>
              </div>
            ) : data.qualitativeNote ? (
              <div style={{ ...TEXT.sm, color: C.textPrimary, whiteSpace: 'pre-wrap' }}>{data.qualitativeNote}</div>
            ) : (
              <div style={{ ...TEXT.xs, color: C.textDisabled, textAlign: 'center', padding: SP[2] }}>עדיין לא זמין</div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
