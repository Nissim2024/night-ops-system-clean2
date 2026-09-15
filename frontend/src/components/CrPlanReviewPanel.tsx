import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C } from '../theme';
import { cn } from '../lib/utils';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';
import { cleanHtmlText } from '../utils/textSanitize';
import { formatDate } from '../utils/dateFormat';
import { teamColor } from './shared/defectFieldDisplay';

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
    <div className="p-5 text-center text-subtle-foreground text-[15px]">⏳ טוען...</div>
  );

  /* ──────────────────────────────────────────────────────────────────────────
     PART A — Team cards grid (collapsible, unchanged)
  ─────────────────────────────────────────────────────────────────────────── */
  const teamGrid = (
    <div className="grid gap-2.5 p-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
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
          <div key={team.id}
            className="rounded-lg bg-card py-3 px-3.5 flex flex-col gap-1.5 shadow-xs"
            style={{ border: `1px solid ${accent}33`, borderTop: `4px solid ${accent}` }}>
            <span className="font-extrabold text-[15px] text-foreground leading-tight">{team.name}</span>
            <span className="text-sm leading-normal flex-1" style={{ color: accent }}>{desc}</span>
            <button onClick={() => onTeamReview?.(team.id, team.name)}
              className="mt-1 py-1.5 bg-transparent text-primary rounded-md cursor-pointer text-sm font-semibold w-full border border-primary">
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
      <div className="flex-1 flex items-center justify-center text-subtle-foreground flex-col gap-2.5">
        <div className="text-3xl">📋</div>
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
      <div className="flex-1 flex flex-col min-w-0">

        {/* ── Topbar ── */}
        <div className="py-2.5 px-4 border-b border-border bg-card shrink-0">

          {/* Row 1: CR chip · title · risk · approve button */}
          <div className="flex gap-2.5 items-center flex-wrap">
            <span
              className="font-mono text-[15px] font-extrabold py-[3px] px-2.5 rounded-sm shrink-0"
              style={{ background: `${C.moduleGoLive}1f`, color: C.moduleGoLive, border: `1px solid ${C.moduleGoLive}4d` }}>
              {selectedCr}
            </span>
            <div className="font-bold text-base text-foreground flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
              {crTitle || '—'}
            </div>
            {highRisk && RISK[highRisk] && (
              <span className="text-[13px] py-[3px] px-2.5 rounded-sm font-bold shrink-0" style={{ background: RISK[highRisk].bg, color: RISK[highRisk].color }}>
                {RISK[highRisk].label}
              </span>
            )}
            {isNotNeeded ? (
              <span className="text-sm text-subtle-foreground bg-muted py-[3px] px-2.5 rounded-full border border-border shrink-0">
                ✗ לא נדרש לתוכנית
              </span>
            ) : isApproved ? (
              <>
                <span className="text-sm font-bold text-success bg-success-bg py-[3px] px-2.5 rounded-full shrink-0" style={{ border: `1px solid ${C.success}4d` }}>✅ מאושר</span>
                {isManager && (
                  <button onClick={() => approveCr(selectedCr, false)} disabled={isApp}
                    className="py-1 px-2.5 bg-card text-subtle-foreground border border-border rounded-md cursor-pointer text-[13px] shrink-0">
                    בטל אישור
                  </button>
                )}
              </>
            ) : (
              <span className="text-[13px] text-subtle-foreground bg-muted py-[3px] px-2.5 rounded-sm border border-border shrink-0">
                {missingTeams.length > 0 ? `ממתין ל-${missingTeams.length} צוותים` : 'ממתין לאישור מנהל — ראה סרגל אישור בתחתית המסך'}
              </span>
            )}
          </div>

          {/* Row 2: manager · teams · systems */}
          {(crManager || teamsForCr.length > 0 || allSystems.length > 0) && (
            <div className="flex gap-3.5 items-center mt-[7px] flex-wrap">
              {crManager && (
                <span className="text-sm text-subtle-foreground" style={{ direction: 'rtl', unicodeBidi: 'isolate' }}>
                  מנהל CR:&nbsp;<bdi className="text-muted-foreground font-semibold">{crManager}</bdi>
                </span>
              )}
              {allSystems.length > 0 && (
                <div className="flex gap-1 flex-wrap items-center">
                  <span className="text-[13px] text-subtle-foreground">מערכות:</span>
                  {allSystems.map(sys => (
                    <span key={sys} className="text-[13px] bg-info-bg text-info py-px px-[7px] rounded-sm font-semibold border border-info/25">{sys}</span>
                  ))}
                </div>
              )}
              {isManager && (
                <button
                  onClick={() => toggleAlreadyInProduction(selectedCr, !isInProduction)}
                  title={isInProduction ? 'לחץ כדי להחזיר לרשימת ה-CR-ים הנדרשים לגרסה זו' : 'סמן אם ה-CR כבר עלה לייצור בנפרד (למשל הוטפיקס קודם) — לא יידרש תוכנית/אישור לגרסה זו'}
                  className={cn(
                    'text-[13px] font-bold py-0.5 px-2.5 rounded-full cursor-pointer border',
                    isInProduction ? 'bg-success-bg text-success' : 'bg-muted text-subtle-foreground'
                  )}
                  style={{ borderColor: isInProduction ? `${C.success}59` : C.border }}>
                  {isInProduction ? '🏭 כבר בייצור' : '🏭 סמן ככבר בייצור'}
                </button>
              )}
            </div>
          )}

          {/* Row 3: rollout mode — night-of vs. gradual/staged */}
          {plans.length > 0 && (
            <div className="mt-[7px]">
              {gradualPlan ? (
                <span className="text-[13px] text-muted-foreground inline-flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-bold text-info bg-info-bg py-px px-2 rounded-full border border-info/25">📶 עלייה מדורגת</span>
                  {gradualPlan.gradualDetails && <span>{gradualPlan.gradualDetails}</span>}
                  {gradualPlan.activationDate && (
                    <span>· תאריך הפעלה: <bdi className="font-semibold text-foreground">{formatDate(gradualPlan.activationDate)}</bdi></span>
                  )}
                </span>
              ) : (
                <span className="text-xs font-bold py-px px-2 rounded-full" style={{ color: C.moduleGoLive, background: `${C.moduleGoLive}18`, border: `1px solid ${C.moduleGoLive}40` }}>🌙 עלייה בליל הגרסה</span>
              )}
            </div>
          )}
        </div>

        {/* ── Teams status strip + KPI row ── */}
        {teamsForCr.length > 0 && (
          <div className="py-3 px-4 border-b border-border bg-background shrink-0">
            <div className="text-[11px] font-bold text-subtle-foreground uppercase tracking-wider mb-2.5">
              סטטוס הגשה לפי צוות — לחיצה מציגה את תקציר התוכנית של הצוות
            </div>
            <div className={cn('flex gap-2.5 flex-wrap', openTeamId ? 'mb-2.5' : 'mb-3')}>
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
                  <span key={t.id}
                    className="flex items-center gap-2 py-1.5 px-3.5 rounded-full bg-card text-[12.5px] font-bold text-foreground"
                    style={{
                      border: `1px solid ${isOpen ? C.moduleGoLive : C.borderEm}`,
                      boxShadow: isOpen ? `0 0 0 2px ${C.moduleGoLive}29` : 'none',
                    }}>
                    {canApprove && (
                      <button onClick={() => approveTeamPlan(selectedCr!, t.id, !plan!.planApproved)} disabled={isBusy}
                        className={cn('text-[11px] font-bold bg-transparent border-none p-0', isBusy ? 'cursor-not-allowed' : 'cursor-pointer')}
                        style={{ color: plan!.planApproved ? C.textMuted : C.moduleGoLive }}>
                        {isBusy ? '…' : plan!.planApproved ? '↩ בטל' : '✓ Approve Team'}
                      </button>
                    )}
                    <span onClick={() => canPreview && setOpenTeamId(isOpen ? null : t.id)}
                      className={cn('flex items-center gap-[7px]', canPreview ? 'cursor-pointer' : 'cursor-default')}>
                      {t.name} · {meta.label}
                      <span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: meta.dot }} />
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
                <div className="bg-muted rounded-md py-3.5 px-4 text-xs text-muted-foreground leading-[1.7] mb-3">
                  <div className="text-xs font-bold text-foreground mb-1.5 flex items-center gap-2">
                    🟢 תקציר תוכנית {openTeamName}
                  </div>
                  {parts.length > 0 ? parts.join(' · ') : 'הצוות לא פירט פעילויות עבור CR זה.'}
                </div>
              );
            })()}

            {missingTeams.length > 0 && (
              <div className="flex items-center gap-2 bg-warning-bg rounded-md py-2 px-3.5 text-[12.5px] text-warning font-semibold mb-3" style={{ border: `1px solid ${C.warning}40` }}>
                ⚠ לא ניתן לאשר את התוכנית המאוחדת — {missingTeams.map(t => t.name).join(', ')} טרם נתן/נתנו התייחסות
              </div>
            )}

            <div className="grid grid-cols-4 gap-2.5">
              {[
                { label: 'צוותים מעורבים', val: teamsForCr.length },
                { label: 'משימות בתוכנית המאוחדת', val: propsForCr.length },
                { label: 'נקודות בקרה / ולידציה', val: plans.reduce((s, p) => s + (p.monitoringPoints?.length ?? 0), 0) },
                { label: 'מוכן לאישור?', val: isApproved ? '✓ אושר' : missingTeams.length > 0 ? `ממתין ל-${missingTeams.length}` : 'מוכן', warn: !isApproved },
              ].map((kpi, i) => (
                <div key={i} className="bg-card border border-border rounded-lg py-3.5 px-[18px] shadow-xs">
                  <div className="text-[11px] font-semibold text-subtle-foreground uppercase tracking-wider">{kpi.label}</div>
                  <div className={cn('font-extrabold mt-1.5', typeof kpi.val === 'string' && kpi.val.length > 6 ? 'text-base' : 'text-2xl')} style={{ color: kpi.warn ? C.warning : C.textPrimary }}>{kpi.val}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Body (single continuous story — no tabs) ── */}
        <div className="py-3.5 px-4">
          <div>

              {/* ── AI Summary — collapsible with manual edit — indigo brand accent,
                  matching the design system's .ai-card (color-mix(brand 5%/22%)) ── */}
              <div className="mb-3.5 rounded-lg overflow-hidden" style={{ border: `1px solid ${C.brand}38` }}>
                {/* Header row */}
                <div
                  className={cn('flex items-center justify-between py-2.5 px-3.5', hasSummary ? 'cursor-pointer' : 'cursor-default')}
                  style={{ background: `${C.brand}0d` }}
                  onClick={() => hasSummary && setSummaryOpen(prev => ({ ...prev, [selectedCr!]: !isSumOpen }))}
                >
                  <div className="flex items-center gap-[7px]">
                    <span className="text-[13px] font-extrabold" style={{ color: C.brand }}>✨ סיכום AI — התוכנית המאוחדת</span>
                    {hasSummary && (
                      <span className="text-xs rounded-xs py-px px-1.5" style={{ color: C.brand, background: `${C.brand}26`, border: `1px solid ${C.brand}4d` }}>שמור</span>
                    )}
                  </div>
                  <div className="flex gap-[7px] items-center" onClick={e => e.stopPropagation()}>
                    {hasSummary && isSumOpen && !isEditing && (
                      <button
                        onClick={() => {
                          setSummaryDraft(prev => ({ ...prev, [selectedCr!]: summaries[selectedCr!] }));
                          setSummaryEditing(prev => ({ ...prev, [selectedCr!]: true }));
                        }}
                        className="text-[11px] font-bold py-1.5 px-3 bg-card text-muted-foreground rounded-full cursor-pointer border border-border">
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
                        className={cn(
                          'text-[11px] font-bold py-1.5 px-3 bg-card text-muted-foreground rounded-full border border-border',
                          summarizingCr === selectedCr ? 'cursor-not-allowed opacity-60' : 'cursor-pointer opacity-100'
                        )}>
                        {summarizingCr === selectedCr ? '⏳ מסכם...' : hasSummary ? '🔄 עדכן' : '✨ צור סיכום'}
                      </button>
                    )}
                    {hasSummary && (
                      <span
                        className={cn('text-sm inline-block cursor-pointer transition-transform duration-200', isSumOpen ? 'rotate-180' : 'rotate-0')}
                        style={{ color: C.brand }}
                        onClick={() => setSummaryOpen(prev => ({ ...prev, [selectedCr!]: !isSumOpen }))}>
                        ▼
                      </span>
                    )}
                  </div>
                </div>

                {/* Body — show when open */}
                {hasSummary && isSumOpen && (
                  <div className="py-3.5 px-[18px] bg-card" style={{ borderTop: `1px solid ${C.brand}26` }}>
                    {isEditing ? (
                      <>
                        <textarea
                          value={summaryDraft[selectedCr] ?? summaries[selectedCr]}
                          onChange={e => setSummaryDraft(prev => ({ ...prev, [selectedCr!]: e.target.value }))}
                          className="w-full min-h-[140px] text-base text-muted-foreground leading-[1.7] bg-muted rounded-md py-2 px-2.5 resize-y"
                          style={{ border: `1px solid ${C.brand}40` }}
                        />
                        <div className="flex gap-2 mt-2 justify-start">
                          <button
                            onClick={() => {
                              setSummaries(prev => ({ ...prev, [selectedCr!]: summaryDraft[selectedCr!] ?? prev[selectedCr!] }));
                              setSummaryEditing(prev => ({ ...prev, [selectedCr!]: false }));
                            }}
                            className="text-sm py-1 px-3.5 text-white border-none rounded-md cursor-pointer font-bold"
                            style={{ background: C.brand }}>
                            💾 שמור
                          </button>
                          <button
                            onClick={() => setSummaryEditing(prev => ({ ...prev, [selectedCr!]: false }))}
                            className="text-sm py-1 px-3 bg-card text-subtle-foreground border border-border rounded-md cursor-pointer">
                            בטל
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="text-[12.5px] text-foreground leading-[1.7] whitespace-pre-wrap">
                        {summaries[selectedCr]}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* CR description */}
              {crDesc && (
                <div className="mb-3.5 py-2 px-3 bg-muted border border-border rounded-md">
                  <div className="text-sm text-muted-foreground font-bold mb-1">פרטי CR</div>
                  <div className="text-base text-muted-foreground leading-normal">{crDesc}</div>
                </div>
              )}

          </div>

          {/* ── Story header + narrate button ── */}
          <div className="flex items-start justify-between gap-3 my-[22px] mb-3.5">
            <div>
              <div className="text-[15px] font-extrabold text-foreground">התוכנית המאוחדת — כל המשימות של כל הצוותים ל-CR זה, לפי ציר הזמן</div>
              <div className="text-[11.5px] text-subtle-foreground mt-0.5">מיועד להקראה בישיבת סקירת הגרסה ובליל העלייה — סדר ביצוע רציף, לא לפי סוג פעילות</div>
            </div>
            <button onClick={toggleNarrate}
              className="flex items-center gap-1.5 text-xs font-bold py-1.5 px-3.5 rounded-full cursor-pointer shrink-0"
              style={{ color: C.moduleGoLive, background: `${C.moduleGoLive}18`, border: `1px solid ${C.moduleGoLive}4d` }}>
              {speaking ? '⏹ עצור הקראה' : '🔊 מצב הקראה'}
            </button>
          </div>

          <div>
              {propsForCr.length === 0 ? (
                <div className="text-center py-10 px-5 text-subtle-foreground">
                  <div className="text-[28px] mb-2.5">📋</div>
                  ראשי הצוותים טרם הוסיפו משימות לביצוע
                </div>
              ) : (
                (() => { let stepCounter = 0; return [1, 2, 3, 4].map(phase => {
                  const phaseProps = propsForCr.filter(p => p.phase === phase);
                  if (!phaseProps.length) return null;
                  const phaseName = PHASE_LABEL[phase] ?? `שלב ${phase}`;
                  return (
                    <div key={phase} className="mb-5">
                      {/* Phase node — one accent (Go-Live orange) for every phase,
                          differentiated by icon/title, matching the design system's
                          per-module color convention rather than a rainbow per phase. */}
                      <div className="flex items-center gap-3.5 mb-3">
                        <div className="w-10 h-10 rounded-full shrink-0 text-white text-lg flex items-center justify-center shadow-sm" style={{ background: C.moduleGoLive }}>
                          {PHASE_ICON[phase] ?? '📌'}
                        </div>
                        <div>
                          <div className="text-[15px] font-extrabold text-foreground">{phaseName}</div>
                          <div className="text-[11.5px] text-subtle-foreground">{PHASE_META[phase]} · {phaseProps.length} משימות</div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 ps-[54px]">
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
                          <div key={prop.id} className="flex items-start gap-3 py-3.5 px-4 bg-card border border-border rounded-lg shadow-xs">
                            <span className="font-mono text-[11px] font-bold text-subtle-foreground shrink-0 pt-0.5 w-5">
                              {stepNum}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13.5px] text-foreground leading-[1.6]">{sentence || prop.title}</div>
                              {prop.notes && (
                                <div
                                  className={cn('mt-1 text-[13px] pe-2', depNote ? 'font-semibold' : 'font-normal')}
                                  style={{ color: depNote ? C.info : C.textMuted, borderInlineEnd: `2px solid ${depNote ? C.info : C.border}` }}>
                                  {depNote ? '↳' : '💬'} {cleanHtmlText(prop.notes)}
                                </div>
                              )}
                              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                {teamName && (
                                  <span className="text-[10px] font-bold py-[3px] px-2.5 rounded-full" style={{ background: tColor.bg, color: tColor.color }}>
                                    {teamName}
                                  </span>
                                )}
                                <span
                                  className="text-[10px] font-semibold py-0.5 px-2 rounded-full"
                                  style={{
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
            <div className="mt-5 bg-card border border-border rounded-lg shadow-xs py-4 px-[18px]">
              <div className="text-[13px] font-extrabold text-foreground mb-2.5 flex items-center gap-2">
                ↩ Rollback מרוכז — פעולות ביצוע קונקרטיות בלבד
              </div>
              <div className="flex flex-col gap-2">
                {plans.filter(p => p.rollbackType || p.rollbackPlan).map(p => {
                  const tColor = teamColor(p.team.name);
                  return (
                    <div key={p.id} className="flex items-center gap-2.5 text-[12.5px] text-muted-foreground">
                      <span className="text-[10px] font-bold py-[3px] px-2.5 rounded-full shrink-0" style={{ background: tColor.bg, color: tColor.color }}>{p.team.name}</span>
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
          <div className="sticky -bottom-3.5 mt-5 -mx-4 -mb-3.5 bg-card border-t border-border shadow-md py-3.5 px-5 flex items-center justify-between gap-4 flex-wrap shrink-0">
            <span className="text-xs text-subtle-foreground">
              ניתן לאשר את ה-CR כולו רק כשכל הצוותים המעורבים נמצאים במצב Submitted או No Special Activity — עד אז ניתן לאשר משימה/קבוצה/צוות בנפרד
            </span>
            <div className="flex gap-2 flex-wrap">
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
                className="py-2.5 px-4 rounded-md text-xs font-bold bg-card text-danger cursor-pointer" style={{ border: `1px solid ${C.danger}4d` }}>
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
                className="py-2.5 px-4 rounded-md text-xs font-bold bg-card text-warning cursor-pointer" style={{ border: `1px solid ${C.warning}4d` }}>
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
                className={cn(
                  'py-3 px-5 rounded-md text-[13px] font-bold border-none',
                  (isApp || isApproved || missingTeams.length > 0) ? 'cursor-not-allowed' : 'cursor-pointer'
                )}
                style={{
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
        <div className="p-8 text-center text-subtle-foreground text-[15px] bg-card rounded-lg border border-border">
          לא נמצאו CR-ים — בצע סינכרון מקובץ CR_LIST
        </div>
      ) : (
        <div className="flex border border-border rounded-xl overflow-hidden min-h-[62vh]">
          {/* ── LEFT: CR list (252px) ── */}
          <div className="w-[252px] shrink-0 border-e border-border flex flex-col bg-card">
            {/* Progress + filter */}
            <div className="py-2.5 px-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex-1 h-1 bg-border rounded-sm overflow-hidden">
                  <div className="h-full rounded-sm transition-[width] duration-[0.4s]" style={{ background: allApproved ? '#3fb950' : '#f0883e', width: `${pct}%` }} />
                </div>
                <span className="text-[13px] font-bold whitespace-nowrap" style={{ color: allApproved ? '#3fb950' : '#f0883e' }}>{approvedCount}/{allCrNumbers.length} CR</span>
              </div>
              <div className="flex gap-1 flex-wrap">
                {(['all', 'pending', 'approved', 'not_required'] as const).map(f => (
                  <button key={f} onClick={() => setCrFilter(f)}
                    className={cn(
                      'py-0.5 px-2 border-none rounded-full cursor-pointer text-xs font-semibold transition-colors duration-100',
                      crFilter === f ? 'text-white' : 'bg-muted text-subtle-foreground'
                    )}
                    style={{ background: crFilter === f ? '#1a2332' : undefined }}>
                    {f === 'all' ? 'הכל' : f === 'pending' ? 'ממתין' : f === 'approved' ? 'אושר' : 'לא נדרש'}
                  </button>
                ))}
              </div>
            </div>

            {/* CR items */}
            <div className="flex-1 overflow-y-auto">
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
                    className="flex items-start gap-2.5 py-2.5 px-3.5 cursor-pointer border-b border-muted transition-colors duration-100"
                    style={{ borderInlineEnd: `3px solid ${isSelected ? C.brand : 'transparent'}`, background: isSelected ? C.infoBg : 'transparent' }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = C.bgHover; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div className="w-[7px] h-[7px] rounded-full shrink-0 mt-1.5" style={{ background: dotColor }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-foreground font-mono">{crNumber}</div>
                      <div className="text-[13px] text-subtle-foreground leading-[1.35] mt-px overflow-hidden text-ellipsis whitespace-nowrap" title={crTitle}>{crTitle || '—'}</div>
                      <div className="text-xs mt-0.5 flex items-center gap-1.5 flex-wrap">
                        {highRisk && RISK[highRisk] && <span className="py-px px-[5px] rounded-xs font-semibold" style={{ background: RISK[highRisk].bg, color: RISK[highRisk].color }}>{RISK[highRisk].label}</span>}
                        <span style={{ color: isApproved ? '#3fb950' : C.textDisabled }}>
                          {isApproved ? '✓ אושר' : isNotNeeded ? '✗ לא נדרש' : `${propsForCr.length} משימות`}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredCrNums.length === 0 && (
                <div className="py-5 px-3.5 text-center text-subtle-foreground text-sm">אין תוצאות</div>
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
      className="py-2.5 px-4 cursor-pointer select-none flex items-center justify-between"
      style={{ background: allTeamsSubmitted ? 'rgba(63,185,80,0.10)' : 'rgba(248,81,73,0.08)' }}>
      <span className="text-[15px] font-bold flex items-center gap-2" style={{ color: allTeamsSubmitted ? C.statusDone : C.statusBlocked }}>
        <span>{allTeamsSubmitted ? '✅' : '●'}</span>
        {allTeamsSubmitted
          ? `כל ${involvedTeams.length} הצוותים הגישו · אושרו: ${approvedCount}/${allCrNumbers.length} CR`
          : `הגישו: ${teamsAllCovered}/${involvedTeams.length} צוותים · אושרו: ${approvedCount}/${allCrNumbers.length} CR`}
      </span>
      <div className="flex items-center gap-2">
        <div className="w-20 h-[5px] bg-border rounded-sm overflow-hidden">
          <div className="h-full rounded-sm transition-[width] duration-[0.4s]" style={{ background: allTeamsSubmitted ? '#3fb950' : '#f0883e', width: `${submissionPct}%` }} />
        </div>
        <span className={cn('text-[15px] text-subtle-foreground inline-block transition-transform duration-200', teamPanelOpen ? 'rotate-180' : 'rotate-0')}>▼</span>
      </div>
    </div>
  );

  if (section === 'teams') return (
    <div>
      <div
        className="bg-card rounded-xl overflow-hidden"
        style={{ border: `1px solid ${allTeamsSubmitted ? '#3fb95044' : C.border}`, boxShadow: allTeamsSubmitted ? '0 0 0 3px rgba(63,185,80,0.08)' : 'none' }}>
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
    <div className="p-8 text-center text-subtle-foreground text-[15px] bg-card rounded-lg border border-border">
      לא נמצאו CR-ים — בצע סינכרון מקובץ CR_LIST
    </div>
  ) : (
    <div className="flex flex-col border border-border rounded-lg overflow-visible">
      {/* Step progress header */}
      <div className="flex items-center gap-3 py-3 px-4 border-b border-border bg-card shrink-0">
        <span className="text-[13px] font-bold text-subtle-foreground whitespace-nowrap">
          CR {currentStepIndex + 1} מתוך {allCrNumbers.length}
        </span>
        <div className="flex-1 h-1.5 bg-border rounded-sm overflow-hidden">
          <div className="h-full rounded-sm transition-[width] duration-[0.4s]" style={{ background: allApproved ? C.success : C.moduleGoLive, width: `${pct}%` }} />
        </div>
        <span className="text-[13px] font-bold whitespace-nowrap" style={{ color: allApproved ? C.success : C.moduleGoLive }}>
          {approvedCount}/{allCrNumbers.length} אושרו
        </span>
      </div>

      {/* Current CR detail */}
      <div className="flex-1 flex">
        {renderDetail()}
      </div>

      {/* Step navigation footer */}
      <div className="flex items-center justify-between py-3 px-4 border-t border-border bg-card shrink-0">
        <button onClick={() => goToStep(-1)} disabled={currentStepIndex <= 0}
          className={cn('py-2 px-[18px] border border-border rounded-md bg-card font-bold text-sm', currentStepIndex <= 0 ? 'text-subtle-foreground cursor-not-allowed' : 'text-muted-foreground cursor-pointer')}>
          → הקודם
        </button>
        {allApproved && (
          <span className="text-sm font-bold text-success">✅ כל התוכניות אושרו</span>
        )}
        <button onClick={() => goToStep(1)} disabled={currentStepIndex >= allCrNumbers.length - 1}
          className={cn(
            'py-2 px-[18px] border-none rounded-md font-bold text-sm',
            currentStepIndex >= allCrNumbers.length - 1 ? 'bg-muted text-subtle-foreground cursor-not-allowed' : 'bg-primary text-white cursor-pointer'
          )}>
          הבא ←
        </button>
      </div>
    </div>
  );

  if (section === 'crs') return (
    <div>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />
      {wizardView}
    </div>
  );

  return (
    <div>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />
      {/* Team panel */}
      <div
        className="bg-card rounded-xl overflow-hidden mb-4"
        style={{ border: `1px solid ${allTeamsSubmitted ? '#3fb95044' : C.border}`, boxShadow: allTeamsSubmitted ? '0 0 0 3px rgba(63,185,80,0.08)' : 'none' }}>
        {teamPanelHeader}
        {teamPanelOpen && teamGrid}
      </div>
      {splitPanel}
    </div>
  );
};
