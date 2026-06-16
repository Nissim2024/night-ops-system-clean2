import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C } from '../theme';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const PHASE_LABEL: Record<number, string> = {
  1: 'בוקר גרסה', 2: 'HOTNET', 3: 'HOT', 4: 'בוקר לאחר גרסה',
};
const PHASE_COLOR: Record<number, { bg: string; color: string }> = {
  1: { bg: 'rgba(88,166,255,0.18)',  color: '#58a6ff' },
  2: { bg: 'rgba(63,185,80,0.18)',   color: '#3fb950' },
  3: { bg: 'rgba(240,136,62,0.18)',  color: '#f0883e' },
  4: { bg: 'rgba(163,113,247,0.18)', color: '#a371f7' },
};
const RISK: Record<string, { color: string; bg: string; label: string }> = {
  LOW:    { color: '#3fb950', bg: 'rgba(63,185,80,0.15)',    label: 'סיכון נמוך'   },
  MEDIUM: { color: '#d29922', bg: 'rgba(210,153,34,0.15)',   label: 'סיכון בינוני' },
  HIGH:   { color: '#f85149', bg: 'rgba(248,81,73,0.18)',    label: 'סיכון גבוה'   },
};

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface TeamInfo  { id: string; name: string }
interface CrAssign  { crNumber: string; crLabel?: string; crManager?: string; crDescription?: string; team: TeamInfo }
interface CrPlan    {
  id: string; crNumber: string; crLabel?: string; crManager?: string; crDescription?: string;
  crType?: string; riskLevel?: string; systems?: string[]; workPlan?: string; scripts?: string; rollbackPlan?: string;
  nightTestingNotes?: string; morningMonitoring?: string; gradualRollout: boolean; gradualDetails?: string;
  notNeededForPlan: boolean; planApproved: boolean; planApprovedAt?: string;
  team: TeamInfo;
}
interface Proposal  { id: string; title: string; phase: number; actionType?: string; app?: string; estimatedMins?: number; assignedUserName?: string; notes?: string; status: string; crNumber?: string; teamId: string; }
interface TeamSub   { teamId: string; status: string }

interface Props {
  token: string;
  versionId: string;
  versionStatus: string;
  isManager: boolean;
  section?: 'teams' | 'crs' | 'all'; // default 'all'
  defaultTeamPanelOpen?: boolean;
  refreshKey?: number;
  onAllApproved?: (approved: boolean) => void;
  onTeamReview?: (teamId: string, teamName: string) => void;
}

/* ─── Component ────────────────────────────────────────────────────────────── */
export const CrPlanReviewPanel: React.FC<Props> = ({
  token, versionId, isManager, section = 'all', defaultTeamPanelOpen, refreshKey, onAllApproved, onTeamReview,
}) => {
  const headers = { Authorization: `Bearer ${token}` };

  const [assignments, setAssignments] = useState<CrAssign[]>([]);
  const [crPlans,     setCrPlans]     = useState<CrPlan[]>([]);
  const [proposals,   setProposals]   = useState<Proposal[]>([]);
  const [submissions, setSubmissions] = useState<TeamSub[]>([]);
  const [expanded,     setExpanded]    = useState<Set<string>>(new Set());
  const [crFilter,     setCrFilter]    = useState<'all' | 'pending' | 'approved' | 'not_required'>('all');
  const [dialog,       setDialog]      = useState<DialogConfig | null>(null);
  const [approving,    setApproving]   = useState<Set<string>>(new Set());
  const [loading,      setLoading]     = useState(true);
  const [teamPanelOpen, setTeamPanelOpen] = useState(defaultTeamPanelOpen ?? false);
  const [summaries,     setSummaries]   = useState<Record<string, string>>({});
  const [summarizingCr, setSummarizingCr] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ar, pr, prop, sub] = await Promise.all([
        axios.get(`${API}/version-cr-assignments/version/${versionId}`, { headers }),
        axios.get(`${API}/cr-plans/version/${versionId}`,               { headers }),
        axios.get(`${API}/task-proposals/version/${versionId}`,         { headers }),
        axios.get(`${API}/versions/${versionId}/submissions`,           { headers }),
      ]);
      setAssignments(ar.data);
      setCrPlans(pr.data);
      setProposals(prop.data);
      setSubmissions(sub.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [versionId]); // eslint-disable-line

  useEffect(() => { fetchAll(); }, [fetchAll, refreshKey]); // eslint-disable-line

  /* notify parent — all teams must have SUBMITTED and all team-CR pairs approved */
  useEffect(() => {
    if (!assignments.length) return;
    const subMap = Object.fromEntries(submissions.map(s => [s.teamId, s.status]));
    const allOk = assignments.every(assign => {
      if (subMap[assign.team.id] !== 'SUBMITTED') return false;
      const plans = crPlans.filter(p => p.crNumber === assign.crNumber && p.team.id === assign.team.id);
      if (plans.length === 0) return false;
      return plans.every(p => p.planApproved || p.notNeededForPlan);
    });
    onAllApproved?.(allOk);
  }, [crPlans, assignments, submissions]); // eslint-disable-line

  const summarizeCr = async (crNumber: string) => {
    setSummarizingCr(crNumber);
    try {
      const r = await axios.post(`${API}/versions/${versionId}/cr-review/${crNumber}/summarize`, {}, { headers });
      setSummaries(prev => ({ ...prev, [crNumber]: r.data.summary }));
    } catch (e: any) {
      setSummaries(prev => ({ ...prev, [crNumber]: `שגיאה: ${e?.response?.data?.message || e.message}` }));
    } finally {
      setSummarizingCr(null);
    }
  };

  const approveCr = async (crNumber: string, approve: boolean) => {
    setApproving(p => new Set(p).add(crNumber));
    try {
      await axios.patch(`${API}/cr-plans/version/${versionId}/${approve ? 'approve-cr' : 'unapprove-cr'}`, { crNumber }, { headers });
      setCrPlans(prev => prev.map(p => p.crNumber === crNumber ? { ...p, planApproved: approve, planApprovedAt: approve ? new Date().toISOString() : undefined } : p));
    } finally {
      setApproving(p => { const n = new Set(p); n.delete(crNumber); return n; });
    }
  };

  const toggle = (cr: string) => setExpanded(prev => { const n = new Set(prev); n.has(cr) ? n.delete(cr) : n.add(cr); return n; });

  /* derived */
  // Include CRs from crPlans even if their assignment was removed by sync
  const allCrNumbers  = Array.from(new Set([
    ...assignments.map(a => a.crNumber),
    ...crPlans.map(p => p.crNumber),
  ])).sort();
  const involvedTeams = Array.from(new Map(assignments.map(a => [a.team.id, a.team])).values()).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const subByTeam     = Object.fromEntries(submissions.map(s => [s.teamId, s.status]));

  const approvedCount = allCrNumbers.filter(cr => {
    const plans = crPlans.filter(p => p.crNumber === cr);
    return plans.length > 0 && plans.every(p => p.planApproved || p.notNeededForPlan);
  }).length;
  const allApproved = allCrNumbers.length > 0 && approvedCount === allCrNumbers.length;
  const pct = allCrNumbers.length ? Math.round((approvedCount / allCrNumbers.length) * 100) : 0;

  // כמה צוותים הגישו (לפי TeamSubmission.status === SUBMITTED — הגשה מפורשת של ראש צוות)
  const teamsAllCovered = involvedTeams.filter(t => subByTeam[t.id] === 'SUBMITTED').length;
  const allTeamsSubmitted = involvedTeams.length > 0 && teamsAllCovered === involvedTeams.length;
  const submissionPct = involvedTeams.length ? Math.round((teamsAllCovered / involvedTeams.length) * 100) : 0;

  if (loading) return (
    <div style={{ padding: '20px', textAlign: 'center', color: C.textMuted, fontSize: '13px' }}>⏳ טוען...</div>
  );

  /* ──────────────────────────────────────────────────────────────────────────
     PART A — Team cards grid (identical to COLLECTING submission panel)
  ─────────────────────────────────────────────────────────────────────────── */
  const teamGrid = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '10px', padding: '12px' }}>
      {involvedTeams.map(team => {
        const sub         = subByTeam[team.id] ?? 'NOT_STARTED';
        const hasSubmitted = sub === 'SUBMITTED';
        const teamCrs     = assignments.filter(a => a.team.id === team.id).map(a => a.crNumber);

        // כמה CR-ים אושרו על ידי המנהל (רלוונטי רק אם הצוות הגיש)
        const managerApproved = teamCrs.filter(cr => {
          const pl = crPlans.filter(p => p.crNumber === cr && p.team.id === team.id);
          return pl.length > 0 && pl.every(p => p.planApproved || p.notNeededForPlan);
        }).length;
        const allApprovedForTeam = hasSubmitted && managerApproved === teamCrs.length;

        const accent    = allApprovedForTeam ? '#16a34a'   // הגיש + אושר הכל
                        : hasSubmitted       ? '#2980b9'   // הגיש — ממתין לאישור מנהל
                        :                     '#ef4444';   // לא הגיש
        const textColor = allApprovedForTeam ? '#14532d'
                        : hasSubmitted       ? '#1a3a5c'
                        :                     '#7f1d1d';
        const desc      = allApprovedForTeam
          ? `הוגש ואושר — ${teamCrs.length} פיתוחים ✓`
          : hasSubmitted
          ? `הוגש — ${managerApproved} מתוך ${teamCrs.length} פיתוחים אושרו`
          : `לא הגיש — ${teamCrs.length} פיתוח${teamCrs.length !== 1 ? 'ים' : ''} ממתינים`;

        return (
          <div key={team.id} style={{
            borderRadius: '10px', border: `1px solid ${accent}33`, borderTop: `4px solid ${accent}`,
            background: '#fafafa', padding: '12px 14px',
            display: 'flex', flexDirection: 'column', gap: '6px',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            <span style={{ fontWeight: '800', fontSize: '14px', color: '#1a2332', lineHeight: 1.2 }}>{team.name}</span>
            <span style={{ fontSize: '12px', color: textColor, lineHeight: 1.5, flex: 1 }}>{desc}</span>
            <button
              onClick={() => onTeamReview?.(team.id, team.name)}
              style={{ marginTop: '4px', padding: '5px 0', background: 'transparent', color: '#2d4a7a', border: '1px solid #2d4a7a', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', width: '100%' }}
            >
              סקירה ←
            </button>
          </div>
        );
      })}
    </div>
  );

  /* ──────────────────────────────────────────────────────────────────────────
     PART B — CR list (outside the collapsible panel, always visible)
  ─────────────────────────────────────────────────────────────────────────── */
  const crList = (
    <div style={{ marginTop: '16px' }}>
      {/* Summary bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 14px', background: C.bgNested, borderRadius: '8px', border: `1px solid ${C.border}`, marginBottom: '10px' }}>
        <div style={{ flex: 1, height: '6px', background: C.border, borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: '3px', background: allApproved ? '#3fb950' : '#f0883e', width: `${pct}%`, transition: 'width 0.4s', boxShadow: allApproved ? '0 0 6px #3fb950' : '0 0 4px #f0883e' }} />
        </div>
        <span style={{ fontSize: '12px', fontWeight: '700', color: allApproved ? '#3fb950' : '#f0883e', whiteSpace: 'nowrap' }}>
          {approvedCount}/{allCrNumbers.length} CR אושרו
        </span>
        {!allApproved && isManager && (
          <span style={{ fontSize: '11px', color: '#d29922', background: 'rgba(210,153,34,0.15)', padding: '2px 10px', borderRadius: '6px', border: '1px solid rgba(210,153,34,0.3)', whiteSpace: 'nowrap' }}>
            👆 לחץ "אשר תוכנית" על כל CR
          </span>
        )}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
        {([
          ['all',          'הצג הכל',      allCrNumbers.length],
          ['pending',      'ממתין לאישור', allCrNumbers.filter(cr => { const p = crPlans.filter(x => x.crNumber === cr); return !(p.length > 0 && p.every(x => x.planApproved || x.notNeededForPlan)); }).length],
          ['approved',     '✅ אושר',       approvedCount],
          ['not_required', 'לא נדרש',      allCrNumbers.filter(cr => { const p = crPlans.filter(x => x.crNumber === cr); return p.length > 0 && p.every(x => x.notNeededForPlan); }).length],
        ] as [typeof crFilter, string, number][]).map(([key, label, count]) => (
          <button key={key} onClick={() => setCrFilter(key)}
            style={{
              padding: '5px 12px', border: 'none', borderRadius: '20px', cursor: 'pointer',
              fontSize: '12px', fontWeight: '600',
              background: crFilter === key ? '#1a2332' : '#f0f0f0',
              color: crFilter === key ? 'white' : '#555',
            }}>
            {label} <span style={{ opacity: 0.7 }}>({count})</span>
          </button>
        ))}
      </div>

      {/* CR rows */}
      {allCrNumbers.filter(crNumber => {
        if (crFilter === 'all') return true;
        const p = crPlans.filter(x => x.crNumber === crNumber);
        if (crFilter === 'approved')     return p.length > 0 && p.every(x => x.planApproved || x.notNeededForPlan);
        if (crFilter === 'pending')      return !(p.length > 0 && p.every(x => x.planApproved || x.notNeededForPlan));
        if (crFilter === 'not_required') return p.length > 0 && p.every(x => x.notNeededForPlan);
        return true;
      }).map((crNumber, idx) => {
        const assigns    = assignments.filter(a => a.crNumber === crNumber);
        const rawLabel   = assigns[0]?.crLabel ?? crNumber;
        const crTitle    = rawLabel.replace(`${crNumber} - `, '').replace(`${crNumber} `, '');
        const crManager  = assigns[0]?.crManager ?? '';
        const crDesc     = assigns[0]?.crDescription ?? '';
        const teamsForCr = assigns.map(a => a.team);
        const plans      = crPlans.filter(p => p.crNumber === crNumber);
        const propsForCr = proposals.filter(p => p.crNumber === crNumber);
        const isNotNeeded= plans.length > 0 && plans.every(p => p.notNeededForPlan);
        const isApproved = plans.length > 0 && plans.every(p => p.planApproved || p.notNeededForPlan);
        const teamsWithProps    = new Set(propsForCr.map(p => p.teamId));
        const teamsNotRequired  = new Set(plans.filter(p => p.notNeededForPlan).map(p => p.team.id));
        const missingTeams      = teamsForCr.filter(t => !teamsWithProps.has(t.id) && !teamsNotRequired.has(t.id));
        const canApprove        = missingTeams.length === 0;
        const isOpen     = expanded.has(crNumber);
        const isApp      = approving.has(crNumber);
        const highRisk   = plans.find(p => p.riskLevel === 'HIGH')?.riskLevel ?? plans.find(p => p.riskLevel === 'MEDIUM')?.riskLevel ?? plans[0]?.riskLevel;
        const borderColor= isNotNeeded ? '#8b949e' : isApproved ? '#3fb950' : idx % 2 === 0 ? '#d4a843' : '#a371f7';

        return (
          <div key={crNumber} style={{ marginBottom: '4px', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${isApproved ? '#3fb95044' : C.border}`, borderRight: `3px solid ${borderColor}` }}>

            {/* Row header — 2 rows, taller */}
            <div
              onClick={() => toggle(crNumber)}
              style={{ padding: '14px 16px', background: C.bgCard, cursor: 'pointer', userSelect: 'none' as any, display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              {/* ── שורה 1: ID + כותרת + סיכון + כפתור אישור + chevron ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* CR number */}
                <span style={{ fontFamily: 'monospace', fontSize: '13px', fontWeight: '800', background: 'rgba(212,168,67,0.15)', color: '#d4a843', padding: '3px 10px', borderRadius: '5px', border: '1px solid rgba(212,168,67,0.3)', flexShrink: 0 }}>
                  {crNumber}
                </span>

                {/* Title — גדול וברור */}
                <span style={{ flex: 1, fontSize: '16px', fontWeight: '800', color: C.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {crTitle}
                </span>

                {/* Not needed badge */}
                {isNotNeeded && (
                  <span style={{ fontSize: '11px', color: '#8b949e', background: 'rgba(139,148,158,0.15)', padding: '3px 10px', borderRadius: '5px', flexShrink: 0, border: '1px solid rgba(139,148,158,0.3)' }}>
                    ✗ לא נדרש
                  </span>
                )}

                {/* risk */}
                {highRisk && RISK[highRisk] && (
                  <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '5px', fontWeight: '700', flexShrink: 0, background: RISK[highRisk].bg, color: RISK[highRisk].color }}>
                    {RISK[highRisk].label}
                  </span>
                )}

                {/* Approve button — שמאל */}
                {isManager && !isNotNeeded && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      if (!isApproved && !canApprove) {
                        setDialog({
                          title: 'לא ניתן לאשר תוכנית CR',
                          message: `הצוותים הבאים טרם הגישו תוכנית:\n${missingTeams.map(t => `• ${t.name}`).join('\n')}`,
                          variant: 'warning',
                          confirmLabel: 'הבנתי',
                          onConfirm: () => {},
                        });
                        return;
                      }
                      approveCr(crNumber, !isApproved);
                    }}
                    disabled={isApp}
                    style={{
                      padding: '6px 16px', border: 'none', borderRadius: '6px', cursor: isApp ? 'not-allowed' : 'pointer',
                      fontWeight: '700', fontSize: '13px', flexShrink: 0,
                      background: isApproved ? '#238636' : '#f0883e',
                      color: 'white', opacity: isApp ? 0.5 : 1,
                      boxShadow: isApproved ? '0 0 8px rgba(35,134,54,0.5)' : '0 0 8px rgba(240,136,62,0.4)',
                    }}
                  >
                    {isApp ? '...' : isApproved ? '✅ מאושר' : '👍 אשר תוכנית'}
                  </button>
                )}

                {/* Chevron */}
                <span style={{ color: C.textDisabled, fontSize: '13px', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
              </div>

              {/* ── שורה 2: מטה-דאטה מרוכזת ── */}
              {(() => {
                // מערכות מתוך שדה app במשימות שהוגשו
                const propSystems = Array.from(new Set(propsForCr.map(p => p.app).filter((a): a is string => !!a)));
                const sep = <span style={{ color: C.textMuted, flexShrink: 0, fontSize: '13px' }}>·</span>;
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>

                    {/* מנהל CR */}
                    {crManager && (
                      <span style={{ fontSize: '13px', flexShrink: 0 }}>
                        <span style={{ color: C.textMuted, fontWeight: '600' }}>מנהל CR: </span>
                        <span style={{ color: C.textPrimary, fontWeight: '700' }}>{crManager}</span>
                      </span>
                    )}

                    {crManager && sep}

                    {/* צוותים מעורבים */}
                    {teamsForCr.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px', color: C.textMuted, fontWeight: '600', flexShrink: 0 }}>צוותים מעורבים:</span>
                        {teamsForCr.slice(0, 4).map(t => (
                          <span key={t.id} style={{ fontSize: '12px', background: 'rgba(163,113,247,0.2)', color: '#b48ef5', padding: '2px 9px', borderRadius: '4px', fontWeight: '700', border: '1px solid rgba(163,113,247,0.35)', flexShrink: 0 }}>
                            {t.name}
                          </span>
                        ))}
                        {teamsForCr.length > 4 && (
                          <span style={{ fontSize: '12px', color: C.textSecondary, fontWeight: '700', flexShrink: 0 }}>
                            +{teamsForCr.length - 4} נוספים
                          </span>
                        )}
                      </div>
                    )}

                    {/* משימות */}
                    {propsForCr.length > 0 && (
                      <>{sep}
                        <span style={{ fontSize: '12px', color: C.textSecondary, background: C.bgNested, padding: '2px 9px', borderRadius: '5px', border: `1px solid ${C.border}`, flexShrink: 0, fontWeight: '700' }}>
                          💡 {propsForCr.length} משימות
                        </span>
                      </>
                    )}

                    {/* מערכות מהמשימות שהוגשו */}
                    {propSystems.length > 0 && (
                      <>{sep}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '12px', color: C.textMuted, fontWeight: '600', flexShrink: 0 }}>מערכות:</span>
                          {propSystems.map(s => (
                            <span key={s} style={{ fontSize: '12px', background: C.bgNested, color: C.textPrimary, padding: '2px 8px', borderRadius: '4px', border: `1px solid ${C.border}`, flexShrink: 0, fontWeight: '600' }}>{s}</span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Expanded body */}
            {isOpen && (
              <div style={{ background: C.bgApp, borderTop: `1px solid ${C.border}` }}>

                {/* CR description */}
                {crDesc && (
                  <div style={{ padding: '8px 14px', borderBottom: `1px solid ${C.border}`, background: 'rgba(163,113,247,0.07)', fontSize: '12px', color: '#c9b8f7', display: 'flex', gap: '6px' }}>
                    <span style={{ color: '#a371f7', fontWeight: '700', flexShrink: 0 }}>פרטי CR:</span>
                    <span style={{ lineHeight: 1.5 }}>{crDesc}</span>
                  </div>
                )}

                {/* Not needed notice */}
                {isNotNeeded && (
                  <div style={{ padding: '12px 14px', color: C.textMuted, fontSize: '12px', fontStyle: 'italic' }}>
                    ✗ פיתוח זה סומן כ"לא נדרש לתוכנית" — אינו חוסם מעבר לשלב הבא
                  </div>
                )}

                {/* ── AGGREGATED plan body — nested container ── */}
                {!isNotNeeded && (() => {
                  type AggItem = { team: string; text: string };
                  const workItems:     AggItem[] = plans.filter(p => p.workPlan).map(p => ({ team: p.team.name, text: p.workPlan! }));
                  const nightItems:    AggItem[] = plans.filter(p => p.nightTestingNotes).map(p => ({ team: p.team.name, text: p.nightTestingNotes! }));
                  const morningItems:  AggItem[] = plans.filter(p => p.morningMonitoring).map(p => ({ team: p.team.name, text: p.morningMonitoring! }));
                  const rollbackItems: AggItem[] = plans.filter(p => p.rollbackPlan).map(p => ({ team: p.team.name, text: p.rollbackPlan! }));
                  const gradualItems:  AggItem[] = plans.filter(p => p.gradualRollout && p.gradualDetails).map(p => ({ team: p.team.name, text: p.gradualDetails! }));

                  const aggField = (icon: string, label: string, items: AggItem[], accent: string) => {
                    if (!items.length) return null;
                    const multi = items.length > 1;
                    return (
                      <div style={{ marginBottom: '18px' }}>
                        <div style={{ fontSize: '13px', color: accent, fontWeight: '800', letterSpacing: '0.3px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>{icon}</span><span>{label}</span>
                        </div>
                        {items.map((item, i) => (
                          <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: i < items.length - 1 ? '10px' : 0 }}>
                            <span style={{ color: accent, fontSize: '14px', flexShrink: 0, marginTop: '2px', lineHeight: 1 }}>•</span>
                            {multi && (
                              <span style={{ fontSize: '12px', fontWeight: '700', background: 'rgba(163,113,247,0.2)', color: '#a371f7', padding: '3px 10px', borderRadius: '5px', border: '1px solid rgba(163,113,247,0.3)', flexShrink: 0, whiteSpace: 'nowrap', alignSelf: 'flex-start' }}>
                                {item.team}
                              </span>
                            )}
                            <span style={{ fontSize: '15px', color: C.textSecondary, lineHeight: 1.65, whiteSpace: 'pre-wrap', flex: 1 }}>{item.text}</span>
                          </div>
                        ))}
                      </div>
                    );
                  };

                  const hasContent = workItems.length || nightItems.length || morningItems.length || rollbackItems.length || gradualItems.length;
                  if (!hasContent && plans.length === 0) return (
                    <div style={{ padding: '16px 20px', color: C.textDisabled, fontSize: '14px', fontStyle: 'italic', textAlign: 'center' }}>
                      ראשי הצוותים טרם מילאו תוכנית לפיתוח זה
                    </div>
                  );
                  if (!hasContent) return null;

                  return (
                    <div style={{
                      background: C.bgNested,
                      borderTop: `1px solid ${C.border}`,
                      borderBottom: `1px solid ${C.border}`,
                      borderRight: `3px solid ${C.border}44`,
                    }}>
                      {/* Header + summarize button */}
                      <div style={{ padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ fontSize: '13px', fontWeight: '700', color: '#a371f7' }}>📋 פרטי תכנית CR</span>
                        {isManager && (
                          <button
                            disabled={summarizingCr === crNumber}
                            onClick={() => summarizeCr(crNumber)}
                            style={{ fontSize: '12px', padding: '4px 12px', background: summarizingCr === crNumber ? '#555' : '#6c3483', color: 'white', border: 'none', borderRadius: '7px', cursor: summarizingCr === crNumber ? 'not-allowed' : 'pointer', fontWeight: '600', whiteSpace: 'nowrap' }}
                          >
                            {summarizingCr === crNumber ? '⏳ מסכם...' : '✨ סכם תוכנית'}
                          </button>
                        )}
                      </div>
                      {/* AI summary */}
                      {summaries[crNumber] && (
                        <div style={{ margin: '12px 24px', padding: '14px 18px', background: 'rgba(163,113,247,0.1)', border: '1px solid rgba(163,113,247,0.4)', borderRadius: '8px' }}>
                          <div style={{ fontWeight: '700', fontSize: '12px', color: '#a371f7', marginBottom: '8px' }}>✨ תוכנית מאוחדת (AI)</div>
                          <div style={{ fontSize: '14px', color: C.textSecondary, lineHeight: '1.8', whiteSpace: 'pre-wrap' }}>{summaries[crNumber]}</div>
                          <button onClick={() => setSummaries(prev => { const n = { ...prev }; delete n[crNumber]; return n; })}
                            style={{ marginTop: '8px', fontSize: '11px', padding: '2px 10px', background: 'none', border: '1px solid rgba(163,113,247,0.4)', borderRadius: '5px', color: '#a371f7', cursor: 'pointer' }}>
                            ✕ סגור
                          </button>
                        </div>
                      )}
                      <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '28px' }}>
                        <div>
                          {aggField('📋', 'תוכנית עבודה',            workItems,    '#d4a843')}
                          {aggField('💡', 'המלצות בדיקות ליל גרסה',  nightItems,   '#58a6ff')}
                          {aggField('🌅', 'המלצות בקרות בוקר',        morningItems, '#a371f7')}
                        </div>
                        <div>
                          {aggField('📈', 'עלייה מדורגת',    gradualItems,  '#d29922')}
                          {aggField('🛡️', 'תוכנית Rollback', rollbackItems, '#f85149')}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* ── Tasks: natural story sentences ── */}
                {!isNotNeeded && (() => {
                  const allCrProposals = [...propsForCr].sort((a, b) => a.phase - b.phase || a.teamId.localeCompare(b.teamId));
                  const teamsWithProps = new Set(allCrProposals.map(p => p.teamId));
                  const teamsNotNeeded = new Set(plans.filter(p => p.notNeededForPlan).map(p => p.team.id));
                  const teamsWithoutProps = teamsForCr.filter(t => !teamsWithProps.has(t.id) && !teamsNotNeeded.has(t.id));

                  if (allCrProposals.length === 0 && plans.length > 0) return (
                    <div style={{ padding: '14px 20px', color: C.textDisabled, fontSize: '13px', fontStyle: 'italic', textAlign: 'center' }}>
                      ראשי הצוותים טרם הוסיפו משימות לביצוע
                    </div>
                  );
                  if (allCrProposals.length === 0) return null;

                  return (
                    <div>
                      <div style={{ padding: '8px 20px', fontSize: '12px', color: '#d4a843', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', background: 'rgba(212,168,67,0.05)', borderTop: `1px solid ${C.border}` }}>
                        💡 משימות לביצוע ({allCrProposals.length})
                      </div>
                      {allCrProposals.map((prop, i) => {
                        const ph = PHASE_COLOR[prop.phase] ?? { bg: C.bgNested, color: C.textMuted };
                        const phaseName = PHASE_LABEL[prop.phase] ?? `שלב ${prop.phase}`;
                        const teamName = teamsForCr.find(t => t.id === prop.teamId)?.name
                          ?? plans.find(p => p.team?.id === prop.teamId)?.team?.name
                          ?? prop.teamId;
                        return (
                          <div key={prop.id} style={{
                            padding: '11px 20px',
                            borderTop: `1px solid ${C.border}`,
                            background: i % 2 === 0 ? C.bgApp : C.bgNested,
                            display: 'flex', alignItems: 'flex-start', gap: '10px',
                          }}>
                            {/* משפט — flex: 1 */}
                            <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', rowGap: '5px', columnGap: '6px' }}>
                              <span style={{ color: '#d4a843', fontSize: '15px', lineHeight: 1 }}>•</span>

                              <span style={{ fontSize: '14px', color: C.textSecondary }}>בפעילות</span>

                              {/* [שלב] */}
                              <span style={{ fontSize: '13px', fontWeight: '700', padding: '2px 10px', borderRadius: '5px', background: ph.bg, color: ph.color }}>
                                {phaseName}
                              </span>

                              <span style={{ fontSize: '14px', color: C.textSecondary }}>, צוות</span>

                              {/* [צוות] */}
                              <span style={{ fontSize: '13px', fontWeight: '700', background: 'rgba(163,113,247,0.2)', color: '#b48ef5', padding: '2px 10px', borderRadius: '5px', border: '1px solid rgba(163,113,247,0.35)' }}>
                                {teamName}
                              </span>

                              {prop.assignedUserName && (
                                <span style={{ fontSize: '13px', color: C.textSecondary }}>ע"י {prop.assignedUserName}</span>
                              )}

                              <span style={{ fontSize: '14px', color: C.textSecondary }}>מבצע</span>

                              {/* כותרת המשימה — ללא actionType */}
                              <span style={{ fontSize: '16px', fontWeight: '800', color: C.textPrimary }}>
                                {prop.title}
                              </span>

                              {prop.estimatedMins && (
                                <>
                                  <span style={{ fontSize: '14px', color: C.textMuted }}>·</span>
                                  <span style={{ fontSize: '13px', color: C.textSecondary }}>
                                    משך המשימה <strong style={{ color: C.textPrimary }}>{prop.estimatedMins} דק'</strong>
                                  </span>
                                </>
                              )}

                              {prop.notes && (
                                <div style={{ width: '100%', marginTop: '3px', paddingRight: '20px', fontSize: '13px', color: C.textSecondary, display: 'flex', gap: '5px' }}>
                                  <span>💬</span>
                                  <span>{prop.notes}</span>
                                </div>
                              )}
                            </div>

                            {/* סטטוס — צמוד לשמאל */}
                            <span style={{
                              flexShrink: 0, fontSize: '12px', padding: '3px 10px', borderRadius: '5px', fontWeight: '700',
                              background: prop.status === 'READY' ? 'rgba(63,185,80,0.18)' : 'rgba(210,153,34,0.18)',
                              color:      prop.status === 'READY' ? '#3fb950'              : '#d29922',
                              border:     `1px solid ${prop.status === 'READY' ? 'rgba(63,185,80,0.4)' : 'rgba(210,153,34,0.4)'}`,
                            }}>
                              {prop.status === 'READY' ? 'מוכן' : 'טיוטא'}
                            </span>
                          </div>
                        );
                      })}
                      {teamsWithoutProps.length > 0 && (
                        <div style={{ padding: '8px 20px', borderTop: `1px solid ${C.border}`, background: C.bgCard, fontSize: '13px', color: C.textDisabled, fontStyle: 'italic' }}>
                          לא הוגשו משימות מ{teamsWithoutProps.length > 1 ? 'צוותים' : 'צוות'}: {teamsWithoutProps.map(t => t.name).join(', ')}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}

      {allCrNumbers.length === 0 && (
        <div style={{ padding: '32px', textAlign: 'center', color: C.textMuted, fontSize: '13px', background: C.bgCard, borderRadius: '8px', border: `1px solid ${C.border}` }}>
          לא נמצאו CR-ים — בצע סינכרון מקובץ CR_LIST
        </div>
      )}
    </div>
  );

  /* ─── Render ──────────────────────────────────────────────────────────────── */

  // section="teams" — רק פאנל הצוותים המתקפל (בתוך החלונית)
  if (section === 'teams') return (
    <div style={{ direction: 'rtl', fontFamily: "'IBM Plex Sans Hebrew', Arial, sans-serif" }}>
      <div style={{ background: C.bgCard, border: `1px solid ${allTeamsSubmitted ? '#3fb95044' : C.border}`, borderRadius: '12px', overflow: 'hidden', boxShadow: allTeamsSubmitted ? '0 0 0 3px rgba(63,185,80,0.08)' : 'none' }}>
        <div
          onClick={() => setTeamPanelOpen(p => !p)}
          style={{ padding: '10px 16px', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: allTeamsSubmitted ? 'rgba(63,185,80,0.10)' : 'rgba(248,81,73,0.08)' }}
        >
          <span style={{ fontSize: '13px', fontWeight: '700', color: allTeamsSubmitted ? C.statusDone : C.statusBlocked, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{allTeamsSubmitted ? '✅' : '●'}</span>
            {allTeamsSubmitted
              ? `כל ${involvedTeams.length} הצוותים הגישו · אושרו: ${approvedCount}/${allCrNumbers.length} CR`
              : `הגישו: ${teamsAllCovered}/${involvedTeams.length} צוותים · אושרו: ${approvedCount}/${allCrNumbers.length} CR`}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '80px', height: '5px', background: C.border, borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: '3px', background: allTeamsSubmitted ? '#3fb950' : '#f0883e', width: `${submissionPct}%`, transition: 'width 0.4s' }} />
            </div>
            <span style={{ fontSize: '13px', color: C.textMuted, transform: teamPanelOpen ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>▼</span>
          </div>
        </div>
        {teamPanelOpen && teamGrid}
      </div>
    </div>
  );

  // section="crs" — רק רשימת הפיתוחים (מחוץ לחלונית)
  if (section === 'crs') return (
    <div style={{ direction: 'rtl', fontFamily: "'IBM Plex Sans Hebrew', Arial, sans-serif" }}>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />
      {crList}
    </div>
  );

  // section="all" (ברירת מחדל) — שניהם
  return (
    <div style={{ direction: 'rtl', fontFamily: "'IBM Plex Sans Hebrew', Arial, sans-serif" }}>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />
      <div style={{ background: C.bgCard, border: `1px solid ${allTeamsSubmitted ? '#3fb95044' : C.border}`, borderRadius: '12px', overflow: 'hidden', marginBottom: '16px', boxShadow: allTeamsSubmitted ? '0 0 0 3px rgba(63,185,80,0.08)' : 'none' }}>
        <div
          onClick={() => setTeamPanelOpen(p => !p)}
          style={{ padding: '10px 16px', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: allTeamsSubmitted ? 'rgba(63,185,80,0.10)' : 'rgba(248,81,73,0.08)' }}
        >
          <span style={{ fontSize: '13px', fontWeight: '700', color: allTeamsSubmitted ? C.statusDone : C.statusBlocked, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{allTeamsSubmitted ? '✅' : '●'}</span>
            {allTeamsSubmitted
              ? `כל ${involvedTeams.length} הצוותים הגישו · אושרו: ${approvedCount}/${allCrNumbers.length} CR`
              : `הגישו: ${teamsAllCovered}/${involvedTeams.length} צוותים · אושרו: ${approvedCount}/${allCrNumbers.length} CR`}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '80px', height: '5px', background: C.border, borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: '3px', background: allTeamsSubmitted ? '#3fb950' : '#f0883e', width: `${submissionPct}%`, transition: 'width 0.4s' }} />
            </div>
            <span style={{ fontSize: '13px', color: C.textMuted, transform: teamPanelOpen ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>▼</span>
          </div>
        </div>
        {teamPanelOpen && teamGrid}
      </div>
      {crList}
    </div>
  );
};
