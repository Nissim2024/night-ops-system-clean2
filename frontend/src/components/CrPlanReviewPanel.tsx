import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C, FONT } from '../theme';
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
  section?: 'teams' | 'crs' | 'all';
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

  const [assignments,   setAssignments]   = useState<CrAssign[]>([]);
  const [crPlans,       setCrPlans]       = useState<CrPlan[]>([]);
  const [proposals,     setProposals]     = useState<Proposal[]>([]);
  const [submissions,   setSubmissions]   = useState<TeamSub[]>([]);
  const [selectedCr,    setSelectedCr]    = useState<string | null>(null);
  const [selectedTab,   setSelectedTab]   = useState<'plan' | 'tasks'>('plan');
  const [crFilter,      setCrFilter]      = useState<'all' | 'pending' | 'approved' | 'not_required'>('all');
  const [dialog,        setDialog]        = useState<DialogConfig | null>(null);
  const [approving,     setApproving]     = useState<Set<string>>(new Set());
  const [loading,       setLoading]       = useState(true);
  const [teamPanelOpen, setTeamPanelOpen] = useState(defaultTeamPanelOpen ?? false);
  const [summaries,     setSummaries]     = useState<Record<string, string>>({});
  const [summaryOpen,   setSummaryOpen]   = useState<Record<string, boolean>>({});
  const [summaryEditing,setSummaryEditing]= useState<Record<string, boolean>>({});
  const [summaryDraft,  setSummaryDraft]  = useState<Record<string, string>>({});
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

  /* notify parent */
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

  /* auto-select first CR */
  useEffect(() => {
    const nums = Array.from(new Set([
      ...assignments.map(a => a.crNumber),
      ...crPlans.map(p => p.crNumber),
    ])).sort();
    if (nums.length > 0 && !selectedCr) setSelectedCr(nums[0]);
  }, [assignments, crPlans]); // eslint-disable-line

  const summarizeCr = async (crNumber: string) => {
    setSummarizingCr(crNumber);
    try {
      const r = await axios.post(`${API}/versions/${versionId}/cr-review/${crNumber}/summarize`, {}, { headers });
      setSummaries(prev => ({ ...prev, [crNumber]: r.data.summary }));
      setSummaryOpen(prev => ({ ...prev, [crNumber]: true }));
      setSummaryEditing(prev => ({ ...prev, [crNumber]: false }));
    } catch (e: any) {
      setSummaries(prev => ({ ...prev, [crNumber]: `שגיאה: ${e?.response?.data?.message || e.message}` }));
      setSummaryOpen(prev => ({ ...prev, [crNumber]: true }));
    } finally { setSummarizingCr(null); }
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

  /* derived */
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
  const allApproved       = allCrNumbers.length > 0 && approvedCount === allCrNumbers.length;
  const pct               = allCrNumbers.length ? Math.round((approvedCount / allCrNumbers.length) * 100) : 0;
  const teamsAllCovered   = involvedTeams.filter(t => subByTeam[t.id] === 'SUBMITTED').length;
  const allTeamsSubmitted = involvedTeams.length > 0 && teamsAllCovered === involvedTeams.length;
  const submissionPct     = involvedTeams.length ? Math.round((teamsAllCovered / involvedTeams.length) * 100) : 0;

  if (loading) return (
    <div style={{ padding: '20px', textAlign: 'center', color: C.textMuted, fontSize: '13px' }}>⏳ טוען...</div>
  );

  /* ──────────────────────────────────────────────────────────────────────────
     PART A — Team cards grid (collapsible, unchanged)
  ─────────────────────────────────────────────────────────────────────────── */
  const teamGrid = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '10px', padding: '12px' }}>
      {involvedTeams.map(team => {
        const sub          = subByTeam[team.id] ?? 'NOT_STARTED';
        const hasSubmitted = sub === 'SUBMITTED';
        const teamCrs      = assignments.filter(a => a.team.id === team.id).map(a => a.crNumber);
        const managerApproved = teamCrs.filter(cr => {
          const pl = crPlans.filter(p => p.crNumber === cr && p.team.id === team.id);
          return pl.length > 0 && pl.every(p => p.planApproved || p.notNeededForPlan);
        }).length;
        const allApprovedForTeam = hasSubmitted && managerApproved === teamCrs.length;
        const accent    = allApprovedForTeam ? '#16a34a' : hasSubmitted ? '#2980b9' : '#ef4444';
        const textColor = allApprovedForTeam ? '#14532d' : hasSubmitted ? '#1a3a5c' : '#7f1d1d';
        const desc      = allApprovedForTeam
          ? `הוגש ואושר — ${teamCrs.length} פיתוחים ✓`
          : hasSubmitted
          ? `הוגש — ${managerApproved} מתוך ${teamCrs.length} פיתוחים אושרו`
          : `לא הגיש — ${teamCrs.length} פיתוח${teamCrs.length !== 1 ? 'ים' : ''} ממתינים`;
        return (
          <div key={team.id} style={{ borderRadius: '10px', border: `1px solid ${accent}33`, borderTop: `4px solid ${accent}`, background: '#fafafa', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <span style={{ fontWeight: '800', fontSize: '14px', color: '#1a2332', lineHeight: 1.2 }}>{team.name}</span>
            <span style={{ fontSize: '12px', color: textColor, lineHeight: 1.5, flex: 1 }}>{desc}</span>
            <button onClick={() => onTeamReview?.(team.id, team.name)}
              style={{ marginTop: '4px', padding: '5px 0', background: 'transparent', color: '#2d4a7a', border: '1px solid #2d4a7a', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', width: '100%' }}>
              סקירה ←
            </button>
          </div>
        );
      })}
    </div>
  );

  /* ──────────────────────────────────────────────────────────────────────────
     PART B — Split panel (left: CR list, right: CR detail)
  ─────────────────────────────────────────────────────────────────────────── */

  const filteredCrNums = allCrNumbers.filter(crNumber => {
    if (crFilter === 'all') return true;
    const p = crPlans.filter(x => x.crNumber === crNumber);
    if (crFilter === 'approved')     return p.length > 0 && p.every(x => x.planApproved || x.notNeededForPlan);
    if (crFilter === 'pending')      return !(p.length > 0 && p.every(x => x.planApproved || x.notNeededForPlan));
    if (crFilter === 'not_required') return p.length > 0 && p.every(x => x.notNeededForPlan);
    return true;
  });

  /* ── Detail panel ── */
  const renderDetail = () => {
    if (!selectedCr) return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDisabled, flexDirection: 'column', gap: '10px' }}>
        <div style={{ fontSize: '32px' }}>📋</div>
        בחר CR מהרשימה לצפייה
      </div>
    );

    const assigns      = assignments.filter(a => a.crNumber === selectedCr);
    const plans        = crPlans.filter(p => p.crNumber === selectedCr);
    const propsForCr   = proposals.filter(p => p.crNumber === selectedCr).sort((a, b) => a.phase - b.phase);
    const rawLabel     = assigns[0]?.crLabel ?? selectedCr;
    const crTitle      = rawLabel.replace(`${selectedCr} - `, '').replace(`${selectedCr} `, '');
    const crManager    = assigns[0]?.crManager ?? '';
    const crDesc       = assigns[0]?.crDescription ?? '';
    const teamsForCr   = assigns.map(a => a.team);
    const allSystems   = Array.from(new Set(plans.flatMap(p => p.systems ?? []))).filter(Boolean);
    const isNotNeeded  = plans.length > 0 && plans.every(p => p.notNeededForPlan);
    const isApproved   = plans.length > 0 && plans.every(p => p.planApproved || p.notNeededForPlan);
    const teamsWithPropsSet   = new Set(propsForCr.map(p => p.teamId));
    const teamsNotRequiredSet = new Set(plans.filter(p => p.notNeededForPlan).map(p => p.team.id));
    const missingTeams = teamsForCr.filter(t => !teamsWithPropsSet.has(t.id) && !teamsNotRequiredSet.has(t.id));
    const highRisk     = plans.find(p => p.riskLevel === 'HIGH')?.riskLevel ?? plans.find(p => p.riskLevel === 'MEDIUM')?.riskLevel ?? plans[0]?.riskLevel;
    const isApp        = approving.has(selectedCr);
    const isSumOpen    = summaryOpen[selectedCr] ?? false;
    const isEditing    = summaryEditing[selectedCr] ?? false;
    const hasSummary   = Boolean(summaries[selectedCr]);

    const workItems     = plans.filter(p => p.workPlan).map(p => ({ team: p.team.name, text: p.workPlan! }));
    const nightItems    = plans.filter(p => p.nightTestingNotes).map(p => ({ team: p.team.name, text: p.nightTestingNotes! }));
    const morningItems  = plans.filter(p => p.morningMonitoring).map(p => ({ team: p.team.name, text: p.morningMonitoring! }));
    const rollbackItems = plans.filter(p => p.rollbackPlan).map(p => ({ team: p.team.name, text: p.rollbackPlan! }));
    const gradualItems  = plans.filter(p => p.gradualRollout && p.gradualDetails).map(p => ({ team: p.team.name, text: p.gradualDetails! }));

    const aggField = (icon: string, label: string, items: { team: string; text: string }[], accent: string) => {
      if (!items.length) return null;
      const multi = items.length > 1;
      return (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', color: accent, fontWeight: 800, marginBottom: '7px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span>{icon}</span><span>{label}</span>
          </div>
          {items.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: '7px', alignItems: 'flex-start', marginBottom: i < items.length - 1 ? '7px' : 0 }}>
              <span style={{ color: accent, fontSize: '13px', flexShrink: 0, marginTop: '2px' }}>•</span>
              {multi && <span style={{ fontSize: '11px', fontWeight: 700, background: 'rgba(163,113,247,0.2)', color: '#a371f7', padding: '1px 7px', borderRadius: '4px', border: '1px solid rgba(163,113,247,0.3)', flexShrink: 0, whiteSpace: 'nowrap' }}>{item.team}</span>}
              <span style={{ fontSize: '13px', color: C.textSecondary, lineHeight: 1.6, whiteSpace: 'pre-wrap', flex: 1 }}>{item.text}</span>
            </div>
          ))}
        </div>
      );
    };

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* ── Topbar ── */}
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, background: C.bgCard, flexShrink: 0 }}>

          {/* Row 1: CR chip · title · risk · approve button */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '13px', fontWeight: 800, background: 'rgba(212,168,67,0.15)', color: '#d4a843', padding: '3px 10px', borderRadius: '5px', border: '1px solid rgba(212,168,67,0.3)', flexShrink: 0 }}>
              {selectedCr}
            </span>
            <div style={{ fontWeight: 700, fontSize: '15px', color: C.textPrimary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {crTitle || '—'}
            </div>
            {highRisk && RISK[highRisk] && (
              <span style={{ fontSize: '11px', padding: '3px 9px', borderRadius: '6px', fontWeight: 700, flexShrink: 0, background: RISK[highRisk].bg, color: RISK[highRisk].color }}>
                {RISK[highRisk].label}
              </span>
            )}
            {isNotNeeded ? (
              <span style={{ fontSize: '12px', color: '#8b949e', background: 'rgba(139,148,158,0.15)', padding: '3px 10px', borderRadius: '99px', border: '1px solid rgba(139,148,158,0.3)', flexShrink: 0 }}>
                ✗ לא נדרש לתוכנית
              </span>
            ) : isApproved ? (
              <>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#3fb950', background: 'rgba(63,185,80,0.1)', padding: '3px 10px', borderRadius: '99px', border: '1px solid rgba(63,185,80,0.3)', flexShrink: 0 }}>✅ מאושר</span>
                {isManager && (
                  <button onClick={() => approveCr(selectedCr, false)} disabled={isApp}
                    style={{ padding: '4px 10px', background: 'white', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: '7px', cursor: 'pointer', fontSize: '11px', flexShrink: 0 }}>
                    בטל אישור
                  </button>
                )}
              </>
            ) : isManager ? (
              <button onClick={() => {
                if (missingTeams.length > 0) {
                  setDialog({ title: 'לא ניתן לאשר תוכנית CR', message: `הצוותים הבאים טרם הגישו תוכנית:\n${missingTeams.map(t => `• ${t.name}`).join('\n')}`, variant: 'warning', confirmLabel: 'הבנתי', onConfirm: () => {} });
                  return;
                }
                approveCr(selectedCr, true);
              }} disabled={isApp}
                style={{ padding: '6px 16px', border: 'none', borderRadius: '7px', cursor: isApp ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '13px', flexShrink: 0, background: '#f0883e', color: 'white', boxShadow: '0 0 8px rgba(240,136,62,0.4)' }}>
                {isApp ? '...' : '👍 אשר תוכנית'}
              </button>
            ) : (
              <span style={{ fontSize: '11px', color: C.textMuted, background: C.bgNested, padding: '3px 9px', borderRadius: '6px', border: `1px solid ${C.border}`, flexShrink: 0 }}>
                {missingTeams.length > 0 ? `ממתין ל-${missingTeams.length} צוותים` : 'ממתין לאישור מנהל'}
              </span>
            )}
          </div>

          {/* Row 2: manager · teams · systems */}
          {(crManager || teamsForCr.length > 0 || allSystems.length > 0) && (
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginTop: '7px', flexWrap: 'wrap' }}>
              {crManager && (
                <span style={{ fontSize: '12px', color: C.textMuted, direction: 'rtl', unicodeBidi: 'isolate' }}>
                  מנהל CR:&nbsp;<bdi style={{ color: C.textSecondary, fontWeight: 600 }}>{crManager}</bdi>
                </span>
              )}
              {teamsForCr.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: C.textMuted }}>צוותים:</span>
                  {teamsForCr.map(t => (
                    <span key={t.id} style={{ fontSize: '11px', background: 'rgba(163,113,247,0.15)', color: '#b48ef5', padding: '1px 7px', borderRadius: '5px', fontWeight: 700, border: '1px solid rgba(163,113,247,0.25)' }}>{t.name}</span>
                  ))}
                </div>
              )}
              {allSystems.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: C.textMuted }}>מערכות:</span>
                  {allSystems.map(sys => (
                    <span key={sys} style={{ fontSize: '11px', background: 'rgba(88,166,255,0.15)', color: '#58a6ff', padding: '1px 7px', borderRadius: '5px', fontWeight: 600, border: '1px solid rgba(88,166,255,0.25)' }}>{sys}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Tabs ── */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, background: C.bgCard, flexShrink: 0 }}>
          {(['plan', 'tasks'] as const).map(tab => {
            const label = tab === 'plan' ? 'תוכנית CR' : `משימות (${propsForCr.length})`;
            const active = selectedTab === tab;
            return (
              <button key={tab} onClick={() => setSelectedTab(tab)}
                style={{ padding: '9px 18px', border: 'none', borderBottom: `2px solid ${active ? C.brand : 'transparent'}`, background: 'transparent', color: active ? C.brand : C.textMuted, cursor: 'pointer', fontWeight: active ? 700 : 400, fontSize: '13px', fontFamily: FONT, transition: 'color 0.15s', flexShrink: 0 }}>
                {label}
              </button>
            );
          })}
        </div>

        {/* ── Tab content ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>

          {selectedTab === 'plan' ? (
            <div>

              {/* ── AI Summary — collapsible with manual edit ── */}
              <div style={{ marginBottom: '14px', border: `1px solid rgba(163,113,247,0.35)`, borderRadius: '8px', overflow: 'hidden' }}>
                {/* Header row */}
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(163,113,247,0.08)', cursor: hasSummary ? 'pointer' : 'default' }}
                  onClick={() => hasSummary && setSummaryOpen(prev => ({ ...prev, [selectedCr!]: !isSumOpen }))}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#a371f7' }}>✨ סיכום AI</span>
                    {hasSummary && (
                      <span style={{ fontSize: '10px', color: '#a371f7', background: 'rgba(163,113,247,0.2)', padding: '1px 6px', borderRadius: '4px', border: '1px solid rgba(163,113,247,0.3)' }}>שמור</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '7px', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                    {hasSummary && isSumOpen && !isEditing && (
                      <button
                        onClick={() => {
                          setSummaryDraft(prev => ({ ...prev, [selectedCr!]: summaries[selectedCr!] }));
                          setSummaryEditing(prev => ({ ...prev, [selectedCr!]: true }));
                        }}
                        style={{ fontSize: '11px', padding: '3px 10px', background: 'white', color: '#a371f7', border: '1px solid rgba(163,113,247,0.5)', borderRadius: '5px', cursor: 'pointer', fontWeight: 600 }}>
                        ✏️ ערוך
                      </button>
                    )}
                    {isManager && (
                      <button
                        disabled={summarizingCr === selectedCr}
                        onClick={() => {
                          setDialog({
                            title: 'פנייה ל-AI לסיכום',
                            message: hasSummary
                              ? 'קיים כבר סיכום שמור.\nהאם להפעיל שוב את ה-AI ולהחליף אותו?'
                              : 'האם לשלוח את נתוני תוכנית ה-CR ל-AI לצורך יצירת סיכום?',
                            variant: 'warning',
                            confirmLabel: hasSummary ? 'כן, עדכן סיכום' : 'כן, צור סיכום',
                            onConfirm: () => summarizeCr(selectedCr!),
                          });
                        }}
                        style={{ fontSize: '11px', padding: '3px 12px', background: summarizingCr === selectedCr ? '#555' : '#6c3483', color: 'white', border: 'none', borderRadius: '5px', cursor: summarizingCr === selectedCr ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
                        {summarizingCr === selectedCr ? '⏳ מסכם...' : hasSummary ? '⟳ עדכן' : '✨ צור סיכום'}
                      </button>
                    )}
                    {hasSummary && (
                      <span style={{ fontSize: '12px', color: '#a371f7', display: 'inline-block', transform: isSumOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', cursor: 'pointer' }}
                        onClick={() => setSummaryOpen(prev => ({ ...prev, [selectedCr!]: !isSumOpen }))}>
                        ▼
                      </span>
                    )}
                  </div>
                </div>

                {/* Body — show when open */}
                {hasSummary && isSumOpen && (
                  <div style={{ padding: '12px 14px', borderTop: `1px solid rgba(163,113,247,0.2)`, background: 'rgba(163,113,247,0.03)' }}>
                    {isEditing ? (
                      <>
                        <textarea
                          value={summaryDraft[selectedCr] ?? summaries[selectedCr]}
                          onChange={e => setSummaryDraft(prev => ({ ...prev, [selectedCr!]: e.target.value }))}
                          style={{ width: '100%', minHeight: '140px', fontSize: '13px', fontFamily: FONT, color: C.textSecondary, lineHeight: '1.7', background: 'white', border: `1px solid rgba(163,113,247,0.4)`, borderRadius: '6px', padding: '9px 11px', resize: 'vertical', direction: 'rtl', boxSizing: 'border-box' }}
                        />
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', justifyContent: 'flex-start' }}>
                          <button
                            onClick={() => {
                              setSummaries(prev => ({ ...prev, [selectedCr!]: summaryDraft[selectedCr!] ?? prev[selectedCr!] }));
                              setSummaryEditing(prev => ({ ...prev, [selectedCr!]: false }));
                            }}
                            style={{ fontSize: '12px', padding: '4px 14px', background: '#6c3483', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 700 }}>
                            💾 שמור
                          </button>
                          <button
                            onClick={() => setSummaryEditing(prev => ({ ...prev, [selectedCr!]: false }))}
                            style={{ fontSize: '12px', padding: '4px 12px', background: 'white', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: '5px', cursor: 'pointer' }}>
                            בטל
                          </button>
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: '14px', color: C.textSecondary, lineHeight: '1.8', whiteSpace: 'pre-wrap' }}>
                        {summaries[selectedCr]}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* CR description */}
              {crDesc && (
                <div style={{ marginBottom: '14px', padding: '8px 12px', background: 'rgba(163,113,247,0.07)', border: '1px solid rgba(163,113,247,0.2)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#a371f7', fontWeight: 700, marginBottom: '4px' }}>פרטי CR</div>
                  <div style={{ fontSize: '13px', color: C.textSecondary, lineHeight: 1.5 }}>{crDesc}</div>
                </div>
              )}

              {isNotNeeded && (
                <div style={{ padding: '14px', color: C.textMuted, fontSize: '13px', fontStyle: 'italic', textAlign: 'center' }}>
                  ✗ פיתוח זה סומן כ"לא נדרש לתוכנית" — אינו חוסם מעבר לשלב הבא
                </div>
              )}

              {!isNotNeeded && (
                <>
                  {/* 2-column plan grid: right=main, left=rollback+gradual */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px', alignItems: 'start' }}>
                    <div>
                      {aggField('📋', 'תוכנית עבודה',         workItems,    '#d4a843')}
                      {aggField('💡', 'בדיקות ליל גרסה',      nightItems,   '#58a6ff')}
                      {aggField('🌅', 'בקרות בוקר',           morningItems, '#a371f7')}
                    </div>
                    <div>
                      {aggField('📈', 'עלייה מדורגת',         gradualItems,  '#d29922')}
                      {aggField('🛡️', 'תוכנית Rollback',      rollbackItems, '#f85149')}
                    </div>
                  </div>
                  {!workItems.length && !nightItems.length && !morningItems.length && !rollbackItems.length && !gradualItems.length && plans.length > 0 && (
                    <div style={{ textAlign: 'center', padding: '30px', color: C.textDisabled, fontSize: '13px', fontStyle: 'italic' }}>ראשי הצוותים טרם מילאו תוכנית לפיתוח זה</div>
                  )}
                  {plans.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '30px', color: C.textDisabled, fontSize: '13px', fontStyle: 'italic' }}>לא הוגשה תוכנית CR עדיין</div>
                  )}
                </>
              )}
            </div>

          ) : (

            /* ── Tasks tab — narrative sentences ── */
            <div>
              {propsForCr.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: C.textDisabled }}>
                  <div style={{ fontSize: '28px', marginBottom: '10px' }}>📋</div>
                  ראשי הצוותים טרם הוסיפו משימות לביצוע
                </div>
              ) : (
                [1, 2, 3, 4].map(phase => {
                  const phaseProps = propsForCr.filter(p => p.phase === phase);
                  if (!phaseProps.length) return null;
                  const ph = PHASE_COLOR[phase] ?? { bg: C.bgNested, color: C.textMuted };
                  const phaseName = PHASE_LABEL[phase] ?? `שלב ${phase}`;
                  return (
                    <div key={phase} style={{ marginBottom: '14px' }}>
                      {/* Phase header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px', padding: '6px 12px', background: ph.bg, borderRadius: '7px', border: `1px solid ${ph.color}25` }}>
                        <span style={{ fontSize: '12px', fontWeight: 800, color: ph.color }}>{phaseName}</span>
                        <span style={{ fontSize: '11px', color: ph.color, background: 'white', padding: '1px 7px', borderRadius: '8px', border: `1px solid ${ph.color}30` }}>{phaseProps.length}</span>
                      </div>
                      {phaseProps.map((prop, i) => {
                        const teamName = teamsForCr.find(t => t.id === prop.teamId)?.name
                          ?? plans.find(p => p.team?.id === prop.teamId)?.team?.name
                          ?? '';
                        const action = prop.actionType || prop.title || '';
                        /* build narrative sentence from available fields */
                        const parts = [
                          prop.assignedUserName || null,
                          teamName ? `מצוות ${teamName}` : null,
                          action ? `מבצע ${action}` : null,
                          prop.app ? `במערכת ${prop.app}` : null,
                          prop.estimatedMins ? `משך הפעילות כ-${prop.estimatedMins} דקות` : null,
                        ].filter(Boolean);
                        const sentence = parts.join(' ');
                        return (
                          <div key={prop.id} style={{
                            padding: '9px 14px', borderRadius: '8px', marginBottom: '6px',
                            background: i % 2 === 0 ? C.bgApp : C.bgNested,
                            border: `1px solid ${C.border}`, borderRight: `3px solid ${ph.color}60`,
                            display: 'flex', alignItems: 'flex-start', gap: '8px',
                          }}>
                            <span style={{ color: ph.color, fontSize: '14px', flexShrink: 0, lineHeight: '1.65' }}>•</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '14px', color: C.textSecondary, lineHeight: 1.65 }}>{sentence || prop.title}</div>
                              {prop.notes && (
                                <div style={{ marginTop: '4px', fontSize: '12px', color: C.textMuted, paddingRight: '8px', borderRight: `2px solid ${ph.color}40` }}>
                                  💬 {prop.notes}
                                </div>
                              )}
                            </div>
                            <span style={{ flexShrink: 0, fontSize: '11px', padding: '2px 8px', borderRadius: '5px', fontWeight: 700, background: prop.status === 'READY' ? 'rgba(63,185,80,0.18)' : 'rgba(210,153,34,0.18)', color: prop.status === 'READY' ? '#3fb950' : '#d29922', border: `1px solid ${prop.status === 'READY' ? 'rgba(63,185,80,0.4)' : 'rgba(210,153,34,0.4)'}` }}>
                              {prop.status === 'READY' ? 'מוכן' : 'טיוטא'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const splitPanel = (
    <>
      {allCrNumbers.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: C.textMuted, fontSize: '13px', background: C.bgCard, borderRadius: '8px', border: `1px solid ${C.border}` }}>
          לא נמצאו CR-ים — בצע סינכרון מקובץ CR_LIST
        </div>
      ) : (
        <div style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden', minHeight: '62vh' }}>
          {/* ── LEFT: CR list (252px) ── */}
          <div style={{ width: '252px', flexShrink: 0, borderLeft: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', background: C.bgCard }}>
            {/* Progress + filter */}
            <div style={{ padding: '9px 12px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' }}>
                <div style={{ flex: 1, height: '4px', background: C.border, borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: allApproved ? '#3fb950' : '#f0883e', width: `${pct}%`, borderRadius: '2px', transition: 'width 0.4s' }} />
                </div>
                <span style={{ fontSize: '11px', fontWeight: 700, color: allApproved ? '#3fb950' : '#f0883e', whiteSpace: 'nowrap' }}>{approvedCount}/{allCrNumbers.length} CR</span>
              </div>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {(['all', 'pending', 'approved', 'not_required'] as const).map(f => (
                  <button key={f} onClick={() => setCrFilter(f)}
                    style={{ padding: '2px 8px', border: 'none', borderRadius: '99px', cursor: 'pointer', fontSize: '10px', fontWeight: 600, background: crFilter === f ? '#1a2332' : C.bgNested, color: crFilter === f ? 'white' : C.textMuted, transition: 'all 0.1s' }}>
                    {f === 'all' ? 'הכל' : f === 'pending' ? 'ממתין' : f === 'approved' ? 'אושר' : 'לא נדרש'}
                  </button>
                ))}
              </div>
            </div>

            {/* CR items */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredCrNums.map(crNumber => {
                const plans      = crPlans.filter(p => p.crNumber === crNumber);
                const propsForCr = proposals.filter(p => p.crNumber === crNumber);
                const assigns    = assignments.filter(a => a.crNumber === crNumber);
                const teamsForCr = assigns.map(a => a.team);
                const rawLabel   = assigns[0]?.crLabel ?? crNumber;
                const crTitle    = rawLabel.replace(`${crNumber} - `, '').replace(`${crNumber} `, '');
                const isApproved = plans.length > 0 && plans.every(p => p.planApproved || p.notNeededForPlan);
                const isNotNeeded = plans.length > 0 && plans.every(p => p.notNeededForPlan);
                const teamsWithPropsSet   = new Set(propsForCr.map(p => p.teamId));
                const teamsNotRequiredSet = new Set(plans.filter(p => p.notNeededForPlan).map(p => p.team.id));
                const missingCount = teamsForCr.filter(t => !teamsWithPropsSet.has(t.id) && !teamsNotRequiredSet.has(t.id)).length;
                const highRisk   = plans.find(p => p.riskLevel === 'HIGH')?.riskLevel ?? plans.find(p => p.riskLevel === 'MEDIUM')?.riskLevel ?? plans[0]?.riskLevel;
                const isSelected = selectedCr === crNumber;
                const dotColor   = isApproved ? '#3fb950' : isNotNeeded ? '#8b949e' : missingCount === 0 ? '#d29922' : '#ef4444';
                return (
                  <div key={crNumber} onClick={() => setSelectedCr(crNumber)}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '9px 14px', cursor: 'pointer', borderBottom: `1px solid ${C.bgNested}`, borderRight: `3px solid ${isSelected ? C.brand : 'transparent'}`, background: isSelected ? C.infoBg : 'transparent', transition: 'background 0.1s' }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = C.bgHover; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: dotColor, flexShrink: 0, marginTop: '5px' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: C.textPrimary, fontFamily: 'monospace' }}>{crNumber}</div>
                      <div style={{ fontSize: '11px', color: C.textMuted, lineHeight: 1.35, marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={crTitle}>{crTitle || '—'}</div>
                      <div style={{ fontSize: '10px', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                        {highRisk && RISK[highRisk] && <span style={{ padding: '1px 5px', borderRadius: '4px', fontWeight: 600, background: RISK[highRisk].bg, color: RISK[highRisk].color }}>{RISK[highRisk].label}</span>}
                        <span style={{ color: isApproved ? '#3fb950' : C.textDisabled }}>
                          {isApproved ? '✓ אושר' : isNotNeeded ? '✗ לא נדרש' : `${propsForCr.length} משימות`}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredCrNums.length === 0 && (
                <div style={{ padding: '20px 14px', textAlign: 'center', color: C.textDisabled, fontSize: '12px' }}>אין תוצאות</div>
              )}
            </div>
          </div>

          {/* ── RIGHT: Detail panel ── */}
          {renderDetail()}
        </div>
      )}
    </>
  );

  /* ─── Render ──────────────────────────────────────────────────────────────── */

  const teamPanelHeader = (
    <div onClick={() => setTeamPanelOpen(p => !p)}
      style={{ padding: '10px 16px', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: allTeamsSubmitted ? 'rgba(63,185,80,0.10)' : 'rgba(248,81,73,0.08)' }}>
      <span style={{ fontSize: '13px', fontWeight: 700, color: allTeamsSubmitted ? C.statusDone : C.statusBlocked, display: 'flex', alignItems: 'center', gap: '8px' }}>
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
  );

  if (section === 'teams') return (
    <div style={{ direction: 'rtl', fontFamily: "'IBM Plex Sans Hebrew', Arial, sans-serif" }}>
      <div style={{ background: C.bgCard, border: `1px solid ${allTeamsSubmitted ? '#3fb95044' : C.border}`, borderRadius: '12px', overflow: 'hidden', boxShadow: allTeamsSubmitted ? '0 0 0 3px rgba(63,185,80,0.08)' : 'none' }}>
        {teamPanelHeader}
        {teamPanelOpen && teamGrid}
      </div>
    </div>
  );

  if (section === 'crs') return (
    <div style={{ direction: 'rtl', fontFamily: "'IBM Plex Sans Hebrew', Arial, sans-serif" }}>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />
      {splitPanel}
    </div>
  );

  return (
    <div style={{ direction: 'rtl', fontFamily: "'IBM Plex Sans Hebrew', Arial, sans-serif" }}>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />
      {/* Team panel */}
      <div style={{ background: C.bgCard, border: `1px solid ${allTeamsSubmitted ? '#3fb95044' : C.border}`, borderRadius: '12px', overflow: 'hidden', marginBottom: '16px', boxShadow: allTeamsSubmitted ? '0 0 0 3px rgba(63,185,80,0.08)' : 'none' }}>
        {teamPanelHeader}
        {teamPanelOpen && teamGrid}
      </div>
      {splitPanel}
    </div>
  );
};
