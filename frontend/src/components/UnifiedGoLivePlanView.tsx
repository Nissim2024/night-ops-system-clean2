import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, RADIUS, SHADOW } from '../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Proposal {
  id: string; teamId: string; teamName: string; title: string;
  app?: string; actionType?: string; phase: number; notes?: string;
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

function fmtDate(d: Date): string {
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
}

export const UnifiedGoLivePlanView: React.FC<Props> = ({ token, versionId, versionName }) => {
  const [entries, setEntries] = useState<CrEntry[]>([]);
  const [plannedStart, setPlannedStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!versionId);
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
      meta: dayBefore ? `יום לפני חלון השינוי · ${fmtDate(dayBefore)}` : 'לפני חלון השינוי',
      items: allProposals.filter(p => p.phase === 1),
    },
    {
      key: 'night', icon: '🌙', title: 'ליל הגרסה',
      meta: goLive ? `חלון השינוי — לפני עליית הגרסה לאוויר · ${fmtDate(goLive)}` : 'חלון השינוי — לפני עליית הגרסה לאוויר',
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
                        <div style={{ ...TEXT.base, fontWeight: WEIGHT.medium, color: C.textPrimary }}>
                          {item.title}
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
