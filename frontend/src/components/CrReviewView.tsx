import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';
import { useDialog } from '../context/DialogContext';
import { C } from '../theme';
import { cleanHtmlText } from '../utils/textSanitize';
import { formatDate } from '../utils/dateFormat';
import { teamColor } from './shared/defectFieldDisplay';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const PHASE_LABELS: Record<number, string> = {
  1: 'בוקר לפני גרסה', 2: 'הטמעה בהוטנט', 3: 'הטמעה בהוט', 4: 'בוקר שלאחר גרסה',
};
// Fixed 4-value phase enum → literal Tailwind class strings (bg + text).
const PHASE_BADGE_CLASS: Record<number, string> = {
  1: 'bg-info-bg text-info',
  2: 'bg-success-bg text-success',
  3: 'bg-warning-bg text-warning',
  4: 'bg-[#9C6ADE1a] text-[#9C6ADE]',
};
const SUBMISSION_META: Record<string, { label: string; dotClass: string }> = {
  NOT_STARTED: { label: 'אין התייחסות', dotClass: 'bg-subtle-foreground' },
  DRAFT:       { label: 'טיוטה',         dotClass: 'bg-warning' },
  RETURNED:    { label: 'הוחזר',         dotClass: 'bg-danger' },
  SUBMITTED:   { label: 'הוגש',          dotClass: 'bg-success' },
  APPROVED:    { label: 'אושר',          dotClass: 'bg-success' },
};
const REVIEW_META: Record<string, { label: string; borderColor: string; colorClass: string }> = {
  PENDING:        { label: 'ממתין',    borderColor: C.border,      colorClass: 'text-subtle-foreground' },
  APPROVED:       { label: 'אושר ✓',  borderColor: C.statusDone,  colorClass: 'text-success' },
  REJECTED:       { label: 'נדחה ✗',  borderColor: C.danger,      colorClass: 'text-danger' },
  NEEDS_REVISION: { label: 'לתיקון', borderColor: C.warning,     colorClass: 'text-warning' },
};
const RISK_COLOR_CLASS: Record<string, string> = {
  LOW:    'bg-success-bg text-success',
  MEDIUM: 'bg-warning-bg text-warning',
  HIGH:   'bg-danger-bg text-danger',
};
const RISK_LABELS: Record<string, string> = { LOW: 'נמוך', MEDIUM: 'בינוני', HIGH: 'גבוה' };

// A note that starts with "תלות" is a dependency call-out, not a generic
// comment — worth its own visual treatment so the causal thread between merged
// tasks (from potentially different teams) is visible, not just their order.
function isDependencyNote(notes: string): boolean {
  return /^\s*תלות/.test(notes);
}
// Kept in sync with TeamLeadProposalView's ACTION_TYPE_OPTIONS — a CrPlanAction's
// actionType flows automatically into its derived TaskProposal (derivedProposalId),
// so any value missing from this list renders as a blank, unselected dropdown the
// moment a manager edits that proposal here.
const ACTION_TYPES = [
  'הרצת סקריפט', 'הסבת נתונים', 'טעינת קובץ', 'יצירת תיקייה', 'עדכון Crontab',
  'עצירת Job', 'הפעלת Job', 'פתיחת פרמטר', 'פתיחת הרשאה', 'בדיקה ידנית', 'פעולת תפעול',
  'הגדרת פרמטרים', 'הגדרת הרשאות', 'עצירת תהליך מתוזמן', 'החזרת תהליך מתוזמן',
  'הטמעת קוד', 'בדיקת תקינות', 'הגדרת תצורה', 'פעולה ידנית', 'אחר',
];
const APPS = [
  'BILI','CRM','OSB','DP','WEB-RETAIL','WEB-NEXT','WEB-HOT','TOP','IRB','NC','ERP',
  'CONNECT','CREDIT GUARD','ARCHIVE','PRINT BOSS','NIFI','CAWA','BEERI','IVR',
  'MEDIATION','PROVISIONING LDAP','PROVISIONING TIBCO','PROVISIONING NAGRA',
  'PROVISIONING OTT','PROVISIONING TEL','REMEDY','ZOO','WIZ','אחר',
];

interface Proposal {
  id: string; teamId: string; teamName: string; title: string;
  app?: string; actionType?: string; estimatedMins?: number;
  phase: number; notes?: string; assignedUserName?: string;
  status: string; reviewStatus: string; reviewNote?: string;
}
interface CrPlanEntry {
  teamId: string; teamName: string; teamLead?: string | null;
  crPlan: {
    crManager?: string | null; crDescription?: string | null; crType?: string | null;
    riskLevel?: string | null; systems?: string[]; nightTestingNotes?: string | null;
    gradualRollout: boolean; gradualDetails?: string | null; activationDate?: string | null; rollbackPlan?: string | null;
    rollbackType?: string | null; morningMonitoring?: string | null; notNeededForPlan?: boolean;
    submissionStatus?: string; planApproved?: boolean; monitoringPointsCount?: number;
  };
}
interface CrEntry {
  crNumber: string; crLabel: string; managers: string[];
  hasGradualRollout: boolean; crApproved: boolean; planApprovedAt?: string | null;
  teams: CrPlanEntry[]; proposalsByPhase: Record<number, Proposal[]>; totalProposals: number;
  monitoringPointsTotal?: number;
}
interface TeamPlanPreview {
  teamName: string; crLabel: string; notNeededForPlan: boolean;
  submittedAt?: string | null; submittedByName?: string | null;
  actions: { actionType: string; description: string; phase: number; system?: string | null; estimatedMins?: number | null; ownerName?: string | null }[];
  monitoringPoints: { type: string; name: string; note?: string | null; phase: number; assignedUserName?: string | null }[];
  nightTestNeeded?: boolean; nextDayTestNeeded?: boolean; rollbackType?: string | null; rollbackPlan?: string | null;
}
interface Props { token: string; versionId?: string; versionName?: string; }
interface SubPhaseOpt { id: string; name: string; phaseName: string; phaseOrderIndex: number; }

const inputClass = 'w-full px-2.5 py-[7px] border border-neutral-300 rounded-md text-[15px] box-border';
const labelClass = 'text-sm text-neutral-600 block mb-1 font-bold';

// ── Inline edit/add form ──────────────────────────────────────────────────────
const ProposalForm: React.FC<{
  initial?: Partial<Proposal & { subPhaseId?: string; responsibleTeamId?: string }>;
  crNumber: string; versionId: string; token: string;
  teams: any[]; users: { id: string; fullName: string }[];
  subPhaseOpts: SubPhaseOpt[]; onSaved: () => void; onCancel: () => void;
}> = ({ initial, crNumber, versionId, token, teams, users, subPhaseOpts, onSaved, onCancel }) => {
  const [title, setTitle]           = useState(initial?.title ?? '');
  const [phase, setPhase]           = useState(initial?.phase ?? 1);
  const [subPhaseId, setSubPhaseId] = useState(initial?.subPhaseId ?? '');
  const [app, setApp]               = useState(initial?.app ?? '');
  const [actionType, setActionType] = useState(initial?.actionType ?? '');
  const [estimatedMins, setEstimatedMins] = useState(initial?.estimatedMins?.toString() ?? '');
  const [assignedUserName, setAssignedUserName] = useState(initial?.assignedUserName ?? '');
  const [notes, setNotes]           = useState(initial?.notes ?? '');
  const [teamId, setTeamId]         = useState(initial?.responsibleTeamId ?? initial?.teamId ?? teams[0]?.id ?? '');
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const headers = { Authorization: `Bearer ${token}` };

  const teamMembers: { id: string; fullName: string }[] = useMemo(() => {
    const t = teams.find((t: any) => t.id === teamId);
    if (!t?.members?.length) return users;
    return (t.members as any[]).map((m: any) => m.user).filter(Boolean);
  }, [teamId, teams, users]);

  const filteredSubPhases = subPhaseOpts.filter(sp => sp.phaseOrderIndex === phase);
  const phaseLabels = useMemo(() => {
    const map: Record<number, string> = {};
    for (const sp of subPhaseOpts) {
      if (!map[sp.phaseOrderIndex] && sp.phaseName)
        map[sp.phaseOrderIndex] = `שלב ${sp.phaseOrderIndex} — ${sp.phaseName}`;
    }
    return map;
  }, [subPhaseOpts]);

  const save = async () => {
    if (!title.trim())      { setError('שם המשימה הוא שדה חובה'); return; }
    if (!app)               { setError('יש לבחור מערכת'); return; }
    if (!actionType)        { setError('יש לבחור סוג פעולה'); return; }
    if (!assignedUserName.trim()) { setError('יש להזין עובד אחראי'); return; }
    if (!estimatedMins)     { setError('יש להזין משך משוער'); return; }
    setSaving(true); setError('');
    try {
      const payload: any = {
        title: title.trim(), phase, app: app || undefined,
        actionType: actionType || undefined, subPhaseId: subPhaseId || undefined,
        estimatedMins: estimatedMins ? parseInt(estimatedMins) : undefined,
        assignedUserName: assignedUserName || undefined, notes: notes || undefined,
        crNumber, crLabel: crNumber, responsibleTeamId: teamId || undefined,
      };
      if (initial?.id) {
        await axios.patch(`${API}/task-proposals/${initial.id}`, payload, { headers });
      } else {
        payload.teamIdOverride = teamId;
        await axios.post(`${API}/task-proposals/version/${versionId}`, payload, { headers });
      }
      onSaved();
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'שגיאה בשמירה');
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-warning-bg border-2 border-warning rounded-[10px] p-4 my-1.5">
      <div className="font-bold text-[15px] mb-3.5 text-foreground">
        {initial?.id ? 'עריכת משימה' : 'הוספת משימה חדשה'}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={labelClass}>CR מקושר</label>
          <div className="px-3 py-2 bg-primary-50 border border-primary-200 rounded-md flex items-center gap-2">
            <span className="bg-foreground text-white px-2 py-0.5 rounded text-sm font-bold font-mono shrink-0">{crNumber}</span>
          </div>
        </div>
        <div className="col-span-2">
          <label className={labelClass}>תיאור המשימה <span className="text-danger">*</span></label>
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
            className={`${inputClass} ${!title.trim() ? 'border-danger' : ''}`}
            placeholder="תאר את הצעד שיש לבצע..." />
        </div>
        <div>
          <label className={labelClass}>שלב <span className="text-danger">*</span></label>
          <select value={phase} onChange={e => { setPhase(parseInt(e.target.value)); setSubPhaseId(''); }} className={inputClass}>
            {[1,2,3,4].map(ph => <option key={ph} value={ph}>{phaseLabels[ph] || PHASE_LABELS[ph]}</option>)}
          </select>
        </div>
        <div>
          <label className={`${labelClass} text-primary`}>תת-שלב (אופציונלי)</label>
          {filteredSubPhases.length > 0 ? (
            <select value={subPhaseId} onChange={e => setSubPhaseId(e.target.value)}
              className={`${inputClass} ${subPhaseId ? 'bg-primary-50' : ''}`}>
              <option value="">-- בחר תת-שלב --</option>
              {filteredSubPhases.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
            </select>
          ) : (
            <div className="px-3 py-2 bg-muted rounded-md text-sm text-subtle-foreground">אין תת-שלבים לשלב זה</div>
          )}
        </div>
        <div>
          <label className={labelClass}>סוג פעולה <span className="text-danger">*</span></label>
          <select value={actionType} onChange={e => { const v = e.target.value; setActionType(v); if (!title) setTitle(v); }}
            className={`${inputClass} ${!actionType ? 'border-danger' : ''}`}>
            <option value="">-- בחר --</option>
            {ACTION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>מערכת <span className="text-danger">*</span></label>
          <select value={app} onChange={e => setApp(e.target.value)}
            className={`${inputClass} ${!app ? 'border-danger' : ''}`}>
            <option value="">-- בחר --</option>
            {APPS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>צוות אחראי</label>
          <select value={teamId} onChange={e => { setTeamId(e.target.value); setAssignedUserName(''); }} className={inputClass}>
            <option value="">-- בחר צוות --</option>
            {teams.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>עובד אחראי <span className="text-danger">*</span></label>
          <select value={assignedUserName} onChange={e => setAssignedUserName(e.target.value)}
            className={`${inputClass} ${!assignedUserName ? 'border-danger' : ''}`}>
            <option value="">-- בחר עובד --</option>
            {teamMembers.map(u => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>משך משוער (דקות) <span className="text-danger">*</span></label>
          <input type="number" min={1} value={estimatedMins} onChange={e => setEstimatedMins(e.target.value)}
            className={`${inputClass} ${!estimatedMins ? 'border-danger' : ''}`} placeholder="למשל 30" />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>הערות</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            className={`${inputClass} h-[60px] resize-y`}
            placeholder="פרמטרים, הוראות מיוחדות, תלויות..." />
        </div>
      </div>
      {error && <div className="text-danger text-[15px] mt-2">{error}</div>}
      <div className="flex gap-2 mt-3.5">
        <button onClick={save} disabled={saving}
          className={`px-5 py-2 text-white border-none rounded-lg font-bold text-[15px] ${saving ? 'bg-neutral-400 cursor-not-allowed' : 'bg-success cursor-pointer'}`}>
          {saving ? 'שומר...' : initial?.id ? 'שמור שינויים' : 'הוסף'}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 bg-muted text-foreground border-none rounded-lg cursor-pointer text-[15px]">
          ביטול
        </button>
      </div>
    </div>
  );
};

// ── Narrative proposal row (tasks tab) ────────────────────────────────────────
const NarrativeProposalRow: React.FC<{
  proposal: Proposal; token: string; versionId: string;
  teams: { id: string; name: string }[]; users: { id: string; fullName: string }[];
  subPhaseOpts: SubPhaseOpt[]; onUpdated: () => void; crNumber: string;
  stepIndex: number; isLast: boolean;
}> = ({ proposal, token, versionId, teams, users, subPhaseOpts, onUpdated, crNumber, stepIndex, isLast }) => {
  const dialog = useDialog();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote]       = useState(proposal.reviewNote ?? '');
  const headers = { Authorization: `Bearer ${token}` };
  const meta = REVIEW_META[proposal.reviewStatus] ?? REVIEW_META.PENDING;

  const setReview = async (reviewStatus: string, reviewNote?: string) => {
    setSaving(true);
    try {
      await axios.patch(`${API}/task-proposals/${proposal.id}/review`, { reviewStatus, reviewNote: reviewNote ?? note }, { headers });
      onUpdated();
      setShowNote(false);
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!await dialog.confirm(`למחוק את "${proposal.title}"?`, 'מחיקת משימה', 'danger')) return;
    await axios.delete(`${API}/task-proposals/${proposal.id}`, { headers });
    onUpdated();
  };

  if (editing) {
    return <ProposalForm initial={proposal} crNumber={crNumber} versionId={versionId} token={token}
      teams={teams} users={users} subPhaseOpts={subPhaseOpts}
      onSaved={() => { setEditing(false); onUpdated(); }} onCancel={() => setEditing(false)} />;
  }

  const btnBaseClass = `px-2 py-[3px] border border-border rounded-md text-sm font-semibold bg-muted text-subtle-foreground ${saving ? 'cursor-not-allowed' : 'cursor-pointer'}`;

  const tColor = teamColor(proposal.teamName);
  const depNote = proposal.notes && isDependencyNote(proposal.notes);

  return (
    <div className="relative flex items-start gap-[11px]" style={{ paddingBottom: isLast ? 0 : '10px' }}>
      {/* Connecting thread — visually links merged tasks (possibly from
          different teams) into one sequential story within the phase. */}
      {!isLast && (
        <div className="absolute top-[26px] bottom-[-2px] end-[13px] w-0.5 bg-border" />
      )}
      <div
        className="w-[26px] h-[26px] rounded-full shrink-0 z-[1] flex items-center justify-center text-xs font-extrabold"
        style={{
          background: meta.borderColor === C.border ? C.bgNested : `${meta.borderColor}18`,
          border: `1.5px solid ${meta.borderColor}`, color: meta.borderColor,
        }}
      >
        {proposal.reviewStatus === 'APPROVED' ? '✓' : stepIndex}
      </div>

      <div
        className="flex-1 min-w-0 flex items-start gap-[9px] px-3 py-2.5 rounded-lg bg-background border border-border"
        style={{ borderInlineEnd: `3px solid ${meta.borderColor}` }}
      >
      <div className="flex-1 min-w-0">
        <div className="text-[15px] text-foreground leading-relaxed">
          <strong>{proposal.actionType || proposal.title}</strong>
          {proposal.app && <span className="text-muted-foreground"> — {proposal.app}</span>}
        </div>
        <div className="text-[13px] text-subtle-foreground mt-[3px] flex gap-2 flex-wrap items-center">
          <span
            className="inline-flex items-center gap-1 rounded-full py-px px-2 font-bold text-xs"
            style={{ background: tColor.bg, color: tColor.color, border: `1px solid ${tColor.color}40` }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: tColor.color }} />
            {proposal.teamName}
          </span>
          {proposal.assignedUserName && <span>👤 {proposal.assignedUserName}</span>}
          {proposal.estimatedMins && <span>⏱ כ-{proposal.estimatedMins} דק'</span>}
        </div>
        {proposal.title !== proposal.actionType && proposal.title && proposal.actionType && (
          <div className="text-[13px] text-muted-foreground mt-0.5 italic">{proposal.title}</div>
        )}
        {proposal.notes && (
          <div className={`text-[13px] mt-[3px] ${depNote ? 'text-info font-semibold' : 'text-subtle-foreground font-normal'}`}>
            {depNote ? '↳' : '💬'} {cleanHtmlText(proposal.notes)}
          </div>
        )}
        {proposal.reviewNote && !showNote && (
          <div className="text-[13px] text-warning mt-[3px] bg-warning-bg px-1.5 py-0.5 rounded-[5px] inline-block">
            ⚠ {proposal.reviewNote}
          </div>
        )}
        {showNote && (
          <div className="flex gap-1.5 mt-1.5">
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              placeholder="הערה לצוות..." autoFocus
              className="flex-1 px-2.5 py-1.5 rounded-md border border-warning text-sm outline-none" />
            <button onClick={() => setReview('NEEDS_REVISION', note)} disabled={saving}
              className="px-3 py-1.5 rounded-md border-none bg-warning text-white cursor-pointer text-[13px] font-semibold">שלח</button>
            <button onClick={() => setShowNote(false)}
              className="px-2.5 py-1.5 rounded-md border border-border bg-white cursor-pointer text-[13px]">ביטול</button>
          </div>
        )}
      </div>

      <div className="flex gap-[3px] shrink-0 mt-px">
        <button onClick={() => proposal.reviewStatus !== 'APPROVED' && setReview('APPROVED')} disabled={saving} title="אשר"
          className={`${btnBaseClass} ${proposal.reviewStatus === 'APPROVED' ? '!bg-success !text-white !border-success' : ''}`}>✓</button>
        <button onClick={() => setShowNote(v => !v)} disabled={saving} title="לתיקון"
          className={`${btnBaseClass} ${proposal.reviewStatus === 'NEEDS_REVISION' ? '!bg-warning !text-white !border-warning' : ''}`}>✎</button>
        <button onClick={() => proposal.reviewStatus !== 'REJECTED' && setReview('REJECTED')} disabled={saving} title="דחה"
          className={`${btnBaseClass} ${proposal.reviewStatus === 'REJECTED' ? '!bg-danger !text-white !border-danger' : ''}`}>✗</button>
        <button onClick={() => setEditing(true)} title="ערוך" className={`${btnBaseClass} text-[13px]`}>⚙</button>
        <button onClick={remove} title="מחק" className={`${btnBaseClass} text-danger text-[13px]`}>🗑</button>
      </div>
      </div>
    </div>
  );
};

// ── CR Detail Panel (right side of split) ────────────────────────────────────
const CrCard: React.FC<{
  entry: CrEntry; token: string; versionId: string;
  teams: { id: string; name: string }[]; users: { id: string; fullName: string }[];
  subPhaseOpts: SubPhaseOpt[]; onReload: () => void;
}> = ({ entry, token, versionId, teams, users, subPhaseOpts, onReload }) => {
  const [selectedTab, setSelectedTab] = useState<'tasks' | 'plan'>('tasks');
  const [addOpen, setAddOpen]         = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [approvingPhase, setApprovingPhase] = useState<number | null>(null);
  const [approving, setApproving]     = useState(false);
  const [summary, setSummary]         = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [teamPreview, setTeamPreview] = useState<{ teamName: string; loading: boolean; error?: string; data?: TeamPlanPreview } | null>(null);

  const openTeamPreview = async (teamId: string, teamName: string) => {
    setTeamPreview({ teamName, loading: true });
    try {
      const r = await axios.get(`${API}/cr-plans/version/${versionId}/cr/${entry.crNumber}/team/${teamId}/preview`,
        { headers: { Authorization: `Bearer ${token}` } });
      setTeamPreview({ teamName, loading: false, data: r.data });
    } catch (e: any) {
      setTeamPreview({ teamName, loading: false, error: e.response?.data?.message ?? 'שגיאה בטעינת התוכנית' });
    }
  };

  interface ExtractItemCr { text: string; checked: boolean; phase: number; estimatedMins: string; teamId: string; duplicateId?: string; }
  const [extractModalCr, setExtractModalCr] = useState<{
    crNumber: string; sourceLabel: string; defaultPhase: number; items: ExtractItemCr[];
  } | null>(null);
  const [extractingCr, setExtractingCr] = useState(false);
  const [dialog, setDialog] = useState<DialogConfig | null>(null);

  const headers = { Authorization: `Bearer ${token}` };
  const [approvingTeam, setApprovingTeam] = useState<string | null>(null);
  const approveTeamPlan = async (teamId: string, approve: boolean) => {
    setApprovingTeam(teamId);
    try {
      await axios.patch(`${API}/cr-plans/version/${versionId}/${approve ? 'approve-cr' : 'unapprove-cr'}`, { crNumber: entry.crNumber, teamId }, { headers });
      onReload();
    } finally {
      setApprovingTeam(prev => prev === teamId ? null : prev);
    }
  };

  // "מצב הקראה" — reads the merged cross-team story aloud via the browser's
  // built-in TTS, meant for the release-review meeting (no server round-trip).
  const [speaking, setSpeaking] = useState(false);
  const toggleNarrate = () => {
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    const text = [1, 2, 3, 4].flatMap(phase => (entry.proposalsByPhase[phase] ?? []).map(p => {
      const who = p.assignedUserName ? `${p.assignedUserName} מ-${p.teamName}` : `מישהו מ-${p.teamName}`;
      const action = p.actionType || p.title || '';
      return action ? `${who} מבצע ${action}${p.app ? ` במערכת ${p.app}` : ''}.` : '';
    })).filter(Boolean).join(' ');
    if (!text) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'he-IL';
    utter.onend = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
    setSpeaking(true);
  };
  const allProposals  = Object.values(entry.proposalsByPhase).flat();
  const pendingCount  = allProposals.filter(p => p.reviewStatus === 'PENDING').length;
  const approvedCount = allProposals.filter(p => p.reviewStatus === 'APPROVED').length;
  const teamsWithoutSubmission = entry.teams.filter(t => !['SUBMITTED', 'APPROVED'].includes(t.crPlan.submissionStatus ?? ''));
  const allTeamsSubmitted = teamsWithoutSubmission.length === 0;
  const allReviewed   = allProposals.length > 0 && pendingCount === 0 && allTeamsSubmitted;
  const crApproved    = entry.crApproved;

  const riskLevel = entry.teams.find(t => t.crPlan.riskLevel)?.crPlan.riskLevel ?? '';
  const crType    = entry.teams.find(t => t.crPlan.crType)?.crPlan.crType ?? '';
  const isTargetCr = /target/i.test(crType) || /target/i.test(entry.crLabel || '');
  const [targetSummary, setTargetSummary] = useState<{
    teams: { teamId: string; teamName: string; approved: boolean; defectCount: number; specialCount: number; managementCount: number }[];
    totalDefects: number; totalSpecial: number; totalManagement: number;
  } | null>(null);
  useEffect(() => {
    if (!isTargetCr) { setTargetSummary(null); return; }
    axios.get(`${API}/target-cr/version/${versionId}/cr/${entry.crNumber}/summary`, { headers })
      .then(r => setTargetSummary(r.data))
      .catch(() => setTargetSummary(null));
  }, [isTargetCr, versionId, entry.crNumber]); // eslint-disable-line

  const approveAll = async () => {
    setApprovingAll(true);
    try {
      await Promise.all(
        allProposals.filter(p => p.reviewStatus === 'PENDING').map(p =>
          axios.patch(`${API}/task-proposals/${p.id}/review`, { reviewStatus: 'APPROVED', reviewNote: '' }, { headers })
        )
      );
      onReload();
    } finally { setApprovingAll(false); }
  };

  const approvePhase = async (phase: number) => {
    setApprovingPhase(phase);
    try {
      const phaseProposals = entry.proposalsByPhase[phase] ?? [];
      await Promise.all(
        phaseProposals.filter(p => p.reviewStatus === 'PENDING').map(p =>
          axios.patch(`${API}/task-proposals/${p.id}/review`, { reviewStatus: 'APPROVED', reviewNote: '' }, { headers })
        )
      );
      onReload();
    } finally { setApprovingPhase(null); }
  };

  const doCreateExtractedCr = async (replaceConflicts: boolean) => {
    if (!extractModalCr) return;
    const toCreate = extractModalCr.items.filter(i => i.checked && i.text.trim());
    setExtractingCr(true);
    try {
      for (const item of toCreate) {
        if (item.duplicateId) {
          if (!replaceConflicts) continue;
          await axios.patch(`${API}/task-proposals/${item.duplicateId}`,
            { title: item.text.trim(), phase: item.phase, estimatedMins: item.estimatedMins ? parseInt(item.estimatedMins) : undefined },
            { headers });
        } else {
          await axios.post(`${API}/task-proposals/version/${versionId}`, {
            title: item.text.trim(), phase: item.phase,
            estimatedMins: item.estimatedMins ? parseInt(item.estimatedMins) : undefined,
            crNumber: extractModalCr.crNumber, teamIdOverride: item.teamId,
          }, { headers });
        }
      }
      onReload();
      setExtractModalCr(null);
    } finally { setExtractingCr(false); }
  };

  const createExtractedCr = () => {
    if (!extractModalCr) return;
    const conflicts = extractModalCr.items.filter(i => i.checked && i.duplicateId);
    if (conflicts.length > 0) {
      setDialog({
        title: 'משימות כפולות',
        message: `${conflicts.length} מהמשימות שבחרת כבר קיימות.\nהאם להחליף אותן בגרסה החדשה?`,
        variant: 'warning', confirmLabel: 'החלף', cancelLabel: 'דלג על הקיימות',
        onConfirm: () => doCreateExtractedCr(true),
        onCancel: () => doCreateExtractedCr(false),
      });
    } else {
      doCreateExtractedCr(false);
    }
  };

  // Plan sections helper
  interface PlanItem { teamId: string; teamName: string; text: string; }
  const PlanSection = ({ title, icon, items, accent, defaultPhase }: { title: string; icon: string; items: PlanItem[]; accent: string; defaultPhase: number }) => {
    if (!items.length) return null;
    return (
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold text-[15px]" style={{ color: accent }}>{icon} {title}</div>
          <button onClick={() => {
            const allText = items.map(i => `${i.teamName}:\n${i.text}`).join('\n\n');
            const lines = allText.split(/\n/).map(l => l.replace(/^[-*•·\s]+/, '').trim()).filter(l => l.length > 2 && !l.endsWith(':'));
            if (!lines.length) return;
            const existingProposals = Object.values(entry.proposalsByPhase).flat();
            setExtractModalCr({ crNumber: entry.crNumber, sourceLabel: title, defaultPhase, items: lines.map(t => {
              const dup = existingProposals.find(p => p.title.trim().toLowerCase() === t.trim().toLowerCase());
              return { text: t, checked: true, phase: defaultPhase, estimatedMins: '', teamId: items[0].teamId, duplicateId: dup?.id };
            }) });
          }}
            className="text-[13px] px-2.5 py-1 rounded-md cursor-pointer whitespace-nowrap font-semibold"
            style={{ background: `${accent}15`, color: accent, border: `1px solid ${accent}40` }}>
            ⚡ הפק משימות
          </button>
        </div>
        {items.map((item, i) => (
          <div key={i} className="bg-white rounded-lg px-4 py-3 mb-2" style={{ borderInlineEnd: `4px solid ${accent}`, border: `1px solid ${accent}25`, borderInlineEndWidth: '4px' }}>
            <div className="text-sm font-bold text-primary mb-1.5">{item.teamName}</div>
            <div className="text-[15px] text-foreground leading-[1.65] whitespace-pre-wrap">{item.text}</div>
          </div>
        ))}
      </div>
    );
  };

  const renderPlanTab = () => {
    const workPlanItems = entry.teams.filter(t => (t.crPlan as any).workPlan).map(t => ({ teamId: t.teamId, teamName: t.teamName, text: (t.crPlan as any).workPlan! }));
    const scriptsItems  = entry.teams.filter(t => (t.crPlan as any).scripts).map(t => ({ teamId: t.teamId, teamName: t.teamName, text: (t.crPlan as any).scripts! }));
    const runTimesItems = entry.teams.filter(t => (t.crPlan as any).runTimes).map(t => ({ teamId: t.teamId, teamName: t.teamName, text: (t.crPlan as any).runTimes! }));
    const nightItems    = entry.teams.filter(t => t.crPlan.nightTestingNotes).map(t => ({ teamId: t.teamId, teamName: t.teamName, text: t.crPlan.nightTestingNotes! }));
    const morningItems  = entry.teams.filter(t => t.crPlan.morningMonitoring).map(t => ({ teamId: t.teamId, teamName: t.teamName, text: t.crPlan.morningMonitoring! }));
    const rollbackItems = entry.teams.filter(t => t.crPlan.rollbackPlan).map(t => ({ teamId: t.teamId, teamName: t.teamName, text: t.crPlan.rollbackPlan! }));
    const gradualItems  = entry.teams.filter(t => t.crPlan.gradualRollout && t.crPlan.gradualDetails).map(t => ({
      teamId: t.teamId, teamName: t.teamName,
      text: t.crPlan.gradualDetails! + (t.crPlan.activationDate ? ` · תאריך הפעלה: ${formatDate(t.crPlan.activationDate)}` : ''),
    }));

    const crMgr  = entry.teams.map(t => t.crPlan.crManager).find(v => v);
    const crDesc = entry.teams.map(t => t.crPlan.crDescription).find(v => v);
    const hasAnyPlan = [workPlanItems, scriptsItems, runTimesItems, nightItems, morningItems, rollbackItems, gradualItems].some(arr => arr.length > 0);

    return (
      <div>
        {/* AI Summary header — indigo brand accent, matching the design system's .ai-card */}
        <div className="flex items-center justify-between mb-3">
          <div className="text-[13px] font-extrabold text-primary">✨ סיכום AI — התוכנית המאוחדת</div>
          <button disabled={summarizing}
            onClick={async () => {
              setSummarizing(true);
              try {
                const r = await axios.post(`${API}/versions/${versionId}/cr-review/${entry.crNumber}/summarize`, {}, { headers });
                setSummary(r.data.summary);
              } catch (e: any) {
                setSummary(`שגיאה: ${e?.response?.data?.message || e.message}`);
              } finally { setSummarizing(false); }
            }}
            className={`text-[11px] font-bold px-3 py-1.5 bg-card text-muted-foreground border border-neutral-300 rounded-full ${summarizing ? 'cursor-not-allowed opacity-60' : 'cursor-pointer opacity-100'}`}>
            {summarizing ? '⏳ מסכם...' : summary ? '🔄 עדכן' : '✨ סכם תוכנית'}
          </button>
        </div>
        {summary && (
          <div className="bg-card border border-primary/[.22] rounded-lg px-[18px] py-3.5 mb-4">
            <div className="text-[12.5px] text-foreground leading-[1.8] whitespace-pre-wrap">{summary}</div>
            <button onClick={() => setSummary('')}
              className="mt-2 text-[13px] px-2.5 py-0.5 bg-transparent border border-primary/25 rounded-sm text-primary cursor-pointer">
              ✕ סגור
            </button>
          </div>
        )}

        {/* CR file meta */}
        {(crMgr || crDesc) && (
          <div className="mb-3.5 pb-3 border-b border-border">
            <div className={`grid gap-2 ${crDesc ? 'mb-2' : 'mb-0'}`} style={{ gridTemplateColumns: crMgr ? '1fr 1fr' : '1fr' }}>
              <div>
                <div className="text-[13px] text-subtle-foreground font-bold mb-1">שם ה-CR</div>
                <div className="bg-muted border border-border rounded-md px-3 py-2 text-[15px] text-foreground">
                  {entry.crLabel !== entry.crNumber ? entry.crLabel.replace(/^\S+\s*-\s*/, '') : '—'}
                </div>
              </div>
              {crMgr && (
                <div>
                  <div className="text-[13px] text-subtle-foreground font-bold mb-1">מנהל CR</div>
                  <div className="bg-muted border border-border rounded-md px-3 py-2 text-[15px] text-foreground">{crMgr}</div>
                </div>
              )}
            </div>
            {crDesc && (
              <div>
                <div className="text-[13px] text-subtle-foreground font-bold mb-1">פרטים</div>
                <div className="bg-muted border border-border rounded-md px-3 py-2 text-[15px] text-foreground whitespace-pre-wrap">{crDesc}</div>
              </div>
            )}
          </div>
        )}

        {/* Team chips */}
        {entry.teams.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mb-4 pb-3 border-b border-border">
            {entry.teams.map(t => (
              <div key={t.teamId} className="bg-card border border-border rounded-md px-[11px] py-1.5 text-sm">
                <span className="font-bold text-foreground">{t.teamName}</span>
                {t.teamLead && <span className="text-subtle-foreground me-1.5">· {t.teamLead}</span>}
              </div>
            ))}
          </div>
        )}

        {!hasAnyPlan && (
          <div className="text-center p-[30px] text-subtle-foreground text-[15px] italic">לא הוזנו פרטי תכנית</div>
        )}

        <PlanSection title="תוכנית עבודה"            icon="📝" items={workPlanItems}  accent="#27ae60" defaultPhase={2} />
        <PlanSection title="סקריפטים"                icon="💻" items={scriptsItems}    accent="#2980b9" defaultPhase={2} />
        <PlanSection title="זמני הרצה"               icon="⏱" items={runTimesItems}   accent="#16a085" defaultPhase={2} />
        <PlanSection title="המלצות בדיקות ליל גרסה" icon="💡" items={nightItems}      accent="#2980b9" defaultPhase={2} />
        <PlanSection title="המלצות בקרות בוקר"       icon="🌅" items={morningItems}    accent="#8e44ad" defaultPhase={4} />
        <PlanSection title="תכנית Rollback"           icon="🔄" items={rollbackItems}   accent="#e74c3c" defaultPhase={3} />
        {entry.hasGradualRollout && <PlanSection title="עלייה מדורגת" icon="📈" items={gradualItems} accent="#e67e22" defaultPhase={3} />}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />

      {/* ── Topbar ── */}
      <div className="px-4 py-3 border-b border-border flex gap-2.5 items-center flex-wrap bg-card shrink-0">
        <span className="bg-foreground text-white px-2.5 py-[3px] rounded-md font-mono font-bold text-[15px] shrink-0">
          {entry.crNumber}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-base text-foreground overflow-hidden text-ellipsis whitespace-nowrap">
            {entry.crLabel !== entry.crNumber ? entry.crLabel.replace(/^\S+\s*-\s*/, '') : ''}
          </div>
          <div className="text-sm text-subtle-foreground mt-px">
            {entry.managers.length > 0 && `מנהל: ${entry.managers.join(', ')} · `}
            {entry.teams.length} צוותים · {allProposals.length} הצעות
          </div>
        </div>
        {riskLevel && (
          <span className={`text-[13px] font-bold px-2.5 py-[3px] rounded-md shrink-0 ${RISK_COLOR_CLASS[riskLevel]}`}>
            סיכון {RISK_LABELS[riskLevel]}
          </span>
        )}
        {crType && (
          <span className="text-[13px] bg-muted text-muted-foreground px-2 py-0.5 rounded-md shrink-0">{crType}</span>
        )}
        {/* Approval status / action */}
        {crApproved ? (
          <>
            <span className="text-sm font-bold text-success bg-success-bg px-2.5 py-[3px] rounded-full border border-success/25 shrink-0">
              ✓ CR אושר
            </span>
            <button onClick={async () => {
              await axios.patch(`${API}/cr-plans/version/${versionId}/unapprove-cr`, { crNumber: entry.crNumber }, { headers });
              onReload();
            }} className="px-2.5 py-1 bg-white text-subtle-foreground border border-border rounded-md cursor-pointer text-[13px] shrink-0">
              בטל אישור
            </button>
          </>
        ) : allReviewed ? (
          <button onClick={async () => {
            setApproving(true);
            try {
              await axios.patch(`${API}/cr-plans/version/${versionId}/approve-cr`, { crNumber: entry.crNumber }, { headers });
              onReload();
            } finally { setApproving(false); }
          }} disabled={approving}
            className={`px-5 py-2.5 text-white border-none rounded-md text-[13px] font-bold shrink-0 shadow-sm ${approving ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            style={{ background: C.moduleGoLive }}>
            {approving ? 'שומר…' : '✓ אשר תוכנית מאוחדת'}
          </button>
        ) : !allTeamsSubmitted ? (
          <span className="text-[13px] text-warning bg-warning-bg px-2.5 py-[3px] rounded-md border border-warning/25 shrink-0">
            ⚠ ממתין להגשה מ-{teamsWithoutSubmission.length} צוותים
          </span>
        ) : pendingCount > 0 ? (
          <span className="text-[13px] text-subtle-foreground bg-muted px-2.5 py-[3px] rounded-md border border-border shrink-0">
            {pendingCount} ממתינות לסקירה
          </span>
        ) : null}
      </div>

      {/* ── TARGET CR summary — replaces the normal per-team status meaning for
          umbrella CRs wrapping a batch of QC defects, not real development ── */}
      {isTargetCr && targetSummary && (
        <div className="px-4 py-3 border-b border-border shrink-0" style={{ background: `${C.moduleGoLive}0d` }}>
          <div className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: C.moduleGoLive }}>
            🎯 TARGET CR — תקלות QC
          </div>
          <div className="flex gap-2 flex-wrap mb-2.5">
            {targetSummary.teams.map(t => (
              <span key={t.teamId} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-300 bg-card text-xs font-bold">
                <span className={`w-2 h-2 rounded-full ${t.approved ? 'bg-success' : 'bg-warning'}`} />
                {t.teamName} · {t.defectCount} תקלות{t.approved ? ' · אושר' : ''}
              </span>
            ))}
          </div>
          <div className="text-[13px] text-muted-foreground">
            <strong className="text-foreground">{targetSummary.totalDefects}</strong> תקלות TARGET סה"כ ·{' '}
            <strong className="text-foreground">{targetSummary.totalSpecial}</strong> דורשות הטמעה מיוחדת ·{' '}
            <strong className="text-foreground">{targetSummary.totalManagement}</strong> סומנו כחשובות להנהלה
          </div>
        </div>
      )}

      {/* ── Teams status strip + KPI row ── */}
      <div className="px-4 py-3 border-b border-border bg-background shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-bold text-subtle-foreground uppercase tracking-wide">
            סטטוס הגשה לפי צוות
          </div>
          <button onClick={toggleNarrate}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full cursor-pointer"
            style={{ color: C.moduleGoLive, background: `${C.moduleGoLive}18`, border: `1px solid ${C.moduleGoLive}4d` }}>
            {speaking ? '⏹ עצור הקראה' : '🔊 מצב הקראה'}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap mb-3.5">
          {entry.teams.map(t => {
            const meta = SUBMISSION_META[t.crPlan.submissionStatus ?? 'NOT_STARTED'] ?? SUBMISSION_META.NOT_STARTED;
            const canPreview = ['SUBMITTED', 'APPROVED'].includes(t.crPlan.submissionStatus ?? '') && !t.crPlan.notNeededForPlan;
            const canApproveTeam = canPreview;
            const isBusy = approvingTeam === t.teamId;
            return (
              <span key={t.teamId} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-300 bg-card text-[12.5px] font-bold">
                <span onClick={() => canPreview && openTeamPreview(t.teamId, t.teamName)}
                  className={`flex items-center gap-1.5 ${canPreview ? 'cursor-pointer' : 'cursor-default'}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dotClass}`} />
                  {t.teamName} · {t.crPlan.notNeededForPlan ? 'אין פעילות מיוחדת' : meta.label}
                </span>
                {canApproveTeam && (
                  <button onClick={() => approveTeamPlan(t.teamId, !t.crPlan.planApproved)} disabled={isBusy}
                    className={`text-[11px] font-bold bg-transparent border-none p-0 ${t.crPlan.planApproved ? 'text-subtle-foreground' : 'text-success'} ${isBusy ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                    {isBusy ? '…' : t.crPlan.planApproved ? '↩ בטל' : '✓ Approve Team'}
                  </button>
                )}
              </span>
            );
          })}
        </div>

        {!allTeamsSubmitted && (
          <div className="flex items-center gap-2 bg-warning-bg border border-warning/25 rounded-md px-3.5 py-2.5 text-[12.5px] text-warning font-semibold mb-3.5">
            ⚠ לא ניתן לאשר את ה-CR — ממתין להתייחסות {teamsWithoutSubmission.map(t => t.teamName).join(', ')}
          </div>
        )}

        <div className="grid grid-cols-4 gap-2.5">
          {[
            { label: 'צוותים מעורבים', val: entry.teams.length },
            { label: 'משימות בתוכנית המאוחדת', val: allProposals.length },
            { label: 'נקודות בקרה',   val: entry.monitoringPointsTotal ?? 0 },
            { label: 'מוכן לאישור?',   val: crApproved ? '✓ אושר' : allReviewed ? 'מוכן' : !allTeamsSubmitted ? `ממתין ל-${teamsWithoutSubmission.length}` : `${pendingCount} לסקירה`, warn: !crApproved && !allReviewed },
          ].map((kpi, i) => (
            <div key={i} className="bg-card border border-border rounded-lg px-3.5 py-2.5 shadow-xs">
              <div className="text-[10.5px] font-semibold text-subtle-foreground uppercase tracking-wide">{kpi.label}</div>
              <div className={`font-extrabold mt-1 ${typeof kpi.val === 'string' && kpi.val.length > 6 ? 'text-[15px]' : 'text-xl'} ${kpi.warn ? 'text-warning' : 'text-foreground'}`}>{kpi.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-border bg-card shrink-0">
        {(['tasks', 'plan'] as const).map(tab => {
          const label = tab === 'tasks' ? `משימות (${allProposals.length})` : 'תוכנית CR';
          const active = selectedTab === tab;
          return (
            <button key={tab} onClick={() => setSelectedTab(tab)}
              className={`px-[18px] py-2.5 border-none bg-transparent cursor-pointer text-[15px] shrink-0 border-b-2 transition-colors duration-fast ease-out ${active ? 'font-bold text-primary border-primary' : 'font-normal text-subtle-foreground border-transparent'}`}>
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3.5">
        {selectedTab === 'tasks' ? (
          <>
            {/* Approve-all bar */}
            {pendingCount > 0 && (
              <div className="flex gap-2 items-center mb-3 px-3 py-2 bg-info-bg rounded-lg border border-info/[.15]">
                <span className="text-sm text-info flex-1">{pendingCount} הצעות ממתינות לסקירה</span>
                <button onClick={approveAll} disabled={approvingAll}
                  className="px-3.5 py-1.5 bg-info text-white border-none rounded-md cursor-pointer text-sm font-semibold">
                  {approvingAll ? 'מאשר...' : 'אשר הכל ✓'}
                </button>
              </div>
            )}

            {/* Add form */}
            {addOpen && (
              <ProposalForm crNumber={entry.crNumber} versionId={versionId} token={token}
                teams={teams} users={users} subPhaseOpts={subPhaseOpts}
                onSaved={() => { setAddOpen(false); onReload(); }} onCancel={() => setAddOpen(false)} />
            )}

            {/* Phase groups */}
            {[1, 2, 3, 4].map(phase => {
              const phaseProposals = entry.proposalsByPhase[phase] ?? [];
              if (!phaseProposals.length) return null;
              const pbClass = PHASE_BADGE_CLASS[phase];
              const phaseName = subPhaseOpts.find(sp => sp.phaseOrderIndex === phase)?.phaseName || PHASE_LABELS[phase];
              const phasePending = phaseProposals.filter(p => p.reviewStatus === 'PENDING').length;
              return (
                <div key={phase} className="mb-[18px]">
                  <div className={`flex items-center gap-2 mb-2.5 px-3 py-1.5 rounded-md ${pbClass}`}>
                    <span className="text-sm font-extrabold">{phaseName}</span>
                    <span className="text-[13px] bg-white px-1.5 py-px rounded-lg border border-current/30">{phaseProposals.length}</span>
                    {phasePending > 0 && (
                      <button onClick={() => approvePhase(phase)} disabled={approvingPhase === phase}
                        className="ms-auto text-[11.5px] font-bold bg-white border border-current/40 rounded-full px-2.5 py-1 cursor-pointer shrink-0">
                        {approvingPhase === phase ? 'מאשר…' : `✓ אשר שלב (${phasePending})`}
                      </button>
                    )}
                  </div>
                  {phaseProposals.map((p, i) => (
                    <NarrativeProposalRow key={p.id} proposal={p} token={token} versionId={versionId}
                      teams={teams} users={users} subPhaseOpts={subPhaseOpts} onUpdated={onReload} crNumber={entry.crNumber}
                      stepIndex={i + 1} isLast={i === phaseProposals.length - 1} />
                  ))}
                </div>
              );
            })}

            {/* Consolidated rollback — one team, one line each */}
            {entry.teams.some(t => t.crPlan.rollbackPlan || t.crPlan.rollbackType) && (
              <div className="bg-card border border-border rounded-lg shadow-xs px-4 py-3.5 mb-4">
                <div className="text-[13.5px] font-extrabold text-foreground mb-2.5 flex items-center gap-2">
                  ↩ Rollback מרוכז
                </div>
                <div className="flex flex-col gap-2">
                  {entry.teams.filter(t => t.crPlan.rollbackPlan || t.crPlan.rollbackType).map(t => {
                    const tColor = teamColor(t.teamName);
                    return (
                      <div key={t.teamId} className="flex items-center gap-2.5 text-[12.5px] text-muted-foreground">
                        <span className="text-[10px] font-bold px-2.5 py-[3px] rounded-full shrink-0" style={{ background: tColor.bg, color: tColor.color }}>{t.teamName}</span>
                        <span>{t.crPlan.rollbackType ? `${t.crPlan.rollbackType} — ` : ''}{t.crPlan.rollbackPlan || 'אין פירוט נוסף'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {allProposals.length === 0 && !addOpen && (
              <div className="text-center px-5 py-10 text-subtle-foreground">
                <div className="text-[28px] mb-2.5">📋</div>
                <div className="text-[15px]">אין הצעות משימות לCR זה</div>
              </div>
            )}

            {!addOpen && (
              <button onClick={() => setAddOpen(true)}
                className="w-full py-2.5 bg-muted text-muted-foreground border border-dashed border-border rounded-lg cursor-pointer text-[15px] mt-2">
                + הוסף משימה לביצוע
              </button>
            )}
          </>
        ) : renderPlanTab()}
      </div>

      {/* ── Extract modal ── */}
      {extractModalCr && (
        <div className="fixed inset-0 bg-black/50 z-[5000] flex items-center justify-center">
          <div className="bg-white rounded-2xl px-7 py-6 max-w-[560px] w-[95vw] max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="font-bold text-[17px] text-foreground mb-1">⚡ הפק משימות מ{extractModalCr.sourceLabel}</div>
            <div className="text-sm text-subtle-foreground mb-4">CR {extractModalCr.crNumber} — בחר שורות להפוך למשימות</div>
            <div className="flex flex-col gap-2 mb-4">
              {extractModalCr.items.map((item, i) => (
                <div key={i} className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border ${item.checked ? 'bg-primary-50 border-primary-200' : 'bg-neutral-50 border-neutral-200'}`}>
                  <input type="checkbox" checked={item.checked}
                    onChange={e => setExtractModalCr(m => m ? { ...m, items: m.items.map((it, j) => j === i ? { ...it, checked: e.target.checked } : it) } : null)}
                    className="mt-[3px] shrink-0 cursor-pointer" />
                  <div className="flex-1 flex flex-col gap-0.5">
                    <input value={item.text} disabled={!item.checked}
                      onChange={e => setExtractModalCr(m => m ? { ...m, items: m.items.map((it, j) => j === i ? { ...it, text: e.target.value } : it) } : null)}
                      className="w-full border-none bg-transparent text-[15px] text-foreground outline-none box-border" />
                    {item.duplicateId && <span className="text-xs text-warning font-semibold">⚠ כבר קיימת — תישאל אם להחליף</span>}
                  </div>
                  <input type="number" min={1} value={item.estimatedMins} disabled={!item.checked}
                    onChange={e => setExtractModalCr(m => m ? { ...m, items: m.items.map((it, j) => j === i ? { ...it, estimatedMins: e.target.value } : it) } : null)}
                    placeholder="דק'" className="w-[54px] text-[13px] border border-neutral-300 rounded-[5px] px-1 py-0.5 text-center shrink-0" />
                  <select value={item.phase} disabled={!item.checked}
                    onChange={e => setExtractModalCr(m => m ? { ...m, items: m.items.map((it, j) => j === i ? { ...it, phase: parseInt(e.target.value) } : it) } : null)}
                    className="text-[13px] border border-neutral-300 rounded-[5px] px-1 py-0.5 shrink-0">
                    {[1,2,3,4].map(ph => <option key={ph} value={ph}>{PHASE_LABELS[ph]}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mb-3.5">
              <button onClick={() => setExtractModalCr(m => m ? { ...m, items: m.items.map(it => ({ ...it, checked: true })) } : null)} className="text-sm px-2.5 py-1 border border-neutral-300 rounded-md bg-white cursor-pointer">בחר הכל</button>
              <button onClick={() => setExtractModalCr(m => m ? { ...m, items: m.items.map(it => ({ ...it, checked: false })) } : null)} className="text-sm px-2.5 py-1 border border-neutral-300 rounded-md bg-white cursor-pointer">בטל הכל</button>
            </div>
            <div className="flex gap-2.5 justify-end">
              <button onClick={() => setExtractModalCr(null)} className="px-4.5 py-2 border border-neutral-300 rounded-lg bg-white cursor-pointer text-[15px]">ביטול</button>
              <button onClick={createExtractedCr} disabled={extractingCr || extractModalCr.items.filter(i => i.checked).length === 0}
                className={`px-5.5 py-2 border-none rounded-lg text-[15px] font-bold ${extractModalCr.items.filter(i => i.checked).length === 0 ? 'bg-neutral-200 text-subtle-foreground cursor-not-allowed' : 'bg-foreground text-white cursor-pointer'}`}>
                {extractingCr ? 'יוצר…' : `צור ${extractModalCr.items.filter(i => i.checked).length} משימות`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Team plan preview modal ── */}
      {teamPreview && (
        <div className="fixed inset-0 bg-foreground/45 z-[5000] flex items-center justify-center"
          onClick={() => setTeamPreview(null)}>
          <div onClick={e => e.stopPropagation()}
            className="bg-card rounded-xl px-6 py-[22px] max-w-[540px] w-[92vw] max-h-[82vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between mb-3.5">
              <div className="text-base font-extrabold text-foreground">תקציר תוכנית — {teamPreview.teamName}</div>
              <button onClick={() => setTeamPreview(null)} className="border-none bg-transparent cursor-pointer text-lg text-subtle-foreground">✕</button>
            </div>
            {teamPreview.loading ? (
              <div className="text-center p-[30px] text-subtle-foreground">⏳ טוען…</div>
            ) : teamPreview.error ? (
              <div className="text-center p-[30px] text-danger">{teamPreview.error}</div>
            ) : teamPreview.data?.notNeededForPlan ? (
              <div className="px-4 py-3.5 bg-info-bg border border-info/[.19] rounded-md text-[13px] text-info">
                הצוות אישר שאין לו פעילות מיוחדת ב-CR זה.
              </div>
            ) : teamPreview.data ? (
              <>
                {teamPreview.data.actions.length > 0 && (
                  <div className="mb-3.5">
                    <div className="text-[11px] font-bold text-subtle-foreground uppercase mb-1.5">פעילויות ({teamPreview.data.actions.length})</div>
                    {teamPreview.data.actions.map((a, i) => (
                      <div key={i} className="px-3 py-2 bg-muted rounded-md mb-1.5 text-[12.5px] text-foreground">
                        <strong>{a.actionType}</strong>{a.system ? ` — ${a.system}` : ''}
                        <div className="text-muted-foreground mt-0.5">{a.description}</div>
                      </div>
                    ))}
                  </div>
                )}
                {teamPreview.data.monitoringPoints.length > 0 && (
                  <div className="mb-3.5">
                    <div className="text-[11px] font-bold text-subtle-foreground uppercase mb-1.5">נקודות בקרה ({teamPreview.data.monitoringPoints.length})</div>
                    {teamPreview.data.monitoringPoints.map((m, i) => (
                      <div key={i} className="px-3 py-2 bg-muted rounded-md mb-1.5 text-[12.5px] text-foreground">
                        <strong>{m.name}</strong> — {m.type}{m.note ? <div className="text-muted-foreground mt-0.5">{m.note}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
                {(teamPreview.data.rollbackPlan || teamPreview.data.rollbackType) && (
                  <div className="text-[12.5px] text-muted-foreground">
                    <strong>Rollback:</strong> {teamPreview.data.rollbackType ? `${teamPreview.data.rollbackType} — ` : ''}{teamPreview.data.rollbackPlan}
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Convert button ────────────────────────────────────────────────────────────
const ConvertButton: React.FC<{ token: string; versionId: string; onReload: () => void }> = ({ token, versionId, onReload }) => {
  const [converting, setConverting] = useState(false);
  const [done, setDone]             = useState(false);
  const [dialog, setDialog]         = useState<DialogConfig | null>(null);
  const headers = { Authorization: `Bearer ${token}` };

  const convert = () => {
    setDialog({
      title: 'המרת תוכנית לגרסה',
      message: 'כל ה-CR-ים אושרו. האם להמיר את כל ההצעות המאושרות למשימות בתוכנית הגרסה?',
      variant: 'info', confirmLabel: 'המר לתוכנית', cancelLabel: 'ביטול',
      onConfirm: async () => {
        setConverting(true);
        try {
          await axios.post(`${API}/task-proposals/version/${versionId}/convert-approved`, {}, { headers });
          setDone(true); onReload();
        } finally { setConverting(false); }
      },
      onCancel: () => {},
    });
  };

  return (
    <>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />
      {done ? (
        <div className="px-3.5 py-2 bg-success/20 text-success rounded-lg text-[15px] font-bold border border-success">
          ✓ הומר לתוכנית הגרסה
        </div>
      ) : (
        <button onClick={convert} disabled={converting}
          className="w-full py-2.5 bg-success text-foreground border-none rounded-lg cursor-pointer text-[15px] font-extrabold">
          {converting ? 'ממיר…' : '🚀 המר לתוכנית גרסה'}
        </button>
      )}
    </>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
export const CrReviewView: React.FC<Props> = ({ token, versionId: propVersionId, versionName: propVersionName }) => {
  const [data, setData]               = useState<CrEntry[]>([]);
  const [teams, setTeams]             = useState<any[]>([]);
  const [users, setUsers]             = useState<{ id: string; fullName: string }[]>([]);
  const [subPhaseOpts, setSubPhaseOpts] = useState<SubPhaseOpt[]>([]);
  const [loading, setLoading]         = useState(!!propVersionId);
  const [selectedCr, setSelectedCr]   = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'pending' | 'approved'>('all');
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(() => {
    if (!propVersionId) return;
    setLoading(true);
    Promise.all([
      axios.get(`${API}/versions/${propVersionId}/cr-review`, { headers }),
      axios.get(`${API}/teams`, { headers }),
      axios.get(`${API}/versions/${propVersionId}/sub-phases`, { headers }),
      axios.get(`${API}/users`, { headers }),
    ]).then(([crRes, teamRes, spRes, usersRes]) => {
      setData(crRes.data);
      setTeams((teamRes.data as any[]).filter(t => t.active));
      setUsers((usersRes.data as any[]).filter((u: any) => u.active).sort((a: any, b: any) => a.fullName.localeCompare(b.fullName, 'he')));
      const opts: SubPhaseOpt[] = [];
      for (const phase of spRes.data) {
        for (const sp of phase.subPhases) {
          opts.push({ id: sp.id, name: sp.name, phaseName: phase.name, phaseOrderIndex: phase.orderIndex });
        }
      }
      setSubPhaseOpts(opts);
    }).finally(() => setLoading(false));
  }, [propVersionId]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  // Auto-select first CR when data loads
  useEffect(() => {
    if (data.length > 0 && selectedCr === null) setSelectedCr(data[0].crNumber);
  }, [data, selectedCr]);

  if (loading) return (
    <div className="text-center p-20 text-subtle-foreground">
      <div className="text-4xl mb-3.5">⏳</div>טוען נתוני CR-ים...
    </div>
  );

  const allProposals    = data.flatMap(e => Object.values(e.proposalsByPhase).flat());
  const totalPending    = allProposals.filter(p => p.reviewStatus === 'PENDING').length;
  const approvedCrCount = data.filter(e => e.crApproved).length;
  const allCrsApproved  = data.length > 0 && approvedCrCount === data.length;

  const filteredData = data.filter(entry => {
    if (reviewFilter === 'approved') return entry.crApproved;
    if (reviewFilter === 'pending')  return !entry.crApproved;
    return true;
  });

  const selectedEntry = data.find(e => e.crNumber === selectedCr) ?? null;

  return (
    <div>
      {/* ── Header ── */}
      <div className="bg-card border border-border shadow-xs rounded-lg px-6 py-4 mb-[18px] flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-lg font-extrabold text-foreground">Consolidated CR Review — ישיבת מעבר</div>
          <div className="text-[13.5px] text-subtle-foreground mt-0.5">{propVersionName}</div>
        </div>
        <div className="flex gap-2.5 items-center">
          {[
            { val: data.length, lbl: 'CR-ים', colorClass: 'text-foreground' },
            { val: approvedCrCount, lbl: 'CR אושרו', colorClass: 'text-success' },
            { val: totalPending, lbl: 'ממתינות לסקירה', colorClass: 'text-warning' },
          ].map((s, i) => (
            <div key={i} className="text-center bg-muted rounded-md px-4 py-2">
              <div className={`text-xl font-extrabold ${s.colorClass}`}>{s.val}</div>
              <div className="text-[11px] text-subtle-foreground">{s.lbl}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Empty state ── */}
      {data.length === 0 && (
        <div className="text-center p-[60px] bg-card rounded-xl text-subtle-foreground">
          <div className="text-[32px] mb-3">📋</div>
          אין CR-ים מוגדרים לגרסה זו
        </div>
      )}

      {/* ── Split panel ── */}
      {data.length > 0 && (
        <div className="flex border border-border rounded-xl overflow-hidden bg-background" style={{ minHeight: '68vh' }}>
          {/* LEFT: CR list (RTL start = visual right) */}
          <div className="w-[252px] shrink-0 border-e border-border flex flex-col bg-card">
            {/* Filter bar */}
            <div className="px-3 py-2.5 border-b border-border flex gap-1.5 items-center shrink-0">
              {(['all', 'pending', 'approved'] as const).map(f => (
                <button key={f} onClick={() => setReviewFilter(f)}
                  className={`px-2.5 py-[3px] border-none rounded-full cursor-pointer text-[13px] font-semibold transition-colors duration-fast ease-out ${reviewFilter === f ? 'bg-foreground text-white' : 'bg-muted text-subtle-foreground'}`}>
                  {f === 'all' ? 'הכל' : f === 'pending' ? 'ממתין' : 'אושר'}
                </button>
              ))}
              <div className="flex-1" />
              <span className="text-[13px] text-subtle-foreground font-semibold">{approvedCrCount}/{data.length}</span>
            </div>

            {/* CR list items */}
            <div className="flex-1 overflow-y-auto">
              {filteredData.map(entry => {
                const all = Object.values(entry.proposalsByPhase).flat();
                const approved = all.filter(p => p.reviewStatus === 'APPROVED').length;
                const pct = all.length ? Math.round(approved / all.length * 100) : 0;
                const riskLvl = entry.teams.find(t => t.crPlan.riskLevel)?.crPlan.riskLevel ?? '';
                const isSelected = selectedCr === entry.crNumber;
                const dotColor = entry.crApproved ? C.success : pct === 100 ? C.warning : pct > 0 ? C.info : C.borderEm;

                return (
                  // Hover kept as a plain conditional class (not JS-driven): when
                  // selected the row always stays tinted; otherwise a Tailwind
                  // hover: class applies the exact same muted tint the original
                  // onMouseEnter/onMouseLeave pair set imperatively.
                  <div key={entry.crNumber} onClick={() => setSelectedCr(entry.crNumber)}
                    className={`flex items-start gap-2.5 px-3.5 py-2.5 cursor-pointer border-b border-muted transition-colors duration-fast ease-out ${isSelected ? 'bg-info-bg' : 'bg-transparent hover:bg-muted'}`}
                    style={{ borderInlineEnd: `3px solid ${isSelected ? C.brand : 'transparent'}` }}
                  >
                    <div className="w-[7px] h-[7px] rounded-full shrink-0 mt-1.5" style={{ background: dotColor }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-foreground font-mono">{entry.crNumber}</div>
                      <div className="text-[13px] text-subtle-foreground leading-snug mt-px overflow-hidden text-ellipsis whitespace-nowrap"
                        title={entry.crLabel !== entry.crNumber ? entry.crLabel.replace(/^\S+\s*-\s*/, '') : ''}>
                        {entry.crLabel !== entry.crNumber ? entry.crLabel.replace(/^\S+\s*-\s*/, '') : '—'}
                      </div>
                      <div className="text-xs mt-[3px] flex items-center gap-1.5 flex-wrap">
                        {riskLvl && (
                          <span className={`px-1.5 py-px rounded font-semibold text-xs ${RISK_COLOR_CLASS[riskLvl]}`}>{RISK_LABELS[riskLvl]}</span>
                        )}
                        <span className={entry.crApproved ? 'text-success' : 'text-subtle-foreground'}>
                          {entry.crApproved ? '✓ אושר' : all.length === 0 ? 'לא נדרש' : `${approved}/${all.length}`}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {filteredData.length === 0 && (
                <div className="px-3.5 py-[30px] text-center text-subtle-foreground text-sm">אין תוצאות</div>
              )}
            </div>

            {/* Convert button at bottom */}
            {allCrsApproved && (
              <div className="px-3 py-2.5 border-t border-border shrink-0">
                <ConvertButton token={token} versionId={propVersionId!} onReload={load} />
              </div>
            )}
          </div>

          {/* RIGHT: detail */}
          {selectedEntry ? (
            <CrCard
              key={selectedEntry.crNumber}
              entry={selectedEntry} token={token} versionId={propVersionId!}
              teams={teams} users={users} subPhaseOpts={subPhaseOpts} onReload={load}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-subtle-foreground text-[15px] flex-col gap-2.5">
              <div className="text-[32px]">📋</div>
              בחר CR מהרשימה לצפייה
            </div>
          )}
        </div>
      )}
    </div>
  );
};
