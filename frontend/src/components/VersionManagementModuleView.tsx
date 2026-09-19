import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { VersionOpeningModule, StepKey } from './VersionOpeningModule';
import { VersionOverview } from './VersionOverview';
import { VersionStatusChip } from './ui';
import { useVersionCreation } from '../hooks/useVersionCreation';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Props {
  token: string;
  versions: any[];
  selectedVersionId: string;
  onSelectVersion: (id: string) => void;
  activeView: string; // 'overview' | 'manage' | 'validate' | 'changes' | 'open' | 'approve'
  onViewChange: (v: string) => void;
  onRefreshVersions: () => void;
}

const OPEN_STATUSES = ['DRAFT', 'COLLECTING', 'CR_REVIEW', 'REFINING', 'REVIEW', 'APPROVED'];

const VIEW_TO_STEP: Record<string, StepKey> = {
  manage: 'scope',
  changes: 'manage',
  open: 'open', // landing here explicitly (e.g. from Home's "קבע תאריכי גרסה") always opens the dates step
  approve: 'approve', // jumping here from the overview's "אישור תכולה" row
};

// Version creation used to live in the deployments module (per explicit
// product decision 2026-07-27: "ניהול גרסה is not where a version gets
// created") — reversed 2026-09 now that this module exists in its own right:
// creating the bare version (picked from CR_LIST) happens HERE; the
// deployments module (VersionsView's "יצירת תוכנית הטמעה") now only fills in
// dates/phases/tasks for a version already created here.
export const VersionManagementModuleView: React.FC<Props> = ({
  token, versions, selectedVersionId, onSelectVersion, activeView, onViewChange, onRefreshVersions,
}) => {
  const headers = { Authorization: `Bearer ${token}` };
  const openVersions = versions.filter(v => !v.isArchived && OPEN_STATUSES.includes(v.status));
  const selectedVersion = versions.find(v => v.id === selectedVersionId) ?? null;
  // Hidden while VersionOverview's TARGET-defect list/detail screens are
  // open — they already show their own contextual header, so this picker
  // row is redundant clutter once drilled in that far (2026-08-30).
  const [hideVersionPicker, setHideVersionPicker] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [crListName, setCrListName] = useState('');
  const vc = useVersionCreation(token, {
    onCreated: (id) => { setShowCreate(false); setCrListName(''); onRefreshVersions(); onSelectVersion(id); },
    onListChanged: onRefreshVersions,
  });

  useEffect(() => {
    if (!selectedVersion && openVersions.length > 0) {
      onSelectVersion(openVersions[0].id);
    }
  }, [selectedVersion, openVersions]); // eslint-disable-line

  const onStatusChange = async (s: string) => {
    await axios.patch(`${API}/versions/${selectedVersionId}/status`, { status: s }, { headers });
    onRefreshVersions();
  };

  return (
    <div className="[direction:rtl]">
      {/* ── Version picker ── */}
      {!hideVersionPicker && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedVersionId}
              onChange={e => onSelectVersion(e.target.value)}
              className="min-w-[220px] rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
            >
              <option value="">בחר גרסה...</option>
              {openVersions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            {selectedVersion && <VersionStatusChip status={selectedVersion.status} size="md" />}
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="cursor-pointer rounded-md border-none bg-primary px-3.5 py-2 text-sm font-bold text-white"
          >
            + יצירת גרסה
          </button>
        </div>
      )}

      {showCreate && (
        <div className="mb-4 rounded-lg border-2 border-dashed border-border bg-card p-4">
          <div className="mb-2.5 text-[15px] font-bold text-foreground">יצירת גרסה חדשה — בחירה מ-CR_LIST</div>
          {vc.futureVersionNames.length === 0 ? (
            <div className="text-sm text-subtle-foreground">אין שמות גרסה עתידיים ב-CR_LIST שעדיין לא נוצרו כגרסה.</div>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={crListName}
                onChange={e => setCrListName(e.target.value)}
                className="min-w-[220px] rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground"
              >
                <option value="">בחר שם גרסה...</option>
                {vc.futureVersionNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <button
                onClick={() => vc.createFromCrListName(crListName)}
                disabled={!crListName || vc.creatingMinimal}
                className={`rounded-md border-none px-4 py-2 text-sm font-bold text-white ${!crListName || vc.creatingMinimal ? 'cursor-not-allowed bg-subtle-foreground' : 'cursor-pointer bg-primary'}`}
              >
                {vc.creatingMinimal ? '⏳ יוצר...' : 'צור גרסה'}
              </button>
              <button onClick={() => { setShowCreate(false); setCrListName(''); }} className="cursor-pointer rounded-md border border-border bg-transparent px-3 py-2 text-sm text-muted-foreground">
                ביטול
              </button>
            </div>
          )}
          {vc.actionError && <div className="mt-2 text-sm text-danger">⚠️ {vc.actionError}</div>}
        </div>
      )}

      {!selectedVersion ? (
        <div className="p-10 text-center text-subtle-foreground">
          {openVersions.length === 0 ? 'אין גרסאות פתוחות — לחץ "+ יצירת גרסה" למעלה כדי להתחיל.' : 'בחר גרסה מהרשימה.'}
        </div>
      ) : activeView === 'overview' ? (
        <VersionOverview
          version={selectedVersion}
          token={token}
          onJumpToStep={onViewChange}
          onDrilledInChange={setHideVersionPicker}
        />
      ) : (
        <VersionOpeningModule
          version={selectedVersion}
          token={token}
          isManager={true}
          onRefresh={onRefreshVersions}
          onStatusChange={onStatusChange}
          focusStep={VIEW_TO_STEP[activeView]}
        />
      )}
    </div>
  );
};
