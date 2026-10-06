import React, { useState } from 'react';
import { C } from '../theme';
import { cn } from '../lib/utils';
import pkg from '../../package.json';
import { VersionSwitcher } from './shared/VersionSwitcher';
import { usePermissions } from '../context/PermissionsContext';
const APP_VERSION: string = pkg.version;

export interface DeployMenuItem { key: string; label: string; icon: string; enabled: boolean; reason?: string; pulse?: boolean }
export interface DeployMenuGroup { id: string; label: string; current?: boolean; items: DeployMenuItem[] }

interface Props {
  versions?: any[];
  selectedVersionId?: string;
  onVersionChange?: (id: string) => void;
  myTasksActive?: boolean;
  onMyTasksClick?: () => void;
  showAdmin?: boolean;
  onAdminClick?: () => void;
  activeTab?: string;
  versionFilter?: string;
  onVersionFilterChange?: (f: any) => void;
  // ── Module switcher ──────────────────────────────────────────────────
  activeModule?: 'home' | 'admin' | 'version-management' | 'deployments' | 'qa' | 'release-intelligence' | 'quality-hub' | 'defects';
  onModuleChange?: (m: 'version-management' | 'deployments' | 'qa' | 'release-intelligence' | 'quality-hub' | 'defects') => void;
  activeVmView?: string;
  onVmViewChange?: (v: string) => void;
  canAccessVersionManagement?: boolean;
  activeQaView?: string;
  onQaViewChange?: (v: string) => void;
  canAccessQa?: boolean;
  activeRiView?: string;
  onRiViewChange?: (v: string) => void;
  canAccessReleaseIntelligence?: boolean;
  activeQhView?: string;
  onQhViewChange?: (v: string) => void;
  canAccessQualityHub?: boolean;
  canAccessDefects?: boolean;
  canAccessDeployments?: boolean;
  deployMenu?: DeployMenuGroup[];
  onDeployTabChange?: (tab: string) => void;
  deployActiveKey?: string;   // 'list' (module entry) maps to the item it shows
  // ── Leaves (visible to all employees) ────────────────────────────────
  showLeaves?: boolean;
  leavesActive?: boolean;
  onLeavesClick?: () => void;
  onHomeClick?: () => void;
}

const IS_TEST = process.env.REACT_APP_ENV === 'test';


export const QA_VIEWS = [
  { key: 'assignment', label: 'תכנון ושיבוץ',         icon: '🎯' },
  { key: 'testers',    label: 'בודקים',              icon: '👥' },
  { key: 'skills',     label: 'מטריצת סקילים',        icon: '🧠' },
  { key: 'leaves',     label: 'חופשות',               icon: '📅' },
];

export const VM_VIEWS = [
  { key: 'overview', label: 'סקירה כללית',      icon: '📊' },
  { key: 'manage',   label: 'ניהול תכולה',      icon: '📋' },
  { key: 'changes',  label: 'ניהול שינויים',    icon: '🔄' },
];

// Trimmed 2026-09-07: removed סקירה כללית / באגים / לוח מצב (duplicated by the
// Home page & bug-dashboard) and בריאות CR / קיבולת / תחזית ומעקב / התראות ותובנות
// (thin readouts covered by cycle-progress / QA work-plan / the Home strip).
// The backing endpoints (overview, status-board, …) are still used by the Home
// view; only the standalone screens were dropped.
export const RI_VIEWS = [
  { key: 'home', label: 'דף הבית', icon: '🏠' },
  { key: 'risks', label: 'ניהול סיכונים', icon: '⚠️' },
  { key: 'suggested-risks', label: 'הצעות סיכונים (AI)', icon: '💡' },
  { key: 'daily-qa', label: 'ניהול QA יומי', icon: '📋' },
  { key: 'coverage-readiness', label: 'כיסוי ומוכנות', icon: '✅' },
  { key: 'bug-dashboard', label: 'לוח באגים (QC)', icon: '🐞' },
  { key: 'timeline-activities', label: 'ציר זמן ופעילויות', icon: '🗓️' },
  { key: 'incidents', label: 'תקלות ו-RCA', icon: '🧯' },
];

export const QH_VIEWS = [
  { key: 'overview', label: 'סקירה כללית', icon: '📊' },
  { key: 'kpi-matrix', label: 'מטריצת KPI', icon: '📋' },
  { key: 'comparison', label: 'השוואת גרסאות', icon: '⚖️' },
  { key: 'timeline', label: 'ציר זמן איכות', icon: '📈' },
  { key: 'kpi-config', label: 'הגדרות KPI', icon: '⚙️' },
  { key: 'improvement-tracking', label: 'משימות שיפור', icon: '✅' },
  { key: 'open-prod-defects', label: 'תקלות ייצור פתוחות', icon: '📆' },
  { key: 'new-vs-target-defects', label: 'יחס תקלות חדשות ביצור', icon: '📈' },
  { key: 'qc-release-history', label: 'עיון בגרסאות QC', icon: '🗄️' },
];


// Version-wide chronological label + colour for the quick picker — the
// lifecycle phase when available, else the deployment-night status.

export const Sidebar: React.FC<Props> = ({
  versions = [], selectedVersionId, onVersionChange,
  myTasksActive, onMyTasksClick,
  showAdmin, onAdminClick,
  activeTab,
  activeModule = 'deployments',
  onModuleChange,
  activeVmView = 'overview',
  onVmViewChange,
  canAccessVersionManagement = false,
  activeQaView = 'testers',
  onQaViewChange,
  canAccessQa = false,
  activeRiView = 'home',
  onRiViewChange,
  canAccessReleaseIntelligence = false,
  activeQhView = 'overview',
  onQhViewChange,
  canAccessQualityHub = false,
  canAccessDefects = false,
  canAccessDeployments = true,
  deployMenu = [],
  onDeployTabChange,
  deployActiveKey,
  showLeaves = false,
  leavesActive = false,
  onLeavesClick,
  onHomeClick,
}) => {
  // each module's screens filtered by their own permission (catalog keys vm:/qa:/ri:/qh:)
  const { can } = usePermissions();
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);



  const isVm          = activeModule === 'version-management';
  const isDeployments = activeModule === 'deployments';
  const isQa          = activeModule === 'qa';
  const isRi           = activeModule === 'release-intelligence';
  const isQh           = activeModule === 'quality-hub';
  const isDefects      = activeModule === 'defects';

  return (
    <div
      className="flex w-[280px] min-w-[280px] flex-col overflow-y-auto"
      style={{ background: C.sidebarBg, borderLeft: `1px solid ${C.sidebarBorder}` }}
    >

      {IS_TEST && (
        <div
          className="mx-3 mt-3 rounded-md px-2 py-1.5 text-center text-sm font-bold uppercase tracking-[0.08em]"
          style={{ background: 'rgba(232,175,0,0.15)', border: '1px solid rgba(232,175,0,0.30)', color: '#d4a017' }}
        >⚡ TEST</div>
      )}

      {/* ─── Module switcher ─── */}
      {(canAccessVersionManagement || canAccessQa || canAccessReleaseIntelligence || canAccessQualityHub || canAccessDefects) && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
          {[
            { key: 'version-management' as const, label: 'ניהול גרסה',  icon: '🧭', active: isVm,          show: canAccessVersionManagement },
            { key: 'qa' as const,                  label: 'ניהול QA',    icon: '👥', active: isQa,          show: canAccessQa },
            { key: 'deployments' as const,         label: 'הטמעות',      icon: '🌙', active: isDeployments, show: canAccessDeployments },
            { key: 'release-intelligence' as const, label: 'ניהול בדיקות', icon: '🧠', active: isRi,        show: canAccessReleaseIntelligence },
            { key: 'quality-hub' as const,         label: 'איכות גרסה',  icon: '🏆', active: isQh,          show: canAccessQualityHub },
            { key: 'defects' as const,             label: 'תקלות',       icon: '🐞', active: isDefects,     show: canAccessDefects },
          ].filter(m => m.show).map(m => (
            <button
              key={m.key}
              onClick={() => onModuleChange?.(m.key)}
              className="flex min-w-[78px] flex-1 basis-[30%] cursor-pointer flex-col items-center gap-1 rounded-md px-1.5 py-2 transition-[background] duration-fast ease-out"
              style={{
                background: m.active ? C.sidebarBgActive : 'transparent',
                border: m.active ? '1px solid rgba(255,255,255,0.12)' : `1px solid ${C.sidebarBorder}`,
              }}
              onMouseEnter={e => { if (!m.active) e.currentTarget.style.background = C.sidebarBgHover; }}
              onMouseLeave={e => { if (!m.active) e.currentTarget.style.background = 'transparent'; }}
            >
              <span className="text-base leading-none">{m.icon}</span>
              <span
                className={cn('text-[13px] leading-none', m.active ? 'font-semibold' : 'font-medium')}
                style={{ color: m.active ? C.sidebarText : 'rgba(255,255,255,0.55)' }}
              >{m.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Quick version switcher — button opens a small modal picker; switch
           versions from any screen in one click, no round-trip to Home
           (spec 2026-09-07 §4; button+modal redesign 2026-09-08). Extracted
           to shared/VersionSwitcher.tsx (2026-09-29) so EmployeeDashboard can
           reuse the exact same component instead of employees having no way
           to switch versions at all. ── */}
      {onVersionChange && versions.length > 0 && (
        <VersionSwitcher versions={versions} selectedVersionId={selectedVersionId} onVersionChange={onVersionChange} />
      )}

      {/* ── Home button — always visible, module-neutral (2026-09-25:
           decoupled from Deployments — was checking activeTab==='home' &&
           activeModule==='deployments', which no longer holds now that Home
           is its own activeModule value) ── */}
      {onHomeClick && (
        <div
          onClick={onHomeClick}
          className="mt-2 flex cursor-pointer items-center gap-2.5 px-3 py-2.5 transition-[background] duration-fast ease-out"
          style={{
            background: activeModule === 'home' ? C.sidebarBgActive : 'transparent',
            borderRight: activeModule === 'home' ? `3px solid ${C.sidebarAccent}` : '3px solid transparent',
          }}
          onMouseEnter={e => { if (activeModule !== 'home') (e.currentTarget as HTMLElement).style.background = C.sidebarBgHover; }}
          onMouseLeave={e => { if (activeModule !== 'home') (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          <span className="text-base leading-none">🏠</span>
          <span
            className={cn('text-sm', activeModule === 'home' ? 'font-semibold' : 'font-medium')}
            style={{ color: activeModule === 'home' ? C.sidebarText : 'rgba(255,255,255,0.78)' }}
          >
            דף הבית
          </span>
        </div>
      )}

      {/* ─── Deployments: גרסאות — hidden on the Home tab, which is a cross-module
           landing page, not a Deployments sub-screen; only the module switcher
           and Home link should show there ─── */}
      {/* הטמעות menu (2026-10-05): the module's screens grouped by work
          stage, for the version picked in the picker above - replaces a
          version list that duplicated the picker. Screens of other stages
          stay visible but disabled, with when they open. */}
      {isDeployments && activeTab !== 'home' && deployMenu.length > 0 && (
        <div className="flex flex-col gap-0.5 px-3 pt-3">
          {deployMenu.map(group => (
            <div key={group.id} className="flex flex-col gap-0.5">
              {group.label && (
                <div className="flex items-center gap-1.5 px-2 pb-1 pt-2.5 text-[13px] font-bold uppercase tracking-[0.08em]"
                  style={{ color: group.current ? C.sidebarText : 'rgba(255,255,255,0.35)' }}>
                  {group.label}
                  {group.current && <span className="rounded-full px-1.5 text-[10px] normal-case tracking-normal" style={{ background: 'rgba(255,255,255,0.14)' }}>השלב הנוכחי</span>}
                </div>
              )}
              {group.items.map(item => {
                const isActive = (deployActiveKey ?? activeTab) === item.key;
                const isHov = hoveredItem === `dep-${item.key}`;
                return (
                  <button key={item.key}
                    disabled={!item.enabled}
                    title={!item.enabled ? item.reason : undefined}
                    onClick={() => item.enabled && onDeployTabChange?.(item.key)}
                    onMouseEnter={() => setHoveredItem(`dep-${item.key}`)}
                    onMouseLeave={() => setHoveredItem(null)}
                    className={cn('flex w-full items-center gap-2.5 rounded-md border-none px-2.5 py-2 text-right transition-[background] duration-fast ease-out',
                      item.enabled ? 'cursor-pointer' : 'cursor-default')}
                    style={{
                      background: isActive ? C.sidebarBgActive : isHov && item.enabled ? C.sidebarBgHover : 'transparent',
                      opacity: item.enabled ? 1 : 0.4,
                    }}
                  >
                    <span className="shrink-0 text-base leading-none">{item.icon}</span>
                    <span className={cn('flex-1 text-sm', isActive ? 'font-semibold' : 'font-medium')}
                      style={{ color: isActive ? C.sidebarText : 'rgba(255,255,255,0.78)' }}>
                      {item.label}
                    </span>
                    {item.pulse && item.enabled && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full" style={{ background: C.danger }} />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* ─── Version Management Module nav ─── */}
      {isVm && canAccessVersionManagement && (
        <div className="flex flex-col gap-0.5 px-3 pt-3">
          <div className="px-2 pb-1 pt-1.5 text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            ניהול גרסה
          </div>
          {VM_VIEWS.filter(v => can(`vm:${v.key}`)).map(view => {
            // 'open' / 'approve' are step jumps inside ניהול תכולה
            const isActive = activeVmView === view.key || (view.key === 'manage' && ['open', 'approve'].includes(activeVmView));
            const isHov    = hoveredItem === view.key;
            return (
              <button key={view.key}
                onClick={() => onVmViewChange?.(view.key)}
                onMouseEnter={() => setHoveredItem(view.key)}
                onMouseLeave={() => setHoveredItem(null)}
                className="relative flex w-full items-center gap-2.5 overflow-hidden rounded-lg px-2 py-2.5 text-right transition-[background] duration-fast ease-out [direction:rtl]"
                style={{
                  background: isActive ? C.sidebarBgActive : isHov ? C.sidebarBgHover : 'transparent',
                  border: isActive ? '1px solid rgba(255,255,255,0.12)' : '1px solid transparent',
                }}>
                {isActive && (
                  <div className="absolute bottom-[15%] top-[15%] start-0 w-[3px] rounded-s-[3px] rounded-e-none" style={{ background: C.brand, boxShadow: `0 0 8px ${C.brand}80` }} />
                )}
                <span className="shrink-0 text-lg leading-none">{view.icon}</span>
                <span
                  className={cn('flex-1 text-sm', isActive ? 'font-semibold' : 'font-medium')}
                  style={{ color: isActive ? C.sidebarText : 'rgba(255,255,255,0.78)' }}
                >
                  {view.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── QA Module nav ─── */}
      {isQa && canAccessQa && (
        <div className="flex flex-col gap-0.5 px-3 pt-3">
          <div className="px-2 pb-1 pt-1.5 text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            ניהול QA
          </div>
          {QA_VIEWS.filter(v => can(`qa:${v.key}`)).map(view => {
            const isActive = activeQaView === view.key;
            const isHov    = hoveredItem === view.key;
            return (
              <button key={view.key}
                onClick={() => onQaViewChange?.(view.key)}
                onMouseEnter={() => setHoveredItem(view.key)}
                onMouseLeave={() => setHoveredItem(null)}
                className="relative flex w-full items-center gap-2.5 overflow-hidden rounded-lg px-2 py-2.5 text-right transition-[background] duration-fast ease-out [direction:rtl]"
                style={{
                  background: isActive ? C.sidebarBgActive : isHov ? C.sidebarBgHover : 'transparent',
                  border: isActive ? '1px solid rgba(255,255,255,0.12)' : '1px solid transparent',
                }}>
                {isActive && (
                  <div className="absolute bottom-[15%] top-[15%] start-0 w-[3px] rounded-s-[3px] rounded-e-none" style={{ background: C.brand, boxShadow: `0 0 8px ${C.brand}80` }} />
                )}
                <span className="shrink-0 text-lg leading-none">{view.icon}</span>
                <span
                  className={cn('flex-1 text-sm', isActive ? 'font-semibold' : 'font-medium')}
                  style={{ color: isActive ? C.sidebarText : 'rgba(255,255,255,0.78)' }}
                >
                  {view.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── Release Intelligence Module nav ─── */}
      {isRi && canAccessReleaseIntelligence && (
        <div className="flex flex-col gap-0.5 px-3 pt-3">
          <div className="px-2 pb-1 pt-1.5 text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            ניהול בדיקות
          </div>
          {RI_VIEWS.filter(v => can(`ri:${v.key}`)).map(view => {
            const isActive = activeRiView === view.key;
            const isHov    = hoveredItem === view.key;
            return (
              <button key={view.key}
                onClick={() => onRiViewChange?.(view.key)}
                onMouseEnter={() => setHoveredItem(view.key)}
                onMouseLeave={() => setHoveredItem(null)}
                className="relative flex w-full items-center gap-2.5 overflow-hidden rounded-lg px-2 py-2.5 text-right transition-[background] duration-fast ease-out [direction:rtl]"
                style={{
                  background: isActive ? C.sidebarBgActive : isHov ? C.sidebarBgHover : 'transparent',
                  border: isActive ? '1px solid rgba(255,255,255,0.12)' : '1px solid transparent',
                }}>
                {isActive && (
                  <div className="absolute bottom-[15%] top-[15%] start-0 w-[3px] rounded-s-[3px] rounded-e-none" style={{ background: C.brand, boxShadow: `0 0 8px ${C.brand}80` }} />
                )}
                <span className="shrink-0 text-lg leading-none">{view.icon}</span>
                <span
                  className={cn('flex-1 text-sm', isActive ? 'font-semibold' : 'font-medium')}
                  style={{ color: isActive ? C.sidebarText : 'rgba(255,255,255,0.78)' }}
                >
                  {view.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── Quality Hub Module nav ─── */}
      {isQh && canAccessQualityHub && (
        <div className="flex flex-col gap-0.5 px-3 pt-3">
          <div className="px-2 pb-1 pt-1.5 text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Quality Hub
          </div>
          {QH_VIEWS.filter(v => can(`qh:${v.key}`)).map(view => {
            const isActive = activeQhView === view.key;
            const isHov    = hoveredItem === view.key;
            return (
              <button key={view.key}
                onClick={() => onQhViewChange?.(view.key)}
                onMouseEnter={() => setHoveredItem(view.key)}
                onMouseLeave={() => setHoveredItem(null)}
                className="relative flex w-full items-center gap-2.5 overflow-hidden rounded-lg px-2 py-2.5 text-right transition-[background] duration-fast ease-out [direction:rtl]"
                style={{
                  background: isActive ? C.sidebarBgActive : isHov ? C.sidebarBgHover : 'transparent',
                  border: isActive ? '1px solid rgba(255,255,255,0.12)' : '1px solid transparent',
                }}>
                {isActive && (
                  <div className="absolute bottom-[15%] top-[15%] start-0 w-[3px] rounded-s-[3px] rounded-e-none" style={{ background: C.brand, boxShadow: `0 0 8px ${C.brand}80` }} />
                )}
                <span className="shrink-0 text-lg leading-none">{view.icon}</span>
                <span
                  className={cn('flex-1 text-sm', isActive ? 'font-semibold' : 'font-medium')}
                  style={{ color: isActive ? C.sidebarText : 'rgba(255,255,255,0.78)' }}
                >
                  {view.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── חופשות (standalone — only when not in QA module which already has it) ─── */}
      {showLeaves && !isQa && (
        <div className="px-3 pt-2">
          <button
            onClick={onLeavesClick}
            onMouseEnter={() => setHoveredItem('leaves-standalone')}
            onMouseLeave={() => setHoveredItem(null)}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2.5 text-right transition-[background] duration-fast ease-out [direction:rtl]"
            style={{
              background: leavesActive ? 'rgba(75,192,120,0.15)' : hoveredItem === 'leaves-standalone' ? C.sidebarBgHover : 'transparent',
              border: leavesActive ? '1px solid rgba(75,192,120,0.35)' : '1px solid transparent',
            }}>
            <span className="shrink-0 text-lg">📅</span>
            <span
              className={cn('flex-1 text-sm', leavesActive ? 'font-semibold' : 'font-medium')}
              style={{ color: leavesActive ? '#7ee8a2' : 'rgba(255,255,255,0.78)' }}
            >
              חופשות
            </span>
            {leavesActive && (
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: '#7ee8a2' }} />
            )}
          </button>
        </div>
      )}

      <div className="flex-1" />

      {/* ─── Admin ─── */}
      {showAdmin && (
        <>
          <div className="mx-3 my-2 h-px" style={{ background: C.sidebarBorder }} />
          <div className="px-3 pb-2">
            <button onClick={onAdminClick}
              onMouseEnter={() => setHoveredItem('admin')}
              onMouseLeave={() => setHoveredItem(null)}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2.5 text-right transition-[background] duration-fast ease-out [direction:rtl]"
              style={{
                background: activeTab === 'admin' ? C.sidebarBgActive : hoveredItem === 'admin' ? C.sidebarBgHover : 'transparent',
                border: activeTab === 'admin' ? '1px solid rgba(255,255,255,0.12)' : '1px solid transparent',
              }}>
              <span className="shrink-0 text-lg">⚙️</span>
              <span
                className="flex-1 text-sm font-medium"
                style={{ color: activeTab === 'admin' ? C.sidebarText : 'rgba(255,255,255,0.78)' }}
              >
                ניהול
              </span>
            </button>
          </div>
        </>
      )}

      {/* ─── Footer ─── */}
      <div
        className="flex items-center gap-2 border-t px-3 py-2 text-sm"
        style={{ borderColor: C.sidebarBorder, color: 'rgba(255,255,255,0.35)' }}
      >
        <div className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: C.success, boxShadow: `0 0 4px ${C.success}80` }} />
        <span>DeployCenter v{APP_VERSION}</span>
      </div>
    </div>
  );
};
