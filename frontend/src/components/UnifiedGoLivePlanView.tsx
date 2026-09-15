import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { C } from '../theme';
import { cn } from '../lib/utils';
import { formatDate } from '../utils/dateFormat';
import { DefectIdBadge, teamColor } from './shared/defectFieldDisplay';

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
    <div className="text-center p-20 text-subtle-foreground">
      <div className="text-4xl mb-3.5">⏳</div>טוען תוכנית מאוחדת...
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
    <div className="max-w-[820px] mx-auto">
      {/* ── Header ── */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground m-0">
          תוכנית מאוחדת לעלייה לאוויר
        </h2>
        <div className="text-base text-subtle-foreground mt-1">
          {versionName ?? ''} · כל הצוותים סיימו הגשה — תסריט אחד רציף לכל אורך חלון השינוי, לפי סדר זמנים, לקריאה בשיחת הגרסה
        </div>
      </div>

      {/* ── KPI tiles ── */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { label: 'משימות עם השפעה תפעולית', value: totalImpact },
          { label: 'משימות בתסריט המאוחד', value: totalImpact },
          { label: 'CR-ים בתוכנית', value: crCount },
        ].map(kpi => (
          <div key={kpi.label} className="bg-card border border-border rounded-lg py-4 px-[18px] shadow-xs">
            <div className="text-2xl font-bold text-foreground">{kpi.value}</div>
            <div className="text-sm text-subtle-foreground mt-0.5">{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* ── Per-CR defect indicators — counted across all teams (spec 2026-08-29) ── */}
      {entries.length > 0 && (
        <div className="mb-8 flex flex-col gap-2">
          <div className="text-sm font-semibold text-subtle-foreground">🪲 תקלות מול כל CR — כלל הצוותים</div>
          {entries.map(e => {
            const ind = crDefects[e.crNumber];
            const indLoading = crDefectsLoading[e.crNumber];
            const expanded = expandedBucket[e.crNumber] ?? null;
            const list = expanded && ind ? ind[expanded] : [];
            return (
              <div key={e.crNumber} className="bg-card border border-border rounded-md py-2.5 px-3.5 shadow-xs">
                <div className="flex items-center gap-[18px] flex-wrap text-xs">
                  <span className="text-foreground font-semibold font-mono">{e.crLabel || e.crNumber}</span>
                  {indLoading && !ind ? (
                    <span className="text-subtle-foreground">טוען...</span>
                  ) : ind && defectBuckets().map(b => (
                    <button
                      key={b.key}
                      onClick={() => setExpandedBucket(prev => ({ ...prev, [e.crNumber]: prev[e.crNumber] === b.key ? null : b.key }))}
                      className={cn(
                        'bg-transparent border-none cursor-pointer p-0 flex items-center gap-[5px]',
                        expanded === b.key ? 'font-bold underline' : 'font-normal no-underline'
                      )}
                      style={{ color: expanded === b.key ? b.color : C.textSecondary }}
                    >
                      {b.label}: <span className="font-bold" style={{ color: b.color }}>{ind[b.key].length}</span>
                    </button>
                  ))}
                </div>
                {expanded && (
                  <div className="mt-2.5 flex flex-col gap-1 max-h-[220px] overflow-y-auto">
                    {list.length === 0 ? (
                      <div className="text-xs text-subtle-foreground">אין תקלות ברשימה זו.</div>
                    ) : list.map((d: any) => (
                      <div key={d.id} className="flex gap-2.5 items-center text-xs py-[5px] px-2 bg-muted rounded-sm border border-border">
                        <DefectIdBadge id={d.id} />
                        <span className="text-foreground flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{d.title || d.subject}</span>
                        <span className="text-subtle-foreground shrink-0">{d.status}</span>
                        <span className="text-subtle-foreground shrink-0" dir="ltr">{d.detectedInRelease} → {d.targetRelease || '—'}</span>
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
        <div className="text-center p-[60px] text-subtle-foreground text-base">
          עדיין אין משימות בעלות השפעה תפעולית בתוכנית זו
        </div>
      ) : (
        /* ── Continuous story thread ── */
        <div className="relative">
          <div className="absolute top-6 bottom-6 start-[23px] w-[2px] bg-border" />

          {dayParts.map(dp => (
            <div key={dp.key} className="mb-7">
              {/* Day-part node */}
              <div className="flex items-center gap-4 mb-4 relative">
                <div
                  className="w-12 h-12 rounded-full shrink-0 text-white text-[22px] flex items-center justify-center shadow-sm z-[1]"
                  style={{ background: C.moduleGoLive }}
                >
                  {dp.icon}
                </div>
                <div>
                  <div className="text-lg font-bold text-foreground">{dp.title}</div>
                  <div className="text-sm text-subtle-foreground">{dp.meta}</div>
                </div>
              </div>

              {/* Step cards */}
              <div className="flex flex-col gap-2.5 ps-16">
                {dp.items.map(item => {
                  stepCounter += 1;
                  const num = String(stepCounter).padStart(2, '0');
                  const tColor = teamColor(item.teamName);
                  return (
                    <div key={item.id} className="flex items-start gap-3 bg-card border border-border rounded-md py-3 px-3.5 shadow-xs">
                      <div className="w-7 h-7 rounded-full shrink-0 bg-muted text-muted-foreground font-bold text-[13px] flex items-center justify-center font-mono">
                        {num}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-base font-medium text-foreground leading-[1.6]">
                          {narrativeSentence(item)}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-warning bg-warning-bg rounded-sm py-0.5 px-2">
                            משפיע
                          </span>
                          <span className="text-xs text-subtle-foreground font-mono">
                            {item.crLabel || item.crNumber}
                          </span>
                          <span
                            className="text-xs font-semibold rounded-sm py-0.5 px-2"
                            style={{ background: tColor.bg, color: tColor.color }}
                          >
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
