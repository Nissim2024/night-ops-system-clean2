import React, { useEffect } from 'react';
import axios from 'axios';
import { VersionOpeningModule, StepKey } from './VersionOpeningModule';
import { VersionOverview } from './VersionOverview';
import { C, FONT, WEIGHT, RADIUS } from '../theme';
import { VersionStatusChip } from './ui';

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

// Version creation lives in the deployments module (VersionsView's "יצירת
// תוכנית הטמעה") — this module only manages versions that already exist, per
// explicit product decision (2026-07-27): "ניהול גרסה" is not where a version
// gets created.
export const VersionManagementModuleView: React.FC<Props> = ({
  token, versions, selectedVersionId, onSelectVersion, activeView, onViewChange, onRefreshVersions,
}) => {
  const headers = { Authorization: `Bearer ${token}` };
  const openVersions = versions.filter(v => !v.isArchived && OPEN_STATUSES.includes(v.status));
  const selectedVersion = versions.find(v => v.id === selectedVersionId) ?? null;

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
    <div style={{ fontFamily: FONT, direction: 'rtl' }}>
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
      </div>

      {!selectedVersion ? (
        <div style={{ color: C.textMuted, padding: '40px', textAlign: 'center' }}>
          {openVersions.length === 0 ? 'אין גרסאות פתוחות — ניתן ליצור תוכנית הטמעה חדשה במודול הטמעות.' : 'בחר גרסה מהרשימה.'}
        </div>
      ) : activeView === 'overview' ? (
        <VersionOverview
          version={selectedVersion}
          token={token}
          onJumpToStep={onViewChange}
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
