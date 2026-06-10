import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';
import { C, FONT } from '../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const PHASE_LABELS: Record<number, string> = {
  1: 'בוקר לפני גרסה', 2: 'הטמעה בהוטנט', 3: 'הטמעה בהוט', 4: 'בוקר שלאחר גרסה',
};
const PHASE_BADGE: Record<number, { bg: string; color: string }> = {
  1: { bg: '#e8f4fd', color: '#2980b9' },
  2: { bg: '#e8f8e8', color: '#27ae60' },
  3: { bg: '#fef5e7', color: '#e67e22' },
  4: { bg: '#f5e8fd', color: '#8e44ad' },
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
const ACTION_TYPES = [
  'הרצת סקריפט', 'הגדרת פרמטרים', 'הגדרת הרשאות', 'עצירת תהליך מתוזמן',
  'החזרת תהליך מתוזמן', 'הטמעת קוד', 'הסבת נתונים', 'בדיקת תקינות', 'הגדרת תצורה', 'פעולה ידנית', 'אחר',
];
const APPS = [
  'BILI','CRM','OSB','DP','WEB-RETAIL','WEB-NEXT','WEB-HOT','TOP','IRB','NC','ERP',
  'CONNECT','CREDIT GUARD','ARCHIVE','PRINT BOSS','NIFI','CAWA','BEERI','IVR',
  'MEDIATION','PROVISIONING LDAP','PROVISIONING TIBCO','PROVISIONING NAGRA',
  'PROVISIONING OTT','PROVISIONING TEL','REMEDY','ZOO','WIZ','אחר',
];

interface Proposal {
  id: string;
  teamId: string;
  teamName: string;
  title: string;
  app?: string;
  actionType?: string;
  estimatedMins?: number;
  phase: number;
  notes?: string;
  assignedUserName?: string;
  status: string;
  reviewStatus: string;
  reviewNote?: string;
}

interface CrPlanEntry {
  teamId: string;
  teamName: string;
  teamLead?: string | null;
  crPlan: {
    crManager?: string | null;
    crDescription?: string | null;
    crType?: string | null;
    riskLevel?: string | null;
    systems?: string[];
    nightTestingNotes?: string | null;
    gradualRollout: boolean;
    gradualDetails?: string | null;
    rollbackPlan?: string | null;
    morningMonitoring?: string | null;
  };
}

interface CrEntry {
  crNumber: string;
  crLabel: string;
  managers: string[];
  hasGradualRollout: boolean;
  crApproved: boolean;
  planApprovedAt?: string | null;
  teams: CrPlanEntry[];
  proposalsByPhase: Record<number, Proposal[]>;
  totalProposals: number;
}

interface Props {
  token: string;
  versionId?: string;
  versionName?: string;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1px solid #ddd',
  borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box', direction: 'rtl',
};
const labelStyle: React.CSSProperties = {
  fontSize: '12px', color: '#555', display: 'block', marginBottom: '4px', fontWeight: 'bold',
};

interface SubPhaseOpt { id: string; name: string; phaseName: string; phaseOrderIndex: number; }

// ── Inline edit/add form ──────────────────────────────────────────────────────
const ProposalForm: React.FC<{
  initial?: Partial<Proposal & { subPhaseId?: string }>;
  crNumber: string;
  versionId: string;
  token: string;
  teams: { id: string; name: string }[];
  users: { id: string; fullName: string }[];
  subPhaseOpts: SubPhaseOpt[];
  onSaved: () => void;
  onCancel: () => void;
}> = ({ initial, crNumber, versionId, token, teams, users, subPhaseOpts, onSaved, onCancel }) => {
  const [title, setTitle]           = useState(initial?.title ?? '');
  const [phase, setPhase]           = useState(initial?.phase ?? 1);
  const [subPhaseId, setSubPhaseId] = useState(initial?.subPhaseId ?? '');
  const [app, setApp]               = useState(initial?.app ?? '');
  const [actionType, setActionType] = useState(initial?.actionType ?? '');
  const [estimatedMins, setEstimatedMins] = useState(initial?.estimatedMins?.toString() ?? '');
  const [assignedUserName, setAssignedUserName] = useState(initial?.assignedUserName ?? '');
  const [notes, setNotes]           = useState(initial?.notes ?? '');
  const [teamId, setTeamId]         = useState(initial?.teamId ?? teams[0]?.id ?? '');
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const headers = { Authorization: `Bearer ${token}` };

  // Phases 1-4 map roughly to phase orderIndex 1-4
  const filteredSubPhases = subPhaseOpts.filter(sp => sp.phaseOrderIndex === phase);

  // Phase labels from actual version phases
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
        actionType: actionType || undefined,
        subPhaseId: subPhaseId || undefined,
        estimatedMins: estimatedMins ? parseInt(estimatedMins) : undefined,
        assignedUserName: assignedUserName || undefined,
        notes: notes || undefined,
        crNumber, crLabel: crNumber,
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
      <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '14px', color: '#1a2332' }}>
        {initial?.id ? 'עריכת משימה' : 'הוספת משימה חדשה'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

        {/* 0. CR (read-only) — always first */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>CR מקושר</label>
          <div style={{ padding: '8px 12px', background: '#e8f4fd', border: '1px solid #aed6f1', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ background: '#1a2332', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', fontFamily: 'monospace', flexShrink: 0 }}>{crNumber}</span>
          </div>
        </div>

        {/* 1. תיאור */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>תיאור המשימה <span style={{ color: '#e74c3c' }}>*</span></label>
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
            style={{ ...inputStyle, borderColor: !title.trim() ? '#e74c3c' : undefined }}
            placeholder="תאר את הצעד שיש לבצע..." />
        </div>

        {/* 2. שלב | תת-שלב */}
        <div>
          <label style={labelStyle}>שלב <span style={{ color: '#e74c3c' }}>*</span></label>
          <select value={phase} onChange={e => { setPhase(parseInt(e.target.value)); setSubPhaseId(''); }} style={inputStyle}>
            {[1,2,3,4].map(ph => <option key={ph} value={ph}>{phaseLabels[ph] || PHASE_LABELS[ph]}</option>)}
          </select>
        </div>
        <div>
          <label style={{ ...labelStyle, color: '#2d4a7a' }}>תת-שלב (אופציונלי)</label>
          {filteredSubPhases.length > 0 ? (
            <>
              <select value={subPhaseId} onChange={e => setSubPhaseId(e.target.value)}
                style={{ ...inputStyle, background: subPhaseId ? '#e8f4fd' : undefined }}>
                <option value="">-- בחר תת-שלב --</option>
                {filteredSubPhases.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
              </select>
              {subPhaseId && <div style={{ fontSize: '11px', color: '#2980b9', marginTop: '3px' }}>✓ המשימה תשובץ ישירות לתת-שלב זה</div>}
            </>
          ) : (
            <div style={{ padding: '8px 12px', background: '#f8f8f8', borderRadius: '6px', fontSize: '12px', color: '#aaa' }}>אין תת-שלבים לשלב זה</div>
          )}
        </div>

        {/* 3. סוג פעולה | מערכת */}
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

        {/* 4. צוות | עובד אחראי */}
        {!initial?.id && (
          <div>
            <label style={labelStyle}>צוות</label>
            <select value={teamId} onChange={e => setTeamId(e.target.value)} style={inputStyle}>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label style={labelStyle}>עובד אחראי <span style={{ color: '#e74c3c' }}>*</span></label>
          <select value={assignedUserName} onChange={e => setAssignedUserName(e.target.value)}
            style={{ ...inputStyle, borderColor: !assignedUserName ? '#e74c3c' : undefined }}>
            <option value="">-- בחר עובד --</option>
            {users.map(u => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
          </select>
        </div>

        {/* 5. משך */}
        <div style={{ gridColumn: initial?.id ? 'auto' : '1 / -1' }}>
          <label style={labelStyle}>משך משוער (דקות) <span style={{ color: '#e74c3c' }}>*</span></label>
          <input type="number" min={1} value={estimatedMins} onChange={e => setEstimatedMins(e.target.value)}
            style={{ ...inputStyle, borderColor: !estimatedMins ? '#e74c3c' : undefined }}
            placeholder="למשל 30" />
        </div>

        {/* 6. הערות */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>הערות</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            style={{ ...inputStyle, height: '60px', resize: 'vertical' }}
            placeholder="פרמטרים, הוראות מיוחדות, תלויות..." />
        </div>
      </div>

      {error && <div style={{ color: '#e74c3c', fontSize: '13px', marginTop: '8px' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
        <button onClick={save} disabled={saving}
          style={{ padding: '8px 20px', background: saving ? '#aaa' : '#27ae60', color: 'white', border: 'none', borderRadius: '8px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
          {saving ? 'שומר...' : initial?.id ? 'שמור שינויים' : 'הוסף'}
        </button>
        <button onClick={onCancel}
          style={{ padding: '8px 16px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
          ביטול
        </button>
      </div>
    </div>
  );
};

// ── Single proposal row ───────────────────────────────────────────────────────
const ProposalRow: React.FC<{
  proposal: Proposal;
  token: string;
  versionId: string;
  teams: { id: string; name: string }[];
  users: { id: string; fullName: string }[];
  subPhaseOpts: SubPhaseOpt[];
  onUpdated: () => void;
  crNumber: string;
}> = ({ proposal, token, versionId, teams, users, subPhaseOpts, onUpdated, crNumber }) => {
  const [editing, setEditing]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote]         = useState(proposal.reviewNote ?? '');
  const headers = { Authorization: `Bearer ${token}` };
  const meta = REVIEW_META[proposal.reviewStatus] ?? REVIEW_META.PENDING;
  const pb   = PHASE_BADGE[proposal.phase] ?? PHASE_BADGE[1];

  const setReview = async (reviewStatus: string, reviewNote?: string) => {
    setSaving(true);
    try {
      await axios.patch(`${API}/task-proposals/${proposal.id}/review`, { reviewStatus, reviewNote: reviewNote ?? note }, { headers });
      onUpdated();
      setShowNote(false);
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!window.confirm(`מחק את המשימה "${proposal.title}"?`)) return;
    await axios.delete(`${API}/task-proposals/${proposal.id}`, { headers });
    onUpdated();
  };

  if (editing) {
    return <ProposalForm initial={proposal} crNumber={crNumber} versionId={versionId} token={token}
      teams={teams} users={users} subPhaseOpts={subPhaseOpts} onSaved={() => { setEditing(false); onUpdated(); }} onCancel={() => setEditing(false)} />;
  }

  const phaseLabel = subPhaseOpts.find(sp => sp.phaseOrderIndex === proposal.phase)?.phaseName || PHASE_LABELS[proposal.phase];

  return (
    <div style={{
      borderRadius: '10px', marginBottom: '8px', overflow: 'hidden',
      background: 'white',
      border: `1px solid ${meta.border}`,
      borderRight: `4px solid ${meta.border}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      {/* ── שורה ראשית: שלב + כותרת + כפתורי עריכה ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px' }}>
        {/* Phase badge */}
        <span style={{ background: pb.bg, color: pb.color, padding: '3px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {phaseLabel}
        </span>
        {/* Title — גדול וברור */}
        <span style={{ flex: 1, fontSize: '15px', fontWeight: '800', color: '#1a2332', lineHeight: 1.3 }}>
          {proposal.title}
        </span>
        {/* Review status badge */}
        <span style={{ fontSize: '12px', fontWeight: '700', padding: '3px 10px', borderRadius: '8px', background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`, flexShrink: 0 }}>
          {meta.label}
        </span>
        {/* Edit / Delete */}
        <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
          <button onClick={() => setEditing(true)}
            style={{ padding: '4px 10px', background: '#f39c12', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>ערוך</button>
          <button onClick={remove}
            style={{ padding: '4px 10px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>מחק</button>
        </div>
      </div>

      {/* ── שורת מטה-דאטה ── */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', padding: '6px 14px 10px', borderTop: '1px solid #f0f0f0' }}>
        {/* צוות */}
        <span style={{ fontSize: '13px', fontWeight: '700', color: '#2d4a7a', background: '#eef3fb', padding: '2px 9px', borderRadius: '6px' }}>
          👥 {proposal.teamName}
        </span>
        {/* עובד אחראי */}
        {proposal.assignedUserName && (
          <span style={{ fontSize: '13px', color: '#444', fontWeight: '600' }}>
            👤 {proposal.assignedUserName}
          </span>
        )}
        {/* מערכת */}
        {proposal.app && (
          <span style={{ fontSize: '13px', background: '#f0f4fa', color: '#1a2332', padding: '2px 9px', borderRadius: '6px', fontWeight: '600', border: '1px solid #dde3ee' }}>
            {proposal.app}
          </span>
        )}
        {/* סוג פעולה */}
        {proposal.actionType && (
          <span style={{ fontSize: '12px', background: '#e8f4fd', color: '#2980b9', padding: '2px 9px', borderRadius: '6px', fontWeight: '600' }}>
            {proposal.actionType}
          </span>
        )}
        {/* משך */}
        {proposal.estimatedMins && (
          <span style={{ fontSize: '13px', color: '#555', background: '#f7f7f7', padding: '2px 9px', borderRadius: '6px', fontWeight: '600', border: '1px solid #e8e8e8' }}>
            ⏱ {proposal.estimatedMins} דק'
          </span>
        )}
        {/* הערה */}
        {proposal.notes && (
          <span style={{ fontSize: '13px', color: '#666', fontStyle: 'italic' }}>
            💬 {proposal.notes}
          </span>
        )}
      </div>

      {/* Review note input */}
      {showNote && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid #ffe0b2', display: 'flex', gap: '8px' }}>
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder="הערה לצוות (מה לתקן)..." autoFocus
            style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', border: '1px solid #e67e22', fontSize: '14px', direction: 'rtl' }} />
          <button onClick={() => setReview('NEEDS_REVISION', note)} disabled={saving}
            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#e67e22', color: 'white', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>שלח</button>
          <button onClick={() => setShowNote(false)}
            style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #ddd', background: 'white', cursor: 'pointer', fontSize: '14px' }}>ביטול</button>
        </div>
      )}

      {/* Review note display */}
      {proposal.reviewNote && !showNote && (
        <div style={{ padding: '7px 14px', fontSize: '13px', color: '#c05800', background: '#fff8f0', borderTop: '1px solid #ffe0b2', fontWeight: '500' }}>
          💬 הערה: {proposal.reviewNote}
        </div>
      )}
    </div>
  );
};

// ── CR Card ───────────────────────────────────────────────────────────────────
const CrCard: React.FC<{
  entry: CrEntry;
  token: string;
  versionId: string;
  teams: { id: string; name: string }[];
  users: { id: string; fullName: string }[];
  subPhaseOpts: SubPhaseOpt[];
  onReload: () => void;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onBack: () => void;
}> = ({ entry, token, versionId, teams, users, subPhaseOpts, onReload, index, total, onPrev, onNext, onBack }) => {
  const [showPlan, setShowPlan]     = useState(true);   // open by default
  const [addOpen, setAddOpen]       = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);

  // Extract modal state
  interface ExtractItemCr { text: string; checked: boolean; phase: number; estimatedMins: string; teamId: string; duplicateId?: string; }
  const [extractModalCr, setExtractModalCr] = useState<{
    crNumber: string; sourceLabel: string; defaultPhase: number; items: ExtractItemCr[];
  } | null>(null);
  const [extractingCr, setExtractingCr] = useState(false);
  const [dialog, setDialog] = useState<DialogConfig | null>(null);

  const doCreateExtractedCr = async (replaceConflicts: boolean) => {
    if (!extractModalCr) return;
    const toCreate = extractModalCr.items.filter(i => i.checked && i.text.trim());
    setExtractingCr(true);
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
            crNumber: extractModalCr.crNumber,
            teamIdOverride: item.teamId,
          }, { headers });
        }
      }
      onReload();
      setExtractModalCr(null);
    } finally { setExtractingCr(false); }
  };

  const createExtractedCr = () => {
    if (!extractModalCr) return;
    const toCreate = extractModalCr.items.filter(i => i.checked && i.text.trim());
    const conflicts = toCreate.filter(i => i.duplicateId);
    if (conflicts.length > 0) {
      setDialog({
        title: 'משימות כפולות',
        message: `${conflicts.length} מהמשימות שבחרת כבר קיימות.\nהאם להחליף אותן בגרסה החדשה?`,
        variant: 'warning',
        confirmLabel: 'החלף',
        cancelLabel: 'דלג על הקיימות',
        onConfirm: () => doCreateExtractedCr(true),
        onCancel:  () => doCreateExtractedCr(false),
      });
    } else {
      doCreateExtractedCr(false);
    }
  };
  const headers = { Authorization: `Bearer ${token}` };

  const allProposals  = Object.values(entry.proposalsByPhase).flat();
  const pendingCount  = allProposals.filter(p => p.reviewStatus === 'PENDING').length;
  const approvedCount = allProposals.filter(p => p.reviewStatus === 'APPROVED').length;
  const teamsWithoutSubmission = entry.teams.filter(t => !allProposals.some(p => p.teamId === t.teamId));
  const allTeamsSubmitted = teamsWithoutSubmission.length === 0;
  const allReviewed   = allProposals.length > 0 && pendingCount === 0 && allTeamsSubmitted;
  const crApproved    = entry.crApproved;
  const [approving, setApproving] = useState(false);

  // aggregate CrPlan info across teams
  const riskLevel = entry.teams.find(t => t.crPlan.riskLevel)?.crPlan.riskLevel ?? '';
  const crType    = entry.teams.find(t => t.crPlan.crType)?.crPlan.crType ?? '';
  const systems   = Array.from(new Set(entry.teams.flatMap(t => t.crPlan.systems ?? [])));

  const approveAll = async () => {
    setApprovingAll(true);
    try {
      const pending = allProposals.filter(p => p.reviewStatus === 'PENDING');
      await Promise.all(pending.map(p =>
        axios.patch(`${API}/task-proposals/${p.id}/review`, { reviewStatus: 'APPROVED', reviewNote: '' }, { headers })
      ));
      onReload();
    } finally { setApprovingAll(false); }
  };

  const pct = allProposals.length ? Math.round(approvedCount / allProposals.length * 100) : 0;

  return (
    <div style={{
      background: 'white', borderRadius: '12px', padding: '14px 16px', marginBottom: '12px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
      border: crApproved ? '2px solid #27ae60' : allReviewed ? '1px solid #f39c12' : '1px solid #e8ecf0',
    }}>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />
      {/* Navigation bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <button onClick={onBack} style={{ padding: '5px 12px', background: '#f0f2f5', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: '#555' }}>← רשימה</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '12px', color: '#888' }}>{index + 1} / {total}</span>
        <button onClick={onPrev} disabled={index === 0} style={{ padding: '5px 10px', borderRadius: '7px', border: '1px solid #ddd', background: index === 0 ? '#f5f5f5' : 'white', cursor: index === 0 ? 'default' : 'pointer', color: index === 0 ? '#ccc' : '#333', fontSize: '12px' }}>› קודם</button>
        <button onClick={onNext} disabled={index === total - 1} style={{ padding: '5px 10px', borderRadius: '7px', border: '1px solid #ddd', background: index === total - 1 ? '#f5f5f5' : 'white', cursor: index === total - 1 ? 'default' : 'pointer', color: index === total - 1 ? '#ccc' : '#333', fontSize: '12px' }}>‹ הבא</button>
      </div>

      {/* CR Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <span style={{ background: '#1a2332', color: 'white', padding: '4px 12px', borderRadius: '8px', fontSize: '14px', fontWeight: '800', flexShrink: 0 }}>
          {entry.crNumber}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: '700', fontSize: '17px', color: '#1a2332' }}>
            {entry.crLabel !== entry.crNumber ? entry.crLabel : ''}
          </div>
          <div style={{ fontSize: '14px', color: '#555', marginTop: '4px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {entry.managers.length > 0 && <span>מנהל: <strong>{entry.managers.join(', ')}</strong></span>}
            <span>{entry.teams.length} צוותים · {allProposals.length} משימות</span>
          </div>
        </div>

        {/* Metadata badges */}
        {riskLevel && (
          <span style={{ fontSize: '12px', fontWeight: '700', padding: '3px 12px', borderRadius: '8px', ...RISK_COLORS[riskLevel] }}>
            פיתוח בסיכון {RISK_LABELS[riskLevel]}
          </span>
        )}
        {crType && <span style={{ fontSize: '11px', background: '#f0f4fa', color: '#2d4a7a', padding: '2px 9px', borderRadius: '7px' }}>{crType}</span>}

        {/* Progress + approval status */}
        <div style={{ flexShrink: 0, textAlign: 'center', minWidth: '80px' }}>
          {crApproved ? (
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#27ae60' }}>✓ CR אושר</div>
          ) : (
            <>
              <div style={{ fontSize: '12px', color: '#888', fontWeight: '600', marginBottom: '3px' }}>
                {pendingCount > 0 ? `${pendingCount} ממתינות` : 'נסקר — ממתין לאישור'}
              </div>
              <div style={{ height: '5px', background: '#f0f0f0', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#f39c12' : '#3498db', transition: 'width 0.3s' }} />
              </div>
            </>
          )}
        </div>

        {/* CrPlan toggle */}
        <button onClick={() => setShowPlan(s => !s)}
          style={{ padding: '4px 10px', background: showPlan ? '#6c3483' : '#f0edf8', color: showPlan ? 'white' : '#6c3483', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap' }}>
          {showPlan ? '▲ תכנית' : '📋 תכנית'}
        </button>
      </div>

      {/* CrPlan panel (collapsible) */}
      {showPlan && (() => {
        // Aggregate per field across all teams
        const nightItems  = entry.teams.filter(t => t.crPlan.nightTestingNotes).map(t => ({ teamId: t.teamId, teamName: t.teamName, text: t.crPlan.nightTestingNotes! }));
        const morningItems= entry.teams.filter(t => t.crPlan.morningMonitoring).map(t => ({ teamId: t.teamId, teamName: t.teamName, text: t.crPlan.morningMonitoring! }));
        const rollbackItems= entry.teams.filter(t => t.crPlan.rollbackPlan).map(t => ({ teamId: t.teamId, teamName: t.teamName, text: t.crPlan.rollbackPlan! }));
        const gradualItems= entry.teams.filter(t => t.crPlan.gradualRollout && t.crPlan.gradualDetails).map(t => ({ teamId: t.teamId, teamName: t.teamName, text: t.crPlan.gradualDetails! }));

        interface PlanItem { teamId: string; teamName: string; text: string; }
        const PlanSection = ({ title, icon, items, accent, defaultPhase }: { title: string; icon: string; items: PlanItem[]; accent: string; defaultPhase: number }) => {
          if (!items.length) return null;
          return (
            <div style={{ marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ fontWeight: '700', fontSize: '16px', color: accent }}>{icon} {title}</div>
                <button
                  onClick={() => {
                    const allText = items.map(i => `${i.teamName}:\n${i.text}`).join('\n\n');
                    const lines = allText.split(/\n/).map(l => l.replace(/^[-*•·\s]+/, '').trim()).filter(l => l.length > 2 && !l.endsWith(':'));
                    if (!lines.length) return;
                    const existingProposals = Object.values(entry.proposalsByPhase).flat();
                    setExtractModalCr({ crNumber: entry.crNumber, sourceLabel: title, defaultPhase, items: lines.map(t => {
                      const dup = existingProposals.find(p => p.title.trim().toLowerCase() === t.trim().toLowerCase());
                      return { text: t, checked: true, phase: defaultPhase, estimatedMins: '', teamId: items[0].teamId, duplicateId: dup?.id };
                    }) });
                  }}
                  style={{ fontSize: '11px', padding: '3px 10px', background: `${accent}15`, color: accent, border: `1px solid ${accent}40`, borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: '600' }}
                >⚡ הפק משימות</button>
              </div>
              {items.map((item, i) => (
                <div key={i} style={{ background: 'white', borderRadius: '10px', padding: '16px 20px', marginBottom: '10px', borderRight: `5px solid ${accent}`, border: `1px solid ${accent}30`, borderRightWidth: '5px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#2d4a7a', marginBottom: '8px' }}>{item.teamName}</div>
                  <div style={{ fontSize: '16px', color: '#1a2332', lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>{item.text}</div>
                </div>
              ))}
            </div>
          );
        };

        return (
          <div style={{ background: '#faf7ff', border: '1px solid #d7bef7', borderRadius: '14px', padding: '24px 32px', marginBottom: '16px' }}>
            {/* Header */}
            <div style={{ fontWeight: '800', fontSize: '18px', color: '#6c3483', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              📋 פרטי תכנית CR
              {/* Metadata row */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginRight: 'auto' }}>
                {riskLevel && <span style={{ fontSize: '12px', fontWeight: '700', padding: '2px 10px', borderRadius: '7px', ...RISK_COLORS[riskLevel] }}>פיתוח בסיכון {RISK_LABELS[riskLevel]}</span>}
                {crType && <span style={{ fontSize: '12px', background: '#e8f0fe', color: '#2d4a7a', padding: '2px 10px', borderRadius: '7px', fontWeight: '600' }}>{crType}</span>}
              </div>
            </div>

            {/* CR file data — name, manager, description */}
          {(() => {
            const crMgr  = entry.teams.map(t => t.crPlan.crManager).find(v => v);
            const crDesc = entry.teams.map(t => t.crPlan.crDescription).find(v => v);
            if (!crMgr && !crDesc) return null;
            const roStyle: React.CSSProperties = { background: '#f0edf8', border: '1px solid #d7bef7', borderRadius: '8px', padding: '10px 14px', fontSize: '14px', color: '#333', marginBottom: '8px', whiteSpace: 'pre-wrap' };
            const roLabel: React.CSSProperties = { fontSize: '12px', color: '#9b59b6', fontWeight: '700', marginBottom: '4px' };
            return (
              <div style={{ marginBottom: '18px', paddingBottom: '14px', borderBottom: '1px solid #ede0ff' }}>
                <div style={{ display: 'grid', gridTemplateColumns: crMgr ? '1fr 1fr' : '1fr', gap: '10px', marginBottom: crDesc ? '10px' : 0 }}>
                  <div>
                    <div style={roLabel}>שם ה-CR (מהקובץ)</div>
                    <div style={roStyle}>{entry.crLabel !== entry.crNumber ? entry.crLabel.replace(/^\S+\s*-\s*/, '') : '—'}</div>
                  </div>
                  {crMgr && (
                    <div>
                      <div style={roLabel}>מנהל CR (מהקובץ)</div>
                      <div style={roStyle}>{crMgr}</div>
                    </div>
                  )}
                </div>
                {crDesc && (
                  <div>
                    <div style={roLabel}>פרטים (מהקובץ)</div>
                    <div style={roStyle}>{crDesc}</div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Team leads */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px', paddingBottom: '14px', borderBottom: '1px solid #ede0ff' }}>
              {entry.teams.map(t => (
                <div key={t.teamId} style={{ background: 'white', border: '1px solid #d7bef7', borderRadius: '8px', padding: '6px 12px', fontSize: '12px' }}>
                  <span style={{ fontWeight: '700', color: '#1a2332' }}>{t.teamName}</span>
                  {t.teamLead && <span style={{ color: '#888', marginRight: '6px' }}>· {t.teamLead}</span>}
                </div>
              ))}
            </div>

            {nightItems.length === 0 && morningItems.length === 0 && rollbackItems.length === 0 && gradualItems.length === 0 && (
              <div style={{ color: '#aaa', fontSize: '13px', fontStyle: 'italic', textAlign: 'center', padding: '20px' }}>לא הוזנו פרטי תכנית</div>
            )}

            <PlanSection title="המלצות בדיקות ליל גרסה" icon="💡" items={nightItems}   accent="#2980b9" defaultPhase={2} />
            <PlanSection title="המלצות בקרות בוקר"       icon="🌅" items={morningItems} accent="#8e44ad" defaultPhase={4} />
            <PlanSection title="תכנית Rollback"            icon="🔄" items={rollbackItems} accent="#e74c3c" defaultPhase={3} />
            {entry.hasGradualRollout && <PlanSection title="עלייה מדורגת" icon="📈" items={gradualItems} accent="#e67e22" defaultPhase={3} />}
          </div>
        );
      })()}

      {/* Proposals per phase */}
      {[1, 2, 3, 4].map(phase => {
        const phaseProposals = (entry.proposalsByPhase[phase] ?? []);
        if (!phaseProposals.length) return null;
        const pb = PHASE_BADGE[phase];
        const phaseName = subPhaseOpts.find(sp => sp.phaseOrderIndex === phase)?.phaseName || PHASE_LABELS[phase];
        const pendingCount = phaseProposals.filter(p => p.reviewStatus === 'PENDING').length;
        return (
          <div key={phase} style={{ marginBottom: '14px' }}>
            {/* Phase group header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', padding: '8px 12px', background: pb.bg, borderRadius: '8px', border: `1px solid ${pb.color}30` }}>
              <span style={{ fontSize: '14px', fontWeight: '800', color: pb.color }}>{phaseName}</span>
              <span style={{ fontSize: '12px', background: 'white', color: pb.color, padding: '2px 8px', borderRadius: '10px', fontWeight: '700', border: `1px solid ${pb.color}40` }}>
                {phaseProposals.length} משימות
              </span>
              {pendingCount > 0 && (
                <span style={{ fontSize: '12px', color: '#888', marginRight: 'auto' }}>
                  {pendingCount} ממתינות לסקירה
                </span>
              )}
            </div>
            {phaseProposals.map(p => (
              <ProposalRow key={p.id} proposal={p} token={token} versionId={versionId}
                teams={teams} users={users} subPhaseOpts={subPhaseOpts} onUpdated={onReload} crNumber={entry.crNumber} />
            ))}
          </div>
        );
      })}

      {/* Inline add form */}
      {addOpen && (
        <ProposalForm crNumber={entry.crNumber} versionId={versionId} token={token}
          teams={teams} users={users} subPhaseOpts={subPhaseOpts} onSaved={() => { setAddOpen(false); onReload(); }} onCancel={() => setAddOpen(false)} />
      )}

      {/* Bottom actions */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center' }}>
        {/* Right: nav */}
        <button onClick={onPrev} disabled={index === 0}
          style={{ padding: '10px 18px', borderRadius: '8px', border: '1px solid #ddd', background: index === 0 ? '#f5f5f5' : 'white', cursor: index === 0 ? 'default' : 'pointer', color: index === 0 ? '#bbb' : '#333', fontSize: '14px', fontWeight: '600', whiteSpace: 'nowrap' }}>
          › קודם
        </button>
        <button onClick={onNext} disabled={index === total - 1}
          style={{ padding: '10px 18px', borderRadius: '8px', border: '1px solid #ddd', background: index === total - 1 ? '#f5f5f5' : 'white', cursor: index === total - 1 ? 'default' : 'pointer', color: index === total - 1 ? '#bbb' : '#333', fontSize: '14px', fontWeight: '600', whiteSpace: 'nowrap' }}>
          ‹ הבא
        </button>

        {/* Center: add button (wide) */}
        {!addOpen && (
          <button onClick={() => setAddOpen(true)}
            style={{ flex: 1, padding: '10px 18px', background: '#2d4a7a', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>
            + הוסף משימה לביצוע
          </button>
        )}
        {addOpen && <div style={{ flex: 1 }} />}

        {/* Left: approve CR */}
        {!crApproved && !allTeamsSubmitted && (
          <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', color: '#856404' }}>
            ⚠️ ממתין להגשה מ: {teamsWithoutSubmission.map(t => t.teamName).join(', ')}
          </div>
        )}
        {allReviewed && !crApproved && (
          <button
            onClick={async () => {
              setApproving(true);
              try {
                await axios.patch(`${API}/cr-plans/version/${versionId}/approve-cr`, { crNumber: entry.crNumber }, { headers });
                onReload();
              } finally { setApproving(false); }
            }}
            disabled={approving}
            style={{ padding: '10px 22px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '700', whiteSpace: 'nowrap' }}>
            {approving ? 'שומר…' : '✓ אשר תוכנית CR'}
          </button>
        )}

        {crApproved && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ padding: '10px 18px', background: '#e8fdf0', color: '#27ae60', borderRadius: '8px', fontSize: '14px', fontWeight: '700', border: '2px solid #27ae60' }}>
              ✓ תוכנית CR אושרה
            </div>
            <button
              onClick={async () => {
                await axios.patch(`${API}/cr-plans/version/${versionId}/unapprove-cr`, { crNumber: entry.crNumber }, { headers });
                onReload();
              }}
              style={{ padding: '6px 12px', background: 'white', color: '#888', border: '1px solid #ddd', borderRadius: '8px', cursor: 'pointer', fontSize: '12px' }}>
              בטל אישור
            </button>
          </div>
        )}
      </div>

      {/* Extract modal */}
      {extractModalCr && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl' }}>
          <div style={{ background: 'white', borderRadius: '14px', padding: '24px 28px', maxWidth: '560px', width: '95vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ fontWeight: '700', fontSize: '16px', color: '#1a2332', marginBottom: '4px' }}>⚡ הפק משימות מ{extractModalCr.sourceLabel}</div>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>CR {extractModalCr.crNumber} — בחר שורות להפוך למשימות</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              {extractModalCr.items.map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', borderRadius: '8px', background: item.checked ? '#f0f7ff' : '#fafafa', border: `1px solid ${item.checked ? '#aed6f1' : '#e0e0e0'}` }}>
                  <input type="checkbox" checked={item.checked}
                    onChange={e => setExtractModalCr(m => m ? { ...m, items: m.items.map((it, j) => j === i ? { ...it, checked: e.target.checked } : it) } : null)}
                    style={{ marginTop: '3px', flexShrink: 0, cursor: 'pointer' }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <input value={item.text} disabled={!item.checked}
                      onChange={e => setExtractModalCr(m => m ? { ...m, items: m.items.map((it, j) => j === i ? { ...it, text: e.target.value } : it) } : null)}
                      style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '13px', color: '#1a2332', outline: 'none', fontFamily: 'Arial', boxSizing: 'border-box' as const }} />
                    {item.duplicateId && (
                      <span style={{ fontSize: '10px', color: '#e67e22', fontWeight: '600' }}>⚠ כבר קיימת — תישאל אם להחליף</span>
                    )}
                  </div>
                  <input type="number" min={1} value={item.estimatedMins} disabled={!item.checked}
                    onChange={e => setExtractModalCr(m => m ? { ...m, items: m.items.map((it, j) => j === i ? { ...it, estimatedMins: e.target.value } : it) } : null)}
                    placeholder="דק'" style={{ width: '54px', fontSize: '11px', border: '1px solid #ddd', borderRadius: '5px', padding: '2px 4px', textAlign: 'center' as const, flexShrink: 0 }} />
                  <select value={item.phase} disabled={!item.checked}
                    onChange={e => setExtractModalCr(m => m ? { ...m, items: m.items.map((it, j) => j === i ? { ...it, phase: parseInt(e.target.value) } : it) } : null)}
                    style={{ fontSize: '11px', border: '1px solid #ddd', borderRadius: '5px', padding: '2px 4px', flexShrink: 0 }}>
                    {[1,2,3,4].map(ph => <option key={ph} value={ph}>{PHASE_LABELS[ph]}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              <button onClick={() => setExtractModalCr(m => m ? { ...m, items: m.items.map(it => ({ ...it, checked: true })) } : null)} style={{ fontSize: '12px', padding: '4px 10px', border: '1px solid #ddd', borderRadius: '6px', background: 'white', cursor: 'pointer' }}>בחר הכל</button>
              <button onClick={() => setExtractModalCr(m => m ? { ...m, items: m.items.map(it => ({ ...it, checked: false })) } : null)} style={{ fontSize: '12px', padding: '4px 10px', border: '1px solid #ddd', borderRadius: '6px', background: 'white', cursor: 'pointer' }}>בטל הכל</button>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setExtractModalCr(null)} style={{ padding: '8px 18px', border: '1px solid #ddd', borderRadius: '8px', background: 'white', cursor: 'pointer', fontSize: '13px' }}>ביטול</button>
              <button onClick={createExtractedCr} disabled={extractingCr || extractModalCr.items.filter(i => i.checked).length === 0}
                style={{ padding: '8px 22px', border: 'none', borderRadius: '8px', background: extractModalCr.items.filter(i => i.checked).length === 0 ? '#ddd' : '#1a2332', color: extractModalCr.items.filter(i => i.checked).length === 0 ? '#aaa' : 'white', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>
                {extractingCr ? 'יוצר…' : `צור ${extractModalCr.items.filter(i => i.checked).length} משימות`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Convert button (appears only when all CRs approved) ───────────────────────
const ConvertButton: React.FC<{ token: string; versionId: string; onReload: () => void }> = ({ token, versionId, onReload }) => {
  const [converting, setConverting] = useState(false);
  const [done, setDone]             = useState(false);
  const [dialog, setDialog]         = useState<DialogConfig | null>(null);
  const headers = { Authorization: `Bearer ${token}` };

  const convert = () => {
    setDialog({
      title: 'המרת תוכנית לגרסה',
      message: 'כל ה-CR-ים אושרו. האם להמיר את כל ההצעות המאושרות למשימות בתוכנית הגרסה?',
      variant: 'info',
      confirmLabel: 'המר לתוכנית',
      cancelLabel: 'ביטול',
      onConfirm: async () => {
        setConverting(true);
        try {
          await axios.post(`${API}/task-proposals/version/${versionId}/convert-approved`, {}, { headers });
          setDone(true);
          onReload();
        } finally { setConverting(false); }
      },
      onCancel: () => {},
    });
  };

  return (
    <>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />
      {done ? (
        <div style={{ padding: '10px 18px', background: 'rgba(46,204,113,0.3)', color: '#2ecc71', borderRadius: '10px', fontSize: '14px', fontWeight: '700', border: '1px solid #2ecc71' }}>
          ✓ הומר לתוכנית הגרסה
        </div>
      ) : (
        <button onClick={convert} disabled={converting}
          style={{ padding: '10px 20px', background: '#2ecc71', color: '#1a2332', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '800', whiteSpace: 'nowrap' }}>
          {converting ? 'ממיר…' : '🚀 המר לתוכנית גרסה'}
        </button>
      )}
    </>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
export const CrReviewView: React.FC<Props> = ({ token, versionId: propVersionId, versionName: propVersionName }) => {
  const [data, setData]               = useState<CrEntry[]>([]);
  const [teams, setTeams]             = useState<{ id: string; name: string }[]>([]);
  const [users, setUsers]             = useState<{ id: string; fullName: string }[]>([]);
  const [subPhaseOpts, setSubPhaseOpts] = useState<SubPhaseOpt[]>([]);
  const [loading, setLoading]         = useState(!!propVersionId);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'pending' | 'approved' | 'not_required'>('all');
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
      setTeams((teamRes.data as any[]).filter(t => t.active).map((t: any) => ({ id: t.id, name: t.name })));
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

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '80px', color: C.textMuted, direction: 'rtl', fontFamily: FONT }}>
      <div style={{ fontSize: '36px', marginBottom: '14px' }}>⏳</div>טוען נתוני CR-ים...
    </div>
  );

  const allProposals      = data.flatMap(e => Object.values(e.proposalsByPhase).flat());
  const totalApproved     = allProposals.filter(p => p.reviewStatus === 'APPROVED').length;
  const totalPending      = allProposals.filter(p => p.reviewStatus === 'PENDING').length;
  const approvedCrCount   = data.filter(e => e.crApproved).length;
  const allCrsApproved    = data.length > 0 && approvedCrCount === data.length;

  return (
    <div style={{ direction: 'rtl', fontFamily: FONT }}>
      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${C.textPrimary} 0%, ${C.statusOpen} 100%)`,
        borderRadius: '12px', padding: '16px 24px', marginBottom: '18px', color: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px',
      }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: '700' }}>ישיבת מעבר — סקירת CR-ים</div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', marginTop: '2px' }}>{propVersionName}</div>
        </div>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '22px', fontWeight: '800' }}>{data.length}</div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>CR-ים</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '22px', fontWeight: '800', color: '#2ecc71' }}>{approvedCrCount}</div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>CR אושרו</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '22px', fontWeight: '800', color: '#f39c12' }}>{totalPending}</div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>ממתינות לסקירה</div>
          </div>
          {allCrsApproved && (
            <ConvertButton token={token} versionId={propVersionId!} onReload={load} />
          )}
        </div>
      </div>

      {data.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px', background: C.bgCard, borderRadius: '12px', color: C.textMuted }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📋</div>
          אין CR-ים מוגדרים לגרסה זו
        </div>
      )}

      {/* Filter bar */}
      {data.length > 0 && selectedIndex === null && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
          {([
            ['all',          'הצג הכל',      data.length],
            ['pending',      'ממתין לאישור', data.filter(e => !e.crApproved).length],
            ['approved',     '✅ אושר',       data.filter(e => e.crApproved).length],
            ['not_required', 'לא נדרש',      data.filter(e => Object.values(e.proposalsByPhase).flat().length === 0).length],
          ] as [typeof reviewFilter, string, number][]).map(([key, label, count]) => (
            <button key={key} onClick={() => setReviewFilter(key)}
              style={{
                padding: '6px 14px', border: 'none', borderRadius: '20px', cursor: 'pointer',
                fontSize: '13px', fontWeight: '600',
                background: reviewFilter === key ? C.textPrimary : C.bgNested,
                color: reviewFilter === key ? C.textInverse : C.textSecondary,
                transition: 'all 0.15s',
              }}>
              {label} <span style={{ opacity: 0.7 }}>({count})</span>
            </button>
          ))}
        </div>
      )}

      {/* CR detail view with navigation */}
      {selectedIndex !== null && data[selectedIndex] ? (
        <CrCard
          entry={data[selectedIndex]}
          token={token}
          versionId={propVersionId!}
          teams={teams}
          users={users}
          subPhaseOpts={subPhaseOpts}
          onReload={load}
          index={selectedIndex}
          total={data.length}
          onPrev={() => setSelectedIndex(i => Math.max(0, (i ?? 0) - 1))}
          onNext={() => setSelectedIndex(i => Math.min(data.length - 1, (i ?? 0) + 1))}
          onBack={() => setSelectedIndex(null)}
        />
      ) : (
        /* CR list index */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {data.filter(entry => {
            if (reviewFilter === 'all') return true;
            const all = Object.values(entry.proposalsByPhase).flat();
            if (reviewFilter === 'approved')     return entry.crApproved;
            if (reviewFilter === 'pending')      return !entry.crApproved;
            if (reviewFilter === 'not_required') return all.length === 0;
            return true;
          }).map((entry) => {
            const origIndex = data.indexOf(entry);
            const all = Object.values(entry.proposalsByPhase).flat();
            const approved = all.filter(p => p.reviewStatus === 'APPROVED').length;
            const pending  = all.filter(p => p.reviewStatus === 'PENDING').length;
            const pct = all.length ? Math.round(approved / all.length * 100) : 0;
            const riskLevel = entry.teams.find(t => t.crPlan.riskLevel)?.crPlan.riskLevel ?? '';
            return (
              <div key={entry.crNumber} onClick={() => setSelectedIndex(origIndex)}
                style={{ background: 'white', borderRadius: '12px', padding: '14px 18px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: pct === 100 ? '1px solid #27ae60' : '1px solid #e8ecf0', display: 'flex', alignItems: 'center', gap: '12px' }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.07)')}
              >
                <span style={{ background: '#1a2332', color: 'white', padding: '4px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: '800', flexShrink: 0 }}>{entry.crNumber}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: '600', fontSize: '14px', color: '#1a2332' }}>{entry.crLabel !== entry.crNumber ? entry.crLabel : ''}</div>
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                    {entry.managers.length > 0 && `מנהל: ${entry.managers.join(', ')} · `}
                    {entry.teams.length} צוותים · {all.length} משימות
                  </div>
                </div>
                {riskLevel && <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '6px', ...RISK_COLORS[riskLevel] }}>{RISK_LABELS[riskLevel]}</span>}
                {entry.crApproved ? (
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#27ae60', padding: '4px 12px', background: '#e8fdf0', borderRadius: '8px', border: '1px solid #27ae60' }}>✓ אושר</span>
                ) : (
                  <div style={{ flexShrink: 0, textAlign: 'center', minWidth: '70px' }}>
                    <div style={{ fontSize: '11px', color: pending > 0 ? '#888' : '#e67e22', fontWeight: '600', marginBottom: '3px' }}>
                      {pending > 0 ? `${pending} ממתינות` : 'ממתין לאישור'}
                    </div>
                    <div style={{ height: '5px', background: '#f0f0f0', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#e67e22' : '#3498db' }} />
                    </div>
                  </div>
                )}
                <span style={{ color: '#aaa', fontSize: '18px' }}>›</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
