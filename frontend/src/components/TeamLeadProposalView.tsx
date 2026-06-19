import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';
import { C, FONT, RADIUS, SHADOW } from '../theme';

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

const APP_TO_TEAMS: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {};
  Object.entries(TEAM_APPS).forEach(([team, apps]) => {
    apps.forEach(app => { m[app] = [...(m[app] || []), team]; });
  });
  return m;
})();

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
const CR_TYPES   = ['תיקון תקלה', 'פיתוח חדש', 'שינוי תשתית', 'שיפור ביצועים'];
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'];
const RISK_LABELS: Record<string, string> = { LOW: 'נמוך', MEDIUM: 'בינוני', HIGH: 'גבוה' };
const RISK_COLORS: Record<string, { bg: string; color: string }> = {
  LOW:    { bg: C.successBg, color: C.success },
  MEDIUM: { bg: C.warningBg, color: C.warning },
  HIGH:   { bg: C.dangerBg,  color: C.danger },
};

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
  crDeps: { id: string; dependsOnCr: string }[];
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
});

interface CrItem { id: string; label: string; crManager?: string; crDescription?: string; }
interface User { id: string; fullName: string; }

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
  fontSize: '12px', color: C.textSecondary, display: 'block',
  marginBottom: '4px', fontWeight: '600',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px', border: `1px solid ${C.border}`,
  borderRadius: RADIUS.md, fontSize: '13px', boxSizing: 'border-box',
  fontFamily: FONT,
};

export const TeamLeadProposalView: React.FC<Props> = ({ token, versionId, versionName, teamIdOverride, teamNameOverride, reviewMeetingTime, isManager }) => {
  const [proposals, setProposals]       = useState<Proposal[]>([]);
  const [crItems, setCrItems]           = useState<CrItem[]>([]);
  const [users, setUsers]               = useState<User[]>([]);
  const [myTeamName, setMyTeamName]     = useState('');
  const [myTeamId, setMyTeamId]         = useState('');
  const [teams, setTeams]               = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);

  // Submission state
  const [submissionDone, setSubmissionDone] = useState(false);
  const [submitting, setSubmitting]         = useState(false);
  const [submitError, setSubmitError]       = useState<string | null>(null);
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
  const [selectedCr, setSelectedCr]   = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<'plan' | 'tasks'>('plan');

  // Extract-tasks modal
  interface ExtractItem { text: string; checked: boolean; phase: number; estimatedMins: string; duplicateId?: string; }
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
        return { text: t, checked: true, phase: defaultPhase, estimatedMins: '', duplicateId: dup?.id };
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
          }, { headers });
        } else {
          await axios.post(`${API}/task-proposals/version/${versionId}`, {
            title: item.text.trim(), phase: item.phase,
            estimatedMins: item.estimatedMins ? parseInt(item.estimatedMins) : undefined,
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
        forms[p.crNumber] = {
          crType: p.crType ?? 'פיתוח חדש',
          riskLevel: p.riskLevel ?? '',
          systems: p.systems ?? [],
          workPlan: p.workPlan ?? '',
          scripts: p.scripts ?? '',
          runTimes: p.runTimes ?? '',
          rollbackPlan: p.rollbackPlan ?? '',
          gradualRollout: p.gradualRollout,
          gradualDetails: p.gradualDetails ?? '',
          nightTestingNotes: p.nightTestingNotes ?? '',
          morningMonitoring: p.morningMonitoring ?? '',
          dependsOnCrs: p.crDeps.map(d => d.dependsOnCr),
        };
      }
      setCrPlans(map);
      setCrPlanForms(prev => ({ ...forms, ...prev }));
    } catch { /* silent */ }
  }, [versionId]); // eslint-disable-line

  useEffect(() => {
    axios.get(`${API}/users`, { headers })
      .then(r => setUsers(r.data.filter((u: any) => u.active)
        .sort((a: any, b: any) => a.fullName.localeCompare(b.fullName, 'he'))))
      .catch(() => {});
    axios.get(`${API}/teams`, { headers }).then(r => setTeams(r.data)).catch(() => {});
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
    setCrSearch(crNumber || '');
    setError(null);
    setOpenFormForCr(isFree ? FREE_KEY : (crNumber || FREE_KEY));
  };

  const openEdit = (p: Proposal) => {
    setEditId(p.id);
    setForm({
      title: p.title, app: p.app ?? '', actionType: p.actionType ?? '',
      estimatedMins: p.estimatedMins?.toString() ?? '',
      crNumber: p.crNumber ?? '', crLabel: p.crLabel ?? '', isFree: !p.crNumber,
      notes: p.notes ?? '', assignedUserName: p.assignedUserName ?? '', phase: p.phase,
      subPhaseId: '',
      responsibleTeamId: (p as any).responsibleTeamId ?? '',
    });
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
      // Create CrPlan entry for each CR found (skip existing ones)
      await Promise.all(crs.map(c =>
        axios.post(`${API}/cr-plans/version/${versionId}`, {
          crNumber: c.crNumber,
          crLabel: c.crLabel,
          crManager: c.crManager || undefined,
          crDescription: c.crDescription || undefined,
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
        await axios.delete(`${API}/task-proposals/version/${versionId}/cr/${crNumber}`, { headers });
        const plan = crPlans[crNumber];
        if (plan) await axios.delete(`${API}/cr-plans/${plan.id}`, { headers });
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

  const saveCrPlan = async (crNumber: string) => {
    const f = crPlanForms[crNumber];
    if (!f) return;
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
        ...(teamIdOverride ? { teamIdOverride } : {}),
      }, { headers });
      setCrPlans(prev => ({ ...prev, [crNumber]: res.data }));
    } catch { /* silent */ }
    finally { setSavingPlan(null); }
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
        ...(teamIdOverride ? { teamIdOverride } : {}),
      }, { headers });
      setCrPlans(prev => ({ ...prev, [crNumber]: { ...(prev[crNumber] || res.data), ...res.data } }));
    } catch { /* silent */ }
    finally { setTogglingNotNeeded(prev => { const next = new Set(prev); next.delete(crNumber); return next; }); }
  };

  const submitDone = async () => {
    if (!myTeamId) return;

    // Validate 1: every CR must be either "not needed" or have at least one READY proposal
    const draftCrs: string[] = [];
    for (const [crNumber, crProposals] of crGroups) {
      if (crPlans[crNumber]?.notNeededForPlan) continue;
      const hasReady = crProposals.some(p => p.status === 'READY' || p.usedInTaskId);
      if (!hasReady) draftCrs.push(crNumber);
    }
    if (draftCrs.length > 0) {
      setSubmitError(`לא ניתן להגיש — יש CR-ים שלא טופלו: ${draftCrs.join(', ')}. יש לסמן לפחות צעד אחד כ"מוכן", או לסמן את ה-CR כ"לא נדרש לתוכנית".`);
      return;
    }

    // Validate 2: no proposal (including free/no-CR) may remain in DRAFT
    const draftFree = freeGroup.filter(p => p.status !== 'READY' && !p.usedInTaskId);
    const draftInCrs = crGroups.flatMap(([, ps]) => ps.filter(p => p.status !== 'READY' && !p.usedInTaskId));
    const totalDraft = draftFree.length + draftInCrs.length;
    if (totalDraft > 0) {
      setSubmitError(`לא ניתן להגיש — ${totalDraft} משימ${totalDraft === 1 ? 'ה' : 'ות'} עדיין בטיוטא. סמן אותן כ"מוכן" לפני ההגשה.`);
      return;
    }

    setSubmitting(true); setSubmitError(null);
    try {
      await axios.post(`${API}/versions/${versionId}/submit/${myTeamId}`, {}, { headers });
      setSubmissionDone(true);
    } catch (e: any) {
      setSubmitError(e.response?.data?.message ?? 'שגיאה בהגשה');
    } finally { setSubmitting(false); }
  };

  const totalReady = proposals.filter(p => p.status === 'READY').length;
  const draftCount = proposals.filter(p => p.status !== 'READY' && !p.usedInTaskId).length;
  const allCrsHandled = crGroups.length > 0 && crGroups.every(([cr, ps]) =>
    crPlans[cr]?.notNeededForPlan ||
    ps.some(p => p.status === 'READY' || p.usedInTaskId)
  );
  const canSubmit = allCrsHandled && draftCount === 0;

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
          <span style={{ fontSize: '15px', fontWeight: '700', color: C.textPrimary }}>{editId ? 'עריכת משימה' : 'פרטי משימה'}</span>
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
              style={{ ...inputStyle, borderColor: !form.title.trim() ? C.danger : C.border, fontSize: '14px', padding: '10px 12px' }}
              placeholder="תאר את הצעד שיש לבצע..."
            />
          </div>

          {/* CR מקושר */}
          <div>
            <label style={labelStyle}>פיתוחים בגרסה (CR)</label>
            {form.isFree ? (
              <div style={{ padding: '10px 12px', background: C.bgNested, borderRadius: RADIUS.md, fontSize: '13px', color: C.textSecondary, border: `1px solid ${C.border}` }}>
                ללא CR — משימה תשתיתית / כללית
              </div>
            ) : form.crNumber && form.crLabel ? (
              <div style={{ padding: '10px 12px', background: C.infoBg, border: `1px solid ${C.info}40`, borderRadius: RADIUS.md, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ background: C.textPrimary, color: C.textInverse, padding: '2px 8px', borderRadius: RADIUS.sm, fontSize: '12px', fontWeight: '700', fontFamily: 'monospace', flexShrink: 0 }}>
                  {form.crNumber}
                </span>
                <span style={{ fontSize: '13px', color: C.info, fontWeight: '600' }}>{form.crLabel.replace(`${form.crNumber} - `, '')}</span>
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
                  <div style={{ fontSize: '12px', color: C.success, marginTop: '4px' }}>✓ {form.crLabel}</div>
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
                <div style={{ padding: '10px 12px', background: C.bgNested, borderRadius: RADIUS.md, fontSize: '12px', color: C.textMuted, border: `1px solid ${C.border}` }}>אין תת-שלבים</div>
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
                value={form.responsibleTeamId || myTeamId}
                onChange={e => setForm(f => ({ ...f, responsibleTeamId: e.target.value, assignedUserName: '' }))}
                style={{ ...inputStyle, padding: '10px 12px' }}
              >
                {allowedTeams.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {(form.phase === 2 || form.phase === 3) && (
                <div style={{ fontSize: '11px', color: C.textMuted, marginTop: '3px' }}>
                  ניתן לשייך לצוות QA לביצוע בדיקות
                </div>
              )}
              {form.phase === 4 && (
                <div style={{ fontSize: '11px', color: C.textMuted, marginTop: '3px' }}>
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

          {error && <div style={{ color: C.danger, fontSize: '13px', background: C.dangerBg, padding: '8px 12px', borderRadius: RADIUS.md }}>{error}</div>}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: '10px', justifyContent: 'flex-start', flexShrink: 0, background: C.bgCard }}>
          <button onClick={save} disabled={saving}
            style={{ padding: '9px 24px', background: saving ? C.textDisabled : C.brand, color: C.textInverse, border: 'none', borderRadius: RADIUS.lg, cursor: saving ? 'not-allowed' : 'pointer', fontWeight: '700', fontSize: '13px' }}>
            {saving ? 'שומר...' : editId ? 'שמור שינויים' : 'הוסף משימה'}
          </button>
          <button onClick={cancelForm}
            style={{ padding: '9px 20px', background: C.bgCard, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
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
          padding: '2px 10px', borderRadius: RADIUS.full, fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {(phaseLabels[p.phase] || PHASE_LABELS[p.phase])?.split(' — ')[1] || `שלב ${p.phase}`}
        </span>
        <span style={{ flex: 1, fontSize: '13px', fontWeight: '600', color: C.textPrimary }}>{p.title}</span>
        {p.usedInTaskId ? (
          <span style={{ fontSize: '11px', color: C.success, fontWeight: '700', whiteSpace: 'nowrap', flexShrink: 0 }}>✅ בתוכנית</span>
        ) : locked ? (
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0, alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: p.status === 'READY' ? C.success : C.warning, fontWeight: '700', whiteSpace: 'nowrap' }}>
              {p.status === 'READY' ? '✓ מוכן' : 'טיוטא'}
            </span>
            <button onClick={() => openEdit(p)}
              style={{ padding: '2px 8px', background: C.warningBg, color: C.warning, border: `1px solid ${C.warning}50`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>
              ערוך
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            <button onClick={() => toggleStatus(p)} style={{
              padding: '2px 10px', border: 'none', borderRadius: RADIUS.full, cursor: 'pointer',
              fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap',
              background: p.status === 'READY' ? C.success : C.warning, color: C.textInverse,
            }}>
              {p.status === 'READY' ? '✓ מוכן' : 'טיוטא'}
            </button>
            <button onClick={() => openEdit(p)}
              style={{ padding: '2px 8px', background: C.warningBg, color: C.warning, border: `1px solid ${C.warning}50`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>
              ערוך
            </button>
            <button onClick={() => remove(p)}
              style={{ padding: '2px 8px', background: C.dangerBg, color: C.danger, border: `1px solid ${C.danger}50`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>
              מחק
            </button>
          </div>
        )}
      </div>
      <div style={{
        display: 'flex', gap: '16px', flexWrap: 'wrap',
        padding: '5px 12px 8px', borderTop: `1px solid ${C.border}`,
        background: p.usedInTaskId ? C.successBg : C.bgCard, fontSize: '12px', color: C.textSecondary,
      }}>
        <span><span style={{ color: C.textMuted }}>מערכת: </span>{p.app || <span style={{ color: C.textDisabled }}>לא הוזן</span>}</span>
        {p.actionType && <span style={{ background: C.infoBg, color: C.info, padding: '1px 7px', borderRadius: RADIUS.sm, fontSize: '11px', fontWeight: '600' }}>{p.actionType}</span>}
        <span><span style={{ color: C.textMuted }}>משך: </span>{p.estimatedMins ? `${p.estimatedMins} דק'` : <span style={{ color: C.textDisabled }}>לא הוזן</span>}</span>
        <span><span style={{ color: C.textMuted }}>עובד אחראי: </span>{p.assignedUserName || <span style={{ color: C.textDisabled }}>לא הוזן</span>}</span>
        {p.notes && <span style={{ color: C.textSecondary, fontStyle: 'italic' }}>📝 {p.notes}</span>}
      </div>
    </div>
  );

  // ── CrPlan form content ──────────────────────────────────────────────────────
  const renderCrPlanPanel = (crNumber: string) => {
    const f        = crPlanForms[crNumber] || emptyCrPlanForm();
    const otherCrs = allCrNumbers.filter(c => c !== crNumber);
    const crItem   = crItems.find(c => c.id === crNumber);
    const crManager     = crItem?.crManager     || crPlans[crNumber]?.crManager     || '';
    const crDescription = crItem?.crDescription || crPlans[crNumber]?.crDescription || '';
    const crTitle = crItem?.label
      ? crItem.label.replace(/^\S+\s*-\s*/, '')
      : crPlans[crNumber]?.crLabel?.replace(/^\S+\s*-\s*/, '') || crNumber;

    const sect: React.CSSProperties = { height: '1px', background: C.border, margin: '4px 0' };
    const fLbl: React.CSSProperties = { fontSize: '10px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '3px' };
    const ta:   React.CSSProperties = { ...inputStyle, minHeight: '48px', resize: 'vertical', padding: '7px 10px', fontSize: '12px' };
    const sel:  React.CSSProperties = { ...inputStyle, padding: '7px 10px', fontSize: '12px' };

    const rowHdr = (lbl: string, req: boolean, onExtract: () => void) => (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
        <label style={{ ...fLbl, marginBottom: 0 }}>{lbl}{req && <span style={{ color: C.danger }}> *</span>}</label>
        <button onClick={onExtract} style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', background: C.infoBg, color: C.info, border: `1px solid ${C.info}30`, borderRadius: '4px', cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
          ⚡ הפק משימות
        </button>
      </div>
    );

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* hidden preserved fields */}
        <div style={{ display: 'none' }}>
          <textarea value={f.scripts}  onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, scripts:  e.target.value } }))} />
          <textarea value={f.runTimes} onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, runTimes: e.target.value } }))} />
        </div>

        {/* META STRIP — read-only */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '7px 12px', fontSize: '11px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: '10px', fontWeight: 700, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>פרטי CR:</span>
            <span style={{ color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={crDescription || crTitle}>{crDescription || crTitle || '—'}</span>
          </div>
          {crManager && <>
            <div style={{ width: '1px', height: '16px', background: C.border, flexShrink: 0 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '.04em' }}>מנהל:</span>
              <span style={{ color: C.textSecondary, fontWeight: 600 }}>{crManager}</span>
            </div>
          </>}
          {(() => {
            const teams = Array.from(new Set(
              f.systems.flatMap(s => APP_TO_TEAMS[s] || [])
            ));
            if (!teams.length) return null;
            return <>
              <div style={{ width: '1px', height: '16px', background: C.border, flexShrink: 0 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0, maxWidth: '240px', minWidth: 0 }}>
                <span style={{ fontSize: '10px', fontWeight: 700, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>צוותים:</span>
                <span style={{ color: C.textSecondary, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={teams.join(', ')}>
                  {teams.join(', ')}
                </span>
              </div>
            </>;
          })()}
        </div>

        {/* ROW 1: סוג CR | רמת סיכון | מערכות מעורבות — 3 columns */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: '10px' }}>
          <div>
            <label style={fLbl}>סוג CR <span style={{ color: C.danger }}>*</span></label>
            <select value={f.crType}
              onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, crType: e.target.value } }))}
              style={sel}>
              <option value="">-- בחר --</option>
              {CR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={fLbl}>רמת סיכון <span style={{ color: C.danger }}>*</span></label>
            <select value={f.riskLevel}
              onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, riskLevel: e.target.value } }))}
              style={{ ...sel, background: f.riskLevel ? RISK_COLORS[f.riskLevel]?.bg : undefined, color: f.riskLevel ? RISK_COLORS[f.riskLevel]?.color : undefined, fontWeight: f.riskLevel ? '600' : 'normal' }}>
              <option value="">-- בחר --</option>
              {RISK_LEVELS.map(r => <option key={r} value={r}>{RISK_LABELS[r]}</option>)}
            </select>
          </div>
          <div>
            <label style={fLbl}>מערכות מעורבות</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px', padding: '4px 7px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, background: C.bgCard, minHeight: '32px' }}>
              {f.systems.map(s => (
                <span key={s} style={{ background: C.infoBg, color: C.info, padding: '2px 7px', borderRadius: RADIUS.sm, fontSize: '11px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px', border: `1px solid ${C.info}25` }}>
                  {s}
                  <button onClick={() => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, systems: f.systems.filter(x => x !== s) } }))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.info, padding: 0, fontSize: '13px', lineHeight: 1, opacity: 0.6, flexShrink: 0 }}>×</button>
                </span>
              ))}
              <select onChange={e => {
                if (e.target.value && !f.systems.includes(e.target.value))
                  setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, systems: [...f.systems, e.target.value] } }));
                e.target.value = '';
              }} style={{ border: 'none', outline: 'none', fontSize: '11px', color: C.textMuted, background: 'transparent', cursor: 'pointer', direction: 'rtl' }} defaultValue="">
                <option value="" disabled>+ הוסף מערכת</option>
                {teamAppList.filter(a => !f.systems.includes(a)).map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div style={sect} />

        {/* תוכנית עבודה */}
        <div>
          {rowHdr('תוכנית עבודה', false, () => openExtract(crNumber, f.workPlan, 'תוכנית עבודה', 3))}
          <textarea value={f.workPlan}
            onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, workPlan: e.target.value } }))}
            style={ta} placeholder="תאר את שלבי הביצוע של ה-CR..." />
        </div>

        {/* Rollback */}
        <div>
          {rowHdr('תוכנית Rollback', false, () => openExtract(crNumber, f.rollbackPlan, 'פעולות Rollback', 3))}
          <textarea value={f.rollbackPlan}
            onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, rollbackPlan: e.target.value } }))}
            style={ta} placeholder="תהליך ה-Rollback במקרה של כשל..." />
        </div>

        {/* Gradual rollout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 11px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: '6px' }}>
          <input type="checkbox" checked={f.gradualRollout} id={`grad-${crNumber}`}
            onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, gradualRollout: e.target.checked } }))}
            style={{ width: '15px', height: '15px', cursor: 'pointer' }} />
          <label htmlFor={`grad-${crNumber}`} style={{ fontSize: '12px', color: C.textSecondary, cursor: 'pointer' }}>פריסה הדרגתית (Gradual Rollout)</label>
        </div>
        {f.gradualRollout && (
          <div>
            {rowHdr('פרטי עלייה מדורגת', false, () => openExtract(crNumber, f.gradualDetails, 'עלייה מדורגת', 3))}
            <input value={f.gradualDetails}
              onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, gradualDetails: e.target.value } }))}
              style={{ ...inputStyle, padding: '7px 10px', fontSize: '12px' }}
              placeholder="תאר שלבי העלייה..." />
          </div>
        )}

        <div style={sect} />

        {/* בדיקות לילה */}
        <div>
          {rowHdr('בדיקות לילה (שלב 2/3)', true, () => openExtract(crNumber, f.nightTestingNotes, 'בדיקות לילה', 2))}
          <textarea value={f.nightTestingNotes}
            onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, nightTestingNotes: e.target.value } }))}
            style={{ ...ta, borderColor: !f.nightTestingNotes ? `${C.danger}50` : C.border }}
            placeholder="מה כדאי לבדוק בלילה..." />
        </div>

        {/* ניטור בוקר */}
        <div>
          {rowHdr('ניטור בוקר אחרי (שלב 4)', true, () => openExtract(crNumber, f.morningMonitoring, 'בדיקות בוקר אחרי', 4))}
          <textarea value={f.morningMonitoring}
            onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, morningMonitoring: e.target.value } }))}
            style={{ ...ta, borderColor: !f.morningMonitoring ? `${C.danger}50` : C.border }}
            placeholder="מה לבדוק בבוקר שלמחרת..." />
        </div>

        {/* תלויות CR */}
        {otherCrs.length > 0 && (
          <>
            <div style={sect} />
            <div>
              <label style={fLbl}>תלויות ב-CR-ים אחרים</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {otherCrs.map(cr => (
                  <label key={cr} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer', background: C.bgCard, padding: '3px 10px', borderRadius: RADIUS.md, border: `1px solid ${f.dependsOnCrs.includes(cr) ? C.statusWaiting : C.border}`, color: f.dependsOnCrs.includes(cr) ? C.statusWaiting : C.textSecondary, fontWeight: f.dependsOnCrs.includes(cr) ? '600' : 'normal' }}>
                    <input type="checkbox" checked={f.dependsOnCrs.includes(cr)}
                      onChange={e => {
                        const next = e.target.checked ? [...f.dependsOnCrs, cr] : f.dependsOnCrs.filter(x => x !== cr);
                        setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, dependsOnCrs: next } }));
                      }} style={{ margin: 0 }} />
                    {cr}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  // ── Left panel: single CR list item ─────────────────────────────────────────
  const renderListItem = (crNumber: string, crProposals: Proposal[]) => {
    const isNotNeeded = crPlans[crNumber]?.notNeededForPlan;
    const readyCount  = crProposals.filter(p => p.status === 'READY' || p.usedInTaskId).length;
    const isSelected  = selectedCr === crNumber;
    const label       = getCrLabel(crNumber);
    const hasDraft    = crProposals.some(p => p.status === 'DRAFT' && !p.usedInTaskId);

    const dotBg = isNotNeeded ? C.textDisabled
      : crProposals.length > 0 && readyCount === crProposals.length ? C.success
      : hasDraft || crProposals.length > 0 ? C.warning
      : C.danger;

    const subText = isNotNeeded ? '— לא נדרש'
      : crProposals.length === 0 ? '◯ לא טופל'
      : readyCount === crProposals.length ? `✓ ${readyCount} מוכן`
      : `⚠ ${readyCount}/${crProposals.length} מוכן`;

    const subColor = isNotNeeded ? C.textDisabled
      : crProposals.length === 0 ? C.danger
      : readyCount === crProposals.length ? C.success
      : C.warning;

    return (
      <div key={crNumber}
        onClick={() => { setSelectedCr(crNumber); setSelectedTab('plan'); }}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '9px 14px',
          cursor: 'pointer', borderBottom: `1px solid ${C.bgNested}`,
          borderRight: `3px solid ${isSelected ? C.brand : 'transparent'}`,
          background: isSelected ? C.infoBg : 'transparent',
          opacity: isNotNeeded ? 0.5 : 1,
        }}>
        <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: dotBg, flexShrink: 0, marginTop: '5px' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: C.info, fontFamily: 'monospace' }}>{crNumber}</div>
          <div style={{ fontSize: '11px', color: isSelected ? C.textPrimary : C.textSecondary, lineHeight: 1.35, marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label || crNumber}
          </div>
          <div style={{ fontSize: '10px', marginTop: '2px', color: subColor }}>{subText}</div>
        </div>
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
    const hasSaved     = !!crPlans[crNumber];
    const f            = crPlanForms[crNumber] || emptyCrPlanForm();

    const draftCount = crProposals.filter(p => p.status === 'DRAFT' && !p.usedInTaskId).length;

    // Readiness calculation — plan form fields only
    const issues: string[] = [];
    if (!f.crType)            issues.push('סוג CR');
    if (!f.riskLevel)         issues.push('רמת סיכון');
    if (!f.nightTestingNotes) issues.push('בדיקות לילה');
    if (!f.morningMonitoring) issues.push('ניטור בוקר');
    if (f.riskLevel === 'HIGH' && !f.rollbackPlan) issues.push('Rollback');
    const planPct   = Math.round((1 - issues.length / 5) * 100);
    // Overall readiness = plan form complete AND all tasks are READY
    const planDone  = issues.length === 0;
    const tasksDone = draftCount === 0;
    const pctReady  = planDone && tasksDone ? 100 : planPct;
    const readColor = planDone && tasksDone ? C.success : planPct >= 60 ? C.warning : C.danger;

    // Next CR navigation
    const activeCrs = crGroups.filter(([cr]) => !crPlans[cr]?.notNeededForPlan).map(([cr]) => cr);
    const curIdx    = activeCrs.indexOf(crNumber);
    const nextCrNum = curIdx >= 0 && curIdx < activeCrs.length - 1 ? activeCrs[curIdx + 1] : null;

    const tabBtn = (tab: 'plan' | 'tasks', tabLabel: string, badge?: React.ReactNode) => (
      <button onClick={() => setSelectedTab(tab)} style={{
        fontSize: '12px', fontWeight: 600, padding: '8px 12px', cursor: 'pointer',
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
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: C.info, background: C.infoBg, padding: '3px 9px', borderRadius: RADIUS.sm, fontSize: '12px', flexShrink: 0 }}>{crNumber}</span>
          <span style={{ flex: 1, fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.textPrimary }}>{label || crNumber}</span>
          {!isNotNeeded && (
            planDone && !tasksDone ? (
              /* Plan form complete but tasks still in draft */
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: '9999px', flexShrink: 0, color: C.warning, background: `${C.warning}18`, border: `1px solid ${C.warning}35` }}
                title={`תוכנית CR מלאה, אך ${draftCount} משימ${draftCount === 1 ? 'ה' : 'ות'} עדיין בטיוטא`}>
                ✓ תוכנית · {draftCount} משימה בטיוטא
              </span>
            ) : (
              <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: '9999px', flexShrink: 0, color: readColor, background: `${readColor}18`, border: `1px solid ${readColor}35` }}>
                {pctReady}% מוכן
              </span>
            )
          )}
          {!locked && (
            <button
              onClick={() => toggleNotNeeded(crNumber)}
              disabled={isTogglingNN}
              title={isNotNeeded ? 'לחץ להחזיר CR זה לתהליך הרגיל' : 'לחץ לסמן CR זה כלא נדרש לתוכנית הלילה'}
              style={{
                fontSize: '11px', fontWeight: 600, flexShrink: 0, fontFamily: FONT,
                padding: '3px 9px', borderRadius: '6px',
                cursor: isTogglingNN ? 'not-allowed' : 'pointer',
                color:      isNotNeeded ? C.warning      : C.textSecondary,
                background: isNotNeeded ? C.warningBg    : C.bgNested,
                border:     isNotNeeded ? `1px solid ${C.warning}50` : `1px solid ${C.border}`,
              }}>
              {isTogglingNN ? '...' : isNotNeeded ? '↩ החזר לתהליך' : 'סמן כ"לא נדרש"'}
            </button>
          )}
          {!locked && (
            <button onClick={() => deleteCrGroup(crNumber)}
              style={{ fontSize: '11px', color: C.danger, background: C.dangerBg, border: `1px solid ${C.danger}40`, borderRadius: '6px', padding: '3px 9px', cursor: 'pointer', flexShrink: 0, fontFamily: FONT }}>
              🗑
            </button>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', background: C.bgCard, borderBottom: `1px solid ${C.border}`, padding: '0 18px', flexShrink: 0 }}>
          {tabBtn('plan', 'תוכנית CR')}
          {tabBtn('tasks', 'משימות נגזרות',
            draftCount > 0
              ? <span style={{ background: `${C.warning}20`, color: C.warning, border: `1px solid ${C.warning}40`, fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '9999px' }}>{draftCount} טיוטא</span>
              : crProposals.length > 0
              ? <span style={{ background: `${C.success}15`, color: C.success, border: `1px solid ${C.success}30`, fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '9999px' }}>{crProposals.length}</span>
              : undefined
          )}
        </div>

        {/* Tab content */}
        {selectedTab === 'plan' ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
            {isNotNeeded ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '48px 0', textAlign: 'center' }}>
                <div style={{ fontSize: '36px' }}>⏭</div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: C.textSecondary }}>CR זה מסומן כ"לא נדרש לתוכנית"</div>
                <div style={{ fontSize: '12px', color: C.textMuted, maxWidth: '280px' }}>הוא לא ישפיע על השלמת ההגשה. אם גילית שהוא כן נדרש — לחץ:</div>
                {!locked && (
                  <button onClick={() => toggleNotNeeded(crNumber)} disabled={isTogglingNN}
                    style={{ fontFamily: FONT, fontSize: '13px', fontWeight: 600, padding: '9px 22px', borderRadius: '8px', background: C.warning, color: C.textInverse, border: 'none', cursor: isTogglingNN ? 'not-allowed' : 'pointer' }}>
                    {isTogglingNN ? '...' : '↩ החזר CR לתהליך הרגיל'}
                  </button>
                )}
              </div>
            ) : (
              <>
                {issues.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: `${C.warning}18`, border: `1px solid ${C.warning}35`, borderRadius: '7px', padding: '7px 11px', fontSize: '11px', color: C.warning, marginBottom: '12px' }}>
                    ⚠ חסר: <strong>{issues.join(' · ')}</strong>
                  </div>
                )}
                {renderCrPlanPanel(crNumber)}
              </>
            )}
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
            {crProposals.length === 0 && (
              <div style={{ padding: '40px 0', textAlign: 'center', color: C.textMuted, fontSize: '13px' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>📋</div>
                <div>אין משימות — הפק מהתוכנית או הוסף ידנית</div>
              </div>
            )}
            {crProposals.map(renderRow)}
            {!locked && !isNotNeeded && openFormForCr !== crNumber && (
              <button onClick={() => openAdd(crNumber, label)}
                style={{ marginTop: '10px', width: '100%', padding: '9px', background: C.statusOpen, color: C.textInverse, border: 'none', borderRadius: RADIUS.lg, cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                + הוסף משימה לביצוע
              </button>
            )}
          </div>
        )}

        {/* Footer — save + next navigation */}
        {selectedTab === 'plan' && !isNotNeeded && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '10px 18px', background: C.bgCard, borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
            <button onClick={() => saveCrPlan(crNumber)} disabled={isSavingPln}
              style={{ fontFamily: FONT, fontSize: '13px', fontWeight: 600, padding: '7px 18px', borderRadius: '7px', background: isSavingPln ? C.textDisabled : C.info, color: C.textInverse, border: 'none', cursor: isSavingPln ? 'not-allowed' : 'pointer' }}>
              {isSavingPln ? 'שומר...' : 'שמור'}
            </button>
            {nextCrNum && (
              <button onClick={() => { setSelectedCr(nextCrNum); setSelectedTab('plan'); }}
                style={{ fontFamily: FONT, fontSize: '12px', fontWeight: 600, padding: '7px 14px', borderRadius: '7px', background: C.bgCard, color: C.info, border: `1px solid ${C.info}40`, cursor: 'pointer' }}>
                הבא: {nextCrNum} ←
              </button>
            )}
            {hasSaved && <span style={{ fontSize: '11px', color: C.success }}>✓ נשמר</span>}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: '11px', color: C.textDisabled }}>שמירה אוטומטית פעילה</span>
          </div>
        )}
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ direction: 'rtl', fontFamily: FONT, color: C.textPrimary }}>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />

      {/* Extract-tasks modal */}
      {extractModal && (
        <div style={{ position: 'fixed', inset: 0, background: C.bgOverlay, zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl' }}>
          <div style={{ background: C.bgCard, borderRadius: RADIUS['3xl'], padding: '24px 28px', maxWidth: '560px', width: '95vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: SHADOW.xl }}>
            <div style={{ fontWeight: '700', fontSize: '16px', color: C.textPrimary, marginBottom: '4px' }}>
              ⚡ הפק משימות מ{extractModal.sourceLabel}
            </div>
            <div style={{ fontSize: '12px', color: C.textMuted, marginBottom: '16px' }}>
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
                      style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '13px', color: C.textPrimary, outline: 'none', fontFamily: FONT, boxSizing: 'border-box' }}
                      disabled={!item.checked}
                    />
                    {item.duplicateId && (
                      <span style={{ fontSize: '10px', color: C.warning, fontWeight: '600' }}>⚠ כבר קיימת — תישאל אם להחליף</span>
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
                    style={{ width: '54px', fontSize: '11px', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: '2px 4px', textAlign: 'center', flexShrink: 0 }}
                  />
                  <select
                    value={item.phase}
                    onChange={e => setExtractModal(m => m ? {
                      ...m,
                      items: m.items.map((it, j) => j === i ? { ...it, phase: parseInt(e.target.value) } : it),
                    } : null)}
                    disabled={!item.checked}
                    style={{ fontSize: '11px', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: '2px 4px', background: C.bgCard, color: C.textSecondary, flexShrink: 0 }}
                  >
                    {(Object.keys(phaseLabels).length > 0
                      ? Object.keys(phaseLabels).map(Number).sort((a, b) => a - b)
                      : [1, 2, 3, 4]
                    ).map(ph => (
                      <option key={ph} value={ph}>{(phaseLabels[ph] || PHASE_LABELS[ph])?.split(' — ')[1] || `שלב ${ph}`}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Select all / none */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <button onClick={() => setExtractModal(m => m ? { ...m, items: m.items.map(it => ({ ...it, checked: true })) } : null)}
                style={{ fontSize: '12px', padding: '4px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, background: C.bgCard, cursor: 'pointer', color: C.textSecondary }}>
                בחר הכל
              </button>
              <button onClick={() => setExtractModal(m => m ? { ...m, items: m.items.map(it => ({ ...it, checked: false })) } : null)}
                style={{ fontSize: '12px', padding: '4px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, background: C.bgCard, cursor: 'pointer', color: C.textSecondary }}>
                בטל הכל
              </button>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setExtractModal(null)}
                style={{ padding: '8px 18px', border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, background: C.bgCard, cursor: 'pointer', fontSize: '13px', color: C.textSecondary }}>
                ביטול
              </button>
              <button
                onClick={createExtracted}
                disabled={extracting || extractModal.items.filter(i => i.checked).length === 0}
                style={{
                  padding: '8px 22px', border: 'none', borderRadius: RADIUS.lg,
                  background: extractModal.items.filter(i => i.checked).length === 0 ? C.bgNested : C.brand,
                  color: extractModal.items.filter(i => i.checked).length === 0 ? C.textDisabled : C.textInverse,
                  cursor: extractModal.items.filter(i => i.checked).length === 0 ? 'default' : 'pointer',
                  fontSize: '13px', fontWeight: '700',
                }}
              >
                {extracting ? 'יוצר...' : `צור ${extractModal.items.filter(i => i.checked).length} משימות`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${C.textPrimary} 0%, ${C.statusOpen} 100%)`,
        borderRadius: RADIUS['2xl'], padding: '16px 24px', marginBottom: '20px', color: C.textInverse,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: SHADOW.md,
      }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 'bold' }}>הגשת משימות</div>
          <div style={{ fontSize: '13px', opacity: 0.8, marginTop: '2px' }}>
            {versionName}{myTeamName ? ` · צוות ${myTeamName}` : ''}
          </div>
          {reviewMeetingTime && (
            <div style={{ fontSize: '12px', marginTop: '4px', background: 'rgba(88,166,255,0.2)', padding: '3px 10px', borderRadius: '8px', display: 'inline-block' }}>
              🗓 ישיבת מעבר: {new Date(reviewMeetingTime).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {proposals.length > 0 && (
            <span style={{ fontSize: '13px', opacity: 0.85 }}>
              {totalReady}/{proposals.length} מוכן
            </span>
          )}
          {!locked && (
            <button
              onClick={() => syncCrItems(false)}
              disabled={syncLoading}
              style={{
                padding: '8px 18px', background: syncLoading ? 'rgba(255,255,255,0.1)' : 'rgba(46,204,113,0.35)',
                color: 'white', border: '1px solid rgba(46,204,113,0.6)', borderRadius: '8px',
                cursor: syncLoading ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap',
              }}
            >
              {syncLoading ? '⏳ מסנכרן...' : '🔄 סנכרן רשימת פיתוחים'}
            </button>
          )}
          {!locked && (
            <button onClick={() => openAdd()} style={{
              padding: '8px 18px', background: 'rgba(255,255,255,0.15)', color: C.textInverse,
              border: '1px solid rgba(255,255,255,0.35)', borderRadius: RADIUS.lg,
              cursor: 'pointer', fontWeight: '600', fontSize: '13px',
            }}>
              + הוסף משימה
            </button>
          )}
          {locked ? (
            <>
              <span style={{ padding: '8px 18px', background: C.success, color: C.textInverse, borderRadius: RADIUS.lg, fontWeight: '700', fontSize: '13px' }}>
                הוגש ✓
              </span>
              {isManager && (
                <button
                  onClick={() => setManagerUnlocked(true)}
                  style={{ padding: '8px 14px', background: C.warningBg, color: C.warning, border: `1px solid ${C.warning}80`, borderRadius: RADIUS.lg, cursor: 'pointer', fontWeight: '700', fontSize: '12px', whiteSpace: 'nowrap' }}
                >
                  ✏️ עדכן כמנהל
                </button>
              )}
            </>
          ) : managerUnlocked ? (
            <>
              <span style={{ padding: '8px 14px', background: C.warningBg, color: C.warning, border: `1px solid ${C.warning}80`, borderRadius: RADIUS.lg, fontWeight: '700', fontSize: '12px', whiteSpace: 'nowrap' }}>
                ✏️ עריכת מנהל
              </span>
              <button
                onClick={() => setManagerUnlocked(false)}
                style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.15)', color: C.textInverse, border: '1px solid rgba(255,255,255,0.3)', borderRadius: RADIUS.lg, cursor: 'pointer', fontWeight: '700', fontSize: '12px', whiteSpace: 'nowrap' }}
              >
                ✓ סיים עריכה
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
              <button
                onClick={submitDone}
                disabled={submitting || !canSubmit}
                title={draftCount > 0 ? `סמן את כל המשימות כ"מוכן" לפני ההגשה (${draftCount} בטיוטא)` : ''}
                style={{
                  padding: '8px 18px',
                  background: submitting ? C.textDisabled : (!canSubmit ? C.textMuted : C.brand),
                  color: C.textInverse, border: 'none', borderRadius: RADIUS.lg,
                  cursor: (submitting || !canSubmit) ? 'not-allowed' : 'pointer',
                  fontWeight: '700', fontSize: '13px',
                  opacity: !canSubmit ? 0.75 : 1,
                }}
              >
                {submitting ? '...' : 'סיימתי הגשה'}
              </button>
              {draftCount > 0 && proposals.length > 0 && (
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap' }}>
                  ⚠ {draftCount} משימות עדיין בטיוטא
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sync error */}
      {syncError && (
        <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}`, borderRadius: RADIUS.lg, padding: '10px 16px', marginBottom: '12px', fontSize: '13px', color: C.danger, display: 'flex', alignItems: 'center', gap: '8px' }}>
          ⚠️ {syncError}
          <button onClick={() => setSyncError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.danger, fontWeight: '700', marginRight: 'auto' }}>×</button>
        </div>
      )}

      {/* Submission error */}
      {submitError && (
        <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}`, borderRadius: RADIUS.lg, padding: '10px 16px', marginBottom: '12px', fontSize: '13px', color: C.danger, display: 'flex', alignItems: 'center', gap: '8px' }}>
          ⚠️ {submitError}
          <button onClick={() => setSubmitError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.danger, fontWeight: '700', marginRight: 'auto' }}>×</button>
        </div>
      )}

      {/* Submitted banner */}
      {locked && (
        <div style={{ background: C.successBg, border: `2px solid ${C.success}`, borderRadius: RADIUS.xl, padding: '14px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>✅</span>
          <div>
            <div style={{ fontWeight: '700', color: C.success, fontSize: '15px' }}>ההגשה הושלמה</div>
            <div style={{ fontSize: '13px', color: C.success, marginTop: '2px', opacity: 0.85 }}>מנהל הלילה יוכל לקדם את התוכנית לשלב הבא לאחר שכל הצוותים יגישו</div>
          </div>
        </div>
      )}
      {/* Manager edit banner */}
      {managerUnlocked && (
        <div style={{ background: C.warningBg, border: `2px solid ${C.warning}`, borderRadius: RADIUS.xl, padding: '12px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '22px' }}>✏️</span>
          <div>
            <div style={{ fontWeight: '700', color: C.warning, fontSize: '14px' }}>עריכת מנהל פעילה</div>
            <div style={{ fontSize: '12px', color: C.warning, marginTop: '2px' }}>ניתן לערוך, להוסיף ולמחוק משימות. לחץ "סיים עריכה" בסיום.</div>
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
          <div style={{ fontSize: '16px', marginBottom: '6px', color: C.textSecondary }}>אין CR-ים עדיין</div>
          <div style={{ fontSize: '13px' }}>לחץ "🔄 סנכרן רשימת פיתוחים" לטעינה אוטומטית</div>
        </div>
      ) : (
        <div style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: RADIUS.xl, overflow: 'hidden', minHeight: '68vh', background: C.bgNested }}>

          {/* LEFT: CR list */}
          <div style={{ width: '252px', flexShrink: 0, overflowY: 'auto', background: C.bgCard, borderLeft: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column' }}>

            {/* List header with progress */}
            <div style={{ padding: '10px 14px 8px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '6px' }}>CR-ים לטיפול</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ flex: 1, height: '3px', background: C.bgNested, borderRadius: '9999px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.round(crGroups.filter(([cr, ps]) => crPlans[cr]?.notNeededForPlan || (ps.length > 0 && ps.filter(p => p.status === 'READY' || p.usedInTaskId).length === ps.length)).length / Math.max(crGroups.length, 1) * 100)}%`, height: '100%', background: C.success, borderRadius: '9999px' }} />
                </div>
                <span style={{ fontSize: '11px', fontWeight: 700, color: C.success, whiteSpace: 'nowrap' }}>
                  {crGroups.filter(([cr, ps]) => crPlans[cr]?.notNeededForPlan || (ps.length > 0 && ps.filter(p => p.status === 'READY' || p.usedInTaskId).length === ps.length)).length}/{crGroups.length}
                </span>
              </div>
            </div>

            {/* Active CRs */}
            {crGroups.filter(([cr]) => !crPlans[cr]?.notNeededForPlan).map(([crNumber, crProposals]) => renderListItem(crNumber, crProposals))}

            {/* Free / infrastructure tasks — always visible so users can always add a task without CR */}
            <div onClick={() => setSelectedCr(FREE_KEY)}
              style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '9px 14px', cursor: 'pointer', borderBottom: `1px solid ${C.bgNested}`, borderRight: `3px solid ${selectedCr === FREE_KEY ? C.brand : 'transparent'}`, background: selectedCr === FREE_KEY ? C.infoBg : 'transparent' }}>
              <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: freeGroup.length === 0 ? C.borderEm : freeGroup.every(p => p.status === 'READY' || p.usedInTaskId) ? C.success : C.warning, flexShrink: 0, marginTop: '5px', border: freeGroup.length === 0 ? `1.5px solid ${C.textDisabled}` : 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: freeGroup.length === 0 ? C.textDisabled : C.textMuted, fontFamily: 'monospace' }}>ללא CR</div>
                <div style={{ fontSize: '11px', color: C.textSecondary, lineHeight: 1.35, marginTop: '1px' }}>משימות תשתיתיות</div>
                <div style={{ fontSize: '10px', marginTop: '2px', color: C.textMuted }}>
                  {freeGroup.length === 0 ? 'לחץ להוספת משימה' : `${freeGroup.filter(p => p.status === 'READY' || p.usedInTaskId).length}/${freeGroup.length} מוכן`}
                </div>
              </div>
            </div>

            {/* Not-needed section */}
            {crGroups.filter(([cr]) => crPlans[cr]?.notNeededForPlan).length > 0 && (
              <>
                <div style={{ padding: '7px 14px 4px', borderTop: `1px solid ${C.bgNested}`, marginTop: '4px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    לא נדרשים לתוכנית ({crGroups.filter(([cr]) => crPlans[cr]?.notNeededForPlan).length})
                  </div>
                  <div style={{ fontSize: '10px', color: C.textDisabled, marginTop: '2px' }}>לחץ על CR לביטול הסימון ↩</div>
                </div>
                {crGroups.filter(([cr]) => crPlans[cr]?.notNeededForPlan).map(([crNumber, crProposals]) => renderListItem(crNumber, crProposals))}
              </>
            )}
          </div>

          {/* RIGHT: detail panel */}
          {selectedCr === FREE_KEY ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#F5F5F5' }}>
              <div style={{ padding: '10px 18px', background: C.bgCard, borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: C.textMuted, background: C.bgNested, padding: '3px 9px', borderRadius: RADIUS.sm, fontSize: '12px' }}>ללא CR</span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: '13px', color: C.textPrimary }}>משימות תשתיתיות / כלליות</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
                {freeGroup.sort((a, b) => a.phase - b.phase).map(renderRow)}
                {!submissionDone && openFormForCr !== FREE_KEY && (
                  <button onClick={() => openAdd(undefined, undefined, true)}
                    style={{ marginTop: '10px', width: '100%', padding: '9px', background: C.textMuted, color: C.textInverse, border: 'none', borderRadius: RADIUS.lg, cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                    + הוסף משימה
                  </button>
                )}
              </div>
            </div>
          ) : selectedCr ? renderDetailPanel(selectedCr) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: C.textMuted, fontSize: '13px' }}>
              <div style={{ fontSize: '40px' }}>←</div>
              <div>בחר CR מהרשימה משמאל</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
