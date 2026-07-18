import React, { useEffect } from 'react';
import axios from 'axios';
import { VersionOpeningModule, StepKey } from './VersionOpeningModule';
import { VersionWizard } from './VersionWizard';
import { useVersionCreation } from '../hooks/useVersionCreation';
import { C, FONT, WEIGHT, RADIUS } from '../theme';
import { VersionStatusChip } from './ui';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Props {
  token: string;
  versions: any[];
  selectedVersionId: string;
  onSelectVersion: (id: string) => void;
  activeView: string; // 'create' | 'manage' | 'validate' | 'changes'
  onViewChange: (v: string) => void;
  onRefreshVersions: () => void;
}

const OPEN_STATUSES = ['DRAFT', 'COLLECTING', 'CR_REVIEW', 'REFINING', 'REVIEW', 'APPROVED'];

const VIEW_TO_STEP: Record<string, StepKey> = {
  manage: 'scope',
  changes: 'manage',
};

export const VersionManagementModuleView: React.FC<Props> = ({
  token, versions, selectedVersionId, onSelectVersion, activeView, onViewChange, onRefreshVersions,
}) => {
  const headers = { Authorization: `Bearer ${token}` };
  const openVersions = versions.filter(v => !v.isArchived && OPEN_STATUSES.includes(v.status));
  const selectedVersion = versions.find(v => v.id === selectedVersionId) ?? null;

  useEffect(() => {
    if (activeView !== 'create' && !selectedVersion && openVersions.length > 0) {
      onSelectVersion(openVersions[0].id);
    }
  }, [activeView, selectedVersion, openVersions]); // eslint-disable-line

  // Same creation wizard (manual / from-template / Excel-import) used by
  // VersionsView's "+ גרסה חדשה" — kept in sync via the shared hook.
  const vc = useVersionCreation(token, {
    onListChanged: onRefreshVersions,
    onCreated: (versionId) => {
      if (versionId) onSelectVersion(versionId);
      onViewChange('manage');
    },
  });

  const onStatusChange = async (s: string) => {
    await axios.patch(`${API}/versions/${selectedVersionId}/status`, { status: s }, { headers });
    onRefreshVersions();
  };

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl' }}>
      {activeView === 'create' && (
        <VersionWizard
          newVersion={vc.newVersion}
          setNewVersion={vc.setNewVersion}
          qcReleases={vc.qcReleases}
          templates={vc.templates}
          selectedTemplateId={vc.selectedTemplateId}
          setSelectedTemplateId={vc.setSelectedTemplateId}
          importFile={vc.importFile}
          setImportFile={vc.setImportFile}
          onPlannedStartChange={vc.handlePlannedStartChange}
          onCreateEmpty={vc.createEmpty}
          onCreateFromTemplate={vc.createFromTemplate}
          onImportFromFile={vc.importFromFile}
          creatingTemplate={vc.creatingTemplate}
          creatingFromTemplate={vc.creatingFromTemplate}
          importing={vc.importing}
          actionError={vc.actionError}
          setActionError={vc.setActionError}
          onClose={() => { vc.reset(); onViewChange('manage'); }}
        />
      )}

      {/* ── Version picker ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select
          value={selectedVersionId}
          onChange={e => onSelectVersion(e.target.value)}
          style={{ padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, fontSize: '15px', fontFamily: FONT, background: C.bgCard, minWidth: '220px' }}
        >
          <option value="">בחר גרסה...</option>
          {openVersions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        {selectedVersion && <VersionStatusChip status={selectedVersion.status} size="md" />}
        <button onClick={() => onViewChange('create')} style={{ padding: '8px 16px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '14px', fontWeight: WEIGHT.semibold }}>
          ➕ גרסה חדשה
        </button>
      </div>

      {!selectedVersion ? (
        <div style={{ color: C.textMuted, padding: '40px', textAlign: 'center' }}>
          {openVersions.length === 0 ? 'אין גרסאות פתוחות — צור גרסה חדשה כדי להתחיל.' : 'בחר גרסה מהרשימה.'}
        </div>
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
