import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';
import { formatDate } from '../../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Evidence { id: string; type: string; content: string; createdAt: string; }
interface RcaAnswer { id: string; step: number; question: string; answer: string; isRootCause: boolean; }
interface RcaLesson { id: string; teamId: string | null; teamName: string; text: string; }
interface GuidedTreePathEntry { nodeId: string; question: string; answerValue: string; answerLabel: string; }
interface Rca {
  id: string; method: 'FIVE_WHY' | 'FISHBONE' | 'AI' | 'GUIDED'; category: string | null; rootCauseReason: string | null;
  rootCause: string | null; description: string | null; directCause: string | null;
  status: 'OPEN' | 'INVESTIGATION' | 'COMPLETED' | 'CANCELLED';
  factsActionTaken: string | null; factsExpectedResult: string | null; factsActualResult: string | null;
  factsTiming: string | null; factsReproducibility: string | null; factsLocked: boolean;
  treePath: GuidedTreePathEntry[] | null; treeLeafId: string | null;
  aiConfidence: number | null; approvedBy: string | null; approvedAt: string | null; answers: RcaAnswer[]; lessons: RcaLesson[];
}
const RCA_STATUS_LABEL: Record<string, string> = { OPEN: 'פתוח', INVESTIGATION: 'בתחקור', COMPLETED: 'הושלם', CANCELLED: 'בוטל' };
const RCA_STATUS_COLOR: Record<string, string> = { OPEN: C.textMuted, INVESTIGATION: C.warning, COMPLETED: C.success, CANCELLED: C.danger };
interface RelevantTeam { id: string; name: string; members: { id: string; fullName: string }[]; }
interface RootCauseTaxonomy { categories: string[]; taxonomy: Record<string, string[]>; }

// GUIDED method — decision-tree reference data (see backend's
// guided-investigation-tree.ts, which this mirrors 1:1).
interface GuidedTreeOption { value: string; label: string; next?: string; }
interface GuidedTreeNode { id: string; question: string; options: GuidedTreeOption[]; }
interface GuidedTreeLeaf {
  id: string; directCause: string; rootCause: string; category: string; rootCauseReason: string;
  correctiveAction: string; preventiveAction: string;
}
interface GuidedTree { nodes: Record<string, GuidedTreeNode>; leaves: Record<string, GuidedTreeLeaf>; start: Record<string, string>; }
const GUIDED_TIMING_LABEL: Record<string, string> = {
  AFTER_RELEASE: 'לאחר עליית גרסה', AFTER_INFRA_CHANGE: 'לאחר שינוי תשתיתי',
  AFTER_CONFIG_CHANGE: 'לאחר שינוי קונפיגורציה', UNKNOWN: 'לא ידוע',
};
const GUIDED_REPRO_LABEL: Record<string, string> = { ALWAYS: 'תמיד', PARTIAL: 'חלקית', RANDOM: 'אקראית' };
interface ActionItemT {
  id: string; title: string; team: string; ownerName: string | null; dueAt: string | null;
  notes: string | null; priority: string; status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'OVERDUE';
}
interface ChatMessage { id: string; role: 'AI' | 'USER'; content: string; concluded: boolean; createdAt: string; }
interface IncidentDetail {
  id: string; versionId: string; qcDefectId: string; title: string; description: string | null;
  status: 'NEW' | 'ANALYZING' | 'RCA_DONE' | 'CLOSED'; severity: string | null;
  defectType: string | null; crReferenceNumber: string | null;
  mainModule: string | null; subModule: string | null; systemComponent: string | null;
  impact: string | null; businessProcess: string | null; mainBusinessProcess: string | null;
  affectedUsersCount: number | null; customerFacing: boolean | null; downtimeMinutes: number | null;
  evidence: Evidence[]; rca: Rca | null; actions: ActionItemT[]; chatMessages: ChatMessage[];
}

const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const PRIORITY_LABEL: Record<string, string> = { LOW: 'נמוכה', MEDIUM: 'בינונית', HIGH: 'גבוהה', CRITICAL: 'קריטית' };
const ACTION_STATUS_LABEL: Record<string, string> = { OPEN: 'פתוח', IN_PROGRESS: 'בתהליך', DONE: 'הושלם', OVERDUE: 'באיחור' };
const ACTION_STATUS_COLOR: Record<string, string> = { OPEN: C.textMuted, IN_PROGRESS: C.warning, DONE: C.success, OVERDUE: C.danger };

const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md,
  fontFamily: FONT, fontSize: '13px', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = { ...TEXT.xs, color: C.textMuted, marginBottom: '4px', display: 'block' };
const sectionTitleStyle: React.CSSProperties = { ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.03em' };

interface Props { token: string; role: string; incidentId: string; onClose: () => void; onChanged: () => void; }

type Mode = 'CHOOSE' | 'AI_CHAT' | 'MANUAL';

// Two ways to run the RCA: a full AI-managed chat (see incidents.service.ts's
// startChat/replyChat — Claude collects evidence, asks the questions, and
// concludes on its own), or a manual investigation (5-Why/Fishbone, entered
// by hand, with an optional AI-assist button for suggesting the next
// question — see suggestNextWhyQuestion). Either way the resulting
// evidence/RCA/actions live in the same side panel, since a real incident
// still needs a human to confirm/assign/close it regardless of which path
// produced the analysis.
export const RcaWizardModal: React.FC<Props> = ({ token, role, incidentId, onClose, onChanged }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<Mode>('CHOOSE');
  const [teams, setTeams] = useState<RelevantTeam[]>([]);
  const [teamsScoped, setTeamsScoped] = useState(false);
  const [taxonomy, setTaxonomy] = useState<RootCauseTaxonomy | null>(null);
  const [guidedTree, setGuidedTree] = useState<GuidedTree | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Mode is derived from the incident's existing data (has a chat started?
  // has a manual RCA already?) exactly once, the first time it loads — after
  // that the user's explicit choice (or continuation) must stick even as
  // `incident` keeps refreshing with new answers/messages. Same
  // stale-refresh-vs-explicit-choice pattern as VersionOpeningModule's
  // userPickedStepRef.
  const modeInitialized = useRef(false);

  const load = useCallback(() => {
    setLoading(true);
    return axios.get(`${API}/incidents/${incidentId}`, { headers })
      .then(r => {
        const data = r.data as IncidentDetail;
        setIncident(data);
        if (!modeInitialized.current) {
          modeInitialized.current = true;
          if (data.chatMessages.length > 0 || data.rca?.method === 'AI') setMode('AI_CHAT');
          else if (data.rca && (data.rca.method === 'FIVE_WHY' || data.rca.method === 'FISHBONE')) setMode('MANUAL');
          else setMode('CHOOSE');
        }
        return data;
      })
      .catch(() => { setIncident(null); return null; })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  useEffect(() => { load(); }, [load]);

  // Real teams to offer for lessons/actions — scoped to the CrPlan teams for
  // this incident's linked CR when one resolves, else every active team (see
  // incidents.service.ts's getRelevantTeams). Fetched once per incident,
  // independent of `load()` since it doesn't change as the RCA progresses.
  useEffect(() => {
    axios.get(`${API}/incidents/${incidentId}/relevant-teams`, { headers })
      .then(r => { setTeams(r.data.teams); setTeamsScoped(r.data.scoped); })
      .catch(() => { setTeams([]); setTeamsScoped(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  // Fixed Root Cause Category → Root Cause (RCA) taxonomy for the manual
  // wizard's classification pickers — see root-cause-taxonomy.ts on the
  // backend. Static reference data, fetched once, independent of the incident.
  useEffect(() => {
    axios.get(`${API}/incidents/root-cause-taxonomy`, { headers })
      .then(r => setTaxonomy(r.data))
      .catch(() => setTaxonomy(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // GUIDED method's decision tree — static reference data, fetched once.
  useEffect(() => {
    axios.get(`${API}/incidents/guided-tree`, { headers })
      .then(r => setGuidedTree(r.data))
      .catch(() => setGuidedTree(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startAiChat = () => {
    setMode('AI_CHAT');
    setStarting(true);
    axios.post(`${API}/incidents/${incidentId}/chat/start`, {}, { headers })
      .then(() => load())
      .catch((e: any) => setError(e?.response?.data?.message || 'שגיאה בפתיחת השיחה'))
      .finally(() => setStarting(false));
  };

  const startManual = () => {
    setMode('MANUAL');
    if (incident && incident.evidence.length === 0) {
      setBusy(true);
      axios.post(`${API}/incidents/${incidentId}/collect`, {}, { headers }).then(() => load()).finally(() => setBusy(false));
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [incident?.chatMessages.length]);

  // Shared by ActionsPanel (side panel, always available once concluded) and
  // the Fishbone wizard's own action step (added inline, before the RCA is
  // even submitted) — same endpoint either way.
  const addAction = async (a: { title: string; team: string; owner?: string; dueAt?: string; priority?: string }) => {
    setBusy(true);
    try { await axios.post(`${API}/incidents/${incidentId}/actions`, a, { headers }); await load(); onChanged(); } finally { setBusy(false); }
  };

  const send = async () => {
    if (!draft.trim() || sending) return;
    const text = draft.trim();
    setDraft(''); setSending(true); setError(null);
    try {
      await axios.post(`${API}/incidents/${incidentId}/chat/reply`, { message: text }, { headers });
      await load();
      onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'שגיאה בשליחת הודעה');
    }
    setSending(false);
  };

  if (loading || !incident) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: C.bgApp, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001, fontFamily: FONT }}>
        <div style={{ ...TEXT.sm, color: C.textMuted }}>טוען...</div>
      </div>
    );
  }

  const concluded = ['RCA_DONE', 'CLOSED'].includes(incident.status);

  return (
    <div style={{ position: 'fixed', inset: 0, background: C.bgApp, zIndex: 1001, display: 'flex', flexDirection: 'column', fontFamily: FONT, direction: 'rtl' }}>
      <div style={{ background: C.bgCard, borderBottom: `1px solid ${C.border}`, padding: `${SP[3]} ${SP[5]}`, display: 'flex', alignItems: 'flex-start', gap: SP[3], flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', padding: '6px 12px', color: C.textSecondary, fontFamily: FONT, ...TEXT.sm }}>
          → חזרה
        </button>
        <div>
          <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>#{incident.qcDefectId} — {incident.title}</div>
          {incident.description && <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '4px' }}>{incident.description}</div>}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* ── Main column: choose method / AI chat / manual investigation ── */}
        <div style={{ flex: '1 1 60%', display: 'flex', flexDirection: 'column', minWidth: 0, borderLeft: `1px solid ${C.border}` }}>
          {mode === 'CHOOSE' && (
            <ChooseModeScreen onChooseAi={startAiChat} onChooseManual={startManual} />
          )}

          {mode === 'AI_CHAT' && (
            <>
              <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: SP[5], display: 'flex', flexDirection: 'column', gap: SP[3] }}>
                {error && <div style={{ ...TEXT.xs, color: C.danger, background: `${C.danger}11`, padding: '8px 10px', borderRadius: RADIUS.md }}>{error}</div>}
                {starting && incident.chatMessages.length === 0 && (
                  <div style={{ ...TEXT.sm, color: C.textMuted, alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: '6px' }}>🤖 אוסף ראיות ופותח שיחה...</div>
                )}
                {incident.chatMessages.map(m => (
                  <div key={m.id} style={{ alignSelf: m.role === 'USER' ? 'flex-start' : 'flex-end', maxWidth: '75%' }}>
                    <div style={{
                      background: m.role === 'USER' ? C.brand : (m.concluded ? `${C.success}18` : C.bgNested),
                      color: m.role === 'USER' ? 'white' : C.textPrimary,
                      border: m.concluded ? `1px solid ${C.success}` : 'none',
                      borderRadius: RADIUS.lg, padding: '10px 14px', whiteSpace: 'pre-wrap', ...TEXT.sm, lineHeight: 1.6,
                    }}>
                      {m.concluded && <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.success, marginBottom: '4px' }}>✅ ה-RCA הושלם</div>}
                      {m.content}
                    </div>
                  </div>
                ))}
                {sending && (
                  <div style={{ ...TEXT.sm, color: C.textMuted, alignSelf: 'flex-end' }}>🤖 חושב...</div>
                )}
              </div>

              {!concluded ? (
                <div style={{ borderTop: `1px solid ${C.border}`, padding: SP[3], display: 'flex', gap: SP[2], flexShrink: 0 }}>
                  <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder="הקלד תשובה..."
                    disabled={sending || starting}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button onClick={send} disabled={sending || starting || !draft.trim()} style={{ padding: '8px 20px', background: (!draft.trim() || sending) ? C.textDisabled : C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: (!draft.trim() || sending) ? 'not-allowed' : 'pointer', fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.bold }}>
                    שלח
                  </button>
                </div>
              ) : (
                <div style={{ borderTop: `1px solid ${C.border}`, padding: SP[3], textAlign: 'center', ...TEXT.xs, color: C.textMuted, flexShrink: 0 }}>
                  השיחה הושלמה — המשך בפאנל מימין (פעולות מעקב / סגירה)
                </div>
              )}
            </>
          )}

          {mode === 'MANUAL' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: SP[5] }}>
              <div style={{ maxWidth: '700px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: SP[3] }}>
                {error && <div style={{ ...TEXT.xs, color: C.danger, background: `${C.danger}11`, padding: '8px 10px', borderRadius: RADIUS.md }}>{error}</div>}
                <ManualRcaForm
                  incident={incident} busy={busy} token={token} teams={teams} teamsScoped={teamsScoped} taxonomy={taxonomy} guidedTree={guidedTree} onAddAction={addAction}
                  onTeamsResolved={(resolvedTeams) => { setTeams(resolvedTeams); setTeamsScoped(true); }}
                  onSubmit={async (payload) => {
                    setBusy(true); setError(null);
                    try {
                      await axios.post(`${API}/incidents/${incidentId}/rca`, payload, { headers });
                      await load(); onChanged();
                    } catch (e: any) { setError(e?.response?.data?.message || 'שגיאה בשמירת RCA'); }
                    setBusy(false);
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Side panel: incident details + evidence + RCA conclusion + actions + close ── */}
        <div style={{ flex: '0 0 380px', overflowY: 'auto', padding: SP[4], display: 'flex', flexDirection: 'column', gap: SP[5], background: C.bgCard }}>
          <IncidentDetailsPanel incident={incident} busy={busy} onSaveTriage={async (patch) => {
            setBusy(true);
            try { await axios.patch(`${API}/incidents/${incidentId}/triage`, patch, { headers }); load(); onChanged(); } finally { setBusy(false); }
          }} />

          <EvidencePanel incident={incident} onAddManual={async (content) => {
            setBusy(true);
            try { await axios.post(`${API}/incidents/${incidentId}/evidence`, { content }, { headers }); load(); } finally { setBusy(false); }
          }} />

          {incident.rca && (
            <RcaSummaryPanel
              rca={incident.rca} busy={busy}
              onUpdateStatus={async (status) => {
                setBusy(true);
                try { await axios.patch(`${API}/incidents/${incidentId}/rca/status`, { status }, { headers }); load(); onChanged(); } finally { setBusy(false); }
              }}
            />
          )}

          {concluded && (
            <ActionsPanel
              incident={incident} busy={busy} teams={teams} teamsScoped={teamsScoped}
              onAdd={addAction}
              onUpdateStatus={async (actionId, status) => {
                setBusy(true);
                try { await axios.patch(`${API}/incidents/actions/${actionId}`, { status }, { headers }); load(); onChanged(); } finally { setBusy(false); }
              }}
            />
          )}

          {concluded && (
            <ClosePanel
              incident={incident} busy={busy} canClose={MANAGERS.includes(role)}
              onClose={async (rationale) => {
                setBusy(true); setError(null);
                try {
                  await axios.post(`${API}/incidents/${incidentId}/close`, { noActionRationale: rationale }, { headers });
                  load(); onChanged();
                } catch (e: any) { setError(e?.response?.data?.message || 'שגיאה בסגירת התקלה'); }
                setBusy(false);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// ── Choose-method screen ──────────────────────────────────────────────────────
const ChooseModeScreen: React.FC<{ onChooseAi: () => void; onChooseManual: () => void }> = ({ onChooseAi, onChooseManual }) => (
  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SP[5] }}>
    <div style={{ display: 'flex', gap: SP[4], maxWidth: '640px' }}>
      <button
        onClick={onChooseAi}
        style={{
          flex: 1, display: 'flex', flexDirection: 'column', gap: SP[2], padding: SP[4], textAlign: 'right',
          background: C.bgCard, border: `1.5px solid ${C.border}`, borderRadius: RADIUS.lg, cursor: 'pointer', fontFamily: FONT,
        }}
      >
        <div style={{ fontSize: '28px' }}>🤖</div>
        <div style={{ ...TEXT.md, fontWeight: WEIGHT.bold, color: C.textPrimary }}>ניהול על ידי AI</div>
        <div style={{ ...TEXT.xs, color: C.textMuted, lineHeight: 1.5 }}>שיחה מונחית — ה-AI אוסף ראיות, שואל שאלות, ומגיע למסקנה ולפעולות מוצעות בעצמו.</div>
      </button>
      <button
        onClick={onChooseManual}
        style={{
          flex: 1, display: 'flex', flexDirection: 'column', gap: SP[2], padding: SP[4], textAlign: 'right',
          background: C.bgCard, border: `1.5px solid ${C.border}`, borderRadius: RADIUS.lg, cursor: 'pointer', fontFamily: FONT,
        }}
      >
        <div style={{ fontSize: '28px' }}>✍️</div>
        <div style={{ ...TEXT.md, fontWeight: WEIGHT.bold, color: C.textPrimary }}>תחקיר עצמי</div>
        <div style={{ ...TEXT.xs, color: C.textMuted, lineHeight: 1.5 }}>5-Why / עצם דג — אתה מנהל את הניתוח, עם אפשרות ל-AI להציע את השאלה הבאה אם תרצה.</div>
      </button>
    </div>
  </div>
);

// ── Manual RCA form (5-Why / Fishbone, human-conducted) ───────────────────────
const METHOD_LABEL: Record<'FIVE_WHY' | 'FISHBONE' | 'GUIDED', string> = { FIVE_WHY: '5 למה', FISHBONE: 'עצם דג', GUIDED: 'חקירה מונחית' };

const ManualRcaForm: React.FC<{
  incident: IncidentDetail; busy: boolean; token: string; teams: RelevantTeam[]; teamsScoped: boolean;
  taxonomy: RootCauseTaxonomy | null; guidedTree: GuidedTree | null;
  onSubmit: (payload: any) => void;
  onAddAction: (a: { title: string; team: string; owner?: string; dueAt?: string; priority?: string }) => void;
  onTeamsResolved: (teams: RelevantTeam[]) => void;
}> = ({ incident, busy, token, teams, teamsScoped, taxonomy, guidedTree, onSubmit, onAddAction, onTeamsResolved }) => {
  const [method, setMethod] = useState<'FIVE_WHY' | 'FISHBONE' | 'GUIDED'>(
    incident.rca && incident.rca.method !== 'AI' ? incident.rca.method : 'FIVE_WHY',
  );
  const readOnly = incident.status === 'RCA_DONE' || incident.status === 'CLOSED';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[3] }}>
      <div style={{ display: 'flex', gap: SP[2] }}>
        {(['FIVE_WHY', 'FISHBONE', 'GUIDED'] as const).map(m => (
          <button key={m} onClick={() => !readOnly && setMethod(m)} disabled={readOnly} style={{ padding: '5px 12px', borderRadius: RADIUS.md, border: `1.5px solid ${method === m ? C.brand : C.border}`, background: method === m ? C.brandDim : 'transparent', color: method === m ? C.brand : C.textSecondary, cursor: readOnly ? 'default' : 'pointer', fontFamily: FONT, ...TEXT.sm }}>
            {METHOD_LABEL[m]}
          </button>
        ))}
      </div>

      {!teamsScoped && !readOnly && (
        <CrTeamsResolver versionId={incident.versionId} token={token} onResolved={onTeamsResolved} />
      )}

      {method === 'FIVE_WHY' && <FiveWhyForm incident={incident} busy={busy} token={token} teams={teams} teamsScoped={teamsScoped} taxonomy={taxonomy} readOnly={readOnly} onSubmit={onSubmit} />}
      {method === 'FISHBONE' && <FishboneWizard incident={incident} busy={busy} teams={teams} teamsScoped={teamsScoped} taxonomy={taxonomy} readOnly={readOnly} onSubmit={onSubmit} onAddAction={onAddAction} />}
      {method === 'GUIDED' && <GuidedInvestigationWizard incident={incident} busy={busy} token={token} teams={teams} teamsScoped={teamsScoped} guidedTree={guidedTree} readOnly={readOnly} onSubmit={onSubmit} />}
    </div>
  );
};

// Category → Reason cascading pickers (Root Cause Category / Root Cause
// (RCA), see root-cause-taxonomy.ts) plus the detailed RCA Description —
// distinct from the short free-text root-cause summary above it. Shared by
// FiveWhyForm and FishboneWizard's step 2.
const RootCauseClassifier: React.FC<{
  taxonomy: RootCauseTaxonomy | null; readOnly?: boolean;
  category: string; reason: string; description: string;
  onCategoryChange: (v: string) => void; onReasonChange: (v: string) => void; onDescriptionChange: (v: string) => void;
}> = ({ taxonomy, readOnly, category, reason, description, onCategoryChange, onReasonChange, onDescriptionChange }) => {
  if (!taxonomy) return null;
  const reasons = taxonomy.taxonomy[category] ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
      <div style={{ display: 'flex', gap: SP[2] }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>קטגוריית גורם שורש (Root Cause Category)</label>
          <select
            value={category} disabled={readOnly}
            onChange={e => { onCategoryChange(e.target.value); onReasonChange(''); }}
            style={inputStyle}
          >
            <option value="">בחר קטגוריה...</option>
            {taxonomy.categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>גורם שורש (Root Cause)</label>
          <select value={reason} disabled={readOnly || !category} onChange={e => onReasonChange(e.target.value)} style={inputStyle}>
            <option value="">{category ? 'בחר גורם...' : 'בחרו קטגוריה קודם'}</option>
            {reasons.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label style={labelStyle}>תיאור מפורט (RCA Description)</label>
        <textarea
          value={description} disabled={readOnly} onChange={e => onDescriptionChange(e.target.value)} rows={3}
          placeholder="הקשר, תנאים וגורמים שהובילו לתקלה..." style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>
    </div>
  );
};

// Fallback-mode alternative to picking teams one at a time: if the user
// knows the real CR the fault traces back to (even though it wasn't
// auto-linked from the incident's QC record), they can pick it here and load
// whichever teams actually worked it via its real CrPlan — same resolution
// getRelevantTeams does automatically, just user-triggered. Once teams come
// back, the whole form (lessons + actions) flips into scoped mode, same as
// the automatic case.
const CrTeamsResolver: React.FC<{ versionId: string; token: string; onResolved: (teams: RelevantTeam[]) => void }> = ({ versionId, token, onResolved }) => {
  const [crs, setCrs] = useState<{ crNumber: string; label: string }[]>([]);
  const [selectedCr, setSelectedCr] = useState('');
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    axios.get(`${API}/incidents/golive/${versionId}/crs`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setCrs(r.data))
      .catch(() => setCrs([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId]);

  if (!crs.length) return null;

  const apply = async () => {
    if (!selectedCr) return;
    setLoading(true); setNotFound(false);
    try {
      const res = await axios.get(`${API}/incidents/golive/${versionId}/crs/${selectedCr}/teams`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.data.teams.length) onResolved(res.data.teams);
      else setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: C.bgNested, borderRadius: RADIUS.md, padding: SP[2] }}>
      <div style={{ ...TEXT.xs, color: C.textMuted }}>יודעים באיזה CR מדובר? בחרו אותו כדי לטעון את הצוותים שעבדו עליו בפועל.</div>
      <div style={{ display: 'flex', gap: '6px' }}>
        <select value={selectedCr} onChange={e => { setSelectedCr(e.target.value); setNotFound(false); }} style={{ ...inputStyle, flex: 1 }}>
          <option value="">בחר CR...</option>
          {crs.map(c => <option key={c.crNumber} value={c.crNumber}>{c.label}</option>)}
        </select>
        <button
          onClick={apply}
          disabled={!selectedCr || loading}
          style={{ padding: '5px 14px', background: C.bgApp, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: (!selectedCr || loading) ? 'not-allowed' : 'pointer', color: C.textSecondary, fontFamily: FONT, ...TEXT.xs }}
        >
          {loading ? 'טוען...' : 'טען צוותים'}
        </button>
      </div>
      {notFound && <div style={{ ...TEXT.xs, color: C.warning }}>לא נמצאה תוכנית CR עם צוותים משויכים ל-CR שנבחר.</div>}
    </div>
  );
};

// Small transparency note shown wherever a team dropdown/list is scoped —
// explains why the list is short (or long) instead of leaving it unexplained.
const TeamsScopeNote: React.FC<{ scoped: boolean }> = ({ scoped }) => (
  <div style={{ ...TEXT.xs, color: C.textMuted, fontStyle: 'italic' }}>
    {scoped ? 'הצוותים מוצגים לפי מי שעבד בפועל על ה-CR המקושר לתקלה' : 'לא נמצא CR מקושר — בחרו צוות רלוונטי מהרשימה'}
  </div>
);

// Seeds the LessonsEditor's controlled state: scoped mode pre-adds every
// team (matches today's "show them all" UX); unscoped mode only pre-adds
// teams that already have a saved lesson (re-opening an existing RCA),
// leaving the rest to be added on demand via the picker.
function initialLessons(teams: RelevantTeam[], teamsScoped: boolean, existing: RcaLesson[] | undefined): Record<string, string> {
  if (teamsScoped) {
    return Object.fromEntries(teams.map(t => [t.id, existing?.find(l => l.teamId === t.id || l.teamName === t.name)?.text ?? '']));
  }
  const entries: [string, string][] = [];
  for (const l of existing ?? []) {
    const t = teams.find(x => x.id === l.teamId || x.name === l.teamName);
    if (t) entries.push([t.id, l.text]);
  }
  return Object.fromEntries(entries);
}

// Turns the LessonsEditor's {teamId: text} state into the array the API
// expects — iterates the state's own keys (whichever teams were actually
// added), not the full `teams` list, since unscoped mode only has a handful
// of those keys present even when `teams` itself has dozens of entries.
function lessonsPayload(teams: RelevantTeam[], lessons: Record<string, string>): { teamId: string; teamName: string; text: string }[] {
  return Object.entries(lessons)
    .map(([teamId, text]) => ({ teamId, teamName: teams.find(t => t.id === teamId)?.name ?? teamId, text }))
    .filter(l => l.text.trim());
}

// ── Lessons-per-team editor ────────────────────────────────────────────────
// Scoped (CR-linked, few real teams): shows every relevant team as an
// always-visible row — short list, worth seeing all at once. Unscoped
// (fallback to the full active-team list, potentially dozens): showing
// every team as a field would be noise, so instead it's pick-one-add-one —
// a row only appears once you've explicitly chosen that team. "Added" is
// tracked purely by key presence in `value` (even an empty string), so
// removing a row is just deleting its key.
const LessonsEditor: React.FC<{
  teams: RelevantTeam[]; teamsScoped: boolean; readOnly?: boolean;
  value: Record<string, string>; onChange: (next: Record<string, string>) => void;
}> = ({ teams, teamsScoped, readOnly, value, onChange }) => {
  const [addingTeamId, setAddingTeamId] = useState('');
  const addedIds = Object.keys(value);
  const availableTeams = teams.filter(t => !addedIds.includes(t.id));

  const setText = (teamId: string, text: string) => onChange({ ...value, [teamId]: text });
  const removeRow = (teamId: string) => { const next = { ...value }; delete next[teamId]; onChange(next); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
      <TeamsScopeNote scoped={teamsScoped} />
      {addedIds.map(id => {
        const t = teams.find(x => x.id === id);
        return (
          <div key={id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={labelStyle}>{t?.name ?? id}</label>
              {!teamsScoped && !readOnly && (
                <button onClick={() => removeRow(id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, ...TEXT.xs }}>✕ הסר</button>
              )}
            </div>
            <input value={value[id]} disabled={readOnly} onChange={e => setText(id, e.target.value)} style={inputStyle} />
          </div>
        );
      })}
      {!teamsScoped && !readOnly && availableTeams.length > 0 && (
        <div style={{ display: 'flex', gap: '6px' }}>
          <select value={addingTeamId} onChange={e => setAddingTeamId(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
            <option value="">בחר צוות...</option>
            {availableTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button
            onClick={() => { if (addingTeamId) { setText(addingTeamId, ''); setAddingTeamId(''); } }}
            disabled={!addingTeamId}
            style={{ padding: '5px 14px', background: addingTeamId ? C.bgNested : C.bgApp, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: addingTeamId ? 'pointer' : 'not-allowed', color: C.textSecondary, fontFamily: FONT, ...TEXT.xs }}
          >
            + הוסף לקח
          </button>
        </div>
      )}
    </div>
  );
};

// ── 5-Why form (unchanged flat form, just extracted) ──────────────────────────
const FiveWhyForm: React.FC<{
  incident: IncidentDetail; busy: boolean; token: string; teams: RelevantTeam[]; teamsScoped: boolean; taxonomy: RootCauseTaxonomy | null; readOnly: boolean;
  onSubmit: (payload: any) => void;
}> = ({ incident, busy, token, teams, teamsScoped, taxonomy, readOnly, onSubmit }) => {
  const [rootCause, setRootCause] = useState(incident.rca?.rootCause ?? '');
  const [category, setCategory] = useState(incident.rca?.category ?? '');
  const [reason, setReason] = useState(incident.rca?.rootCauseReason ?? '');
  const [description, setDescription] = useState(incident.rca?.description ?? '');
  const [lessons, setLessons] = useState<Record<string, string>>(() => initialLessons(teams, teamsScoped, incident.rca?.lessons));
  const [answers, setAnswers] = useState<{ step: number; question: string; answer: string }[]>(
    incident.rca?.method === 'FIVE_WHY' && incident.rca.answers.length ? incident.rca.answers.map(a => ({ step: a.step, question: a.question, answer: a.answer })) : [
      { step: 1, question: 'למה קרתה התקלה?', answer: '' },
      { step: 2, question: 'למה?', answer: '' },
      { step: 3, question: 'למה?', answer: '' },
    ],
  );
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  // Asks Claude for the next probing "why" given the chain so far — purely
  // an assist: the result lands in a normal editable input, same as the
  // manual "+ הוסף סבב" flow. The human still runs the investigation.
  const suggestNextQuestion = async () => {
    const answered = answers.filter(a => a.answer.trim());
    if (!answered.length) { setSuggestError('יש למלא תשובה לפחות לשאלה אחת לפני שאפשר להציע את הבאה'); return; }
    setSuggesting(true); setSuggestError(null);
    try {
      const res = await axios.post(`${API}/incidents/${incident.id}/rca/next-question`, { answers: answered }, { headers: { Authorization: `Bearer ${token}` } });
      setAnswers(prev => [...prev, { step: prev.length + 1, question: res.data.question, answer: '' }]);
    } catch (e: any) {
      setSuggestError(e?.response?.data?.message || 'שגיאה בהצעת השאלה הבאה');
    }
    setSuggesting(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[3] }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
        {answers.map((a, i) => (
          <div key={i}>
            <label style={labelStyle}>שאלה {a.step}</label>
            <input value={a.question} disabled={readOnly} onChange={e => setAnswers(prev => prev.map((x, xi) => xi === i ? { ...x, question: e.target.value } : x))} style={{ ...inputStyle, marginBottom: '4px' }} />
            <textarea value={a.answer} disabled={readOnly} onChange={e => setAnswers(prev => prev.map((x, xi) => xi === i ? { ...x, answer: e.target.value } : x))} rows={2} placeholder="תשובה..." style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
        ))}
        {suggestError && <div style={{ ...TEXT.xs, color: C.danger }}>{suggestError}</div>}
        {!readOnly && (
          <div style={{ display: 'flex', gap: SP[2] }}>
            <button onClick={() => setAnswers(prev => [...prev, { step: prev.length + 1, question: 'למה?', answer: '' }])} style={{ padding: '5px 10px', background: 'none', border: `1px dashed ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', color: C.textMuted, fontFamily: FONT, ...TEXT.xs }}>
              + הוסף סבב "למה"
            </button>
            <button onClick={suggestNextQuestion} disabled={suggesting} style={{ padding: '5px 10px', background: 'none', border: `1px dashed ${C.brand}`, borderRadius: RADIUS.md, cursor: suggesting ? 'not-allowed' : 'pointer', color: C.brand, fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.bold }}>
              {suggesting ? 'חושב...' : '🤖 הצע שאלה הבאה'}
            </button>
          </div>
        )}
      </div>

      <div>
        <label style={labelStyle}>גורם שורש (סיכום)</label>
        <textarea value={rootCause} disabled={readOnly} onChange={e => setRootCause(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
      </div>

      <RootCauseClassifier
        taxonomy={taxonomy} readOnly={readOnly} category={category} reason={reason} description={description}
        onCategoryChange={setCategory} onReasonChange={setReason} onDescriptionChange={setDescription}
      />

      <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textSecondary }}>לקחים לפי צוות (ניתן להשאיר ריק אם לא רלוונטי)</div>
      <LessonsEditor teams={teams} teamsScoped={teamsScoped} readOnly={readOnly} value={lessons} onChange={setLessons} />

      {!readOnly && (
        <button
          onClick={() => onSubmit({
            method: 'FIVE_WHY', rootCause: rootCause || undefined, category: category || undefined,
            rootCauseReason: reason || undefined, description: description || undefined,
            answers: answers.filter(a => a.answer.trim()),
            lessons: lessonsPayload(teams, lessons),
          })}
          disabled={busy}
          style={{ alignSelf: 'flex-start', padding: '8px 20px', background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.bold }}
        >
          {busy ? 'שומר...' : '💾 שמור RCA'}
        </button>
      )}
    </div>
  );
};

// ── Fishbone wizard — the real methodology, guided step by step ──────────────
// 1) brainstorm candidate causes per fixed category, 2) converge on ONE root
// cause among everything listed, 3) lessons per team, 4) add follow-up
// actions right here (already hitting the real API, not just staged locally)
// before the final save. Categories are the standard 4 for a software/DevOps
// context (People/Process/Technology/Environment) — stored as the English
// key in RcaAnswer.question for stability, displayed via FISHBONE_CATEGORY_LABEL.
const FISHBONE_CATEGORIES = ['People', 'Process', 'Technology', 'Environment'] as const;
const FISHBONE_CATEGORY_LABEL: Record<string, string> = { People: 'אנשים', Process: 'תהליך', Technology: 'טכנולוגיה', Environment: 'סביבה' };

interface FishboneCause { category: string; text: string; isRootCause: boolean }

const FishboneWizard: React.FC<{
  incident: IncidentDetail; busy: boolean; teams: RelevantTeam[]; teamsScoped: boolean; taxonomy: RootCauseTaxonomy | null; readOnly: boolean;
  onSubmit: (payload: any) => void;
  onAddAction: (a: { title: string; team: string; owner?: string; dueAt?: string; priority?: string }) => void;
}> = ({ incident, busy, teams, teamsScoped, taxonomy, readOnly, onSubmit, onAddAction }) => {
  const existingCauses: FishboneCause[] = incident.rca?.method === 'FISHBONE' && incident.rca.answers.length
    ? incident.rca.answers.map(a => ({ category: a.question, text: a.answer, isRootCause: a.isRootCause }))
    : [];
  const [causes, setCauses] = useState<FishboneCause[]>(existingCauses);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rootCause, setRootCause] = useState(incident.rca?.rootCause ?? '');
  // Named rc* to disambiguate from the Fishbone "bone" category (People/
  // Process/Technology/Environment) used above in `causes`/`drafts` — this is
  // the separate Root Cause Category/Reason taxonomy classification.
  const [rcCategory, setRcCategory] = useState(incident.rca?.category ?? '');
  const [rcReason, setRcReason] = useState(incident.rca?.rootCauseReason ?? '');
  const [rcDescription, setRcDescription] = useState(incident.rca?.description ?? '');
  const [lessons, setLessons] = useState<Record<string, string>>(() => initialLessons(teams, teamsScoped, incident.rca?.lessons));
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const addCause = (category: string) => {
    const text = (drafts[category] ?? '').trim();
    if (!text) return;
    setCauses(prev => [...prev, { category, text, isRootCause: false }]);
    setDrafts(prev => ({ ...prev, [category]: '' }));
  };
  const removeCause = (idx: number) => setCauses(prev => prev.filter((_, i) => i !== idx));
  const markRoot = (idx: number) => {
    setCauses(prev => prev.map((c, i) => ({ ...c, isRootCause: i === idx })));
    setRootCause(causes[idx].text);
  };

  // Already saved (read-only) — show a flat summary instead of the stepper.
  if (readOnly) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: SP[3] }}>
        {FISHBONE_CATEGORIES.map(cat => {
          const inCat = causes.filter(c => c.category === cat);
          if (!inCat.length) return null;
          return (
            <div key={cat}>
              <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textSecondary }}>{FISHBONE_CATEGORY_LABEL[cat]}</div>
              {inCat.map((c, i) => (
                <div key={i} style={{ ...TEXT.sm, color: c.isRootCause ? C.success : C.textPrimary, fontWeight: c.isRootCause ? WEIGHT.bold : WEIGHT.normal }}>
                  {c.isRootCause ? '🎯 ' : '• '}{c.text}
                </div>
              ))}
            </div>
          );
        })}
        <div>
          <label style={labelStyle}>גורם שורש (סיכום)</label>
          <div style={{ ...TEXT.sm, color: C.textPrimary }}>{rootCause || '—'}</div>
        </div>
        {(rcCategory || rcReason || rcDescription) && (
          <div>
            <label style={labelStyle}>סיווג גורם שורש</label>
            {(rcCategory || rcReason) && <div style={{ ...TEXT.sm, color: C.textPrimary }}>{[rcCategory, rcReason].filter(Boolean).join(' › ')}</div>}
            {rcDescription && <div style={{ ...TEXT.sm, color: C.textSecondary, marginTop: '4px' }}>{rcDescription}</div>}
          </div>
        )}
      </div>
    );
  }

  const STEP_LABELS = ['זיהוי גורמים אפשריים', 'בחירת גורם השורש', 'לקחים לפי צוות', 'פעולות מעקב'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: SP[1] }}>
        {STEP_LABELS.map((label, i) => (
          <React.Fragment key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: '22px', height: '22px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: step === i + 1 ? C.brand : step > i + 1 ? C.success : C.bgNested,
                color: step >= i + 1 ? 'white' : C.textMuted, ...TEXT.xs, fontWeight: WEIGHT.bold, flexShrink: 0,
              }}>
                {step > i + 1 ? '✓' : i + 1}
              </span>
              <span style={{ ...TEXT.xs, color: step === i + 1 ? C.textPrimary : C.textMuted, fontWeight: step === i + 1 ? WEIGHT.bold : WEIGHT.normal }}>{label}</span>
            </div>
            {i < STEP_LABELS.length - 1 && <div style={{ flex: 1, height: '1px', background: C.border }} />}
          </React.Fragment>
        ))}
      </div>

      {/* Step 1 — brainstorm causes per category */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SP[3] }}>
          <div style={{ ...TEXT.xs, color: C.textMuted }}>עבור כל קטגוריה, רשמו כל גורם אפשרי שעולה בדעתכם — גם אם לא בטוחים בו. נצמצם לגורם השורש בשלב הבא.</div>
          {FISHBONE_CATEGORIES.map(cat => (
            <div key={cat} style={{ border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: SP[2] }}>
              <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textSecondary, marginBottom: '6px' }}>{FISHBONE_CATEGORY_LABEL[cat]}</div>
              {causes.filter(c => c.category === cat).map((c) => {
                const idx = causes.indexOf(c);
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ ...TEXT.sm, color: C.textPrimary, flex: 1 }}>• {c.text}</span>
                    <button onClick={() => removeCause(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, ...TEXT.xs }}>✕</button>
                  </div>
                );
              })}
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  value={drafts[cat] ?? ''} onChange={e => setDrafts(prev => ({ ...prev, [cat]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCause(cat); } }}
                  placeholder="גורם אפשרי..." style={{ ...inputStyle, flex: 1, fontSize: '12px' }}
                />
                <button onClick={() => addCause(cat)} style={{ padding: '5px 12px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: 'pointer', color: C.textSecondary, fontFamily: FONT, ...TEXT.xs }}>+</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Step 2 — converge on the root cause */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
          <div style={{ ...TEXT.xs, color: C.textMuted }}>מתוך כל הגורמים שנרשמו, בחרו איזה אחד הוא באמת גורם השורש.</div>
          {causes.map((c, i) => (
            <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: RADIUS.md, background: c.isRootCause ? `${C.success}18` : C.bgNested, border: c.isRootCause ? `1px solid ${C.success}` : '1px solid transparent', cursor: 'pointer' }}>
              <input type="radio" name="root-cause" checked={c.isRootCause} onChange={() => markRoot(i)} />
              <span style={{ ...TEXT.xs, color: C.textMuted, minWidth: '60px' }}>{FISHBONE_CATEGORY_LABEL[c.category]}</span>
              <span style={{ ...TEXT.sm, color: C.textPrimary, flex: 1 }}>{c.text}</span>
            </label>
          ))}
          <div style={{ marginTop: SP[2] }}>
            <label style={labelStyle}>גורם שורש (סיכום — ניתן לנסח מחדש)</label>
            <textarea value={rootCause} onChange={e => setRootCause(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
          <RootCauseClassifier
            taxonomy={taxonomy} category={rcCategory} reason={rcReason} description={rcDescription}
            onCategoryChange={setRcCategory} onReasonChange={setRcReason} onDescriptionChange={setRcDescription}
          />
        </div>
      )}

      {/* Step 3 — lessons per team */}
      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
          <div style={{ ...TEXT.xs, color: C.textMuted }}>לקחים לפי צוות — ניתן להשאיר ריק אם לא רלוונטי.</div>
          <LessonsEditor teams={teams} teamsScoped={teamsScoped} value={lessons} onChange={setLessons} />
        </div>
      )}

      {/* Step 4 — add follow-up actions, then finalize */}
      {step === 4 && (
        <FishboneActionsStep incident={incident} busy={busy} teams={teams} teamsScoped={teamsScoped} onAddAction={onAddAction} />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${C.border}`, paddingTop: SP[3] }}>
        <button
          onClick={() => setStep(prev => (prev - 1) as any)}
          disabled={step === 1}
          style={{ padding: '7px 16px', background: 'none', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: step === 1 ? 'not-allowed' : 'pointer', color: step === 1 ? C.textDisabled : C.textSecondary, fontFamily: FONT, ...TEXT.sm }}
        >
          ‹ הקודם
        </button>
        {step < 4 ? (
          <button
            onClick={() => setStep(prev => (prev + 1) as any)}
            disabled={(step === 1 && causes.length === 0) || (step === 2 && !causes.some(c => c.isRootCause))}
            style={{
              padding: '7px 16px', border: 'none', borderRadius: RADIUS.md, fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.bold, color: 'white',
              background: (step === 1 && causes.length === 0) || (step === 2 && !causes.some(c => c.isRootCause)) ? C.textDisabled : C.brand,
              cursor: (step === 1 && causes.length === 0) || (step === 2 && !causes.some(c => c.isRootCause)) ? 'not-allowed' : 'pointer',
            }}
          >
            הבא ›
          </button>
        ) : (
          <button
            onClick={() => onSubmit({
              method: 'FISHBONE', rootCause: rootCause || undefined, category: rcCategory || undefined,
              rootCauseReason: rcReason || undefined, description: rcDescription || undefined,
              answers: causes.map((c, i) => ({ step: i + 1, question: c.category, answer: c.text, isRootCause: c.isRootCause })),
              lessons: lessonsPayload(teams, lessons),
            })}
            disabled={busy}
            style={{ padding: '8px 20px', background: C.success, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.bold }}
          >
            {busy ? 'שומר...' : '✅ סיום — שמור RCA'}
          </button>
        )}
      </div>
    </div>
  );
};

// Real per-team member picker for the "אחראי" (owner) field on action
// items — same TeamMember-backed mechanism CrPlan/TaskDetailPanel use for
// assignees, instead of free text. Falls back to manual entry when the team
// has no registered members, or when the current value doesn't match one
// (e.g. someone outside the formal team roster still gets named as owner).
const OwnerField: React.FC<{ team: RelevantTeam | undefined; value: string; onChange: (v: string) => void }> = ({ team, value, onChange }) => {
  const members = team?.members ?? [];
  const [manual, setManual] = useState(!members.length || (!!value && !members.some(m => m.fullName === value)));

  useEffect(() => {
    setManual(!members.length || (!!value && !members.some(m => m.fullName === value)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id]);

  if (manual) {
    return (
      <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
        <input value={value} onChange={e => onChange(e.target.value)} placeholder="אחראי..." style={{ ...inputStyle, flex: 1 }} />
        {members.length > 0 && (
          <button type="button" onClick={() => { setManual(false); onChange(''); }} style={{ padding: '0 8px', background: 'none', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: 'pointer', color: C.textMuted, fontFamily: FONT, ...TEXT.xs }}>
            רשימה
          </button>
        )}
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={e => { if (e.target.value === '__other__') { setManual(true); onChange(''); } else onChange(e.target.value); }}
      style={{ ...inputStyle, flex: 1 }}
    >
      <option value="">בחר אחראי...</option>
      {members.map(m => <option key={m.id} value={m.fullName}>{m.fullName}</option>)}
      <option value="__other__">אחר...</option>
    </select>
  );
};

const FishboneActionsStep: React.FC<{
  incident: IncidentDetail; busy: boolean; teams: RelevantTeam[]; teamsScoped: boolean;
  onAddAction: (a: { title: string; team: string; owner?: string; dueAt?: string; priority?: string }) => void;
}> = ({ incident, busy, teams, teamsScoped, onAddAction }) => {
  const [title, setTitle] = useState('');
  const [team, setTeam] = useState(teams[0]?.name ?? '');
  const [owner, setOwner] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [priority, setPriority] = useState('MEDIUM');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
      <div style={{ ...TEXT.xs, color: C.textMuted }}>בהתבסס על גורם השורש שזיהיתם, הוסיפו פעולות מעקב לפני שמסיימים (אפשר להוסיף עוד גם אחר כך).</div>
      {incident.actions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {incident.actions.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: C.bgNested, borderRadius: RADIUS.md, padding: '6px 10px' }}>
              <span style={{ ...TEXT.xs, color: C.brand, background: C.brandDim, borderRadius: RADIUS.sm, padding: '2px 6px', fontWeight: WEIGHT.bold }}>{a.team}</span>
              <span style={{ ...TEXT.sm, color: C.textPrimary, flex: 1 }}>{a.title}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: incident.actions.length ? `1px solid ${C.border}` : 'none', paddingTop: incident.actions.length ? SP[2] : 0 }}>
        <TeamsScopeNote scoped={teamsScoped} />
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="כותרת הפעולה..." style={inputStyle} />
        <div style={{ display: 'flex', gap: SP[2] }}>
          <select value={team} onChange={e => { setTeam(e.target.value); setOwner(''); }} style={{ ...inputStyle, flex: 1 }}>
            {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
          <select value={priority} onChange={e => setPriority(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
            {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: SP[2] }}>
          <OwnerField team={teams.find(t => t.name === team)} value={owner} onChange={setOwner} />
          <input type="date" value={dueAt} onChange={e => setDueAt(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
        </div>
        <button
          onClick={() => { if (title.trim()) { onAddAction({ title: title.trim(), team, owner: owner || undefined, dueAt: dueAt || undefined, priority }); setTitle(''); setOwner(''); setDueAt(''); } }}
          disabled={busy || !title.trim()}
          style={{ alignSelf: 'flex-start', padding: '7px 16px', background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontFamily: FONT, ...TEXT.sm }}
        >
          + הוסף פעולה
        </button>
      </div>
    </div>
  );
};

// ── Guided (facts-first) investigation wizard ─────────────────────────────────
// Product spec from the user 2026-08-09: most RCAs fail because the
// investigator jumps straight to "what's the root cause?" while still in
// fact-finding. This method makes that structurally impossible instead of
// just discouraging it: stage 2 (facts) must be saved and locked
// (POST .../rca/facts) before stage 3 (this component's tree) is even
// shown, and stage 3 itself only offers fixed answer options — there is no
// free-text "root cause" box anywhere in this flow. The category/root
// cause/direct cause/corrective+preventive actions are entirely inferred
// from the path taken through guided-investigation-tree.ts, computed once a
// leaf is reached — never asked for directly.
type GuidedStage = 'facts' | 'tree' | 'review';

const GuidedInvestigationWizard: React.FC<{
  incident: IncidentDetail; busy: boolean; token: string; teams: RelevantTeam[]; teamsScoped: boolean;
  guidedTree: GuidedTree | null; readOnly: boolean;
  onSubmit: (payload: any) => void;
}> = ({ incident, busy, token, teams, teamsScoped, guidedTree, readOnly, onSubmit }) => {
  const existingRca = incident.rca?.method === 'GUIDED' ? incident.rca : null;

  const [stage, setStage] = useState<GuidedStage>(() => {
    if (existingRca?.treeLeafId) return 'review';
    if (existingRca?.factsLocked) return 'tree';
    return 'facts';
  });
  const [actionTaken, setActionTaken] = useState(existingRca?.factsActionTaken ?? '');
  const [expectedResult, setExpectedResult] = useState(existingRca?.factsExpectedResult ?? '');
  const [actualResult, setActualResult] = useState(existingRca?.factsActualResult ?? '');
  const [timing, setTiming] = useState(existingRca?.factsTiming ?? '');
  const [reproducibility, setReproducibility] = useState(existingRca?.factsReproducibility ?? '');
  const [savingFacts, setSavingFacts] = useState(false);
  const [factsError, setFactsError] = useState<string | null>(null);

  const [path, setPath] = useState<GuidedTreePathEntry[]>(existingRca?.treePath ?? []);
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [leafId, setLeafId] = useState<string | null>(existingRca?.treeLeafId ?? null);

  const [lessons, setLessons] = useState<Record<string, string>>(() => initialLessons(teams, teamsScoped, incident.rca?.lessons));

  useEffect(() => {
    if (stage === 'tree' && !currentNodeId && guidedTree && timing) {
      setCurrentNodeId(guidedTree.start[timing]);
    }
  }, [stage, currentNodeId, guidedTree, timing]);

  const factsComplete = actionTaken.trim() && expectedResult.trim() && actualResult.trim() && timing && reproducibility;

  const saveFacts = async () => {
    if (!factsComplete) return;
    setSavingFacts(true); setFactsError(null);
    try {
      await axios.post(`${API}/incidents/${incident.id}/rca/facts`, { actionTaken, expectedResult, actualResult, timing, reproducibility }, { headers: { Authorization: `Bearer ${token}` } });
      setStage('tree');
    } catch (e: any) {
      setFactsError(e?.response?.data?.message || 'שגיאה בשמירת העובדות');
    }
    setSavingFacts(false);
  };

  const chooseOption = (opt: GuidedTreeOption) => {
    if (!guidedTree || !currentNodeId) return;
    const node = guidedTree.nodes[currentNodeId];
    const entry: GuidedTreePathEntry = { nodeId: currentNodeId, question: node.question, answerValue: opt.value, answerLabel: opt.label };
    const newPath = [...path, entry];
    setPath(newPath);
    if (opt.next) {
      setCurrentNodeId(opt.next);
    } else {
      setLeafId(`${currentNodeId}:${opt.value}`);
      setStage('review');
    }
  };

  const stepBack = () => {
    if (!path.length) return;
    const prev = path[path.length - 1];
    setPath(path.slice(0, -1));
    setCurrentNodeId(prev.nodeId);
  };

  if (!guidedTree) return <div style={{ ...TEXT.sm, color: C.textMuted }}>טוען עץ חקירה...</div>;

  const leaf = leafId ? guidedTree.leaves[leafId] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      {/* Stage indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: SP[1] }}>
        {(['facts', 'tree', 'review'] as const).map((s, i) => {
          const labels: Record<GuidedStage, string> = { facts: 'איסוף עובדות', tree: 'חקירת שרשרת האירועים', review: 'גורם שורש ופעולות' };
          const stageOrder: GuidedStage[] = ['facts', 'tree', 'review'];
          const idx = stageOrder.indexOf(stage);
          return (
            <React.Fragment key={s}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{
                  width: '22px', height: '22px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: stage === s ? C.brand : idx > i ? C.success : C.bgNested,
                  color: idx >= i ? 'white' : C.textMuted, ...TEXT.xs, fontWeight: WEIGHT.bold, flexShrink: 0,
                }}>
                  {idx > i ? '✓' : i + 1}
                </span>
                <span style={{ ...TEXT.xs, color: stage === s ? C.textPrimary : C.textMuted, fontWeight: stage === s ? WEIGHT.bold : WEIGHT.normal }}>{labels[s]}</span>
              </div>
              {i < 2 && <div style={{ flex: 1, height: '1px', background: C.border }} />}
            </React.Fragment>
          );
        })}
      </div>

      {/* Stage 2 — facts only, blocks progression until complete */}
      {stage === 'facts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SP[3] }}>
          <div style={{ ...TEXT.xs, color: C.textMuted }}>יש למלא את כל השדות הבאים לפני מעבר לחקירת שרשרת האירועים — המערכת אינה מאפשרת לדלג ישירות למסקנות.</div>
          <div>
            <label style={labelStyle}>מה הפעולה שבוצעה?</label>
            <input value={actionTaken} disabled={readOnly} onChange={e => setActionTaken(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>מה היה אמור לקרות?</label>
            <input value={expectedResult} disabled={readOnly} onChange={e => setExpectedResult(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>מה קרה בפועל?</label>
            <input value={actualResult} disabled={readOnly} onChange={e => setActualResult(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>מתי התחילה התקלה?</label>
            <div style={{ display: 'flex', gap: SP[2], flexWrap: 'wrap' }}>
              {Object.entries(GUIDED_TIMING_LABEL).map(([v, l]) => (
                <button key={v} onClick={() => !readOnly && setTiming(v)} disabled={readOnly} style={{ padding: '5px 12px', borderRadius: RADIUS.md, border: `1.5px solid ${timing === v ? C.brand : C.border}`, background: timing === v ? C.brandDim : 'transparent', color: timing === v ? C.brand : C.textSecondary, cursor: readOnly ? 'default' : 'pointer', fontFamily: FONT, ...TEXT.xs }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={labelStyle}>האם התקלה משתחזרת?</label>
            <div style={{ display: 'flex', gap: SP[2] }}>
              {Object.entries(GUIDED_REPRO_LABEL).map(([v, l]) => (
                <button key={v} onClick={() => !readOnly && setReproducibility(v)} disabled={readOnly} style={{ padding: '5px 12px', borderRadius: RADIUS.md, border: `1.5px solid ${reproducibility === v ? C.brand : C.border}`, background: reproducibility === v ? C.brandDim : 'transparent', color: reproducibility === v ? C.brand : C.textSecondary, cursor: readOnly ? 'default' : 'pointer', fontFamily: FONT, ...TEXT.xs }}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {incident.evidence.length > 0 && (
            <div>
              <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textSecondary, marginBottom: '6px' }}>עובדות שנאספו אוטומטית</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', ...TEXT.xs }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'right', padding: '4px 8px', color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>עובדה</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px', color: C.textMuted, borderBottom: `1px solid ${C.border}`, width: '140px' }}>מקור</th>
                  </tr>
                </thead>
                <tbody>
                  {incident.evidence.map(e => (
                    <tr key={e.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '4px 8px', color: C.textPrimary }}>{e.content}</td>
                      <td style={{ padding: '4px 8px', color: C.textMuted }}>{e.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {factsError && <div style={{ ...TEXT.xs, color: C.danger }}>{factsError}</div>}
          {!readOnly && (
            <button
              onClick={saveFacts}
              disabled={!factsComplete || savingFacts}
              style={{ alignSelf: 'flex-start', padding: '8px 20px', background: factsComplete ? C.brand : C.textDisabled, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: factsComplete ? 'pointer' : 'not-allowed', fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.bold }}
            >
              {savingFacts ? 'שומר...' : 'המשך לחקירת שרשרת האירועים ›'}
            </button>
          )}
        </div>
      )}

      {/* Stage 3 — fixed-option decision tree; no free-text "root cause" input anywhere here */}
      {stage === 'tree' && currentNodeId && guidedTree.nodes[currentNodeId] && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SP[3] }}>
          {path.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {path.map((p, i) => (
                <div key={i} style={{ ...TEXT.xs, color: C.textMuted }}>{p.question} <b style={{ color: C.textSecondary }}>← {p.answerLabel}</b></div>
              ))}
            </div>
          )}
          <div style={{ ...TEXT.md, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{guidedTree.nodes[currentNodeId].question}</div>
          <div style={{ display: 'flex', gap: SP[2], flexWrap: 'wrap' }}>
            {guidedTree.nodes[currentNodeId].options.map(opt => (
              <button
                key={opt.value} onClick={() => chooseOption(opt)}
                style={{ padding: '8px 16px', borderRadius: RADIUS.md, border: `1.5px solid ${C.border}`, background: C.bgNested, color: C.textPrimary, cursor: 'pointer', fontFamily: FONT, ...TEXT.sm }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {path.length > 0 && (
            <button onClick={stepBack} style={{ alignSelf: 'flex-start', padding: '5px 12px', background: 'none', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', color: C.textMuted, fontFamily: FONT, ...TEXT.xs }}>
              ‹ חזור שלב
            </button>
          )}
        </div>
      )}

      {/* Stage 4-6 — the system infers everything below from the path/leaf; nothing here is typed in by the user */}
      {stage === 'review' && leaf && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SP[3] }}>
          <div>
            <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textSecondary, marginBottom: '6px' }}>שרשרת 5-Why (נבנתה אוטומטית מהחקירה)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {path.map((p, i) => (
                <div key={i} style={{ ...TEXT.sm }}>
                  <span style={{ color: C.textMuted }}>למה? ({p.question})</span><br />
                  <span style={{ color: C.textPrimary }}>נבחר: {p.answerLabel}</span>
                </div>
              ))}
              <div style={{ ...TEXT.sm, background: `${C.success}18`, border: `1px solid ${C.success}`, borderRadius: RADIUS.md, padding: '8px 10px' }}>
                <span style={{ color: C.textMuted }}>מה הגורם השורשי הסופי?</span><br />
                <span style={{ color: C.success, fontWeight: WEIGHT.bold }}>{leaf.rootCause}</span>
              </div>
            </div>
          </div>

          <div>
            <label style={labelStyle}>סיבה ישירה (Direct Cause)</label>
            <div style={{ ...TEXT.sm, color: C.textPrimary }}>{leaf.directCause}</div>
          </div>
          <div>
            <label style={labelStyle}>שורש התקלה (Root Cause)</label>
            <div style={{ ...TEXT.sm, color: C.textPrimary }}>{leaf.rootCause}</div>
          </div>
          <div>
            <label style={labelStyle}>סיווג גורם שורש (הוסק אוטומטית)</label>
            <div style={{ ...TEXT.sm, color: C.textPrimary }}>{leaf.category} › {leaf.rootCauseReason}</div>
          </div>
          <div style={{ display: 'flex', gap: SP[3] }}>
            <div style={{ flex: 1, background: C.bgNested, borderRadius: RADIUS.md, padding: SP[2] }}>
              <label style={labelStyle}>פעולת תיקון מוצעת</label>
              <div style={{ ...TEXT.sm, color: C.textPrimary }}>{leaf.correctiveAction}</div>
            </div>
            <div style={{ flex: 1, background: C.bgNested, borderRadius: RADIUS.md, padding: SP[2] }}>
              <label style={labelStyle}>פעולה מונעת מוצעת</label>
              <div style={{ ...TEXT.sm, color: C.textPrimary }}>{leaf.preventiveAction}</div>
            </div>
          </div>
          {!readOnly && (
            <div style={{ ...TEXT.xs, color: C.textMuted, fontStyle: 'italic' }}>שתי הפעולות למעלה ייווצרו אוטומטית כפעולות מעקב עם שמירת ה-RCA — ניתן לשייך אחראי ותאריך בהמשך בפאנל הפעולות.</div>
          )}

          <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textSecondary }}>לקחים לפי צוות (ניתן להשאיר ריק אם לא רלוונטי)</div>
          <LessonsEditor teams={teams} teamsScoped={teamsScoped} readOnly={readOnly} value={lessons} onChange={setLessons} />

          {!readOnly && (
            <button
              onClick={() => onSubmit({ method: 'GUIDED', treePath: path, treeLeafId: leafId, lessons: lessonsPayload(teams, lessons) })}
              disabled={busy}
              style={{ alignSelf: 'flex-start', padding: '8px 20px', background: C.success, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.bold }}
            >
              {busy ? 'שומר...' : '✅ סיום — שמור RCA'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ── Incident details panel ──────────────────────────────────────────────────
// Top section is real QC data (component/impact — see GO_LIVE_INCIDENTS_SQL),
// read-only. Bottom section (affected users / customer-facing / downtime)
// does NOT exist anywhere in QC's real schema — verified against a live
// export 2026-08-08 — so it's filled by hand here instead of invented,
// per explicit product decision.
const IncidentDetailsPanel: React.FC<{
  incident: IncidentDetail; busy: boolean;
  onSaveTriage: (patch: { affectedUsersCount?: number | null; customerFacing?: boolean | null; downtimeMinutes?: number | null }) => void;
}> = ({ incident, busy, onSaveTriage }) => {
  const [affectedUsersCount, setAffectedUsersCount] = useState(incident.affectedUsersCount != null ? String(incident.affectedUsersCount) : '');
  const [customerFacing, setCustomerFacing] = useState<'' | 'true' | 'false'>(incident.customerFacing == null ? '' : incident.customerFacing ? 'true' : 'false');
  const [downtimeMinutes, setDowntimeMinutes] = useState(incident.downtimeMinutes != null ? String(incident.downtimeMinutes) : '');

  const component = [incident.mainModule, incident.subModule, incident.systemComponent].filter(Boolean).join(' / ');
  const qcFacts: [string, string | null][] = [
    ['סוג תקלה', incident.defectType], ['CR מקושר', incident.crReferenceNumber],
    ['רכיב חשוד', component || null], ['השפעה עסקית (QC)', incident.impact],
    ['תהליך עסקי', incident.businessProcess || incident.mainBusinessProcess],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
      <div style={sectionTitleStyle}>📋 פרטי אירוע</div>
      {qcFacts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {qcFacts.map(([label, v]) => (
            <div key={label} style={{ ...TEXT.xs, color: C.textSecondary }}><b>{label}:</b> {v}</div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: `1px solid ${C.border}`, paddingTop: SP[2], marginTop: qcFacts.length ? '4px' : 0 }}>
        <div style={{ ...TEXT.xs, color: C.textMuted, fontStyle: 'italic' }}>הנתונים הבאים לא קיימים ב-QC — יש למלא ידנית:</div>
        <div>
          <label style={labelStyle}>כמות משתמשים מושפעים</label>
          <input type="number" min={0} value={affectedUsersCount} onChange={e => setAffectedUsersCount(e.target.value)} style={{ ...inputStyle, fontSize: '12px' }} />
        </div>
        <div>
          <label style={labelStyle}>משפיע על לקוחות?</label>
          <select value={customerFacing} onChange={e => setCustomerFacing(e.target.value as any)} style={{ ...inputStyle, fontSize: '12px' }}>
            <option value="">לא ידוע</option>
            <option value="true">כן</option>
            <option value="false">לא</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>משך אי-זמינות (דקות)</label>
          <input type="number" min={0} value={downtimeMinutes} onChange={e => setDowntimeMinutes(e.target.value)} style={{ ...inputStyle, fontSize: '12px' }} />
        </div>
        <button
          onClick={() => onSaveTriage({
            affectedUsersCount: affectedUsersCount === '' ? null : Number(affectedUsersCount),
            customerFacing: customerFacing === '' ? null : customerFacing === 'true',
            downtimeMinutes: downtimeMinutes === '' ? null : Number(downtimeMinutes),
          })}
          disabled={busy}
          style={{ alignSelf: 'flex-start', padding: '6px 14px', background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.sm, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.bold }}
        >
          💾 שמור
        </button>
      </div>
    </div>
  );
};

// ── Evidence panel ────────────────────────────────────────────────────────────
const EvidencePanel: React.FC<{ incident: IncidentDetail; onAddManual: (content: string) => void }> = ({ incident, onAddManual }) => {
  const [manualText, setManualText] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
      <div style={sectionTitleStyle}>🔍 ראיות ({incident.evidence.length})</div>
      {incident.evidence.length === 0 ? (
        <div style={{ ...TEXT.xs, color: C.textMuted }}>נאספות אוטומטית כשהשיחה נפתחת.</div>
      ) : incident.evidence.map(e => (
        <div key={e.id} style={{ background: C.bgNested, borderRadius: RADIUS.md, padding: '6px 10px' }}>
          <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textSecondary }}>{e.type}</div>
          <div style={{ ...TEXT.xs, color: C.textPrimary, marginTop: '2px' }}>{e.content}</div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '4px' }}>
        <input value={manualText} onChange={e => setManualText(e.target.value)} placeholder="+ ראיה ידנית..." style={{ ...inputStyle, flex: 1, fontSize: '12px' }} />
        <button
          onClick={() => { if (manualText.trim()) { onAddManual(manualText.trim()); setManualText(''); } }}
          disabled={!manualText.trim()}
          style={{ padding: '4px 10px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs }}
        >
          הוסף
        </button>
      </div>
    </div>
  );
};

// ── RCA conclusion panel (read-only — produced by the chat) ──────────────────
const RcaSummaryPanel: React.FC<{ rca: Rca; busy: boolean; onUpdateStatus: (status: 'OPEN' | 'INVESTIGATION' | 'COMPLETED' | 'CANCELLED') => void }> = ({ rca, busy, onUpdateStatus }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={sectionTitleStyle}>🧩 מסקנות RCA</div>
      <select
        value={rca.status} disabled={busy} onChange={e => onUpdateStatus(e.target.value as any)}
        style={{ ...TEXT.xs, padding: '2px 6px', borderRadius: RADIUS.sm, border: `1px solid ${C.border}`, color: RCA_STATUS_COLOR[rca.status], fontWeight: WEIGHT.bold, fontFamily: FONT }}
      >
        {Object.entries(RCA_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </div>
    {rca.directCause && <div style={{ ...TEXT.xs, color: C.textSecondary }}><b>סיבה ישירה:</b> {rca.directCause}</div>}
    {rca.rootCause && <div style={{ ...TEXT.sm, color: C.textPrimary }}><b>גורם שורש:</b> {rca.rootCause}</div>}
    {(rca.category || rca.rootCauseReason) && (
      <div style={{ ...TEXT.xs, color: C.textSecondary }}><b>סיווג:</b> {[rca.category, rca.rootCauseReason].filter(Boolean).join(' › ')}</div>
    )}
    {rca.description && <div style={{ ...TEXT.xs, color: C.textSecondary }}><b>תיאור מפורט:</b> {rca.description}</div>}
    {rca.aiConfidence != null && <div style={{ ...TEXT.xs, color: C.textMuted }}>רמת ביטחון: {Math.round(rca.aiConfidence * 100)}%</div>}
    {rca.lessons.length > 0 && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
        <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textSecondary }}>לקחים לפי צוות</div>
        {rca.lessons.map(l => (
          <div key={l.id} style={{ ...TEXT.xs, color: C.textSecondary }}><b>{l.teamName}:</b> {l.text}</div>
        ))}
      </div>
    )}
  </div>
);

// ── Actions panel ──────────────────────────────────────────────────────────────
const ActionsPanel: React.FC<{
  incident: IncidentDetail; busy: boolean; teams: RelevantTeam[]; teamsScoped: boolean;
  onAdd: (a: { title: string; team: string; owner?: string; dueAt?: string; priority?: string }) => void;
  onUpdateStatus: (actionId: string, status: string) => void;
}> = ({ incident, busy, teams, teamsScoped, onAdd, onUpdateStatus }) => {
  const [title, setTitle] = useState('');
  const [team, setTeam] = useState(teams[0]?.name ?? '');
  const [owner, setOwner] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
      <div style={sectionTitleStyle}>✅ פעולות מעקב ({incident.actions.length})</div>
      {incident.actions.length === 0 ? (
        <div style={{ ...TEXT.xs, color: C.textMuted }}>אין פעולות עדיין.</div>
      ) : incident.actions.map(a => (
        <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: C.bgNested, borderRadius: RADIUS.md, padding: '8px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ ...TEXT.xs, color: C.brand, background: C.brandDim, borderRadius: RADIUS.sm, padding: '2px 6px', fontWeight: WEIGHT.bold }}>{a.team}</span>
            <span style={{ ...TEXT.xs, color: C.textPrimary, flex: 1 }}>{a.title}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {a.ownerName && <span style={{ ...TEXT.xs, color: C.textMuted }}>{a.ownerName}</span>}
            {a.dueAt && <span style={{ ...TEXT.xs, color: C.textMuted }}>{formatDate(a.dueAt)}</span>}
            <select value={a.status} onChange={e => onUpdateStatus(a.id, e.target.value)} disabled={busy} style={{ ...TEXT.xs, padding: '2px 4px', borderRadius: RADIUS.sm, border: `1px solid ${C.border}`, color: ACTION_STATUS_COLOR[a.status], fontWeight: WEIGHT.bold, fontFamily: FONT, marginRight: 'auto' }}>
              {Object.entries(ACTION_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        </div>
      ))}

      {!showAdd ? (
        <button onClick={() => setShowAdd(true)} style={{ alignSelf: 'flex-start', padding: '4px 10px', background: 'none', border: `1px dashed ${C.border}`, borderRadius: RADIUS.sm, cursor: 'pointer', color: C.textMuted, fontFamily: FONT, ...TEXT.xs }}>
          + הוסף פעולה
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: `1px solid ${C.border}`, paddingTop: SP[2] }}>
          <TeamsScopeNote scoped={teamsScoped} />
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="כותרת הפעולה..." style={{ ...inputStyle, fontSize: '12px' }} />
          <div style={{ display: 'flex', gap: '6px' }}>
            <select value={team} onChange={e => { setTeam(e.target.value); setOwner(''); }} style={{ ...inputStyle, flex: 1, fontSize: '12px' }}>
              {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
            <select value={priority} onChange={e => setPriority(e.target.value)} style={{ ...inputStyle, flex: 1, fontSize: '12px' }}>
              {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <OwnerField team={teams.find(t => t.name === team)} value={owner} onChange={setOwner} />
            <input type="date" value={dueAt} onChange={e => setDueAt(e.target.value)} style={{ ...inputStyle, flex: 1, fontSize: '12px' }} />
          </div>
          <button
            onClick={() => { if (title.trim()) { onAdd({ title: title.trim(), team, owner: owner || undefined, dueAt: dueAt || undefined, priority }); setTitle(''); setOwner(''); setDueAt(''); setShowAdd(false); } }}
            disabled={busy || !title.trim()}
            style={{ padding: '6px 12px', background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.sm, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs }}
          >
            הוסף
          </button>
        </div>
      )}
    </div>
  );
};

// ── Close panel ───────────────────────────────────────────────────────────────
const ClosePanel: React.FC<{ incident: IncidentDetail; busy: boolean; canClose: boolean; onClose: (rationale?: string) => void }> = ({ incident, busy, canClose, onClose }) => {
  const [rationale, setRationale] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2], borderTop: `1px solid ${C.border}`, paddingTop: SP[3] }}>
      <div style={sectionTitleStyle}>🔒 סגירה</div>
      {incident.status === 'CLOSED' ? (
        <div style={{ ...TEXT.xs, color: C.success }}>✅ נסגרה{incident.rca?.approvedBy ? ` ע"י ${incident.rca.approvedBy}` : ''}.</div>
      ) : !canClose ? (
        <div style={{ ...TEXT.xs, color: C.textMuted }}>סגירה דורשת הרשאת מנהל לילה.</div>
      ) : (
        <>
          {incident.actions.length === 0 && (
            <div>
              <label style={labelStyle}>אין פעולות מעקב — נדרש נימוק מפורש</label>
              <textarea value={rationale} onChange={e => setRationale(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical', fontSize: '12px' }} />
            </div>
          )}
          <button
            onClick={() => onClose(rationale || undefined)}
            disabled={busy || (incident.actions.length === 0 && !rationale.trim())}
            style={{ padding: '7px 16px', background: (incident.actions.length === 0 && !rationale.trim()) ? C.textDisabled : C.success, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: (incident.actions.length === 0 && !rationale.trim()) ? 'not-allowed' : 'pointer', fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.bold }}
          >
            🔒 סגור תקלה
          </button>
        </>
      )}
    </div>
  );
};
