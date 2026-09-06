import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Req {
  title: string; subject: string; planned: number; passed: number; failed: number; blocked: number; notReady: number; notRun: number;
  // CR-linked defect counts (spec confirmed 2026-09-05) — only present when
  // this requirement's own title resolves to a real CR number (see backend's
  // crNumberFromTitle); a module/subject folder row (no CR behind it) has
  // both null, same as a CR that genuinely has zero reported defects has
  // crDefects with all-zero counts — the two aren't the same thing, hence
  // null vs a real (zeroed) object rather than one "no data" state.
  crNumber: string | null;
  crDefects: { reported: number; open: number; critical: number } | null;
}
interface CoverageReadiness {
  kpis: { covered: number; failed: number; blocked: number; notReady: number; coveragePct: number };
  byRequirement: Req[];
}

function KpiCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', flex: 1, minWidth: '140px' }}>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: valueColor ?? C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
    </div>
  );
}

// Same segmented-bar idiom CyclesPanel already uses for per-cycle status
// breakdown (CycleProgressView's SegmentedProgressBar) — reused here instead
// of inventing a second visual language, just adapted to Req's own field set
// (no notCompleted/notApplicable/notRelevant at this granularity).
const REQ_SEGMENT_COLOR: Record<string, string> = {
  passed: C.success, failed: C.danger, blocked: C.warning, notReady: C.textMuted, notRun: C.statusOpen,
};
const REQ_SEGMENT_LABEL: Record<string, string> = {
  passed: 'עברו', failed: 'נכשלו', blocked: 'חסומים', notReady: 'לא מוכנים ל-QA', notRun: 'לא רצו',
};
const REQ_SEGMENT_KEYS = ['passed', 'failed', 'blocked', 'notReady', 'notRun'] as const;

function ReqLegend() {
  return (
    <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap', padding: '10px 14px', borderBottom: `1px solid ${C.border}`, ...TEXT.xs, color: C.textMuted }}>
      {REQ_SEGMENT_KEYS.map(k => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: REQ_SEGMENT_COLOR[k], display: 'inline-block' }} />
          {REQ_SEGMENT_LABEL[k]}
        </span>
      ))}
    </div>
  );
}

function ReqBar({ r }: { r: Req }) {
  const total = r.passed + r.failed + r.blocked + r.notReady + r.notRun;
  if (total === 0) return <div style={{ height: '8px', background: C.bgNested, borderRadius: RADIUS.sm, flex: 1, minWidth: '80px' }} />;
  const segments = REQ_SEGMENT_KEYS.map(key => ({ key, count: r[key] })).filter(s => s.count > 0);
  return (
    <div style={{ height: '8px', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden', display: 'flex', flex: 1, minWidth: '80px' }}>
      {segments.map(s => (
        <div key={s.key} title={`${REQ_SEGMENT_LABEL[s.key]}: ${s.count}`} style={{ width: `${(s.count / total) * 100}%`, height: '100%', background: REQ_SEGMENT_COLOR[s.key] }} />
      ))}
    </div>
  );
}

// Per-CR defect counts (spec confirmed 2026-09-05) — reported (all statuses),
// open, and how many of the open ones are critical (Show Stopper/Severe,
// same definition used everywhere else in this app). Only rendered when the
// row actually resolved to a CR number (see backend's crNumberFromTitle) —
// a module/subject folder row with no CR behind it (crDefects === null)
// gets a blank spacer instead, so the column still aligns.
function CrDefectStats({ d }: { d: Req['crDefects'] }) {
  if (!d) return <div style={{ width: '150px', flexShrink: 0 }} />;
  return (
    <div style={{ width: '150px', flexShrink: 0, display: 'flex', gap: '9px', ...TEXT.xs, whiteSpace: 'nowrap' as const }}>
      <span title="תקלות שדווחו בסה״כ ב-CR זה" style={{ color: C.textMuted }}>🐞 {d.reported}</span>
      <span title="תקלות פתוחות" style={{ color: d.open > 0 ? C.warning : C.textMuted, fontWeight: d.open > 0 ? WEIGHT.semibold : WEIGHT.normal }}>פתוחות {d.open}</span>
      <span title="מתוכן קריטיות (Show Stopper / Severe)" style={{ color: d.critical > 0 ? C.danger : C.textMuted, fontWeight: d.critical > 0 ? WEIGHT.bold : WEIGHT.normal }}>קריטיות {d.critical}</span>
    </div>
  );
}

// One row per requirement: title+subject (fixed-width, truncated) → the bar
// (fills the rest of the row) → per-CR defect counts → coverage% (compact,
// colored). Replaces the old 8-numeric-column table — same data, scanned by
// shape/color instead of read column by column (spec confirmed 2026-09-04).
function ReqRow({ r }: { r: Req }) {
  const pct = r.planned > 0 ? Math.round((r.passed / r.planned) * 100) : 0;
  const pctColor = r.failed > 0 || r.blocked > 0 ? C.danger : pct >= 80 ? C.success : C.textMuted;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: SP[3], padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
      <div style={{ width: '260px', flexShrink: 0, minWidth: 0 }}>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }} title={r.title}>{r.title || '—'}</div>
        {r.subject && <div style={{ ...TEXT.xs, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{r.subject}</div>}
      </div>
      <ReqBar r={r} />
      <CrDefectStats d={r.crDefects} />
      <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: pctColor, width: '44px', textAlign: 'left' as const, flexShrink: 0, fontVariantNumeric: 'tabular-nums' as const }}>{pct}%</div>
    </div>
  );
}

interface Props { token: string; versionId?: string; role: string; }

export const CoverageReadinessView: React.FC<Props> = ({ token, versionId }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<CoverageReadiness | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!versionId) { setData(null); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/coverage-readiness/${versionId}`, { headers })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);

  useEffect(() => { load(); }, [load]);

  if (!versionId) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>טוען...</div>;
  if (!data) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>✅ כיסוי ומוכנות</div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <KpiCard value={String(data.kpis.covered)} label="Covered" valueColor={C.success} />
        <KpiCard value={String(data.kpis.failed)} label="Failed" valueColor={data.kpis.failed > 0 ? C.danger : C.success} />
        <KpiCard value={String(data.kpis.blocked)} label="Blocked" valueColor={data.kpis.blocked > 0 ? '#e8af00' : C.success} />
        <KpiCard value={String(data.kpis.notReady)} label="Not Ready" />
        <KpiCard value={`${data.kpis.coveragePct}%`} label="Coverage %" valueColor={C.brand} />
      </div>

      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflow: 'hidden' }}>
        {data.byRequirement.length === 0 ? (
          <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>אין נתוני כיסוי לגרסה זו.</div>
        ) : (
          <>
            <ReqLegend />
            {/* Worst-first: any failed/blocked pushes a requirement to the top,
                then lowest pass-rate — same instinct as the coverage tile's own
                sorted CR lists (the eye should land on what needs attention). */}
            {[...data.byRequirement]
              .sort((a, b) => {
                const riskA = a.failed > 0 || a.blocked > 0 ? 1 : 0;
                const riskB = b.failed > 0 || b.blocked > 0 ? 1 : 0;
                if (riskA !== riskB) return riskB - riskA;
                const pctA = a.planned > 0 ? a.passed / a.planned : 1;
                const pctB = b.planned > 0 ? b.passed / b.planned : 1;
                return pctA - pctB;
              })
              .map((r, i) => <ReqRow key={i} r={r} />)}
          </>
        )}
      </div>
    </div>
  );
};
