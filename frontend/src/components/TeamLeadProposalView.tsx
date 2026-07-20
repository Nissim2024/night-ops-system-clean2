import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';
import { C, FONT, FONT_MONO, RADIUS, SHADOW, WEIGHT } from '../theme';
import { cleanHtmlText } from '../utils/textSanitize';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const PHASE_LABELS: Record<number, string> = {
  1: 'שלב 1 — בוקר לפני גרסה',
  2: 'שלב 2 — HOTNET',
  3: 'שלב 3 — HOT',
  4: 'שלב 4 — בוקר לאחר גרסה',
};

const PHASE_BADGE: Record<number, { bg: string; color: string }> = {
  1: { bg: C.infoBg,    color: C.info },
  2: { bg: C.successBg, color: C.success },
  3: { bg: C.warningBg, color: C.warning },
  4: { bg: C.bgWaiting, color: C.statusWaiting },
};

const APPS = [
  'BILI', 'CRM', 'OSB', 'DP', 'WEB-RETAIL', 'WEB-NEXT', 'WEB-HOT',
  'TOP', 'IRB', 'NC', 'ERP', 'CONNECT', 'CREDIT GUARD', 'ARCHIVE',
  'PRINT BOSS', 'NIFI', 'CAWA', 'BEERI', 'IVR', 'MEDIATION',
  'PROVISIONING LDAP', 'PROVISIONING TIBCO', 'PROVISIONING NAGRA',
  'PROVISIONING OTT', 'PROVISIONING TEL', 'REMEDY', 'ZOO', 'אחר',
];
const FREE_KEY = '__FREE__';

const TEAM_APPS: Record<string, string[]> = {
  'NETC Team':               ['BILI', 'IRB'],
  'CRM Dev Team':            ['CRM', 'TOP', 'CONNECT'],
  'EAI Team':                ['OSB', 'DP', 'MEDIATION', 'PROVISIONING LDAP', 'PROVISIONING TIBCO', 'PROVISIONING NAGRA', 'PROVISIONING OTT', 'PROVISIONING TEL'],
  'Web Dev Team':            ['WEB-RETAIL', 'WEB-NEXT', 'WEB-HOT'],
  'NC Team':                 ['NC'],
  'ERP Team':                ['ERP'],
  'Operations Team':         ['CREDIT GUARD', 'ARCHIVE', 'PRINT BOSS', 'BEERI'],
  'Billing Operations Team': ['CREDIT GUARD', 'ARCHIVE', 'PRINT BOSS', 'BEERI'],
  'SHOB Team':               ['NIFI', 'CAWA'],
  'IVR Team':                ['IVR'],
  'OSS Team':                ['REMEDY', 'ZOO'],
  // Teams not listed → show all APPS (fallback handled below)
};

const ACTION_TYPES = [
  'הרצת סקריפט',
  'הגדרת פרמטרים',
  'הגדרת הרשאות',
  'עצירת תהליך מתוזמן',
  'החזרת תהליך מתוזמן',
  'הטמעת קוד',
  'הסבת נתונים',
  'בדיקת תקינות',
  'הגדרת תצורה',
  'פעולה ידנית',
  'אחר',
];
// ── טופס CR מובנה (exception-first) — אפיון 2026-07-17 ─────────────────────────
const GOLIVE = C.moduleGoLive; // מודול "עלייה לאוויר" — הגוון הייעודי מהעיצוב שאושר
const CHANGE_TYPES = ['קוד', 'פרמטר', 'הרשאה', 'Setup', 'ממשק', 'תהליך מתוזמן / Job', 'סקריפט', 'הסבת נתונים', 'קובץ'];
const PREREQUISITE_OPTIONS = ['אישור מנהל', 'גיבוי מוקדם', 'חלון תחזוקה', 'תיאום עם צוות חיצוני'];
const ACTION_TYPE_OPTIONS = [
  'הרצת סקריפט', 'הסבת נתונים', 'טעינת קובץ', 'יצירת תיקייה', 'עדכון Crontab',
  'עצירת Job', 'הפעלת Job', 'פתיחת פרמטר', 'פתיחת הרשאה', 'בדיקה ידנית', 'פעולת תפעול', 'אחר',
];
const MONITORING_TYPES = ['Interface', 'Table', 'Job', 'Report', 'Queue', 'File', 'Other'];
const ROLLBACK_TYPES = ['כיבוי פרמטר', 'הסרת הרשאה', 'עצירת Job', 'החזרת קובץ', 'חזרה מגיבוי', 'לא נדרש — תיקון ידני', 'אחר'];

// Timeline Planning — day-part buckets, mapped onto the real 4-value phase
// field (1=before, 2=HOTNET, 3=HOT, 4=after). Visual grouping only — no new
// data, so there's no 5th "release day morning" bucket some design mockups
// show, since the schema has nothing to back it.
const PHASE_BUCKETS: { letter: string; phase: number; title: string; meta: string }[] = [
  { letter: 'A', phase: 1, title: 'הכנות לפני יום הגרסה', meta: 'הרשאות, קבצים, Setup מקדים' },
  { letter: 'C', phase: 2, title: 'ליל הגרסה — שלב 2 (HOTNET)', meta: 'עדכוני פרמטרים, סקריפטים, הרשאות' },
  { letter: 'D', phase: 3, title: 'ליל הגרסה — שלב 3 (HOT)', meta: 'פעולות ייחודיות לאחר עליית הקוד' },
  { letter: 'E', phase: 4, title: 'בוקר שלאחר הגרסה', meta: 'מעקב ובקרה תפעולית' },
];
// One icon+color per real action type — a rough mapping onto the mockup's
// container categories (Setup/Parameters/Permissions/Scripts/Validation...).
const ACTION_TYPE_ICON: Record<string, { icon: string; bg: string; color: string }> = {
  'הרצת סקריפט':    { icon: '📄', color: C.brand,   bg: C.brandDim },
  'הסבת נתונים':    { icon: '🔄', color: C.info,    bg: C.infoBg },
  'טעינת קובץ':     { icon: '📁', color: C.info,    bg: C.infoBg },
  'יצירת תיקייה':   { icon: '📁', color: C.info,    bg: C.infoBg },
  'עדכון Crontab':  { icon: '⚙️', color: C.warning, bg: C.warningBg },
  'עצירת Job':      { icon: '⏸️', color: C.warning, bg: C.warningBg },
  'הפעלת Job':      { icon: '▶️', color: C.warning, bg: C.warningBg },
  'פתיחת פרמטר':    { icon: '⚙️', color: C.warning, bg: C.warningBg },
  'פתיחת הרשאה':    { icon: '🔑', color: C.success, bg: C.successBg },
  'בדיקה ידנית':    { icon: '✔️', color: C.success, bg: C.successBg },
  'פעולת תפעול':    { icon: '🛠️', color: C.textMuted, bg: C.bgNested },
  'אחר':            { icon: '⋯', color: C.textMuted, bg: C.bgNested },
};

interface CrPlanAction {
  id?: string;
  actionType: string;
  description: string;
  phase: number;
  subPhaseId?: string;
  system?: string;
  estimatedMins?: number;
  dependsOnTaskId?: string;
  dependencyNote?: string;
  ownerName?: string;
}
interface CrPlanMonitoringPoint {
  id?: string;
  type: string;
  name: string;
  note?: string;
  phase: number;
  assignedTeamId?: string;
  assignedUserName?: string;
}

interface Proposal {
  id: string;
  teamId: string;
  title: string;
  app?: string;
  actionType?: string;
  estimatedMins?: number;
  crNumber?: string;
  crLabel?: string;
  notes?: string;
  assignedUserName?: string;
  phase: number;
  status: 'DRAFT' | 'READY';
  usedInTaskId?: string;
}

interface CrPlanData {
  id: string;
  crNumber: string;
  crLabel?: string;
  crManager?: string;
  crDescription?: string;
  crType?: string;
  riskLevel?: string;
  systems?: string[];
  workPlan?: string;
  scripts?: string;
  runTimes?: string;
  rollbackPlan?: string;
  gradualRollout: boolean;
  gradualDetails?: string;
  nightTestingNotes?: string;
  morningMonitoring?: string;
  notNeededForPlan: boolean;
  crDeps: { id: string; dependsOnCr: string; note?: string }[];
  submissionStatus?: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED';
  returnReason?: string;
  // ── טופס CR מובנה ──
  gateAnswered: boolean;
  changeTypes: string[];
  prerequisites: string[];
  prerequisitesNote?: string;
  nightTestNeeded: boolean;
  nextDayTestNeeded: boolean;
  nextDayTestNotes?: string;
  rollbackType?: string;
  actions: (CrPlanAction & { id: string })[];
  monitoringPoints: (CrPlanMonitoringPoint & { id: string })[];
}

interface CrPlanForm {
  crType: string;
  riskLevel: string;
  systems: string[];
  workPlan: string;
  scripts: string;
  runTimes: string;
  rollbackPlan: string;
  gradualRollout: boolean;
  gradualDetails: string;
  nightTestingNotes: string;
  morningMonitoring: string;
  dependsOnCrs: string[];
  dependencyNotes: Record<string, string>;
  // ── טופס CR מובנה ──
  gateAnswered: boolean;
  changeTypes: string[];
  prerequisites: string[];
  prerequisitesNote: string;
  nightTestNeeded: boolean;
  nextDayTestNeeded: boolean;
  nextDayTestNotes: string;
  rollbackType: string;
  actions: CrPlanAction[];
  monitoringPoints: CrPlanMonitoringPoint[];
}

const emptyCrPlanForm = (): CrPlanForm => ({
  crType: 'פיתוח חדש',
  riskLevel: '',
  systems: [],
  workPlan: '',
  scripts: '',
  runTimes: '',
  rollbackPlan: '',
  gradualRollout: false,
  gradualDetails: '',
  nightTestingNotes: '',
  morningMonitoring: '',
  dependsOnCrs: [],
  dependencyNotes: {},
  gateAnswered: false,
  changeTypes: [],
  prerequisites: [],
  prerequisitesNote: '',
  nightTestNeeded: false,
  nextDayTestNeeded: false,
  nextDayTestNotes: '',
  rollbackType: '',
  actions: [],
  monitoringPoints: [],
});

// Builds editable form state from a saved CrPlan — used both after fetching the
// version's plans and right after a save/submit response, so ids assigned by the
// server (needed to keep CrPlanAction rows stable across saves) always flow back
// into local state instead of being silently dropped.
const planToForm = (p: CrPlanData): CrPlanForm => {
  const dependencyNotes: Record<string, string> = {};
  for (const d of p.crDeps) if (d.note) dependencyNotes[d.dependsOnCr] = d.note;
  return {
    crType: p.crType ?? 'פיתוח חדש',
    riskLevel: p.riskLevel ?? '',
    systems: Array.from(new Set((p.systems ?? []).filter(Boolean))),
    workPlan: p.workPlan ?? '',
    scripts: p.scripts ?? '',
    runTimes: p.runTimes ?? '',
    rollbackPlan: p.rollbackPlan ?? '',
    gradualRollout: p.gradualRollout,
    gradualDetails: p.gradualDetails ?? '',
    nightTestingNotes: p.nightTestingNotes ?? '',
    morningMonitoring: p.morningMonitoring ?? '',
    dependsOnCrs: p.crDeps.map(d => d.dependsOnCr),
    dependencyNotes,
    gateAnswered: p.gateAnswered ?? false,
    changeTypes: p.changeTypes ?? [],
    prerequisites: p.prerequisites ?? [],
    prerequisitesNote: p.prerequisitesNote ?? '',
    nightTestNeeded: p.nightTestNeeded ?? false,
    nextDayTestNeeded: p.nextDayTestNeeded ?? false,
    nextDayTestNotes: p.nextDayTestNotes ?? '',
    rollbackType: p.rollbackType ?? '',
    actions: (p.actions ?? []).map(a => ({ ...a })),
    monitoringPoints: (p.monitoringPoints ?? []).map(m => ({ ...m })),
  };
};

interface CrItem { id: string; label: string; crManager?: string; crDescription?: string; }
interface User { id: string; fullName: string; }
interface TeamVisibilityRow {
  teamId: string; teamName: string; isMine: boolean;
  submissionStatus: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED' | null;
  notNeededForPlan: boolean; gateAnswered: boolean; started: boolean;
}
interface TeamPlanPreview {
  teamName: string; crLabel: string | null; notNeededForPlan: boolean;
  submittedAt: string | null; submittedByName: string | null;
  actions: { actionType: string; description: string; phase: number; system: string | null; estimatedMins: number | null; ownerName: string | null }[];
  monitoringPoints: { type: string; name: string; note: string | null; phase: number; assignedUserName: string | null }[];
  nightTestNeeded: boolean; nextDayTestNeeded: boolean;
  rollbackType: string | null; rollbackPlan: string | null;
}

interface Props {
  token: string;
  versionId: string;
  versionName: string;
  teamIdOverride?: string;
  teamNameOverride?: string;
  reviewMeetingTime?: string;
  isManager?: boolean;
}

const emptyForm = {
  title: '',
  app: '',
  actionType: '',
  estimatedMins: '',
  crNumber: '',
  crLabel: '',
  isFree: false,
  notes: '',
  assignedUserName: '',
  phase: 1 as number,
  subPhaseId: '',
  responsibleTeamId: '',
};

const labelStyle: React.CSSProperties = {
  fontSize: '14px', color: C.textSecondary, display: 'block',
  marginBottom: '4px', fontWeight: '600',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px', border: `1px solid ${C.border}`,
  borderRadius: RADIUS.md, fontSize: '15px', boxSizing: 'border-box',
  fontFamily: FONT,
};

export const TeamLeadProposalView: React.FC<Props> = ({ token, versionId, versionName, teamIdOverride, teamNameOverride, reviewMeetingTime, isManager }) => {
  const [proposals, setProposals]       = useState<Proposal[]>([]);
  const [crItems, setCrItems]           = useState<CrItem[]>([]);
  const [users, setUsers]               = useState<User[]>([]);
  const [myTeamName, setMyTeamName]     = useState('');
  const [myTeamId, setMyTeamId]         = useState('');
  // Default-locked to the submitting team — the checkbox is an explicit opt-in
  // to assign a task to a different (e.g. QA) team, not the default path.
  const [allowOtherTeam, setAllowOtherTeam] = useState(false);
  const [teams, setTeams]               = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);
  // Cross-team coordination info per CR — all teams + systems touching it,
  // not just this lead's own (see cr-scope endpoint on version-cr-assignments).
  const [crScope, setCrScope]           = useState<Record<string, { teamNames: string[]; systems: string[] }>>({});

  // Submission state
  const [submissionDone, setSubmissionDone] = useState(false);
  const [submitting, setSubmitting]         = useState(false);
  const [submitError, setSubmitError]       = useState<string | null>(null);
  const [submitErrorCrs, setSubmitErrorCrs] = useState<string[]>([]);
  const [managerUnlocked, setManagerUnlocked] = useState(false);
  // locked = הגשה הושלמה ולא בוצע ביטול נעילה ע"י מנהל
  const locked = submissionDone && !managerUnlocked;

  // Proposal form — tracks which CR's form is open (crNumber, FREE_KEY, or null=closed)
  const [openFormForCr, setOpenFormForCr] = useState<string | null>(null);
  const [editId, setEditId]             = useState<string | null>(null);
  const [form, setForm]                 = useState({ ...emptyForm });
  const [crSearch, setCrSearch]         = useState('');
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState<string | null>(null);

  // CrPlan state
  const [crPlans, setCrPlans]           = useState<Record<string, CrPlanData>>({});
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set());
  const [crPlanForms, setCrPlanForms]   = useState<Record<string, CrPlanForm>>({});
  const [savingPlan, setSavingPlan]     = useState<string | null>(null);
  const [derivedTaskNote, setDerivedTaskNote] = useState<Record<string, string>>({});
  // Per-CR: once a plan is SUBMITTED/APPROVED the form locks read-only — clicking
  // the confirm button again shouldn't silently keep re-saving it. An explicit
  // "פתח לעריכה" unlocks one specific CR for editing.
  const [unlockedForEdit, setUnlockedForEdit] = useState<Set<string>>(new Set());
  // Collapsible dependency picker — which action's picker is open, and which phase
  // groups within it are expanded. Only one can be open at a time.
  const [depPicker, setDepPicker] = useState<{ actionIdx: number; openPhases: Set<number> } | null>(null);
  // Visual grouping only (Timeline Planning) — collapses/expands an
  // actionType container within a phase bucket; key = `${phase}-${actionType}`.
  // Defaults to all-expanded so nothing regresses for existing plans.
  const [collapsedContainers, setCollapsedContainers] = useState<Set<string>>(new Set());
  const [selectedCr, setSelectedCr]   = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<'plan' | 'tasks'>('plan');
  // Cross-team visibility — status only (never another team's plan content) for
  // every CR our own team is assigned to, so a lead can see at a glance whether
  // the other teams sharing a CR have started/submitted yet.
  const [teamVisibility, setTeamVisibility] = useState<Record<string, { crLabel: string | null; teams: TeamVisibilityRow[] }>>({});
  const [teamPreview, setTeamPreview] = useState<{ teamName: string; loading: boolean; error: string | null; data: TeamPlanPreview | null } | null>(null);

  const openTeamPreview = useCallback(async (crNumber: string, teamId: string, teamName: string) => {
    setTeamPreview({ teamName, loading: true, error: null, data: null });
    try {
      const res = await axios.get(`${API}/cr-plans/version/${versionId}/cr/${crNumber}/team/${teamId}/preview`, { headers: { Authorization: `Bearer ${token}` } });
      setTeamPreview({ teamName, loading: false, error: null, data: res.data });
    } catch (e: any) {
      setTeamPreview({ teamName, loading: false, error: e?.response?.data?.message ?? 'שגיאה בטעינת תצוגה מקדימה', data: null });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);

  // Extract-tasks modal
  interface ExtractItem { text: string; checked: boolean; phase: number; estimatedMins: string; assignedUserName: string; duplicateId?: string; }
  const [extractModal, setExtractModal] = useState<{
    crNumber: string;
    sourceLabel: string;
    defaultPhase: number;
    items: ExtractItem[];
  } | null>(null);
  const [extracting, setExtracting] = useState(false);

  const parseTextToLines = (text: string): string[] =>
    text
      .split(/\n|•|·|–|—|\d+\.\s/)
      .map(l => l.replace(/^[-*\s]+/, '').trim())
      .filter(l => l.length > 2);

  const openExtract = (crNumber: string, text: string, sourceLabel: string, defaultPhase: number) => {
    const lines = parseTextToLines(text);
    if (!lines.length) return;
    setExtractModal({
      crNumber,
      sourceLabel,
      defaultPhase,
      items: lines.map(t => {
        const dup = proposals.find(p => p.crNumber === crNumber && p.title.trim().toLowerCase() === t.trim().toLowerCase());
        return { text: t, checked: true, phase: defaultPhase, estimatedMins: '', assignedUserName: dup?.assignedUserName || '', duplicateId: dup?.id };
      }),
    });
  };

  const doCreateExtracted = async (replaceConflicts: boolean) => {
    if (!extractModal) return;
    const toCreate = extractModal.items.filter(i => i.checked && i.text.trim());
    setExtracting(true);
    try {
      for (const item of toCreate) {
        if (item.duplicateId) {
          if (!replaceConflicts) continue;
          await axios.patch(`${API}/task-proposals/${item.duplicateId}`, {
            title: item.text.trim(), phase: item.phase,
            estimatedMins: item.estimatedMins ? parseInt(item.estimatedMins) : undefined,
            assignedUserName: item.assignedUserName || undefined,
          }, { headers });
        } else {
          await axios.post(`${API}/task-proposals/version/${versionId}`, {
            title: item.text.trim(), phase: item.phase,
            estimatedMins: item.estimatedMins ? parseInt(item.estimatedMins) : undefined,
            assignedUserName: item.assignedUserName || undefined,
            crNumber: extractModal.crNumber,
            crLabel: getCrLabel(extractModal.crNumber) || undefined,
            ...(teamIdOverride ? { teamIdOverride } : {}),
          }, { headers });
        }
      }
      await fetchProposals();
      setExtractModal(null);
    } finally { setExtracting(false); }
  };

  const createExtracted = () => {
    if (!extractModal) return;
    const conflicts = extractModal.items.filter(i => i.checked && i.duplicateId);
    if (conflicts.length > 0) {
      setDialog({
        title: 'משימות כפולות',
        message: `${conflicts.length} מהמשימות שבחרת כבר קיימות.\nהאם להחליף אותן בגרסה החדשה?`,
        variant: 'warning',
        confirmLabel: 'החלף',
        cancelLabel: 'דלג על הקיימות',
        onConfirm: () => doCreateExtracted(true),
        onCancel:  () => doCreateExtracted(false),
      });
    } else {
      doCreateExtracted(false);
    }
  };

  // Sub-phases from version plan
  const [subPhaseOpts, setSubPhaseOpts] = useState<{ id: string; name: string; phaseName: string; phaseOrderIndex: number }[]>([]);

  useEffect(() => {
    if (!versionId) return;
    axios.get(`${API}/versions/${versionId}/sub-phases`, { headers })
      .then(r => {
        const opts: typeof subPhaseOpts = [];
        for (const phase of r.data) {
          for (const sp of phase.subPhases) {
            opts.push({ id: sp.id, name: sp.name, phaseName: phase.name, phaseOrderIndex: phase.orderIndex });
          }
        }
        setSubPhaseOpts(opts);
      })
      .catch(() => {});
  }, [versionId]); // eslint-disable-line

  // Real tasks already scheduled in this version's framework plan — used to let a team
  // pick an actual dependency instead of typing free text (TEAM_LEAD sees all teams' tasks).
  const [frameworkTasks, setFrameworkTasks] = useState<{ id: string; title: string; subPhaseId: string | null }[]>([]);

  useEffect(() => {
    if (!versionId) return;
    axios.get(`${API}/tasks`, { headers, params: { versionId } })
      .then(r => setFrameworkTasks((r.data as any[]).map(t => ({ id: t.id, title: t.title, subPhaseId: t.subPhaseId }))))
      .catch(() => {});
  }, [versionId]); // eslint-disable-line

  // Framework tasks grouped שלב ← תת-שלב ← משימה, for the collapsible dependency picker.
  const frameworkTasksByPhase = useMemo(() => {
    const subPhaseById = new Map(subPhaseOpts.map(sp => [sp.id, sp]));
    const byPhase = new Map<number, { phaseLabel: string; bySubPhase: Map<string, { subPhaseName: string; tasks: { id: string; title: string }[] }> }>();
    for (const t of frameworkTasks) {
      const sp = t.subPhaseId ? subPhaseById.get(t.subPhaseId) : undefined;
      const phaseOrderIndex = sp?.phaseOrderIndex ?? 0;
      const phaseLabel = sp ? `שלב ${phaseOrderIndex} — ${sp.phaseName}` : 'ללא שלב';
      if (!byPhase.has(phaseOrderIndex)) byPhase.set(phaseOrderIndex, { phaseLabel, bySubPhase: new Map() });
      const phaseEntry = byPhase.get(phaseOrderIndex)!;
      const subKey = sp?.id ?? '__none__';
      const subName = sp?.name ?? 'ללא תת-שלב';
      if (!phaseEntry.bySubPhase.has(subKey)) phaseEntry.bySubPhase.set(subKey, { subPhaseName: subName, tasks: [] });
      phaseEntry.bySubPhase.get(subKey)!.tasks.push({ id: t.id, title: t.title });
    }
    return Array.from(byPhase.entries()).sort((a, b) => a[0] - b[0]);
  }, [frameworkTasks, subPhaseOpts]);

  // Phase labels derived from actual version phase names
  const phaseLabels = useMemo(() => {
    const map: Record<number, string> = {};
    for (const sp of subPhaseOpts) {
      if (!map[sp.phaseOrderIndex] && sp.phaseName) {
        map[sp.phaseOrderIndex] = `שלב ${sp.phaseOrderIndex} — ${sp.phaseName}`;
      }
    }
    return map;
  }, [subPhaseOpts]);


  // Sync state
  const [syncLoading, setSyncLoading]   = useState(false);
  const [syncError, setSyncError]       = useState<string | null>(null);

  // "Not needed" toggle state
  const [togglingNotNeeded, setTogglingNotNeeded] = useState<Set<string>>(new Set());

  // Dialog state
  const [dialog, setDialog] = useState<DialogConfig | null>(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchProposals = useCallback(async () => {
    try {
      const url = teamIdOverride
        ? `${API}/task-proposals/version/${versionId}?teamId=${teamIdOverride}`
        : `${API}/task-proposals/version/${versionId}`;
      const res = await axios.get(url, { headers });
      setProposals(res.data);
    } catch { /* silent */ }
  }, [versionId, teamIdOverride]); // eslint-disable-line

  const fetchCrPlans = useCallback(async () => {
    try {
      const url = teamIdOverride
        ? `${API}/cr-plans/version/${versionId}?teamId=${teamIdOverride}`
        : `${API}/cr-plans/version/${versionId}`;
      const res = await axios.get(url, { headers });
      const map: Record<string, CrPlanData> = {};
      const forms: Record<string, CrPlanForm> = {};
      for (const p of res.data as CrPlanData[]) {
        map[p.crNumber] = p;
        forms[p.crNumber] = planToForm(p);
      }
      setCrPlans(map);
      // Freshly-fetched server data must win over local state — a separate effect
      // seeds an empty draft form the moment a CR shows up in `proposals`, which can
      // race ahead of this fetch and otherwise clobber an already-submitted plan's
      // real gateAnswered/actions back to a blank gate screen (list still says "done"
      // since that reads from `crPlans`, but the detail panel would show the gate again).
      setCrPlanForms(prev => ({ ...prev, ...forms }));
    } catch { /* silent */ }
  }, [versionId]); // eslint-disable-line

  useEffect(() => {
    axios.get(`${API}/users`, { headers })
      .then(r => setUsers(r.data.filter((u: any) => u.active)
        .sort((a: any, b: any) => a.fullName.localeCompare(b.fullName, 'he'))))
      .catch(() => {});
    axios.get(`${API}/teams`, { headers }).then(r => setTeams(r.data)).catch(() => {});
    axios.get(`${API}/version-cr-assignments/version/${versionId}/cr-scope`, { headers })
      .then(r => {
        const map: Record<string, { teamNames: string[]; systems: string[] }> = {};
        (r.data ?? []).forEach((row: any) => { map[row.crNumber] = { teamNames: row.teamNames, systems: row.systems }; });
        setCrScope(map);
      })
      .catch(() => setCrScope({}));
    // Cross-team status — derived server-side from the caller's own team
    // membership, so it only makes sense for a real team lead, not a manager
    // previewing another team's screen via teamIdOverride.
    if (!teamIdOverride) {
      axios.get(`${API}/cr-plans/version/${versionId}/team-visibility`, { headers })
        .then(r => {
          const map: Record<string, { crLabel: string | null; teams: TeamVisibilityRow[] }> = {};
          (r.data ?? []).forEach((row: any) => { map[row.crNumber] = { crLabel: row.crLabel, teams: row.teams }; });
          setTeamVisibility(map);
        })
        .catch(() => setTeamVisibility({}));
    }
    Promise.all([fetchProposals(), fetchCrPlans().then(() => syncCrItems(true))])
      .finally(() => setLoading(false)); // spinner stays until proposals + CR sync complete
  }, [versionId]); // eslint-disable-line

  // Initialize myTeamId — prefer override (manager viewing another team) over JWT detection
  useEffect(() => {
    if (teamIdOverride && teamNameOverride) {
      setMyTeamId(teamIdOverride);
      setMyTeamName(teamNameOverride);
      return;
    }
    if (myTeamId || !teams.length || !token) return;
    try {
      const { sub: userId } = JSON.parse(atob(token.split('.')[1]));
      const myTeam = teams.find((t: any) =>
        (t.members || []).some((m: any) => m.user?.id === userId)
      );
      if (myTeam) { setMyTeamId(myTeam.id); setMyTeamName(myTeam.name); }
    } catch { /* silent */ }
  }, [teams, token, teamIdOverride, teamNameOverride]); // eslint-disable-line

  // Fetch submission status for this team
  useEffect(() => {
    if (!myTeamId || !versionId) return;
    axios.get(`${API}/versions/${versionId}/submissions`, { headers })
      .then(r => {
        const mine = (r.data as any[]).find(s => s.teamId === myTeamId);
        if (mine?.status === 'SUBMITTED') setSubmissionDone(true);
      })
      .catch(() => {});
  }, [myTeamId, versionId]); // eslint-disable-line

  // Initialize crPlanForm for new CRs not yet saved
  useEffect(() => {
    const grouped = proposals.reduce((acc, p) => {
      if (p.crNumber && !acc[p.crNumber]) acc[p.crNumber] = true;
      return acc;
    }, {} as Record<string, boolean>);
    setCrPlanForms(prev => {
      const next = { ...prev };
      for (const cr of Object.keys(grouped)) {
        if (!next[cr]) next[cr] = emptyCrPlanForm();
      }
      return next;
    });
  }, [proposals]);

  // Auto-select first actionable CR on load (uses proposals+crPlans, not crGroups which is declared later)
  useEffect(() => {
    if (selectedCr) return;
    const allNums = Array.from(new Set([
      ...proposals.filter(p => p.crNumber).map(p => p.crNumber!),
      ...Object.keys(crPlans),
    ])).sort();
    const first = allNums.find(cr => !crPlans[cr]?.notNeededForPlan);
    if (first) setSelectedCr(first);
  }, [proposals, crPlans]); // eslint-disable-line

  // Group proposals: by crNumber or FREE_KEY
  const grouped = proposals.reduce((acc, p) => {
    const key = p.crNumber || FREE_KEY;
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {} as Record<string, Proposal[]>);

  const allCrKeys = new Set([
    ...Object.keys(grouped).filter(k => k !== FREE_KEY),
    ...Object.keys(crPlans),
  ]);
  const crGroups: [string, Proposal[]][] = Array.from(allCrKeys)
    .sort()
    .map(cr => [cr, grouped[cr] || []]);
  const freeGroup = grouped[FREE_KEY] || [];

  // All CR numbers that appear in proposals (for dependency picker)
  const allCrNumbers = crGroups.map(([cr]) => cr);

  const getCrLabel = (crNum: string) => {
    const fromApi = crItems.find(c => c.id === crNum);
    if (fromApi) return fromApi.label;
    const fromProposal = proposals.find(x => x.crNumber === crNum)?.crLabel;
    if (fromProposal) return fromProposal;
    return crPlans[crNum]?.crLabel || '';
  };

  const openAdd = (crNumber?: string, crLabel?: string, isFree?: boolean) => {
    setEditId(null);
    setForm({ ...emptyForm, crNumber: crNumber || '', crLabel: crLabel || '', isFree: isFree ?? false, responsibleTeamId: myTeamId });
    setAllowOtherTeam(false);
    setCrSearch(crNumber || '');
    setError(null);
    setOpenFormForCr(isFree ? FREE_KEY : (crNumber || FREE_KEY));
  };

  const openEdit = (p: Proposal) => {
    setEditId(p.id);
    const responsibleTeamId = (p as any).responsibleTeamId ?? '';
    setForm({
      title: p.title, app: p.app ?? '', actionType: p.actionType ?? '',
      estimatedMins: p.estimatedMins?.toString() ?? '',
      crNumber: p.crNumber ?? '', crLabel: p.crLabel ?? '', isFree: !p.crNumber,
      notes: p.notes ?? '', assignedUserName: p.assignedUserName ?? '', phase: p.phase,
      subPhaseId: '',
      responsibleTeamId,
    });
    // Pre-check the box if this task was already assigned to a team other than
    // ours, so an existing cross-team assignment stays visible instead of
    // being silently forced back to our own team.
    setAllowOtherTeam(!!responsibleTeamId && responsibleTeamId !== myTeamId);
    setCrSearch(p.crNumber || '');
    setError(null);
    setOpenFormForCr(p.crNumber || FREE_KEY);
  };

  const cancelForm = () => { setOpenFormForCr(null); setEditId(null); setCrSearch(''); };

  const save = async () => {
    if (!form.title.trim())        { setError('שם המשימה הוא שדה חובה'); return; }
    if (!form.app)                 { setError('יש לבחור מערכת'); return; }
    if (!form.actionType)          { setError('יש לבחור סוג פעולה'); return; }
    if (!form.assignedUserName)    { setError('יש לבחור עובד אחראי'); return; }
    if (!form.estimatedMins)       { setError('יש להזין משך משוער'); return; }
    if (!form.isFree && !form.crNumber) { setError('יש לבחור CR מקושר, או לסמן "ללא CR"'); return; }
    setSaving(true); setError(null);
    try {
      const crItem = !form.isFree ? crItems.find(c => c.id === form.crNumber) : null;
      const payload = {
        title: form.title.trim(),
        phase: form.phase,
        app: form.app || undefined,
        actionType: form.actionType || undefined,
        subPhaseId: form.subPhaseId || undefined,
        estimatedMins: form.estimatedMins ? parseInt(form.estimatedMins) : undefined,
        crNumber: form.isFree ? undefined : (form.crNumber || undefined),
        crLabel: crItem?.label || form.crLabel || undefined,
        notes: form.notes || undefined,
        assignedUserName: form.assignedUserName || undefined,
        responsibleTeamId: form.responsibleTeamId || myTeamId || undefined,
        ...(teamIdOverride ? { teamIdOverride } : {}),
      };
      if (editId) {
        await axios.patch(`${API}/task-proposals/${editId}`, payload, { headers });
      } else {
        await axios.post(`${API}/task-proposals/version/${versionId}`, payload, { headers });
      }
      cancelForm();
      await fetchProposals();
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'שגיאה בשמירה');
    } finally { setSaving(false); }
  };

  const remove = (p: Proposal) => {
    setDialog({
      title: 'מחיקת צעד',
      message: `האם למחוק את הצעד "${p.title}"?\nפעולה זו בלתי הפיכה.`,
      variant: 'danger',
      confirmLabel: 'מחק',
      cancelLabel: 'ביטול',
      onConfirm: async () => {
        await axios.delete(`${API}/task-proposals/${p.id}`, { headers });
        await fetchProposals();
      },
      onCancel: () => {},
    });
  };

  const toggleStatus = async (p: Proposal) => {
    if (p.status === 'DRAFT') {
      const missing: string[] = [];
      if (!p.title?.trim())        missing.push('תיאור משימה');
      if (!p.app)                  missing.push('מערכת');
      if (!p.actionType)           missing.push('סוג פעולה');
      if (!p.assignedUserName)     missing.push('עובד אחראי');
      if (!p.estimatedMins)        missing.push('משך משוער');
      if (missing.length > 0) {
        setDialog({
          title: 'שדות חובה חסרים',
          message: `לא ניתן לסמן כ"מוכן" — יש להשלים:\n• ${missing.join('\n• ')}\n\nלחץ "ערוך" כדי להשלים את הנתונים.`,
          variant: 'warning',
          confirmLabel: 'ערוך משימה',
          cancelLabel: 'ביטול',
          onConfirm: () => openEdit(p),
          onCancel: () => {},
        });
        return;
      }
    }
    const next = p.status === 'DRAFT' ? 'READY' : 'DRAFT';
    await axios.patch(`${API}/task-proposals/${p.id}`, { status: next }, { headers });
    await fetchProposals();
  };

  const syncCrItems = async (silent = false) => {
    if (!silent) { setSyncLoading(true); setSyncError(null); }
    try {
      const syncUrl = teamIdOverride
        ? `${API}/import/crs-for-team?versionId=${versionId}&teamId=${teamIdOverride}`
        : `${API}/import/crs-for-team?versionId=${versionId}`;
      const res = await axios.get(syncUrl, { headers });
      const crs: { crNumber: string; crLabel: string; application: string; crManager: string; crDescription: string }[] = res.data;
      if (crs.length === 0) {
        if (!silent) setSyncError('לא נמצאו CR-ים עבור הצוות שלך בגרסה זו בקובץ');
        return;
      }
      // Merge into crItems — update existing entries and add new ones
      setCrItems(prev => {
        const existingIds = new Set(prev.map(c => c.id));
        const updated = prev.map(c => {
          const fresh = crs.find(cr => cr.crNumber === c.id);
          return fresh ? { ...c, crManager: fresh.crManager, crDescription: fresh.crDescription } : c;
        });
        const toAdd = crs.filter(c => !existingIds.has(c.crNumber))
          .map(c => ({ id: c.crNumber, label: c.crLabel, crManager: c.crManager, crDescription: c.crDescription }));
        return [...updated, ...toAdd];
      });
      // Create a CrPlan entry for any CR not seen before. syncOnly tells the backend
      // to never touch (or resurrect) a plan the team already explicitly deleted, and
      // to leave gate/actions/dependencies alone on plans that already exist.
      await Promise.all(crs.map(c =>
        axios.post(`${API}/cr-plans/version/${versionId}`, {
          crNumber: c.crNumber,
          crLabel: c.crLabel,
          crManager: c.crManager || undefined,
          crDescription: c.crDescription || undefined,
          syncOnly: true,
          ...(teamIdOverride ? { teamIdOverride } : {}),
        }, { headers }).catch(() => { /* skip if already exists */ })
      ));
      await fetchCrPlans();
    } catch (e: any) {
      if (!silent) setSyncError(e?.response?.data?.message ?? 'שגיאה בסנכרון, נסה שוב');
    }
    finally { if (!silent) setSyncLoading(false); }
  };

  const deleteCrGroup = (crNumber: string) => {
    setDialog({
      title: `מחיקת CR ${crNumber}`,
      message: 'כל הצעדים תחת CR זה יימחקו.\nהפעולה בלתי הפיכה — האם להמשיך?',
      variant: 'danger',
      confirmLabel: 'מחק CR',
      cancelLabel: 'ביטול',
      onConfirm: async () => {
        const teamQuery = teamIdOverride ? `?teamIdOverride=${teamIdOverride}` : '';
        await axios.delete(`${API}/task-proposals/version/${versionId}/cr/${crNumber}${teamQuery}`, { headers });
        const plan = crPlans[crNumber];
        if (plan) await axios.delete(`${API}/cr-plans/${plan.id}`, { headers });
        setCrPlanForms(prev => { const next = { ...prev }; delete next[crNumber]; return next; });
        if (selectedCr === crNumber) setSelectedCr(null);
        await Promise.all([fetchProposals(), fetchCrPlans()]);
      },
      onCancel: () => {},
    });
  };

  const togglePlanExpanded = (crNumber: string) => {
    setExpandedPlans(prev => {
      const next = new Set(prev);
      if (next.has(crNumber)) next.delete(crNumber); else next.add(crNumber);
      return next;
    });
    if (!crPlanForms[crNumber]) {
      setCrPlanForms(prev => ({ ...prev, [crNumber]: emptyCrPlanForm() }));
    }
  };

  const saveCrPlan = async (crNumber: string, overrides?: Partial<CrPlanForm>, notNeededForPlan?: boolean) => {
    const f = { ...(crPlanForms[crNumber] || emptyCrPlanForm()), ...overrides };
    setSavingPlan(crNumber);
    try {
      const label = getCrLabel(crNumber) || crPlans[crNumber]?.crLabel || '';
      const res = await axios.post(`${API}/cr-plans/version/${versionId}`, {
        crNumber,
        crLabel: label || undefined,
        crType: f.crType || undefined,
        riskLevel: f.riskLevel || undefined,
        systems: f.systems.length ? f.systems : undefined,
        workPlan: f.workPlan || undefined,
        scripts: f.scripts || undefined,
        runTimes: f.runTimes || undefined,
        rollbackPlan: f.rollbackPlan || undefined,
        gradualRollout: f.gradualRollout,
        gradualDetails: f.gradualDetails || undefined,
        nightTestingNotes: f.nightTestingNotes || undefined,
        morningMonitoring: f.morningMonitoring || undefined,
        dependsOnCrs: f.dependsOnCrs,
        dependencyNotes: f.dependencyNotes,
        notNeededForPlan: notNeededForPlan !== undefined ? notNeededForPlan : crPlans[crNumber]?.notNeededForPlan,
        gateAnswered: f.gateAnswered,
        changeTypes: f.changeTypes,
        prerequisites: f.prerequisites,
        prerequisitesNote: f.prerequisitesNote || undefined,
        nightTestNeeded: f.nightTestNeeded,
        nextDayTestNeeded: f.nextDayTestNeeded,
        nextDayTestNotes: f.nextDayTestNotes || undefined,
        rollbackType: f.rollbackType || undefined,
        actions: f.actions,
        monitoringPoints: f.monitoringPoints,
        ...(teamIdOverride ? { teamIdOverride } : {}),
      }, { headers });
      setCrPlans(prev => ({ ...prev, [crNumber]: res.data }));
      // Rebuild form state from the server response (not the locally-sent `f`) so
      // ids assigned to newly-created actions/monitoring points flow back into local
      // state — otherwise the next save can't match them by id and would duplicate them.
      setCrPlanForms(prev => ({ ...prev, [crNumber]: planToForm(res.data) }));
      return res.data as CrPlanData;
    } catch { /* silent */ return null; }
    finally { setSavingPlan(null); }
  };

  // Section-1 gate answer: "No" = no special impact (saves + submits immediately,
  // matching the mockup's single-click "אשר וחזור לרשימה"). "Yes" reveals sections 2-7.
  // Submits a saved plan (DRAFT → SUBMITTED) and merges the response into crPlans[crNumber]
  // only — NOT a full fetchCrPlans() refetch, which would race with other CRs being
  // answered/confirmed concurrently and can clobber a just-saved sibling CR with a stale
  // snapshot (e.g. rapid-fire "No" clicks across several CRs).
  const submitCrPlan = async (crNumber: string, planId: string) => {
    try {
      const res = await axios.patch(`${API}/cr-plans/${planId}/submit`, {}, { headers });
      const { derivedTasks, ...plan } = res.data;
      setCrPlans(prev => ({ ...prev, [crNumber]: { ...prev[crNumber], ...plan } }));
      const created = derivedTasks?.created ?? 0;
      const updated = derivedTasks?.updated ?? 0;
      if (created > 0 || updated > 0) {
        const parts: string[] = [];
        if (created > 0) parts.push(`${created} משימות נוצרו`);
        if (updated > 0) parts.push(`${updated} עודכנו`);
        setDerivedTaskNote(prev => ({ ...prev, [crNumber]: `⚡ ${parts.join(' · ')} אוטומטית בלשונית "משימות נגזרות" — יש להשלים משך ביצוע ולסמן "מוכן"` }));
        await fetchProposals();
      }
    } catch { /* silent */ }
  };

  const answerGate = async (crNumber: string, hasImpact: boolean) => {
    const saved = await saveCrPlan(crNumber, { gateAnswered: true }, !hasImpact);
    if (!hasImpact && saved?.id) {
      await submitCrPlan(crNumber, saved.id);
      // A CR marked "no special impact" can't have leftover tasks — e.g. someone
      // added one manually from the "משימות נגזרות" tab before answering the gate.
      const teamQuery = teamIdOverride ? `?teamIdOverride=${teamIdOverride}` : '';
      await axios.delete(`${API}/task-proposals/version/${versionId}/cr/${crNumber}${teamQuery}`, { headers }).catch(() => {});
      await fetchProposals();
    }
  };

  // Section-7 "אשר תוכנית CR" — save the full form, then submit the plan (DRAFT → SUBMITTED).
  // saveCrPlan clears `savingPlan` in its own finally as soon as the save leg finishes,
  // which used to leave the confirm button re-enabled for the whole submit leg — a
  // double-click (or an impatient re-click on a slow network) could fire this whole
  // function twice concurrently. Both overlapping submits then race
  // syncDerivedProposals: each reads the same not-yet-linked CrPlanAction and creates
  // its own TaskProposal, leaving a duplicate derived task behind. Re-asserting
  // savingPlan immediately after saveCrPlan resolves (synchronously, before the next
  // await) closes that window — see backend/src/cr-plans/cr-plans.service.ts
  // syncDerivedProposals/upsertDerivedProposal for the create-vs-update decision.
  const confirmCrPlan = async (crNumber: string) => {
    setSavingPlan(crNumber);
    try {
      const saved = await saveCrPlan(crNumber);
      setSavingPlan(crNumber);
      if (saved?.id) await submitCrPlan(crNumber, saved.id);
    } finally {
      setSavingPlan(null);
      // Re-lock after a re-confirm — editing an already-submitted plan again requires
      // explicitly clicking "פתח לעריכה" again, it doesn't stay open indefinitely.
      setUnlockedForEdit(prev => { const next = new Set(prev); next.delete(crNumber); return next; });
    }
  };

  const toggleNotNeeded = async (crNumber: string) => {
    const current = crPlans[crNumber]?.notNeededForPlan ?? false;
    setTogglingNotNeeded(prev => new Set(prev).add(crNumber));
    try {
      const label = getCrLabel(crNumber) || crPlans[crNumber]?.crLabel || '';
      const res = await axios.post(`${API}/cr-plans/version/${versionId}`, {
        crNumber,
        crLabel: label || undefined,
        notNeededForPlan: !current,
        // Reverting "no special impact" reopens the gate so the team can re-answer.
        gateAnswered: current ? false : true,
        ...(teamIdOverride ? { teamIdOverride } : {}),
      }, { headers });
      setCrPlans(prev => ({ ...prev, [crNumber]: { ...(prev[crNumber] || res.data), ...res.data } }));
      setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...(prev[crNumber] || emptyCrPlanForm()), gateAnswered: !current ? true : false } }));
      // A CR marked "no special impact" can't have leftover tasks tied to it —
      // clean up anything that was manually added before this flip.
      if (!current) {
        const teamQuery = teamIdOverride ? `?teamIdOverride=${teamIdOverride}` : '';
        await axios.delete(`${API}/task-proposals/version/${versionId}/cr/${crNumber}${teamQuery}`, { headers }).catch(() => {});
        await fetchProposals();
      }
    } catch { /* silent */ }
    finally { setTogglingNotNeeded(prev => { const next = new Set(prev); next.delete(crNumber); return next; }); }
  };

  // A CR is "done" once its plan is either flagged not-needed (gate answered "No")
  // or has been confirmed/submitted (Section 7, or CR-manager already approved it).
  const isCrDone = (cr: string) => {
    const p = crPlans[cr];
    return !!p && (p.notNeededForPlan || p.submissionStatus === 'SUBMITTED' || p.submissionStatus === 'APPROVED');
  };

  const submitDone = async () => {
    if (!myTeamId) return;

    const pendingCrs = crGroups.filter(([cr]) => !isCrDone(cr)).map(([cr]) => cr);
    if (pendingCrs.length > 0) {
      setSubmitError(`לא ניתן להגיש — יש CR-ים שטרם טופלו: ${pendingCrs.length}. לחץ על CR ברשימה למטה כדי להשלים אותו.`);
      setSubmitErrorCrs(pendingCrs);
      // Lead the team lead straight to the first unfinished CR instead of making
      // them hunt for it in the sidebar list.
      setSelectedCr(pendingCrs[0]);
      setSelectedTab('plan');
      return;
    }

    setSubmitting(true); setSubmitError(null); setSubmitErrorCrs([]);
    try {
      await axios.post(`${API}/versions/${versionId}/submit/${myTeamId}`, {}, { headers });
      setSubmissionDone(true);
    } catch (e: any) {
      setSubmitError(e.response?.data?.message ?? 'שגיאה בהגשה');
    } finally { setSubmitting(false); }
  };

  const totalReady = proposals.filter(p => p.status === 'READY').length;
  const doneCrCount = crGroups.filter(([cr]) => isCrDone(cr)).length;
  const canSubmit = crGroups.length > 0 && doneCrCount === crGroups.length;

  // Filter users to team members only
  const teamUsers = useMemo(() => {
    if (!myTeamId || !teams.length) return users;
    const myTeam = teams.find((t: any) => t.id === myTeamId);
    if (!myTeam?.members?.length) return users;
    const memberIds = new Set((myTeam.members as any[]).map((m: any) => m.user.id));
    const filtered = users.filter(u => memberIds.has(u.id));
    return filtered.length > 0 ? filtered : users;
  }, [myTeamId, teams, users]);

  // Allowed responsible teams based on phase:
  // Phase 1: only own team
  // Phase 2/3 (HOTNET/HOT, night testing): own team + QA/testing teams
  // Phase 4 (morning after): own team + QA + operations teams
  const allowedTeams = useMemo(() => {
    const myTeam = teams.find((t: any) => t.id === myTeamId);
    if (!myTeam) return teams.filter((t: any) => t.active);
    const base: any[] = [myTeam];
    const addUnique = (t: any) => { if (!base.find(b => b.id === t.id)) base.push(t); };
    if (form.phase === 2 || form.phase === 3 || form.phase === 4) {
      teams.filter((t: any) => t.active && (
        t.name.toLowerCase().includes('qa') || t.name.includes('בדיקות')
      )).forEach(addUnique);
    }
    if (form.phase === 4) {
      teams.filter((t: any) => t.active && t.name.includes('תפעול')).forEach(addUnique);
    }
    return base;
  }, [form.phase, myTeamId, teams]);

  // Users of the selected responsible team
  const responsibleTeamUsers = useMemo(() => {
    const respId = form.responsibleTeamId || myTeamId;
    if (!respId) return teamUsers;
    const respTeam = teams.find((t: any) => t.id === respId);
    if (!respTeam?.members?.length) return teamUsers;
    const members = (respTeam.members as any[]).map((m: any) => m.user).filter(Boolean);
    return members.length > 0 ? members : teamUsers;
  }, [form.responsibleTeamId, myTeamId, teams, teamUsers]);

  // Members of the team submitting the proposal (used for the bulk "הפק משימות" extract modal —
  // independent of the single-add form's responsibleTeamId, which shouldn't leak in here).
  const myTeamMembers = useMemo(() => {
    const myTeam = teams.find((t: any) => t.id === myTeamId);
    const members = (myTeam?.members as any[] | undefined)?.map((m: any) => m.user).filter(Boolean);
    return members && members.length > 0 ? members : teamUsers;
  }, [myTeamId, teams, teamUsers]);

  // Apps for this team — DB first, then static map, then all. Always ends with "אחר".
  const teamAppList = useMemo(() => {
    const withOther = (list: string[]) =>
      list.includes('אחר') ? list : [...list, 'אחר'];
    const myTeam = teams.find((t: any) => t.id === myTeamId);
    if (myTeam?.apps?.length) return withOther(myTeam.apps as string[]);
    const staticApps = TEAM_APPS[myTeamName];
    if (staticApps) return withOther(staticApps);
    return APPS; // all apps (includes 'אחר')
  }, [myTeamId, myTeamName, teams]);


  // ── Form modal ─────────────────────────────────────────────────────────────
  const renderForm = () => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: C.bgOverlay, direction: 'rtl' }}
      onClick={e => { if (e.target === e.currentTarget) cancelForm(); }}>
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: '760px', maxWidth: '94vw', maxHeight: '84vh',
        background: C.bgCard, display: 'flex', flexDirection: 'column',
        borderRadius: '16px', overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
      }}>
        {/* Panel header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <button onClick={cancelForm} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '20px', lineHeight: 1, padding: '2px 6px' }}>✕</button>
          <span style={{ fontSize: '16px', fontWeight: '700', color: C.textPrimary }}>{editId ? 'עריכת משימה' : 'פרטי משימה'}</span>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* שם משימה */}
          <div>
            <label style={labelStyle}>שם משימה <span style={{ color: C.danger }}>*</span></label>
            <input
              autoFocus
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              style={{ ...inputStyle, borderColor: !form.title.trim() ? C.danger : C.border, fontSize: '15px', padding: '10px 12px' }}
              placeholder="תאר את הצעד שיש לבצע..."
            />
          </div>

          {/* CR מקושר */}
          <div>
            <label style={labelStyle}>פיתוחים בגרסה (CR)</label>
            {form.isFree ? (
              <div style={{ padding: '10px 12px', background: C.bgNested, borderRadius: RADIUS.md, fontSize: '15px', color: C.textSecondary, border: `1px solid ${C.border}` }}>
                ללא CR — משימה תשתיתית / כללית
              </div>
            ) : form.crNumber && form.crLabel ? (
              <div style={{ padding: '10px 12px', background: C.infoBg, border: `1px solid ${C.info}40`, borderRadius: RADIUS.md, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ background: C.textPrimary, color: C.textInverse, padding: '2px 8px', borderRadius: RADIUS.sm, fontSize: '14px', fontWeight: '700', fontFamily: 'monospace', flexShrink: 0 }}>
                  {form.crNumber}
                </span>
                <span style={{ fontSize: '15px', color: C.info, fontWeight: '600' }}>{form.crLabel.replace(`${form.crNumber} - `, '')}</span>
              </div>
            ) : (
              <>
                <input
                  value={crSearch}
                  onChange={e => {
                    const val = e.target.value;
                    setCrSearch(val);
                    const match = crItems.find(c => c.id === val);
                    if (match) setForm(f => ({ ...f, crNumber: match.id, crLabel: match.label }));
                    else setForm(f => ({ ...f, crNumber: val, crLabel: '' }));
                  }}
                  list="tl-cr-datalist"
                  placeholder="הקלד CR# (Enter לחץ ‏↵ להקש)"
                  style={{ ...inputStyle, padding: '10px 12px' }}
                />
                <datalist id="tl-cr-datalist">
                  {crItems.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </datalist>
                {form.crLabel && (
                  <div style={{ fontSize: '14px', color: C.success, marginTop: '4px' }}>✓ {form.crLabel}</div>
                )}
              </>
            )}
          </div>

          {/* שלב | תת-שלב */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>שלב <span style={{ color: C.danger }}>*</span></label>
              <select value={form.phase} onChange={e => setForm(f => ({ ...f, phase: parseInt(e.target.value), subPhaseId: '', responsibleTeamId: myTeamId, assignedUserName: '' }))} style={{ ...inputStyle, padding: '10px 12px' }}>
                {(Object.keys(phaseLabels).length > 0
                  ? Object.keys(phaseLabels).map(Number).sort((a, b) => a - b)
                  : [1, 2, 3, 4]
                ).map(ph => <option key={ph} value={ph}>{phaseLabels[ph] || PHASE_LABELS[ph] || `שלב ${ph}`}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>תת-שלב</label>
              {subPhaseOpts.filter(sp => sp.phaseOrderIndex === form.phase).length > 0 ? (
                <select value={form.subPhaseId} onChange={e => setForm(f => ({ ...f, subPhaseId: e.target.value }))}
                  style={{ ...inputStyle, padding: '10px 12px', background: form.subPhaseId ? C.infoBg : undefined }}>
                  <option value="">-- בחר --</option>
                  {subPhaseOpts.filter(sp => sp.phaseOrderIndex === form.phase).map(sp => (
                    <option key={sp.id} value={sp.id}>{sp.name}</option>
                  ))}
                </select>
              ) : (
                <div style={{ padding: '10px 12px', background: C.bgNested, borderRadius: RADIUS.md, fontSize: '14px', color: C.textMuted, border: `1px solid ${C.border}` }}>אין תת-שלבים</div>
              )}
            </div>
          </div>

          {/* סוג פעולה | מערכת */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>סוג פעולה <span style={{ color: C.danger }}>*</span></label>
              <select value={form.actionType} onChange={e => {
                const val = e.target.value;
                const currentTitle = form.title.trim();
                const titleIsAutoFilled = currentTitle === form.actionType;
                if (!currentTitle || titleIsAutoFilled) {
                  setForm(f => ({ ...f, actionType: val, title: val }));
                } else {
                  setForm(f => ({ ...f, actionType: val }));
                  setDialog({
                    title: 'עדכון תיאור המשימה',
                    message: `האם לעדכן גם את תיאור המשימה ל-"${val}"?\n\nתיאור נוכחי: "${currentTitle}"`,
                    variant: 'warning', confirmLabel: 'עדכן תיאור', cancelLabel: 'שמור תיאור קיים',
                    onConfirm: () => setForm(f => ({ ...f, title: val })),
                    onCancel: () => {},
                  });
                }
              }} style={{ ...inputStyle, padding: '10px 12px', borderColor: !form.actionType ? C.danger : C.border }}>
                <option value="">-- בחר --</option>
                {ACTION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>אפליקציה <span style={{ color: C.danger }}>*</span></label>
              <select value={form.app} onChange={e => setForm(f => ({ ...f, app: e.target.value }))}
                style={{ ...inputStyle, padding: '10px 12px', borderColor: !form.app ? C.danger : C.border }}>
                <option value="">-- בחר --</option>
                {teamAppList.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          {/* צוות אחראי | אחראי */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>צוות אחראי</label>
              <select
                value={allowOtherTeam ? (form.responsibleTeamId || myTeamId) : myTeamId}
                disabled={!allowOtherTeam}
                onChange={e => setForm(f => ({ ...f, responsibleTeamId: e.target.value, assignedUserName: '' }))}
                style={{ ...inputStyle, padding: '10px 12px', ...(!allowOtherTeam ? { background: C.bgNested, color: C.textMuted, cursor: 'not-allowed' } : {}) }}
              >
                {(allowOtherTeam ? allowedTeams : allowedTeams.filter((t: any) => t.id === myTeamId))
                  .map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '6px' }}>
                <input type="checkbox" id="allow-other-team" checked={allowOtherTeam}
                  onChange={e => {
                    const checked = e.target.checked;
                    setAllowOtherTeam(checked);
                    if (!checked) setForm(f => ({ ...f, responsibleTeamId: myTeamId, assignedUserName: '' }));
                  }}
                  style={{ width: '14px', height: '14px', cursor: 'pointer' }} />
                <label htmlFor="allow-other-team" style={{ fontSize: '13px', color: C.textSecondary, cursor: 'pointer' }}>
                  אפשר לבחור צוות אחר
                </label>
              </div>
              {allowOtherTeam && (form.phase === 2 || form.phase === 3) && (
                <div style={{ fontSize: '13px', color: C.textMuted, marginTop: '3px' }}>
                  ניתן לשייך לצוות QA לביצוע בדיקות
                </div>
              )}
              {allowOtherTeam && form.phase === 4 && (
                <div style={{ fontSize: '13px', color: C.textMuted, marginTop: '3px' }}>
                  ניתן לשייך לצוות QA / תפעול לבקרות בוקר
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle}>אחראי <span style={{ color: C.danger }}>*</span></label>
              <select value={form.assignedUserName} onChange={e => setForm(f => ({ ...f, assignedUserName: e.target.value }))}
                style={{ ...inputStyle, padding: '10px 12px', borderColor: !form.assignedUserName ? C.danger : C.border }}>
                <option value="">-- בחר --</option>
                {responsibleTeamUsers.map((u: any) => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
              </select>
            </div>
          </div>

          {/* משך */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>משך (דק') <span style={{ color: C.danger }}>*</span></label>
              <input type="number" min={1} value={form.estimatedMins}
                onChange={e => setForm(f => ({ ...f, estimatedMins: e.target.value }))}
                style={{ ...inputStyle, padding: '10px 12px', borderColor: !form.estimatedMins ? C.danger : C.border }}
                placeholder="10" />
            </div>
          </div>

          {/* הערות */}
          <div>
            <label style={labelStyle}>הערות כלליות</label>
            <textarea value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              style={{ ...inputStyle, height: '72px', resize: 'vertical', padding: '10px 12px' }}
              placeholder="פרמטרים, הוראות מיוחדות, תלויות..." />
          </div>

          {error && <div style={{ color: C.danger, fontSize: '15px', background: C.dangerBg, padding: '8px 12px', borderRadius: RADIUS.md }}>{error}</div>}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: '10px', justifyContent: 'flex-start', flexShrink: 0, background: C.bgCard }}>
          <button onClick={save} disabled={saving}
            style={{ padding: '9px 24px', background: saving ? C.textDisabled : C.brand, color: C.textInverse, border: 'none', borderRadius: RADIUS.lg, cursor: saving ? 'not-allowed' : 'pointer', fontWeight: '700', fontSize: '15px' }}>
            {saving ? 'שומר...' : editId ? 'שמור שינויים' : 'הוסף משימה'}
          </button>
          <button onClick={cancelForm}
            style={{ padding: '9px 20px', background: C.bgCard, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, cursor: 'pointer', fontSize: '15px', fontWeight: '600' }}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );

  // ── Proposal row ────────────────────────────────────────────────────────────
  const renderRow = (p: Proposal) => (
    <div key={p.id} style={{
      borderRadius: RADIUS.lg, marginBottom: '6px',
      background: p.usedInTaskId ? C.successBg : C.bgNested,
      border: `1px solid ${p.usedInTaskId ? C.success + '50' : C.border}`,
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px' }}>
        <span style={{
          background: PHASE_BADGE[p.phase]?.bg, color: PHASE_BADGE[p.phase]?.color,
          padding: '2px 10px', borderRadius: RADIUS.full, fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {(phaseLabels[p.phase] || PHASE_LABELS[p.phase])?.split(' — ')[1] || `שלב ${p.phase}`}
        </span>
        <span style={{ flex: 1, fontSize: '15px', fontWeight: '600', color: C.textPrimary }}>{p.title}</span>
        {p.usedInTaskId ? (
          <span style={{ fontSize: '13px', color: C.success, fontWeight: '700', whiteSpace: 'nowrap', flexShrink: 0 }}>✅ בתוכנית</span>
        ) : locked ? (
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0, alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: p.status === 'READY' ? C.success : C.warning, fontWeight: '700', whiteSpace: 'nowrap' }}>
              {p.status === 'READY' ? '✓ מוכן' : 'טיוטא'}
            </span>
            <button onClick={() => openEdit(p)}
              style={{ padding: '2px 8px', background: C.warningBg, color: C.warning, border: `1px solid ${C.warning}50`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
              ערוך
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            <button onClick={() => toggleStatus(p)} style={{
              padding: '2px 10px', border: 'none', borderRadius: RADIUS.full, cursor: 'pointer',
              fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap',
              background: p.status === 'READY' ? C.success : C.warning, color: C.textInverse,
            }}>
              {p.status === 'READY' ? '✓ מוכן' : 'טיוטא'}
            </button>
            <button onClick={() => openEdit(p)}
              style={{ padding: '2px 8px', background: C.warningBg, color: C.warning, border: `1px solid ${C.warning}50`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
              ערוך
            </button>
            <button onClick={() => remove(p)}
              style={{ padding: '2px 8px', background: C.dangerBg, color: C.danger, border: `1px solid ${C.danger}50`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
              מחק
            </button>
          </div>
        )}
      </div>
      <div style={{
        display: 'flex', gap: '16px', flexWrap: 'wrap',
        padding: '5px 12px 8px', borderTop: `1px solid ${C.border}`,
        background: p.usedInTaskId ? C.successBg : C.bgCard, fontSize: '14px', color: C.textSecondary,
      }}>
        <span><span style={{ color: C.textMuted }}>מערכת: </span>{p.app || <span style={{ color: C.textDisabled }}>לא הוזן</span>}</span>
        {p.actionType && <span style={{ background: C.infoBg, color: C.info, padding: '1px 7px', borderRadius: RADIUS.sm, fontSize: '13px', fontWeight: '600' }}>{p.actionType}</span>}
        <span><span style={{ color: C.textMuted }}>משך: </span>{p.estimatedMins ? `${p.estimatedMins} דק'` : <span style={{ color: C.textDisabled }}>לא הוזן</span>}</span>
        <span><span style={{ color: C.textMuted }}>עובד אחראי: </span>{p.assignedUserName || <span style={{ color: C.textDisabled }}>לא הוזן</span>}</span>
        {p.notes && <span style={{ color: C.textSecondary, fontStyle: 'italic' }}>📝 {cleanHtmlText(p.notes)}</span>}
      </div>
    </div>
  );

  // ── CrPlan form content ──────────────────────────────────────────────────────
  // ── Section-1 gate — "האם קיימת השפעה תפעולית מיוחדת ל-CR זה?" ──────────────
  const renderGate = (crNumber: string) => (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.xl, padding: '28px 26px', textAlign: 'center', boxShadow: SHADOW.sm, maxWidth: '620px', margin: '0 auto' }}>
      <div style={{ fontSize: '17px', fontWeight: '800', marginBottom: '20px', lineHeight: 1.4, color: C.textPrimary }}>
        האם קיימת השפעה תפעולית מיוחדת ל-CR זה?
      </div>
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
        <button onClick={() => answerGate(crNumber, false)}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'none'; }}
          style={{
            flex: 1, maxWidth: '220px', padding: '18px', borderRadius: RADIUS.lg, fontSize: '14px',
            fontWeight: '700', cursor: 'pointer', fontFamily: FONT, transition: 'transform .12s',
            border: '2px solid rgba(22,163,74,.25)', background: C.successBg, color: C.success,
          }}>
          לא — הטמעה רגילה
        </button>
        <button onClick={() => answerGate(crNumber, true)}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'none'; }}
          style={{
            flex: 1, maxWidth: '220px', padding: '18px', borderRadius: RADIUS.lg, fontSize: '14px',
            fontWeight: '700', cursor: 'pointer', fontFamily: FONT, transition: 'transform .12s',
            border: '2px solid rgba(217,119,6,.3)', background: C.warningBg, color: C.warning,
          }}>
          כן — יש פרטים למלא
        </button>
      </div>
    </div>
  );

  // ── Sections 2–7 — accordion form shown once the gate answer is "כן" ────────
  const renderCrPlanForm = (crNumber: string) => {
    const f        = crPlanForms[crNumber] || emptyCrPlanForm();
    const otherCrs = allCrNumbers.filter(c => c !== crNumber);
    const plan     = crPlans[crNumber];
    const submitted = plan?.submissionStatus === 'SUBMITTED' || plan?.submissionStatus === 'APPROVED';
    const lockedForEdit = submitted && !unlockedForEdit.has(crNumber);

    const update = (patch: Partial<CrPlanForm>) =>
      setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...(prev[crNumber] || emptyCrPlanForm()), ...patch } }));

    const toggleChip = (list: string[], item: string, key: 'changeTypes' | 'prerequisites') => {
      const next = list.includes(item) ? list.filter(x => x !== item) : [...list, item];
      update({ [key]: next } as any);
    };

    const autoGrow = (e: React.FormEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };

    const phaseOptions = Object.keys(phaseLabels).length > 0 ? Object.keys(phaseLabels).map(Number).sort((a, b) => a - b) : [1, 2, 3, 4];
    // Exceptional actions most commonly happen release night — default to the 2nd
    // real phase (HOTNET/night) when available, matching the CR-12996 example in the spec.
    const defaultPhase = phaseOptions[Math.min(1, phaseOptions.length - 1)];
    const addAction = (phaseOverride?: number) => update({ actions: [...f.actions, { actionType: ACTION_TYPE_OPTIONS[0], description: '', phase: phaseOverride ?? defaultPhase, subPhaseId: '', dependencyNote: '', ownerName: '' }] });
    const updateAction = (idx: number, patch: Partial<CrPlanAction>) =>
      update({ actions: f.actions.map((a, i) => i === idx ? { ...a, ...patch } : a) });
    const removeAction = (idx: number) => {
      update({ actions: f.actions.filter((_, i) => i !== idx) });
      setDepPicker(null);
    };

    const addMonitoring = () => update({ monitoringPoints: [...f.monitoringPoints, { type: MONITORING_TYPES[0], name: '', note: '', phase: phaseOptions[phaseOptions.length - 1] }] });
    const updateMonitoring = (idx: number, patch: Partial<CrPlanMonitoringPoint>) =>
      update({ monitoringPoints: f.monitoringPoints.map((m, i) => i === idx ? { ...m, ...patch } : m) });
    const removeMonitoring = (idx: number) => update({ monitoringPoints: f.monitoringPoints.filter((_, i) => i !== idx) });

    // "תמיד כדאי להציג לראש הצוות את הצוותים והמערכות המעורבים" — pulled from the
    // real cross-team CR assignment scope (cr-scope endpoint), not just whatever
    // systems this lead happened to tag on their own exceptional actions, so the
    // team lead sees every other team + system actually touching this CR.
    const scope = crScope[crNumber];
    const myTeamLabel = teamNameOverride || myTeamName;
    const involvedTeams = (scope?.teamNames ?? []).filter(t => t !== myTeamLabel);
    const involvedSystems = scope?.systems ?? [];

    const depTaskTitle = (taskId: string) => frameworkTasks.find(t => t.id === taskId)?.title;
    const toggleDepPhase = (ph: number) => setDepPicker(prev => {
      if (!prev) return prev;
      const next = new Set(prev.openPhases);
      if (next.has(ph)) next.delete(ph); else next.add(ph);
      return { ...prev, openPhases: next };
    });

    const secHdr: React.CSSProperties = {
      padding: '10px 16px', background: C.bgNested, borderBottom: `1px solid ${C.border}`, fontSize: '12.5px', fontWeight: '700',
      color: C.textSecondary, display: 'flex', alignItems: 'center', gap: '8px',
    };
    const secNum = (n: number): React.CSSProperties => ({
      width: '20px', height: '20px', borderRadius: '50%', background: GOLIVE, color: '#fff',
      fontSize: '10px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    });
    const sec: React.CSSProperties = {
      background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, marginBottom: '10px', overflow: 'hidden',
    };
    const secBody: React.CSSProperties = { padding: '14px 16px' };
    const chip = (selected: boolean): React.CSSProperties => ({
      fontSize: '11px', fontWeight: '600', padding: '4px 11px', borderRadius: RADIUS.full, cursor: 'pointer',
      border: `1px solid ${selected ? GOLIVE : C.borderEm}`,
      background: selected ? `${GOLIVE}24` : C.bgCard,
      color: selected ? GOLIVE : C.textSecondary,
    });
    const miniSel: React.CSSProperties = { fontFamily: FONT, fontSize: '12px', padding: '6px 10px', borderRadius: RADIUS.sm, border: `1px solid ${C.borderEm}`, background: C.bgCard, color: C.textPrimary };
    const miniTa: React.CSSProperties = { width: '100%', fontFamily: FONT, fontSize: '13px', padding: '8px 10px', borderRadius: RADIUS.sm, border: `1px solid ${C.borderEm}`, background: C.bgCard, color: C.textPrimary, resize: 'none', minHeight: '42px', boxSizing: 'border-box', overflow: 'hidden' };

    return (
      <div>
        {plan?.submissionStatus === 'RETURNED' && plan.returnReason && (
          <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}40`, borderRadius: RADIUS.md, padding: '10px 14px', fontSize: '13px', color: C.danger, marginBottom: '12px' }}>
            ⚠ התוכנית הוחזרה לתיקון: {plan.returnReason}
          </div>
        )}

        {(involvedSystems.length > 0 || involvedTeams.length > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '8px 14px', marginBottom: '12px', fontSize: '12px' }}>
            {involvedSystems.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: C.textMuted, fontWeight: WEIGHT.semibold }}>מערכות מעורבות:</span>
                <span style={{ color: C.textSecondary }}>{involvedSystems.join(', ')}</span>
              </div>
            )}
            {involvedTeams.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: C.textMuted, fontWeight: WEIGHT.semibold }}>צוותים נוספים מעורבים:</span>
                <span style={{ color: C.textSecondary }}>{involvedTeams.join(', ')}</span>
              </div>
            )}
          </div>
        )}

        {lockedForEdit && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: C.successBg, border: '1px solid rgba(22,163,74,.3)', borderRadius: RADIUS.md, padding: '10px 14px', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', color: '#0F5A2A', flex: 1 }}>✓ התוכנית הוגשה ונעולה לעריכה.</span>
            <button onClick={() => setUnlockedForEdit(prev => new Set(prev).add(crNumber))}
              style={{ fontSize: '13px', fontWeight: WEIGHT.bold, padding: '6px 14px', borderRadius: RADIUS.md, background: C.bgCard, color: C.success, border: `1px solid ${C.success}60`, cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}>
              ✏️ פתח לעריכה
            </button>
          </div>
        )}

        <div style={{ pointerEvents: lockedForEdit ? 'none' : undefined, opacity: lockedForEdit ? 0.6 : 1 }}>
        {/* Section 1 — מה משתנה */}
        <div style={sec}>
          <div style={secHdr}><span style={secNum(1)}>1</span>מה משתנה</div>
          <div style={secBody}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {CHANGE_TYPES.map(ct => (
                <span key={ct} style={chip(f.changeTypes.includes(ct))} onClick={() => toggleChip(f.changeTypes, ct, 'changeTypes')}>{ct}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Section 2 — פעולות מיוחדות */}
        <div style={sec}>
          <div style={secHdr}><span style={secNum(2)}>2</span>פעולות מיוחדות</div>
          <div style={secBody}>
            {/* Summary bar — quick counts across the whole timeline */}
            <div style={{ display: 'flex', background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, boxShadow: SHADOW.xs, marginBottom: '16px', overflow: 'hidden' }}>
              {[
                { num: new Set(f.actions.map(a => `${a.phase}-${a.actionType}`)).size, lbl: 'Activity Containers' },
                { num: f.actions.length, lbl: 'משימות' },
                { num: f.monitoringPoints.length, lbl: 'נקודות בקרה' },
                { num: f.rollbackType ? 0 : 1, lbl: 'Rollback חסר', warn: !f.rollbackType },
              ].map((cell, i) => (
                <div key={i} style={{ flex: 1, padding: '12px 16px', textAlign: 'center', borderLeft: i < 3 ? `1px solid ${C.border}` : 'none' }}>
                  <div style={{ fontSize: '20px', fontWeight: '800', color: cell.warn ? C.warning : C.textPrimary }}>{cell.num}</div>
                  <div style={{ fontSize: '10.5px', color: C.textMuted, marginTop: '2px' }}>{cell.lbl}</div>
                </div>
              ))}
            </div>

            {/* Timeline Planning — grouped by day-part (real phase field) then by
                action type ("Activity Container"). Visual grouping only: the
                per-task edit card below is byte-for-byte the same form as before,
                just organized under container headers instead of a flat list. */}
            {PHASE_BUCKETS.map(bucket => {
              const bucketItems = f.actions.map((a, idx) => ({ a, idx })).filter(({ a }) => a.phase === bucket.phase);
              const byType = new Map<string, { a: CrPlanAction; idx: number }[]>();
              for (const item of bucketItems) {
                const key = item.a.actionType || 'אחר';
                if (!byType.has(key)) byType.set(key, []);
                byType.get(key)!.push(item);
              }
              return (
                <div key={bucket.phase} style={{ marginBottom: '18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: GOLIVE, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800', flexShrink: 0 }}>
                      {bucket.letter}
                    </div>
                    <div>
                      <div style={{ fontSize: '12.5px', fontWeight: '800', color: C.textPrimary }}>{bucket.title}</div>
                      <div style={{ fontSize: '10.5px', color: C.textMuted }}>{bucket.meta}</div>
                    </div>
                  </div>

                  {byType.size === 0 ? (
                    <div style={{ fontSize: '11.5px', color: C.textDisabled, padding: '2px 2px 10px' }}>אין פעולות עדיין בשלב זה</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
                      {Array.from(byType.entries()).map(([actionType, items]) => {
                        const containerKey = `${bucket.phase}-${actionType}`;
                        const collapsed = collapsedContainers.has(containerKey);
                        const iconMeta = ACTION_TYPE_ICON[actionType] ?? ACTION_TYPE_ICON['אחר'];
                        return (
                          <div key={containerKey} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, boxShadow: SHADOW.xs, overflow: 'hidden' }}>
                            <div
                              onClick={() => setCollapsedContainers(prev => {
                                const next = new Set(prev);
                                if (next.has(containerKey)) next.delete(containerKey); else next.add(containerKey);
                                return next;
                              })}
                              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', cursor: 'pointer' }}>
                              <span style={{ width: '26px', height: '26px', borderRadius: RADIUS.sm, background: iconMeta.bg, color: iconMeta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', flexShrink: 0 }}>{iconMeta.icon}</span>
                              <span style={{ fontSize: '12.5px', fontWeight: '700', color: C.textPrimary, flex: 1 }}>{actionType}</span>
                              <span style={{ fontSize: '10.5px', fontWeight: '700', color: C.textMuted, background: C.bgNested, padding: '2px 9px', borderRadius: RADIUS.full }}>{items.length} משימות</span>
                              <span style={{ color: C.textDisabled, fontSize: '11px' }}>{collapsed ? '◂' : '▾'}</span>
                            </div>
                            {!collapsed && (
                              <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 14px' }}>
                                {items.map(({ a, idx }) => (
              <div key={idx} style={{ background: C.bgNested, borderRadius: RADIUS.md, padding: '12px 14px', marginBottom: '10px' }}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <select value={a.actionType} onChange={e => updateAction(idx, { actionType: e.target.value })} style={miniSel}>
                    {ACTION_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => removeAction(idx)} style={{ background: 'none', border: 'none', color: C.danger, cursor: 'pointer', fontSize: '13px' }}>הסר</button>
                </div>
                <textarea value={a.description} onInput={autoGrow} onChange={e => updateAction(idx, { description: e.target.value })}
                  style={{ ...miniTa, marginBottom: '8px' }} placeholder="תאר את הפעולה שיש לבצע..." />
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  {phaseOptions.map(ph => {
                    const fullLabel = phaseLabels[ph] || PHASE_LABELS[ph] || `שלב ${ph}`;
                    const shortLabel = fullLabel.split(' — ')[1] || fullLabel;
                    const sel = a.phase === ph;
                    return (
                      <span key={ph} title={fullLabel}
                        onClick={() => updateAction(idx, { phase: ph, subPhaseId: '' })}
                        style={{
                          fontSize: '11px', fontWeight: WEIGHT.bold, padding: '3px 10px', borderRadius: RADIUS.full, cursor: 'pointer',
                          background: sel ? GOLIVE : C.bgCard,
                          border: `1px solid ${sel ? GOLIVE : C.borderEm}`,
                          color: sel ? '#fff' : C.textMuted,
                        }}>
                        {shortLabel}
                      </span>
                    );
                  })}
                </div>
                {subPhaseOpts.filter(sp => sp.phaseOrderIndex === a.phase).length > 0 && (
                  <select value={a.subPhaseId || ''} onChange={e => updateAction(idx, { subPhaseId: e.target.value })}
                    style={{ ...miniSel, width: '100%', boxSizing: 'border-box', marginBottom: '8px' }}>
                    <option value="">תת-שלב מדוייק — לא נבחר (ישובץ בתחילת השלב)</option>
                    {subPhaseOpts.filter(sp => sp.phaseOrderIndex === a.phase).map(sp => (
                      <option key={sp.id} value={sp.id}>{sp.name}</option>
                    ))}
                  </select>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  <select value={a.system || ''} onChange={e => updateAction(idx, { system: e.target.value || undefined })} style={miniSel}>
                    <option value="">מערכת — ללא</option>
                    {teamAppList.map((app: string) => <option key={app} value={app}>{app}</option>)}
                  </select>
                  <input type="number" min={1} value={a.estimatedMins ?? ''} onChange={e => updateAction(idx, { estimatedMins: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="משך זמן משוער (דק')" style={{ ...miniSel, width: '100%', boxSizing: 'border-box' }} />
                  <select value={a.ownerName || ''} onChange={e => updateAction(idx, { ownerName: e.target.value })} style={miniSel}>
                    <option value="">אחראי — ללא</option>
                    {teamUsers.map((u: any) => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
                  </select>
                </div>

                {/* תלות לוגית — בורר מתקפל שלב ← תת-שלב ← משימה. תלות = "חייבת להסתיים קודם". */}
                <div style={{ marginBottom: '6px' }}>
                  <div onClick={() => setDepPicker(p => p?.actionIdx === idx ? null : { actionIdx: idx, openPhases: new Set() })}
                    style={{ ...miniSel, width: '100%', boxSizing: 'border-box', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: a.dependsOnTaskId ? C.textPrimary : C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.dependsOnTaskId ? `תלות: ${depTaskTitle(a.dependsOnTaskId) || '—'}` : 'תלות לוגית — לחץ לבחירת משימה מהתוכנית'}
                    </span>
                    <span style={{ flexShrink: 0, color: C.textMuted, marginRight: '6px' }}>{depPicker?.actionIdx === idx ? '▴' : '▾'}</span>
                  </div>
                  {depPicker?.actionIdx === idx && (
                    <div style={{ border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.sm, marginTop: '4px', maxHeight: '220px', overflowY: 'auto', background: C.bgCard }}>
                      <div onClick={() => { updateAction(idx, { dependsOnTaskId: undefined }); setDepPicker(null); }}
                        style={{ padding: '7px 10px', fontSize: '12px', color: C.textMuted, cursor: 'pointer', borderBottom: `1px solid ${C.bgNested}` }}>
                        ✕ ללא תלות במשימה קיימת
                      </div>
                      {frameworkTasksByPhase.map(([phaseOrderIndex, { phaseLabel, bySubPhase }]) => {
                        const isOpen = depPicker.openPhases.has(phaseOrderIndex);
                        const taskCount = Array.from(bySubPhase.values()).reduce((n, s) => n + s.tasks.length, 0);
                        return (
                          <div key={phaseOrderIndex}>
                            <div onClick={() => toggleDepPhase(phaseOrderIndex)} style={{ padding: '7px 10px', fontSize: '12px', fontWeight: WEIGHT.semibold, color: C.textSecondary, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', background: C.bgNested }}>
                              <span>{phaseLabel} ({taskCount})</span>
                              <span>{isOpen ? '▴' : '▾'}</span>
                            </div>
                            {isOpen && Array.from(bySubPhase.entries()).map(([subKey, sub]) => (
                              <div key={subKey}>
                                <div style={{ padding: '5px 12px 2px', fontSize: '10.5px', color: C.textDisabled, textTransform: 'uppercase' }}>{sub.subPhaseName}</div>
                                {sub.tasks.map((t, ti) => (
                                  <div key={`${t.id}-${ti}`} onClick={() => { updateAction(idx, { dependsOnTaskId: t.id }); setDepPicker(null); }}
                                    style={{
                                      padding: '5px 16px', fontSize: '12px', cursor: 'pointer',
                                      color: a.dependsOnTaskId === t.id ? GOLIVE : C.textPrimary,
                                      fontWeight: a.dependsOnTaskId === t.id ? WEIGHT.semibold : WEIGHT.normal,
                                      background: a.dependsOnTaskId === t.id ? `${GOLIVE}14` : 'transparent',
                                    }}>
                                    {t.title}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <input value={a.dependencyNote || ''} onChange={e => updateAction(idx, { dependencyNote: e.target.value })}
                  placeholder="הערת תלות נוספת / תלות שאינה משימה בתוכנית..." style={{ ...miniSel, width: '100%', boxSizing: 'border-box' }} />
              </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <button onClick={() => addAction(bucket.phase)} style={{ width: '100%', padding: '8px', border: `1.5px dashed ${C.borderEm}`, borderRadius: RADIUS.md, background: 'none', color: GOLIVE, fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: FONT }}>
                    + Add Activity
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Section 3 — תנאים מקדימים */}
        <div style={sec}>
          <div style={secHdr}><span style={secNum(3)}>3</span>תנאים מקדימים</div>
          <div style={secBody}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {PREREQUISITE_OPTIONS.map(p => (
                <span key={p} style={chip(f.prerequisites.includes(p))} onClick={() => toggleChip(f.prerequisites, p, 'prerequisites')}>{p}</span>
              ))}
            </div>
            <input value={f.prerequisitesNote} onChange={e => update({ prerequisitesNote: e.target.value })}
              style={{ ...miniSel, width: '100%', boxSizing: 'border-box' }} placeholder="הערות חופשיות נוספות..." />
          </div>
        </div>

        {/* Section 4 — בדיקות מיוחדות */}
        <div style={sec}>
          <div style={secHdr}><span style={secNum(4)}>4</span>בדיקות מיוחדות</div>
          <div style={secBody}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: WEIGHT.semibold, flex: 1, color: C.textPrimary }}>נדרשות בדיקות מיוחדות בליל הגרסה?</span>
              {[true, false].map(v => (
                <span key={String(v)} onClick={() => update({ nightTestNeeded: v })} style={{
                  fontSize: '12px', fontWeight: WEIGHT.bold, padding: '4px 14px', borderRadius: RADIUS.full, cursor: 'pointer',
                  border: `1px solid ${f.nightTestNeeded === v ? (v ? 'rgba(217,119,6,.35)' : C.borderEm) : C.borderEm}`,
                  background: f.nightTestNeeded === v ? (v ? C.warningBg : C.bgNested) : C.bgCard,
                  color: f.nightTestNeeded === v ? (v ? C.warning : C.textMuted) : C.textMuted,
                }}>{v ? 'כן' : 'לא'}</span>
              ))}
            </div>
            {f.nightTestNeeded && (
              <textarea value={f.nightTestingNotes} onInput={autoGrow} onChange={e => update({ nightTestingNotes: e.target.value })}
                style={{ ...miniTa, marginBottom: '10px' }} placeholder="מה יש לבדוק בליל הגרסה..." />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: WEIGHT.semibold, flex: 1, color: C.textPrimary }}>נדרשות בדיקות מיוחדות ביום שאחרי?</span>
              {[true, false].map(v => (
                <span key={String(v)} onClick={() => update({ nextDayTestNeeded: v })} style={{
                  fontSize: '12px', fontWeight: WEIGHT.bold, padding: '4px 14px', borderRadius: RADIUS.full, cursor: 'pointer',
                  border: `1px solid ${f.nextDayTestNeeded === v ? (v ? 'rgba(217,119,6,.35)' : C.borderEm) : C.borderEm}`,
                  background: f.nextDayTestNeeded === v ? (v ? C.warningBg : C.bgNested) : C.bgCard,
                  color: f.nextDayTestNeeded === v ? (v ? C.warning : C.textMuted) : C.textMuted,
                }}>{v ? 'כן' : 'לא'}</span>
              ))}
            </div>
            {f.nextDayTestNeeded && (
              <textarea value={f.nextDayTestNotes} onInput={autoGrow} onChange={e => update({ nextDayTestNotes: e.target.value })}
                style={miniTa} placeholder="מה יש לבדוק ביום שאחרי..." />
            )}
          </div>
        </div>

        {/* Section 5 — נקודות בקרה (Monitoring) */}
        <div style={sec}>
          <div style={secHdr}><span style={secNum(5)}>5</span>נקודות בקרה (Monitoring)</div>
          <div style={secBody}>
            {f.monitoringPoints.map((m, idx) => {
              const monTeamMembers = teams.find((t: any) => t.id === m.assignedTeamId)?.members?.map((mm: any) => mm.user).filter(Boolean) ?? teamUsers;
              return (
                <div key={idx} style={{ background: C.bgNested, borderRadius: RADIUS.md, padding: '12px 14px', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <select value={m.type} onChange={e => updateMonitoring(idx, { type: e.target.value })} style={miniSel}>
                      {MONITORING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input value={m.name} onChange={e => updateMonitoring(idx, { name: e.target.value })} style={{ ...miniSel, flex: 1, boxSizing: 'border-box', fontFamily: FONT_MONO }} placeholder="שם ממשק/עבודה/טבלה" />
                    <button onClick={() => removeMonitoring(idx)} style={{ background: 'none', border: 'none', color: C.danger, cursor: 'pointer', fontSize: '13px', flexShrink: 0 }}>הסר</button>
                  </div>
                  <input value={m.note || ''} onChange={e => updateMonitoring(idx, { note: e.target.value })}
                    style={{ ...miniSel, width: '100%', boxSizing: 'border-box', marginBottom: '8px' }} placeholder="לוודא ש..." />
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    {phaseOptions.map(ph => {
                      const fullLabel = phaseLabels[ph] || PHASE_LABELS[ph] || `שלב ${ph}`;
                      const shortLabel = fullLabel.split(' — ')[1] || fullLabel;
                      const sel = m.phase === ph;
                      return (
                        <span key={ph} title={fullLabel} onClick={() => updateMonitoring(idx, { phase: ph })}
                          style={{
                            fontSize: '11px', fontWeight: WEIGHT.bold, padding: '3px 10px', borderRadius: RADIUS.full, cursor: 'pointer',
                            background: sel ? GOLIVE : C.bgCard,
                            border: `1px solid ${sel ? GOLIVE : C.borderEm}`,
                            color: sel ? '#fff' : C.textMuted,
                          }}>
                          {shortLabel}
                        </span>
                      );
                    })}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <select value={m.assignedTeamId || ''} onChange={e => updateMonitoring(idx, { assignedTeamId: e.target.value || undefined, assignedUserName: undefined })} style={miniSel}>
                      <option value="">צוות אחראי — ללא</option>
                      {teams.filter((t: any) => t.active).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <select value={m.assignedUserName || ''} onChange={e => updateMonitoring(idx, { assignedUserName: e.target.value || undefined })} style={miniSel}>
                      <option value="">עובד אחראי — ללא</option>
                      {monTeamMembers.map((u: any) => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
            <button onClick={addMonitoring} style={{ width: '100%', padding: '9px', border: `1.5px dashed ${C.borderEm}`, borderRadius: RADIUS.md, background: 'none', color: C.textMuted, fontSize: '13px', fontWeight: WEIGHT.semibold, cursor: 'pointer', fontFamily: FONT }}>
              + הוסף נקודת בקרה
            </button>
          </div>
        </div>

        {/* Section 6 — Rollback */}
        <div style={sec}>
          <div style={secHdr}><span style={secNum(6)}>6</span>Rollback</div>
          <div style={secBody}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <select value={f.rollbackType} onChange={e => update({ rollbackType: e.target.value })} style={miniSel}>
                <option value="">-- בחר סוג Rollback --</option>
                {ROLLBACK_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <input value={f.rollbackPlan} onChange={e => update({ rollbackPlan: e.target.value })} style={{ ...miniSel, flex: 1 }} placeholder="הערות Rollback..." />
            </div>
          </div>
        </div>

        {/* תלויות CR (ברמת ה-CR, לא ברמת פעולה בודדת) */}
        {otherCrs.length > 0 && (
          <div style={sec}>
            <div style={secHdr}>תלויות ב-CR-ים אחרים</div>
            <div style={secBody}>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {otherCrs.map(cr => (
                  <span key={cr} style={chip(f.dependsOnCrs.includes(cr))}
                    onClick={() => {
                      const next = f.dependsOnCrs.includes(cr) ? f.dependsOnCrs.filter(x => x !== cr) : [...f.dependsOnCrs, cr];
                      update({ dependsOnCrs: next });
                    }}>
                    {cr}
                  </span>
                ))}
              </div>
              {f.dependsOnCrs.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                  {f.dependsOnCrs.map(cr => (
                    <div key={cr} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', fontFamily: FONT_MONO, color: C.textMuted, width: '90px', flexShrink: 0 }}>{cr} תלוי ב-</span>
                      <input value={f.dependencyNotes[cr] || ''}
                        onChange={e => update({ dependencyNotes: { ...f.dependencyNotes, [cr]: e.target.value } })}
                        style={{ ...miniSel, flex: 1 }} placeholder="הסבר את התלות..." />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        </div>

        {/* Section 7 — תקציר וסגירה */}
        <div style={sec}>
          <div style={secHdr}><span style={secNum(7)}>7</span>תקציר וסגירה</div>
          <div style={secBody}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px', fontSize: '13px', color: C.textSecondary, lineHeight: 1.6 }}>
              <div>• שינויים ב-<strong style={{ color: C.textPrimary }}>{f.changeTypes.length ? f.changeTypes.join(', ') : '—'}</strong></div>
              <div>• <strong style={{ color: C.textPrimary }}>{f.actions.length} פעולות מיוחדות</strong>{f.actions.length > 0 && ` — ${f.actions.map(a => `${a.actionType} (${(phaseLabels[a.phase] || PHASE_LABELS[a.phase] || `שלב ${a.phase}`).split(' — ')[1] || a.phase}${a.estimatedMins ? `, ${a.estimatedMins} דק'` : ''})`).join(', ')}`}</div>
              <div>• תנאים מקדימים: <strong style={{ color: C.textPrimary }}>{f.prerequisites.length ? f.prerequisites.join(', ') : 'אין'}</strong>{f.prerequisitesNote && ` — ${f.prerequisitesNote}`}</div>
              <div>• בדיקות: {f.nightTestNeeded ? 'ליל גרסה' : ''}{f.nightTestNeeded && f.nextDayTestNeeded ? ' + ' : ''}{f.nextDayTestNeeded ? 'יום אחרי' : ''}{!f.nightTestNeeded && !f.nextDayTestNeeded && 'אין בדיקות מיוחדות'}</div>
              <div>• <strong style={{ color: C.textPrimary }}>{f.monitoringPoints.length} נקודות בקרה</strong> הוגדרו</div>
              <div>• Rollback: <strong style={{ color: C.textPrimary }}>{f.rollbackType || 'לא הוגדר'}</strong></div>
            </div>
            <button onClick={() => confirmCrPlan(crNumber)} disabled={savingPlan === crNumber || lockedForEdit} style={{
              width: '100%', padding: '14px', background: (savingPlan === crNumber || lockedForEdit) ? C.textDisabled : GOLIVE, color: '#fff',
              border: 'none', borderRadius: RADIUS.md, fontSize: '14px', fontWeight: WEIGHT.bold, cursor: (savingPlan === crNumber || lockedForEdit) ? 'not-allowed' : 'pointer', fontFamily: FONT,
            }}>
              {savingPlan === crNumber ? 'שומר...' : lockedForEdit ? '✓ הוגש ונעול' : submitted ? '✓ שמור מחדש וסגור לעריכה' : '✓ אשר תוכנית CR'}
            </button>
            {derivedTaskNote[crNumber] && (
              <div style={{ marginTop: '10px', background: C.infoBg, border: `1px solid ${C.info}40`, borderRadius: RADIUS.md, padding: '10px 12px', fontSize: '12.5px', color: C.info, lineHeight: 1.5 }}>
                {derivedTaskNote[crNumber]}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Left panel: single CR list item ─────────────────────────────────────────
  const renderListItem = (crNumber: string, crProposals: Proposal[]) => {
    const plan        = crPlans[crNumber];
    const isNotNeeded  = plan?.notNeededForPlan;
    const isSubmitted  = plan?.submissionStatus === 'SUBMITTED' || plan?.submissionStatus === 'APPROVED';
    const isReturned   = plan?.submissionStatus === 'RETURNED';
    const isDone       = isNotNeeded || isSubmitted;
    const isSelected   = selectedCr === crNumber;
    const label        = getCrLabel(crNumber);

    const chipStyle: React.CSSProperties = isReturned
      ? { background: C.dangerBg, color: C.danger }
      : isDone
      ? { background: C.successBg, color: C.success }
      : { background: C.warningBg, color: C.warning };
    const chipText = isReturned ? '⚠ הוחזר' : isDone ? '✅ הושלם' : '⏳ ממתין';

    // Other teams sharing this CR — status-only (never plan content), so the lead
    // can tell at a glance whether they're waiting on someone else too.
    const otherTeams = (teamVisibility[crNumber]?.teams ?? []).filter(t => !t.isMine);

    return (
      <div key={crNumber}
        onClick={() => { setSelectedCr(crNumber); setSelectedTab('plan'); }}
        style={{
          display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px 14px',
          margin: '0 8px 8px', cursor: 'pointer',
          background: C.bgCard, borderRadius: RADIUS.lg,
          border: `1px solid ${isSelected ? GOLIVE : C.border}`,
          boxShadow: isSelected ? SHADOW.sm : SHADOW.xs,
          opacity: isDone && !isSelected ? 0.65 : 1,
          transition: 'box-shadow .12s, border-color .12s',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: '700', fontFamily: FONT_MONO, color: GOLIVE, background: `${GOLIVE}1F`, padding: '2px 9px', borderRadius: RADIUS.sm, flexShrink: 0 }}>{crNumber}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: '700', color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label || crNumber}
          </span>
          <span style={{ fontSize: '10.5px', fontWeight: '700', padding: '3px 10px', borderRadius: RADIUS.full, flexShrink: 0, ...chipStyle }}>{chipText}</span>
        </div>
        {otherTeams.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {otherTeams.map(t => {
              // No Special Activity is a distinct outcome from a real submission —
              // not a shade of "done". Kept visually separate (blue vs green) so a
              // lead can tell "team opted out" from "team did the work" at a glance.
              const isSubmitted   = t.submissionStatus === 'SUBMITTED' || t.submissionStatus === 'APPROVED';
              const isNoActivity  = t.notNeededForPlan && isSubmitted;
              const isReturned    = t.submissionStatus === 'RETURNED';
              const canPreview    = isSubmitted; // draft/not-started have nothing stable to show yet
              const dotColor = isReturned ? C.danger
                : isNoActivity ? C.info
                : isSubmitted  ? C.success
                : t.started    ? C.warning
                : C.textDisabled;
              const label = isReturned ? 'הוחזר' : isNoActivity ? 'אין פעילות מיוחדת' : isSubmitted ? 'הוגש' : t.started ? 'בטיוטה' : 'טרם התחיל';
              return (
                <span key={t.teamId} title={canPreview ? `${label} — לחץ לתצוגה מקדימה` : label}
                  onClick={canPreview ? (e) => { e.stopPropagation(); openTeamPreview(crNumber, t.teamId, t.teamName); } : undefined}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: '700',
                    padding: '3px 9px', borderRadius: RADIUS.full,
                    border: `1px solid ${C.borderEm}`, background: C.bgCard, color: C.textSecondary,
                    cursor: canPreview ? 'pointer' : 'default',
                  }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                  {t.teamName}
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ── Right panel: full CR detail (plan + tasks) ───────────────────────────────
  const renderDetailPanel = (crNumber: string) => {
    const label        = getCrLabel(crNumber);
    const crProposals  = (grouped[crNumber] || []).slice().sort((a, b) => a.phase - b.phase);
    const isNotNeeded  = crPlans[crNumber]?.notNeededForPlan;
    const isSavingPln  = savingPlan === crNumber;
    const isTogglingNN = togglingNotNeeded.has(crNumber);
    const saved        = crPlans[crNumber];
    const f            = crPlanForms[crNumber] || emptyCrPlanForm();

    const draftCount = crProposals.filter(p => p.status === 'DRAFT' && !p.usedInTaskId).length;

    // Readiness = per-CR submission status (DRAFT → SUBMITTED/APPROVED via the
    // Section-1 gate + Section-7 confirm), independent of the legacy task-proposal flow.
    const crSubmitted = saved?.submissionStatus === 'SUBMITTED' || saved?.submissionStatus === 'APPROVED';
    const crReturned   = saved?.submissionStatus === 'RETURNED';
    const gateAnswered = !!f.gateAnswered;

    // Next CR navigation
    const activeCrs = crGroups.filter(([cr]) => !crPlans[cr]?.notNeededForPlan).map(([cr]) => cr);
    const curIdx    = activeCrs.indexOf(crNumber);
    const nextCrNum = curIdx >= 0 && curIdx < activeCrs.length - 1 ? activeCrs[curIdx + 1] : null;

    const tabBtn = (tab: 'plan' | 'tasks', tabLabel: string, badge?: React.ReactNode) => (
      <button onClick={() => setSelectedTab(tab)} style={{
        fontSize: '14px', fontWeight: 600, padding: '8px 12px', cursor: 'pointer',
        color: selectedTab === tab ? C.brand : C.textMuted,
        borderBottom: `2px solid ${selectedTab === tab ? C.brand : 'transparent'}`,
        background: 'none', borderTop: 'none', borderRight: 'none', borderLeft: 'none',
        fontFamily: FONT, marginBottom: '-1px', display: 'flex', alignItems: 'center', gap: '5px',
      }}>
        {tabLabel}{badge}
      </button>
    );

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#F5F5F5' }}>

        {/* Topbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 18px', background: C.bgCard, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: C.info, background: C.infoBg, padding: '3px 9px', borderRadius: RADIUS.sm, fontSize: '14px', flexShrink: 0 }}>{crNumber}</span>
          <span style={{ flex: 1, fontWeight: 600, fontSize: '15px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.textPrimary }}>{label || crNumber}</span>
          {!isNotNeeded && (
            crReturned ? (
              <span style={{ fontSize: '13px', fontWeight: 700, padding: '2px 9px', borderRadius: '9999px', flexShrink: 0, color: C.danger, background: C.dangerBg, border: `1px solid ${C.danger}35` }}>
                ⚠ הוחזר לתיקון
              </span>
            ) : crSubmitted ? (
              <span style={{ fontSize: '13px', fontWeight: 700, padding: '2px 9px', borderRadius: '9999px', flexShrink: 0, color: C.success, background: C.successBg, border: `1px solid ${C.success}35` }}>
                ✅ הושלם
              </span>
            ) : gateAnswered ? (
              <span style={{ fontSize: '13px', fontWeight: 700, padding: '2px 9px', borderRadius: '9999px', flexShrink: 0, color: C.warning, background: C.warningBg, border: `1px solid ${C.warning}35` }}>
                ⏳ בטיוטה
              </span>
            ) : (
              <span style={{ fontSize: '13px', fontWeight: 700, padding: '2px 9px', borderRadius: '9999px', flexShrink: 0, color: C.textMuted, background: C.bgNested, border: `1px solid ${C.border}` }}>
                טרם נענה
              </span>
            )
          )}
          {/* Once the gate has been answered, offer a quick escape hatch back to
              "not needed" — before that, the gate itself is the only entry point. */}
          {!locked && isNotNeeded && (
            <button
              onClick={() => toggleNotNeeded(crNumber)}
              disabled={isTogglingNN}
              title="לחץ להחזיר CR זה לתהליך הרגיל"
              style={{
                fontSize: '13px', fontWeight: 600, flexShrink: 0, fontFamily: FONT,
                padding: '3px 9px', borderRadius: '6px',
                cursor: isTogglingNN ? 'not-allowed' : 'pointer',
                color: C.warning, background: C.warningBg, border: `1px solid ${C.warning}50`,
              }}>
              {isTogglingNN ? '...' : '↩ החזר לתהליך'}
            </button>
          )}
          {!locked && (
            <button onClick={() => deleteCrGroup(crNumber)}
              style={{ fontSize: '13px', color: C.danger, background: C.dangerBg, border: `1px solid ${C.danger}40`, borderRadius: '6px', padding: '3px 9px', cursor: 'pointer', flexShrink: 0, fontFamily: FONT }}>
              🗑
            </button>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', background: C.bgCard, borderBottom: `1px solid ${C.border}`, padding: '0 18px', flexShrink: 0 }}>
          {tabBtn('plan', 'תוכנית CR')}
          {tabBtn('tasks', 'משימות נגזרות',
            draftCount > 0
              ? <span style={{ background: `${C.warning}20`, color: C.warning, border: `1px solid ${C.warning}40`, fontSize: '11px', fontWeight: 700, padding: '1px 5px', borderRadius: '9999px' }}>{draftCount} טיוטא</span>
              : crProposals.length > 0
              ? <span style={{ background: `${C.success}15`, color: C.success, border: `1px solid ${C.success}30`, fontSize: '11px', fontWeight: 700, padding: '1px 5px', borderRadius: '9999px' }}>{crProposals.length}</span>
              : undefined
          )}
        </div>

        {/* Tab content */}
        {selectedTab === 'plan' ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
            {isNotNeeded ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '48px 0', textAlign: 'center' }}>
                <div style={{ background: C.successBg, border: '1px solid rgba(22,163,74,.25)', borderRadius: RADIUS.md, padding: '14px 18px', fontSize: '13px', color: '#0F5A2A', lineHeight: 1.6, maxWidth: '440px' }}>
                  ✓ נבחר: ללא השפעה מיוחדת — CR זה נכלל בהטמעה הרגילה ואינו דורש תיאום נוסף, סקריפטים או בדיקות מיוחדות.
                </div>
                {!locked && (
                  <button onClick={() => toggleNotNeeded(crNumber)} disabled={isTogglingNN}
                    style={{ fontFamily: FONT, fontSize: '14px', fontWeight: 600, padding: '8px 18px', borderRadius: RADIUS.md, background: 'none', color: C.textMuted, border: `1px solid ${C.borderEm}`, cursor: isTogglingNN ? 'not-allowed' : 'pointer' }}>
                    {isTogglingNN ? '...' : '↩ בעצם יש השפעה — פתח מחדש'}
                  </button>
                )}
              </div>
            ) : !gateAnswered ? (
              renderGate(crNumber)
            ) : (
              renderCrPlanForm(crNumber)
            )}
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
            {crProposals.length === 0 && (
              <div style={{ padding: '40px 0', textAlign: 'center', color: C.textMuted, fontSize: '15px' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>📋</div>
                <div>אין משימות — הפק מהתוכנית או הוסף ידנית</div>
              </div>
            )}
            {crProposals.map(renderRow)}
            {!locked && !isNotNeeded && openFormForCr !== crNumber && (
              <button onClick={() => openAdd(crNumber, label)}
                style={{ marginTop: '10px', width: '100%', padding: '9px', background: C.statusOpen, color: C.textInverse, border: 'none', borderRadius: RADIUS.lg, cursor: 'pointer', fontSize: '15px', fontWeight: 600 }}>
                + הוסף משימה לביצוע
              </button>
            )}
          </div>
        )}

        {/* Footer — save draft + next navigation */}
        {selectedTab === 'plan' && !isNotNeeded && gateAnswered && (!crSubmitted || unlockedForEdit.has(crNumber)) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '10px 18px', background: C.bgCard, borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
            <button onClick={() => saveCrPlan(crNumber)} disabled={isSavingPln}
              style={{ fontFamily: FONT, fontSize: '14px', fontWeight: 600, padding: '7px 18px', borderRadius: RADIUS.md, background: isSavingPln ? C.textDisabled : C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, cursor: isSavingPln ? 'not-allowed' : 'pointer' }}>
              {isSavingPln ? 'שומר...' : 'שמור טיוטה'}
            </button>
            {nextCrNum && (
              <button onClick={() => { setSelectedCr(nextCrNum); setSelectedTab('plan'); }}
                style={{ fontFamily: FONT, fontSize: '14px', fontWeight: 600, padding: '7px 14px', borderRadius: RADIUS.md, background: C.bgCard, color: GOLIVE, border: `1px solid ${GOLIVE}40`, cursor: 'pointer' }}>
                הבא: {nextCrNum} ←
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ direction: 'rtl', fontFamily: FONT, color: C.textPrimary }}>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />

      {/* Cross-team plan preview — read-only, only ever shown for a SUBMITTED/APPROVED plan */}
      {teamPreview && (
        <div onClick={() => setTeamPreview(null)} style={{ position: 'fixed', inset: 0, background: C.bgOverlay, zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.bgCard, borderRadius: RADIUS['3xl'], padding: '24px 28px', maxWidth: '560px', width: '95vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: SHADOW.xl }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <div style={{ fontWeight: '700', fontSize: '17px', color: C.textPrimary }}>
                תוכנית {teamPreview.teamName}
              </div>
              <button onClick={() => setTeamPreview(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '18px', padding: '2px 6px' }}>✕</button>
            </div>

            {teamPreview.loading && (
              <div style={{ padding: '30px', textAlign: 'center', color: C.textMuted, fontSize: '14px' }}>טוען...</div>
            )}
            {teamPreview.error && (
              <div style={{ padding: '14px', background: C.dangerBg, color: C.danger, borderRadius: RADIUS.md, fontSize: '14px', marginTop: '12px' }}>
                {teamPreview.error}
              </div>
            )}
            {teamPreview.data && (
              teamPreview.data.notNeededForPlan && teamPreview.data.actions.length === 0 ? (
                <div style={{ padding: '20px', background: C.infoBg, color: C.info, borderRadius: RADIUS.md, fontSize: '14px', marginTop: '12px', textAlign: 'center' }}>
                  🔵 הצוות מעורב ב-CR זה אך אין לו פעילות מיוחדת
                </div>
              ) : (
                <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {teamPreview.data.submittedByName && (
                    <div style={{ fontSize: '13px', color: C.textMuted }}>
                      הוגש ע"י {teamPreview.data.submittedByName}
                      {teamPreview.data.submittedAt && ` · ${new Date(teamPreview.data.submittedAt).toLocaleString('he-IL')}`}
                    </div>
                  )}

                  {teamPreview.data.actions.length > 0 && (
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: C.textSecondary, marginBottom: '6px' }}>
                        פעילויות ({teamPreview.data.actions.length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {teamPreview.data.actions.map((a, i) => (
                          <div key={i} style={{ padding: '8px 10px', background: C.bgNested, borderRadius: RADIUS.md, fontSize: '13px' }}>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '2px' }}>
                              <span style={{ fontWeight: '700', color: C.brand }}>{a.actionType}</span>
                              {a.system && <span style={{ color: C.textMuted }}>· {a.system}</span>}
                              {a.estimatedMins != null && <span style={{ color: C.textMuted }}>· {a.estimatedMins} דק'</span>}
                              {a.ownerName && <span style={{ color: C.textMuted, marginRight: 'auto' }}>{a.ownerName}</span>}
                            </div>
                            <div style={{ color: C.textPrimary }}>{a.description}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {teamPreview.data.monitoringPoints.length > 0 && (
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: C.textSecondary, marginBottom: '6px' }}>
                        נקודות בקרה ({teamPreview.data.monitoringPoints.length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {teamPreview.data.monitoringPoints.map((m, i) => (
                          <div key={i} style={{ padding: '8px 10px', background: C.bgNested, borderRadius: RADIUS.md, fontSize: '13px' }}>
                            <span style={{ fontWeight: '700', color: C.info }}>{m.type}</span>{' — '}{m.name}
                            {m.note && <div style={{ color: C.textMuted, marginTop: '2px' }}>{m.note}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(teamPreview.data.nightTestNeeded || teamPreview.data.nextDayTestNeeded) && (
                    <div style={{ fontSize: '13px', color: C.textSecondary }}>
                      <strong>בדיקות: </strong>
                      {[teamPreview.data.nightTestNeeded && 'ליל גרסה', teamPreview.data.nextDayTestNeeded && 'יום אחרי'].filter(Boolean).join(' + ')}
                    </div>
                  )}

                  <div style={{ fontSize: '13px', color: C.textSecondary }}>
                    <strong>Rollback: </strong>{teamPreview.data.rollbackType || 'לא הוגדר'}
                    {teamPreview.data.rollbackPlan && <div style={{ color: C.textMuted, marginTop: '2px' }}>{teamPreview.data.rollbackPlan}</div>}
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Extract-tasks modal */}
      {extractModal && (
        <div style={{ position: 'fixed', inset: 0, background: C.bgOverlay, zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl' }}>
          <div style={{ background: C.bgCard, borderRadius: RADIUS['3xl'], padding: '24px 28px', maxWidth: '560px', width: '95vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: SHADOW.xl }}>
            <div style={{ fontWeight: '700', fontSize: '17px', color: C.textPrimary, marginBottom: '4px' }}>
              ⚡ הפק משימות מ{extractModal.sourceLabel}
            </div>
            <div style={{ fontSize: '14px', color: C.textMuted, marginBottom: '16px' }}>
              CR {extractModal.crNumber} — בחר אילו שורות להפוך למשימות לביצוע
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {extractModal.items.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: '10px',
                  padding: '10px 12px', borderRadius: RADIUS.lg,
                  background: item.checked ? C.infoBg : C.bgNested,
                  border: `1px solid ${item.checked ? `${C.info}40` : C.border}`,
                }}>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={e => setExtractModal(m => m ? {
                      ...m,
                      items: m.items.map((it, j) => j === i ? { ...it, checked: e.target.checked } : it),
                    } : null)}
                    style={{ marginTop: '3px', flexShrink: 0, cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <input
                      value={item.text}
                      onChange={e => setExtractModal(m => m ? {
                        ...m,
                        items: m.items.map((it, j) => j === i ? { ...it, text: e.target.value } : it),
                      } : null)}
                      style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '15px', color: C.textPrimary, outline: 'none', fontFamily: FONT, boxSizing: 'border-box' }}
                      disabled={!item.checked}
                    />
                    {item.duplicateId && (
                      <span style={{ fontSize: '12px', color: C.warning, fontWeight: '600' }}>⚠ כבר קיימת — תישאל אם להחליף</span>
                    )}
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={item.estimatedMins}
                    onChange={e => setExtractModal(m => m ? {
                      ...m,
                      items: m.items.map((it, j) => j === i ? { ...it, estimatedMins: e.target.value } : it),
                    } : null)}
                    disabled={!item.checked}
                    placeholder="דק'"
                    style={{ width: '54px', fontSize: '13px', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: '2px 4px', textAlign: 'center', flexShrink: 0 }}
                  />
                  <select
                    value={item.phase}
                    onChange={e => setExtractModal(m => m ? {
                      ...m,
                      items: m.items.map((it, j) => j === i ? { ...it, phase: parseInt(e.target.value) } : it),
                    } : null)}
                    disabled={!item.checked}
                    style={{ fontSize: '13px', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: '2px 4px', background: C.bgCard, color: C.textSecondary, flexShrink: 0 }}
                  >
                    {(Object.keys(phaseLabels).length > 0
                      ? Object.keys(phaseLabels).map(Number).sort((a, b) => a - b)
                      : [1, 2, 3, 4]
                    ).map(ph => (
                      <option key={ph} value={ph}>{(phaseLabels[ph] || PHASE_LABELS[ph])?.split(' — ')[1] || `שלב ${ph}`}</option>
                    ))}
                  </select>
                  <select
                    value={item.assignedUserName}
                    onChange={e => setExtractModal(m => m ? {
                      ...m,
                      items: m.items.map((it, j) => j === i ? { ...it, assignedUserName: e.target.value } : it),
                    } : null)}
                    disabled={!item.checked}
                    style={{ fontSize: '13px', border: `1px solid ${item.checked && !item.assignedUserName ? C.danger : C.border}`, borderRadius: RADIUS.sm, padding: '2px 4px', background: C.bgCard, color: C.textSecondary, flexShrink: 0, maxWidth: '110px' }}
                  >
                    <option value="">-- אחראי --</option>
                    {myTeamMembers.map((u: any) => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {extractModal.items.some(it => it.checked && !it.assignedUserName) && (
              <div style={{ fontSize: '14px', color: C.danger, marginTop: '-8px', marginBottom: '12px' }}>
                ⚠ יש לבחור אחראי לכל משימה מסומנת — משימה בלי אחראי לא תעבור לתוכנית בפועל
              </div>
            )}

            {/* Select all / none */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <button onClick={() => setExtractModal(m => m ? { ...m, items: m.items.map(it => ({ ...it, checked: true })) } : null)}
                style={{ fontSize: '14px', padding: '4px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, background: C.bgCard, cursor: 'pointer', color: C.textSecondary }}>
                בחר הכל
              </button>
              <button onClick={() => setExtractModal(m => m ? { ...m, items: m.items.map(it => ({ ...it, checked: false })) } : null)}
                style={{ fontSize: '14px', padding: '4px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, background: C.bgCard, cursor: 'pointer', color: C.textSecondary }}>
                בטל הכל
              </button>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setExtractModal(null)}
                style={{ padding: '8px 18px', border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, background: C.bgCard, cursor: 'pointer', fontSize: '15px', color: C.textSecondary }}>
                ביטול
              </button>
              {(() => {
                const checkedCount = extractModal.items.filter(i => i.checked).length;
                const blocked = checkedCount === 0 || extractModal.items.some(i => i.checked && !i.assignedUserName);
                return (
                  <button
                    onClick={createExtracted}
                    disabled={extracting || blocked}
                    style={{
                      padding: '8px 22px', border: 'none', borderRadius: RADIUS.lg,
                      background: blocked ? C.bgNested : C.brand,
                      color: blocked ? C.textDisabled : C.textInverse,
                      cursor: blocked ? 'default' : 'pointer',
                      fontSize: '15px', fontWeight: '700',
                    }}
                  >
                    {extracting ? 'יוצר...' : `צור ${checkedCount} משימות`}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{
        background: C.bgCard, border: `1px solid ${C.border}`,
        borderRadius: RADIUS.lg, padding: '16px 20px', marginBottom: '16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px',
        boxShadow: SHADOW.xs,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '2px' }}>
            <span style={{ fontSize: '19px', fontWeight: '700', color: C.textPrimary }}>התכנון שלי — My CR Planning</span>
            {myTeamName && (
              <span style={{ fontSize: '11px', fontWeight: '700', padding: '3px 11px', borderRadius: RADIUS.full, background: `${GOLIVE}22`, color: GOLIVE }}>
                {myTeamName}
              </span>
            )}
          </div>
          <div style={{ fontSize: '12.5px', color: C.textMuted }}>
            {versionName}
            {reviewMeetingTime && (
              <> · יש להגיש את כל התוכניות לפני פגישת הסקירה · {new Date(reviewMeetingTime).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} 🗓</>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {proposals.length > 0 && (
            <span style={{ fontSize: '13px', color: C.textMuted }}>
              {totalReady}/{proposals.length} מוכן
            </span>
          )}
          {!locked && (
            <button
              onClick={() => syncCrItems(false)}
              disabled={syncLoading}
              style={{
                padding: '7px 16px', background: syncLoading ? C.bgNested : C.successBg,
                color: syncLoading ? C.textMuted : C.success, border: `1px solid ${syncLoading ? C.border : 'rgba(22,163,74,.25)'}`, borderRadius: RADIUS.md,
                cursor: syncLoading ? 'not-allowed' : 'pointer', fontWeight: '700', fontSize: '13.5px', whiteSpace: 'nowrap',
              }}
            >
              {syncLoading ? '⏳ מסנכרן...' : '🔄 סנכרן רשימת פיתוחים'}
            </button>
          )}
          {!locked && (
            <button onClick={() => openAdd()} style={{
              padding: '7px 16px', background: C.brandDim, color: C.brand,
              border: `1px solid ${C.brand}40`, borderRadius: RADIUS.md,
              cursor: 'pointer', fontWeight: '600', fontSize: '13.5px',
            }}>
              + הוסף משימה
            </button>
          )}
          {locked ? (
            <>
              <span style={{ padding: '7px 16px', background: C.successBg, color: C.success, border: `1px solid rgba(22,163,74,.25)`, borderRadius: RADIUS.md, fontWeight: '700', fontSize: '13.5px' }}>
                הוגש ✓
              </span>
              {isManager && (
                <button
                  onClick={() => setManagerUnlocked(true)}
                  style={{ padding: '7px 14px', background: C.warningBg, color: C.warning, border: `1px solid ${C.warning}80`, borderRadius: RADIUS.md, cursor: 'pointer', fontWeight: '700', fontSize: '13px', whiteSpace: 'nowrap' }}
                >
                  ✏️ עדכן כמנהל
                </button>
              )}
            </>
          ) : managerUnlocked ? (
            <>
              <span style={{ padding: '7px 14px', background: C.warningBg, color: C.warning, border: `1px solid ${C.warning}80`, borderRadius: RADIUS.md, fontWeight: '700', fontSize: '13px', whiteSpace: 'nowrap' }}>
                ✏️ עריכת מנהל
              </span>
              <button
                onClick={() => setManagerUnlocked(false)}
                style={{ padding: '7px 14px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontWeight: '700', fontSize: '13px', whiteSpace: 'nowrap' }}
              >
                ✓ סיים עריכה
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
              <button
                onClick={submitDone}
                disabled={submitting || !canSubmit}
                title={!canSubmit ? `יש להשלים ${crGroups.length - doneCrCount} CR-ים לפני ההגשה` : ''}
                style={{
                  padding: '8px 18px',
                  background: submitting ? C.textDisabled : (!canSubmit ? C.bgNested : GOLIVE),
                  color: (!canSubmit && !submitting) ? C.textDisabled : C.textInverse, border: 'none', borderRadius: RADIUS.md,
                  cursor: (submitting || !canSubmit) ? 'not-allowed' : 'pointer',
                  fontWeight: '700', fontSize: '14px',
                  boxShadow: canSubmit && !submitting ? SHADOW.sm : 'none',
                }}
              >
                {submitting ? '...' : 'סיימתי הגשת תוכניות'}
              </button>
              {!canSubmit && crGroups.length > 0 && (
                <span style={{ fontSize: '11px', color: C.textMuted, whiteSpace: 'nowrap' }}>
                  נותרו {crGroups.length - doneCrCount} CR-ים למילוי
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sync error */}
      {syncError && (
        <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}`, borderRadius: RADIUS.lg, padding: '10px 16px', marginBottom: '12px', fontSize: '15px', color: C.danger, display: 'flex', alignItems: 'center', gap: '8px' }}>
          ⚠️ {syncError}
          <button onClick={() => setSyncError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.danger, fontWeight: '700', marginRight: 'auto' }}>×</button>
        </div>
      )}

      {/* Submission error */}
      {submitError && (
        <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}`, borderRadius: RADIUS.lg, padding: '10px 16px', marginBottom: '12px', fontSize: '15px', color: C.danger }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            ⚠️ {submitError}
            <button onClick={() => { setSubmitError(null); setSubmitErrorCrs([]); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.danger, fontWeight: '700', marginRight: 'auto' }}>×</button>
          </div>
          {submitErrorCrs.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
              {submitErrorCrs.map(cr => (
                <span key={cr}
                  onClick={() => { setSelectedCr(cr); setSelectedTab('plan'); }}
                  style={{
                    fontSize: '13px', fontWeight: '700', fontFamily: FONT_MONO, cursor: 'pointer',
                    padding: '3px 10px', borderRadius: RADIUS.full,
                    background: selectedCr === cr ? C.danger : C.bgCard,
                    color: selectedCr === cr ? C.textInverse : C.danger,
                    border: `1px solid ${C.danger}`,
                  }}>
                  {cr} ←
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Submitted banner */}
      {locked && (
        <div style={{ background: C.successBg, border: `2px solid ${C.success}`, borderRadius: RADIUS.xl, padding: '14px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>✅</span>
          <div>
            <div style={{ fontWeight: '700', color: C.success, fontSize: '16px' }}>ההגשה הושלמה</div>
            <div style={{ fontSize: '15px', color: C.success, marginTop: '2px', opacity: 0.85 }}>מנהל הלילה יוכל לקדם את התוכנית לשלב הבא לאחר שכל הצוותים יגישו</div>
          </div>
        </div>
      )}
      {/* Manager edit banner */}
      {managerUnlocked && (
        <div style={{ background: C.warningBg, border: `2px solid ${C.warning}`, borderRadius: RADIUS.xl, padding: '12px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '22px' }}>✏️</span>
          <div>
            <div style={{ fontWeight: '700', color: C.warning, fontSize: '15px' }}>עריכת מנהל פעילה</div>
            <div style={{ fontSize: '14px', color: C.warning, marginTop: '2px' }}>ניתן לערוך, להוסיף ולמחוק משימות. לחץ "סיים עריכה" בסיום.</div>
          </div>
        </div>
      )}

      {/* Proposal form modal (position:fixed — safe to render at top level) */}
      {openFormForCr !== null && (!locked || editId) && renderForm()}

      {/* Main split panel */}
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: C.textMuted }}>טוען...</div>
      ) : crGroups.length === 0 && freeGroup.length === 0 ? (
        <div style={{ padding: '60px 40px', textAlign: 'center', background: C.bgCard, borderRadius: RADIUS['2xl'], color: C.textMuted, boxShadow: SHADOW.sm }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>📋</div>
          <div style={{ fontSize: '17px', marginBottom: '6px', color: C.textSecondary }}>אין CR-ים עדיין</div>
          <div style={{ fontSize: '15px' }}>לחץ "🔄 סנכרן רשימת פיתוחים" לטעינה אוטומטית</div>
        </div>
      ) : (
        <div style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: RADIUS.xl, overflow: 'hidden', minHeight: '68vh', background: C.bgNested }}>

          {/* LEFT: CR list */}
          <div style={{ width: '264px', flexShrink: 0, overflowY: 'auto', background: C.bgNested, borderLeft: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column' }}>

            {/* List header with progress */}
            <div style={{ padding: '14px 16px 12px', background: C.bgCard, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                <span style={{ fontSize: '12.5px', fontWeight: '600', color: C.textSecondary }}>
                  {doneCrCount} מתוך {crGroups.length} תוכניות הושלמו
                </span>
                <span style={{ fontSize: '20px', fontWeight: '800', color: GOLIVE }}>
                  {crGroups.length > 0 ? Math.round(doneCrCount / crGroups.length * 100) : 0}%
                </span>
              </div>
              <div style={{ height: '10px', background: C.bgNested, borderRadius: '5px', overflow: 'hidden' }}>
                <div style={{ width: `${crGroups.length > 0 ? Math.round(doneCrCount / crGroups.length * 100) : 0}%`, height: '100%', background: GOLIVE, borderRadius: '5px', transition: 'width .3s ease-out' }} />
              </div>
            </div>

            {/* Active CRs */}
            <div style={{ paddingTop: '8px' }}>
              {crGroups.filter(([cr]) => !crPlans[cr]?.notNeededForPlan).map(([crNumber, crProposals]) => renderListItem(crNumber, crProposals))}
            </div>

            {/* Free / infrastructure tasks — always visible so users can always add a task without CR */}
            <div onClick={() => setSelectedCr(FREE_KEY)}
              style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '9px 14px', cursor: 'pointer', borderBottom: `1px solid ${C.bgNested}`, borderRight: `3px solid ${selectedCr === FREE_KEY ? C.brand : 'transparent'}`, background: selectedCr === FREE_KEY ? C.infoBg : 'transparent' }}>
              <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: freeGroup.length === 0 ? C.borderEm : freeGroup.every(p => p.status === 'READY' || p.usedInTaskId) ? C.success : C.warning, flexShrink: 0, marginTop: '5px', border: freeGroup.length === 0 ? `1.5px solid ${C.textDisabled}` : 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: freeGroup.length === 0 ? C.textDisabled : C.textMuted, fontFamily: 'monospace' }}>ללא CR</div>
                <div style={{ fontSize: '13px', color: C.textSecondary, lineHeight: 1.35, marginTop: '1px' }}>משימות תשתיתיות</div>
                <div style={{ fontSize: '12px', marginTop: '2px', color: C.textMuted }}>
                  {freeGroup.length === 0 ? 'לחץ להוספת משימה' : `${freeGroup.filter(p => p.status === 'READY' || p.usedInTaskId).length}/${freeGroup.length} מוכן`}
                </div>
              </div>
            </div>

            {/* Not-needed section */}
            {crGroups.filter(([cr]) => crPlans[cr]?.notNeededForPlan).length > 0 && (
              <>
                <div style={{ padding: '7px 14px 4px', borderTop: `1px solid ${C.bgNested}`, marginTop: '4px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    לא נדרשים לתוכנית ({crGroups.filter(([cr]) => crPlans[cr]?.notNeededForPlan).length})
                  </div>
                  <div style={{ fontSize: '12px', color: C.textDisabled, marginTop: '2px' }}>לחץ על CR לביטול הסימון ↩</div>
                </div>
                {crGroups.filter(([cr]) => crPlans[cr]?.notNeededForPlan).map(([crNumber, crProposals]) => renderListItem(crNumber, crProposals))}
              </>
            )}
          </div>

          {/* RIGHT: detail panel */}
          {selectedCr === FREE_KEY ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#F5F5F5' }}>
              <div style={{ padding: '10px 18px', background: C.bgCard, borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: C.textMuted, background: C.bgNested, padding: '3px 9px', borderRadius: RADIUS.sm, fontSize: '14px' }}>ללא CR</span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: '15px', color: C.textPrimary }}>משימות תשתיתיות / כלליות</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
                {freeGroup.sort((a, b) => a.phase - b.phase).map(renderRow)}
                {!submissionDone && openFormForCr !== FREE_KEY && (
                  <button onClick={() => openAdd(undefined, undefined, true)}
                    style={{ marginTop: '10px', width: '100%', padding: '9px', background: C.textMuted, color: C.textInverse, border: 'none', borderRadius: RADIUS.lg, cursor: 'pointer', fontSize: '15px', fontWeight: 600 }}>
                    + הוסף משימה
                  </button>
                )}
              </div>
            </div>
          ) : selectedCr ? renderDetailPanel(selectedCr) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: C.textMuted, fontSize: '15px' }}>
              <div style={{ fontSize: '40px' }}>←</div>
              <div>בחר CR מהרשימה משמאל</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
