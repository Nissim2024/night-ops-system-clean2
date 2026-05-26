import React, { useState, useEffect, useCallback } from 'react';
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

const APPS = ['WIZ', 'CRM', 'EAI', 'OSB', 'DP', 'NC', 'ERP', 'ETL', 'אחר'];
const FREE_KEY = '__FREE__';

interface Proposal {
  id: string;
  teamId: string;
  title: string;
  app?: string;
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
  rollbackPlan?: string;
  gradualRollout: boolean;
  gradualDetails?: string;
  nightTestingNotes?: string;
  morningMonitoring?: string;
  crDeps: { id: string; dependsOnCr: string }[];
}

interface CrPlanForm {
  rollbackPlan: string;
  gradualRollout: boolean;
  gradualDetails: string;
  nightTestingNotes: string;
  morningMonitoring: string;
  dependsOnCrs: string[];
}

const emptyCrPlanForm = (): CrPlanForm => ({
  rollbackPlan: '',
  gradualRollout: false,
  gradualDetails: '',
  nightTestingNotes: '',
  morningMonitoring: '',
  dependsOnCrs: [],
});

interface CrItem { id: string; label: string; }
interface User { id: string; fullName: string; }

interface Props {
  token: string;
  versionId: string;
  versionName: string;
}

const emptyForm = {
  title: '',
  app: '',
  estimatedMins: '',
  crNumber: '',
  crLabel: '',
  isFree: false,
  notes: '',
  assignedUserName: '',
  phase: 1 as number,
};

const labelStyle: React.CSSProperties = {
  fontSize: '12px', color: '#555', display: 'block',
  marginBottom: '4px', fontWeight: 'bold',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px', border: '1px solid #ddd',
  borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box',
};

export const TeamLeadProposalView: React.FC<Props> = ({ token, versionId, versionName }) => {
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

  // Proposal form
  const [showForm, setShowForm]         = useState(false);
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

  // Sync state
  const [syncLoading, setSyncLoading]   = useState(false);
  const [syncError, setSyncError]       = useState<string | null>(null);

  // Dialog state
  const [dialog, setDialog] = useState<DialogConfig | null>(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchProposals = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/task-proposals/version/${versionId}`, { headers });
      setProposals(res.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [versionId]); // eslint-disable-line

  const fetchCrPlans = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/cr-plans/version/${versionId}`, { headers });
      const map: Record<string, CrPlanData> = {};
      const forms: Record<string, CrPlanForm> = {};
      for (const p of res.data as CrPlanData[]) {
        map[p.crNumber] = p;
        forms[p.crNumber] = {
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
    fetchCrPlans();
  }, [versionId]); // eslint-disable-line

  useEffect(() => {
    if (!myTeamId && proposals.length > 0 && teams.length > 0) {
      const t = teams.find((x: any) => x.id === proposals[0].teamId);
      if (t) { setMyTeamName(t.name); setMyTeamId(t.id); }
    }
  }, [teams, proposals]); // eslint-disable-line

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
    return proposals.find(x => x.crNumber === crNum)?.crLabel || '';
  };

  const openAdd = (crNumber?: string, crLabel?: string, isFree?: boolean) => {
    setEditId(null);
    setForm({ ...emptyForm, crNumber: crNumber || '', crLabel: crLabel || '', isFree: isFree ?? false });
    setCrSearch(crNumber || '');
    setError(null);
    setShowForm(true);
  };

  const openEdit = (p: Proposal) => {
    setEditId(p.id);
    setForm({
      title: p.title, app: p.app ?? '', estimatedMins: p.estimatedMins?.toString() ?? '',
      crNumber: p.crNumber ?? '', crLabel: p.crLabel ?? '', isFree: !p.crNumber,
      notes: p.notes ?? '', assignedUserName: p.assignedUserName ?? '', phase: p.phase,
    });
    setCrSearch(p.crNumber || '');
    setError(null);
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setEditId(null); setCrSearch(''); };

  const save = async () => {
    if (!form.title.trim()) { setError('שם המשימה הוא שדה חובה'); return; }
    setSaving(true); setError(null);
    try {
      const crItem = !form.isFree ? crItems.find(c => c.id === form.crNumber) : null;
      const payload = {
        title: form.title.trim(),
        phase: form.phase,
        app: form.app || undefined,
        estimatedMins: form.estimatedMins ? parseInt(form.estimatedMins) : undefined,
        crNumber: form.isFree ? undefined : (form.crNumber || undefined),
        crLabel: crItem?.label || form.crLabel || undefined,
        notes: form.notes || undefined,
        assignedUserName: form.assignedUserName || undefined,
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
    const next = p.status === 'DRAFT' ? 'READY' : 'DRAFT';
    await axios.patch(`${API}/task-proposals/${p.id}`, { status: next }, { headers });
    await fetchProposals();
  };

  const syncCrItems = async () => {
    setSyncLoading(true); setSyncError(null);
    try {
      const res = await axios.get(`${API}/import/crs-for-team?versionId=${versionId}`, { headers });
      const crs: { crNumber: string; crLabel: string; application: string }[] = res.data;
      if (crs.length === 0) {
        setSyncError('לא נמצאו CR-ים עבור הצוות שלך בגרסה זו בקובץ');
        return;
      }
      // Update the CR items list for the dropdown picker
      setCrItems(crs.map(c => ({ id: c.crNumber, label: c.crLabel })));
      // Create CrPlan entry for each CR found
      await Promise.all(crs.map(c =>
        axios.post(`${API}/cr-plans/version/${versionId}`, {
          crNumber: c.crNumber,
          crLabel: c.crLabel,
        }, { headers }).catch(() => { /* skip if already exists */ })
      ));
      await fetchCrPlans();
    } catch (e: any) {
      setSyncError(e.response?.data?.message ?? 'שגיאה בטעינה מהקובץ — בדוק שהנתיב מוגדר נכון בפרמטרי המערכת');
    } finally { setSyncLoading(false); }
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
        rollbackPlan: f.rollbackPlan || undefined,
        gradualRollout: f.gradualRollout,
        gradualDetails: f.gradualDetails || undefined,
        nightTestingNotes: f.nightTestingNotes || undefined,
        morningMonitoring: f.morningMonitoring || undefined,
        dependsOnCrs: f.dependsOnCrs,
      }, { headers });
      setCrPlans(prev => ({ ...prev, [crNumber]: res.data }));
    } catch { /* silent */ }
    finally { setSavingPlan(null); }
  };

  const submitDone = async () => {
    if (!myTeamId) return;
    setSubmitting(true); setSubmitError(null);
    try {
      await axios.post(`${API}/versions/${versionId}/submit/${myTeamId}`, {}, { headers });
      setSubmissionDone(true);
    } catch (e: any) {
      setSubmitError(e.response?.data?.message ?? 'שגיאה בהגשה');
    } finally { setSubmitting(false); }
  };

  const totalReady = proposals.filter(p => p.status === 'READY').length;

  // ── Form ────────────────────────────────────────────────────────────────────
  const renderForm = () => (
    <div style={{ background: '#fffdf0', border: '2px solid #f39c12', borderRadius: '10px', padding: '20px', marginBottom: '16px' }}>
      <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '16px', color: '#1a2332' }}>
        {editId ? 'עריכת משימה' : 'הוספת משימה חדשה'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

        {/* CR picker row */}
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>CR מקושר</label>
            {form.isFree ? (
              <div style={{ padding: '8px 12px', background: '#f0f0f0', borderRadius: '6px', fontSize: '13px', color: '#666' }}>
                ללא CR — משימה תשתיתית / כללית
              </div>
            ) : form.crNumber && form.crLabel ? (
              // CR pre-set from CR group — show read-only badge with full label
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
          <div style={{ paddingTop: '24px', flexShrink: 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={form.isFree}
                onChange={e => { setForm(f => ({ ...f, isFree: e.target.checked, crNumber: '', crLabel: '' })); setCrSearch(''); }}
              />
              ללא CR
            </label>
          </div>
        </div>

        {/* Phase + App */}
        <div>
          <label style={labelStyle}>שלב *</label>
          <select value={form.phase} onChange={e => setForm(f => ({ ...f, phase: parseInt(e.target.value) }))} style={inputStyle}>
            {[1, 2, 3, 4].map(ph => <option key={ph} value={ph}>{PHASE_LABELS[ph]}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>מערכת</label>
          <select value={form.app} onChange={e => setForm(f => ({ ...f, app: e.target.value }))} style={inputStyle}>
            <option value="">-- בחר --</option>
            {APPS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        {/* Title */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>תיאור המשימה *</label>
          <input
            autoFocus
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
            style={inputStyle}
            placeholder="תאר את הצעד שיש לבצע..."
          />
        </div>

        {/* Duration + User */}
        <div>
          <label style={labelStyle}>משך משוער (דקות)</label>
          <input type="number" min={1} value={form.estimatedMins}
            onChange={e => setForm(f => ({ ...f, estimatedMins: e.target.value }))}
            style={inputStyle} placeholder="למשל 30" />
        </div>
        <div>
          <label style={labelStyle}>עובד אחראי</label>
          <select value={form.assignedUserName} onChange={e => setForm(f => ({ ...f, assignedUserName: e.target.value }))} style={inputStyle}>
            <option value="">-- בחר עובד --</option>
            {users.map(u => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
          </select>
        </div>

        {/* Notes */}
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
          {PHASE_LABELS[p.phase]?.split(' — ')[0]}
        </span>
        <span style={{ flex: 1, fontSize: '13px', fontWeight: 'bold', color: '#1a2332' }}>{p.title}</span>
        {p.usedInTaskId ? (
          <span style={{ fontSize: '11px', color: '#27ae60', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0 }}>✅ בתוכנית</span>
        ) : submissionDone ? (
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

    return (
      <div style={{
        margin: '8px 0 4px',
        background: '#f8f0ff',
        border: '1px solid #d7bef7',
        borderRadius: '8px',
        padding: '14px 16px',
      }}>
        <div style={{ fontWeight: 'bold', fontSize: '12px', color: '#6c3483', marginBottom: '12px' }}>
          📋 פרטי תכנית CR — {crNumber}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>

          {/* Rollback */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ ...labelStyle, color: '#6c3483' }}>תכנית Rollback</label>
            <textarea
              value={f.rollbackPlan}
              onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, rollbackPlan: e.target.value } }))}
              style={{ ...inputStyle, height: '60px', resize: 'vertical' }}
              placeholder="תאר את תהליך ה-Rollback במקרה של כשל..."
            />
          </div>

          {/* Gradual rollout */}
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', color: '#6c3483', fontWeight: 'bold' }}>
                <input
                  type="checkbox"
                  checked={f.gradualRollout}
                  onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, gradualRollout: e.target.checked } }))}
                />
                עלייה מדורגת
              </label>
            </div>
            {f.gradualRollout && (
              <div style={{ flex: 1 }}>
                <input
                  value={f.gradualDetails}
                  onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, gradualDetails: e.target.value } }))}
                  style={inputStyle}
                  placeholder="תאר איך ומתי — שלבי העלייה..."
                />
              </div>
            )}
          </div>

          {/* Night testing notes */}
          <div>
            <label style={{ ...labelStyle, color: '#6c3483' }}>המלצות בדיקות ליל גרסה (שלב 2/3)</label>
            <textarea
              value={f.nightTestingNotes}
              onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, nightTestingNotes: e.target.value } }))}
              style={{ ...inputStyle, height: '56px', resize: 'vertical' }}
              placeholder="מה כדאי לבדוק בלילה..."
            />
          </div>

          {/* Morning monitoring */}
          <div>
            <label style={{ ...labelStyle, color: '#6c3483' }}>המלצות בקרות בוקר (שלב 4)</label>
            <textarea
              value={f.morningMonitoring}
              onChange={e => setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, morningMonitoring: e.target.value } }))}
              style={{ ...inputStyle, height: '56px', resize: 'vertical' }}
              placeholder="מה לבדוק בבוקר שלמחרת..."
            />
          </div>

          {/* CR dependencies */}
          {otherCrs.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ ...labelStyle, color: '#6c3483' }}>תלויות על CRים אחרים בגרסה</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {otherCrs.map(cr => (
                  <label key={cr} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer', background: 'white', padding: '4px 10px', borderRadius: '6px', border: `1px solid ${f.dependsOnCrs.includes(cr) ? '#6c3483' : '#ddd'}`, color: f.dependsOnCrs.includes(cr) ? '#6c3483' : '#555', fontWeight: f.dependsOnCrs.includes(cr) ? 'bold' : 'normal' }}>
                    <input
                      type="checkbox"
                      checked={f.dependsOnCrs.includes(cr)}
                      onChange={e => {
                        const next = e.target.checked
                          ? [...f.dependsOnCrs, cr]
                          : f.dependsOnCrs.filter(x => x !== cr);
                        setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...f, dependsOnCrs: next } }));
                      }}
                      style={{ margin: 0 }}
                    />
                    {cr}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px' }}>
          <button
            onClick={() => saveCrPlan(crNumber)}
            disabled={isSaving}
            style={{ padding: '6px 18px', background: isSaving ? '#aaa' : '#6c3483', color: 'white', border: 'none', borderRadius: '6px', cursor: isSaving ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 'bold' }}
          >
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
    const isPlanExpanded = expandedPlans.has(crNumber);
    const hasPlanData = !!crPlans[crNumber];

    return (
      <div key={crNumber} style={{ background: 'white', borderRadius: '10px', padding: '14px 16px', marginBottom: '10px', boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: crProposals.length ? '10px' : '0' }}>
          <span style={{ background: '#1a2332', color: 'white', padding: '3px 10px', borderRadius: '6px', fontSize: '13px', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
            {crNumber}
          </span>
          <span style={{ fontSize: '13px', color: '#444', flex: 1, fontWeight: label ? 'normal' : undefined }}>
            {label || ''}
          </span>
          <span style={{ fontSize: '11px', color: '#888', whiteSpace: 'nowrap' }}>
            {readyCount}/{crProposals.length} מוכן
          </span>
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
          {!submissionDone && (
            <button onClick={() => openAdd(crNumber, label)} style={{
              padding: '4px 12px', background: '#2d4a7a', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap',
            }}>
              + הוסף צעד
            </button>
          )}
          {!submissionDone && (
            <button onClick={() => deleteCrGroup(crNumber)} style={{
              padding: '4px 10px', background: '#fee', color: '#e74c3c',
              border: '1px solid #fcc', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap',
            }}>
              🗑 מחק CR
            </button>
          )}
        </div>

        {isPlanExpanded && renderCrPlanPanel(crNumber)}

        {crProposals.sort((a, b) => a.phase - b.phase).map(renderRow)}
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ direction: 'rtl', fontFamily: 'Arial, sans-serif' }}>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />

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
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {proposals.length > 0 && (
            <span style={{ fontSize: '13px', opacity: 0.85 }}>
              {totalReady}/{proposals.length} מוכן
            </span>
          )}
          {!submissionDone && (
            <button
              onClick={syncCrItems}
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
          {!submissionDone && (
            <button onClick={() => openAdd()} style={{
              padding: '8px 18px', background: 'rgba(255,255,255,0.2)', color: 'white',
              border: '1px solid rgba(255,255,255,0.4)', borderRadius: '8px',
              cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
            }}>
              + הוסף משימה
            </button>
          )}
          {submissionDone ? (
            <span style={{ padding: '8px 18px', background: '#27ae60', color: 'white', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px' }}>
              הוגש ✓
            </span>
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
      {submissionDone && (
        <div style={{ background: '#e8f8e8', border: '2px solid #27ae60', borderRadius: '10px', padding: '14px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>✅</span>
          <div>
            <div style={{ fontWeight: 'bold', color: '#1a5c2a', fontSize: '15px' }}>ההגשה הושלמה</div>
            <div style={{ fontSize: '13px', color: '#27ae60', marginTop: '2px' }}>מנהל הלילה יוכל לקדם את התוכנית לשלב הבא לאחר שכל הצוותים יגישו</div>
          </div>
        </div>
      )}

      {/* Form */}
      {!submissionDone && showForm && renderForm()}

      {/* Content — read-only after submission */}
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>טוען...</div>
      ) : crGroups.length === 0 && freeGroup.length === 0 && !showForm ? (
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
                {!submissionDone && (
                  <button onClick={() => openAdd(undefined, undefined, true)} style={{
                    padding: '4px 12px', background: '#7f8c8d', color: 'white',
                    border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap',
                  }}>
                    + הוסף משימה
                  </button>
                )}
              </div>
              {freeGroup.sort((a, b) => a.phase - b.phase).map(renderRow)}
            </div>
          )}
        </>
      )}
    </div>
  );
};
