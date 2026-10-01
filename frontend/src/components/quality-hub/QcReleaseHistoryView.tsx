import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { C, JIRA } from '../../theme';
import { Card, TextField } from '../ui';
import { IssueKeyLink, StatusBadge, SeverityBadge } from '../shared/defectFieldDisplay';
import { formatDate } from '../../utils/dateFormat';
import { QcBugDashboardView } from '../release-intelligence/QcBugDashboardView';
import { CyclesPanel, CycleProgress } from '../release-intelligence/CycleProgressView';
import { DefectsView, historicalDrilldownUrl } from '../release-intelligence/DefectsView';
import { DefectDrilldownModal } from '../release-intelligence/DefectDrilldownModal';
import { ReopenAnalysisView } from '../release-intelligence/ReopenAnalysisView';

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
  versions: { id: string; name: string; isQcHistorical?: boolean }[];
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

interface Props {
  token: string;
  // Opens the release as a full Version (POST /qc-releases/:relId/open-as-version)
  // and hands its id to the host to select + navigate to it.
  onOpenVersion?: (versionId: string) => void;
}

interface DefectsBreakdown {
  kpis: { open: number; fixed: number; closed: number; rejected: number; reopen: number };
  bySeverity: { label: string; count: number }[];
}

type HistoryTab = 'overview' | 'defects' | 'bug-dashboard' | 'cycle-progress' | 'defects-breakdown' | 'reopen';
const TABS: { key: HistoryTab; label: string }[] = [
  { key: 'overview', label: '🏠 סקירה' },
  { key: 'cycle-progress', label: '📊 התקדמות סבבים' },
  { key: 'defects-breakdown', label: '🐞 פירוט תקלות' },
  { key: 'bug-dashboard', label: '🪲 לוח באגים' },
  { key: 'reopen', label: '♻️ ניתוח Reopen' },
  { key: 'defects', label: '📋 רשימת תקלות' },
];

const SEVERITY_ORDER: { key: string; label: string }[] = [
  { key: 'showStopper', label: 'Show Stopper' },
  { key: 'severe', label: 'Severe' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
];

// Always-visible identity of the open release — shown above the tabs on
// every tab, so it's never ambiguous which release the numbers belong to.
const ReleaseHeader: React.FC<{ release: QcReleaseRow; onBack: () => void; onOpenAsVersion?: () => void; opening?: boolean }> = ({ release, onBack, onOpenAsVersion, opening }) => (
  <div className="bg-card border border-border rounded-lg px-5 py-4 flex items-center justify-between gap-4 flex-wrap" style={{ borderInlineStart: `4px solid ${C.brand}` }}>
    <div className="min-w-0">
      <div className="text-xs text-subtle-foreground mb-0.5">🗄️ גרסת QC נבחרת</div>
      <div className="text-2xl font-bold text-foreground leading-tight">{release.relName}</div>
      <div className="text-xs text-subtle-foreground mt-1 flex gap-3 flex-wrap">
        {(release.relStartDate || release.relEndDate) && (
          <span>📅 {formatDate(release.relStartDate)} – {formatDate(release.relEndDate)}</span>
        )}
        {release.goLiveDate && <span>🚀 עלייה לאוויר: {formatDate(release.goLiveDate)}</span>}
        {release.versions.length > 0
          ? <span>🔗 מקושרת ל-DeployCenter: {release.versions.map(v => v.name).join(', ')}</span>
          : <span>QC בלבד (אין גרסת DeployCenter)</span>}
      </div>
    </div>
    <div className="flex gap-2 flex-wrap">
      {onOpenAsVersion && (
        <button
          onClick={onOpenAsVersion}
          disabled={opening}
          className="rounded-md border-none px-3.5 py-1.5 text-[13px] font-semibold text-white cursor-pointer whitespace-nowrap disabled:opacity-60"
          style={{ background: C.brand }}
          title="פותח את הגרסה בכל תפריטי המערכת (ניהול בדיקות, איכות, תקלות…) — לקריאה בלבד"
        >
          {opening ? 'פותח…' : release.versions.length > 0 ? '↗ עבור לגרסה במערכת' : '🚀 פתח כגרסה מלאה'}
        </button>
      )}
      <button onClick={onBack} className="rounded-md border border-border bg-transparent px-3.5 py-1.5 text-[13px] text-foreground cursor-pointer whitespace-nowrap">
        → החלפת גרסה
      </button>
    </div>
  </div>
);

function OverviewKpi({ value, label, sub, color, onClick }: { value: string; label: string; sub?: string; color?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`bg-card border border-border rounded-lg px-5 py-4 flex-1 min-w-[160px] ${onClick ? 'cursor-pointer hover:bg-muted' : ''}`}>
      <div className="text-2xl font-bold leading-tight" style={{ color: color ?? C.textPrimary }}>{value}</div>
      <div className="text-xs text-subtle-foreground mt-1">{label}</div>
      {sub && <div className="text-[11px] text-subtle-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

// The release's home page — one-screen summary, every number clickable into
// the tab or defect list behind it.
const ReleaseOverview: React.FC<{
  token: string;
  release: QcReleaseRow;
  cycleProgress: CycleProgress | null;
  cycleProgressLoading: boolean;
  breakdown: DefectsBreakdown | null;
  onGoTab: (t: HistoryTab) => void;
}> = ({ token, release, cycleProgress, cycleProgressLoading, breakdown, onGoTab }) => {
  const [drilldown, setDrilldown] = useState<{ filter: string; value?: string; title: string } | null>(null);

  const cycles = cycleProgress?.timeline ?? [];
  const evaluable = cycles.filter(c => c.successPct != null && c.qgTargetPct != null);
  const metTarget = evaluable.filter(c => (c.successPct as number) >= (c.qgTargetPct as number));
  const crsTested = new Set(cycles.flatMap(c => c.crCoverage.map(cc => cc.crNumber))).size;
  const qgPass = cycleProgress?.kpis.qgStatus === 'PASS';

  if (cycleProgressLoading && !cycleProgress) {
    return <div className="text-sm text-subtle-foreground py-6 text-center">טוען סקירה…</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3 flex-wrap">
        <OverviewKpi
          value={cycleProgress ? (qgPass ? 'PASS' : 'FAIL') : '—'}
          label="סטטוס Quality Gate"
          sub="תקלות פתוחות מול ספי QG"
          color={cycleProgress ? (qgPass ? C.success : C.danger) : undefined}
        />
        <OverviewKpi
          value={breakdown ? String(breakdown.kpis.open) : '—'}
          label="תקלות פתוחות"
          sub={breakdown ? `${breakdown.kpis.closed} סגורות · ${breakdown.kpis.reopen} Reopen` : undefined}
          color={breakdown && breakdown.kpis.open > 0 ? C.danger : C.success}
          onClick={breakdown ? () => setDrilldown({ filter: 'kpi', value: 'open', title: `${release.relName} — תקלות פתוחות` }) : undefined}
        />
        <OverviewKpi
          value={evaluable.length > 0 ? `${metTarget.length}/${evaluable.length}` : '—'}
          label="סבבים שעמדו ביעד QG"
          sub={`${cycles.length} סבבים בגרסה`}
          color={evaluable.length > 0 ? (metTarget.length === evaluable.length ? C.success : C.danger) : undefined}
          onClick={() => onGoTab('cycle-progress')}
        />
        <OverviewKpi
          value={String(crsTested)}
          label="CR-ים שנבדקו"
          sub="עם כיסוי בדיקות ב-QC"
          onClick={() => onGoTab('cycle-progress')}
        />
      </div>

      <div className="flex gap-3 flex-wrap items-start">
        <div className="bg-card border border-border rounded-lg p-4 flex-[2] min-w-[320px]">
          <div className="flex justify-between items-center mb-3">
            <div className="text-sm font-bold text-foreground">סבבים</div>
            <button onClick={() => onGoTab('cycle-progress')} className="text-xs text-primary bg-transparent border-none cursor-pointer">לפירוט מלא ←</button>
          </div>
          {cycles.length === 0 ? (
            <div className="text-xs text-subtle-foreground">אין נתוני סבבים ב-QC לגרסה זו.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {cycles.map(c => {
                const hasSuccess = c.successPct != null;
                const reached = hasSuccess && c.qgTargetPct != null && (c.successPct as number) >= c.qgTargetPct;
                const barColor = !hasSuccess ? C.textMuted : c.qgTargetPct == null ? C.brand : reached ? C.success : C.danger;
                return (
                  <div key={c.cycleType} onClick={() => onGoTab('cycle-progress')} className="flex items-center gap-3 cursor-pointer hover:bg-muted rounded px-1 py-1">
                    <div className="text-xs font-semibold text-foreground w-[150px] shrink-0 truncate" title={c.cycleType}>{c.cycleType}</div>
                    <div className="relative flex-1 h-2.5 bg-muted rounded-sm overflow-hidden">
                      <div className="h-full rounded-sm" style={{ width: `${Math.min(100, c.successPct ?? 0)}%`, background: barColor }} />
                      {c.qgTargetPct != null && (
                        <div className="absolute top-0 bottom-0 w-0.5 bg-foreground" style={{ insetInlineStart: `${c.qgTargetPct}%` }} title={`יעד ${c.qgTargetPct}%`} />
                      )}
                    </div>
                    <div className="text-xs w-[120px] shrink-0 text-left" style={{ color: barColor }}>
                      {hasSuccess ? `${c.successPct}%` : 'אין נתונים'}{c.qgTargetPct != null && <span className="text-subtle-foreground"> / {c.qgTargetPct}%</span>}
                    </div>
                    <div className="text-[11px] text-subtle-foreground w-[50px] shrink-0">{c.crCoverage.length} CR</div>
                  </div>
                );
              })}
              <div className="text-[11px] text-subtle-foreground mt-1">אחוז הצלחה / יעד QG · הקו השחור מסמן את היעד</div>
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg p-4 flex-1 min-w-[260px]">
          <div className="flex justify-between items-center mb-3">
            <div className="text-sm font-bold text-foreground">תקלות פתוחות מול ספי QG</div>
            <button onClick={() => onGoTab('defects-breakdown')} className="text-xs text-primary bg-transparent border-none cursor-pointer">לפירוט ←</button>
          </div>
          {!cycleProgress ? (
            <div className="text-xs text-subtle-foreground">אין נתונים.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {SEVERITY_ORDER.map(s => {
                const q = cycleProgress.qgSummary[s.key];
                if (!q) return null;
                const over = q.count > q.threshold;
                return (
                  <div
                    key={s.key}
                    onClick={q.count > 0 ? () => setDrilldown({ filter: 'severity', value: s.label, title: `${release.relName} — תקלות פתוחות: ${s.label}` }) : undefined}
                    className={`flex items-center justify-between rounded px-2 py-1.5 ${q.count > 0 ? 'cursor-pointer hover:bg-muted' : ''}`}
                  >
                    <span className="text-xs text-foreground">{s.label}</span>
                    <span className="text-xs font-bold" style={{ color: over ? C.danger : C.success }}>
                      {q.count} <span className="font-normal text-subtle-foreground">/ סף {q.threshold}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex gap-2 flex-wrap mt-4">
            <button onClick={() => onGoTab('bug-dashboard')} className="rounded-md border border-border bg-transparent px-2.5 py-1 text-[12px] text-foreground cursor-pointer">🪲 לוח באגים</button>
            <button onClick={() => onGoTab('reopen')} className="rounded-md border border-border bg-transparent px-2.5 py-1 text-[12px] text-foreground cursor-pointer">♻️ Reopen</button>
            <button onClick={() => onGoTab('defects')} className="rounded-md border border-border bg-transparent px-2.5 py-1 text-[12px] text-foreground cursor-pointer">📋 כל התקלות</button>
          </div>
        </div>
      </div>

      {drilldown && (
        <DefectDrilldownModal
          token={token}
          screen="defects"
          filter={drilldown.filter}
          value={drilldown.value}
          endpoint={historicalDrilldownUrl(release.relId, 'defects', drilldown.filter, drilldown.value)}
          title={drilldown.title}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
};

export const QcReleaseHistoryView: React.FC<Props> = ({ token, onOpenVersion }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [releases, setReleases] = useState<QcReleaseRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<QcReleaseRow | null>(null);
  const [defects, setDefects] = useState<DefectRow[] | null>(null);
  const [defectsLoading, setDefectsLoading] = useState(false);
  // Bug Dashboard tab (2026-09-20) — reuses QcBugDashboardView in its
  // relId-direct mode (see that component's own Props comment) so a QC-only
  // historical release gets real aggregate KPI numbers/charts too, not just
  // the raw defect list this screen already showed. Quality Hub itself
  // needed no equivalent work — its own release picker is already
  // name-keyed and independent of Version (confirmed 2026-09-20).
  // Cycle Progress tab (2026-10-01, "navigate a historical release exactly
  // like any other version") — reuses CyclesPanel exactly as the manager's
  // live Cycle Progress screen does, fed by /release-intelligence/
  // historical-cycle-progress/:relId instead of the versionId-scoped
  // endpoint. Real cycle dates/QG targets/coverage/responsible-tester, all
  // sourced from Oracle by relId alone — see that endpoint's own comment for
  // exactly what is and isn't real here.
  // Overview (2026-10-01) — the release's "home page", default tab: shows
  // which release is open plus a one-screen summary linking into every other
  // tab. Cycle progress + defect breakdown are fetched on open (not lazily)
  // since the overview needs both.
  const [tab, setTab] = useState<HistoryTab>('overview');
  const [cycleProgress, setCycleProgress] = useState<CycleProgress | null>(null);
  const [cycleProgressLoading, setCycleProgressLoading] = useState(false);
  const [breakdown, setBreakdown] = useState<DefectsBreakdown | null>(null);

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
    setTab('overview');
    setDefects(null);
    setDefectsLoading(true);
    setCycleProgress(null);
    setCycleProgressLoading(true);
    setBreakdown(null);
    axios.get(`${API}/qc/defects-by-relid`, { headers, params: { relId: r.relId } })
      .then(res => setDefects(res.data ?? []))
      .catch(() => setDefects([]))
      .finally(() => setDefectsLoading(false));
    axios.get(`${API}/release-intelligence/historical-cycle-progress/${r.relId}`, { headers })
      .then(res => setCycleProgress(res.data))
      .catch(() => setCycleProgress(null))
      .finally(() => setCycleProgressLoading(false));
    axios.get(`${API}/release-intelligence/historical-defects/${r.relId}`, { headers })
      .then(res => setBreakdown(res.data))
      .catch(() => setBreakdown(null));
  };

  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const openAsVersion = () => {
    if (!selected || !onOpenVersion) return;
    setOpening(true);
    setOpenError(null);
    axios.post(`${API}/qc-releases/${selected.relId}/open-as-version`, {}, { headers })
      .then(res => onOpenVersion(res.data.id))
      .catch(e => setOpenError(e?.response?.data?.message || 'פתיחת הגרסה נכשלה'))
      .finally(() => setOpening(false));
  };

  if (selected) {
    return (
      <div className="flex flex-col gap-4 px-1 py-1" dir="rtl">
        <ReleaseHeader
          release={selected}
          onBack={() => setSelected(null)}
          onOpenAsVersion={onOpenVersion ? openAsVersion : undefined}
          opening={opening}
        />
        {openError && <div className="text-xs text-danger">{openError}</div>}

        <div className="flex gap-2 flex-wrap">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="rounded-md border px-3.5 py-1.5 text-[13px] cursor-pointer"
              style={tab === t.key ? { background: '#1D4ED8', color: '#fff', borderColor: '#1D4ED8' } : { background: 'transparent', color: JIRA.textSubtle, borderColor: JIRA.greyN40 }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <ReleaseOverview
            token={token}
            release={selected}
            cycleProgress={cycleProgress}
            cycleProgressLoading={cycleProgressLoading}
            breakdown={breakdown}
            onGoTab={setTab}
          />
        )}

        {tab === 'defects' && (
          <Card>
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
        )}

        {tab === 'bug-dashboard' && (
          <QcBugDashboardView token={token} initialRelId={selected.relId} />
        )}

        {tab === 'cycle-progress' && (
          cycleProgressLoading ? (
            <div className="text-sm text-subtle-foreground py-4 text-center">טוען התקדמות סבבים…</div>
          ) : !cycleProgress || cycleProgress.timeline.length === 0 ? (
            <div className="text-sm text-subtle-foreground py-4 text-center">אין נתוני כיסוי בדיקות זמינים ב-QC לגרסה זו.</div>
          ) : (
            <CyclesPanel data={cycleProgress} token={token} relId={selected.relId} />
          )
        )}

        {/* Same screens the manager's ניהול בדיקות module shows for a local
            Version, fed by relId (historical-defects / historical-reopen-analysis). */}
        {tab === 'defects-breakdown' && (
          <DefectsView token={token} role="" relId={selected.relId} />
        )}

        {tab === 'reopen' && (
          <ReopenAnalysisView token={token} role="" relId={selected.relId} />
        )}
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
