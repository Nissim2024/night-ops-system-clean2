import React, { useEffect, useMemo, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE, severityColor, severityBg, severityLabel } from '../../theme';
import { CyclesPanel, CycleProgress } from './CycleProgressView';
import { DefectDrilldownModal } from './DefectDrilldownModal';
import { KpiTile, RiskRow } from '../HomeDashboard';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

function isRm(r: string) { return ['RELEASE_MANAGER', 'ADMIN'].includes(r); }

const CLOSED_DEFECT_STATUSES = ['Closed', 'Canceled', 'Rejected', 'Fixed'];

// Same DD/MM/YYYY (Oracle-style) discoveryDate format as release-intelligence.
// service.ts's own parseOracleDateAgeDays — a defect "opened today" is age===0.
function oracleDateAgeDays(ddMmYyyy: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(ddMmYyyy?.trim() ?? '');
  if (!m) return null;
  const [, d, mo, y] = m;
  const discovered = new Date(Number(y), Number(mo) - 1, Number(d)).getTime();
  if (Number.isNaN(discovered)) return null;
  return Math.floor((Date.now() - discovered) / 86400000);
}

// Cycle ending within this window still not meeting its QG target — see the
// CYCLE_ENDING_SOON block below.
const CYCLE_ENDING_SOON_HOURS = 48;

interface Overview {
  healthScore: number; coveragePct: number; criticalDefects: number; openRisksCount: number;
  daysToGoLive: number | null; forecastStatus: 'ON_TRACK' | 'AT_RISK' | 'BEHIND_PLAN';
  qgSummary: Record<string, { count: number; threshold: number }>; qgPass: boolean;
  topRisks: { id: string; title: string; severity: string }[];
}
interface DefectRow { id: string; title: string; severity: string; status: string; discoveryDate: string; }
interface CrAssignmentRow { id: string; crNumber: string; crLabel: string | null; qaArrivalDate: string | null; qaReceived: boolean; }
interface CrQualityRow { crNumber: string; crLabel: string; defectCount: number; actualEffortDays: number; score: number; meetsTarget: boolean; }

// score = Σ(defectCount × severityWeight) / actualEffortDays; a CR "meets the
// target" when score <= CR_QUALITY_TARGET — same constant and formula as
// release-intelligence.service.ts's getCrQualityScores (spec confirmed
// 2026-09-01).
const CR_QUALITY_TARGET = 0.15;

type Urgency = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
interface VersionNotice { id: string; text: string; urgency: Urgency; createdAt: string; creator?: { fullName: string } }

const FORECAST_LABEL: Record<string, { label: string; color: string }> = {
  ON_TRACK: { label: 'בקצב', color: C.success },
  AT_RISK: { label: 'בסיכון', color: '#e8af00' },
  BEHIND_PLAN: { label: 'בחריגה', color: C.danger },
};
const CYCLE_LABEL: Record<string, string> = {
  CYCLE_1: 'סבב 1', CYCLE_2: 'סבב 2', CYCLE_3: 'סבב 3',
  STAND_ALONE: 'Stand Alone', UAT: 'UAT', REHEARSAL: 'חזרה גנרלית', GO_LIVE: 'עליה לאוויר',
};

// qgSummary's keys (computeQgSummary, release-intelligence.service.ts) →
// display label + severity color, for the Quality Gate card's open-defects-
// by-severity mini chart (spec confirmed 2026-08-31).
const QG_SEVERITY_META: Record<string, { label: string; color: string }> = {
  showStopper: { label: 'Show Stopper', color: C.danger },
  severe: { label: 'Severe', color: C.warning },
  medium: { label: 'Medium', color: '#e8af00' },
  low: { label: 'Low', color: C.textMuted },
};

// Small horizontal bar per severity — open-defects count vs its QG
// threshold, red when over threshold. Lives in the Quality Gate KpiTile's
// footer slot.
function SeverityMiniChart({ qgSummary, onClick }: { qgSummary: Record<string, { count: number; threshold: number }>; onClick?: () => void }) {
  const entries = Object.entries(qgSummary).filter(([key]) => QG_SEVERITY_META[key]);
  const max = Math.max(1, ...entries.map(([, v]) => v.count));
  // stopPropagation — this chart sits inside the Quality Gate KpiTile, which
  // has its own onClick (navigates to cycle-progress); without this, a click
  // on the chart would fire both handlers and the card's own onClick would
  // win, silently overriding the chart's own destination.
  return (
    <div
      onClick={e => { if (onClick) { e.stopPropagation(); onClick(); } }}
      style={{ display: 'flex', flexDirection: 'column', gap: '4px', cursor: onClick ? 'pointer' : 'default' }}
    >
      {entries.map(([key, v]) => {
        const meta = QG_SEVERITY_META[key];
        const over = v.count > v.threshold;
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ ...TEXT.xs, color: C.textMuted, width: '72px', flexShrink: 0, whiteSpace: 'nowrap' as const }}>{meta.label}</span>
            <div style={{ flex: 1, height: '8px', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden' }}>
              <div style={{ width: `${(v.count / max) * 100}%`, height: '100%', background: meta.color, borderRadius: RADIUS.sm }} />
            </div>
            <span style={{ ...TEXT.xs, fontWeight: over ? WEIGHT.bold : WEIGHT.normal, color: over ? C.danger : C.textPrimary, width: '20px', textAlign: 'left' as const, flexShrink: 0 }}>{v.count}</span>
          </div>
        );
      })}
    </div>
  );
}

// Failing-CR list — lives in the CR-quality KpiTile's footer slot, toggled by
// clicking the card itself. Each row is its own click target (opens that
// CR's defect list), separate from the card's own onClick (spec confirmed
// 2026-09-01).
function CrQualityList({ rows, onSelectCr }: { rows: CrQualityRow[]; onSelectCr: (crNumber: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {rows.map(r => (
        <div
          key={r.crNumber}
          onClick={e => { e.stopPropagation(); onSelectCr(r.crNumber); }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', cursor: 'pointer', padding: '3px 0' }}
        >
          <span style={{ ...TEXT.xs, color: C.brand, fontWeight: WEIGHT.semibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
            {r.crNumber}{r.crLabel ? ` — ${r.crLabel}` : ''}
          </span>
          <span style={{ ...TEXT.xs, color: C.danger, fontWeight: WEIGHT.bold, flexShrink: 0 }}>{r.score.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

interface Props { token: string; versionId?: string; role: string; fullName: string; onNavigate?: (view: string) => void; }

// Module home page for "ניהול בדיקות" — same structure as the general Home
// page: greeting → hero (here: the cycles panel with its countdown, reused
// unchanged) → rich per-area status cards → notice/alert strip. Every card
// and alert is backed by data the module already computes elsewhere — no new
// backend endpoints (spec confirmed 2026-08-31).
export const ReleaseIntelligenceHomeView: React.FC<Props> = ({ token, versionId, role, fullName, onNavigate }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const firstName = fullName.split(' ')[0] || fullName;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'שלום' : hour < 21 ? 'ערב טוב' : 'לילה טוב';

  const [overview, setOverview] = useState<Overview | null>(null);
  const [cycleData, setCycleData] = useState<CycleProgress | null>(null);
  const [defects, setDefects] = useState<DefectRow[]>([]);
  const [aging, setAging] = useState<{ count: number; avgAgingDays: number; thresholdDays: number } | null>(null);
  const [crAssignments, setCrAssignments] = useState<CrAssignmentRow[]>([]);
  const [crQuality, setCrQuality] = useState<CrQualityRow[]>([]);
  const [notices, setNotices] = useState<VersionNotice[]>([]);
  const [loading, setLoading] = useState(false);
  const [agingDrilldown, setAgingDrilldown] = useState(false);
  const [showStopperDrilldown, setShowStopperDrilldown] = useState(false);
  const [notReceivedExpanded, setNotReceivedExpanded] = useState(false);
  const [crQualityExpanded, setCrQualityExpanded] = useState(false);
  const [crQualityDrilldown, setCrQualityDrilldown] = useState<CrQualityRow | null>(null);

  const [addingNotice, setAddingNotice] = useState(false);
  const [editingNoticeId, setEditingNoticeId] = useState<string | null>(null);
  const [noticeDraft, setNoticeDraft] = useState('');
  const [noticeUrgencyDraft, setNoticeUrgencyDraft] = useState<Urgency>('MEDIUM');
  const [savingNotice, setSavingNotice] = useState(false);
  const canEditNotice = isRm(role);

  useEffect(() => {
    if (!versionId) { setOverview(null); setCycleData(null); setDefects([]); setAging(null); setCrAssignments([]); setCrQuality([]); return; }
    setLoading(true);
    Promise.all([
      axios.get(`${API}/release-intelligence/overview/${versionId}`, { headers }).then(r => r.data).catch(() => null),
      axios.get(`${API}/release-intelligence/cycle-progress/${versionId}`, { headers }).then(r => r.data).catch(() => null),
      axios.get(`${API}/qc/defects?versionId=${versionId}`, { headers }).then(r => r.data ?? []).catch(() => []),
      axios.get(`${API}/release-intelligence/status-board/${versionId}`, { headers }).then(r => r.data).catch(() => null),
      axios.get(`${API}/version-cr-assignments/version/${versionId}`, { headers }).then(r => r.data ?? []).catch(() => []),
      axios.get(`${API}/release-intelligence/cr-quality/${versionId}`, { headers }).then(r => r.data ?? []).catch(() => []),
    ]).then(([ov, cp, defs, sb, vca, crq]) => {
      setOverview(ov);
      setCycleData(cp);
      setDefects(defs);
      setAging(sb?.aging ?? null);
      setCrAssignments(vca);
      setCrQuality(crq);
    }).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);

  const loadNotices = useCallback(() => {
    if (!versionId) { setNotices([]); return; }
    axios.get(`${API}/versions/${versionId}/notices`, { headers })
      .then(res => setNotices(res.data ?? []))
      .catch(() => setNotices([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);
  useEffect(() => { loadNotices(); setAddingNotice(false); setEditingNoticeId(null); }, [loadNotices]);

  const startAddNotice = () => { setNoticeDraft(''); setNoticeUrgencyDraft('MEDIUM'); setEditingNoticeId(null); setAddingNotice(true); };
  const startEditNotice = (n: VersionNotice) => { setNoticeDraft(n.text); setNoticeUrgencyDraft(n.urgency); setEditingNoticeId(n.id); setAddingNotice(false); };
  const cancelNoticeEdit = () => { setAddingNotice(false); setEditingNoticeId(null); };

  const saveNotice = async () => {
    if (!versionId || !noticeDraft.trim()) return;
    setSavingNotice(true);
    try {
      if (editingNoticeId) {
        await axios.patch(`${API}/versions/${versionId}/notices/${editingNoticeId}`, { text: noticeDraft, urgency: noticeUrgencyDraft }, { headers });
      } else {
        await axios.post(`${API}/versions/${versionId}/notices`, { text: noticeDraft, urgency: noticeUrgencyDraft }, { headers });
      }
      loadNotices();
      cancelNoticeEdit();
    } catch (e) { console.error('Failed to save RI home notice', e); }
    setSavingNotice(false);
  };

  const deleteNotice = async (id: string) => {
    if (!versionId) return;
    if (!window.confirm('למחוק את ההודעה? לא ניתן לשחזר לאחר המחיקה.')) return;
    setSavingNotice(true);
    try {
      await axios.delete(`${API}/versions/${versionId}/notices/${id}`, { headers });
      loadNotices();
      cancelNoticeEdit();
    } catch (e) { console.error('Failed to delete RI home notice', e); }
    setSavingNotice(false);
  };

  // ── Derived alerts — every one grounded in data already fetched above ──
  const showStoppersToday = useMemo(
    () => defects.filter(d => d.severity === 'Show Stopper' && oracleDateAgeDays(d.discoveryDate) === 0),
    [defects],
  );
  const cyclesEndingSoonUnmet = useMemo(() => {
    if (!cycleData) return [];
    const soonMs = CYCLE_ENDING_SOON_HOURS * 3600000;
    return cycleData.timeline.filter(c =>
      c.state === 'active'
      && new Date(c.plannedEnd).getTime() - Date.now() < soonMs
      && c.successPct != null && c.qgTargetPct != null && c.successPct < c.qgTargetPct
    );
  }, [cycleData]);
  const notReceivedCrs = useMemo(
    () => crAssignments.filter(a => !a.qaReceived && a.qaArrivalDate && new Date(a.qaArrivalDate).getTime() < Date.now()),
    [crAssignments],
  );
  const failingCrs = useMemo(() => crQuality.filter(r => !r.meetsTarget), [crQuality]);

  if (!versionId) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !overview) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>טוען...</div>;
  }

  const forecast = overview ? FORECAST_LABEL[overview.forecastStatus] : null;
  const worstQgBucket = overview
    ? Object.entries(overview.qgSummary).sort((a, b) => (b[1].count - b[1].threshold) - (a[1].count - a[1].threshold))[0]
    : null;

  const openDefectsCount = defects.filter(d => !CLOSED_DEFECT_STATUSES.includes(d.status)).length;
  const alertCount = (aging && aging.count > 0 ? 1 : 0) + cyclesEndingSoonUnmet.length
    + (showStoppersToday.length > 0 ? 1 : 0) + (notReceivedCrs.length > 0 ? 1 : 0);

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      {/* ── Greeting bar — same content/style as the general Home page's own
          local topbar (spec confirmed 2026-08-31). ── */}
      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '14px 20px', boxShadow: SHADOW.xs }}>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{greeting}, {firstName} 👋</div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '1px' }}>
          {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {/* ── Hero area — the cycles panel, reused as-is with its countdown clock ── */}
      {cycleData && <CyclesPanel data={cycleData} token={token} versionId={versionId} />}

      {/* ── תמונת מצב — the exact same KpiTile card used on the general Home
          page, one per area of this module instead of one per app module
          (spec confirmed 2026-08-31). ── */}
      {overview && (
        <div>
          <h2 style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: '0.06em', margin: '4px 0 -4px' }}>תמונת מצב</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px', marginTop: '12px' }}>
            <KpiTile
              icon="✅" accent={C.moduleTracking} moduleLabel="כיסוי בדיקות"
              value={`${overview.coveragePct}%`} label="בוצע מהמתוכנן"
              sub={overview.coveragePct >= 80 ? '✓ כיסוי תקין' : '⚠ כיסוי חלקי'}
              subTone={overview.coveragePct >= 80 ? 'ok' : 'warn'}
              onClick={() => onNavigate?.('coverage-readiness')}
            />
            <KpiTile
              icon="🐞" accent={C.moduleTracking} moduleLabel="תקלות"
              value={String(openDefectsCount)} label="תקלות פתוחות"
              sub={overview.criticalDefects > 0 ? `⚠ ${overview.criticalDefects} קריטיות` : '✓ אין תקלות קריטיות'}
              subTone={overview.criticalDefects > 0 ? 'warn' : 'ok'}
              onClick={() => onNavigate?.('defects')}
            />
            <KpiTile
              icon="⚠️" accent={C.moduleTracking} moduleLabel="סיכונים"
              value={String(overview.openRisksCount)} label="סיכונים פתוחים"
              sub={overview.topRisks[0] ? `⚠ ${overview.topRisks[0].title}` : '✓ אין סיכונים פתוחים'}
              subTone={overview.openRisksCount > 0 ? 'warn' : 'ok'}
              onClick={() => onNavigate?.('overview')}
            />
            <KpiTile
              icon="🚦" accent={C.moduleTracking} moduleLabel="Quality Gate"
              value={overview.qgPass ? 'PASS' : 'FAIL'} label="סטטוס יעד איכות"
              sub={worstQgBucket ? `${worstQgBucket[1].count > worstQgBucket[1].threshold ? '⚠' : '✓'} ${worstQgBucket[0]}: ${worstQgBucket[1].count}/${worstQgBucket[1].threshold}` : null}
              subTone={overview.qgPass ? 'ok' : 'warn'}
              footer={<SeverityMiniChart qgSummary={overview.qgSummary} onClick={() => onNavigate?.('defects')} />}
              onClick={() => onNavigate?.('cycle-progress')}
            />
            <KpiTile
              icon="📈" accent={C.moduleTracking} moduleLabel="תחזית"
              value={overview.daysToGoLive != null ? String(overview.daysToGoLive) : '—'} label="ימים לעלייה לאוויר"
              sub={forecast ? `${overview.forecastStatus === 'ON_TRACK' ? '✓' : '⚠'} ${forecast.label}` : null}
              subTone={overview.forecastStatus === 'ON_TRACK' ? 'ok' : 'warn'}
              onClick={() => onNavigate?.('forecast-tracking')}
            />
            {/* score = Σ(defectCount × severityWeight) / actualEffortDays;
                target ≤ 0.15 (spec confirmed 2026-09-01). Click toggles the
                failing-CR list in the footer; each CR in that list is its own
                click target that opens its defect list. */}
            <KpiTile
              icon="🎯" accent={C.moduleTracking} moduleLabel="איכות CR"
              value={String(failingCrs.length)} label={`מתוך ${crQuality.length} CR-ים`}
              sub={`יעד: ציון ≤ ${CR_QUALITY_TARGET}`}
              subTone={failingCrs.length > 0 ? 'warn' : 'ok'}
              onClick={() => setCrQualityExpanded(v => !v)}
              footer={crQualityExpanded && failingCrs.length > 0 ? <CrQualityList rows={failingCrs} onSelectCr={crNumber => setCrQualityDrilldown(failingCrs.find(r => r.crNumber === crNumber) ?? null)} /> : null}
            />
          </div>
        </div>
      )}

      {/* ── רצועת הודעות והתראות — אותו רכיב בדיוק (RiskRow) ואותה עטיפה
          שדף הבית הכללי משתמש בהם לפיד הסיכונים/פעילויות שלו, לא חיקוי
          (spec confirmed 2026-08-31). ── */}
      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📌 סיכונים ופעילויות — ניהול בדיקות</div>
          {alertCount > 0 && <div style={{ ...TEXT.xs, color: C.textMuted }}>{alertCount} פריטים</div>}
        </div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '12px' }}>התראות וסיכונים ממודול ניהול הבדיקות עבור הגרסה הנוכחית</div>

        {/* Manual, RM/ADMIN-authored notices — same endpoint/behavior as the
            general Home page's notices (spec confirmed 2026-08-31). */}
        {notices.filter(n => n.id !== editingNoticeId).map(n => (
          <div key={n.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: severityBg(n.urgency), border: `1px solid ${severityColor(n.urgency)}40`, borderRadius: RADIUS.md, padding: '10px 14px', marginBottom: '8px' }}>
            <span style={{ fontSize: '16px', flexShrink: 0 }}>📌</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'inline-block', ...TEXT.xs, fontWeight: WEIGHT.bold, color: severityColor(n.urgency), background: C.bgCard, border: `1px solid ${severityColor(n.urgency)}`, borderRadius: RADIUS.full, padding: '1px 8px', marginBottom: '4px' }}>
                {severityLabel(n.urgency)}
              </span>
              <div style={{ ...TEXT.sm, color: C.textPrimary, whiteSpace: 'pre-wrap' as const }}>{n.text}</div>
            </div>
            {canEditNotice && (
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <button onClick={() => startEditNotice(n)} style={{ background: 'transparent', border: 'none', ...TEXT.xs, color: C.brand, cursor: 'pointer', fontFamily: FONT, fontWeight: WEIGHT.semibold }}>✏️ ערוך</button>
                <button onClick={() => deleteNotice(n.id)} disabled={savingNotice} style={{ background: 'transparent', border: 'none', ...TEXT.xs, color: C.danger, cursor: 'pointer', fontFamily: FONT, fontWeight: WEIGHT.semibold }}>🗑 מחק</button>
              </div>
            )}
          </div>
        ))}

        {(addingNotice || editingNoticeId) ? (
          <div style={{ background: C.bgHover, border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.md, padding: '10px 12px', marginBottom: '14px' }}>
            <textarea
              autoFocus
              value={noticeDraft}
              onChange={e => setNoticeDraft(e.target.value)}
              placeholder="הודעה ידנית לצוותים (למשל: תזכורת לישיבת סטטוס)…"
              style={{ width: '100%', minHeight: '54px', resize: 'vertical' as const, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: '7px 9px', ...TEXT.sm, color: C.textPrimary, fontFamily: FONT, background: C.bgCard }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' }}>
              <span style={{ ...TEXT.xs, color: C.textMuted }}>רמת דחיפות:</span>
              <select
                value={noticeUrgencyDraft}
                onChange={e => setNoticeUrgencyDraft(e.target.value as Urgency)}
                style={{ border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: '4px 8px', ...TEXT.xs, color: C.textPrimary, fontFamily: FONT, background: C.bgCard }}
              >
                <option value="LOW">{severityLabel('LOW')}</option>
                <option value="MEDIUM">{severityLabel('MEDIUM')}</option>
                <option value="HIGH">{severityLabel('HIGH')}</option>
                <option value="CRITICAL">{severityLabel('CRITICAL')}</option>
              </select>
              <div style={{ flex: 1 }} />
              <button onClick={cancelNoticeEdit} style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: '5px 12px', ...TEXT.xs, color: C.textMuted, cursor: 'pointer', fontFamily: FONT }}>ביטול</button>
              <button onClick={saveNotice} disabled={savingNotice || !noticeDraft.trim()} style={{ background: C.brand, border: 'none', borderRadius: RADIUS.sm, padding: '5px 14px', ...TEXT.xs, fontWeight: WEIGHT.semibold, color: 'white', cursor: savingNotice || !noticeDraft.trim() ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: savingNotice || !noticeDraft.trim() ? 0.6 : 1 }}>{savingNotice ? '...' : 'שמור'}</button>
            </div>
          </div>
        ) : canEditNotice ? (
          <button
            onClick={startAddNotice}
            style={{ width: '100%', marginBottom: '14px', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: RADIUS.md, padding: '8px', ...TEXT.xs, color: C.textMuted, cursor: 'pointer', fontFamily: FONT, transition: EASE.fast }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.brand; e.currentTarget.style.color = C.brand; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted; }}
          >
            📌 + הוסף הודעה ידנית לצוותים
          </button>
        ) : null}

        {/* Computed alerts — aging defects, cycles about to close without
            meeting target, Show Stopper defects opened today, CRs not yet
            received for testing — same RiskRow every alert on the general
            Home page uses (spec confirmed 2026-08-31). */}
        {aging && aging.count > 0 && (
          <RiskRow
            icon="⏱" urgent module="release-intelligence"
            title={`${aging.count} תקלות חורגות מזמן הטיפול`}
            desc={`מעל ${aging.thresholdDays} ימים • ממוצע חריגה: ${aging.avgAgingDays} ימים`}
            onClick={() => setAgingDrilldown(true)}
          />
        )}

        {cyclesEndingSoonUnmet.map(c => (
          <RiskRow
            key={c.cycleType}
            icon="⏳" urgent module="release-intelligence"
            title={`${CYCLE_LABEL[c.cycleType] ?? c.cycleType} עומד להסתיים וטרם עומד ביעד`}
            desc={`${c.successPct}% הצלחה מתוך יעד ${c.qgTargetPct}%`}
            onClick={() => onNavigate?.('cycle-progress')}
          />
        ))}

        {showStoppersToday.length > 0 && (
          <RiskRow
            icon="🔴" urgent module="release-intelligence"
            title={`${showStoppersToday.length} תקלות Show Stopper נפתחו היום`}
            desc="תקלות קריטיות חדשות שדורשות טיפול מיידי"
            onClick={() => setShowStopperDrilldown(true)}
          />
        )}

        {notReceivedCrs.length > 0 && (
          <RiskRow
            icon="📦" urgent module="release-intelligence"
            title={`${notReceivedCrs.length} CR-ים טרם התקבלו לבדיקות`}
            desc="פיתוח טרם נמסר לצוות הבדיקות"
            detail={notReceivedCrs.map(a => `${a.crNumber}${a.crLabel ? ' — ' + a.crLabel : ''}`)}
            expanded={notReceivedExpanded}
            onToggle={() => setNotReceivedExpanded(v => !v)}
          />
        )}
      </div>

      {agingDrilldown && (
        <DefectDrilldownModal
          token={token} versionId={versionId} screen="status-board" filter="aging"
          title="תקלות חורגות מזמן הטיפול" onClose={() => setAgingDrilldown(false)}
        />
      )}
      {showStopperDrilldown && (
        <DefectDrilldownModal
          token={token} versionId={versionId} screen="defects" filter="severity" value="Show Stopper"
          title="תקלות Show Stopper פתוחות" onClose={() => setShowStopperDrilldown(false)}
        />
      )}
      {crQualityDrilldown && (
        <DefectDrilldownModal
          token={token} versionId={versionId} screen="home" filter="crQuality" value={crQualityDrilldown.crNumber}
          title={`תקלות CR ${crQualityDrilldown.crNumber}${crQualityDrilldown.crLabel ? ' — ' + crQualityDrilldown.crLabel : ''} (ציון: ${crQualityDrilldown.score.toFixed(2)})`}
          onClose={() => setCrQualityDrilldown(null)}
        />
      )}
    </div>
  );
};

export default ReleaseIntelligenceHomeView;
