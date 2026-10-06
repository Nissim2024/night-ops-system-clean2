import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Card } from './ui';
import { DefectDetailScreen } from './quality-hub/OpenProdDefectsView';
import { CreateDefectScreen } from './quality-hub/CreateDefectScreen';
import { DefectDrilldownModal } from './release-intelligence/DefectDrilldownModal';
import { DefectsInvestigationDashboard } from './defects/DefectsInvestigationDashboard';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Props { token: string; role: string; initialRelease?: string; }

// Investigation dashboard (2026-10-06): the old KPI tiles / 6 breakdown
// panels / monthly chart were replaced by defects/DefectsInvestigationDashboard
// (dynamic "הצג לפי" chart, trend+backlog, aging, heat map, top 10, critical
// table, per-user pinned charts).
// General, cross-version defects module (2026-09-22, user request): "looks
// like Bug Dashboard, but ALL defects, not just open ones, with topic charts,
// create + update". Deliberately no version/release scope at all (unlike
// QcBugDashboardView, which is one version's open defects) — this is the
// system-wide counterpart, closer in spirit to Quality Hub's "Open Prod
// Defects" screen but laid out as a KPI+breakdown dashboard instead of a
// table. Reuses CreateDefectScreen/DefectDetailScreen so create+update behave
// identically everywhere else in the app already does.
export const DefectsHubView: React.FC<Props> = ({ token, role, initialRelease }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [qcMock, setQcMock] = useState(true);
  // versionId omitted → DefectDrilldownModal's cross-version / id-list modes.
  const [drilldown, setDrilldown] = useState<{ filter: string; value: string; title: string; search?: string; idList?: string[] } | null>(null);
  // Remount key for the dashboard after a defect was created here.
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [selectedDefectId, setSelectedDefectId] = useState<string | null>(null);
  const [showCreateScreen, setShowCreateScreen] = useState(false);

  useEffect(() => {
    axios.get(`${API}/qc/status`, { headers }).then(r => setQcMock(!r.data?.enabled)).catch(() => setQcMock(true));
  }, [headers]);

  const closeDrilldown = () => setDrilldown(null);

  if (showCreateScreen) {
    return (
      <CreateDefectScreen
        token={token}
        onBack={() => setShowCreateScreen(false)}
        onCreated={(id) => { setShowCreateScreen(false); setReloadKey(k => k + 1); setSelectedDefectId(id); }}
      />
    );
  }

  if (selectedDefectId) {
    return (
      <DefectDetailScreen
        defectId={selectedDefectId}
        detailFields={[]}
        token={token}
        onBack={() => setSelectedDefectId(null)}
      />
    );
  }

  if (drilldown) {
    return (
      <DefectDrilldownModal
        token={token}
        screen=""
        filter={drilldown.filter}
        value={drilldown.value}
        title={drilldown.title}
        crossVersion={{ search: drilldown.search }}
        idList={drilldown.idList}
        onClose={closeDrilldown}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 px-7 py-5">
      <Card>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[22px]">🐞</span>
          <div className="text-lg font-bold text-foreground">מודול תקלות</div>
          <div className="text-xs text-subtle-foreground">דאשבורד ניהול ותחקור — כל התקלות, כל הגרסאות</div>
          {qcMock && (
            <span className="rounded-[10px] border border-warning/30 bg-warning-bg px-2.5 py-0.5 text-sm text-warning">Mock — ממתין לחיבור QC</span>
          )}
          <form className="mr-auto flex items-center gap-1.5"
            onSubmit={e => { e.preventDefault(); if (search.trim()) setDrilldown({ filter: '__kpi__', value: 'total', title: `חיפוש: ${search.trim()}`, search: search.trim() }); }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="חיפוש תקלה: מספר או טקסט"
              className="w-[220px] rounded-md border border-border bg-card px-2 py-1 text-xs" />
            <button type="submit" className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs">🔍 חפש</button>
          </form>
          <button
            onClick={() => setShowCreateScreen(true)}
            className="cursor-pointer rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground"
          >
            + תקלה חדשה ב-QC
          </button>
        </div>
      </Card>

      <DefectsInvestigationDashboard
        key={reloadKey}
        token={token}
        role={role}
        initialRelease={initialRelease}
        onDrill={(title, ids) => setDrilldown({ filter: '__ids__', value: '', title, idList: ids })}
        onOpenDefect={setSelectedDefectId}
      />
    </div>
  );
};
