import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { cn } from '../../lib/utils';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Risk {
  id: string; title: string; severity: string; probability: string | null;
  impact: string | null; mitigation: string | null; status: string;
  createdAt: string;
}

const SEVERITY_OPTIONS = [
  { value: 'CRITICAL', label: 'קריטי' },
  { value: 'HIGH', label: 'גבוהה' },
  { value: 'MEDIUM', label: 'בינוני' },
  { value: 'LOW', label: 'נמוך' },
];
const PROBABILITY_OPTIONS = [
  { value: 'HIGH', label: 'גבוה' },
  { value: 'MEDIUM', label: 'בינוני' },
  { value: 'LOW', label: 'נמוך' },
];
// Closed list + free-text "אחר" fallback (spec confirmed 2026-09-02) — any
// impact value not in this fixed list is treated as a custom "אחר" value in
// the UI, so older/custom data still round-trips correctly.
const IMPACT_OPTIONS = ['עיכוב בלוח זמנים', 'פגיעה באיכות', 'פגיעה בהיקף', 'פגיעה בזמינות המערכת', 'השפעה תפעולית'];
const IMPACT_OTHER = 'אחר';
const STATUS_OPTIONS = [
  { value: 'OPEN', label: 'פתוח' },
  { value: 'MITIGATED', label: 'בטיפול' },
  { value: 'CLOSED', label: 'סגור' },
];

const SEVERITY_LABEL: Record<string, string> = Object.fromEntries(SEVERITY_OPTIONS.map(o => [o.value, o.label]));
const PROBABILITY_LABEL: Record<string, string> = Object.fromEntries(PROBABILITY_OPTIONS.map(o => [o.value, o.label]));
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map(o => [o.value, o.label]));
const SEVERITY_COLOR: Record<string, string> = { CRITICAL: C.danger, HIGH: C.warning, MEDIUM: '#e8af00', LOW: C.textMuted };
const STATUS_COLOR: Record<string, string> = { OPEN: C.danger, MITIGATED: C.warning, CLOSED: C.success };

// Matches the backend's RISK_WRITERS/RISK_CLOSERS split in
// release-intelligence.controller.ts — team leads can create/edit risk
// content, but only RM/ADMIN can move a risk to CLOSED (spec confirmed
// 2026-09-02, same split as the pre-existing quick-add form on the Overview
// screen this page replaces).
const RISK_WRITERS = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];
const RISK_CLOSERS = ['RELEASE_MANAGER', 'ADMIN'];

interface Props { token: string; versionId?: string; role: string; }

interface Draft {
  title: string; severity: string; probability: string;
  impact: string; impactOther: string; mitigation: string; status: string;
}
const EMPTY_DRAFT: Draft = { title: '', severity: 'MEDIUM', probability: 'MEDIUM', impact: IMPACT_OPTIONS[0], impactOther: '', mitigation: '', status: 'OPEN' };

function toDraft(r: Risk): Draft {
  const isCustomImpact = !!r.impact && !IMPACT_OPTIONS.includes(r.impact);
  return {
    title: r.title, severity: r.severity, probability: r.probability ?? 'MEDIUM',
    impact: isCustomImpact ? IMPACT_OTHER : (r.impact ?? IMPACT_OPTIONS[0]),
    impactOther: isCustomImpact ? (r.impact as string) : '',
    mitigation: r.mitigation ?? '', status: r.status,
  };
}

// Dedicated risk-management page (spec confirmed 2026-09-02) — the
// ReleaseRisk table and its full CRUD already existed server-side
// (release-intelligence.service.ts's listRisks/createRisk/updateRisk/
// closeRisk), but the only UI ever built against it was a bare title+severity
// quick-add buried in the Overview screen. This is the real table: description,
// severity, probability, impact, mitigation, status — inline add/edit, no modal.
export const RiskManagementView: React.FC<Props> = ({ token, versionId, role }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [risks, setRisks] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const canWrite = RISK_WRITERS.includes(role);
  const canClose = RISK_CLOSERS.includes(role);

  const load = useCallback(() => {
    if (!versionId) { setRisks([]); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/risks/${versionId}`, { headers })
      .then(res => setRisks(res.data ?? []))
      .catch(() => setRisks([]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);
  useEffect(() => { load(); }, [load]);

  const startAdd = () => { setDraft(EMPTY_DRAFT); setEditingId(null); setAdding(true); };
  const startEdit = (r: Risk) => { setDraft(toDraft(r)); setAdding(false); setEditingId(r.id); };
  const cancel = () => { setAdding(false); setEditingId(null); setDraft(EMPTY_DRAFT); };

  const save = async () => {
    if (!versionId || !draft.title.trim()) return;
    const impact = draft.impact === IMPACT_OTHER ? draft.impactOther.trim() : draft.impact;
    const payload = {
      title: draft.title.trim(), severity: draft.severity, probability: draft.probability,
      impact: impact || null, mitigation: draft.mitigation.trim() || null, status: draft.status,
    };
    setSaving(true);
    try {
      if (editingId) {
        await axios.patch(`${API}/release-intelligence/risks/${editingId}`, payload, { headers });
      } else {
        await axios.post(`${API}/release-intelligence/risks`, { ...payload, versionId }, { headers });
      }
      load();
      cancel();
    } catch (e) { console.error('Failed to save risk', e); }
    setSaving(false);
  };

  const inputClass = 'w-full box-border rounded-sm border border-border bg-card px-[9px] py-1.5 text-xs text-foreground';
  const thClass = 'whitespace-nowrap border-b border-border px-2.5 py-2 text-right text-xs font-bold text-subtle-foreground';
  const tdClass = 'border-b border-border px-2.5 py-2 align-top text-xs text-foreground';

  if (!versionId) {
    return <div className="p-8 text-center text-subtle-foreground [direction:rtl]">בחר גרסה מתפריט הצד.</div>;
  }

  const renderForm = (isNew: boolean) => (
    <tr className="bg-muted">
      <td className={tdClass}>
        <textarea autoFocus value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
          placeholder="תיאור הסיכון…" rows={2} className={cn(inputClass, 'min-w-[220px] resize-y')} />
      </td>
      <td className={tdClass}>
        <select value={draft.severity} onChange={e => setDraft(d => ({ ...d, severity: e.target.value }))} className={inputClass}>
          {SEVERITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td className={tdClass}>
        <select value={draft.probability} onChange={e => setDraft(d => ({ ...d, probability: e.target.value }))} className={inputClass}>
          {PROBABILITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td className={tdClass}>
        <select value={draft.impact} onChange={e => setDraft(d => ({ ...d, impact: e.target.value }))} className={cn(inputClass, draft.impact === IMPACT_OTHER && 'mb-1.5')}>
          {IMPACT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          <option value={IMPACT_OTHER}>{IMPACT_OTHER}</option>
        </select>
        {draft.impact === IMPACT_OTHER && (
          <input value={draft.impactOther} onChange={e => setDraft(d => ({ ...d, impactOther: e.target.value }))} placeholder="פרט…" className={inputClass} />
        )}
      </td>
      <td className={tdClass}>
        <textarea value={draft.mitigation} onChange={e => setDraft(d => ({ ...d, mitigation: e.target.value }))}
          placeholder="מיטיגציה…" rows={2} className={cn(inputClass, 'min-w-[180px] resize-y')} />
      </td>
      <td className={tdClass}>
        <select
          value={draft.status}
          onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}
          className={inputClass}
        >
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value} disabled={o.value === 'CLOSED' && !canClose && draft.status !== 'CLOSED'}>{o.label}</option>
          ))}
        </select>
      </td>
      <td className={cn(tdClass, 'whitespace-nowrap')}>
        <div className="flex gap-1.5">
          <button onClick={save} disabled={saving || !draft.title.trim()} className={cn('cursor-pointer rounded-sm border-none bg-primary px-3 py-[5px] text-xs font-semibold text-white', (saving || !draft.title.trim()) && 'opacity-60')}>
            {saving ? '...' : 'שמור'}
          </button>
          <button onClick={cancel} disabled={saving} className="cursor-pointer rounded-sm border border-border bg-transparent px-3 py-[5px] text-xs text-subtle-foreground">
            ביטול
          </button>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="flex flex-col gap-3 [direction:rtl]">
      <div className="flex items-center justify-between">
        <div className="text-lg font-bold text-foreground">⚠️ ניהול סיכונים</div>
        {canWrite && !adding && (
          <button onClick={startAdd} className="cursor-pointer rounded-md border-none bg-primary px-4 py-[7px] text-sm font-semibold text-white">
            + סיכון חדש
          </button>
        )}
      </div>

      <div className="overflow-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={thClass}>תיאור הסיכון</th>
              <th className={thClass}>חומרה</th>
              <th className={thClass}>סבירות</th>
              <th className={thClass}>השפעה</th>
              <th className={thClass}>מיטיגציה</th>
              <th className={thClass}>סטטוס</th>
              {canWrite && <th className={thClass}></th>}
            </tr>
          </thead>
          <tbody>
            {adding && renderForm(true)}
            {!loading && risks.length === 0 && !adding && (
              <tr><td colSpan={7} className={cn(tdClass, 'p-5 text-center text-subtle-foreground')}>אין סיכונים רשומים לגרסה זו.</td></tr>
            )}
            {risks.map(r => editingId === r.id ? (
              <React.Fragment key={r.id}>{renderForm(false)}</React.Fragment>
            ) : (
              <tr key={r.id}>
                <td className={cn(tdClass, 'min-w-[220px] whitespace-pre-wrap')}>{r.title}</td>
                <td className={tdClass}>
                  <span className="font-semibold" style={{ color: SEVERITY_COLOR[r.severity] ?? C.textMuted }}>{SEVERITY_LABEL[r.severity] ?? r.severity}</span>
                </td>
                <td className={tdClass}>{r.probability ? (PROBABILITY_LABEL[r.probability] ?? r.probability) : '—'}</td>
                <td className={tdClass}>{r.impact || '—'}</td>
                <td className={cn(tdClass, 'min-w-[180px] whitespace-pre-wrap')}>{r.mitigation || '—'}</td>
                <td className={tdClass}>
                  <span
                    className="inline-block rounded-full px-2.5 py-0.5 font-semibold"
                    style={{
                      color: STATUS_COLOR[r.status] ?? C.textMuted,
                      background: `${STATUS_COLOR[r.status] ?? C.textMuted}14`,
                      border: `1px solid ${STATUS_COLOR[r.status] ?? C.textMuted}40`,
                    }}
                  >
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </td>
                {canWrite && (
                  <td className={cn(tdClass, 'whitespace-nowrap')}>
                    <button onClick={() => startEdit(r)} className="cursor-pointer border-none bg-transparent text-xs font-semibold text-primary">✏️ ערוך</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RiskManagementView;
