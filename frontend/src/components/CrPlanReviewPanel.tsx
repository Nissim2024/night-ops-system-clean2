import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, RADIUS, SHADOW } from '../theme';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';
import { cleanHtmlText } from '../utils/textSanitize';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Phase "nodes" in the unified story all share one accent (Go-Live orange,
// matching the design system's per-module color) — differentiated by icon/
// title, not a different hue per phase (that was the old GitHub-dark palette).
const PHASE_ICON: Record<number, string> = { 1: '☀️', 2: '🌙', 3: '🌅', 4: '📅' };
const PHASE_LABEL: Record<number, string> = {
  1: 'בוקר גרסה', 2: 'ליל הגרסה — HOTNET', 3: 'ליל הגרסה — HOT', 4: 'בוקר שלאחר הגרסה',
};
const PHASE_META: Record<number, string> = {
  1: 'לפני פתיחת חלון השינוי', 2: 'עדכוני פרמטרים, סקריפטים, הרשאות',
  3: 'פעולות ייחודיות לאחר עליית הקוד', 4: 'מעקב ובקרה תפעולית',
};
const RISK: Record<string, { color: string; bg: string; label: string }> = {
  LOW:    { color: C.success, bg: C.successBg, label: 'סיכון נמוך'   },
  MEDIUM: { color: C.warning, bg: C.warningBg, label: 'סיכון בינוני' },
  HIGH:   { color: C.danger,  bg: C.dangerBg,  label: 'סיכון גבוה'   },
};

// Merging several teams' proposals into one shared phase-timeline only reads as
// a coherent story if you can tell at a glance who owns each step — a stable
// color per team name (not per-row-random) makes that possible.
const TEAM_PALETTE = ['#4573D2', '#9C6ADE', '#37C47A', '#E8AF00', '#F0883E', '#14B8A6', '#EC6BAD', '#6366F1'];
function teamColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TEAM_PALETTE[hash % TEAM_PALETTE.length];
}
// A note that starts with "תלות" is a dependency call-out, not a generic
// comment — worth its own visual treatment so the causal thread between merged
// tasks (from potentially different teams) is visible, not just their order.
function isDependencyNote(notes: string): boolean {
  return /^\s*תלות/.test(notes);
}

const SUBMISSION_META: Record<string, { label: string; dot: string }> = {
  NOT_STARTED: { label: 'אין התייחסות', dot: C.textDisabled },
  DRAFT:       { label: 'טיוטה',         dot: C.warning },
  RETURNED:    { label: 'הוחזר',         dot: C.danger },
  SUBMITTED:   { label: 'הוגש',          dot: C.success },
  APPROVED:    { label: 'הוגש',          dot: C.success },
};

// Natural verb per action type, so a plan reads as a real sentence ("יובל מגדיר
// פרמטר...") instead of a category label ("הגדרת פרמטרים: ..."). Falls back to
// a generic "מבצע {actionType}" for anything not in the map.
const ACTION_VERB: Record<string, string> = {
  'הרצת סקריפט': 'מריץ סקריפט',
  'פתיחת פרמטר': 'פותח פרמטר',
  'הגדרת פרמטרים': 'מגדיר פרמטר',
  'פתיחת הרשאה': 'פותח הרשאה',
  'הגדרת הרשאות': 'מגדיר הרשאה',
  'בדיקה ידנית': 'מבצע בדיקה',
  'הטמעת קוד': 'מבצע הטמעת קוד',
  'בדיקת תקינות': 'מבצע בדיקת תקינות',
  'עצירת Job': 'עוצר Job',
  'הפעלת Job': 'מפעיל Job',
  'עצירת תהליך מתוזמן': 'עוצר תהליך מתוזמן',
  'החזרת תהליך מתוזמן': 'מחזיר תהליך מתוזמן',
  'טעינת קובץ': 'טוען קובץ',
  'יצירת תיקייה': 'יוצר תיקייה',
  'עדכון Crontab': 'מעדכן Crontab',
  'הסבת נתונים': 'מבצע הסבת נתונים',
  'פעולת תפעול': 'מבצע פעולת תפעול',
  'הגדרת תצורה': 'מגדיר תצורה',
  'פעולה ידנית': 'מבצע פעולה',
  'פתיחת תקשורת FW': 'פותח תקשורת FW',
};
function actionSentence(a: CrPlanActionRow, teamName: string): string {
  const who = a.ownerName || `מישהו מ-${teamName}`;
  const verb = ACTION_VERB[a.actionType] || `מבצע ${a.actionType}`;
  return a.description ? `${who} ${verb} ${a.description}` : `${who} ${verb}`;
}
function monitoringSentence(m: CrPlanMonitoringPointRow, teamName: string): string {
  const who = m.assignedUserName || `מישהו מ-${teamName}`;
  return `${who} מבצע בקרה על ${m.name || m.type}`;
}

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface TeamInfo  { id: string; name: string }
interface CrAssign  { crNumber: string; crLabel?: string; crManager?: string; crDescription?: string; alreadyInProduction?: boolean; team: TeamInfo }
interface CrPlanActionRow {
  id: string; actionType: string; description: string; phase: number;
  system?: string; estimatedMins?: number; ownerName?: string;
}
interface CrPlanMonitoringPointRow {
  id: string; type: string; name: string; note?: string; phase: number; assignedUserName?: string;
}
interface CrPlan    {
  id: string; crNumber: string; crLabel?: string; crManager?: string; crDescription?: string;
  crType?: string; riskLevel?: string; systems?: string[]; workPlan?: string; scripts?: string; rollbackPlan?: string;
  nightTestingNotes?: string; morningMonitoring?: string; gradualRollout: boolean; gradualDetails?: string; activationDate?: string;
  notNeededForPlan: boolean; planApproved: boolean; planApprovedAt?: string; submissionStatus?: string;
  changeTypes?: string[]; prerequisites?: string[]; prerequisitesNote?: string; rollbackType?: string;
  actions?: CrPlanActionRow[]; monitoringPoints?: CrPlanMonitoringPointRow[];
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
  const [openTeamId,    setOpenTeamId]    = useState<string | null>(null);
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

  const [approvingTeam, setApprovingTeam] = useState<string | null>(null);
  const approveTeamPlan = async (crNumber: string, teamId: string, approve: boolean) => {
    const key = `${crNumber}:${teamId}`;
    setApprovingTeam(key);
    try {
      await axios.patch(`${API}/cr-plans/version/${versionId}/${approve ? 'approve-cr' : 'unapprove-cr'}`, { crNumber, teamId }, { headers });
      setCrPlans(prev => prev.map(p => p.crNumber === crNumber && p.team.id === teamId
        ? { ...p, planApproved: approve, planApprovedAt: approve ? new Date().toISOString() : undefined }
        : p));
    } finally {
      setApprovingTeam(prev => prev === key ? null : prev);
    }
  };

  // "מצב הקראה" — reads the merged cross-team story aloud via the browser's
  // built-in TTS, meant for the release-review meeting (no server round-trip).
  const [speaking, setSpeaking] = useState(false);
  const toggleNarrate = () => {
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    if (!selectedCr) return;
    const plansForCr = crPlans.filter(p => p.crNumber === selectedCr && !p.notNeededForPlan);
    const text = plansForCr.map(p => {
      const actions = (p.actions ?? []).slice().sort((a, b) => a.phase - b.phase);
      const monitoringPoints = p.monitoringPoints ?? [];
      const sentences = [
        ...actions.map(a => actionSentence(a, p.team.name)),
        ...monitoringPoints.map(m => monitoringSentence(m, p.team.name)),
      ];
      return sentences.length ? `${p.team.name}: ${sentences.join('. ')}.` : '';
    }).filter(Boolean).join(' ');
    if (!text) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'he-IL';
    utter.onend = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
    setSpeaking(true);
  };

  const toggleAlreadyInProduction = async (crNumber: string, value: boolean) => {
    setAssignments(prev => prev.map(a => a.crNumber === crNumber ? { ...a, alreadyInProduction: value } : a));
    await axios.patch(`${API}/version-cr-assignments/cr/${versionId}/${crNumber}`, { alreadyInProduction: value }, { headers }).catch(() => {});
  };

  /* derived */
  // CRs already deployed separately (e.g. an earlier hotfix) don't need a plan
  // or approval for THIS release — excluded from the required review set.
  const inProdCrs = new Set(assignments.filter(a => a.alreadyInProduction).map(a => a.crNumber));
  const allCrNumbers  = Array.from(new Set([
    ...assignments.map(a => a.crNumber),
    ...crPlans.map(p => p.crNumber),
  ])).filter(cr => !inProdCrs.has(cr)).sort();
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

  /* Wizard step navigation (section === 'crs') — walks allCrNumbers in order. */
  const currentStepIndex = Math.max(0, allCrNumbers.indexOf(selectedCr ?? ''));
  const goToStep = (delta: number) => {
    const next = Math.max(0, Math.min(allCrNumbers.length - 1, currentStepIndex + delta));
    setSelectedCr(allCrNumbers[next]);
    setOpenTeamId(null);
  };

  if (loading) return (
    <div style={{ padding: '20px', textAlign: 'center', color: C.textMuted, fontSize: '15px' }}>⏳ טוען...</div>
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
        const accent    = allApprovedForTeam ? C.success : hasSubmitted ? C.info : C.danger;
        const desc      = allApprovedForTeam
          ? `הוגש ואושר — ${teamCrs.length} פיתוחים ✓`
          : hasSubmitted
          ? `הוגש — ${managerApproved} מתוך ${teamCrs.length} פיתוחים אושרו`
          : `לא הגיש — ${teamCrs.length} פיתוח${teamCrs.length !== 1 ? 'ים' : ''} ממתינים`;
        return (
          <div key={team.id} style={{ borderRadius: RADIUS.lg, border: `1px solid ${accent}33`, borderTop: `4px solid ${accent}`, background: C.bgCard, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px', boxShadow: SHADOW.xs }}>
            <span style={{ fontWeight: '800', fontSize: '15px', color: C.textPrimary, lineHeight: 1.2 }}>{team.name}</span>
            <span style={{ fontSize: '14px', color: accent, lineHeight: 1.5, flex: 1 }}>{desc}</span>
            <button onClick={() => onTeamReview?.(team.id, team.name)}
              style={{ marginTop: '4px', padding: '5px 0', background: 'transparent', color: C.brand, border: `1px solid ${C.brand}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '14px', fontWeight: '600', width: '100%' }}>
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
    const gradualPlan  = plans.find(p => p.gradualRollout);
    const isInProduction = !!assigns[0]?.alreadyInProduction;
    const isApp        = approving.has(selectedCr);
    const isSumOpen    = summaryOpen[selectedCr] ?? false;
    const isEditing    = summaryEditing[selectedCr] ?? false;
    const hasSummary   = Boolean(summaries[selectedCr]);

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* ── Topbar ── */}
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, background: C.bgCard, flexShrink: 0 }}>

          {/* Row 1: CR chip · title · risk · approve button */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '15px', fontWeight: 800, background: `${C.moduleGoLive}1f`, color: C.moduleGoLive, padding: '3px 10px', borderRadius: RADIUS.sm, border: `1px solid ${C.moduleGoLive}4d`, flexShrink: 0 }}>
              {selectedCr}
            </span>
            <div style={{ fontWeight: 700, fontSize: '16px', color: C.textPrimary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {crTitle || '—'}
            </div>
            {highRisk && RISK[highRisk] && (
              <span style={{ fontSize: '13px', padding: '3px 9px', borderRadius: RADIUS.sm, fontWeight: 700, flexShrink: 0, background: RISK[highRisk].bg, color: RISK[highRisk].color }}>
                {RISK[highRisk].label}
              </span>
            )}
            {isNotNeeded ? (
              <span style={{ fontSize: '14px', color: C.textMuted, background: C.bgNested, padding: '3px 10px', borderRadius: RADIUS.full, border: `1px solid ${C.border}`, flexShrink: 0 }}>
                ✗ לא נדרש לתוכנית
              </span>
            ) : isApproved ? (
              <>
                <span style={{ fontSize: '14px', fontWeight: 700, color: C.success, background: C.successBg, padding: '3px 10px', borderRadius: RADIUS.full, border: `1px solid ${C.success}4d`, flexShrink: 0 }}>✅ מאושר</span>
                {isManager && (
                  <button onClick={() => approveCr(selectedCr, false)} disabled={isApp}
                    style={{ padding: '4px 10px', background: C.bgCard, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', flexShrink: 0 }}>
                    בטל אישור
                  </button>
                )}
              </>
            ) : (
              <span style={{ fontSize: '13px', color: C.textMuted, background: C.bgNested, padding: '3px 9px', borderRadius: RADIUS.sm, border: `1px solid ${C.border}`, flexShrink: 0 }}>
                {missingTeams.length > 0 ? `ממתין ל-${missingTeams.length} צוותים` : 'ממתין לאישור מנהל — ראה סרגל אישור בתחתית המסך'}
              </span>
            )}
          </div>

          {/* Row 2: manager · teams · systems */}
          {(crManager || teamsForCr.length > 0 || allSystems.length > 0) && (
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginTop: '7px', flexWrap: 'wrap' }}>
              {crManager && (
                <span style={{ fontSize: '14px', color: C.textMuted, direction: 'rtl', unicodeBidi: 'isolate' }}>
                  מנהל CR:&nbsp;<bdi style={{ color: C.textSecondary, fontWeight: 600 }}>{crManager}</bdi>
                </span>
              )}
              {allSystems.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: C.textMuted }}>מערכות:</span>
                  {allSystems.map(sys => (
                    <span key={sys} style={{ fontSize: '13px', background: C.infoBg, color: C.info, padding: '1px 7px', borderRadius: RADIUS.sm, fontWeight: 600, border: `1px solid ${C.info}40` }}>{sys}</span>
                  ))}
                </div>
              )}
              {isManager && (
                <button
                  onClick={() => toggleAlreadyInProduction(selectedCr, !isInProduction)}
                  title={isInProduction ? 'לחץ כדי להחזיר לרשימת ה-CR-ים הנדרשים לגרסה זו' : 'סמן אם ה-CR כבר עלה לייצור בנפרד (למשל הוטפיקס קודם) — לא יידרש תוכנית/אישור לגרסה זו'}
                  style={{
                    fontSize: '13px', fontWeight: 700, padding: '2px 9px', borderRadius: RADIUS.full, cursor: 'pointer',
                    background: isInProduction ? C.successBg : C.bgNested,
                    color: isInProduction ? C.success : C.textMuted,
                    border: `1px solid ${isInProduction ? `${C.success}59` : C.border}`,
                  }}>
                  {isInProduction ? '🏭 כבר בייצור' : '🏭 סמן ככבר בייצור'}
                </button>
              )}
            </div>
          )}

          {/* Row 3: rollout mode — night-of vs. gradual/staged */}
          {plans.length > 0 && (
            <div style={{ marginTop: '7px' }}>
              {gradualPlan ? (
                <span style={{ fontSize: '13px', color: C.textSecondary, display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: C.info, background: C.infoBg, padding: '1px 8px', borderRadius: RADIUS.full, border: `1px solid ${C.info}40` }}>📶 עלייה מדורגת</span>
                  {gradualPlan.gradualDetails && <span>{gradualPlan.gradualDetails}</span>}
                  {gradualPlan.activationDate && (
                    <span>· תאריך הפעלה: <bdi style={{ fontWeight: 600, color: C.textPrimary }}>{new Date(gradualPlan.activationDate).toLocaleDateString('he-IL')}</bdi></span>
                  )}
                </span>
              ) : (
                <span style={{ fontSize: '12px', fontWeight: 700, color: C.moduleGoLive, background: `${C.moduleGoLive}18`, padding: '1px 8px', borderRadius: RADIUS.full, border: `1px solid ${C.moduleGoLive}40` }}>🌙 עלייה בליל הגרסה</span>
              )}
            </div>
          )}
        </div>

        {/* ── Teams status strip + KPI row ── */}
        {teamsForCr.length > 0 && (
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, background: C.bgApp, flexShrink: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '10px' }}>
              סטטוס הגשה לפי צוות — לחיצה מציגה את תקציר התוכנית של הצוות
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: openTeamId ? '10px' : '12px' }}>
              {teamsForCr.map(t => {
                const plan = plans.find(p => p.team.id === t.id);
                const meta = plan?.notNeededForPlan
                  ? { label: 'אין השפעה מיוחדת', dot: C.textDisabled }
                  : SUBMISSION_META[plan?.submissionStatus ?? 'NOT_STARTED'] ?? SUBMISSION_META.NOT_STARTED;
                const canApprove = isManager && !!plan && !plan.notNeededForPlan && ['SUBMITTED', 'APPROVED'].includes(plan.submissionStatus ?? '');
                const canPreview = !!plan && !plan.notNeededForPlan && ['SUBMITTED', 'APPROVED'].includes(plan.submissionStatus ?? '');
                const teamKey = `${selectedCr}:${t.id}`;
                const isBusy = approvingTeam === teamKey;
                const isOpen = openTeamId === t.id;
                return (
                  <span key={t.id} style={{
                    display: 'flex', alignItems: 'center', gap: '9px', padding: '7px 13px',
                    borderRadius: RADIUS.full, border: `1px solid ${isOpen ? C.moduleGoLive : C.borderEm}`, background: C.bgCard,
                    fontSize: '12.5px', fontWeight: 700, color: C.textPrimary,
                    boxShadow: isOpen ? `0 0 0 2px ${C.moduleGoLive}29` : 'none',
                  }}>
                    {canApprove && (
                      <button onClick={() => approveTeamPlan(selectedCr!, t.id, !plan!.planApproved)} disabled={isBusy}
                        style={{ fontSize: '11px', fontWeight: 700, color: plan!.planApproved ? C.textMuted : C.moduleGoLive, background: 'transparent', border: 'none', cursor: isBusy ? 'not-allowed' : 'pointer', padding: 0 }}>
                        {isBusy ? '…' : plan!.planApproved ? '↩ בטל' : '✓ Approve Team'}
                      </button>
                    )}
                    <span onClick={() => canPreview && setOpenTeamId(isOpen ? null : t.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: canPreview ? 'pointer' : 'default' }}>
                      {t.name} · {meta.label}
                      <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: meta.dot, flexShrink: 0 }} />
                    </span>
                  </span>
                );
              })}
            </div>

            {openTeamId && (() => {
              const openPlan = plans.find(p => p.team.id === openTeamId);
              const openTeamName = teamsForCr.find(t => t.id === openTeamId)?.name ?? '';
              if (!openPlan) return null;
              const actions = (openPlan.actions ?? []).slice().sort((a, b) => a.phase - b.phase);
              const monitoringPoints = openPlan.monitoringPoints ?? [];
              const parts = [
                actions.length > 0 && `פעילויות: ${actions.map(a => `${a.actionType}${a.description ? ` (${a.description})` : ''}`).join(', ')}`,
                monitoringPoints.length > 0 && `Monitoring: ${monitoringPoints.map(m => m.name || m.type).join(', ')}`,
                (openPlan.rollbackType || openPlan.rollbackPlan) && `Rollback: ${openPlan.rollbackType || ''}${openPlan.rollbackPlan ? ` — ${openPlan.rollbackPlan}` : ''}`,
              ].filter(Boolean);
              return (
                <div style={{ background: C.bgNested, borderRadius: RADIUS.md, padding: '14px 16px', fontSize: '12px', color: C.textSecondary, lineHeight: 1.7, marginBottom: '12px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: C.textPrimary, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    🟢 תקציר תוכנית {openTeamName}
                  </div>
                  {parts.length > 0 ? parts.join(' · ') : 'הצוות לא פירט פעילויות עבור CR זה.'}
                </div>
              );
            })()}

            {missingTeams.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: C.warningBg, border: `1px solid ${C.warning}40`, borderRadius: RADIUS.md, padding: '9px 14px', fontSize: '12.5px', color: C.warning, fontWeight: 600, marginBottom: '12px' }}>
                ⚠ לא ניתן לאשר את התוכנית המאוחדת — {missingTeams.map(t => t.name).join(', ')} טרם נתן/נתנו התייחסות
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
              {[
                { label: 'צוותים מעורבים', val: teamsForCr.length },
                { label: 'משימות בתוכנית המאוחדת', val: propsForCr.length },
                { label: 'נקודות בקרה / ולידציה', val: plans.reduce((s, p) => s + (p.monitoringPoints?.length ?? 0), 0) },
                { label: 'מוכן לאישור?', val: isApproved ? '✓ אושר' : missingTeams.length > 0 ? `ממתין ל-${missingTeams.length}` : 'מוכן', warn: !isApproved },
              ].map((kpi, i) => (
                <div key={i} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '14px 18px', boxShadow: SHADOW.xs }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.05em' }}>{kpi.label}</div>
                  <div style={{ fontSize: typeof kpi.val === 'string' && kpi.val.length > 6 ? '16px' : '26px', fontWeight: 800, marginTop: '6px', color: kpi.warn ? C.warning : C.textPrimary }}>{kpi.val}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Body (single continuous story — no tabs) ── */}
        <div style={{ padding: '14px 16px' }}>
          <div>

              {/* ── AI Summary — collapsible with manual edit — indigo brand accent,
                  matching the design system's .ai-card (color-mix(brand 5%/22%)) ── */}
              <div style={{ marginBottom: '14px', border: `1px solid ${C.brand}38`, borderRadius: RADIUS.lg, overflow: 'hidden' }}>
                {/* Header row */}
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: `${C.brand}0d`, cursor: hasSummary ? 'pointer' : 'default' }}
                  onClick={() => hasSummary && setSummaryOpen(prev => ({ ...prev, [selectedCr!]: !isSumOpen }))}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: C.brand }}>✨ סיכום AI — התוכנית המאוחדת</span>
                    {hasSummary && (
                      <span style={{ fontSize: '12px', color: C.brand, background: `${C.brand}26`, padding: '1px 6px', borderRadius: RADIUS.xs, border: `1px solid ${C.brand}4d` }}>שמור</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '7px', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                    {hasSummary && isSumOpen && !isEditing && (
                      <button
                        onClick={() => {
                          setSummaryDraft(prev => ({ ...prev, [selectedCr!]: summaries[selectedCr!] }));
                          setSummaryEditing(prev => ({ ...prev, [selectedCr!]: true }));
                        }}
                        style={{ fontSize: '11px', fontWeight: 700, padding: '5px 12px', background: C.bgCard, color: C.textSecondary, border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.full, cursor: 'pointer' }}>
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
                        style={{ fontSize: '11px', fontWeight: 700, padding: '5px 12px', background: C.bgCard, color: C.textSecondary, border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.full, cursor: summarizingCr === selectedCr ? 'not-allowed' : 'pointer', opacity: summarizingCr === selectedCr ? 0.6 : 1 }}>
                        {summarizingCr === selectedCr ? '⏳ מסכם...' : hasSummary ? '🔄 עדכן' : '✨ צור סיכום'}
                      </button>
                    )}
                    {hasSummary && (
                      <span style={{ fontSize: '14px', color: C.brand, display: 'inline-block', transform: isSumOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', cursor: 'pointer' }}
                        onClick={() => setSummaryOpen(prev => ({ ...prev, [selectedCr!]: !isSumOpen }))}>
                        ▼
                      </span>
                    )}
                  </div>
                </div>

                {/* Body — show when open */}
                {hasSummary && isSumOpen && (
                  <div style={{ padding: '14px 18px', borderTop: `1px solid ${C.brand}26`, background: C.bgCard }}>
                    {isEditing ? (
                      <>
                        <textarea
                          value={summaryDraft[selectedCr] ?? summaries[selectedCr]}
                          onChange={e => setSummaryDraft(prev => ({ ...prev, [selectedCr!]: e.target.value }))}
                          style={{ width: '100%', minHeight: '140px', fontSize: '15px', fontFamily: FONT, color: C.textSecondary, lineHeight: '1.7', background: C.bgNested, border: `1px solid ${C.brand}40`, borderRadius: RADIUS.md, padding: '9px 11px', resize: 'vertical', direction: 'rtl', boxSizing: 'border-box' }}
                        />
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', justifyContent: 'flex-start' }}>
                          <button
                            onClick={() => {
                              setSummaries(prev => ({ ...prev, [selectedCr!]: summaryDraft[selectedCr!] ?? prev[selectedCr!] }));
                              setSummaryEditing(prev => ({ ...prev, [selectedCr!]: false }));
                            }}
                            style={{ fontSize: '14px', padding: '4px 14px', background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontWeight: 700 }}>
                            💾 שמור
                          </button>
                          <button
                            onClick={() => setSummaryEditing(prev => ({ ...prev, [selectedCr!]: false }))}
                            style={{ fontSize: '14px', padding: '4px 12px', background: C.bgCard, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer' }}>
                            בטל
                          </button>
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: '12.5px', color: C.textPrimary, lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>
                        {summaries[selectedCr]}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* CR description */}
              {crDesc && (
                <div style={{ marginBottom: '14px', padding: '8px 12px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md }}>
                  <div style={{ fontSize: '14px', color: C.textSecondary, fontWeight: 700, marginBottom: '4px' }}>פרטי CR</div>
                  <div style={{ fontSize: '15px', color: C.textSecondary, lineHeight: 1.5 }}>{crDesc}</div>
                </div>
              )}

          </div>

          {/* ── Story header + narrate button ── */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', margin: '22px 0 14px' }}>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: C.textPrimary }}>התוכנית המאוחדת — כל המשימות של כל הצוותים ל-CR זה, לפי ציר הזמן</div>
              <div style={{ fontSize: '11.5px', color: C.textMuted, marginTop: '2px' }}>מיועד להקראה בישיבת סקירת הגרסה ובליל העלייה — סדר ביצוע רציף, לא לפי סוג פעילות</div>
            </div>
            <button onClick={toggleNarrate}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: C.moduleGoLive, background: `${C.moduleGoLive}18`, border: `1px solid ${C.moduleGoLive}4d`, padding: '7px 14px', borderRadius: RADIUS.full, cursor: 'pointer', flexShrink: 0 }}>
              {speaking ? '⏹ עצור הקראה' : '🔊 מצב הקראה'}
            </button>
          </div>

          <div>
              {propsForCr.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: C.textDisabled }}>
                  <div style={{ fontSize: '28px', marginBottom: '10px' }}>📋</div>
                  ראשי הצוותים טרם הוסיפו משימות לביצוע
                </div>
              ) : (
                (() => { let stepCounter = 0; return [1, 2, 3, 4].map(phase => {
                  const phaseProps = propsForCr.filter(p => p.phase === phase);
                  if (!phaseProps.length) return null;
                  const phaseName = PHASE_LABEL[phase] ?? `שלב ${phase}`;
                  return (
                    <div key={phase} style={{ marginBottom: '20px' }}>
                      {/* Phase node — one accent (Go-Live orange) for every phase,
                          differentiated by icon/title, matching the design system's
                          per-module color convention rather than a rainbow per phase. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '12px' }}>
                        <div style={{
                          width: '40px', height: '40px', borderRadius: RADIUS.full, flexShrink: 0,
                          background: C.moduleGoLive, color: '#fff', fontSize: '18px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: SHADOW.sm,
                        }}>
                          {PHASE_ICON[phase] ?? '📌'}
                        </div>
                        <div>
                          <div style={{ fontSize: '15px', fontWeight: 800, color: C.textPrimary }}>{phaseName}</div>
                          <div style={{ fontSize: '11.5px', color: C.textMuted }}>{PHASE_META[phase]} · {phaseProps.length} משימות</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingInlineStart: '54px' }}>
                      {phaseProps.map((prop, i) => {
                        stepCounter += 1;
                        const stepNum = String(stepCounter).padStart(2, '0');
                        const teamName = teamsForCr.find(t => t.id === prop.teamId)?.name
                          ?? plans.find(p => p.team?.id === prop.teamId)?.team?.name
                          ?? '';
                        const action = prop.actionType || prop.title || '';
                        /* build narrative sentence — team identity moved out into its
                           own chip below, so it doesn't need repeating in the sentence */
                        const parts = [
                          prop.assignedUserName || null,
                          action ? `מבצע ${action}` : null,
                          prop.app ? `במערכת ${prop.app}` : null,
                          prop.estimatedMins ? `משך הפעילות כ-${prop.estimatedMins} דקות` : null,
                        ].filter(Boolean);
                        const sentence = parts.join(' ');
                        const tColor = teamColor(teamName || '?');
                        const depNote = prop.notes && isDependencyNote(prop.notes);
                        return (
                          <div key={prop.id} style={{
                            display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '13px 16px',
                            background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, boxShadow: SHADOW.xs,
                          }}>
                            <span style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 700, color: C.textDisabled, flexShrink: 0, paddingTop: '2px', width: '20px' }}>
                              {stepNum}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '13.5px', color: C.textPrimary, lineHeight: 1.6 }}>{sentence || prop.title}</div>
                              {prop.notes && (
                                <div style={{
                                  marginTop: '4px', fontSize: '13px', paddingRight: '8px',
                                  color: depNote ? C.info : C.textMuted, fontWeight: depNote ? 600 : 400,
                                  borderRight: `2px solid ${depNote ? C.info : C.border}`,
                                }}>
                                  {depNote ? '↳' : '💬'} {cleanHtmlText(prop.notes)}
                                </div>
                              )}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                                {teamName && (
                                  <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: RADIUS.full, color: '#fff', background: tColor }}>
                                    {teamName}
                                  </span>
                                )}
                                <span style={{
                                  fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: RADIUS.full,
                                  color: prop.status === 'READY' ? C.success : C.textMuted,
                                  background: prop.status === 'READY' ? C.successBg : C.bgNested,
                                }}>
                                  {prop.status === 'READY' ? '✓ מוכן' : 'טיוטה'}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      </div>
                    </div>
                  );
                }); })()
              )}
            </div>

          {/* ── Consolidated Rollback — one line per team with a rollback plan ── */}
          {plans.some(p => p.rollbackType || p.rollbackPlan) && (
            <div style={{ marginTop: '20px', background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, boxShadow: SHADOW.xs, padding: '16px 18px' }}>
              <div style={{ fontSize: '13px', fontWeight: 800, color: C.textPrimary, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                ↩ Rollback מרוכז — פעולות ביצוע קונקרטיות בלבד
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {plans.filter(p => p.rollbackType || p.rollbackPlan).map(p => {
                  const tColor = teamColor(p.team.name);
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12.5px', color: C.textSecondary }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: RADIUS.full, color: 'white', background: tColor, flexShrink: 0 }}>{p.team.name}</span>
                      <span>{p.rollbackType ? `${p.rollbackType} — ` : ''}{p.rollbackPlan || 'אין פירוט נוסף'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        {/* ── Sticky approve bar — child of the scrolling body, not a sibling
            after it, so `position: sticky` actually has a scroll context to
            stick within (the panel's own internal overflow, or the page's,
            whichever ends up active) instead of just scrolling away. ── */}
        {isManager && !isNotNeeded && (
          <div style={{
            position: 'sticky', bottom: '-14px', margin: '20px -16px -14px', background: C.bgCard, borderTop: `1px solid ${C.border}`,
            boxShadow: SHADOW.md, padding: '14px 20px', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', flexShrink: 0,
          }}>
            <span style={{ fontSize: '12px', color: C.textMuted }}>
              ניתן לאשר את ה-CR כולו רק כשכל הצוותים המעורבים נמצאים במצב Submitted או No Special Activity — עד אז ניתן לאשר משימה/קבוצה/צוות בנפרד
            </span>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={() => setDialog({
                title: 'דחיית התוכנית המאוחדת',
                message: 'התוכנית תוחזר לטיוטה עבור כל הצוותים המעורבים ב-CR זה, לעריכה מחדש.',
                variant: 'danger', confirmLabel: 'דחה',
                inputLabel: 'סיבת הדחייה', inputPlaceholder: 'מה צריך לתקן?',
                onConfirm: async (note?: string) => {
                  await Promise.all(plans.map(p => axios.patch(`${API}/cr-plans/${p.id}/return`, { returnReason: note || 'נדחה על ידי המנהל' }, { headers })));
                  fetchAll();
                },
              })}
                style={{ padding: '9px 16px', borderRadius: RADIUS.md, fontSize: '12px', fontWeight: 700, border: `1px solid ${C.danger}4d`, background: C.bgCard, color: C.danger, cursor: 'pointer' }}>
                ✕ Reject
              </button>
              <button onClick={() => setDialog({
                title: 'בקשת שינויים בתוכנית המאוחדת',
                message: 'התוכנית תוחזר לטיוטה עבור כל הצוותים המעורבים ב-CR זה.',
                variant: 'warning', confirmLabel: 'שלח',
                inputLabel: 'אילו שינויים נדרשים?', inputPlaceholder: 'לדוגמה: חסר Rollback לפרמטר X',
                onConfirm: async (note?: string) => {
                  await Promise.all(plans.map(p => axios.patch(`${API}/cr-plans/${p.id}/return`, { returnReason: note || 'נדרש תיקון' }, { headers })));
                  fetchAll();
                },
              })}
                style={{ padding: '9px 16px', borderRadius: RADIUS.md, fontSize: '12px', fontWeight: 700, border: `1px solid ${C.warning}4d`, background: C.bgCard, color: C.warning, cursor: 'pointer' }}>
                ✎ Request Changes
              </button>
              <button
                onClick={async () => {
                  if (missingTeams.length > 0) {
                    setDialog({ title: 'לא ניתן לאשר תוכנית CR', message: `הצוותים הבאים טרם הגישו תוכנית:\n${missingTeams.map(t => `• ${t.name}`).join('\n')}`, variant: 'warning', confirmLabel: 'הבנתי', onConfirm: () => {} });
                    return;
                  }
                  await approveCr(selectedCr, true);
                  goToStep(1);
                }}
                disabled={isApp || isApproved || missingTeams.length > 0}
                title={missingTeams.length > 0 ? `חסום — ממתין להתייחסות ${missingTeams.map(t => t.name).join(', ')}` : undefined}
                style={{
                  padding: '11px 20px', borderRadius: RADIUS.md, fontSize: '13px', fontWeight: 700, border: 'none',
                  cursor: (isApp || isApproved || missingTeams.length > 0) ? 'not-allowed' : 'pointer',
                  background: (isApproved || missingTeams.length > 0) ? C.bgNested : C.moduleGoLive,
                  color: (isApproved || missingTeams.length > 0) ? C.textDisabled : 'white',
                }}>
                {isApp ? '...' : isApproved ? '✓ אושר' : '✓ Approve CR'}
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    );
  };

  const splitPanel = (
    <>
      {allCrNumbers.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: C.textMuted, fontSize: '15px', background: C.bgCard, borderRadius: '8px', border: `1px solid ${C.border}` }}>
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
                <span style={{ fontSize: '13px', fontWeight: 700, color: allApproved ? '#3fb950' : '#f0883e', whiteSpace: 'nowrap' }}>{approvedCount}/{allCrNumbers.length} CR</span>
              </div>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {(['all', 'pending', 'approved', 'not_required'] as const).map(f => (
                  <button key={f} onClick={() => setCrFilter(f)}
                    style={{ padding: '2px 8px', border: 'none', borderRadius: '99px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, background: crFilter === f ? '#1a2332' : C.bgNested, color: crFilter === f ? 'white' : C.textMuted, transition: 'all 0.1s' }}>
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
                  <div key={crNumber} onClick={() => { setSelectedCr(crNumber); setOpenTeamId(null); }}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '9px 14px', cursor: 'pointer', borderBottom: `1px solid ${C.bgNested}`, borderRight: `3px solid ${isSelected ? C.brand : 'transparent'}`, background: isSelected ? C.infoBg : 'transparent', transition: 'background 0.1s' }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = C.bgHover; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: dotColor, flexShrink: 0, marginTop: '5px' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: C.textPrimary, fontFamily: 'monospace' }}>{crNumber}</div>
                      <div style={{ fontSize: '13px', color: C.textMuted, lineHeight: 1.35, marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={crTitle}>{crTitle || '—'}</div>
                      <div style={{ fontSize: '12px', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
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
                <div style={{ padding: '20px 14px', textAlign: 'center', color: C.textDisabled, fontSize: '14px' }}>אין תוצאות</div>
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
      <span style={{ fontSize: '15px', fontWeight: 700, color: allTeamsSubmitted ? C.statusDone : C.statusBlocked, display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>{allTeamsSubmitted ? '✅' : '●'}</span>
        {allTeamsSubmitted
          ? `כל ${involvedTeams.length} הצוותים הגישו · אושרו: ${approvedCount}/${allCrNumbers.length} CR`
          : `הגישו: ${teamsAllCovered}/${involvedTeams.length} צוותים · אושרו: ${approvedCount}/${allCrNumbers.length} CR`}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ width: '80px', height: '5px', background: C.border, borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: '3px', background: allTeamsSubmitted ? '#3fb950' : '#f0883e', width: `${submissionPct}%`, transition: 'width 0.4s' }} />
        </div>
        <span style={{ fontSize: '15px', color: C.textMuted, transform: teamPanelOpen ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>▼</span>
      </div>
    </div>
  );

  if (section === 'teams') return (
    <div style={{ direction: 'rtl', fontFamily: FONT }}>
      <div style={{ background: C.bgCard, border: `1px solid ${allTeamsSubmitted ? '#3fb95044' : C.border}`, borderRadius: '12px', overflow: 'hidden', boxShadow: allTeamsSubmitted ? '0 0 0 3px rgba(63,185,80,0.08)' : 'none' }}>
        {teamPanelHeader}
        {teamPanelOpen && teamGrid}
      </div>
    </div>
  );

  /* ──────────────────────────────────────────────────────────────────────────
     Wizard mode (section === 'crs') — one CR at a time, step-by-step through
     the whole list, instead of a free-browsing list+detail split panel.
  ─────────────────────────────────────────────────────────────────────────── */
  const wizardView = allCrNumbers.length === 0 ? (
    <div style={{ padding: '32px', textAlign: 'center', color: C.textMuted, fontSize: '15px', background: C.bgCard, borderRadius: '8px', border: `1px solid ${C.border}` }}>
      לא נמצאו CR-ים — בצע סינכרון מקובץ CR_LIST
    </div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflow: 'visible' }}>
      {/* Step progress header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderBottom: `1px solid ${C.border}`, background: C.bgCard, flexShrink: 0 }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: C.textMuted, whiteSpace: 'nowrap' }}>
          CR {currentStepIndex + 1} מתוך {allCrNumbers.length}
        </span>
        <div style={{ flex: 1, height: '6px', background: C.border, borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ height: '100%', background: allApproved ? C.success : C.moduleGoLive, width: `${pct}%`, borderRadius: '3px', transition: 'width 0.4s' }} />
        </div>
        <span style={{ fontSize: '13px', fontWeight: 700, color: allApproved ? C.success : C.moduleGoLive, whiteSpace: 'nowrap' }}>
          {approvedCount}/{allCrNumbers.length} אושרו
        </span>
      </div>

      {/* Current CR detail */}
      <div style={{ flex: 1, display: 'flex' }}>
        {renderDetail()}
      </div>

      {/* Step navigation footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: `1px solid ${C.border}`, background: C.bgCard, flexShrink: 0 }}>
        <button onClick={() => goToStep(-1)} disabled={currentStepIndex <= 0}
          style={{ padding: '8px 18px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, background: C.bgCard, color: currentStepIndex <= 0 ? C.textDisabled : C.textSecondary, cursor: currentStepIndex <= 0 ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '14px', fontFamily: FONT }}>
          → הקודם
        </button>
        {allApproved && (
          <span style={{ fontSize: '14px', fontWeight: 700, color: C.success }}>✅ כל התוכניות אושרו</span>
        )}
        <button onClick={() => goToStep(1)} disabled={currentStepIndex >= allCrNumbers.length - 1}
          style={{ padding: '8px 18px', border: 'none', borderRadius: RADIUS.md, background: currentStepIndex >= allCrNumbers.length - 1 ? C.bgNested : C.brand, color: currentStepIndex >= allCrNumbers.length - 1 ? C.textDisabled : 'white', cursor: currentStepIndex >= allCrNumbers.length - 1 ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '14px', fontFamily: FONT }}>
          הבא ←
        </button>
      </div>
    </div>
  );

  if (section === 'crs') return (
    <div style={{ direction: 'rtl', fontFamily: FONT }}>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />
      {wizardView}
    </div>
  );

  return (
    <div style={{ direction: 'rtl', fontFamily: FONT }}>
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
