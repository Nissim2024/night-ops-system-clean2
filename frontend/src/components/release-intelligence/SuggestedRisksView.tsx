import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface SuggestedRisk {
  id: string; title: string; sourceArea: string; signal: string;
  severity: string; probability: string | null; impact: string | null; mitigation: string | null;
  status: 'PENDING' | 'PROMOTED' | 'REJECTED'; promotedRiskId: string | null;
  createdAt: string;
}

// Same fixed vocabulary as RiskManagementView (release-intelligence/RiskManagementView.tsx)
// — this screen creates rows in that exact table, so labels must match.
const SEVERITY_LABEL: Record<string, string> = { CRITICAL: 'קריטי', HIGH: 'גבוהה', MEDIUM: 'בינוני', LOW: 'נמוך' };
const PROBABILITY_LABEL: Record<string, string> = { HIGH: 'גבוה', MEDIUM: 'בינוני', LOW: 'נמוך' };
const SEVERITY_COLOR: Record<string, string> = { CRITICAL: C.danger, HIGH: C.warning, MEDIUM: '#e8af00', LOW: C.textMuted };
const STATUS_LABEL: Record<string, string> = { PENDING: 'ממתין להחלטה', PROMOTED: 'הועבר לטבלה הראשית', REJECTED: 'נדחה' };
const STATUS_COLOR: Record<string, string> = { PENDING: C.textMuted, PROMOTED: C.success, REJECTED: C.danger };

// Same split as RiskManagementView's own RISK_WRITERS/RISK_CLOSERS — promoting
// a candidate creates a real ReleaseRisk, so it needs the same permission
// createRisk itself requires (matches suggested-risks.controller.ts).
const RISK_WRITERS = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];

interface Props { token: string; versionId?: string; versionName?: string; role: string; }

// Staging table for AI-identified candidate risks (spec confirmed 2026-09-05)
// — "כרגע רק לבחינה": a fixed, hand-curated list (see suggested-risks.service.ts's
// SEED_DATA — generic risk patterns derived from signals the app already
// computes elsewhere, e.g. Release Health, Activity Board, Daily QA snapshots),
// not a live detection engine yet. A user reviews this list and picks which
// ones actually deserve a real entry; "העבר לטבלה הראשית" creates a row in
// ReleaseRisk (RiskManagementView's own table, versionId = whatever the app's
// version-selector currently has open) — the one that actually feeds the Home
// risk feed and the health-score KPI. Rejecting just marks it done reviewing,
// no further effect. Both actions are final (no un-reject/un-promote here —
// same "final decision" shape as RiskManagementView's own close-risk action).
export const SuggestedRisksView: React.FC<Props> = ({ token, versionId, versionName, role }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [rows, setRows] = useState<SuggestedRisk[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canDecide = RISK_WRITERS.includes(role);

  const load = useCallback(() => {
    setLoading(true);
    axios.get(`${API}/suggested-risks`, { headers })
      .then(res => setRows(res.data ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const promote = async (id: string) => {
    if (!versionId) { setError('בחר גרסה מתפריט הצד לפני העברה — הסיכון ייווצר בגרסה שנבחרה.'); return; }
    setError(null);
    setBusyId(id);
    try {
      await axios.post(`${API}/suggested-risks/${id}/promote`, { versionId }, { headers });
      load();
    } catch (e: any) { setError(e?.response?.data?.message ?? 'העברה נכשלה'); }
    setBusyId(null);
  };

  const reject = async (id: string) => {
    setError(null);
    setBusyId(id);
    try {
      await axios.post(`${API}/suggested-risks/${id}/reject`, {}, { headers });
      load();
    } catch (e: any) { setError(e?.response?.data?.message ?? 'הפעולה נכשלה'); }
    setBusyId(null);
  };

  const thStyle: React.CSSProperties = { padding: '8px 10px', textAlign: 'right' as const, ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' as const };
  const tdStyle: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'top' as const, borderBottom: `1px solid ${C.border}`, ...TEXT.xs, color: C.textPrimary };

  const pending = rows.filter(r => r.status === 'PENDING');
  const decided = rows.filter(r => r.status !== 'PENDING');

  const renderRow = (r: SuggestedRisk) => (
    <tr key={r.id}>
      <td style={{ ...tdStyle, whiteSpace: 'pre-wrap' as const, minWidth: '200px', fontWeight: WEIGHT.semibold }}>{r.title}</td>
      <td style={{ ...tdStyle, minWidth: '150px' }}>{r.sourceArea}</td>
      <td style={{ ...tdStyle, whiteSpace: 'pre-wrap' as const, minWidth: '220px', color: C.textMuted }}>{r.signal}</td>
      <td style={tdStyle}>
        <span style={{ color: SEVERITY_COLOR[r.severity] ?? C.textMuted, fontWeight: WEIGHT.semibold }}>{SEVERITY_LABEL[r.severity] ?? r.severity}</span>
      </td>
      <td style={tdStyle}>{r.probability ? (PROBABILITY_LABEL[r.probability] ?? r.probability) : '—'}</td>
      <td style={{ ...tdStyle, whiteSpace: 'pre-wrap' as const, minWidth: '200px' }}>{r.impact || '—'}</td>
      <td style={{ ...tdStyle, whiteSpace: 'pre-wrap' as const, minWidth: '200px' }}>{r.mitigation || '—'}</td>
      <td style={{ ...tdStyle, whiteSpace: 'nowrap' as const }}>
        {r.status === 'PENDING' ? (
          canDecide ? (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={() => promote(r.id)} disabled={busyId === r.id} style={{ padding: '5px 10px', background: C.brand, color: '#fff', border: 'none', borderRadius: RADIUS.sm, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold, opacity: busyId === r.id ? 0.6 : 1 }}>
                ✅ העבר לטבלה הראשית
              </button>
              <button onClick={() => reject(r.id)} disabled={busyId === r.id} style={{ padding: '5px 10px', background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: 'pointer', fontFamily: FONT, ...TEXT.xs, opacity: busyId === r.id ? 0.6 : 1 }}>
                ✖ דחה
              </button>
            </div>
          ) : (
            <span style={{ color: C.textMuted }}>{STATUS_LABEL.PENDING}</span>
          )
        ) : (
          <span style={{
            display: 'inline-block', color: STATUS_COLOR[r.status], fontWeight: WEIGHT.semibold,
            background: `${STATUS_COLOR[r.status]}14`, border: `1px solid ${STATUS_COLOR[r.status]}40`,
            borderRadius: RADIUS.full, padding: '2px 9px',
          }}>
            {STATUS_LABEL[r.status]}
          </span>
        )}
      </td>
    </tr>
  );

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[3] }}>
      <div>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>💡 הצעות סיכונים (ניתוח AI)</div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px' }}>
          רשימת סיכונים פוטנציאליים שזוהו מתוך יכולות המערכת הקיימות — לבחינה בלבד. סיכון שתבחר להעביר ייווצר
          בטבלת "ניהול סיכונים" הרגילה{versionName ? ` עבור ${versionName}` : ''}, ומשם הוא כבר מזין את הודעות
          הבית ואת ה-KPI, בדיוק כמו סיכון שנוצר ידנית.
        </div>
      </div>

      {error && (
        <div style={{ background: `${C.danger}10`, border: `1px solid ${C.danger}40`, borderRadius: RADIUS.md, padding: '10px 14px', color: C.danger, ...TEXT.sm }}>
          {error}
        </div>
      )}

      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>כותרת הסיכון</th>
              <th style={thStyle}>תחום / מודול מקור</th>
              <th style={thStyle}>אות מזהה (הבסיס לזיהוי)</th>
              <th style={thStyle}>חומרה</th>
              <th style={thStyle}>סבירות</th>
              <th style={thStyle}>השפעה</th>
              <th style={thStyle}>מיטיגציה</th>
              <th style={thStyle}>סטטוס / פעולה</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: C.textMuted, padding: SP[5] }}>אין הצעות סיכונים כרגע.</td></tr>
            )}
            {pending.map(renderRow)}
            {decided.length > 0 && pending.length > 0 && (
              <tr><td colSpan={8} style={{ ...tdStyle, borderBottom: 'none', padding: '4px 10px', color: C.textMuted, ...TEXT.xs }}>הוחלט עליהן קודם:</td></tr>
            )}
            {decided.map(renderRow)}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SuggestedRisksView;
