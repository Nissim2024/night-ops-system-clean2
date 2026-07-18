import React from 'react';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, EASE } from '../theme';

// Slim chronological "process flow" strip across the top of the app — shows
// how the 4 top-level modules relate to each other in the real release
// workflow (open the version → plan QA → track testing / plan go-live →
// analyze quality afterward), so the module switcher in Sidebar reads as a
// sequence, not just an unordered tab list. Purely a navigation aid: clicking
// a node calls the same onModuleChange used by Sidebar — no new screens/logic.

type ModuleKey = 'version-management' | 'qa' | 'deployments' | 'release-intelligence' | 'quality-hub';

interface FlowNode {
  key: ModuleKey;
  label: string;
  icon: string;
  color: string;
}

const NODES: FlowNode[] = [
  { key: 'version-management',   label: 'ניהול גרסה',  icon: '🧭', color: C.moduleRelease },
  { key: 'qa',                   label: 'ניהול QA',    icon: '👥', color: C.moduleTestPlan },
  { key: 'deployments',          label: 'הטמעות',      icon: '🌙', color: C.moduleGoLive },
  { key: 'release-intelligence', label: 'ניהול בדיקות', icon: '🧠', color: C.moduleTracking },
  { key: 'quality-hub',          label: 'איכות גרסה',  icon: '🏆', color: C.moduleAnalytics },
];

interface Props {
  // null while on the cross-module Home dashboard — it isn't "inside" any
  // single module, so nothing in the strip should read as active there.
  activeModule: ModuleKey | null;
  onModuleChange: (m: ModuleKey) => void;
  canAccessVersionManagement: boolean;
  canAccessQa: boolean;
  canAccessReleaseIntelligence: boolean;
  canAccessQualityHub: boolean;
}

const CAN_ACCESS: Record<ModuleKey, keyof Omit<Props, 'activeModule' | 'onModuleChange'> | null> = {
  'version-management': 'canAccessVersionManagement',
  'qa': 'canAccessQa',
  'deployments': null,
  'release-intelligence': 'canAccessReleaseIntelligence',
  'quality-hub': 'canAccessQualityHub',
};

export const ModuleFlowStrip: React.FC<Props> = (props) => {
  const { activeModule, onModuleChange } = props;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SP[2],
      padding: `${SP[2]} ${SP[6]}`, background: C.bgNested, borderBottom: `1px solid ${C.border}`,
      flexShrink: 0, fontFamily: FONT,
    }}>
      {NODES.map((node, i) => {
        const permKey = CAN_ACCESS[node.key];
        const accessible = permKey ? props[permKey] : true;
        const isActive = node.key === activeModule;
        return (
          <React.Fragment key={node.key}>
            {i > 0 && (
              <div style={{
                width: '28px', height: 0, borderTop: `2px dashed ${C.border}`,
                margin: `0 ${SP[1]}`, flexShrink: 0,
              }} />
            )}
            <button
              onClick={() => accessible && onModuleChange(node.key)}
              disabled={!accessible}
              title={!accessible ? 'אין הרשאה למודול זה' : node.label}
              style={{
                display: 'flex', alignItems: 'center', gap: SP[2],
                padding: `${SP[1]} ${SP[3]} ${SP[1]} ${SP[2]}`,
                borderRadius: RADIUS.full, border: `1.5px solid ${isActive ? node.color : C.border}`,
                background: isActive ? `${node.color}14` : C.bgCard,
                cursor: accessible ? 'pointer' : 'not-allowed',
                opacity: accessible ? 1 : 0.45,
                transition: EASE.fast,
                fontFamily: FONT,
              }}
            >
              <span style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '22px', height: '22px', borderRadius: '50%',
                background: isActive ? node.color : C.bgNested,
                fontSize: '12px', flexShrink: 0,
              }}>
                {isActive ? node.icon : i + 1}
              </span>
              <span style={{
                ...TEXT.xs, fontWeight: isActive ? WEIGHT.bold : WEIGHT.medium,
                color: isActive ? node.color : C.textSecondary, whiteSpace: 'nowrap',
              }}>
                {node.label}
              </span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default ModuleFlowStrip;
