import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';

const API = 'http://localhost:3000';

const PHASE_LABELS: Record<number, string> = {
  1: 'שלב 1 — בוקר לפני גרסה',
  2: 'שלב 2 — HOTNET',
  3: 'שלב 3 — HOT',
  4: 'שלב 4 — בוקר לאחר גרסה',
};

const PHASE_BADGE: Record<number, { bg: string; color: string }> = {
  1: { bg: '#e8f4fd', color: '#2980b9' },
  2: { bg: '#e8f8e8', color: '#27ae60' },
  3: { bg: '#fef5e7', color: '#e67e22' },
  4: { bg: '#f5e8fd', color: '#8e44ad' },
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
const CR_TYPES   = ['תיקון תקלה', 'פיתוח חדש', 'שינוי תשתית', 'שיפור ביצועים'];
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'];
const RISK_LABELS: Record<string, string> = { LOW: 'נמוך', MEDIUM: 'בינוני', HIGH: 'גבוה' };
const RISK_COLORS: Record<string, { bg: string; color: string }> = {
  LOW:    { bg: '#e8fdf0', color: '#1a7a3a' },
  MEDIUM: { bg: '#fff3e0', color: '#c05800' },
  HIGH:   { bg: '#fde8e8', color: '#c0392b' },
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
};

const labelStyle: React.CSSProperties = {
  fontSize: '12px', color: '#555', display: 'block',
  marginBottom: '4px', fontWeight: 'bold',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px', border: '1px solid #ddd',
  borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box',
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
    finally { setLoading(false); }
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
    fetchProposals();
    fetchCrPlans().then(() => syncCrItems(true)); // auto-load CRs from file (silent, delta only)
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
    setForm({ ...emptyForm, crNumber: crNumber || '', crLabel: crLabel || '', isFree: isFree ?? false });
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
    } catch { /* silent on auto-load; error shown only on manual sync */ }
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

  // Filter users to team members only
  const teamUsers = useMemo(() => {
    if (!myTeamId || !teams.length) return users;
    const myTeam = teams.find((t: any) => t.id === myTeamId);
    if (!myTeam?.members?.length) return users;
    const memberIds = new Set((myTeam.members as any[]).map((m: any) => m.user.id));
    const filtered = users.filter(u => memberIds.has(u.id));
    return filtered.length > 0 ? filtered : users;
  }, [myTeamId, teams, users]);

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


  // ── Form ────────────────────────────────────────────────────────────────────
  const renderForm = () => (
    <div style={{ background: '#fffdf0', border: '2px solid #f39c12', borderRadius: '10px', padding: '20px', marginBottom: '16px' }}>
      <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '16px', color: '#1a2332' }}>
        {editId ? 'עריכת משימה' : 'הוספת משימה חדשה'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

        {/* 0. CR מקושר — ראשון */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>CR מקושר <span style={{ color: '#e74c3c' }}>*</span></label>
          {form.isFree ? (
            <div style={{ padding: '8px 12px', background: '#f0f0f0', borderRadius: '6px', fontSize: '13px', color: '#666' }}>
              ללא CR — משימה תשתיתית / כללית
            </div>
          ) : form.crNumber && form.crLabel ? (
            <div style={{ padding: '8px 12px', background: '#e8f4fd', border: '1px solid #aed6f1', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ background: '#1a2332', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', fontFamily: 'monospace', flexShrink: 0 }}>
                {form.crNumber}
              </span>
              <span style={{ fontSize: '13px', color: '#1a5276', fontWeight: 'bold' }}>{form.crLabel.replace(`${form.crNumber} - `, '')}</span>
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
                placeholder="הקלד CR# או חפש לפי תיאור..."
                style={inputStyle}
              />
              <datalist id="tl-cr-datalist">
                {crItems.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </datalist>
              {form.crLabel && (
                <div style={{ fontSize: '12px', color: '#27ae60', marginTop: '3px' }}>✓ {form.crLabel}</div>
              )}
            </>
          )}
        </div>

        {/* 1. תיאור */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>תיאור המשימה *</label>
          <input
            autoFocus
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
            style={{ ...inputStyle, borderColor: !form.title.trim() ? '#e74c3c' : undefined }}
            placeholder="תאר את הצעד שיש לבצע..."
          />
        </div>

        {/* 2. שלב | תת-שלב */}
        <div>
          <label style={labelStyle}>שלב *</label>
          <select value={form.phase} onChange={e => setForm(f => ({ ...f, phase: parseInt(e.target.value), subPhaseId: '' }))} style={inputStyle}>
            {[1, 2, 3, 4].map(ph => <option key={ph} value={ph}>{phaseLabels[ph] || PHASE_LABELS[ph]}</option>)}
          </select>
        </div>
        <div>
          <label style={{ ...labelStyle, color: '#2d4a7a' }}>תת-שלב (אופציונלי)</label>
          {subPhaseOpts.filter(sp => sp.phaseOrderIndex === form.phase).length > 0 ? (
            <>
              <select
                value={form.subPhaseId}
                onChange={e => setForm(f => ({ ...f, subPhaseId: e.target.value }))}
                style={{ ...inputStyle, background: form.subPhaseId ? '#e8f4fd' : undefined }}
              >
                <option value="">-- בחר תת-שלב --</option>
                {subPhaseOpts.filter(sp => sp.phaseOrderIndex === form.phase).map(sp => (
                  <option key={sp.id} value={sp.id}>{sp.name}</option>
                ))}
              </select>
              {form.subPhaseId && (
                <div style={{ fontSize: '11px', color: '#2980b9', marginTop: '3px' }}>✓ המשימה תשובץ ישירות לתת-שלב זה</div>
              )}
            </>
          ) : (
            <div style={{ padding: '8px 12px', background: '#f8f8f8', borderRadius: '6px', fontSize: '12px', color: '#aaa' }}>אין תת-שלבים לשלב זה</div>
          )}
        </div>

        {/* 3. סוג פעולה | מערכת */}
        <div>
          <label style={labelStyle}>סוג פעולה <span style={{ color: '#e74c3c' }}>*</span></label>
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
                variant: 'warning',
                confirmLabel: 'עדכן תיאור',
                cancelLabel: 'שמור תיאור קיים',
                onConfirm: () => setForm(f => ({ ...f, title: val })),
                onCancel: () => {},
              });
            }
          }} style={{ ...inputStyle, borderColor: !form.actionType ? '#e74c3c' : undefined }}>
            <option value="">-- בחר --</option>
            {ACTION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>מערכת <span style={{ color: '#e74c3c' }}>*</span></label>
          <select value={form.app} onChange={e => setForm(f => ({ ...f, app: e.target.value }))}
            style={{ ...inputStyle, borderColor: !form.app ? '#e74c3c' : undefined }}>
            <option value="">-- בחר --</option>
            {teamAppList.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        {/* 4. עובד אחראי | משך */}
        <div>
          <label style={labelStyle}>עובד אחראי <span style={{ color: '#e74c3c' }}>*</span></label>
          <select value={form.assignedUserName} onChange={e => setForm(f => ({ ...f, assignedUserName: e.target.value }))}
            style={{ ...inputStyle, borderColor: !form.assignedUserName ? '#e74c3c' : undefined }}>
            <option value="">-- בחר עובד --</option>
            {teamUsers.map(u => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>משך משוער (דקות) <span style={{ color: '#e74c3c' }}>*</span></label>
          <input type="number" min={1} value={form.estimatedMins}
            onChange={e => setForm(f => ({ ...f, estimatedMins: e.target.value }))}
            style={{ ...inputStyle, borderColor: !form.estimatedMins ? '#e74c3c' : undefined }}
            placeholder="למשל 30" />
        </div>

        {/* 6. הערות — אחרון */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>הערות</label>
          <textarea value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            style={{ ...inputStyle, height: '60px', resize: 'vertical' }}
            placeholder="פרמטרים, הוראות מיוחדות, תלויות..." />
        </div>
      </div>

      {error && <div style={{ color: '#e74c3c', fontSize: '13px', marginTop: '8px' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
        <button onClick={save} disabled={saving}
          style={{ padding: '8px 20px', background: saving ? '#aaa' : '#27ae60', color: 'white', border: 'none', borderRadius: '8px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>
          {saving ? 'שומר...' : editId ? 'שמור שינויים' : 'הוסף'}
        </button>
        <button onClick={cancelForm}
          style={{ padding: '8px 16px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
          ביטול
        </button>
      </div>
    </div>
  );

  // ── Proposal row ────────────────────────────────────────────────────────────
  const renderRow = (p: Proposal) => (
    <div key={p.id} style={{
      borderRadius: '8px', marginBottom: '6px',
      background: p.usedInTaskId ? '#f0faf0' : '#fafafa',
      border: `1px solid ${p.usedInTaskId ? '#b7dfb8' : '#e0e0e0'}`,
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px' }}>
        <span style={{
          background: PHASE_BADGE[p.phase]?.bg, color: PHASE_BADGE[p.phase]?.color,
          padding: '2px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {(phaseLabels[p.phase] || PHASE_LABELS[p.phase])?.split(' — ')[1] || `שלב ${p.phase}`}
        </span>
        <span style={{ flex: 1, fontSize: '13px', fontWeight: 'bold', color: '#1a2332' }}>{p.title}</span>
        {p.usedInTaskId ? (
          <span style={{ fontSize: '11px', color: '#27ae60', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0 }}>✅ בתוכנית</span>
        ) : locked ? (
          <span style={{ fontSize: '11px', color: p.status === 'READY' ? '#27ae60' : '#f39c12', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {p.status === 'READY' ? '✓ מוכן' : 'טיוטא'}
          </span>
        ) : (
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            <button onClick={() => toggleStatus(p)} style={{
              padding: '2px 10px', border: 'none', borderRadius: '10px', cursor: 'pointer',
              fontSize: '11px', fontWeight: 'bold', whiteSpace: 'nowrap',
              background: p.status === 'READY' ? '#27ae60' : '#f39c12', color: 'white',
            }}>
              {p.status === 'READY' ? '✓ מוכן' : 'טיוטא'}
            </button>
            <button onClick={() => openEdit(p)}
              style={{ padding: '2px 8px', background: '#f39c12', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}>
              ערוך
            </button>
            <button onClick={() => remove(p)}
              style={{ padding: '2px 8px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}>
              מחק
            </button>
          </div>
        )}
      </div>
      <div style={{
        display: 'flex', gap: '16px', flexWrap: 'wrap',
        padding: '5px 12px 8px', borderTop: '1px solid #ececec',
        background: p.usedInTaskId ? '#f6fdf6' : 'white', fontSize: '12px', color: '#555',
      }}>
        <span><span style={{ color: '#999' }}>מערכת: </span>{p.app || <span style={{ color: '#ccc' }}>לא הוזן</span>}</span>
        {p.actionType && <span style={{ background: '#e8f4fd', color: '#2980b9', padding: '1px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: '600' }}>{p.actionType}</span>}
        <span><span style={{ color: '#999' }}>משך: </span>{p.estimatedMins ? `${p.estimatedMins} דק'` : <span style={{ color: '#ccc' }}>לא הוזן</span>}</span>
        <span><span style={{ color: '#999' }}>עובד אחראי: </span>{p.assignedUserName || <span style={{ color: '#ccc' }}>לא הוזן</span>}</span>
        {p.notes && <span style={{ color: '#666', fontStyle: 'italic' }}>📝 {p.notes}</span>}
      </div>
    </div>
  );

  // ── CrPlan metadata panel ────────────────────────────────────────────────────
  const renderCrPlanPanel = (crNumber: string) => {
    const f = crPlanForms[crNumber] || emptyCrPlanForm();
    const isSaving = savingPlan === crNumber;
    const hasSaved = !!crPlans[crNumber];
    const otherCrs = allCrNumbers.filter(c => c !== crNumber);

    const crItem = crItems.find(c => c.id === crNumber);
    const crManager = crItem?.crManager || '';
    const crDescription = crItem?.crDescription || '';
    const crTitle = crItem?.label
      ? crItem.label.replace(/^\S+\s*-\s*/, '')
      : crPlans[crNumber]?.crLabel?.replace(/^\S+\s*-\s*/, '') || crNumber;

    const roFieldStyle: React.CSSProperties = {
      padding: '7px 10px', background: '#f0edf8', border: '1px solid #d7bef7',
      borderRadius: '6px', fontSize: '13px', color: '#444', width: '100%',
      boxSizing: 'border-box', fontFamily: 'inherit',
    };
    const roLabel: React.CSSProperties = { ...labelStyle, color: '#9b59b6', fontSize: '11px', fontWeight: '600' };

    return (
      <div style={{ margin: '8px 0 4px', background: '#f8f0ff', border: '1px solid #d7bef7', borderRadius: '8px', padding: '14px 16px' }}>
        {/* Readiness indicator */}
        {(() => {
          const issues: string[] = [];
          if (!f.crType)              issues.push('סוג CR');
          if (!f.riskLevel)           issues.push('רמת סיכון');
          if (!f.nightTestingNotes)   issues.push('בדיקות לילה');
          if (!f.morningMonitoring)   issues.push('בדיקות בוקר אחרי');
          if (f.riskLevel === 'HIGH' && !f.rollbackPlan) issues.push('Rollback (חובה בסיכון גבוה)');
          const pct = Math.round((1 - issues.length / 5) * 100);
          const color = pct === 100 ? '#27ae60' : pct >= 60 ? '#e67e22' : '#e74c3c';
          return (
            <div style={{ marginBottom: '12px', padding: '10px 12px', background: pct === 100 ? '#e8fdf0' : '#fff8f0', borderRadius: '8px', border: `1px solid ${color}30` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: issues.length ? '6px' : 0 }}>
                <div style={{ flex: 1, height: '6px', background: '#f0f0f0', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.3s' }} />
                </div>
                <span style={{ fontSize: '12px', fontWeight: '700', color }}>{pct}% מוכנות</span>
              </div>
              {issues.length > 0 && (
                <div style={{ fontSize: '11px', color: '#c05800' }}>
                  ⚠ חסר: {issues.join(' · ')}
                </div>
              )}
            </div>
          );
        })()}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>

          {/* Row 1: CR name + manager (read-only, side by side) */}
          <div>
            <label style={roLabel}>שם ה-CR </label>
            <div style={roFieldStyle}>{crTitle || '—'}</div>
          </div>
          <div>
            <label style={roLabel}>מנהל CR </label>
            <div style={roFieldStyle}>{crManager || '—'}</div>
          </div>

          {/* Row 2: Description (read-only, full width) */}
          {crDescription && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={roLabel}>פרטים </label>
              <div style={{ ...roFieldStyle, whiteSpace: 'pre-wrap', minHeight: '38px' }}>{crDescription}</div>
            </div>
          )}

          {/* Row 2b: crType + riskLevel */}
          <div>
            <label style={{ ...labelStyle, color: '#6c3483' }}>סוג CR *</label>
            <select
              value={f.crType}
              onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, crType: e.target.value } }))}
              style={inputStyle}
            >
              <option value="">-- בחר --</option>
              {CR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={{ ...labelStyle, color: '#6c3483' }}>רמת סיכון *</label>
            <select
              value={f.riskLevel}
              onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, riskLevel: e.target.value } }))}
              style={{ ...inputStyle, background: f.riskLevel ? RISK_COLORS[f.riskLevel]?.bg : undefined, color: f.riskLevel ? RISK_COLORS[f.riskLevel]?.color : undefined, fontWeight: f.riskLevel ? '600' : 'normal' }}
            >
              <option value="">-- בחר --</option>
              {RISK_LEVELS.map(r => <option key={r} value={r}>{RISK_LABELS[r]}</option>)}
            </select>
          </div>

          {/* Row 2c: systems (multi-tag) */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ ...labelStyle, color: '#6c3483' }}>מערכות מעורבות</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '6px', border: '1px solid #ddd', borderRadius: '6px', background: 'white', minHeight: '38px' }}>
              {f.systems.map(s => (
                <span key={s} style={{ background: '#e8f4fd', color: '#2980b9', padding: '2px 8px', borderRadius: '5px', fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {s}
                  <button onClick={() => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, systems: f.systems.filter(x => x !== s) } }))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2980b9', padding: 0, fontSize: '13px', lineHeight: 1 }}>×</button>
                </span>
              ))}
              <select
                onChange={e => {
                  if (e.target.value && !f.systems.includes(e.target.value))
                    setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, systems: [...f.systems, e.target.value] } }));
                  e.target.value = '';
                }}
                style={{ border: 'none', outline: 'none', fontSize: '12px', color: '#888', background: 'transparent', cursor: 'pointer' }}
                defaultValue=""
              >
                <option value="" disabled>+ הוסף מערכת</option>
                {teamAppList.filter(a => !f.systems.includes(a)).map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          {/* Row 3a: Work plan */}
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label style={{ ...labelStyle, color: '#2d4a7a', marginBottom: 0 }}>הערות על תוכנית העבודה</label>
              {f.workPlan.trim() && (
                <button onClick={() => openExtract(crNumber, f.workPlan, 'תוכנית עבודה', 3)}
                  style={{ fontSize: '11px', padding: '2px 8px', background: '#e8f4fd', color: '#2980b9', border: '1px solid #aed6f1', borderRadius: '5px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  ⚡ הפק משימות
                </button>
              )}
            </div>
            <textarea
              value={f.workPlan}
              onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, workPlan: e.target.value } }))}
              style={{ ...inputStyle, height: '72px', resize: 'vertical' }}
              placeholder="תאר את שלבי הביצוע של ה-CR — מה עושים, באיזה סדר..."
            />
          </div>

          {/* Row 3a2: Scripts | Run times — hidden, data preserved */}
          <div style={{ display: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label style={{ ...labelStyle, color: '#2d4a7a', marginBottom: 0 }}>סקריפטים</label>
              {f.scripts.trim() && (
                <button onClick={() => openExtract(crNumber, f.scripts, 'סקריפטים', 3)}
                  style={{ fontSize: '11px', padding: '2px 8px', background: '#e8f4fd', color: '#2980b9', border: '1px solid #aed6f1', borderRadius: '5px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  ⚡ הפק משימות
                </button>
              )}
            </div>
            <textarea
              value={f.scripts}
              onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, scripts: e.target.value } }))}
              style={{ ...inputStyle, height: '56px', resize: 'vertical' }}
              placeholder="שמות סקריפטים, פקודות, קבצי הרצה..."
            />
          </div>
          <div style={{ display: 'none' }}>
            <textarea value={f.runTimes} onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, runTimes: e.target.value } }))} />
          </div>

          {/* Row 3b: Night testing | Morning monitoring */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label style={{ ...labelStyle, color: '#6c3483', marginBottom: 0 }}>המלצות בדיקות ליל גרסה (שלב 2/3)</label>
              {f.nightTestingNotes.trim() && (
                <button onClick={() => openExtract(crNumber, f.nightTestingNotes, 'בדיקות לילה', 2)}
                  style={{ fontSize: '11px', padding: '2px 8px', background: '#e8f4fd', color: '#2980b9', border: '1px solid #aed6f1', borderRadius: '5px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  ⚡ הפק משימות
                </button>
              )}
            </div>
            <textarea
              value={f.nightTestingNotes}
              onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, nightTestingNotes: e.target.value } }))}
              style={{ ...inputStyle, height: '56px', resize: 'vertical' }}
              placeholder="מה כדאי לבדוק בלילה..."
            />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label style={{ ...labelStyle, color: '#6c3483', marginBottom: 0 }}>המלצות בקרות בוקר (שלב 4)</label>
              {f.morningMonitoring.trim() && (
                <button onClick={() => openExtract(crNumber, f.morningMonitoring, 'בדיקות בוקר אחרי', 4)}
                  style={{ fontSize: '11px', padding: '2px 8px', background: '#f5e8fd', color: '#6c3483', border: '1px solid #d7bef7', borderRadius: '5px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  ⚡ הפק משימות
                </button>
              )}
            </div>
            <textarea
              value={f.morningMonitoring}
              onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, morningMonitoring: e.target.value } }))}
              style={{ ...inputStyle, height: '56px', resize: 'vertical' }}
              placeholder="מה לבדוק בבוקר שלמחרת..."
            />
          </div>

          {/* Row 4: Gradual rollout */}
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', color: '#6c3483', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={f.gradualRollout}
                onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, gradualRollout: e.target.checked } }))}
              />
              עלייה מדורגת
            </label>
            {f.gradualRollout && (
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '12px', color: '#6c3483' }}>פרטי עלייה מדורגת</span>
                  {f.gradualDetails.trim() && (
                    <button onClick={() => openExtract(crNumber, f.gradualDetails, 'עלייה מדורגת', 3)}
                      style={{ fontSize: '11px', padding: '2px 8px', background: '#fff3e0', color: '#e67e22', border: '1px solid #f0c090', borderRadius: '5px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      ⚡ הפק משימות
                    </button>
                  )}
                </div>
                <input
                  value={f.gradualDetails}
                  onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, gradualDetails: e.target.value } }))}
                  style={inputStyle}
                  placeholder="תאר איך ומתי — שלבי העלייה..."
                />
              </div>
            )}
          </div>

          {/* Row 5: Rollback (last) */}
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label style={{ ...labelStyle, color: '#6c3483', marginBottom: 0 }}>תכנית Rollback</label>
              {f.rollbackPlan.trim() && (
                <button onClick={() => openExtract(crNumber, f.rollbackPlan, 'פעולות Rollback', 3)}
                  style={{ fontSize: '11px', padding: '2px 8px', background: '#fde8e8', color: '#c0392b', border: '1px solid #f5c0b0', borderRadius: '5px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  ⚡ הפק משימות
                </button>
              )}
            </div>
            <textarea
              value={f.rollbackPlan}
              onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, rollbackPlan: e.target.value } }))}
              style={{ ...inputStyle, height: '60px', resize: 'vertical' }}
              placeholder="תאר את תהליך ה-Rollback במקרה של כשל..."
            />
          </div>

          {/* Row 6: CR dependencies */}
          {otherCrs.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ ...labelStyle, color: '#6c3483' }}>תלויות על CR-ים אחרים בגרסה</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {otherCrs.map(cr => (
                  <label key={cr} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer', background: 'white', padding: '4px 10px', borderRadius: '6px', border: `1px solid ${f.dependsOnCrs.includes(cr) ? '#6c3483' : '#ddd'}`, color: f.dependsOnCrs.includes(cr) ? '#6c3483' : '#555', fontWeight: f.dependsOnCrs.includes(cr) ? 'bold' : 'normal' }}>
                    <input type="checkbox" checked={f.dependsOnCrs.includes(cr)}
                      onChange={e => {
                        const next = e.target.checked ? [...f.dependsOnCrs, cr] : f.dependsOnCrs.filter(x => x !== cr);
                        setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, dependsOnCrs: next } }));
                      }}
                      style={{ margin: 0 }} />
                    {cr}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px' }}>
          <button onClick={() => saveCrPlan(crNumber)} disabled={isSaving}
            style={{ padding: '6px 18px', background: isSaving ? '#aaa' : '#6c3483', color: 'white', border: 'none', borderRadius: '6px', cursor: isSaving ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
            {isSaving ? 'שומר...' : 'שמור פרטי תכנית'}
          </button>
          {hasSaved && <span style={{ fontSize: '11px', color: '#27ae60' }}>✓ נשמר</span>}
        </div>
      </div>
    );
  };

  // ── CR section card ─────────────────────────────────────────────────────────
  const renderCrSection = (crNumber: string, crProposals: Proposal[]) => {
    const label = getCrLabel(crNumber);
    const readyCount = crProposals.filter(p => p.status === 'READY' || p.usedInTaskId).length;
    const allReady = crProposals.length > 0 && readyCount === crProposals.length;
    const isPlanExpanded = expandedPlans.has(crNumber);
    const hasPlanData = !!crPlans[crNumber];
    const isNotNeeded = crPlans[crNumber]?.notNeededForPlan === true;
    const isTogglingNN = togglingNotNeeded.has(crNumber);

    return (
      <div key={crNumber} style={{
        background: isNotNeeded ? '#f5f5f5' : allReady ? '#f0faf4' : 'white',
        borderRadius: '10px', padding: '14px 16px', marginBottom: '10px',
        boxShadow: allReady ? '0 2px 8px rgba(39,174,96,0.15)' : '0 2px 6px rgba(0,0,0,0.06)',
        border: isNotNeeded ? '1px solid #bdc3c7' : allReady ? '2px solid #27ae60' : '1px solid transparent',
        opacity: isNotNeeded ? 0.75 : 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: crProposals.length && !isNotNeeded ? '10px' : '0' }}>
          <span style={{ background: isNotNeeded ? '#7f8c8d' : '#1a2332', color: 'white', padding: '3px 10px', borderRadius: '6px', fontSize: '13px', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
            {crNumber}
          </span>
          <span style={{ fontSize: '13px', color: isNotNeeded ? '#999' : '#444', flex: 1, textDecoration: isNotNeeded ? 'line-through' : 'none' }}>
            {label || ''}
          </span>
          {!isNotNeeded && crPlans[crNumber]?.riskLevel && (() => {
            const rl = crPlans[crNumber].riskLevel!;
            const rc = RISK_COLORS[rl] ?? { bg: '#f0f0f0', color: '#555' };
            return <span style={{ fontSize: '11px', background: rc.bg, color: rc.color, padding: '1px 7px', borderRadius: '5px', fontWeight: '600', whiteSpace: 'nowrap' }}>{RISK_LABELS[rl]}</span>;
          })()}
          {!isNotNeeded && crProposals.length > 0 && (
            allReady ? (
              <span style={{ fontSize: '12px', color: '#27ae60', fontWeight: 'bold', whiteSpace: 'nowrap', background: '#e8fdf0', padding: '2px 10px', borderRadius: '12px', border: '1px solid #a9dfbf' }}>
                ✅ כל המשימות מוכנות
              </span>
            ) : (
              <span style={{ fontSize: '11px', color: '#888', whiteSpace: 'nowrap' }}>
                {readyCount}/{crProposals.length} מוכן
              </span>
            )
          )}
          {!locked && (
            <button
              onClick={() => toggleNotNeeded(crNumber)}
              disabled={isTogglingNN}
              title={isNotNeeded ? 'לחץ לביטול הסימון' : 'סמן CR זה כלא נדרש לתוכנית העלייה'}
              style={{
                padding: '4px 10px',
                background: isNotNeeded ? '#7f8c8d' : 'white',
                color: isNotNeeded ? 'white' : '#7f8c8d',
                border: '1px solid #bdc3c7',
                borderRadius: '6px', cursor: isTogglingNN ? 'not-allowed' : 'pointer',
                fontSize: '11px', fontWeight: 'bold', whiteSpace: 'nowrap',
              }}
            >
              {isTogglingNN ? '...' : isNotNeeded ? '✗ לא נדרש לתוכנית' : 'לא נדרש לתוכנית'}
            </button>
          )}
          {isNotNeeded && locked && (
            <span style={{ fontSize: '11px', color: '#7f8c8d', whiteSpace: 'nowrap' }}>✗ לא נדרש לתוכנית</span>
          )}
          {!isNotNeeded && (
            <button
              onClick={() => togglePlanExpanded(crNumber)}
              style={{
                padding: '4px 10px',
                background: isPlanExpanded ? '#6c3483' : hasPlanData ? '#e8d5f7' : '#f0f0f0',
                color: isPlanExpanded ? 'white' : hasPlanData ? '#6c3483' : '#666',
                border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px',
                fontWeight: 'bold', whiteSpace: 'nowrap',
              }}
            >
              {isPlanExpanded ? '▲ תכנית CR' : `${hasPlanData ? '✓ ' : ''}📋 תכנית CR`}
            </button>
          )}
          {!locked && (
            <button onClick={() => deleteCrGroup(crNumber)} style={{
              padding: '4px 10px', background: '#fee', color: '#e74c3c',
              border: '1px solid #fcc', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap',
            }}>
              🗑 מחק CR
            </button>
          )}
        </div>

        {!isNotNeeded && isPlanExpanded && renderCrPlanPanel(crNumber)}

        {!isNotNeeded && crProposals.sort((a, b) => a.phase - b.phase).map(renderRow)}

        {/* Inline form for this CR */}
        {!locked && !isNotNeeded && openFormForCr === crNumber && renderForm()}

        {!locked && !isNotNeeded && openFormForCr !== crNumber && (
          <button
            onClick={() => openAdd(crNumber, label)}
            style={{
              marginTop: '8px', width: '100%', padding: '9px',
              background: '#2d4a7a', color: 'white',
              border: 'none', borderRadius: '8px',
              cursor: 'pointer', fontSize: '13px', fontWeight: '600',
            }}
          >
            + הוסף משימה לביצוע
          </button>
        )}
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ direction: 'rtl', fontFamily: 'Arial, sans-serif' }}>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />

      {/* Extract-tasks modal */}
      {extractModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl' }}>
          <div style={{ background: 'white', borderRadius: '14px', padding: '24px 28px', maxWidth: '560px', width: '95vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ fontWeight: '700', fontSize: '16px', color: '#1a2332', marginBottom: '4px' }}>
              ⚡ הפק משימות מ{extractModal.sourceLabel}
            </div>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>
              CR {extractModal.crNumber} — בחר אילו שורות להפוך למשימות לביצוע
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {extractModal.items.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: '10px',
                  padding: '10px 12px', borderRadius: '8px',
                  background: item.checked ? '#f0f7ff' : '#fafafa',
                  border: `1px solid ${item.checked ? '#aed6f1' : '#e0e0e0'}`,
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
                      style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '13px', color: '#1a2332', outline: 'none', fontFamily: 'Arial', boxSizing: 'border-box' }}
                      disabled={!item.checked}
                    />
                    {item.duplicateId && (
                      <span style={{ fontSize: '10px', color: '#e67e22', fontWeight: '600' }}>⚠ כבר קיימת — תישאל אם להחליף</span>
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
                    style={{ width: '54px', fontSize: '11px', border: '1px solid #ddd', borderRadius: '5px', padding: '2px 4px', textAlign: 'center', flexShrink: 0 }}
                  />
                  <select
                    value={item.phase}
                    onChange={e => setExtractModal(m => m ? {
                      ...m,
                      items: m.items.map((it, j) => j === i ? { ...it, phase: parseInt(e.target.value) } : it),
                    } : null)}
                    disabled={!item.checked}
                    style={{ fontSize: '11px', border: '1px solid #ddd', borderRadius: '5px', padding: '2px 4px', background: 'white', color: '#555', flexShrink: 0 }}
                  >
                    {[1,2,3,4].map(ph => (
                      <option key={ph} value={ph}>{(phaseLabels[ph] || PHASE_LABELS[ph])?.split(' — ')[1] || `שלב ${ph}`}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Select all / none */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <button onClick={() => setExtractModal(m => m ? { ...m, items: m.items.map(it => ({ ...it, checked: true })) } : null)}
                style={{ fontSize: '12px', padding: '4px 10px', border: '1px solid #ddd', borderRadius: '6px', background: 'white', cursor: 'pointer', color: '#555' }}>
                בחר הכל
              </button>
              <button onClick={() => setExtractModal(m => m ? { ...m, items: m.items.map(it => ({ ...it, checked: false })) } : null)}
                style={{ fontSize: '12px', padding: '4px 10px', border: '1px solid #ddd', borderRadius: '6px', background: 'white', cursor: 'pointer', color: '#555' }}>
                בטל הכל
              </button>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setExtractModal(null)}
                style={{ padding: '8px 18px', border: '1px solid #ddd', borderRadius: '8px', background: 'white', cursor: 'pointer', fontSize: '13px', color: '#555' }}>
                ביטול
              </button>
              <button
                onClick={createExtracted}
                disabled={extracting || extractModal.items.filter(i => i.checked).length === 0}
                style={{
                  padding: '8px 22px', border: 'none', borderRadius: '8px',
                  background: extractModal.items.filter(i => i.checked).length === 0 ? '#ddd' : '#1a2332',
                  color: extractModal.items.filter(i => i.checked).length === 0 ? '#aaa' : 'white',
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
        background: 'linear-gradient(135deg, #1a2332 0%, #2d4a7a 100%)',
        borderRadius: '12px', padding: '16px 24px', marginBottom: '20px', color: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
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
              padding: '8px 18px', background: 'rgba(255,255,255,0.2)', color: 'white',
              border: '1px solid rgba(255,255,255,0.4)', borderRadius: '8px',
              cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
            }}>
              + הוסף משימה
            </button>
          )}
          {locked ? (
            <>
              <span style={{ padding: '8px 18px', background: '#27ae60', color: 'white', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px' }}>
                הוגש ✓
              </span>
              {isManager && (
                <button
                  onClick={() => setManagerUnlocked(true)}
                  style={{ padding: '8px 14px', background: 'rgba(240,136,62,0.25)', color: '#f0883e', border: '1px solid rgba(240,136,62,0.5)', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px', whiteSpace: 'nowrap' }}
                >
                  ✏️ עדכן כמנהל
                </button>
              )}
            </>
          ) : managerUnlocked ? (
            <>
              <span style={{ padding: '8px 14px', background: 'rgba(240,136,62,0.25)', color: '#f0883e', border: '1px solid rgba(240,136,62,0.5)', borderRadius: '8px', fontWeight: 'bold', fontSize: '12px', whiteSpace: 'nowrap' }}>
                ✏️ עריכת מנהל
              </span>
              <button
                onClick={() => setManagerUnlocked(false)}
                style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px', whiteSpace: 'nowrap' }}
              >
                ✓ סיים עריכה
              </button>
            </>
          ) : (
            <button
              onClick={submitDone}
              disabled={submitting}
              style={{ padding: '8px 18px', background: submitting ? '#aaa' : '#e74c3c', color: 'white', border: 'none', borderRadius: '8px', cursor: submitting ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '13px' }}
            >
              {submitting ? '...' : 'סיימתי הגשה'}
            </button>
          )}
        </div>
      </div>

      {/* Sync error */}
      {syncError && (
        <div style={{ background: '#fee', border: '1px solid #e74c3c', borderRadius: '8px', padding: '10px 16px', marginBottom: '12px', fontSize: '13px', color: '#c0392b', display: 'flex', alignItems: 'center', gap: '8px' }}>
          ⚠️ {syncError}
          <button onClick={() => setSyncError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontWeight: 'bold', marginRight: 'auto' }}>×</button>
        </div>
      )}

      {/* Submission error */}
      {submitError && (
        <div style={{ background: '#fee', border: '1px solid #e74c3c', borderRadius: '8px', padding: '10px 16px', marginBottom: '12px', fontSize: '13px', color: '#c0392b', display: 'flex', alignItems: 'center', gap: '8px' }}>
          ⚠️ {submitError}
          <button onClick={() => setSubmitError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontWeight: 'bold', marginRight: 'auto' }}>×</button>
        </div>
      )}

      {/* Submitted banner */}
      {locked && (
        <div style={{ background: '#e8f8e8', border: '2px solid #27ae60', borderRadius: '10px', padding: '14px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>✅</span>
          <div>
            <div style={{ fontWeight: 'bold', color: '#1a5c2a', fontSize: '15px' }}>ההגשה הושלמה</div>
            <div style={{ fontSize: '13px', color: '#27ae60', marginTop: '2px' }}>מנהל הלילה יוכל לקדם את התוכנית לשלב הבא לאחר שכל הצוותים יגישו</div>
          </div>
        </div>
      )}
      {/* Manager edit banner */}
      {managerUnlocked && (
        <div style={{ background: 'rgba(240,136,62,0.08)', border: '2px solid #f0883e', borderRadius: '10px', padding: '12px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '22px' }}>✏️</span>
          <div>
            <div style={{ fontWeight: 'bold', color: '#c05800', fontSize: '14px' }}>עריכת מנהל פעילה</div>
            <div style={{ fontSize: '12px', color: '#c05800', marginTop: '2px' }}>ניתן לערוך, להוסיף ולמחוק משימות. לחץ "סיים עריכה" בסיום.</div>
          </div>
        </div>
      )}

      {/* Content — read-only after submission */}
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>טוען...</div>
      ) : crGroups.length === 0 && freeGroup.length === 0 && openFormForCr === null ? (
        <div style={{ padding: '60px 40px', textAlign: 'center', background: 'white', borderRadius: '12px', color: '#aaa' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>📋</div>
          <div style={{ fontSize: '16px', marginBottom: '6px', color: '#666' }}>אין משימות עדיין</div>
          <div style={{ fontSize: '13px' }}>לחץ "🔄 סנכרן רשימת פיתוחים" לטעינה אוטומטית של CR-ים מקובץ הפיתוחים</div>
        </div>
      ) : (
        <>
          {/* CR groups */}
          {crGroups.map(([crNumber, crProposals]) => renderCrSection(crNumber, crProposals))}

          {/* Free / infrastructure group */}
          {(freeGroup.length > 0 || crGroups.length > 0) && (
            <div style={{
              background: 'white', borderRadius: '10px', padding: '14px 16px', marginBottom: '10px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.06)', border: '1px dashed #ccc',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: freeGroup.length ? '10px' : '0' }}>
                <span style={{ background: '#7f8c8d', color: 'white', padding: '3px 10px', borderRadius: '6px', fontSize: '13px', fontWeight: 'bold' }}>
                  ללא CR
                </span>
                <span style={{ fontSize: '13px', color: '#666', flex: 1 }}>משימות תשתיתיות / כלליות</span>
              </div>
              {freeGroup.sort((a, b) => a.phase - b.phase).map(renderRow)}
              {!submissionDone && openFormForCr === FREE_KEY && renderForm()}
              {!submissionDone && openFormForCr !== FREE_KEY && (
                <button onClick={() => openAdd(undefined, undefined, true)} style={{
                  marginTop: '8px', width: '100%', padding: '9px',
                  background: '#7f8c8d', color: 'white',
                  border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600',
                }}>
                  + הוסף משימה
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
