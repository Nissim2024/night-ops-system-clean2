import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { JIRA } from '../../theme';
import { Card, TextField } from '../ui';
import { IssueKeyLink, StatusBadge, SeverityBadge } from '../shared/defectFieldDisplay';
import { formatDate } from '../../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Browse QC releases going back to 2022 (docs/spec-defects-module.md-adjacent
// ask, 2026-09-18) — independent of DeployCenter's own Version table, since
// the whole point is releases that predate this tool or were never run
// through it. QcRelease already syncs from Oracle independent of Version
// (backend/src/qc-releases/qc-releases.service.ts); this screen is the first
// place that lists ALL of them (not just the "active" picker inside version
// creation) and lets you drill into a release's real defects directly by
// relId, with no local Version required at all.
//
// UNVERIFIED against real Oracle: the sync's historical cutoff was widened
// today (was 360 days, now 2022-01-01) but populating the table with those
// older releases needs a real Oracle-connected sync run, which can't happen
// from here — this screen will show whatever QcRelease rows already exist
// until that sync runs for real.
interface QcReleaseRow {
  id: string;
  relId: number;
  relName: string;
  relStartDate: string | null;
  relEndDate: string | null;
  goLiveDate: string | null;
  rehearsalDate: string | null;
  active: boolean;
  versions: { id: string; name: string }[];
}

interface DefectRow {
  id: string;
  title: string;
  severity: string;
  status: string;
  assignedTo: string;
  discoveryDate: string;
  responsibility: string;
}

interface Props { token: string; }

export const QcReleaseHistoryView: React.FC<Props> = ({ token }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [releases, setReleases] = useState<QcReleaseRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<QcReleaseRow | null>(null);
  const [defects, setDefects] = useState<DefectRow[] | null>(null);
  const [defectsLoading, setDefectsLoading] = useState(false);

  useEffect(() => {
    axios.get(`${API}/qc-releases`, { headers })
      .then(res => setReleases(res.data ?? []))
      .catch(() => setReleases([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const filtered = useMemo(() => {
    if (!releases) return [];
    const term = search.trim().toLowerCase();
    return term ? releases.filter(r => r.relName.toLowerCase().includes(term)) : releases;
  }, [releases, search]);

  const openRelease = (r: QcReleaseRow) => {
    setSelected(r);
    setDefects(null);
    setDefectsLoading(true);
    axios.get(`${API}/qc/defects-by-relid`, { headers, params: { relId: r.relId } })
      .then(res => setDefects(res.data ?? []))
      .catch(() => setDefects([]))
      .finally(() => setDefectsLoading(false));
  };

  if (selected) {
    return (
      <div className="flex flex-col gap-4 px-1 py-1" dir="rtl">
        <button onClick={() => setSelected(null)} className="self-start text-sm font-semibold text-primary cursor-pointer bg-transparent border-none">
          → חזרה לרשימת הגרסאות
        </button>
        <Card>
          <div className="text-base font-bold text-foreground mb-1">{selected.relName}</div>
          <div className="text-xs text-subtle-foreground mb-3">
            {formatDate(selected.relStartDate)} – {formatDate(selected.relEndDate)}
            {selected.versions.length > 0 && (
              <span> · מקושרת לגרסת DeployCenter: {selected.versions.map(v => v.name).join(', ')}</span>
            )}
            {selected.versions.length === 0 && <span> · אין גרסת DeployCenter מקושרת (רק QC)</span>}
          </div>
          {defectsLoading ? (
            <div className="text-sm text-subtle-foreground py-4 text-center">טוען תקלות…</div>
          ) : !defects || defects.length === 0 ? (
            <div className="text-sm text-subtle-foreground py-4 text-center">אין תקלות זמינות לגרסה זו</div>
          ) : (
            <div className="overflow-x-auto rounded-md" style={{ border: `1px solid ${JIRA.greyN40}` }}>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-muted">
                    {['תקלה', 'כותרת', 'חומרה', 'סטטוס', 'אחריות', 'שויך ל', 'תאריך גילוי'].map(h => (
                      <th key={h} className="px-2 py-2 text-right font-bold text-muted-foreground" style={{ borderBottom: `2px solid ${JIRA.greyN40}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {defects.map(d => (
                    <tr key={d.id}>
                      <td className="px-2 py-1.5" style={{ borderBottom: `1px solid ${JIRA.greyN40}` }}><IssueKeyLink id={d.id} /></td>
                      <td className="px-2 py-1.5 max-w-[280px] truncate" style={{ borderBottom: `1px solid ${JIRA.greyN40}` }} title={d.title}>{d.title}</td>
                      <td className="px-2 py-1.5" style={{ borderBottom: `1px solid ${JIRA.greyN40}` }}><SeverityBadge severity={d.severity} /></td>
                      <td className="px-2 py-1.5" style={{ borderBottom: `1px solid ${JIRA.greyN40}` }}><StatusBadge status={d.status} /></td>
                      <td className="px-2 py-1.5" style={{ borderBottom: `1px solid ${JIRA.greyN40}` }}>{d.responsibility || '—'}</td>
                      <td className="px-2 py-1.5" style={{ borderBottom: `1px solid ${JIRA.greyN40}` }}>{d.assignedTo || '—'}</td>
                      <td className="px-2 py-1.5" style={{ borderBottom: `1px solid ${JIRA.greyN40}` }}>{d.discoveryDate || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-1 py-1" dir="rtl">
      <div className="text-lg font-bold text-foreground">🗄️ עיון בגרסאות QC היסטוריות</div>
      <div className="text-xs text-subtle-foreground leading-relaxed">
        כל הגרסאות שידועות ל-QC (מסונכרן מ-Oracle, בלי תלות בגרסה מקומית ב-DeployCenter) — כולל כאלה שמעולם לא נוצרו כאן.
        לחיצה על גרסה מציגה את התקלות האמיתיות שלה. הסנכרון ההיסטורי (מ-2022) דורש הרצה מול Oracle אמיתי — הרשימה כאן מציגה את מה שכבר מסונכרן.
      </div>
      <TextField value={search} onChange={e => setSearch(e.target.value)} placeholder="חיפוש לפי שם גרסה..." />
      <Card>
        {releases === null ? (
          <div className="text-sm text-subtle-foreground py-4 text-center">טוען…</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-subtle-foreground py-4 text-center">אין גרסאות תואמות</div>
        ) : (
          <div className="overflow-x-auto rounded-md" style={{ border: `1px solid ${JIRA.greyN40}` }}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-muted">
                  {['שם גרסה', 'תאריך התחלה', 'תאריך סיום', 'עלייה לאוויר', 'מקושרת ל-DeployCenter'].map(h => (
                    <th key={h} className="px-2 py-2 text-right font-bold text-muted-foreground" style={{ borderBottom: `2px solid ${JIRA.greyN40}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr
                    key={r.id}
                    onClick={() => openRelease(r)}
                    className="cursor-pointer hover:bg-muted"
                  >
                    <td className="px-2 py-1.5 font-semibold" style={{ borderBottom: `1px solid ${JIRA.greyN40}`, color: JIRA.blue }}>{r.relName}</td>
                    <td className="px-2 py-1.5" style={{ borderBottom: `1px solid ${JIRA.greyN40}` }}>{formatDate(r.relStartDate)}</td>
                    <td className="px-2 py-1.5" style={{ borderBottom: `1px solid ${JIRA.greyN40}` }}>{formatDate(r.relEndDate)}</td>
                    <td className="px-2 py-1.5" style={{ borderBottom: `1px solid ${JIRA.greyN40}` }}>{formatDate(r.goLiveDate)}</td>
                    <td className="px-2 py-1.5" style={{ borderBottom: `1px solid ${JIRA.greyN40}` }}>
                      {r.versions.length > 0 ? r.versions.map(v => v.name).join(', ') : <span className="text-subtle-foreground">— QC בלבד —</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default QcReleaseHistoryView;
