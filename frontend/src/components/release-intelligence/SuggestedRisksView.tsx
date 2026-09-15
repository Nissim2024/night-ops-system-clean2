import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';

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
const SEVERITY_COLOR_CLASS: Record<string, string> = { CRITICAL: 'text-danger', HIGH: 'text-warning', MEDIUM: 'text-warning', LOW: 'text-subtle-foreground' };
const STATUS_LABEL: Record<string, string> = { PENDING: 'ממתין להחלטה', PROMOTED: 'הועבר לטבלה הראשית', REJECTED: 'נדחה' };
const STATUS_BADGE_CLASS: Record<string, string> = {
  PENDING: 'text-subtle-foreground bg-muted border-border',
  PROMOTED: 'text-success bg-success-bg border-success/40',
  REJECTED: 'text-danger bg-danger-bg border-danger/40',
};

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

  const thClass = 'px-2.5 py-2 text-right text-xs font-bold text-subtle-foreground border-b border-border whitespace-nowrap';
  const tdClass = 'px-2.5 py-2 align-top border-b border-border text-xs text-foreground';

  const pending = rows.filter(r => r.status === 'PENDING');
  const decided = rows.filter(r => r.status !== 'PENDING');

  const renderRow = (r: SuggestedRisk) => (
    <tr key={r.id}>
      <td className={`${tdClass} whitespace-pre-wrap min-w-[200px] font-semibold`}>{r.title}</td>
      <td className={`${tdClass} min-w-[150px]`}>{r.sourceArea}</td>
      <td className={`${tdClass} whitespace-pre-wrap min-w-[220px] text-subtle-foreground`}>{r.signal}</td>
      <td className={tdClass}>
        <span className={`font-semibold ${SEVERITY_COLOR_CLASS[r.severity] ?? 'text-subtle-foreground'}`}>{SEVERITY_LABEL[r.severity] ?? r.severity}</span>
      </td>
      <td className={tdClass}>{r.probability ? (PROBABILITY_LABEL[r.probability] ?? r.probability) : '—'}</td>
      <td className={`${tdClass} whitespace-pre-wrap min-w-[200px]`}>{r.impact || '—'}</td>
      <td className={`${tdClass} whitespace-pre-wrap min-w-[200px]`}>{r.mitigation || '—'}</td>
      <td className={`${tdClass} whitespace-nowrap`}>
        {r.status === 'PENDING' ? (
          canDecide ? (
            <div className="flex gap-1.5">
              <button onClick={() => promote(r.id)} disabled={busyId === r.id} className={`px-2.5 py-1 bg-primary text-white border-none rounded-sm cursor-pointer text-xs font-semibold ${busyId === r.id ? 'opacity-60' : 'opacity-100'}`}>
                ✅ העבר לטבלה הראשית
              </button>
              <button onClick={() => reject(r.id)} disabled={busyId === r.id} className={`px-2.5 py-1 bg-transparent text-subtle-foreground border border-border rounded-sm cursor-pointer text-xs ${busyId === r.id ? 'opacity-60' : 'opacity-100'}`}>
                ✖ דחה
              </button>
            </div>
          ) : (
            <span className="text-subtle-foreground">{STATUS_LABEL.PENDING}</span>
          )
        ) : (
          <span className={`inline-block font-semibold rounded-full px-2.5 py-0.5 border ${STATUS_BADGE_CLASS[r.status]}`}>
            {STATUS_LABEL[r.status]}
          </span>
        )}
      </td>
    </tr>
  );

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-lg font-bold text-foreground">💡 הצעות סיכונים (ניתוח AI)</div>
        <div className="text-xs text-subtle-foreground mt-0.5">
          רשימת סיכונים פוטנציאליים שזוהו מתוך יכולות המערכת הקיימות — לבחינה בלבד. סיכון שתבחר להעביר ייווצר
          בטבלת "ניהול סיכונים" הרגילה{versionName ? ` עבור ${versionName}` : ''}, ומשם הוא כבר מזין את הודעות
          הבית ואת ה-KPI, בדיוק כמו סיכון שנוצר ידנית.
        </div>
      </div>

      {error && (
        <div className="bg-danger-bg border border-danger/40 rounded-md px-3.5 py-2.5 text-danger text-sm">
          {error}
        </div>
      )}

      <div className="bg-card border border-border rounded-lg overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={thClass}>כותרת הסיכון</th>
              <th className={thClass}>תחום / מודול מקור</th>
              <th className={thClass}>אות מזהה (הבסיס לזיהוי)</th>
              <th className={thClass}>חומרה</th>
              <th className={thClass}>סבירות</th>
              <th className={thClass}>השפעה</th>
              <th className={thClass}>מיטיגציה</th>
              <th className={thClass}>סטטוס / פעולה</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className={`${tdClass} text-center text-subtle-foreground p-5`}>אין הצעות סיכונים כרגע.</td></tr>
            )}
            {pending.map(renderRow)}
            {decided.length > 0 && pending.length > 0 && (
              <tr><td colSpan={8} className={`${tdClass} border-b-0 px-2.5 py-1 text-subtle-foreground text-xs`}>הוחלט עליהן קודם:</td></tr>
            )}
            {decided.map(renderRow)}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SuggestedRisksView;
