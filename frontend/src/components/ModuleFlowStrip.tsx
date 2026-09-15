import React from 'react';
import { C } from '../theme';

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
    <div className="flex flex-shrink-0 items-center justify-center gap-2 border-b border-border bg-muted px-6 py-2 font-sans">
      {NODES.map((node, i) => {
        const permKey = CAN_ACCESS[node.key];
        const accessible = permKey ? props[permKey] : true;
        const isActive = node.key === activeModule;
        return (
          <React.Fragment key={node.key}>
            {i > 0 && (
              <div className="mx-1 h-0 w-7 flex-shrink-0 border-t-2 border-dashed border-border" />
            )}
            <button
              onClick={() => accessible && onModuleChange(node.key)}
              disabled={!accessible}
              title={!accessible ? 'אין הרשאה למודול זה' : node.label}
              className={[
                'flex items-center gap-2 rounded-full border border-border py-1 ps-2 pe-3 font-sans',
                'transition-[opacity,border-color,background-color] duration-fast ease-out',
                accessible ? 'cursor-pointer' : 'cursor-not-allowed',
                accessible ? 'opacity-100' : 'opacity-45',
              ].join(' ')}
              style={{
                borderColor: isActive ? node.color : undefined,
                background: isActive ? `${node.color}14` : undefined,
              }}
            >
              <span
                className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full text-xs"
                style={{ background: isActive ? node.color : C.bgNested }}
              >
                {isActive ? node.icon : i + 1}
              </span>
              <span
                className={`whitespace-nowrap text-xs ${isActive ? 'font-bold' : 'font-medium'}`}
                style={{ color: isActive ? node.color : C.textSecondary }}
              >
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
