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

/* ─── Shared button classNames ───────────────────────────────────────────── */
const primaryBtnClass = 'rounded-md border-none bg-primary px-4 py-1.5 text-sm font-bold text-primary-foreground cursor-pointer';
const secondaryBtnClass = 'rounded-md border border-border bg-transparent px-4 py-1.5 text-sm text-muted-foreground cursor-pointer';
const actionBtnClass = 'rounded-md px-3.5 py-1 text-xs font-bold cursor-pointer';
const ghostBtnClass = 'rounded-md border border-border bg-transparent px-2.5 py-1 text-sm cursor-pointer';

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
      <span className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-sm font-semibold" style={{ background: m.bg, color: m.color, border: `1px solid ${m.color}33` }}>
        {m.icon} {m.label}
      </span>
    );
  };

  const txtArea = (field: keyof CrPlan, label: string, rows = 3) => (
    <div className="mb-2.5">
      <div className="mb-1 text-sm font-semibold text-muted-foreground">{label}</div>
      <textarea
        rows={rows}
        value={(formData[field] as string) ?? ''}
        onChange={e => setFormData(p => ({ ...p, [field]: e.target.value }))}
        className="w-full resize-y rounded-md border border-border bg-muted px-2.5 py-1.5 font-[inherit] text-[15px] text-foreground"
        style={{ boxSizing: 'border-box' }}
      />
    </div>
  );

  /* ── PLAN FORM (team lead fills) ─────────────────────────────────────────── */
  const renderForm = (plan: CrPlan) => (
    <div className="mt-2 rounded-lg border border-border bg-[#E6E7F5] px-4 py-3.5">
      {/* not-needed checkbox */}
      <label className="mb-3 flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={!!formData.notNeededForPlan} onChange={e => setFormData(p => ({ ...p, notNeededForPlan: e.target.checked }))} />
        <span className="text-[15px] font-semibold text-muted-foreground">CR זה לא מצריך תוכנית הטמעה</span>
      </label>

      {!formData.notNeededForPlan && (
        <>
          <div className="mb-2.5 grid grid-cols-2 gap-2.5">
            <div>
              <div className="mb-1 text-sm font-semibold text-muted-foreground">סוג שינוי</div>
              <select value={formData.crType ?? ''} onChange={e => setFormData(p => ({ ...p, crType: e.target.value }))}
                className="w-full rounded-md border border-border bg-muted px-2.5 py-1.5 text-[15px]">
                <option value="">-- בחר --</option>
                <option>תיקון תקלה</option><option>פיתוח</option><option>תשתית</option><option>הסבה</option>
              </select>
            </div>
            <div>
              <div className="mb-1 text-sm font-semibold text-muted-foreground">רמת סיכון</div>
              <select value={formData.riskLevel ?? ''} onChange={e => setFormData(p => ({ ...p, riskLevel: e.target.value }))}
                className="w-full rounded-md border border-border bg-muted px-2.5 py-1.5 text-[15px]">
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
          <label className="mb-2.5 flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={!!formData.gradualRollout} onChange={e => setFormData(p => ({ ...p, gradualRollout: e.target.checked }))} />
            <span className="text-[15px] text-muted-foreground">פריסה הדרגתית</span>
          </label>
          {formData.gradualRollout && txtArea('gradualDetails', 'פרטי פריסה הדרגתית', 2)}
        </>
      )}

      {saveError && <div className="mb-2 text-sm text-[#f85149]">{saveError}</div>}

      <div className="flex justify-end gap-2">
        <button onClick={() => setEditingId(null)} className={secondaryBtnClass}>ביטול</button>
        <button onClick={() => savePlan(plan.id)} disabled={saving} className={primaryBtnClass}>
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
      <div key={plan.id} className="mb-2.5 overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border bg-muted px-4 py-3">
          <span className="text-base font-extrabold text-foreground">{plan.crNumber}</span>
          {plan.crLabel && <span className="flex-1 text-[15px] text-subtle-foreground">{plan.crLabel}</span>}
          {risk && <span className="rounded-xl px-2.5 py-0.5 text-[13px] font-bold" style={{ background: risk.bg, color: risk.color, border: `1px solid ${risk.color}33` }}>{risk.label}</span>}
          <StatusPill status={plan.submissionStatus} />
        </div>

        {/* Return reason banner */}
        {plan.submissionStatus === 'RETURNED' && plan.returnReason && (
          <div className="flex items-start gap-2 border-b px-4 py-2" style={{ background: 'rgba(210,153,34,0.08)', borderBottomColor: 'rgba(210,153,34,0.25)' }}>
            <span className="mt-0.5 text-[15px]">↩️</span>
            <div>
              <div className="mb-0.5 text-sm font-bold text-[#d29922]">הוחזר לתיקון</div>
              <div className="text-[15px] text-muted-foreground">{plan.returnReason}</div>
            </div>
          </div>
        )}

        {/* Review note from manager */}
        {plan.reviewNote && (
          <div className="border-b px-4 py-1.5 text-sm text-[#2980b9]" style={{ background: 'rgba(41,128,185,0.06)', borderBottomColor: 'rgba(41,128,185,0.15)' }}>
            💬 הערת מנהל: {plan.reviewNote}
          </div>
        )}

        {/* Content preview or editing form */}
        {isEditing ? renderForm(plan) : (
          <div className="px-4 py-3">
            {plan.notNeededForPlan ? (
              <div className="text-[15px] italic text-subtle-foreground">CR זה מסומן כ"לא מצריך תוכנית הטמעה"</div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {plan.workPlan   && <Field label="תוכנית עבודה"  value={plan.workPlan} />}
                {plan.scripts    && <Field label="סקריפטים"       value={plan.scripts} />}
                {plan.runTimes   && <Field label="זמני הרצה"       value={plan.runTimes} />}
                {plan.rollbackPlan && <Field label="רולבק"         value={plan.rollbackPlan} />}
                {!plan.workPlan && !plan.scripts && (
                  <div className="col-span-full text-[15px] italic text-subtle-foreground">
                    {isClosed ? 'לא הוגשה תוכנית הטמעה לפריט זה' : 'לא הוזן תוכן עדיין — לחץ "ערוך תוכנית" להתחלה'}
                  </div>
                )}
              </div>
            )}

            {plan.submittedAt && (
              <div className="mt-2 text-[13px] text-subtle-foreground">
                {sm.icon} הוגש ב-{formatDateTime(plan.submittedAt)}
                {plan.submittedByName && ` ע"י ${plan.submittedByName}`}
              </div>
            )}

            <div className="mt-3 flex justify-end gap-2">
              {canEdit && <button onClick={() => startEdit(plan)} className={secondaryBtnClass}>✏️ ערוך תוכנית</button>}
              {canSubmit && (
                <button onClick={() => submitPlan(plan.id)} className={primaryBtnClass}>
                  📤 הגש לסקירה
                </button>
              )}
              {plan.submissionStatus === 'APPROVED' && (
                <span className="text-sm font-bold text-[#3fb950]">✅ אושר על ידי {plan.approvedByName ?? 'מנהל'}</span>
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
      <div key={plan.id} className="flex items-start gap-3 border-b border-border px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[15px] font-bold text-foreground">{plan.team.name}</span>
            <StatusPill status={plan.submissionStatus} />
            {plan.notNeededForPlan && <span className="rounded-lg border border-border bg-muted px-2 py-px text-[13px] text-subtle-foreground">לא מצריך תוכנית</span>}
          </div>
          {plan.returnReason && plan.submissionStatus === 'RETURNED' && (
            <div className="text-sm text-[#d29922]">↩️ {plan.returnReason}</div>
          )}
          {plan.submissionStatus === 'APPROVED' && (
            <div className="text-[13px] text-[#3fb950]">✅ אושר ע"י {plan.approvedByName ?? 'מנהל'}</div>
          )}
          {plan.submissionStatus === 'SUBMITTED' && (
            <div className="text-[13px] text-subtle-foreground">
              📤 הוגש {plan.submittedAt ? formatDateTime(plan.submittedAt) : ''}{plan.submittedByName ? ` ע"י ${plan.submittedByName}` : ''}
            </div>
          )}
          {plan.reviewNote && <div className="mt-0.5 text-[13px] text-[#2980b9]">💬 {plan.reviewNote}</div>}
        </div>

        {!isClosed && (
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <button onClick={() => { setNoteId(plan.id); setNoteText(plan.reviewNote ?? ''); }} className={ghostBtnClass} title="הוסף/ערוך הערה">💬</button>
            {canReturn  && <button onClick={() => { setReturningId(plan.id); setReturnReason(''); }} className={actionBtnClass} style={{ background: 'rgba(210,153,34,0.12)', color: '#d29922', border: '1px solid rgba(210,153,34,0.35)' }}>↩️ החזר</button>}
            {canApprove && <button onClick={() => approvePlan(plan.id)} className={actionBtnClass} style={{ background: 'rgba(63,185,80,0.12)', color: '#16a34a', border: '1px solid rgba(63,185,80,0.35)' }}>✅ אשר</button>}
          </div>
        )}
      </div>
    );
  };

  /* ── FIELD helper ────────────────────────────────────────────────────────── */
  const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div>
      <div className="mb-0.5 text-[13px] font-bold uppercase tracking-wide text-subtle-foreground">{label}</div>
      <div className="whitespace-pre-wrap text-[15px] leading-normal text-muted-foreground">{value}</div>
    </div>
  );

  /* ── RENDER ─────────────────────────────────────────────────────────────── */

  if (loading) return (
    <div className="p-10 text-center text-[15px] text-subtle-foreground">⏳ טוען תוכניות הטמעה...</div>
  );

  const noData = plans.length === 0 && assignments.length === 0;
  // Backend already filters out exempt teams' plans — visiblePlans === plans
  const visiblePlans = plans;

  /* ── TEAM LEAD RENDER ────────────────────────────────────────────────────── */
  if (isLead) {
    if (teamExempt) {
      return (
        <div dir="rtl" className="py-10 text-center">
          <div className="mb-3 text-3xl">🚫</div>
          <div className="mb-1.5 text-[17px] font-bold text-muted-foreground">הצוות שלך פטור מהגשת תוכניות הטמעה</div>
          <div className="text-[15px] text-subtle-foreground">הוגדר על ידי מנהל המערכת כצוות שאינו נדרש להגיש תוכניות CR</div>
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
      <div dir="rtl">
        {/* Closed banner */}
        {isClosed && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-muted px-3.5 py-2 text-[15px] text-subtle-foreground">
            🔒 <strong className="text-muted-foreground">גרסה סגורה — צפייה בלבד</strong>
          </div>
        )}

        {/* Submission deadline */}
        {!isClosed && submissionDeadline && (() => {
          const isPast = new Date(submissionDeadline) < new Date();
          return (
            <div
              className="mb-3 flex items-center gap-2 rounded-lg px-3.5 py-2 text-[15px]"
              style={{
                background: isPast ? 'rgba(248,81,73,0.10)' : 'rgba(210,153,34,0.10)',
                border: `1px solid ${isPast ? 'rgba(248,81,73,0.30)' : 'rgba(210,153,34,0.30)'}`,
                color: isPast ? '#f85149' : '#d29922',
              }}
            >
              ⏰ <strong>מועד הגשה: {formatDateTime(submissionDeadline)}</strong>
              {isPast && <span>— ⚠ המועד עבר</span>}
            </div>
          );
        })()}

        {/* Progress bar */}
        {!isClosed && (
          <div className="flex items-center gap-3 py-2.5 pb-3.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-sm" style={{ background: C.border }}>
              <div className="h-full rounded-sm transition-[width] duration-300" style={{ background: allSubmitted ? '#3fb950' : '#4573D2', width: myPlans.length ? `${Math.round(submittedCount / myPlans.length * 100)}%` : '0%' }} />
            </div>
            <span className="whitespace-nowrap text-sm font-bold" style={{ color: allSubmitted ? '#3fb950' : C.textMuted }}>
              {submittedCount}/{myPlans.length} הוגשו
            </span>
          </div>
        )}

        {actionErr && (
          <div className="mb-3 rounded-lg px-3.5 py-2 text-[15px] text-[#f85149]" style={{ background: 'rgba(248,81,73,0.10)', border: '1px solid rgba(248,81,73,0.3)' }}>
            {actionErr}
          </div>
        )}

        {noData && (
          <div className="p-8 text-center text-[15px] text-subtle-foreground">
            {isClosed ? 'לא הוגשו תוכניות הטמעה לצוות זה בגרסה.' : 'אין CR-ים משויכים לצוות שלך בגרסה זו.'}
          </div>
        )}

        {allCrs.map(crNumber => {
          const plan   = myPlans.find(p => p.crNumber === crNumber);
          const assign = assignments.find(a => a.crNumber === crNumber);
          if (!plan) {
            // assigned but no plan written yet — show placeholder
            return (
              <div key={crNumber} className="mb-2.5 rounded-lg border border-border bg-card px-4 py-3.5 shadow-xs">
                <div className="flex items-center gap-2.5">
                  <span className="text-base font-extrabold text-foreground">{crNumber}</span>
                  {assign?.crLabel && <span className="text-[15px] text-subtle-foreground">{assign.crLabel}</span>}
                  <StatusPill status="DRAFT" />
                  <span className="ms-auto text-sm text-subtle-foreground">תוכנית לא נוצרה עדיין</span>
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
    <div className="flex-[1_1_100px] rounded-lg px-4 py-3.5 text-center" style={{ background: bg, border: `1px solid ${color}33` }}>
      <div className="text-[28px] font-black leading-none" style={{ color }}>{value}</div>
      <div className="mt-1 text-sm font-semibold" style={{ color }}>{label}</div>
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
    <div dir="rtl">
      {/* ── Closed banner ── */}
      {isClosed && (
        <div className="mb-3.5 flex items-center gap-2 rounded-lg border border-border bg-muted px-3.5 py-2 text-[15px] text-subtle-foreground">
          🔒 <strong className="text-muted-foreground">גרסה סגורה — צפייה בלבד</strong>
        </div>
      )}

      {/* ── Dashboard stats ── */}
      {stats && (
        <div className="mb-5">
          <div className="mb-2.5 flex flex-wrap gap-2.5">
            {statCard('סה"כ CR', stats.total, '#4573D2', 'rgba(69,115,210,0.08)')}
            {statCard('טיוטה', stats.draft, '#7F7F7F', '#F5F5F5')}
            {statCard('הוגש', stats.submitted, '#2980b9', 'rgba(41,128,185,0.08)')}
            {statCard('הוחזר', stats.returned, '#d29922', 'rgba(210,153,34,0.08)')}
            {statCard('אושר', stats.approved, '#3fb950', 'rgba(63,185,80,0.08)')}
          </div>
          {/* progress bar */}
          <div className="flex items-center gap-2.5">
            <div className="h-[7px] flex-1 overflow-hidden rounded" style={{ background: C.border }}>
              <div className="h-full rounded transition-[width] duration-300" style={{ background: pct === 100 ? '#3fb950' : '#4573D2', width: `${pct}%` }} />
            </div>
            <span className="whitespace-nowrap text-[15px] font-bold" style={{ color: pct === 100 ? '#3fb950' : C.textMuted }}>{pct}% אושרו</span>
          </div>
        </div>
      )}

      {/* ── CR Manager pending approval indicator ── */}
      {pendingCrManagerCrs.length > 0 && (
        <div className="mb-3.5 flex items-center gap-2 rounded-lg bg-warning/10 px-3.5 py-2.5 text-[15px] font-semibold text-warning" style={{ border: `1px solid ${C.warning}44` }}>
          ⏳ {pendingCrManagerCrs.length} CR ממתינים לאישור מנהל CR לפני מעבר לסקירה: {pendingCrManagerCrs.join(', ')}
        </div>
      )}

      {actionErr && (
        <div className="mb-3 rounded-lg px-3.5 py-2 text-[15px] text-[#f85149]" style={{ background: 'rgba(248,81,73,0.10)', border: '1px solid rgba(248,81,73,0.3)' }}>
          {actionErr}
        </div>
      )}

      {noData && (
        <div className="p-8 text-center text-[15px] text-subtle-foreground">
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
          <div key={crNumber} className="mb-2.5 overflow-hidden rounded-lg border border-border bg-card shadow-xs">
            <div
              onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(crNumber) ? n.delete(crNumber) : n.add(crNumber); return n; })}
              className="flex cursor-pointer select-none items-center gap-3 bg-muted px-4 py-3"
            >
              <span className="text-base font-extrabold text-foreground">{crNumber}</span>
              {assign?.crLabel && <span className="flex-1 text-[15px] text-subtle-foreground">{assign.crLabel}</span>}
              <span className="ms-auto text-sm font-bold" style={{ color: headerColor }}>
                {allApproved ? '✅ כל התוכניות אושרו' : anyPending ? `📤 ${crPlans.filter(p => p.submissionStatus === 'SUBMITTED').length} ממתין לסקירה` : `${crPlans.length} צוותים`}
              </span>
              <span className="text-[15px] text-subtle-foreground">{isOpen ? '▲' : '▼'}</span>
            </div>

            {isOpen && (
              <div>
                {crPlans.length === 0 ? (
                  <div className="px-4 py-3.5 text-[15px] italic text-subtle-foreground">
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
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[rgba(20,21,42,0.45)]">
          <div dir="rtl" className="w-[420px] max-w-[90vw] rounded-xl bg-card px-7 py-6 shadow-lg">
            <div className="mb-3 text-[17px] font-extrabold text-foreground">↩️ החזרת תוכנית לתיקון</div>
            <div className="mb-2.5 text-[15px] text-subtle-foreground">נא לציין את הסיבה להחזרה (תוצג לראש הצוות):</div>
            <textarea
              value={returnReason}
              onChange={e => setReturnReason(e.target.value)}
              rows={3}
              placeholder="הסיבה להחזרה..."
              autoFocus
              className="mb-3.5 w-full resize-y rounded-lg border border-border bg-muted px-3 py-2 font-[inherit] text-[15px]"
              style={{ boxSizing: 'border-box' }}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setReturningId(null)} className={secondaryBtnClass}>ביטול</button>
              <button
                onClick={confirmReturn}
                disabled={returning || !returnReason.trim()}
                className={actionBtnClass}
                style={{ background: 'rgba(210,153,34,0.15)', color: '#b7791f', border: '1px solid rgba(210,153,34,0.4)', opacity: returnReason.trim() ? 1 : 0.5 }}
              >
                {returning ? 'שולח...' : '↩️ החזר לתיקון'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Note dialog ── */}
      {noteId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[rgba(20,21,42,0.45)]">
          <div dir="rtl" className="w-[400px] max-w-[90vw] rounded-xl bg-card px-7 py-6 shadow-lg">
            <div className="mb-3 text-[17px] font-extrabold text-foreground">💬 הערת סקירה</div>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={3}
              placeholder="הערה לראש הצוות (אופציונלי)..."
              autoFocus
              className="mb-3.5 w-full resize-y rounded-lg border border-border bg-muted px-3 py-2 font-[inherit] text-[15px]"
              style={{ boxSizing: 'border-box' }}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setNoteId(null); setNoteText(''); }} className={secondaryBtnClass}>ביטול</button>
              <button onClick={saveNote} disabled={savingNote} className={primaryBtnClass}>{savingNote ? 'שומר...' : '💾 שמור הערה'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
