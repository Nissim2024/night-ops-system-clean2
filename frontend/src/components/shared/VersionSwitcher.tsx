import React, { useEffect, useMemo, useState } from 'react';
import { C, versionStatusColor, versionStatusLabel, lifecyclePhaseLabel, lifecyclePhaseColor, lifecyclePhaseGroup } from '../../theme';
import { cn } from '../../lib/utils';

// Extracted out of Sidebar.tsx (2026-09-29) so EmployeeDashboard can offer
// the exact same picker — pixel-for-pixel, not a re-implementation — instead
// of employees being permanently locked to whichever version the smart
// default (activeVersion ?? planningVersion, incl. the Ops "latest COMPLETED"
// override for defects) happened to land on at login. Session-only by design:
// a manual pick lives in the host component's own state, never persisted, so
// the next login always starts back at the smart default.

type Group = { id: string; label: string; icon: string; statuses: string[]; isArchived?: boolean };

const GROUPS: Group[] = [
  { id: 'active',   label: 'בפעילות', icon: '🚀', statuses: ['REHEARSAL', 'ACTIVE', 'MORNING_AFTER'] },
  { id: 'planning', label: 'בתכנון',  icon: '📝', statuses: ['DRAFT', 'COLLECTING', 'CR_REVIEW', 'REFINING', 'REVIEW', 'APPROVED'] },
  { id: 'closed',   label: 'סגורות',  icon: '✅', statuses: ['COMPLETED', 'ROLLED_BACK'] },
  { id: 'archived', label: 'ארכיון',  icon: '📦', statuses: [], isArchived: true },
  // QC releases opened on demand from "עיון בגרסאות QC" (Version.isQcHistorical)
  { id: 'historical', label: 'מ-QC (לא נוהלו במערכת)', icon: '🗄️', statuses: [] },
];

// Groups shown under the collapsible "היסטוריה" section of the picker.
const HISTORY_GROUP_IDS = ['closed', 'archived', 'historical'];

function versionGroup(v: any): string {
  if (v.isQcHistorical) return 'historical';
  if (v.isArchived) return 'archived';
  if (v.lifecycle?.phase && lifecyclePhaseGroup[v.lifecycle.phase]) return lifecyclePhaseGroup[v.lifecycle.phase];
  if (['REHEARSAL', 'ACTIVE', 'MORNING_AFTER'].includes(v.status)) return 'active';
  if (['COMPLETED', 'ROLLED_BACK'].includes(v.status)) return 'closed';
  return 'planning';
}
function versionPhaseLabel(v: any): string {
  if (v.lifecycle?.phaseLabel) return v.lifecycle.phaseLabel;
  if (v.lifecycle?.phase && lifecyclePhaseLabel[v.lifecycle.phase]) return lifecyclePhaseLabel[v.lifecycle.phase];
  return versionStatusLabel[v.status] ?? v.status;
}
function versionPhaseColor(v: any): string {
  if (v.lifecycle?.phase && lifecyclePhaseColor[v.lifecycle.phase]) return lifecyclePhaseColor[v.lifecycle.phase];
  return versionStatusColor[v.status] ?? C.sidebarTextMuted;
}

const VersionPickerModal: React.FC<{
  versions: any[];
  selectedVersionId?: string;
  onPick: (id: string) => void;
  onClose: () => void;
}> = ({ versions, selectedVersionId, onPick, onClose }) => {
  const [q, setQ] = useState('');
  const showSearch = versions.length > 6;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const needle = q.trim().toLowerCase();
  const groupsWithItems = useMemo(() => GROUPS.map(g => ({
    group: g,
    items: versions
      .filter(v => versionGroup(v) === g.id)
      .filter(v => !needle || String(v.name).toLowerCase().includes(needle))
      .sort((a, b) => String(b.name).localeCompare(String(a.name), 'he')),
  })).filter(x => x.items.length > 0), [versions, needle]);

  // Everything finished — closed, archived, historical QC — sits apart from
  // the working versions: one "היסטוריה" section below a divider, collapsed
  // by default; opened when the current pick is in it, or while searching
  // (so a match is never hidden).
  const regularGroups = groupsWithItems.filter(x => !HISTORY_GROUP_IDS.includes(x.group.id));
  const historyGroups = groupsWithItems.filter(x => HISTORY_GROUP_IDS.includes(x.group.id));
  const historyCount = historyGroups.reduce((s, x) => s + x.items.length, 0);
  const [histOpen, setHistOpen] = useState(() => {
    const cur = versions.find(v => v.id === selectedVersionId);
    return !!cur && HISTORY_GROUP_IDS.includes(versionGroup(cur));
  });
  const histExpanded = histOpen || !!needle;

  const renderItems = (items: any[]) => items.map(v => {
    const isSel = v.id === selectedVersionId;
    const sColor = versionPhaseColor(v);
    const sLabel = versionPhaseLabel(v);
    return (
      <button
        key={v.id}
        onClick={() => { onPick(v.id); onClose(); }}
        className="mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-right [direction:rtl]"
        style={{
          background: isSel ? C.bgHover : 'transparent',
          border: `1px solid ${isSel ? C.border : 'transparent'}`,
        }}
        onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = C.bgNested; }}
        onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: sColor }} />
        <div className="min-w-0 flex-1">
          <div className={cn('overflow-hidden text-ellipsis whitespace-nowrap text-sm text-foreground', isSel ? 'font-bold' : 'font-medium')}>{v.name}</div>
          <div className="text-xs" style={{ color: sColor }}>{sLabel}</div>
        </div>
        {isSel && <span className="text-[13px] font-bold text-primary">✓</span>}
      </button>
    );
  });

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[4000] flex items-start justify-center px-4 pb-4 pt-[10vh] [direction:rtl]"
      style={{ background: 'rgba(10,11,26,0.55)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex max-h-[68vh] w-[360px] max-w-[92vw] flex-col overflow-hidden rounded-lg bg-card shadow-[0_24px_60px_rgba(0,0,0,0.35)]"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
          <div className="text-sm font-bold text-foreground">בחירת גרסה</div>
          <button onClick={onClose} className="cursor-pointer border-none bg-transparent px-1.5 py-0.5 text-base leading-none text-subtle-foreground">✕</button>
        </div>

        {showSearch && (
          <div className="px-4 pb-1 pt-2.5">
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="חיפוש גרסה..."
              className="box-border w-full rounded-md border border-border bg-background px-2.5 py-2 text-[13px] text-foreground [direction:rtl]"
            />
          </div>
        )}

        <div className="overflow-y-auto px-2 pb-2.5 pt-1.5">
          {groupsWithItems.length === 0 && (
            <div className="p-6 text-center text-[13px] text-subtle-foreground">לא נמצאו גרסאות</div>
          )}
          {regularGroups.map(({ group, items }) => (
            <div key={group.id} className="mb-1.5">
              <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.04em] text-subtle-foreground">
                <span className="text-[13px]">{group.icon}</span><span>{group.label}</span>
                <span className="font-normal text-subtle-foreground">· {items.length}</span>
              </div>
              {renderItems(items)}
            </div>
          ))}

          {historyGroups.length > 0 && (
            <div
              className="mt-3 pt-3"
              style={regularGroups.length > 0 ? { borderTop: `2px dashed ${C.textMuted}` } : undefined}
            >
              <button
                onClick={() => setHistOpen(o => !o)}
                className="flex w-full cursor-pointer items-center gap-1.5 rounded-md border-none bg-muted px-2.5 py-2 text-right text-[12px] font-bold text-muted-foreground [direction:rtl]"
                title={histExpanded ? 'קפל היסטוריה' : 'הצג גרסאות שהסתיימו'}
              >
                <span className="text-[13px]">🕘</span>
                <span className="flex-1">היסטוריה</span>
                <span className="font-normal">{historyCount}</span>
                <span className="text-[11px]">{histExpanded ? '▾' : '▸'}</span>
              </button>
              {histExpanded && historyGroups.map(({ group, items }) => (
                <div key={group.id} className="mb-1">
                  <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[11px] font-bold text-subtle-foreground">
                    <span className="text-[13px]">{group.icon}</span><span>{group.label}</span>
                    <span className="font-normal">· {items.length}</span>
                  </div>
                  {renderItems(items)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Button trigger (current version name + status dot) + the modal it opens —
// bundled together so both call sites (Sidebar, EmployeeDashboard) just drop
// this in without re-managing verPickerOpen themselves.
export const VersionSwitcher: React.FC<{
  versions: any[];
  selectedVersionId?: string;
  onVersionChange: (id: string) => void;
}> = ({ versions, selectedVersionId, onVersionChange }) => {
  const [verPickerOpen, setVerPickerOpen] = useState(false);
  if (versions.length === 0) return null;
  const cur = versions.find(v => v.id === selectedVersionId);
  const curColor = cur ? versionPhaseColor(cur) : C.sidebarTextMuted;
  const curLabel = cur ? versionPhaseLabel(cur) : '';
  return (
    <div className="px-3 pt-3">
      <button
        onClick={() => setVerPickerOpen(true)}
        className="box-border flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-right transition-[background] duration-fast ease-out [direction:rtl]"
        style={{ background: C.sidebarBgActive, color: C.sidebarText, border: `1px solid ${C.sidebarBorder}` }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.sidebarBgHover}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = C.sidebarBgActive}
      >
        <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: curColor }} />
        <span className="min-w-0 flex-1">
          <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold">
            {cur ? cur.name : 'בחר גרסה'}
          </span>
          {curLabel && <span className="block text-[11px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{curLabel}</span>}
        </span>
        <span className="shrink-0 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>▾</span>
      </button>

      {verPickerOpen && (
        <VersionPickerModal
          versions={versions}
          selectedVersionId={selectedVersionId}
          onPick={onVersionChange}
          onClose={() => setVerPickerOpen(false)}
        />
      )}
    </div>
  );
};
