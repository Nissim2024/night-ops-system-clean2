import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C } from '../theme';
import { formatDateTime } from '../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const RISK: Record<string, { color: string; bg: string; label: string }> = {
  LOW:    { color: '#3fb950', bg: 'rgba(63,185,80,0.12)',    label: 'סיכון נמוך'   },
  MEDIUM: { color: '#d29922', bg: 'rgba(210,153,34,0.12)',   label: 'סיכון בינוני' },
  HIGH:   { color: '#f85149', bg: 'rgba(248,81,73,0.15)',    label: 'סיכון גבוה'   },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  DRAFT:     { label: 'טיוטה',       color: '#7F7F7F', bg: '#F5F5F5',                icon: '✏️' },
  SUBMITTED: { label: 'הוגש לסקירה', color: '#2980b9', bg: 'rgba(41,128,185,0.10)', icon: '📤' },
  RETURNED:  { label: 'הוחזר לתיקון',color: '#d29922', bg: 'rgba(210,153,34,0.12)', icon: '↩️' },
  APPROVED:  { label: 'אושר',        color: '#3fb950', bg: 'rgba(63,185,80,0.12)',  icon: '✅' },
};

/* ─── Types ───────────────────────────────────────────────────────────────── */
interface Team    { id: string; name: string; requiresPlan?: boolean }
interface CrPlan {
  id: string; versionId: string; teamId: string; crNumber: string; crLabel?: string;
  crManager?: string; crDescription?: string; crType?: string; riskLevel?: string;
  systems?: string[]; workPlan?: string; scripts?: string; runTimes?: string;
  rollbackPlan?: string; gradualRollout: boolean; gradualDetails?: string;
  nightTestingNotes?: string; morningMonitoring?: string;
  notNeededForPlan: boolean; planApproved: boolean;
  submissionStatus: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED';
  submittedAt?: string; submittedByName?: string;
  returnReason?: string; returnedAt?: string;
  approvedByName?: string; reviewNote?: string;
  crManagerApproved?: boolean; crManagerApprovedBy?: string; crManagerNote?: string;
  team: Team;
}
interface CrAssign { crNumber: string; crLabel?: string; crManager?: string; crDescription?: string; team: Team }
interface DashStats { total: number; draft: number; submitted: number; returned: number; approved: number }

interface Props {
  token: string;
  versionId: string;
  versionStatus: string;
  userRole: string;
  userId: string;
}

/* ─── Component ───────────────────────────────────────────────────────────── */
export const ImplementationPlansView: React.FC<Props> = ({ token, versionId, versionStatus, userRole }) => {
  const headers  = { Authorization: `Bearer ${token}` };
  const isManager = ['RELEASE_MANAGER', 'ADMIN', 'CR_MANAGER'].includes(userRole);
  const isLead    = userRole === 'TEAM_LEAD';
  const isClosed  = ['COMPLETED', 'ROLLED_BACK'].includes(versionStatus);

  const [plans,       setPlans]       = useState<CrPlan[]>([]);
  const [assignments, setAssignments] = useState<CrAssign[]>([]);
  const [stats,       setStats]       = useState<DashStats | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [teamExempt,  setTeamExempt]  = useState(false);
  const [submissionDeadline, setSubmissionDeadline] = useState<string | null>(null);

  // editing state
  const [editingId,   setEditingId]   = useState<string | null>(null);
  const [formData,    setFormData]    = useState<Partial<CrPlan>>({});
  const [saving,      setSaving]      = useState(false);
  const [saveError,   setSaveError]   = useState<string | null>(null);

  // expanded CR groups (manager view)
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set());

  // return dialog state
  const [returningId,   setReturningId]   = useState<string | null>(null);
  const [returnReason,  setReturnReason]  = useState('');
  const [returning,     setReturning]     = useState(false);

  // review note dialog
  const [noteId,      setNoteId]      = useState<string | null>(null);
  const [noteText,    setNoteText]    = useState('');
  const [savingNote,  setSavingNote]  = useState(false);

  const [actionErr,   setActionErr]   = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [pr, ar] = await Promise.all([
        axios.get(`${API}/cr-plans/version/${versionId}`, { headers }),
        axios.get(`${API}/version-cr-assignments/version/${versionId}`, { headers }),
      ]);
      setPlans(pr.data);
      setAssignments(ar.data);
      if (isManager) {
        const sr = await axios.get(`${API}/cr-plans/version/${versionId}/dashboard-stats`, { headers });
        setStats(sr.data);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [versionId, isManager]); // eslint-disable-line

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (isLead) {
      axios.get(`${API}/teams/mine`, { headers })
        .then(r => { if (r.data?.requiresPlan === false) setTeamExempt(true); })
        .catch(() => {});
      axios.get(`${API}/versions/${versionId}`, { headers })
        .then(r => setSubmissionDeadline(r.data?.submissionDeadline ?? null))
        .catch(() => {});
    }
  }, []); // eslint-disable-line

  /* ── ACTIONS ─────────────────────────────────────────────────────────────── */

  const savePlan = async (planId: string) => {
    setSaving(true);
    setSaveError(null);
    try {
      const plan = plans.find(p => p.id === planId)!;
      await axios.post(`${API}/cr-plans/version/${versionId}`, {
        crNumber: plan.crNumber, teamIdOverride: plan.teamId, ...formData,
      }, { headers });
      setEditingId(null);
      fetchAll();
    } catch (e: any) {
      setSaveError(e?.response?.data?.message || 'שגיאה בשמירה');
    } finally { setSaving(false); }
  };

  const submitPlan = async (planId: string) => {
    setActionErr(null);
    try {
      await axios.patch(`${API}/cr-plans/${planId}/submit`, {}, { headers });
      fetchAll();
    } catch (e: any) { setActionErr(e?.response?.data?.message || 'שגיאה בהגשה'); }
  };

  const confirmReturn = async () => {
    if (!returningId || !returnReason.trim()) return;
    setReturning(true);
    try {
      await axios.patch(`${API}/cr-plans/${returningId}/return`, { returnReason }, { headers });
      setReturningId(null);
      setReturnReason('');
      fetchAll();
    } catch (e: any) { setActionErr(e?.response?.data?.message || 'שגיאה'); }
    finally { setReturning(false); }
  };

  const approvePlan = async (planId: string) => {
    setActionErr(null);
    try {
      await axios.patch(`${API}/cr-plans/${planId}/approve-plan`, {}, { headers });
      fetchAll();
    } catch (e: any) { setActionErr(e?.response?.data?.message || 'שגיאה באישור'); }
  };

  const saveNote = async () => {
    if (!noteId) return;
    setSavingNote(true);
    try {
      await axios.patch(`${API}/cr-plans/${noteId}/review-note`, { reviewNote: noteText }, { headers });
      setNoteId(null);
      setNoteText('');
      fetchAll();
    } catch { /* silent */ }
    finally { setSavingNote(false); }
  };

  const startEdit = (plan: CrPlan) => {
    setEditingId(plan.id);
    setFormData({
      crType: plan.crType, riskLevel: plan.riskLevel, systems: plan.systems,
      workPlan: plan.workPlan, scripts: plan.scripts, runTimes: plan.runTimes,
      rollbackPlan: plan.rollbackPlan, gradualRollout: plan.gradualRollout,
      gradualDetails: plan.gradualDetails, nightTestingNotes: plan.nightTestingNotes,
      morningMonitoring: plan.morningMonitoring, notNeededForPlan: plan.notNeededForPlan,
    });
    setSaveError(null);
  };

  /* ── SHARED HELPERS ─────────────────────────────────────────────────────── */

  const StatusPill: React.FC<{ status: string }> = ({ status }) => {
    const m = STATUS_META[status] ?? STATUS_META.DRAFT;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '12px', background: m.bg, color: m.color, fontWeight: '600', fontSize: '14px', border: `1px solid ${m.color}33` }}>
        {m.icon} {m.label}
      </span>
    );
  };

  const txtArea = (field: keyof CrPlan, label: string, rows = 3) => (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ fontSize: '14px', fontWeight: '600', color: C.textSecondary, marginBottom: '4px' }}>{label}</div>
      <textarea
        rows={rows}
        value={(formData[field] as string) ?? ''}
        onChange={e => setFormData(p => ({ ...p, [field]: e.target.value }))}
        style={{ width: '100%', padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: '7px', background: C.bgNested, fontSize: '15px', color: C.textPrimary, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
      />
    </div>
  );

  /* ── PLAN FORM (team lead fills) ─────────────────────────────────────────── */
  const renderForm = (plan: CrPlan) => (
    <div style={{ padding: '14px 16px', background: C.bgActive, borderRadius: '8px', border: `1px solid ${C.border}`, marginTop: '8px' }}>
      {/* not-needed checkbox */}
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!formData.notNeededForPlan} onChange={e => setFormData(p => ({ ...p, notNeededForPlan: e.target.checked }))} />
        <span style={{ fontSize: '15px', fontWeight: '600', color: C.textSecondary }}>CR זה לא מצריך תוכנית הטמעה</span>
      </label>

      {!formData.notNeededForPlan && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '600', color: C.textSecondary, marginBottom: '4px' }}>סוג שינוי</div>
              <select value={formData.crType ?? ''} onChange={e => setFormData(p => ({ ...p, crType: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: '7px', background: C.bgNested, fontSize: '15px' }}>
                <option value="">-- בחר --</option>
                <option>תיקון תקלה</option><option>פיתוח</option><option>תשתית</option><option>הסבה</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '600', color: C.textSecondary, marginBottom: '4px' }}>רמת סיכון</div>
              <select value={formData.riskLevel ?? ''} onChange={e => setFormData(p => ({ ...p, riskLevel: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: '7px', background: C.bgNested, fontSize: '15px' }}>
                <option value="">-- בחר --</option>
                <option value="LOW">נמוך</option><option value="MEDIUM">בינוני</option><option value="HIGH">גבוה</option>
              </select>
            </div>
          </div>
          {txtArea('workPlan',          'תוכנית עבודה',             4)}
          {txtArea('scripts',           'סקריפטים / פקודות',        3)}
          {txtArea('runTimes',          'זמני הרצה משוערים',         2)}
          {txtArea('rollbackPlan',      'תוכנית רולבק',              3)}
          {txtArea('nightTestingNotes', 'בדיקות בלילה',              2)}
          {txtArea('morningMonitoring', 'מעקב בוקר',                 2)}
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!formData.gradualRollout} onChange={e => setFormData(p => ({ ...p, gradualRollout: e.target.checked }))} />
            <span style={{ fontSize: '15px', color: C.textSecondary }}>פריסה הדרגתית</span>
          </label>
          {formData.gradualRollout && txtArea('gradualDetails', 'פרטי פריסה הדרגתית', 2)}
        </>
      )}

      {saveError && <div style={{ color: '#f85149', fontSize: '14px', marginBottom: '8px' }}>{saveError}</div>}

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button onClick={() => setEditingId(null)} style={secondaryBtn}>ביטול</button>
        <button onClick={() => savePlan(plan.id)} disabled={saving} style={primaryBtn}>
          {saving ? 'שומר...' : '💾 שמור'}
        </button>
      </div>
    </div>
  );

  /* ── PLAN CARD (one row per CrPlan in team-lead view) ───────────────────── */
  const renderTeamLeadPlanCard = (plan: CrPlan) => {
    const sm   = STATUS_META[plan.submissionStatus] ?? STATUS_META.DRAFT;
    const risk = plan.riskLevel ? RISK[plan.riskLevel] : null;
    const canEdit   = !isClosed && plan.submissionStatus !== 'SUBMITTED' && plan.submissionStatus !== 'APPROVED';
    const canSubmit = !isClosed && (plan.submissionStatus === 'DRAFT' || plan.submissionStatus === 'RETURNED');
    const isEditing = editingId === plan.id;

    return (
      <div key={plan.id} style={{ borderRadius: '10px', border: `1px solid ${C.border}`, background: C.bgCard, marginBottom: '10px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        {/* Header */}
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', background: C.bgNested, borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontWeight: '800', fontSize: '16px', color: C.textPrimary }}>{plan.crNumber}</span>
          {plan.crLabel && <span style={{ fontSize: '15px', color: C.textMuted, flex: 1 }}>{plan.crLabel}</span>}
          {risk && <span style={{ padding: '2px 9px', borderRadius: '10px', background: risk.bg, color: risk.color, fontSize: '13px', fontWeight: '700', border: `1px solid ${risk.color}33` }}>{risk.label}</span>}
          <StatusPill status={plan.submissionStatus} />
        </div>

        {/* Return reason banner */}
        {plan.submissionStatus === 'RETURNED' && plan.returnReason && (
          <div style={{ padding: '8px 16px', background: 'rgba(210,153,34,0.08)', borderBottom: `1px solid rgba(210,153,34,0.25)`, display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '15px', marginTop: '1px' }}>↩️</span>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '700', color: '#d29922', marginBottom: '2px' }}>הוחזר לתיקון</div>
              <div style={{ fontSize: '15px', color: C.textSecondary }}>{plan.returnReason}</div>
            </div>
          </div>
        )}

        {/* Review note from manager */}
        {plan.reviewNote && (
          <div style={{ padding: '6px 16px', background: 'rgba(41,128,185,0.06)', borderBottom: `1px solid rgba(41,128,185,0.15)`, fontSize: '14px', color: '#2980b9' }}>
            💬 הערת מנהל: {plan.reviewNote}
          </div>
        )}

        {/* Content preview or editing form */}
        {isEditing ? renderForm(plan) : (
          <div style={{ padding: '12px 16px' }}>
            {plan.notNeededForPlan ? (
              <div style={{ fontSize: '15px', color: C.textMuted, fontStyle: 'italic' }}>CR זה מסומן כ"לא מצריך תוכנית הטמעה"</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {plan.workPlan   && <Field label="תוכנית עבודה"  value={plan.workPlan} />}
                {plan.scripts    && <Field label="סקריפטים"       value={plan.scripts} />}
                {plan.runTimes   && <Field label="זמני הרצה"       value={plan.runTimes} />}
                {plan.rollbackPlan && <Field label="רולבק"         value={plan.rollbackPlan} />}
                {!plan.workPlan && !plan.scripts && (
                  <div style={{ gridColumn: '1/-1', fontSize: '15px', color: C.textMuted, fontStyle: 'italic' }}>
                    {isClosed ? 'לא הוגשה תוכנית הטמעה לפריט זה' : 'לא הוזן תוכן עדיין — לחץ "ערוך תוכנית" להתחלה'}
                  </div>
                )}
              </div>
            )}

            {plan.submittedAt && (
              <div style={{ marginTop: '8px', fontSize: '13px', color: C.textMuted }}>
                {sm.icon} הוגש ב-{formatDateTime(plan.submittedAt)}
                {plan.submittedByName && ` ע"י ${plan.submittedByName}`}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
              {canEdit && <button onClick={() => startEdit(plan)} style={secondaryBtn}>✏️ ערוך תוכנית</button>}
              {canSubmit && (
                <button onClick={() => submitPlan(plan.id)} style={primaryBtn}>
                  📤 הגש לסקירה
                </button>
              )}
              {plan.submissionStatus === 'APPROVED' && (
                <span style={{ fontSize: '14px', color: '#3fb950', fontWeight: '700' }}>✅ אושר על ידי {plan.approvedByName ?? 'מנהל'}</span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ── MANAGER — plan row inside CR group ─────────────────────────────────── */
  const renderManagerPlanRow = (plan: CrPlan) => {
    const canApprove = !isClosed && plan.submissionStatus === 'SUBMITTED';
    const canReturn  = !isClosed && plan.submissionStatus === 'SUBMITTED';

    return (
      <div key={plan.id} style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontWeight: '700', fontSize: '15px', color: C.textPrimary }}>{plan.team.name}</span>
            <StatusPill status={plan.submissionStatus} />
            {plan.notNeededForPlan && <span style={{ fontSize: '13px', color: C.textMuted, background: C.bgNested, padding: '1px 8px', borderRadius: '8px', border: `1px solid ${C.border}` }}>לא מצריך תוכנית</span>}
          </div>
          {plan.returnReason && plan.submissionStatus === 'RETURNED' && (
            <div style={{ fontSize: '14px', color: '#d29922' }}>↩️ {plan.returnReason}</div>
          )}
          {plan.submissionStatus === 'APPROVED' && (
            <div style={{ fontSize: '13px', color: '#3fb950' }}>✅ אושר ע"י {plan.approvedByName ?? 'מנהל'}</div>
          )}
          {plan.submissionStatus === 'SUBMITTED' && (
            <div style={{ fontSize: '13px', color: C.textMuted }}>
              📤 הוגש {plan.submittedAt ? formatDateTime(plan.submittedAt) : ''}{plan.submittedByName ? ` ע"י ${plan.submittedByName}` : ''}
            </div>
          )}
          {plan.reviewNote && <div style={{ fontSize: '13px', color: '#2980b9', marginTop: '2px' }}>💬 {plan.reviewNote}</div>}
        </div>

        {!isClosed && (
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
            <button onClick={() => { setNoteId(plan.id); setNoteText(plan.reviewNote ?? ''); }} style={ghostBtn} title="הוסף/ערוך הערה">💬</button>
            {canReturn  && <button onClick={() => { setReturningId(plan.id); setReturnReason(''); }} style={{ ...actionBtn, background: 'rgba(210,153,34,0.12)', color: '#d29922', border: '1px solid rgba(210,153,34,0.35)' }}>↩️ החזר</button>}
            {canApprove && <button onClick={() => approvePlan(plan.id)} style={{ ...actionBtn, background: 'rgba(63,185,80,0.12)', color: '#16a34a', border: '1px solid rgba(63,185,80,0.35)' }}>✅ אשר</button>}
          </div>
        )}
      </div>
    );
  };

  /* ── FIELD helper ────────────────────────────────────────────────────────── */
  const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div>
      <div style={{ fontSize: '13px', fontWeight: '700', color: C.textMuted, marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: '15px', color: C.textSecondary, whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{value}</div>
    </div>
  );

  /* ── RENDER ─────────────────────────────────────────────────────────────── */

  if (loading) return (
    <div style={{ padding: '40px', textAlign: 'center', color: C.textMuted, fontSize: '15px' }}>⏳ טוען תוכניות הטמעה...</div>
  );

  const noData = plans.length === 0 && assignments.length === 0;
  // Backend already filters out exempt teams' plans — visiblePlans === plans
  const visiblePlans = plans;

  /* ── TEAM LEAD RENDER ────────────────────────────────────────────────────── */
  if (isLead) {
    if (teamExempt) {
      return (
        <div style={{ direction: 'rtl', padding: '40px 0', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🚫</div>
          <div style={{ fontSize: '17px', fontWeight: '700', color: C.textSecondary, marginBottom: '6px' }}>הצוות שלך פטור מהגשת תוכניות הטמעה</div>
          <div style={{ fontSize: '15px', color: C.textMuted }}>הוגדר על ידי מנהל המערכת כצוות שאינו נדרש להגיש תוכניות CR</div>
        </div>
      );
    }

    const myPlans = plans; // backend already filters to own team
    const myAssignedCrs = Array.from(new Set(assignments.map(a => a.crNumber)));

    // ensure we show a card for each assigned CR, even if no plan exists yet
    const allCrs = Array.from(new Set([...myPlans.map(p => p.crNumber), ...myAssignedCrs])).sort();

    const submittedCount = myPlans.filter(p => ['SUBMITTED', 'APPROVED'].includes(p.submissionStatus)).length;
    const allSubmitted   = myPlans.length > 0 && submittedCount === myPlans.length;

    return (
      <div style={{ direction: 'rtl', padding: '0' }}>
        {/* Closed banner */}
        {isClosed && (
          <div style={{ padding: '8px 14px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: '8px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', color: C.textMuted }}>
            🔒 <strong style={{ color: C.textSecondary }}>גרסה סגורה — צפייה בלבד</strong>
          </div>
        )}

        {/* Submission deadline */}
        {!isClosed && submissionDeadline && (() => {
          const isPast = new Date(submissionDeadline) < new Date();
          return (
            <div style={{
              padding: '8px 14px', borderRadius: '8px', marginBottom: '12px',
              display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px',
              background: isPast ? 'rgba(248,81,73,0.10)' : 'rgba(210,153,34,0.10)',
              border: `1px solid ${isPast ? 'rgba(248,81,73,0.30)' : 'rgba(210,153,34,0.30)'}`,
              color: isPast ? '#f85149' : '#d29922',
            }}>
              ⏰ <strong>מועד הגשה: {formatDateTime(submissionDeadline)}</strong>
              {isPast && <span>— ⚠ המועד עבר</span>}
            </div>
          );
        })()}

        {/* Progress bar */}
        {!isClosed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0 14px' }}>
            <div style={{ flex: 1, height: '6px', background: C.border, borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: '3px', background: allSubmitted ? '#3fb950' : '#4573D2', width: myPlans.length ? `${Math.round(submittedCount / myPlans.length * 100)}%` : '0%', transition: 'width 0.4s' }} />
            </div>
            <span style={{ fontSize: '14px', fontWeight: '700', color: allSubmitted ? '#3fb950' : C.textMuted, whiteSpace: 'nowrap' }}>
              {submittedCount}/{myPlans.length} הוגשו
            </span>
          </div>
        )}

        {actionErr && (
          <div style={{ padding: '8px 14px', background: 'rgba(248,81,73,0.10)', border: `1px solid rgba(248,81,73,0.3)`, borderRadius: '8px', color: '#f85149', fontSize: '15px', marginBottom: '12px' }}>
            {actionErr}
          </div>
        )}

        {noData && (
          <div style={{ padding: '30px', textAlign: 'center', color: C.textMuted, fontSize: '15px' }}>
            {isClosed ? 'לא הוגשו תוכניות הטמעה לצוות זה בגרסה.' : 'אין CR-ים משויכים לצוות שלך בגרסה זו.'}
          </div>
        )}

        {allCrs.map(crNumber => {
          const plan   = myPlans.find(p => p.crNumber === crNumber);
          const assign = assignments.find(a => a.crNumber === crNumber);
          if (!plan) {
            // assigned but no plan written yet — show placeholder
            return (
              <div key={crNumber} style={{ borderRadius: '10px', border: `1px solid ${C.border}`, background: C.bgCard, marginBottom: '10px', padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontWeight: '800', fontSize: '16px', color: C.textPrimary }}>{crNumber}</span>
                  {assign?.crLabel && <span style={{ fontSize: '15px', color: C.textMuted }}>{assign.crLabel}</span>}
                  <StatusPill status="DRAFT" />
                  <span style={{ marginRight: 'auto', fontSize: '14px', color: C.textMuted }}>תוכנית לא נוצרה עדיין</span>
                </div>
              </div>
            );
          }
          return renderTeamLeadPlanCard(plan);
        })}
      </div>
    );
  }

  /* ── MANAGER RENDER ──────────────────────────────────────────────────────── */
  const allCrNumbers = Array.from(new Set([
    ...assignments.map(a => a.crNumber),
    ...visiblePlans.map(p => p.crNumber),
  ])).sort();

  const statCard = (label: string, value: number, color: string, bg: string) => (
    <div style={{ padding: '14px 18px', borderRadius: '10px', background: bg, border: `1px solid ${color}33`, textAlign: 'center', flex: '1 1 100px' }}>
      <div style={{ fontSize: '28px', fontWeight: '900', color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '14px', color, fontWeight: '600', marginTop: '4px' }}>{label}</div>
    </div>
  );

  const pct = stats && stats.total ? Math.round((stats.approved / stats.total) * 100) : 0;

  // Compute CRs pending CR Manager approval (all teams submitted, but not yet approved by CR Manager)
  const pendingCrManagerCrs = (() => {
    if (!isManager || versionStatus !== 'REFINING') return [];
    const crGroups: Record<string, CrPlan[]> = {};
    for (const p of visiblePlans) {
      if (!crGroups[p.crNumber]) crGroups[p.crNumber] = [];
      crGroups[p.crNumber].push(p);
    }
    return Object.entries(crGroups)
      .filter(([, ps]) =>
        ps.every(p => p.submissionStatus === 'SUBMITTED' || p.submissionStatus === 'APPROVED' || p.notNeededForPlan) &&
        ps.some(p => !p.crManagerApproved && !p.notNeededForPlan),
      )
      .map(([crNumber]) => crNumber);
  })();

  return (
    <div style={{ direction: 'rtl' }}>
      {/* ── Closed banner ── */}
      {isClosed && (
        <div style={{ padding: '8px 14px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: '8px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', color: C.textMuted }}>
          🔒 <strong style={{ color: C.textSecondary }}>גרסה סגורה — צפייה בלבד</strong>
        </div>
      )}

      {/* ── Dashboard stats ── */}
      {stats && (
        <div style={{ marginBottom: '18px' }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {statCard('סה"כ CR', stats.total, '#4573D2', 'rgba(69,115,210,0.08)')}
            {statCard('טיוטה', stats.draft, '#7F7F7F', '#F5F5F5')}
            {statCard('הוגש', stats.submitted, '#2980b9', 'rgba(41,128,185,0.08)')}
            {statCard('הוחזר', stats.returned, '#d29922', 'rgba(210,153,34,0.08)')}
            {statCard('אושר', stats.approved, '#3fb950', 'rgba(63,185,80,0.08)')}
          </div>
          {/* progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ flex: 1, height: '7px', background: C.border, borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: '4px', background: pct === 100 ? '#3fb950' : '#4573D2', width: `${pct}%`, transition: 'width 0.4s' }} />
            </div>
            <span style={{ fontSize: '15px', fontWeight: '700', color: pct === 100 ? '#3fb950' : C.textMuted, whiteSpace: 'nowrap' }}>{pct}% אושרו</span>
          </div>
        </div>
      )}

      {/* ── CR Manager pending approval indicator ── */}
      {pendingCrManagerCrs.length > 0 && (
        <div style={{ padding: '10px 14px', background: C.warningBg, border: `1px solid ${C.warning}44`, borderRadius: '8px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', color: C.warning, fontWeight: '600' }}>
          ⏳ {pendingCrManagerCrs.length} CR ממתינים לאישור מנהל CR לפני מעבר לסקירה: {pendingCrManagerCrs.join(', ')}
        </div>
      )}

      {actionErr && (
        <div style={{ padding: '8px 14px', background: 'rgba(248,81,73,0.10)', border: `1px solid rgba(248,81,73,0.3)`, borderRadius: '8px', color: '#f85149', fontSize: '15px', marginBottom: '12px' }}>
          {actionErr}
        </div>
      )}

      {noData && (
        <div style={{ padding: '30px', textAlign: 'center', color: C.textMuted, fontSize: '15px' }}>
          {isClosed ? 'לא הוגשו תוכניות הטמעה בגרסה זו.' : 'אין CR-ים בגרסה זו — יש לסנכרן מקובץ ה-CR.'}
        </div>
      )}

      {/* ── CR groups ── */}
      {allCrNumbers.map(crNumber => {
        const assign   = assignments.find(a => a.crNumber === crNumber);
        const crPlans  = visiblePlans.filter(p => p.crNumber === crNumber);
        const isOpen   = expanded.has(crNumber);
        const allApproved = crPlans.length > 0 && crPlans.every(p => p.submissionStatus === 'APPROVED' || p.notNeededForPlan);
        const anyPending  = crPlans.some(p => p.submissionStatus === 'SUBMITTED');
        const headerColor = allApproved ? '#3fb950' : anyPending ? '#2980b9' : C.textMuted;

        return (
          <div key={crNumber} style={{ borderRadius: '10px', border: `1px solid ${C.border}`, background: C.bgCard, marginBottom: '10px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div
              onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(crNumber) ? n.delete(crNumber) : n.add(crNumber); return n; })}
              style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', background: C.bgNested, userSelect: 'none' }}
            >
              <span style={{ fontWeight: '800', fontSize: '16px', color: C.textPrimary }}>{crNumber}</span>
              {assign?.crLabel && <span style={{ fontSize: '15px', color: C.textMuted, flex: 1 }}>{assign.crLabel}</span>}
              <span style={{ fontSize: '14px', color: headerColor, fontWeight: '700', marginRight: 'auto' }}>
                {allApproved ? '✅ כל התוכניות אושרו' : anyPending ? `📤 ${crPlans.filter(p => p.submissionStatus === 'SUBMITTED').length} ממתין לסקירה` : `${crPlans.length} צוותים`}
              </span>
              <span style={{ color: C.textMuted, fontSize: '15px' }}>{isOpen ? '▲' : '▼'}</span>
            </div>

            {isOpen && (
              <div>
                {crPlans.length === 0 ? (
                  <div style={{ padding: '14px 16px', color: C.textMuted, fontSize: '15px', fontStyle: 'italic' }}>
                    לא הוגשה תוכנית הטמעה לאף צוות עדיין.
                  </div>
                ) : (
                  crPlans.map(plan => renderManagerPlanRow(plan))
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Return dialog ── */}
      {returningId && (
        <div style={{ position: 'fixed', inset: 0, background: C.bgOverlay, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px 28px', width: '420px', maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.25)', direction: 'rtl' }}>
            <div style={{ fontWeight: '800', fontSize: '17px', marginBottom: '12px', color: C.textPrimary }}>↩️ החזרת תוכנית לתיקון</div>
            <div style={{ fontSize: '15px', color: C.textMuted, marginBottom: '10px' }}>נא לציין את הסיבה להחזרה (תוצג לראש הצוות):</div>
            <textarea
              value={returnReason}
              onChange={e => setReturnReason(e.target.value)}
              rows={3}
              placeholder="הסיבה להחזרה..."
              autoFocus
              style={{ width: '100%', padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: '8px', background: C.bgNested, fontSize: '15px', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '14px' }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setReturningId(null)} style={secondaryBtn}>ביטול</button>
              <button onClick={confirmReturn} disabled={returning || !returnReason.trim()} style={{ ...actionBtn, background: 'rgba(210,153,34,0.15)', color: '#b7791f', border: '1px solid rgba(210,153,34,0.4)', opacity: returnReason.trim() ? 1 : 0.5 }}>
                {returning ? 'שולח...' : '↩️ החזר לתיקון'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Note dialog ── */}
      {noteId && (
        <div style={{ position: 'fixed', inset: 0, background: C.bgOverlay, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px 28px', width: '400px', maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.25)', direction: 'rtl' }}>
            <div style={{ fontWeight: '800', fontSize: '17px', marginBottom: '12px', color: C.textPrimary }}>💬 הערת סקירה</div>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={3}
              placeholder="הערה לראש הצוות (אופציונלי)..."
              autoFocus
              style={{ width: '100%', padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: '8px', background: C.bgNested, fontSize: '15px', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '14px' }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => { setNoteId(null); setNoteText(''); }} style={secondaryBtn}>ביטול</button>
              <button onClick={saveNote} disabled={savingNote} style={primaryBtn}>{savingNote ? 'שומר...' : '💾 שמור הערה'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Shared button styles ─────────────────────────────────────────────────── */
const primaryBtn: React.CSSProperties = {
  padding: '7px 16px', background: C.brand, color: '#fff', border: 'none',
  borderRadius: '7px', cursor: 'pointer', fontSize: '15px', fontWeight: '700',
};
const secondaryBtn: React.CSSProperties = {
  padding: '7px 16px', background: 'transparent', color: C.textSecondary,
  border: `1px solid ${C.border}`, borderRadius: '7px', cursor: 'pointer', fontSize: '15px',
};
const actionBtn: React.CSSProperties = {
  padding: '5px 14px', borderRadius: '7px', cursor: 'pointer', fontSize: '14px', fontWeight: '700',
};
const ghostBtn: React.CSSProperties = {
  padding: '5px 10px', background: 'transparent', border: `1px solid ${C.border}`,
  borderRadius: '7px', cursor: 'pointer', fontSize: '15px',
};
