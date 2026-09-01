import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, RADIUS, SHADOW } from '../theme';
import { formatDate } from '../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Proposal {
  id: string; teamId: string; teamName: string; title: string;
  app?: string; actionType?: string; phase: number; notes?: string;
  estimatedMins?: number; assignedUserName?: string;
  status: string; reviewStatus: string;
}
interface CrEntry {
  crNumber: string; crLabel: string;
  proposalsByPhase: Record<number, Proposal[]>;
}
interface Props { token: string; versionId?: string; versionName?: string; }

// Stable color per team so the same team reads as the same color everywhere
// it appears across the merged timeline (mirrors CrReviewView's helper).
const TEAM_PALETTE = ['#4573D2', '#9C6ADE', '#37C47A', '#E8AF00', '#F0883E', '#14B8A6', '#EC6BAD', '#6366F1'];
function teamColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TEAM_PALETTE[hash % TEAM_PALETTE.length];
}

interface DayPart {
  key: string; icon: string; title: string; meta: string;
  items: (Proposal & { crNumber: string; crLabel: string })[];
}

// syncDerivedProposals writes monitoring-point titles as `בקרה — ${type}: ${name}`
// (cr-plans.service.ts) — the only real-data signal that a phase-4 item is an
// ongoing follow-up check rather than a go-live-morning action item, so it's
// used to split phase 4 between the "morning of" and "day after" buckets.
const isFollowUp = (title: string) => title.startsWith('בקרה — ');

// Same narrative phrasing team leads already see live in the wizard while
// submitting their plan (wizardNarrative in TeamLeadProposalView.tsx) — reused
// here so the merged cross-team plan reads as one continuous story instead of
// a raw title + tag badges per row.
function narrativeSentence(item: Proposal): string {
  const who = item.assignedUserName ? `${item.assignedUserName} מ-${item.teamName}` : `מישהו מ-${item.teamName}`;
  if (isFollowUp(item.title)) {
    // Monitoring-derived title/notes are always generated in this exact shape
    // by syncDerivedProposals: "בקרה — {type}: {name}" / "לוודא: {note}".
    const rest = item.title.replace(/^בקרה — /, '');
    const note = item.notes?.replace(/^לוודא: /, '');
    return `${who} יעקוב אחר ${rest}${note ? ` — לוודא ${note}` : ''}.`;
  }
  const sys = item.app ? ` במערכת ${item.app}` : '';
  const dur = item.estimatedMins ? ` משך משוער כ-${item.estimatedMins} דק'.` : '';
  const prefix = item.actionType ? `${item.actionType}: ` : '';
  const desc = item.actionType && item.title.startsWith(prefix) ? item.title.slice(prefix.length) : item.title;
  return `${who} יבצע ${item.actionType || 'פעולה'}${sys}${desc ? ` — ${desc}` : ''}.${dur}`;
}


type DefectBucket = 'fixed' | 'open' | 'openApproved';
interface CrDefectIndicators { fixed: any[]; open: any[]; openApproved: any[]; }
const defectBuckets = (): { key: DefectBucket; label: string; color: string }[] => [
  { key: 'fixed', label: 'תוקנו', color: C.success },
  { key: 'open', label: 'פתוחות', color: C.danger },
  { key: 'openApproved', label: 'פתוחות ומאושרות לעלייה', color: C.warning },
];

export const UnifiedGoLivePlanView: React.FC<Props> = ({ token, versionId, versionName }) => {
  const [entries, setEntries] = useState<CrEntry[]>([]);
  const [plannedStart, setPlannedStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!versionId);
  const [crDefects, setCrDefects] = useState<Record<string, CrDefectIndicators>>({});
  const [crDefectsLoading, setCrDefectsLoading] = useState<Record<string, boolean>>({});
  const [expandedBucket, setExpandedBucket] = useState<Record<string, DefectBucket | null>>({});
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(() => {
    if (!versionId) return;
    setLoading(true);
    Promise.all([
      axios.get(`${API}/versions/${versionId}/cr-review`, { headers }),
      axios.get(`${API}/versions/${versionId}`, { headers }),
    ]).then(([crRes, vRes]) => {
      setEntries(crRes.data);
      setPlannedStart(vRes.data?.plannedStart ?? null);
    }).finally(() => setLoading(false));
  }, [versionId]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  // Merged plan is release-manager-facing, so unlike the per-team CR-plan
  // screen this intentionally does NOT pass teamName — counts every team's
  // defects on the CR together (spec confirmed 2026-08-29).
  useEffect(() => {
    if (!versionId || entries.length === 0) return;
    for (const e of entries) {
      if (crDefects[e.crNumber] || crDefectsLoading[e.crNumber]) continue;
      setCrDefectsLoading(prev => ({ ...prev, [e.crNumber]: true }));
      axios.get(`${API}/qc/cr-defect-indicators`, { headers, params: { versionId, crNumber: e.crNumber } })
        .then(r => setCrDefects(prev => ({ ...prev, [e.crNumber]: r.data })))
        .catch(() => setCrDefects(prev => ({ ...prev, [e.crNumber]: { fixed: [], open: [], openApproved: [] } })))
        .finally(() => setCrDefectsLoading(prev => ({ ...prev, [e.crNumber]: false })));
    }
  }, [versionId, entries]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '80px', color: C.textMuted, direction: 'rtl', fontFamily: FONT }}>
      <div style={{ fontSize: '36px', marginBottom: '14px' }}>⏳</div>טוען תוכנית מאוחדת...
    </div>
  );

  const allProposals: (Proposal & { crNumber: string; crLabel: string })[] = [];
  for (const e of entries) {
    for (const phaseKey of Object.keys(e.proposalsByPhase)) {
      for (const p of e.proposalsByPhase[Number(phaseKey)]) {
        allProposals.push({ ...p, crNumber: e.crNumber, crLabel: e.crLabel });
      }
    }
  }

  const goLive = plannedStart ? new Date(plannedStart) : null;
  const dayBefore = goLive ? new Date(goLive.getTime() - 86400000) : null;

  const dayParts: DayPart[] = [
    {
      key: 'pre', icon: '☀️', title: 'בוקר לפני הגרסה',
      meta: dayBefore ? `יום לפני חלון השינוי · ${formatDate(dayBefore)}` : 'לפני חלון השינוי',
      items: allProposals.filter(p => p.phase === 1),
    },
    {
      key: 'night', icon: '🌙', title: 'ליל הגרסה',
      meta: goLive ? `חלון השינוי — לפני עליית הגרסה לאוויר · ${formatDate(goLive)}` : 'חלון השינוי — לפני עליית הגרסה לאוויר',
      items: allProposals.filter(p => p.phase === 2 || p.phase === 3),
    },
    {
      key: 'morning', icon: '👤', title: 'בוקר הגרסה',
      meta: 'מיד לאחר עליית הגרסה לאוויר',
      items: allProposals.filter(p => p.phase === 4 && !isFollowUp(p.title)),
    },
    {
      key: 'after', icon: '📅', title: 'יום אחרי',
      meta: 'מעקב שוטף לאחר הגרסה',
      items: allProposals.filter(p => p.phase === 4 && isFollowUp(p.title)),
    },
  ].filter(dp => dp.items.length > 0);

  const totalImpact = allProposals.length;
  const crCount = entries.length;

  let stepCounter = 0;

  return (
    <div style={{ direction: 'rtl', fontFamily: FONT, maxWidth: '820px', margin: '0 auto' }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ ...TEXT['2xl'], fontWeight: WEIGHT.bold, color: C.textPrimary, margin: 0 }}>
          תוכנית מאוחדת לעלייה לאוויר
        </h2>
        <div style={{ ...TEXT.base, color: C.textMuted, marginTop: '4px' }}>
          {versionName ?? ''} · כל הצוותים סיימו הגשה — תסריט אחד רציף לכל אורך חלון השינוי, לפי סדר זמנים, לקריאה בשיחת הגרסה
        </div>
      </div>

      {/* ── KPI tiles ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '32px' }}>
        {[
          { label: 'משימות עם השפעה תפעולית', value: totalImpact },
          { label: 'משימות בתסריט המאוחד', value: totalImpact },
          { label: 'CR-ים בתוכנית', value: crCount },
        ].map(kpi => (
          <div key={kpi.label} style={{
            background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg,
            padding: '16px 18px', boxShadow: SHADOW.card,
          }}>
            <div style={{ ...TEXT['2xl'], fontWeight: WEIGHT.bold, color: C.textPrimary }}>{kpi.value}</div>
            <div style={{ ...TEXT.sm, color: C.textMuted, marginTop: '2px' }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* ── Per-CR defect indicators — counted across all teams (spec 2026-08-29) ── */}
      {entries.length > 0 && (
        <div style={{ marginBottom: '32px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textMuted }}>🐛 תקלות מול כל CR — כלל הצוותים</div>
          {entries.map(e => {
            const ind = crDefects[e.crNumber];
            const indLoading = crDefectsLoading[e.crNumber];
            const expanded = expandedBucket[e.crNumber] ?? null;
            const list = expanded && ind ? ind[expanded] : [];
            return (
              <div key={e.crNumber} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '10px 14px', boxShadow: SHADOW.xs }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap', fontSize: '12px' }}>
                  <span style={{ color: C.textPrimary, fontWeight: WEIGHT.semibold, fontFamily: 'monospace' }}>{e.crLabel || e.crNumber}</span>
                  {indLoading && !ind ? (
                    <span style={{ color: C.textMuted }}>טוען...</span>
                  ) : ind && defectBuckets().map(b => (
                    <button
                      key={b.key}
                      onClick={() => setExpandedBucket(prev => ({ ...prev, [e.crNumber]: prev[e.crNumber] === b.key ? null : b.key }))}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: FONT,
                        display: 'flex', alignItems: 'center', gap: '5px',
                        fontWeight: expanded === b.key ? WEIGHT.bold : WEIGHT.normal,
                        color: expanded === b.key ? b.color : C.textSecondary,
                        textDecoration: expanded === b.key ? 'underline' : 'none',
                      }}
                    >
                      {b.label}: <span style={{ fontWeight: WEIGHT.bold, color: b.color }}>{ind[b.key].length}</span>
                    </button>
                  ))}
                </div>
                {expanded && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '220px', overflowY: 'auto' }}>
                    {list.length === 0 ? (
                      <div style={{ fontSize: '12px', color: C.textMuted }}>אין תקלות ברשימה זו.</div>
                    ) : list.map((d: any) => (
                      <div key={d.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '12px', padding: '5px 8px', background: C.bgNested, borderRadius: RADIUS.sm, border: `1px solid ${C.border}` }}>
                        <span style={{ fontWeight: WEIGHT.bold, color: C.textLink, flexShrink: 0 }}>{d.id}</span>
                        <span style={{ color: C.textPrimary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title || d.subject}</span>
                        <span style={{ color: C.textMuted, flexShrink: 0 }}>{d.status}</span>
                        <span style={{ color: C.textMuted, flexShrink: 0, direction: 'ltr' }}>{d.detectedInRelease} → {d.targetRelease || '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {dayParts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, ...TEXT.base }}>
          עדיין אין משימות בעלות השפעה תפעולית בתוכנית זו
        </div>
      ) : (
        /* ── Continuous story thread ── */
        <div style={{ position: 'relative' }}>
          <div style={{
            position: 'absolute', top: '24px', bottom: '24px', right: '23px',
            width: '2px', background: C.border,
          }} />

          {dayParts.map(dp => (
            <div key={dp.key} style={{ marginBottom: '28px' }}>
              {/* Day-part node */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px', position: 'relative' }}>
                <div style={{
                  width: '48px', height: '48px', borderRadius: RADIUS.full, flexShrink: 0,
                  background: C.moduleGoLive, color: '#fff', fontSize: '22px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: SHADOW.sm, zIndex: 1,
                }}>
                  {dp.icon}
                </div>
                <div>
                  <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{dp.title}</div>
                  <div style={{ ...TEXT.sm, color: C.textMuted }}>{dp.meta}</div>
                </div>
              </div>

              {/* Step cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingInlineStart: '64px' }}>
                {dp.items.map(item => {
                  stepCounter += 1;
                  const num = String(stepCounter).padStart(2, '0');
                  const tColor = teamColor(item.teamName);
                  return (
                    <div key={item.id} style={{
                      display: 'flex', alignItems: 'flex-start', gap: '12px',
                      background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.md,
                      padding: '12px 14px', boxShadow: SHADOW.xs,
                    }}>
                      <div style={{
                        width: '28px', height: '28px', borderRadius: RADIUS.full, flexShrink: 0,
                        background: C.bgNested, color: C.textSecondary, fontWeight: WEIGHT.bold,
                        fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'monospace',
                      }}>
                        {num}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...TEXT.base, fontWeight: WEIGHT.medium, color: C.textPrimary, lineHeight: 1.6 }}>
                          {narrativeSentence(item)}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                          <span style={{
                            ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.warning, background: C.warningBg,
                            borderRadius: RADIUS.sm, padding: '2px 8px',
                          }}>
                            משפיע
                          </span>
                          <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: 'monospace' }}>
                            {item.crLabel || item.crNumber}
                          </span>
                          <span style={{
                            ...TEXT.xs, fontWeight: WEIGHT.semibold, color: '#fff',
                            background: tColor, borderRadius: RADIUS.sm, padding: '2px 8px',
                          }}>
                            {item.teamName}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
