import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';
import { useDialog } from '../context/DialogContext';
import { C, FONT, FONT_MONO, RADIUS, SHADOW } from '../theme';
import { cleanHtmlText } from '../utils/textSanitize';
import { formatDate } from '../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const PHASE_LABELS: Record<number, string> = {
  1: 'בוקר לפני גרסה', 2: 'הטמעה בהוטנט', 3: 'הטמעה בהוט', 4: 'בוקר שלאחר גרסה',
};
const PHASE_BADGE: Record<number, { bg: string; color: string }> = {
  1: { bg: C.infoBg,    color: C.info },
  2: { bg: C.successBg, color: C.success },
  3: { bg: C.warningBg, color: C.warning },
  4: { bg: C.bgWaiting, color: C.statusWaiting },
};
const SUBMISSION_META: Record<string, { label: string; dot: string }> = {
  NOT_STARTED: { label: 'אין התייחסות', dot: C.textDisabled },
  DRAFT:       { label: 'טיוטה',         dot: C.warning },
  RETURNED:    { label: 'הוחזר',         dot: C.danger },
  SUBMITTED:   { label: 'הוגש',          dot: C.success },
  APPROVED:    { label: 'אושר',          dot: C.success },
};
const REVIEW_META: Record<string, { label: string; bg: string; color: string; border: string }> = {
  PENDING:        { label: 'ממתין',    bg: C.bgNested,  color: C.textMuted,     border: C.border },
  APPROVED:       { label: 'אושר ✓',  bg: C.bgDone,    color: C.statusDone,    border: C.statusDone },
  REJECTED:       { label: 'נדחה ✗',  bg: C.dangerBg,  color: C.statusFailed,  border: C.danger },
  NEEDS_REVISION: { label: 'לתיקון', bg: C.warningBg, color: C.warning,       border: C.warning },
};
const RISK_COLORS: Record<string, { bg: string; color: string }> = {
  LOW:    { bg: C.bgDone,    color: C.statusDone },
  MEDIUM: { bg: C.warningBg, color: C.warning },
  HIGH:   { bg: C.dangerBg,  color: C.statusFailed },
};
const RISK_LABELS: Record<string, string> = { LOW: 'נמוך', MEDIUM: 'בינוני', HIGH: 'גבוה' };

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

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1px solid #ddd',
  borderRadius: '6px', fontSize: '15px', boxSizing: 'border-box', direction: 'rtl',
};
const labelStyle: React.CSSProperties = {
  fontSize: '14px', color: '#555', display: 'block', marginBottom: '4px', fontWeight: 'bold',
};

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
    <div style={{ background: '#fffdf0', border: '2px solid #f39c12', borderRadius: '10px', padding: '16px', margin: '6px 0' }}>
      <div style={{ fontWeight: 'bold', fontSize: '15px', marginBottom: '14px', color: '#1a2332' }}>
        {initial?.id ? 'עריכת משימה' : 'הוספת משימה חדשה'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>CR מקושר</label>
          <div style={{ padding: '8px 12px', background: '#e8f4fd', border: '1px solid #aed6f1', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ background: '#1a2332', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '14px', fontWeight: 'bold', fontFamily: 'monospace', flexShrink: 0 }}>{crNumber}</span>
          </div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>תיאור המשימה <span style={{ color: '#e74c3c' }}>*</span></label>
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
            style={{ ...inputStyle, borderColor: !title.trim() ? '#e74c3c' : undefined }}
            placeholder="תאר את הצעד שיש לבצע..." />
        </div>
        <div>
          <label style={labelStyle}>שלב <span style={{ color: '#e74c3c' }}>*</span></label>
          <select value={phase} onChange={e => { setPhase(parseInt(e.target.value)); setSubPhaseId(''); }} style={inputStyle}>
            {[1,2,3,4].map(ph => <option key={ph} value={ph}>{phaseLabels[ph] || PHASE_LABELS[ph]}</option>)}
          </select>
        </div>
        <div>
          <label style={{ ...labelStyle, color: '#2d4a7a' }}>תת-שלב (אופציונלי)</label>
          {filteredSubPhases.length > 0 ? (
            <select value={subPhaseId} onChange={e => setSubPhaseId(e.target.value)}
              style={{ ...inputStyle, background: subPhaseId ? '#e8f4fd' : undefined }}>
              <option value="">-- בחר תת-שלב --</option>
              {filteredSubPhases.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
            </select>
          ) : (
            <div style={{ padding: '8px 12px', background: '#f8f8f8', borderRadius: '6px', fontSize: '14px', color: '#aaa' }}>אין תת-שלבים לשלב זה</div>
          )}
        </div>
        <div>
          <label style={labelStyle}>סוג פעולה <span style={{ color: '#e74c3c' }}>*</span></label>
          <select value={actionType} onChange={e => { const v = e.target.value; setActionType(v); if (!title) setTitle(v); }}
            style={{ ...inputStyle, borderColor: !actionType ? '#e74c3c' : undefined }}>
            <option value="">-- בחר --</option>
            {ACTION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>מערכת <span style={{ color: '#e74c3c' }}>*</span></label>
          <select value={app} onChange={e => setApp(e.target.value)}
            style={{ ...inputStyle, borderColor: !app ? '#e74c3c' : undefined }}>
            <option value="">-- בחר --</option>
            {APPS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>צוות אחראי</label>
          <select value={teamId} onChange={e => { setTeamId(e.target.value); setAssignedUserName(''); }} style={inputStyle}>
            <option value="">-- בחר צוות --</option>
            {teams.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>עובד אחראי <span style={{ color: '#e74c3c' }}>*</span></label>
          <select value={assignedUserName} onChange={e => setAssignedUserName(e.target.value)}
            style={{ ...inputStyle, borderColor: !assignedUserName ? '#e74c3c' : undefined }}>
            <option value="">-- בחר עובד --</option>
            {teamMembers.map(u => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>משך משוער (דקות) <span style={{ color: '#e74c3c' }}>*</span></label>
          <input type="number" min={1} value={estimatedMins} onChange={e => setEstimatedMins(e.target.value)}
            style={{ ...inputStyle, borderColor: !estimatedMins ? '#e74c3c' : undefined }} placeholder="למשל 30" />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>הערות</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            style={{ ...inputStyle, height: '60px', resize: 'vertical' }}
            placeholder="פרמטרים, הוראות מיוחדות, תלויות..." />
        </div>
      </div>
      {error && <div style={{ color: '#e74c3c', fontSize: '15px', marginTop: '8px' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
        <button onClick={save} disabled={saving}
          style={{ padding: '8px 20px', background: saving ? '#aaa' : '#27ae60', color: 'white', border: 'none', borderRadius: '8px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
          {saving ? 'שומר...' : initial?.id ? 'שמור שינויים' : 'הוסף'}
        </button>
        <button onClick={onCancel}
          style={{ padding: '8px 16px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '15px' }}>
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

  const btnBase: React.CSSProperties = {
    padding: '3px 8px', border: `1px solid ${C.border}`, borderRadius: '6px',
    cursor: saving ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 600, background: C.bgNested, color: C.textMuted,
  };

  const tColor = teamColor(proposal.teamName);
  const depNote = proposal.notes && isDependencyNote(proposal.notes);

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: '11px', paddingBottom: isLast ? 0 : '10px' }}>
      {/* Connecting thread — visually links merged tasks (possibly from
          different teams) into one sequential story within the phase. */}
      {!isLast && (
        <div style={{ position: 'absolute', top: '26px', bottom: '-2px', right: '13px', width: '2px', background: C.border }} />
      )}
      <div style={{
        width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0, zIndex: 1,
        background: meta.color === C.textMuted ? C.bgNested : `${meta.color}18`,
        border: `1.5px solid ${meta.color}`, color: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '12px', fontWeight: 800,
      }}>
        {proposal.reviewStatus === 'APPROVED' ? '✓' : stepIndex}
      </div>

      <div style={{
        flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: '9px',
        padding: '9px 12px', borderRadius: '8px',
        background: C.bgApp, border: `1px solid ${C.border}`,
        borderRight: `3px solid ${meta.border}`,
      }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '15px', color: C.textPrimary, lineHeight: 1.5 }}>
          <strong>{proposal.actionType || proposal.title}</strong>
          {proposal.app && <span style={{ color: C.textSecondary }}> — {proposal.app}</span>}
        </div>
        <div style={{ fontSize: '13px', color: C.textMuted, marginTop: '3px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            background: `${tColor}16`, color: tColor, border: `1px solid ${tColor}40`,
            borderRadius: '999px', padding: '1px 8px', fontWeight: 700, fontSize: '12px',
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: tColor }} />
            {proposal.teamName}
          </span>
          {proposal.assignedUserName && <span>👤 {proposal.assignedUserName}</span>}
          {proposal.estimatedMins && <span>⏱ כ-{proposal.estimatedMins} דק'</span>}
        </div>
        {proposal.title !== proposal.actionType && proposal.title && proposal.actionType && (
          <div style={{ fontSize: '13px', color: C.textSecondary, marginTop: '2px', fontStyle: 'italic' }}>{proposal.title}</div>
        )}
        {proposal.notes && (
          <div style={{
            fontSize: '13px', marginTop: '3px',
            color: depNote ? C.info : C.textMuted,
            fontWeight: depNote ? 600 : 400,
          }}>
            {depNote ? '↳' : '💬'} {cleanHtmlText(proposal.notes)}
          </div>
        )}
        {proposal.reviewNote && !showNote && (
          <div style={{ fontSize: '13px', color: C.warning, marginTop: '3px', background: C.warningBg, padding: '3px 7px', borderRadius: '5px', display: 'inline-block' }}>
            ⚠ {proposal.reviewNote}
          </div>
        )}
        {showNote && (
          <div style={{ display: 'flex', gap: '5px', marginTop: '6px' }}>
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              placeholder="הערה לצוות..." autoFocus
              style={{ flex: 1, padding: '5px 9px', borderRadius: '6px', border: `1px solid ${C.warning}`, fontSize: '14px', direction: 'rtl', outline: 'none', fontFamily: FONT }} />
            <button onClick={() => setReview('NEEDS_REVISION', note)} disabled={saving}
              style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: C.warning, color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>שלח</button>
            <button onClick={() => setShowNote(false)}
              style={{ padding: '5px 9px', borderRadius: '6px', border: `1px solid ${C.border}`, background: 'white', cursor: 'pointer', fontSize: '13px' }}>ביטול</button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '3px', flexShrink: 0, marginTop: '1px' }}>
        <button onClick={() => proposal.reviewStatus !== 'APPROVED' && setReview('APPROVED')} disabled={saving} title="אשר"
          style={{ ...btnBase, background: proposal.reviewStatus === 'APPROVED' ? C.success : C.bgNested, color: proposal.reviewStatus === 'APPROVED' ? 'white' : C.textMuted, borderColor: proposal.reviewStatus === 'APPROVED' ? C.success : C.border }}>✓</button>
        <button onClick={() => setShowNote(v => !v)} disabled={saving} title="לתיקון"
          style={{ ...btnBase, background: proposal.reviewStatus === 'NEEDS_REVISION' ? C.warning : C.bgNested, color: proposal.reviewStatus === 'NEEDS_REVISION' ? 'white' : C.textMuted, borderColor: proposal.reviewStatus === 'NEEDS_REVISION' ? C.warning : C.border }}>✎</button>
        <button onClick={() => proposal.reviewStatus !== 'REJECTED' && setReview('REJECTED')} disabled={saving} title="דחה"
          style={{ ...btnBase, background: proposal.reviewStatus === 'REJECTED' ? C.danger : C.bgNested, color: proposal.reviewStatus === 'REJECTED' ? 'white' : C.textMuted, borderColor: proposal.reviewStatus === 'REJECTED' ? C.danger : C.border }}>✗</button>
        <button onClick={() => setEditing(true)} title="ערוך" style={{ ...btnBase, fontSize: '13px' }}>⚙</button>
        <button onClick={remove} title="מחק" style={{ ...btnBase, color: C.danger, fontSize: '13px' }}>🗑</button>
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
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ fontWeight: 700, fontSize: '15px', color: accent }}>{icon} {title}</div>
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
            style={{ fontSize: '13px', padding: '3px 10px', background: `${accent}15`, color: accent, border: `1px solid ${accent}40`, borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 600 }}>
            ⚡ הפק משימות
          </button>
        </div>
        {items.map((item, i) => (
          <div key={i} style={{ background: 'white', borderRadius: '8px', padding: '12px 16px', marginBottom: '8px', borderRight: `4px solid ${accent}`, border: `1px solid ${accent}25`, borderRightWidth: '4px' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#2d4a7a', marginBottom: '6px' }}>{item.teamName}</div>
            <div style={{ fontSize: '15px', color: '#1a2332', lineHeight: '1.65', whiteSpace: 'pre-wrap' }}>{item.text}</div>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: 800, color: C.brand }}>✨ סיכום AI — התוכנית המאוחדת</div>
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
            style={{ fontSize: '11px', fontWeight: 700, padding: '5px 12px', background: C.bgCard, color: C.textSecondary, border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.full, cursor: summarizing ? 'not-allowed' : 'pointer', opacity: summarizing ? 0.6 : 1 }}>
            {summarizing ? '⏳ מסכם...' : summary ? '🔄 עדכן' : '✨ סכם תוכנית'}
          </button>
        </div>
        {summary && (
          <div style={{ background: C.bgCard, border: `1px solid ${C.brand}38`, borderRadius: RADIUS.lg, padding: '14px 18px', marginBottom: '16px' }}>
            <div style={{ fontSize: '12.5px', color: C.textPrimary, lineHeight: '1.8', whiteSpace: 'pre-wrap' }}>{summary}</div>
            <button onClick={() => setSummary('')}
              style={{ marginTop: '8px', fontSize: '13px', padding: '2px 10px', background: 'none', border: `1px solid ${C.brand}40`, borderRadius: RADIUS.sm, color: C.brand, cursor: 'pointer' }}>
              ✕ סגור
            </button>
          </div>
        )}

        {/* CR file meta */}
        {(crMgr || crDesc) && (
          <div style={{ marginBottom: '14px', paddingBottom: '12px', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: 'grid', gridTemplateColumns: crMgr ? '1fr 1fr' : '1fr', gap: '8px', marginBottom: crDesc ? '8px' : 0 }}>
              <div>
                <div style={{ fontSize: '13px', color: C.textMuted, fontWeight: 700, marginBottom: '3px' }}>שם ה-CR</div>
                <div style={{ background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '8px 12px', fontSize: '15px', color: C.textPrimary }}>
                  {entry.crLabel !== entry.crNumber ? entry.crLabel.replace(/^\S+\s*-\s*/, '') : '—'}
                </div>
              </div>
              {crMgr && (
                <div>
                  <div style={{ fontSize: '13px', color: C.textMuted, fontWeight: 700, marginBottom: '3px' }}>מנהל CR</div>
                  <div style={{ background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '8px 12px', fontSize: '15px', color: C.textPrimary }}>{crMgr}</div>
                </div>
              )}
            </div>
            {crDesc && (
              <div>
                <div style={{ fontSize: '13px', color: C.textMuted, fontWeight: 700, marginBottom: '3px' }}>פרטים</div>
                <div style={{ background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '8px 12px', fontSize: '15px', color: C.textPrimary, whiteSpace: 'pre-wrap' }}>{crDesc}</div>
              </div>
            )}
          </div>
        )}

        {/* Team chips */}
        {entry.teams.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px', paddingBottom: '12px', borderBottom: `1px solid ${C.border}` }}>
            {entry.teams.map(t => (
              <div key={t.teamId} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '5px 11px', fontSize: '14px' }}>
                <span style={{ fontWeight: 700, color: C.textPrimary }}>{t.teamName}</span>
                {t.teamLead && <span style={{ color: C.textMuted, marginRight: '5px' }}>· {t.teamLead}</span>}
              </div>
            ))}
          </div>
        )}

        {!hasAnyPlan && (
          <div style={{ textAlign: 'center', padding: '30px', color: C.textDisabled, fontSize: '15px', fontStyle: 'italic' }}>לא הוזנו פרטי תכנית</div>
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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />

      {/* ── Topbar ── */}
      <div style={{
        padding: '12px 16px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap',
        background: C.bgCard, flexShrink: 0,
      }}>
        <span style={{ background: C.textPrimary, color: 'white', padding: '3px 10px', borderRadius: '6px', fontFamily: FONT_MONO, fontWeight: 700, fontSize: '15px', flexShrink: 0 }}>
          {entry.crNumber}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '16px', color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.crLabel !== entry.crNumber ? entry.crLabel.replace(/^\S+\s*-\s*/, '') : ''}
          </div>
          <div style={{ fontSize: '14px', color: C.textMuted, marginTop: '1px' }}>
            {entry.managers.length > 0 && `מנהל: ${entry.managers.join(', ')} · `}
            {entry.teams.length} צוותים · {allProposals.length} הצעות
          </div>
        </div>
        {riskLevel && (
          <span style={{ fontSize: '13px', fontWeight: 700, padding: '3px 9px', borderRadius: '6px', flexShrink: 0, ...RISK_COLORS[riskLevel] }}>
            סיכון {RISK_LABELS[riskLevel]}
          </span>
        )}
        {crType && (
          <span style={{ fontSize: '13px', background: C.bgNested, color: C.textSecondary, padding: '2px 8px', borderRadius: '6px', flexShrink: 0 }}>{crType}</span>
        )}
        {/* Approval status / action */}
        {crApproved ? (
          <>
            <span style={{ fontSize: '14px', fontWeight: 700, color: C.success, background: C.bgDone, padding: '3px 10px', borderRadius: '99px', border: `1px solid ${C.success}40`, flexShrink: 0 }}>
              ✓ CR אושר
            </span>
            <button onClick={async () => {
              await axios.patch(`${API}/cr-plans/version/${versionId}/unapprove-cr`, { crNumber: entry.crNumber }, { headers });
              onReload();
            }} style={{ padding: '4px 10px', background: 'white', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: '7px', cursor: 'pointer', fontSize: '13px', flexShrink: 0 }}>
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
            style={{ padding: '10px 20px', background: C.moduleGoLive, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: approving ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 700, flexShrink: 0, boxShadow: SHADOW.sm }}>
            {approving ? 'שומר…' : '✓ אשר תוכנית מאוחדת'}
          </button>
        ) : !allTeamsSubmitted ? (
          <span style={{ fontSize: '13px', color: C.warning, background: C.warningBg, padding: '3px 9px', borderRadius: '6px', border: `1px solid ${C.warning}40`, flexShrink: 0 }}>
            ⚠ ממתין להגשה מ-{teamsWithoutSubmission.length} צוותים
          </span>
        ) : pendingCount > 0 ? (
          <span style={{ fontSize: '13px', color: C.textMuted, background: C.bgNested, padding: '3px 9px', borderRadius: '6px', border: `1px solid ${C.border}`, flexShrink: 0 }}>
            {pendingCount} ממתינות לסקירה
          </span>
        ) : null}
      </div>

      {/* ── TARGET CR summary — replaces the normal per-team status meaning for
          umbrella CRs wrapping a batch of QC defects, not real development ── */}
      {isTargetCr && targetSummary && (
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, background: `${C.moduleGoLive}0d`, flexShrink: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: C.moduleGoLive, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '8px' }}>
            🎯 TARGET CR — תקלות QC
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {targetSummary.teams.map(t => (
              <span key={t.teamId} style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '999px',
                border: `1px solid ${C.borderEm}`, background: C.bgCard, fontSize: '12px', fontWeight: 700,
              }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: t.approved ? C.success : C.warning }} />
                {t.teamName} · {t.defectCount} תקלות{t.approved ? ' · אושר' : ''}
              </span>
            ))}
          </div>
          <div style={{ fontSize: '13px', color: C.textSecondary }}>
            <strong style={{ color: C.textPrimary }}>{targetSummary.totalDefects}</strong> תקלות TARGET סה"כ ·{' '}
            <strong style={{ color: C.textPrimary }}>{targetSummary.totalSpecial}</strong> דורשות הטמעה מיוחדת ·{' '}
            <strong style={{ color: C.textPrimary }}>{targetSummary.totalManagement}</strong> סומנו כחשובות להנהלה
          </div>
        </div>
      )}

      {/* ── Teams status strip + KPI row ── */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, background: C.bgApp, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            סטטוס הגשה לפי צוות
          </div>
          <button onClick={toggleNarrate}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: C.moduleGoLive, background: `${C.moduleGoLive}18`, border: `1px solid ${C.moduleGoLive}4d`, padding: '4px 12px', borderRadius: RADIUS.full, cursor: 'pointer' }}>
            {speaking ? '⏹ עצור הקראה' : '🔊 מצב הקראה'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
          {entry.teams.map(t => {
            const meta = SUBMISSION_META[t.crPlan.submissionStatus ?? 'NOT_STARTED'] ?? SUBMISSION_META.NOT_STARTED;
            const canPreview = ['SUBMITTED', 'APPROVED'].includes(t.crPlan.submissionStatus ?? '') && !t.crPlan.notNeededForPlan;
            const canApproveTeam = canPreview;
            const isBusy = approvingTeam === t.teamId;
            return (
              <span key={t.teamId}
                style={{
                  display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 12px',
                  borderRadius: RADIUS.full, border: `1px solid ${C.borderEm}`, background: C.bgCard,
                  fontSize: '12.5px', fontWeight: 700,
                }}>
                <span onClick={() => canPreview && openTeamPreview(t.teamId, t.teamName)}
                  style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: canPreview ? 'pointer' : 'default' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: meta.dot, flexShrink: 0 }} />
                  {t.teamName} · {t.crPlan.notNeededForPlan ? 'אין פעילות מיוחדת' : meta.label}
                </span>
                {canApproveTeam && (
                  <button onClick={() => approveTeamPlan(t.teamId, !t.crPlan.planApproved)} disabled={isBusy}
                    style={{ fontSize: '11px', fontWeight: 700, color: t.crPlan.planApproved ? C.textMuted : C.success, background: 'transparent', border: 'none', cursor: isBusy ? 'not-allowed' : 'pointer', padding: 0 }}>
                    {isBusy ? '…' : t.crPlan.planApproved ? '↩ בטל' : '✓ Approve Team'}
                  </button>
                )}
              </span>
            );
          })}
        </div>

        {!allTeamsSubmitted && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px', background: C.warningBg,
            border: `1px solid ${C.warning}40`, borderRadius: RADIUS.md, padding: '9px 14px',
            fontSize: '12.5px', color: C.warning, fontWeight: 600, marginBottom: '14px',
          }}>
            ⚠ לא ניתן לאשר את ה-CR — ממתין להתייחסות {teamsWithoutSubmission.map(t => t.teamName).join(', ')}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
          {[
            { label: 'צוותים מעורבים', val: entry.teams.length },
            { label: 'משימות בתוכנית המאוחדת', val: allProposals.length },
            { label: 'נקודות בקרה',   val: entry.monitoringPointsTotal ?? 0 },
            { label: 'מוכן לאישור?',   val: crApproved ? '✓ אושר' : allReviewed ? 'מוכן' : !allTeamsSubmitted ? `ממתין ל-${teamsWithoutSubmission.length}` : `${pendingCount} לסקירה`, warn: !crApproved && !allReviewed },
          ].map((kpi, i) => (
            <div key={i} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '10px 14px', boxShadow: SHADOW.xs }}>
              <div style={{ fontSize: '10.5px', fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{kpi.label}</div>
              <div style={{ fontSize: typeof kpi.val === 'string' && kpi.val.length > 6 ? '15px' : '22px', fontWeight: 800, marginTop: '4px', color: kpi.warn ? C.warning : C.textPrimary }}>{kpi.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, background: C.bgCard, flexShrink: 0 }}>
        {(['tasks', 'plan'] as const).map(tab => {
          const label = tab === 'tasks' ? `משימות (${allProposals.length})` : 'תוכנית CR';
          const active = selectedTab === tab;
          return (
            <button key={tab} onClick={() => setSelectedTab(tab)}
              style={{ padding: '9px 18px', border: 'none', borderBottom: `2px solid ${active ? C.brand : 'transparent'}`, background: 'transparent', color: active ? C.brand : C.textMuted, cursor: 'pointer', fontWeight: active ? 700 : 400, fontSize: '15px', fontFamily: FONT, transition: 'color 0.15s', flexShrink: 0 }}>
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Tab content ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {selectedTab === 'tasks' ? (
          <>
            {/* Approve-all bar */}
            {pendingCount > 0 && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', padding: '8px 12px', background: C.infoBg, borderRadius: '8px', border: `1px solid ${C.info}25` }}>
                <span style={{ fontSize: '14px', color: C.info, flex: 1 }}>{pendingCount} הצעות ממתינות לסקירה</span>
                <button onClick={approveAll} disabled={approvingAll}
                  style={{ padding: '5px 14px', background: C.info, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}>
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
              const pb = PHASE_BADGE[phase];
              const phaseName = subPhaseOpts.find(sp => sp.phaseOrderIndex === phase)?.phaseName || PHASE_LABELS[phase];
              const phasePending = phaseProposals.filter(p => p.reviewStatus === 'PENDING').length;
              return (
                <div key={phase} style={{ marginBottom: '18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', padding: '6px 12px', background: pb.bg, borderRadius: '7px', border: `1px solid ${pb.color}25` }}>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: pb.color }}>{phaseName}</span>
                    <span style={{ fontSize: '13px', color: pb.color, background: 'white', padding: '1px 7px', borderRadius: '8px', border: `1px solid ${pb.color}30` }}>{phaseProposals.length}</span>
                    {phasePending > 0 && (
                      <button onClick={() => approvePhase(phase)} disabled={approvingPhase === phase}
                        style={{ marginRight: 'auto', fontSize: '11.5px', fontWeight: 700, color: pb.color, background: 'white', border: `1px solid ${pb.color}40`, borderRadius: RADIUS.full, padding: '3px 10px', cursor: 'pointer', flexShrink: 0 }}>
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
              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, boxShadow: SHADOW.xs, padding: '14px 16px', marginBottom: '16px' }}>
                <div style={{ fontSize: '13.5px', fontWeight: 800, color: C.textPrimary, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  ↩ Rollback מרוכז
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {entry.teams.filter(t => t.crPlan.rollbackPlan || t.crPlan.rollbackType).map(t => {
                    const tColor = teamColor(t.teamName);
                    return (
                      <div key={t.teamId} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12.5px', color: C.textSecondary }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: RADIUS.full, color: 'white', background: tColor, flexShrink: 0 }}>{t.teamName}</span>
                        <span>{t.crPlan.rollbackType ? `${t.crPlan.rollbackType} — ` : ''}{t.crPlan.rollbackPlan || 'אין פירוט נוסף'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {allProposals.length === 0 && !addOpen && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: C.textDisabled }}>
                <div style={{ fontSize: '28px', marginBottom: '10px' }}>📋</div>
                <div style={{ fontSize: '15px' }}>אין הצעות משימות לCR זה</div>
              </div>
            )}

            {!addOpen && (
              <button onClick={() => setAddOpen(true)}
                style={{ width: '100%', padding: '9px', background: C.bgNested, color: C.textSecondary, border: `1px dashed ${C.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '15px', marginTop: '8px', fontFamily: FONT }}>
                + הוסף משימה לביצוע
              </button>
            )}
          </>
        ) : renderPlanTab()}
      </div>

      {/* ── Extract modal ── */}
      {extractModalCr && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl' }}>
          <div style={{ background: 'white', borderRadius: '14px', padding: '24px 28px', maxWidth: '560px', width: '95vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ fontWeight: 700, fontSize: '17px', color: '#1a2332', marginBottom: '4px' }}>⚡ הפק משימות מ{extractModalCr.sourceLabel}</div>
            <div style={{ fontSize: '14px', color: '#888', marginBottom: '16px' }}>CR {extractModalCr.crNumber} — בחר שורות להפוך למשימות</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              {extractModalCr.items.map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', borderRadius: '8px', background: item.checked ? '#f0f7ff' : '#fafafa', border: `1px solid ${item.checked ? '#aed6f1' : '#e0e0e0'}` }}>
                  <input type="checkbox" checked={item.checked}
                    onChange={e => setExtractModalCr(m => m ? { ...m, items: m.items.map((it, j) => j === i ? { ...it, checked: e.target.checked } : it) } : null)}
                    style={{ marginTop: '3px', flexShrink: 0, cursor: 'pointer' }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <input value={item.text} disabled={!item.checked}
                      onChange={e => setExtractModalCr(m => m ? { ...m, items: m.items.map((it, j) => j === i ? { ...it, text: e.target.value } : it) } : null)}
                      style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '15px', color: C.textPrimary, outline: 'none', fontFamily: FONT, boxSizing: 'border-box' as const }} />
                    {item.duplicateId && <span style={{ fontSize: '12px', color: '#e67e22', fontWeight: 600 }}>⚠ כבר קיימת — תישאל אם להחליף</span>}
                  </div>
                  <input type="number" min={1} value={item.estimatedMins} disabled={!item.checked}
                    onChange={e => setExtractModalCr(m => m ? { ...m, items: m.items.map((it, j) => j === i ? { ...it, estimatedMins: e.target.value } : it) } : null)}
                    placeholder="דק'" style={{ width: '54px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '5px', padding: '2px 4px', textAlign: 'center' as const, flexShrink: 0 }} />
                  <select value={item.phase} disabled={!item.checked}
                    onChange={e => setExtractModalCr(m => m ? { ...m, items: m.items.map((it, j) => j === i ? { ...it, phase: parseInt(e.target.value) } : it) } : null)}
                    style={{ fontSize: '13px', border: '1px solid #ddd', borderRadius: '5px', padding: '2px 4px', flexShrink: 0 }}>
                    {[1,2,3,4].map(ph => <option key={ph} value={ph}>{PHASE_LABELS[ph]}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              <button onClick={() => setExtractModalCr(m => m ? { ...m, items: m.items.map(it => ({ ...it, checked: true })) } : null)} style={{ fontSize: '14px', padding: '4px 10px', border: '1px solid #ddd', borderRadius: '6px', background: 'white', cursor: 'pointer' }}>בחר הכל</button>
              <button onClick={() => setExtractModalCr(m => m ? { ...m, items: m.items.map(it => ({ ...it, checked: false })) } : null)} style={{ fontSize: '14px', padding: '4px 10px', border: '1px solid #ddd', borderRadius: '6px', background: 'white', cursor: 'pointer' }}>בטל הכל</button>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setExtractModalCr(null)} style={{ padding: '8px 18px', border: '1px solid #ddd', borderRadius: '8px', background: 'white', cursor: 'pointer', fontSize: '15px' }}>ביטול</button>
              <button onClick={createExtractedCr} disabled={extractingCr || extractModalCr.items.filter(i => i.checked).length === 0}
                style={{ padding: '8px 22px', border: 'none', borderRadius: '8px', background: extractModalCr.items.filter(i => i.checked).length === 0 ? '#ddd' : '#1a2332', color: extractModalCr.items.filter(i => i.checked).length === 0 ? '#aaa' : 'white', cursor: 'pointer', fontSize: '15px', fontWeight: 700 }}>
                {extractingCr ? 'יוצר…' : `צור ${extractModalCr.items.filter(i => i.checked).length} משימות`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Team plan preview modal ── */}
      {teamPreview && (
        <div style={{ position: 'fixed', inset: 0, background: C.bgOverlay, zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setTeamPreview(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: C.bgCard, borderRadius: RADIUS.xl, padding: '22px 24px', maxWidth: '540px', width: '92vw', maxHeight: '82vh', overflowY: 'auto', boxShadow: SHADOW.floating }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{ fontSize: '16px', fontWeight: 800, color: C.textPrimary }}>תקציר תוכנית — {teamPreview.teamName}</div>
              <button onClick={() => setTeamPreview(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '18px', color: C.textMuted }}>✕</button>
            </div>
            {teamPreview.loading ? (
              <div style={{ textAlign: 'center', padding: '30px', color: C.textMuted }}>⏳ טוען…</div>
            ) : teamPreview.error ? (
              <div style={{ textAlign: 'center', padding: '30px', color: C.danger }}>{teamPreview.error}</div>
            ) : teamPreview.data?.notNeededForPlan ? (
              <div style={{ padding: '14px 16px', background: C.infoBg, border: `1px solid ${C.info}30`, borderRadius: RADIUS.md, fontSize: '13px', color: C.info }}>
                הצוות אישר שאין לו פעילות מיוחדת ב-CR זה.
              </div>
            ) : teamPreview.data ? (
              <>
                {teamPreview.data.actions.length > 0 && (
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', marginBottom: '6px' }}>פעילויות ({teamPreview.data.actions.length})</div>
                    {teamPreview.data.actions.map((a, i) => (
                      <div key={i} style={{ padding: '8px 12px', background: C.bgNested, borderRadius: RADIUS.md, marginBottom: '6px', fontSize: '12.5px', color: C.textPrimary }}>
                        <strong>{a.actionType}</strong>{a.system ? ` — ${a.system}` : ''}
                        <div style={{ color: C.textSecondary, marginTop: '2px' }}>{a.description}</div>
                      </div>
                    ))}
                  </div>
                )}
                {teamPreview.data.monitoringPoints.length > 0 && (
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', marginBottom: '6px' }}>נקודות בקרה ({teamPreview.data.monitoringPoints.length})</div>
                    {teamPreview.data.monitoringPoints.map((m, i) => (
                      <div key={i} style={{ padding: '8px 12px', background: C.bgNested, borderRadius: RADIUS.md, marginBottom: '6px', fontSize: '12.5px', color: C.textPrimary }}>
                        <strong>{m.name}</strong> — {m.type}{m.note ? <div style={{ color: C.textSecondary, marginTop: '2px' }}>{m.note}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
                {(teamPreview.data.rollbackPlan || teamPreview.data.rollbackType) && (
                  <div style={{ fontSize: '12.5px', color: C.textSecondary }}>
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
        <div style={{ padding: '8px 14px', background: 'rgba(46,204,113,0.2)', color: '#2ecc71', borderRadius: '8px', fontSize: '15px', fontWeight: 700, border: '1px solid #2ecc71' }}>
          ✓ הומר לתוכנית הגרסה
        </div>
      ) : (
        <button onClick={convert} disabled={converting}
          style={{ width: '100%', padding: '9px', background: '#2ecc71', color: '#1a2332', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '15px', fontWeight: 800 }}>
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
    <div style={{ textAlign: 'center', padding: '80px', color: C.textMuted, direction: 'rtl', fontFamily: FONT }}>
      <div style={{ fontSize: '36px', marginBottom: '14px' }}>⏳</div>טוען נתוני CR-ים...
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
    <div style={{ direction: 'rtl', fontFamily: FONT }}>
      {/* ── Header ── */}
      <div style={{
        background: C.bgCard, border: `1px solid ${C.border}`, boxShadow: SHADOW.xs,
        borderRadius: RADIUS.lg, padding: '16px 24px', marginBottom: '18px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px',
      }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: C.textPrimary }}>Consolidated CR Review — ישיבת מעבר</div>
          <div style={{ fontSize: '13.5px', color: C.textMuted, marginTop: '2px' }}>{propVersionName}</div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {[
            { val: data.length, lbl: 'CR-ים', color: C.textPrimary },
            { val: approvedCrCount, lbl: 'CR אושרו', color: C.success },
            { val: totalPending, lbl: 'ממתינות לסקירה', color: C.warning },
          ].map((s, i) => (
            <div key={i} style={{ textAlign: 'center', background: C.bgNested, borderRadius: RADIUS.md, padding: '8px 16px' }}>
              <div style={{ fontSize: '20px', fontWeight: 800, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: '11px', color: C.textMuted }}>{s.lbl}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Empty state ── */}
      {data.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px', background: C.bgCard, borderRadius: '12px', color: C.textMuted }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📋</div>
          אין CR-ים מוגדרים לגרסה זו
        </div>
      )}

      {/* ── Split panel ── */}
      {data.length > 0 && (
        <div style={{
          display: 'flex', border: `1px solid ${C.border}`, borderRadius: '12px',
          overflow: 'hidden', minHeight: '68vh', background: C.bgApp,
        }}>
          {/* LEFT: CR list (RTL start = visual right) */}
          <div style={{
            width: '252px', flexShrink: 0, borderLeft: `1px solid ${C.border}`,
            display: 'flex', flexDirection: 'column', background: C.bgCard,
          }}>
            {/* Filter bar */}
            <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: '5px', alignItems: 'center', flexShrink: 0 }}>
              {(['all', 'pending', 'approved'] as const).map(f => (
                <button key={f} onClick={() => setReviewFilter(f)}
                  style={{ padding: '3px 9px', border: 'none', borderRadius: '99px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, background: reviewFilter === f ? C.textPrimary : C.bgNested, color: reviewFilter === f ? 'white' : C.textMuted, transition: 'all 0.15s' }}>
                  {f === 'all' ? 'הכל' : f === 'pending' ? 'ממתין' : 'אושר'}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: '13px', color: C.textDisabled, fontWeight: 600 }}>{approvedCrCount}/{data.length}</span>
            </div>

            {/* CR list items */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredData.map(entry => {
                const all = Object.values(entry.proposalsByPhase).flat();
                const approved = all.filter(p => p.reviewStatus === 'APPROVED').length;
                const pct = all.length ? Math.round(approved / all.length * 100) : 0;
                const riskLvl = entry.teams.find(t => t.crPlan.riskLevel)?.crPlan.riskLevel ?? '';
                const isSelected = selectedCr === entry.crNumber;
                const dotColor = entry.crApproved ? C.success : pct === 100 ? C.warning : pct > 0 ? C.info : C.borderEm;

                return (
                  <div key={entry.crNumber} onClick={() => setSelectedCr(entry.crNumber)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: '9px',
                      padding: '9px 14px', cursor: 'pointer',
                      borderBottom: `1px solid ${C.bgNested}`,
                      borderRight: `3px solid ${isSelected ? C.brand : 'transparent'}`,
                      background: isSelected ? C.infoBg : 'transparent',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = C.bgHover; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: dotColor, flexShrink: 0, marginTop: '5px' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: C.textPrimary, fontFamily: 'monospace' }}>{entry.crNumber}</div>
                      <div style={{ fontSize: '13px', color: C.textMuted, lineHeight: 1.35, marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={entry.crLabel !== entry.crNumber ? entry.crLabel.replace(/^\S+\s*-\s*/, '') : ''}>
                        {entry.crLabel !== entry.crNumber ? entry.crLabel.replace(/^\S+\s*-\s*/, '') : '—'}
                      </div>
                      <div style={{ fontSize: '12px', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                        {riskLvl && (
                          <span style={{ padding: '1px 5px', borderRadius: '4px', fontWeight: 600, fontSize: '12px', ...RISK_COLORS[riskLvl] }}>{RISK_LABELS[riskLvl]}</span>
                        )}
                        <span style={{ color: entry.crApproved ? C.success : C.textDisabled }}>
                          {entry.crApproved ? '✓ אושר' : all.length === 0 ? 'לא נדרש' : `${approved}/${all.length}`}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {filteredData.length === 0 && (
                <div style={{ padding: '30px 14px', textAlign: 'center', color: C.textDisabled, fontSize: '14px' }}>אין תוצאות</div>
              )}
            </div>

            {/* Convert button at bottom */}
            {allCrsApproved && (
              <div style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
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
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDisabled, fontSize: '15px', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '32px' }}>📋</div>
              בחר CR מהרשימה לצפייה
            </div>
          )}
        </div>
      )}
    </div>
  );
};
