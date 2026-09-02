import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';

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

  const inputStyle: React.CSSProperties = {
    padding: '6px 9px', borderRadius: RADIUS.sm, border: `1px solid ${C.borderEm}`,
    background: C.bgCard, color: C.textPrimary, fontFamily: FONT, ...TEXT.xs, boxSizing: 'border-box', width: '100%',
  };
  const thStyle: React.CSSProperties = { padding: '8px 10px', textAlign: 'right' as const, ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' as const };
  const tdStyle: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'top' as const, borderBottom: `1px solid ${C.border}`, ...TEXT.xs, color: C.textPrimary };

  if (!versionId) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>בחר גרסה מתפריט הצד.</div>;
  }

  const renderForm = (isNew: boolean) => (
    <tr style={{ background: C.bgHover }}>
      <td style={tdStyle}>
        <textarea autoFocus value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
          placeholder="תיאור הסיכון…" rows={2} style={{ ...inputStyle, resize: 'vertical' as const, minWidth: '220px' }} />
      </td>
      <td style={tdStyle}>
        <select value={draft.severity} onChange={e => setDraft(d => ({ ...d, severity: e.target.value }))} style={inputStyle}>
          {SEVERITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td style={tdStyle}>
        <select value={draft.probability} onChange={e => setDraft(d => ({ ...d, probability: e.target.value }))} style={inputStyle}>
          {PROBABILITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td style={tdStyle}>
        <select value={draft.impact} onChange={e => setDraft(d => ({ ...d, impact: e.target.value }))} style={{ ...inputStyle, marginBottom: draft.impact === IMPACT_OTHER ? '6px' : 0 }}>
          {IMPACT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          <option value={IMPACT_OTHER}>{IMPACT_OTHER}</option>
        </select>
        {draft.impact === IMPACT_OTHER && (
          <input value={draft.impactOther} onChange={e => setDraft(d => ({ ...d, impactOther: e.target.value }))} placeholder="פרט…" style={inputStyle} />
        )}
      </td>
      <td style={tdStyle}>
        <textarea value={draft.mitigation} onChange={e => setDraft(d => ({ ...d, mitigation: e.target.value }))}
          placeholder="מיטיגציה…" rows={2} style={{ ...inputStyle, resize: 'vertical' as const, minWidth: '180px' }} />
      </td>
      <td style={tdStyle}>
        <select
          value={draft.status}
          onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}
          style={inputStyle}
        >
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value} disabled={o.value === 'CLOSED' && !canClose && draft.status !== 'CLOSED'}>{o.label}</option>
          ))}
        </select>
      </td>
      <td style={{ ...tdStyle, whiteSpace: 'nowrap' as const }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={save} disabled={saving || !draft.title.trim()} style={{ padding: '5px 12px', background: C.brand, color: '#fff', border: 'none', borderRadius: RADIUS.sm, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold, opacity: saving || !draft.title.trim() ? 0.6 : 1 }}>
            {saving ? '...' : 'שמור'}
          </button>
          <button onClick={cancel} disabled={saving} style={{ padding: '5px 12px', background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs }}>
            ביטול
          </button>
        </div>
      </td>
    </tr>
  );

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[3] }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>⚠️ ניהול סיכונים</div>
        {canWrite && !adding && (
          <button onClick={startAdd} style={{ padding: '7px 16px', background: C.brand, color: '#fff', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.semibold }}>
            + סיכון חדש
          </button>
        )}
      </div>

      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>תיאור הסיכון</th>
              <th style={thStyle}>חומרה</th>
              <th style={thStyle}>סבירות</th>
              <th style={thStyle}>השפעה</th>
              <th style={thStyle}>מיטיגציה</th>
              <th style={thStyle}>סטטוס</th>
              {canWrite && <th style={thStyle}></th>}
            </tr>
          </thead>
          <tbody>
            {adding && renderForm(true)}
            {!loading && risks.length === 0 && !adding && (
              <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: C.textMuted, padding: SP[5] }}>אין סיכונים רשומים לגרסה זו.</td></tr>
            )}
            {risks.map(r => editingId === r.id ? (
              <React.Fragment key={r.id}>{renderForm(false)}</React.Fragment>
            ) : (
              <tr key={r.id}>
                <td style={{ ...tdStyle, whiteSpace: 'pre-wrap' as const, minWidth: '220px' }}>{r.title}</td>
                <td style={tdStyle}>
                  <span style={{ color: SEVERITY_COLOR[r.severity] ?? C.textMuted, fontWeight: WEIGHT.semibold }}>{SEVERITY_LABEL[r.severity] ?? r.severity}</span>
                </td>
                <td style={tdStyle}>{r.probability ? (PROBABILITY_LABEL[r.probability] ?? r.probability) : '—'}</td>
                <td style={tdStyle}>{r.impact || '—'}</td>
                <td style={{ ...tdStyle, whiteSpace: 'pre-wrap' as const, minWidth: '180px' }}>{r.mitigation || '—'}</td>
                <td style={tdStyle}>
                  <span style={{
                    display: 'inline-block', color: STATUS_COLOR[r.status] ?? C.textMuted, fontWeight: WEIGHT.semibold,
                    background: `${STATUS_COLOR[r.status] ?? C.textMuted}14`, border: `1px solid ${STATUS_COLOR[r.status] ?? C.textMuted}40`,
                    borderRadius: RADIUS.full, padding: '2px 9px',
                  }}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </td>
                {canWrite && (
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' as const }}>
                    <button onClick={() => startEdit(r)} style={{ background: 'transparent', border: 'none', color: C.brand, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold }}>✏️ ערוך</button>
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
