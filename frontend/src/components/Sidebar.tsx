import React, { useState } from 'react';
import { C, FONT, WEIGHT, SP, RADIUS, EASE, versionStatusColor, versionStatusLabel } from '../theme';
import pkg from '../../package.json';
const APP_VERSION: string = pkg.version;

interface Props {
  versions?: any[];
  selectedVersionId?: string;
  onVersionChange?: (id: string) => void;
  myTasksActive?: boolean;
  onMyTasksClick?: () => void;
  showAdmin?: boolean;
  onAdminClick?: () => void;
  activeTab?: string;
  onNewVersionClick?: () => void;
  versionFilter?: string;
  onVersionFilterChange?: (f: any) => void;
  // ── Module switcher ──────────────────────────────────────────────────
  activeModule?: 'version-management' | 'deployments' | 'qa' | 'release-intelligence' | 'quality-hub';
  onModuleChange?: (m: 'version-management' | 'deployments' | 'qa' | 'release-intelligence' | 'quality-hub') => void;
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
  // ── Leaves (visible to all employees) ────────────────────────────────
  showLeaves?: boolean;
  leavesActive?: boolean;
  onLeavesClick?: () => void;
  onHomeClick?: () => void;
}

const IS_TEST = process.env.REACT_APP_ENV === 'test';

type Group = { id: string; label: string; icon: string; statuses: string[]; isArchived?: boolean };

const GROUPS: Group[] = [
  { id: 'active',   label: 'בפעילות', icon: '🚀', statuses: ['REHEARSAL', 'ACTIVE', 'MORNING_AFTER'] },
  { id: 'planning', label: 'בתכנון',  icon: '📝', statuses: ['DRAFT', 'COLLECTING', 'CR_REVIEW', 'REFINING', 'REVIEW', 'APPROVED'] },
  { id: 'closed',   label: 'סגורות',  icon: '✅', statuses: ['COMPLETED', 'ROLLED_BACK'] },
  { id: 'archived', label: 'ארכיון',  icon: '📦', statuses: [], isArchived: true },
];

const QA_VIEWS = [
  { key: 'assignment', label: 'תכנון ושיבוץ',         icon: '🎯' },
  { key: 'testers',    label: 'בודקים',              icon: '👥' },
  { key: 'skills',     label: 'מטריצת סקילים',        icon: '🧠' },
  { key: 'leaves',     label: 'חופשות',               icon: '📅' },
  { key: 'bugs',       label: 'לוח באגים (QC)',       icon: '🐛' },
];

const VM_VIEWS = [
  { key: 'overview', label: 'סקירה כללית',      icon: '📊' },
  { key: 'manage',   label: 'ניהול תכולה',      icon: '📋' },
  { key: 'changes',  label: 'ניהול שינויים',    icon: '🔄' },
];

const RI_VIEWS = [
  { key: 'overview', label: 'סקירה כללית', icon: '📊' },
  { key: 'daily-qa', label: 'ניהול QA יומי', icon: '📋' },
  { key: 'cr-health', label: 'בריאות CR', icon: '🩺' },
  { key: 'coverage-readiness', label: 'כיסוי ומוכנות', icon: '✅' },
  { key: 'defects', label: 'באגים', icon: '🐞' },
  { key: 'reopen-analysis', label: 'ניתוח Reopen', icon: '♻️' },
  { key: 'cycle-progress', label: 'התקדמות סבבים', icon: '🔄' },
  { key: 'timeline-activities', label: 'ציר זמן ופעילויות', icon: '🗓️' },
  { key: 'capacity', label: 'קיבולת', icon: '⚙️' },
  { key: 'forecast-tracking', label: 'תחזית ומעקב', icon: '📈' },
  { key: 'alerts-intelligence', label: 'התראות ותובנות', icon: '🔔' },
  { key: 'go-no-go', label: 'Go / No-Go', icon: '🚦' },
];

const QH_VIEWS = [
  { key: 'overview', label: 'סקירה כללית', icon: '📊' },
  { key: 'kpi-matrix', label: 'מטריצת KPI', icon: '📋' },
  { key: 'comparison', label: 'השוואת גרסאות', icon: '⚖️' },
  { key: 'timeline', label: 'ציר זמן איכות', icon: '📈' },
  { key: 'kpi-config', label: 'הגדרות KPI', icon: '⚙️' },
  { key: 'open-prod-defects', label: 'תקלות ייצור פתוחות', icon: '📆' },
  { key: 'new-vs-target-defects', label: 'יחס תקלות חדשות ביצור', icon: '📈' },
];

function versionGroup(v: any): string {
  if (v.isArchived) return 'archived';
  if (['REHEARSAL', 'ACTIVE', 'MORNING_AFTER'].includes(v.status)) return 'active';
  if (['COMPLETED', 'ROLLED_BACK'].includes(v.status)) return 'closed';
  return 'planning';
}

export const Sidebar: React.FC<Props> = ({
  versions = [], selectedVersionId, onVersionChange,
  myTasksActive, onMyTasksClick,
  showAdmin, onAdminClick,
  activeTab,
  onNewVersionClick,
  activeModule = 'deployments',
  onModuleChange,
  activeVmView = 'overview',
  onVmViewChange,
  canAccessVersionManagement = false,
  activeQaView = 'testers',
  onQaViewChange,
  canAccessQa = false,
  activeRiView = 'overview',
  onRiViewChange,
  canAccessReleaseIntelligence = false,
  activeQhView = 'overview',
  onQhViewChange,
  canAccessQualityHub = false,
  showLeaves = false,
  leavesActive = false,
  onLeavesClick,
  onHomeClick,
}) => {
  const defaultOpen: Record<string, boolean> = { active: true, planning: true, closed: false, archived: false };
  const [open, setOpen] = useState<Record<string, boolean>>(defaultOpen);
  const [versionsOpen, setVersionsOpen] = useState(true);
  const [hoveredVer, setHoveredVer] = useState<string | null>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const grouped: Record<string, any[]> = { active: [], planning: [], closed: [], archived: [] };
  for (const v of versions) grouped[versionGroup(v)].push(v);

  const toggle = (id: string) => setOpen(prev => ({ ...prev, [id]: !prev[id] }));

  const isVm          = activeModule === 'version-management';
  const isDeployments = activeModule === 'deployments';
  const isQa          = activeModule === 'qa';
  const isRi           = activeModule === 'release-intelligence';
  const isQh           = activeModule === 'quality-hub';

  return (
    <div style={{
      width: '280px', minWidth: '280px',
      background: C.sidebarBg,
      borderLeft: `1px solid ${C.sidebarBorder}`,
      display: 'flex', flexDirection: 'column',
      fontFamily: FONT, overflowY: 'auto',
    }}>

      {IS_TEST && (
        <div style={{
          margin: `${SP[3]} ${SP[3]} 0`,
          background: 'rgba(232,175,0,0.15)', border: `1px solid rgba(232,175,0,0.30)`,
          color: '#d4a017', fontSize: '14px', fontWeight: WEIGHT.bold,
          textAlign: 'center', padding: '5px 8px', borderRadius: RADIUS.md,
          letterSpacing: '0.08em', textTransform: 'uppercase' as const,
        }}>⚡ TEST</div>
      )}

      {/* ─── Module switcher ─── */}
      {(canAccessVersionManagement || canAccessQa || canAccessReleaseIntelligence || canAccessQualityHub) && (
        <div style={{ padding: `${SP[3]} ${SP[3]} 0`, display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {[
            { key: 'version-management' as const, label: 'ניהול גרסה',  icon: '🧭', active: isVm,          show: canAccessVersionManagement },
            { key: 'qa' as const,                  label: 'ניהול QA',    icon: '👥', active: isQa,          show: canAccessQa },
            { key: 'deployments' as const,         label: 'הטמעות',      icon: '🌙', active: isDeployments, show: true },
            { key: 'release-intelligence' as const, label: 'ניהול בדיקות', icon: '🧠', active: isRi,        show: canAccessReleaseIntelligence },
            { key: 'quality-hub' as const,         label: 'איכות גרסה',  icon: '🏆', active: isQh,          show: canAccessQualityHub },
          ].filter(m => m.show).map(m => (
            <button
              key={m.key}
              onClick={() => onModuleChange?.(m.key)}
              style={{
                flex: '1 1 30%', minWidth: '78px', padding: '8px 6px',
                background: m.active ? C.sidebarBgActive : 'transparent',
                border: m.active ? `1px solid rgba(255,255,255,0.12)` : `1px solid ${C.sidebarBorder}`,
                borderRadius: RADIUS.md, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
                transition: EASE.fast,
              }}
              onMouseEnter={e => { if (!m.active) e.currentTarget.style.background = C.sidebarBgHover; }}
              onMouseLeave={e => { if (!m.active) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: '17px', lineHeight: 1 }}>{m.icon}</span>
              <span style={{ fontSize: '13px', fontWeight: m.active ? WEIGHT.semibold : WEIGHT.medium, color: m.active ? C.sidebarText : 'rgba(255,255,255,0.55)', lineHeight: 1 }}>{m.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Home button — always visible ── */}
      {onHomeClick && (
        <div
          onClick={onHomeClick}
          style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: `10px ${SP[3]}`,
            cursor: 'pointer',
            background: activeTab === 'home' && activeModule === 'deployments' ? C.sidebarBgActive : 'transparent',
            borderRight: activeTab === 'home' && activeModule === 'deployments' ? `3px solid ${C.sidebarAccent}` : '3px solid transparent',
            transition: EASE.fast,
            marginTop: SP[2],
          }}
          onMouseEnter={e => { if (!(activeTab === 'home' && activeModule === 'deployments')) (e.currentTarget as HTMLElement).style.background = C.sidebarBgHover; }}
          onMouseLeave={e => { if (!(activeTab === 'home' && activeModule === 'deployments')) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          <span style={{ fontSize: '17px', lineHeight: 1 }}>🏠</span>
          <span style={{ fontSize: '15px', fontWeight: activeTab === 'home' && activeModule === 'deployments' ? WEIGHT.semibold : WEIGHT.medium, color: activeTab === 'home' && activeModule === 'deployments' ? C.sidebarText : 'rgba(255,255,255,0.78)' }}>
            דף הבית
          </span>
        </div>
      )}

      {/* ─── Deployments: גרסאות — hidden on the Home tab, which is a cross-module
           landing page, not a Deployments sub-screen; only the module switcher
           and Home link should show there ─── */}
      {isDeployments && activeTab !== 'home' && (<>

        {/* כותרת גרסאות — רמה ראשונה */}
        <div
          onClick={() => setVersionsOpen(v => !v)}
          style={{
            padding: `16px ${SP[3]} 10px`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', userSelect: 'none',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.75'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '15px', color: 'rgba(255,255,255,0.50)', lineHeight: 1 }}>
              {versionsOpen ? '▾' : '▸'}
            </span>
            <span style={{
              fontSize: '16px', fontWeight: WEIGHT.bold,
              color: 'rgba(255,255,255,0.90)',
              letterSpacing: '0.01em',
            }}>
              גרסאות
            </span>
          </div>
        </div>

        {/* 4 קבוצות */}
        {versionsOpen && GROUPS.map(group => {
          const items = grouped[group.id] ?? [];
          const isOpen = open[group.id];
          const hasSelected = items.some(v => v.id === selectedVersionId);

          return (
            <div key={group.id}>
              <button
                onClick={() => toggle(group.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '9px',
                  padding: `10px ${SP[3]}`,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  textAlign: 'right' as const, direction: 'rtl',
                  transition: EASE.fast,
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.sidebarBgHover}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >
                <span style={{ fontSize: '17px', lineHeight: 1, flexShrink: 0 }}>{group.icon}</span>
                <span style={{
                  fontSize: '17px', fontWeight: WEIGHT.semibold,
                  color: hasSelected ? C.sidebarText : 'rgba(255,255,255,0.78)',
                  flex: 1,
                }}>
                  {group.label}
                </span>
                {items.length > 0 && (
                  <span style={{
                    fontSize: '15px', color: 'rgba(255,255,255,0.55)',
                    background: 'rgba(255,255,255,0.10)',
                    padding: '2px 8px', borderRadius: RADIUS.full,
                    fontWeight: WEIGHT.semibold,
                  }}>
                    {items.length}
                  </span>
                )}
                <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.40)' }}>
                  {isOpen ? '▾' : '▸'}
                </span>
              </button>

              {isOpen && (
                <div style={{ paddingBottom: '4px' }}>
                  {items.length === 0 ? (
                    <div style={{ fontSize: '15px', color: 'rgba(255,255,255,0.35)', padding: `4px ${SP[3]} 4px 30px` }}>
                      אין גרסאות
                    </div>
                  ) : items.map((v: any) => {
                    const isSel = v.id === selectedVersionId;
                    const isHov = hoveredVer === v.id && !isSel;
                    const sColor = versionStatusColor[v.status] ?? C.sidebarTextMuted;
                    const sLabel = versionStatusLabel[v.status] ?? v.status;
                    return (
                      <button key={v.id}
                        onClick={() => onVersionChange?.(v.id)}
                        onMouseEnter={() => setHoveredVer(v.id)}
                        onMouseLeave={() => setHoveredVer(null)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: '11px',
                          padding: `10px ${SP[2]} 10px 26px`,
                          borderRadius: RADIUS.md, cursor: 'pointer',
                          background: isSel ? C.sidebarBgActive : isHov ? C.sidebarBgHover : 'transparent',
                          border: isSel ? `1px solid rgba(255,255,255,0.12)` : '1px solid transparent',
                          textAlign: 'right' as const, direction: 'rtl',
                          transition: EASE.fast, marginBottom: '2px',
                          position: 'relative', overflow: 'hidden',
                        }}>
                        {isSel && (
                          <div style={{ position: 'absolute', right: 0, top: '15%', bottom: '15%', width: '3px', borderRadius: '0 3px 3px 0', background: sColor, boxShadow: `0 0 8px ${sColor}80` }} />
                        )}
                        <span style={{
                          width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0,
                          background: sColor,
                          boxShadow: isSel ? `0 0 8px ${sColor}90` : undefined,
                          display: 'block',
                        }} />
                        <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
                          <div style={{
                            fontSize: '17px',
                            fontWeight: isSel ? WEIGHT.semibold : WEIGHT.medium,
                            color: isSel ? C.sidebarText : 'rgba(255,255,255,0.85)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            lineHeight: '22px',
                          }}>
                            {v.name}
                          </div>
                          <div style={{ fontSize: '15px', color: sColor, opacity: 0.9, lineHeight: '17px' }}>
                            {sLabel}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div style={{ height: '1px', background: C.sidebarBorder, margin: `2px ${SP[3]}`, opacity: 0.5 }} />
            </div>
          );
        })}

        {/* המשימות שלי — disabled (not just silently inert) when no version is REHEARSAL/ACTIVE */}
        <div style={{ padding: `${SP[2]} ${SP[3]} 0` }}>
          <button onClick={onMyTasksClick}
            disabled={!onMyTasksClick}
            title={!onMyTasksClick ? 'זמין רק כשיש גרסה בחזרה גנרלית או בלילה פעיל' : undefined}
            onMouseEnter={() => setHoveredItem('my-tasks')}
            onMouseLeave={() => setHoveredItem(null)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: '11px',
              padding: `11px ${SP[2]}`, borderRadius: RADIUS.lg,
              cursor: onMyTasksClick ? 'pointer' : 'not-allowed',
              opacity: onMyTasksClick ? 1 : 0.4,
              background: myTasksActive ? `rgba(240,106,106,0.15)` : hoveredItem === 'my-tasks' && onMyTasksClick ? C.sidebarBgHover : 'transparent',
              border: myTasksActive ? `1px solid rgba(240,106,106,0.35)` : '1px solid transparent',
              textAlign: 'right' as const, direction: 'rtl', transition: EASE.fast,
            }}>
            <span style={{ fontSize: '18px', flexShrink: 0 }}>👤</span>
            <span style={{
              fontSize: '17px',
              fontWeight: myTasksActive ? WEIGHT.semibold : WEIGHT.medium,
              color: myTasksActive ? (C.sidebarAccent ?? C.brand) : 'rgba(255,255,255,0.78)',
              flex: 1,
            }}>
              המשימות שלי
            </span>
            {myTasksActive && (
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: C.sidebarAccent ?? C.brand, flexShrink: 0 }} />
            )}
          </button>
        </div>

      </>)}

      {/* ─── Version Management Module nav ─── */}
      {isVm && canAccessVersionManagement && (
        <div style={{ padding: `${SP[3]} ${SP[3]} 0`, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ fontSize: '13px', fontWeight: WEIGHT.bold, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', textTransform: 'uppercase' as const, padding: `6px ${SP[2]} 4px` }}>
            ניהול גרסה
          </div>
          {VM_VIEWS.map(view => {
            const isActive = activeVmView === view.key;
            const isHov    = hoveredItem === view.key;
            return (
              <button key={view.key}
                onClick={() => onVmViewChange?.(view.key)}
                onMouseEnter={() => setHoveredItem(view.key)}
                onMouseLeave={() => setHoveredItem(null)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '11px',
                  padding: `11px ${SP[2]}`, borderRadius: RADIUS.lg, cursor: 'pointer',
                  background: isActive ? C.sidebarBgActive : isHov ? C.sidebarBgHover : 'transparent',
                  border: isActive ? `1px solid rgba(255,255,255,0.12)` : '1px solid transparent',
                  textAlign: 'right' as const, direction: 'rtl', transition: EASE.fast,
                  position: 'relative', overflow: 'hidden',
                }}>
                {isActive && (
                  <div style={{ position: 'absolute', right: 0, top: '15%', bottom: '15%', width: '3px', borderRadius: '0 3px 3px 0', background: C.brand, boxShadow: `0 0 8px ${C.brand}80` }} />
                )}
                <span style={{ fontSize: '18px', flexShrink: 0, lineHeight: 1 }}>{view.icon}</span>
                <span style={{
                  fontSize: '17px',
                  fontWeight: isActive ? WEIGHT.semibold : WEIGHT.medium,
                  color: isActive ? C.sidebarText : 'rgba(255,255,255,0.78)',
                  flex: 1,
                }}>
                  {view.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── QA Module nav ─── */}
      {isQa && canAccessQa && (
        <div style={{ padding: `${SP[3]} ${SP[3]} 0`, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ fontSize: '13px', fontWeight: WEIGHT.bold, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', textTransform: 'uppercase' as const, padding: `6px ${SP[2]} 4px` }}>
            ניהול QA
          </div>
          {QA_VIEWS.map(view => {
            const isActive = activeQaView === view.key;
            const isHov    = hoveredItem === view.key;
            return (
              <button key={view.key}
                onClick={() => onQaViewChange?.(view.key)}
                onMouseEnter={() => setHoveredItem(view.key)}
                onMouseLeave={() => setHoveredItem(null)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '11px',
                  padding: `11px ${SP[2]}`, borderRadius: RADIUS.lg, cursor: 'pointer',
                  background: isActive ? C.sidebarBgActive : isHov ? C.sidebarBgHover : 'transparent',
                  border: isActive ? `1px solid rgba(255,255,255,0.12)` : '1px solid transparent',
                  textAlign: 'right' as const, direction: 'rtl', transition: EASE.fast,
                  position: 'relative', overflow: 'hidden',
                }}>
                {isActive && (
                  <div style={{ position: 'absolute', right: 0, top: '15%', bottom: '15%', width: '3px', borderRadius: '0 3px 3px 0', background: C.brand, boxShadow: `0 0 8px ${C.brand}80` }} />
                )}
                <span style={{ fontSize: '18px', flexShrink: 0, lineHeight: 1 }}>{view.icon}</span>
                <span style={{
                  fontSize: '17px',
                  fontWeight: isActive ? WEIGHT.semibold : WEIGHT.medium,
                  color: isActive ? C.sidebarText : 'rgba(255,255,255,0.78)',
                  flex: 1,
                }}>
                  {view.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── Release Intelligence Module nav ─── */}
      {isRi && canAccessReleaseIntelligence && (
        <div style={{ padding: `${SP[3]} ${SP[3]} 0`, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ fontSize: '13px', fontWeight: WEIGHT.bold, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', textTransform: 'uppercase' as const, padding: `6px ${SP[2]} 4px` }}>
            ניהול בדיקות
          </div>
          {RI_VIEWS.map(view => {
            const isActive = activeRiView === view.key;
            const isHov    = hoveredItem === view.key;
            return (
              <button key={view.key}
                onClick={() => onRiViewChange?.(view.key)}
                onMouseEnter={() => setHoveredItem(view.key)}
                onMouseLeave={() => setHoveredItem(null)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '11px',
                  padding: `11px ${SP[2]}`, borderRadius: RADIUS.lg, cursor: 'pointer',
                  background: isActive ? C.sidebarBgActive : isHov ? C.sidebarBgHover : 'transparent',
                  border: isActive ? `1px solid rgba(255,255,255,0.12)` : '1px solid transparent',
                  textAlign: 'right' as const, direction: 'rtl', transition: EASE.fast,
                  position: 'relative', overflow: 'hidden',
                }}>
                {isActive && (
                  <div style={{ position: 'absolute', right: 0, top: '15%', bottom: '15%', width: '3px', borderRadius: '0 3px 3px 0', background: C.brand, boxShadow: `0 0 8px ${C.brand}80` }} />
                )}
                <span style={{ fontSize: '18px', flexShrink: 0, lineHeight: 1 }}>{view.icon}</span>
                <span style={{
                  fontSize: '17px',
                  fontWeight: isActive ? WEIGHT.semibold : WEIGHT.medium,
                  color: isActive ? C.sidebarText : 'rgba(255,255,255,0.78)',
                  flex: 1,
                }}>
                  {view.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── Quality Hub Module nav ─── */}
      {isQh && canAccessQualityHub && (
        <div style={{ padding: `${SP[3]} ${SP[3]} 0`, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ fontSize: '13px', fontWeight: WEIGHT.bold, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', textTransform: 'uppercase' as const, padding: `6px ${SP[2]} 4px` }}>
            Quality Hub
          </div>
          {QH_VIEWS.map(view => {
            const isActive = activeQhView === view.key;
            const isHov    = hoveredItem === view.key;
            return (
              <button key={view.key}
                onClick={() => onQhViewChange?.(view.key)}
                onMouseEnter={() => setHoveredItem(view.key)}
                onMouseLeave={() => setHoveredItem(null)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '11px',
                  padding: `11px ${SP[2]}`, borderRadius: RADIUS.lg, cursor: 'pointer',
                  background: isActive ? C.sidebarBgActive : isHov ? C.sidebarBgHover : 'transparent',
                  border: isActive ? `1px solid rgba(255,255,255,0.12)` : '1px solid transparent',
                  textAlign: 'right' as const, direction: 'rtl', transition: EASE.fast,
                  position: 'relative', overflow: 'hidden',
                }}>
                {isActive && (
                  <div style={{ position: 'absolute', right: 0, top: '15%', bottom: '15%', width: '3px', borderRadius: '0 3px 3px 0', background: C.brand, boxShadow: `0 0 8px ${C.brand}80` }} />
                )}
                <span style={{ fontSize: '18px', flexShrink: 0, lineHeight: 1 }}>{view.icon}</span>
                <span style={{
                  fontSize: '17px',
                  fontWeight: isActive ? WEIGHT.semibold : WEIGHT.medium,
                  color: isActive ? C.sidebarText : 'rgba(255,255,255,0.78)',
                  flex: 1,
                }}>
                  {view.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── חופשות (standalone — only when not in QA module which already has it) ─── */}
      {showLeaves && !isQa && (
        <div style={{ padding: `${SP[2]} ${SP[3]} 0` }}>
          <button
            onClick={onLeavesClick}
            onMouseEnter={() => setHoveredItem('leaves-standalone')}
            onMouseLeave={() => setHoveredItem(null)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: '11px',
              padding: `11px ${SP[2]}`, borderRadius: RADIUS.lg, cursor: 'pointer',
              background: leavesActive ? 'rgba(75,192,120,0.15)' : hoveredItem === 'leaves-standalone' ? C.sidebarBgHover : 'transparent',
              border: leavesActive ? '1px solid rgba(75,192,120,0.35)' : '1px solid transparent',
              textAlign: 'right' as const, direction: 'rtl', transition: EASE.fast,
            }}>
            <span style={{ fontSize: '18px', flexShrink: 0 }}>📅</span>
            <span style={{
              fontSize: '17px',
              fontWeight: leavesActive ? WEIGHT.semibold : WEIGHT.medium,
              color: leavesActive ? '#7ee8a2' : 'rgba(255,255,255,0.78)',
              flex: 1,
            }}>
              חופשות
            </span>
            {leavesActive && (
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#7ee8a2', flexShrink: 0 }} />
            )}
          </button>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* ─── Admin ─── */}
      {showAdmin && (
        <>
          <div style={{ height: '1px', background: C.sidebarBorder, margin: `${SP[2]} ${SP[3]}` }} />
          <div style={{ padding: `0 ${SP[3]} ${SP[2]}` }}>
            <button onClick={onAdminClick}
              onMouseEnter={() => setHoveredItem('admin')}
              onMouseLeave={() => setHoveredItem(null)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '11px',
                padding: `11px ${SP[2]}`, borderRadius: RADIUS.lg, cursor: 'pointer',
                background: activeTab === 'admin' ? C.sidebarBgActive : hoveredItem === 'admin' ? C.sidebarBgHover : 'transparent',
                border: activeTab === 'admin' ? `1px solid rgba(255,255,255,0.12)` : '1px solid transparent',
                textAlign: 'right' as const, direction: 'rtl', transition: EASE.fast,
              }}>
              <span style={{ fontSize: '18px', flexShrink: 0 }}>⚙️</span>
              <span style={{
                fontSize: '17px', fontWeight: WEIGHT.medium,
                color: activeTab === 'admin' ? C.sidebarText : 'rgba(255,255,255,0.78)',
                flex: 1,
              }}>
                ניהול
              </span>
            </button>
          </div>
        </>
      )}

      {/* ─── Footer ─── */}
      <div style={{
        padding: `${SP[2]} ${SP[3]}`,
        borderTop: `1px solid ${C.sidebarBorder}`,
        display: 'flex', alignItems: 'center', gap: '8px',
        fontSize: '14px', color: 'rgba(255,255,255,0.35)',
      }}>
        <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: C.success, flexShrink: 0, boxShadow: `0 0 4px ${C.success}80` }} />
        <span>DeployCenter v{APP_VERSION}</span>
      </div>
    </div>
  );
};
