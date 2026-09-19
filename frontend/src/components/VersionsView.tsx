import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { formatDate as fmtDateShared, formatDateTime as fmtDateTimeShared, formatTime as fmtTimeShared } from '../utils/dateFormat';
import { usePermissions } from '../context/PermissionsContext';
import { TeamView } from './TeamView';
import { TeamLeadProposalView } from './TeamLeadProposalView';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';
import { PlanWizard } from './PlanWizard';
import { VersionWizard } from './VersionWizard';
import { useVersionCreation } from '../hooks/useVersionCreation';
import { CrPlanReviewPanel } from './CrPlanReviewPanel';
import { DateField, DateTimeField } from './DatePicker';
import { FEATURES } from '../featureFlags';
import { cn } from '../lib/utils';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE,
         versionStatusColor, versionStatusBg, versionStatusLabel, statusColor } from '../theme';
import { Button, Card, VersionStatusChip, Badge, SectionHeader, EmptyState, Divider, Alert, Avatar, StatusChip } from './ui';
import { TaskDetailPanel } from './TaskDetailPanel';
import { cleanHtmlText } from '../utils/textSanitize';
import { teamColor } from './shared/defectFieldDisplay';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Keep legacy maps for any inline usage not yet migrated
const STATUS_COLORS: Record<string, string> = versionStatusColor as any;
const STATUS_LABELS: Record<string, string> = versionStatusLabel as any;

const NEXT_STATUS: Record<string, string> = {
  DRAFT: 'COLLECTING', COLLECTING: 'CR_REVIEW', CR_REVIEW: 'REFINING', REFINING: 'REVIEW',
  REVIEW: 'APPROVED', APPROVED: 'REHEARSAL',
};

const NEXT_LABEL: Record<string, string> = {
  DRAFT: 'פתח לאיסוף משימות', COLLECTING: 'פתח לסקירת תוכניות CR', CR_REVIEW: 'עבור לטיוב',
  REFINING: 'פתח ישיבת מעבר', REVIEW: 'אשר תוכנית',
  APPROVED: 'התחל חזרה גנרלית',
};

const APPS = [
  'BILI', 'CRM', 'OSB', 'DP', 'WEB-RETAIL', 'WEB-NEXT', 'WEB-HOT',
  'TOP', 'IRB', 'NC', 'ERP', 'CONNECT', 'CREDIT GUARD', 'ARCHIVE',
  'PRINT BOSS', 'NIFI', 'CAWA', 'BEERI', 'IVR', 'MEDIATION',
  'PROVISIONING LDAP', 'PROVISIONING TIBCO', 'PROVISIONING NAGRA',
  'PROVISIONING OTT', 'PROVISIONING TEL', 'REMEDY', 'ZOO', 'אחר',
];

interface Version {
  id: string;
  name: string;
  description: string;
  status: string;
  plannedStart: string;
  plannedEnd?: string;
  reviewMeetingTime?: string;
  workPlanMeetingTime?: string;
  integrationStart?: string;
  integrationEnd?: string;
  qaStart?: string;
  qaEnd?: string;
  importedFileName?: string;
  createdAt: string;
  approvedAt?: string;
  creator: { fullName: string };
  approver?: { fullName: string };
  taskCount?: number;
  lastRehearsalAt?: string;
  lastNightAt?: string;
  isArchived?: boolean;
  archivedAt?: string;
  _count?: { phases: number };
}


interface Props {
  token: string;
  onVersionsChanged?: () => void;
  onGoLive?: (versionId: string, versionName: string, isRehearsal: boolean) => void;
  onVersionFocus?: (versionId: string) => void;
  onGoHome?: () => void;
  onGoToAdmin?: () => void;
  onNavigateTab?: (tab: string) => void;
  initialSelectedId?: string;
  autoNew?: boolean;
}

const EMPTY_TASK = { title: '', assignedUserName: '', crNumber: '', application: '', environment: 'BOTH', notes: '', dependencyNote: '', duration: '', plannedStart: '', plannedEnd: '', _durationMins: '' };

export const VersionsView: React.FC<Props> = ({ token, onVersionsChanged, onGoLive, onVersionFocus, onGoHome, onGoToAdmin, onNavigateTab, initialSelectedId, autoNew }) => {
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(autoNew ?? false);
  const [depToastOuter, setDepToastOuter] = useState<any[] | null>(null);
  const depToastTimerOuter = React.useRef<any>(null);
  const showDepToastOuter = (affected: any[]) => {
    if (!affected?.length) return;
    if (depToastTimerOuter.current) clearTimeout(depToastTimerOuter.current);
    setDepToastOuter(affected);
    depToastTimerOuter.current = setTimeout(() => setDepToastOuter(null), 6000);
  };

  const headers = { Authorization: `Bearer ${token}` };
  const tokenPayload = token ? JSON.parse(atob(token.split('.')[1])) : {};
  const userRole: string = tokenPayload.role || '';
  const isManager = ['RELEASE_MANAGER', 'ADMIN'].includes(userRole);
  const { can: outerCan } = usePermissions();

  const fetchVersions = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/versions`, { headers });
      setVersions(res.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchVersion = async (id: string) => {
    try {
      const res = await axios.get(`${API}/versions/${id}`, { headers });
      setSelected(res.data);
      onVersionFocus?.(id);
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    fetchVersions();
  }, []); // eslint-disable-line

  const vc = useVersionCreation(token, {
    onListChanged: () => { fetchVersions(); onVersionsChanged?.(); },
    onCreated: (versionId) => {
      setShowNew(false);
      if (versionId) fetchVersion(versionId);
      // Back to the home dashboard after creating a version, instead of dropping
      // straight into the version-detail screen.
      onGoHome?.();
    },
  });

  // Auto-select version when initialSelectedId changes (e.g. from sidebar selection)
  useEffect(() => {
    if (initialSelectedId) fetchVersion(initialSelectedId);
  }, [initialSelectedId]); // eslint-disable-line

  const updateStatus = async (id: string, status: string, force?: boolean): Promise<void> => {
    await axios.patch(`${API}/versions/${id}/status`, { status, ...(force ? { force: true } : {}) }, { headers });
    await fetchVersions();
    await fetchVersion(id);
    onVersionsChanged?.();
    // After approval, send the user back to the home dashboard instead of
    // leaving them on the version-detail / go-live-plan screen.
    if (status === 'APPROVED') onGoHome?.();
  };

  if (selected) {
    return (
      <>
        <VersionDetail
          version={selected}
          token={token}
          userRole={userRole}
          onBack={() => { setSelected(null); fetchVersions(); }}
          onRefresh={() => fetchVersion(selected.id)}
          onStatusChange={(status, force) => updateStatus(selected.id, status, force)}
          onGoLive={onGoLive}
          showDepToast={showDepToastOuter}
          onNavigateTab={onNavigateTab}
        />
        {depToastOuter && depToastOuter.length > 0 && (
          <div className="fixed bottom-6 end-6 z-[99999] flex max-w-[340px] flex-col gap-2 pointer-events-auto">
            {depToastOuter.map((item: any, i: number) => {
              const noTiming = item.deltaMinutes === 0;
              const shortened = item.deltaMinutes < 0;
              const absMins = Math.abs(item.deltaMinutes);
              const label = item.subPhaseName ? `"${item.subPhaseName}"` : item.phaseName ? `"${item.phaseName}"` : '';
              const bg = noTiming ? '#e8f4fd' : shortened ? '#d4edda' : '#fff3cd';
              const border = noTiming ? '#17a2b8' : shortened ? '#28a745' : '#ffc107';
              const textColor = noTiming ? '#0c5460' : shortened ? '#155724' : '#856404';
              const icon = noTiming ? '🔗' : shortened ? '⏫' : '⏬';
              return (
                <div key={i} dir="rtl" className="flex items-start gap-2 rounded-[10px] p-[10px_14px] text-[15px] shadow-[0_4px_16px_rgba(0,0,0,0.2)]" style={{ background: bg, border: `1px solid ${border}`, color: textColor }}>
                  <span className="text-[17px] leading-none">{icon}</span>
                  <div className="flex-1">
                    <div className="mb-0.5 font-bold">
                      {noTiming ? (item.action === 'הסרה' ? 'תלות הוסרה' : 'תלות נוספה') : 'עדכון לוחות זמנים'}
                    </div>
                    {!noTiming && label && <div>תת-שלב {label} <strong>{shortened ? 'קוצר' : 'הוארך'} ב-{absMins} דק'</strong></div>}
                    {!noTiming && item.phaseName && item.subPhaseName && <div className="mt-0.5 text-[13px] opacity-80">שלב: {item.phaseName}</div>}
                    {noTiming && <div className="text-sm opacity-80">אין משימות עם לוח זמנים מוגדר</div>}
                  </div>
                  <button onClick={() => setDepToastOuter(null)} className="cursor-pointer border-none bg-transparent p-0 text-[17px] leading-none opacity-60" style={{ color: textColor }}>✕</button>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3">
            <h2 className="m-0 text-2xl font-bold text-foreground">
              גרסאות
            </h2>
            <Badge color={C.textMuted} bg={C.bgActive}>
              {versions.filter(v => !v.isArchived).length}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2">
          {isManager && (
          <Button
            variant="primary"
            size="md"
            onClick={() => { setShowNew(true); vc.setImportFile(null); }}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            }
          >
            יצירת תוכנית הטמעה
          </Button>
          )}
        </div>
      </div>

      {showNew && (
        <VersionWizard
          newVersion={vc.newVersion}
          setNewVersion={vc.setNewVersion}
          existingVersions={versions
            .filter(v => !v.isArchived && v.status === 'DRAFT' && (v._count?.phases ?? 0) === 0)
            .map(v => ({ id: v.id, name: v.name }))}
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
          onClose={() => { setShowNew(false); vc.reset(); }}
        />
      )}

      {loading ? (
        <div className="p-[60px] text-center text-muted-foreground">טוען...</div>
      ) : versions.length === 0 ? (
        <div className="p-[60px] text-center text-muted-foreground">
          <div className="text-5xl">📋</div>
          <p>אין גרסאות עדיין — צור את הראשונה!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {versions
            .filter(v => !v.isArchived)
            .map(v => (
            <VersionCard
              key={v.id}
              v={v}
              onOpen={() => fetchVersion(v.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const fmtDateTime = (iso: string) => iso ? fmtDateTimeShared(iso) : '';

// Exported for reuse in AdminPanel's "ניהול גרסאות" section — the only place
// delete/archive/restore still live (see product decision: this list, used
// day-to-day to open versions, shouldn't carry destructive actions once a
// version has real work in it).
export const VersionCard: React.FC<{
  v: Version;
  isDeleting?: boolean;
  onOpen: () => void;
  onDelete?: (e: React.MouseEvent) => void;
  onArchive?: (e: React.MouseEvent) => void;
  onRestore?: (e: React.MouseEvent) => void;
}> = ({ v, isDeleting, onOpen, onDelete, onArchive, onRestore }) => {
  const [hovered, setHovered] = React.useState(false);
  const statusColor = versionStatusColor[v.status] ?? C.textMuted;
  const isActive = ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(v.status);

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'relative flex items-center justify-between gap-4 overflow-hidden rounded-xl border border-border py-4 px-5 cursor-pointer transition-[background-color,box-shadow] duration-fast ease-out',
        hovered ? 'bg-muted shadow-md' : 'bg-card shadow-sm',
      )}
      style={{ borderInlineStart: `3px solid ${statusColor}` }}
    >
      {/* Glow for active versions */}
      {isActive && (
        <div
          className="pointer-events-none absolute inset-y-0 start-0 w-[120px]"
          style={{ background: `linear-gradient(to left, ${statusColor}08, transparent)` }}
        />
      )}

      {/* Left: metadata */}
      <div className="min-w-0 flex-1">
        {/* Row 1: Name + chips */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold text-foreground">{v.name}</span>
          <VersionStatusChip status={v.status} size="sm" />
          {v.status === 'APPROVED' && v.lastRehearsalAt && (
            <Badge color={C.brand} bg={C.brandDim}>🚀 ממתין לייצור</Badge>
          )}
          {v.status === 'MORNING_AFTER' && (
            <Badge color={C.statusWaiting} bg={C.bgWaiting}>🌅 פעילות בוקר</Badge>
          )}
          {v.status === 'COMPLETED' && (
            <Badge color={C.success} bg={C.successBg}>✅ בייצור</Badge>
          )}
        </div>

        {/* Row 2: Meta info */}
        <div className="flex flex-wrap items-center gap-4">
          {v.description && (
            <span className="text-sm text-muted-foreground">{cleanHtmlText(v.description)}</span>
          )}
          {v.importedFileName && (
            <span className="flex items-center gap-1 text-xs text-cyan-600">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              {v.importedFileName}
            </span>
          )}
          {v.plannedStart && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              {fmtDateTime(v.plannedStart)}
            </span>
          )}
          {v.plannedEnd && (
            <span className="flex items-center gap-1 text-xs text-warning">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              {fmtDateTime(v.plannedEnd)}
            </span>
          )}
          {v.reviewMeetingTime && (
            <span className="flex items-center gap-1 text-xs text-primary">
              🗓 סקירת CR-ים: {fmtDateTime(v.reviewMeetingTime)}
            </span>
          )}
          {v.taskCount !== undefined && (
            <Badge color={C.statusOpen} bg={C.bgOpen}>{v.taskCount} משימות</Badge>
          )}
          <span className="text-xs text-subtle-foreground">
            {v.creator?.fullName} · {fmtDateShared(v.createdAt)}
          </span>
          {v.lastRehearsalAt && (
            <Badge color={C.warning} bg={C.bgInProgress}>🎭 {fmtDateTime(v.lastRehearsalAt)}</Badge>
          )}
        </div>
      </div>

      {/* Right: actions */}
      <div
        className="flex shrink-0 items-center gap-2"
        onClick={e => e.stopPropagation()}
      >
        {onRestore && (
          <Button variant="success" size="sm" onClick={e => onRestore(e as any)}>↩ שחזר</Button>
        )}
        {onArchive && (
          <Button variant="ghost" size="sm" onClick={e => onArchive(e as any)}>📦</Button>
        )}
        {onDelete && (
          <Button
            variant="danger"
            size="sm"
            loading={isDeleting}
            onClick={e => onDelete(e as any)}
          >
            {isDeleting ? 'מוחק...' : '🗑'}
          </Button>
        )}
        <span className="ms-1 text-[17px] text-primary">←</span>
      </div>
    </div>
  );
};

// ── Task table column widths (used by header + rows) ─────────────────────────
// Fixed-width columns (px). name + deps are flex (see VersionTaskHeader / task row).
const TV = { num: 36, dur: 88, start: 118, end: 118, team: 128, assignee: 148, app: 110, env: 96, status: 116, actions: 96 };

const isNextDay = (startIso: string, endIso: string) => {
  if (!startIso || !endIso) return false;
  return new Date(endIso).setHours(0,0,0,0) > new Date(startIso).setHours(0,0,0,0);
};
// Flex-grow ratios: name gets 3 parts, deps gets 2 parts of the remaining space
const TV_NAME_FLEX = 3;
const TV_DEPS_FLEX = 2;

const VColH: React.FC<{ label: string; width?: number; flexGrow?: number; center?: boolean }> = ({ label, width, flexGrow, center }) => (
  <div style={{
    width: width ? `${width}px` : undefined,
    flex: flexGrow ? `${flexGrow} 1 0` : undefined,
    flexShrink: width ? 0 : undefined,
    minWidth: flexGrow ? '80px' : undefined,
    padding: `0 ${SP[2]}`, fontSize: '14px', fontWeight: WEIGHT.semibold, color: C.textMuted, fontFamily: FONT,
    textAlign: (center ? 'center' : 'right') as any, textTransform: 'uppercase' as any, letterSpacing: '0.04em', whiteSpace: 'nowrap' as any,
  }}>{label}</div>
);

const VersionTaskHeader: React.FC<{ isLocked: boolean; isManager?: boolean }> = ({ isLocked, isManager }) => (
  <div style={{
    display: 'flex', alignItems: 'center',
    background: C.bgNested, borderBottom: `2px solid ${C.border}`,
    padding: `${SP[1]} 0`, userSelect: 'none' as any,
  }}>
    <div style={{ width: `${TV.num}px`, flexShrink: 0 }} />
    <VColH label="שם משימה"  flexGrow={TV_NAME_FLEX} />
    <VColH label="תלויות"    flexGrow={TV_DEPS_FLEX} />
    <VColH label="משך"       width={TV.dur}      center />
    <VColH label="התחלה"    width={TV.start}    center />
    <VColH label="סיום"     width={TV.end}      center />
    <VColH label="צוות"     width={TV.team}     center />
    <VColH label="אחראי"    width={TV.assignee} center />
    <VColH label="אפליקציה" width={TV.app}      center />
    <VColH label="סביבה"    width={TV.env}      center />
    <VColH label="סטטוס"    width={TV.status}   center />
    {isManager && !isLocked && <div style={{ width: `${TV.actions}px`, flexShrink: 0 }} />}
  </div>
);

const VersionDetail: React.FC<{
  version: any;
  token: string;
  userRole: string;
  onBack: () => void;
  onRefresh: () => void;
  onStatusChange: (s: string, force?: boolean) => Promise<void>;
  onGoLive?: (versionId: string, versionName: string, isRehearsal: boolean) => void;
  showDepToast?: (affected: any[]) => void;
  onNavigateTab?: (tab: string) => void;
}> = ({ version, token, userRole, onBack, onRefresh, onStatusChange, onGoLive, showDepToast, onNavigateTab }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const isManager = ['RELEASE_MANAGER', 'ADMIN'].includes(userRole);
  const { can } = usePermissions();
  const hasOverride = can('action:override_version_edit');
  // APPROVED and ACTIVE: locked unless user has override permission
  // REHEARSAL, MORNING_AFTER, COMPLETED, ROLLED_BACK: always locked
  const isLocked =
    ['REHEARSAL', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(version.status) ||
    (['APPROVED', 'ACTIVE'].includes(version.status) && !hasOverride);

  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [forceDialog, setForceDialog] = useState<{ details: string; targetStatus: string } | null>(null);

  // Separate from handleStatusChange — this isn't a plain status PATCH, it
  // also archives the previous rehearsal's snapshot+summary server-side
  // (RehearsalRunArchive) before flipping back to REHEARSAL, so the first
  // run's report survives being overwritten by the new one.
  const [restartingRehearsal, setRestartingRehearsal] = useState(false);
  const handleRestartRehearsal = async () => {
    setStatusError(null);
    setRestartingRehearsal(true);
    try {
      await axios.post(`${API}/versions/${version.id}/restart-rehearsal`, {}, { headers });
      onRefresh();
      if (onGoLive) onGoLive(version.id, version.name, true);
    } catch (err: any) {
      setStatusError(err?.response?.data?.message || err?.message || 'שגיאה בהתחלת חזרה גנרלית מחדש');
    } finally {
      setRestartingRehearsal(false);
    }
  };

  const handleStatusChange = async (s: string, force?: boolean) => {
    setStatusError(null);
    setStatusLoading(true);
    try {
      await onStatusChange(s, force);
      if ((s === 'ACTIVE' || s === 'REHEARSAL') && onGoLive) {
        onGoLive(version.id, version.name, s === 'REHEARSAL');
      }
    } catch (err: any) {
      const msg: string = err?.response?.data?.message || err?.message || 'שגיאה';
      if (!force && msg.startsWith('הצוותים הבאים טרם הגישו:')) {
        const details = msg.replace('הצוותים הבאים טרם הגישו: ', '');
        setForceDialog({ details, targetStatus: s });
      } else if (!force && msg.includes('שטרם אושרו ע"י מנהל CR')) {
        setForceDialog({ details: msg, targetStatus: s });
      } else {
        setStatusError(msg);
      }
    } finally {
      setStatusLoading(false);
    }
  };

  const [addingTask, setAddingTask] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<any | null>(null);
  const [editFilters, setEditFilters] = useState({ user: '', team: '', app: '' });
  const [editSaveOk, setEditSaveOk] = useState(false);
  const [newDepId, setNewDepId] = useState('');
  const [newTaskDepIds, setNewTaskDepIds] = useState<string[]>([]);
  const [newDepAddSelectId, setNewDepAddSelectId] = useState('');
  const [dragging, setDragging] = useState<{ taskId: string; fromSubId: string } | null>(null);
  const [dragOverSubId, setDragOverSubId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [lastUserDepPairs, setLastUserDepPairs] = useState<{ taskId: string; dependsOnTaskId: string }[] | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<{ taskId: string; taskTitle: string; targetSubId: string; targetSubName: string } | null>(null);
  const [newTask, setNewTask] = useState<any>(EMPTY_TASK);
  const [proposals, setProposals] = useState<any[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [users, setUsers] = useState<{ id: string; fullName: string }[]>([]);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [collapsedSubPhases, setCollapsedSubPhases] = useState<Set<string>>(new Set());
  // Default to fully collapsed (phases + sub-phases) the first time a version's
  // plan actually has phase data loaded — otherwise arriving at the page dumps
  // every task under every phase on screen at once. Only auto-collapses once per
  // version id, so it doesn't fight the user's own expand/collapse afterwards.
  const collapsedInitRef = useRef<string | null>(null);
  useEffect(() => {
    if (!version.phases?.length || collapsedInitRef.current === version.id) return;
    collapsedInitRef.current = version.id;
    setCollapsedPhases(new Set(version.phases.map((p: any) => p.id)));
    setCollapsedSubPhases(new Set(version.phases.flatMap((p: any) => (p.subPhases ?? []).map((s: any) => s.id))));
  }, [version.id, version.phases]);
  const [filterTeam, setFilterTeam] = useState<string | null>(null);
  const [editingPlannedEnd, setEditingPlannedEnd] = useState(false);
  const [plannedEndValue, setPlannedEndValue] = useState(
    version.plannedEnd ? new Date(version.plannedEnd).toISOString().slice(0, 16) : ''
  );
  const [editingReviewMeeting, setEditingReviewMeeting] = useState(false);
  const [reviewMeetingValue, setReviewMeetingValue] = useState(
    version.reviewMeetingTime ? new Date(version.reviewMeetingTime).toISOString().slice(0, 16) : ''
  );
  const [editingWorkPlanMeeting, setEditingWorkPlanMeeting] = useState(false);
  const [workPlanMeetingValue, setWorkPlanMeetingValue] = useState(
    version.workPlanMeetingTime ? new Date(version.workPlanMeetingTime).toISOString().slice(0, 16) : ''
  );
  const [editingSubmissionDeadline, setEditingSubmissionDeadline] = useState(false);
  const [submissionDeadlineValue, setSubmissionDeadlineValue] = useState(
    (version as any).submissionDeadline ? new Date((version as any).submissionDeadline).toISOString().slice(0, 16) : ''
  );
  const [editingApprovalDeadline, setEditingApprovalDeadline] = useState(false);
  const [approvalDeadlineValue, setApprovalDeadlineValue] = useState(
    (version as any).approvalDeadline ? new Date((version as any).approvalDeadline).toISOString().slice(0, 16) : ''
  );
  const [editingQaDates, setEditingQaDates] = useState(false);
  const [qaDatesValue, setQaDatesValue] = useState({
    integrationStart: version.integrationStart ? new Date(version.integrationStart).toISOString().slice(0, 10) : '',
    integrationEnd:   version.integrationEnd   ? new Date(version.integrationEnd).toISOString().slice(0, 10)   : '',
    qaStart:          version.qaStart          ? new Date(version.qaStart).toISOString().slice(0, 10)          : '',
    qaEnd:            version.qaEnd            ? new Date(version.qaEnd).toISOString().slice(0, 10)            : '',
  });
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [reschPhaseStarts, setReschPhaseStarts] = useState<Record<string, string>>({});
  const [reschPhaseEnds, setReschPhaseEnds] = useState<Record<string, string>>({});
  const [reschPreview, setReschPreview] = useState<any[] | null>(null);
  const [reschLoading, setReschLoading] = useState(false);
  const [reschError, setReschError] = useState<string | null>(null);
  const [reschWarnings, setReschWarnings] = useState<string[]>([]);
  const [reschRespectDeps, setReschRespectDeps] = useState(false);
  const [reschTaskOverrides, setReschTaskOverrides] = useState<Record<string, string>>({});
  const [reschEditingId, setReschEditingId] = useState<string | null>(null);
  const [reschEditStart, setReschEditStart] = useState('');
  const [reschEditDur, setReschEditDur] = useState('');
  const [reschEditEnd, setReschEditEnd] = useState('');
  const [teamRefreshKey, setTeamRefreshKey] = useState(0);
  const [dialog, setDialog] = useState<DialogConfig | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertResult, setConvertResult] = useState<{ created: number; skipped: { title: string; reason: string }[]; tasks: { title: string; phaseName: string; subPhaseName: string }[] } | null>(null);
  const [lastConvertedAt, setLastConvertedAt] = useState<Date | null>(null);
  const [showAssignPreview, setShowAssignPreview] = useState(false);
  const [previewItems, setPreviewItems] = useState<{ proposal: any; checked: boolean }[]>([]);
  const [prepOpen, setPrepOpen] = useState(false);
  const [prepMessage, setPrepMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [saveTemplateMode, setSaveTemplateMode] = useState<'update' | 'new'>('update');
  const [saveTemplateSelectId, setSaveTemplateSelectId] = useState('');
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [localTemplates, setLocalTemplates] = useState<any[]>([]);
  const [applyTemplateId, setApplyTemplateId] = useState('');
  const [applyTemplateLoading, setApplyTemplateLoading] = useState(false);
  const [applyTemplateError, setApplyTemplateError] = useState<string | null>(null);
  const [crItems, setCrItems] = useState<{ id: string; label: string }[]>([]);
  const [newCrInput, setNewCrInput] = useState('');
  const [editCrInput, setEditCrInput] = useState('');
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignFrom, setReassignFrom] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [reassignPhaseId, setReassignPhaseId] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [reassignResult, setReassignResult] = useState<{ updated: number; toUserName: string } | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [crSummary, setCrSummary] = useState<any[] | null>(null);
  const [crSummaryLoading, setCrSummaryLoading] = useState(false);
  const [crSummaryExpanded, setCrSummaryExpanded] = useState(false);
  const [teamPanelOpen, setTeamPanelOpen] = useState<{ teamId: string; teamName: string } | null>(null);
  const [crAllApproved, setCrAllApproved] = useState(false);
  const [crReviewExpanded, setCrReviewExpanded] = useState(false);
  const [crPanelRefreshKey, setCrPanelRefreshKey] = useState(0);
  const [selectedTask, setSelectedTask] = useState<any | null>(null);
  const [selectedTaskSubId, setSelectedTaskSubId] = useState<string | undefined>();
  const [selectedTaskPhaseOrder, setSelectedTaskPhaseOrder] = useState<number>(0);
  const [selectedTaskPhaseStart, setSelectedTaskPhaseStart] = useState<string | undefined>();
  const [selectedTaskPhaseEnd, setSelectedTaskPhaseEnd] = useState<string | undefined>();

  useEffect(() => {
    if (!crSummary || crSummary.length === 0) return;
    const done = crSummary.filter((t: any) => t.status === 'COMPLETE' || t.status === 'NOT_REQUIRED').length;
    setCrAllApproved(done === crSummary.length);
  }, [crSummary]); // eslint-disable-line

  const refreshCrSummary = () => {
    if (!isManager) return;
    setCrSummaryLoading(true);
    // Re-sync from file then refresh summary
    axios.post(`${API}/version-cr-assignments/version/${version.id}/sync`, {}, { headers })
      .catch(() => {})
      .finally(() => {
        axios.get(`${API}/import/cr-summary?versionId=${version.id}`, { headers })
          .then(r => setCrSummary(r.data))
          .catch(() => {})
          .finally(() => setCrSummaryLoading(false));
      });
  };

  const refreshProposals = () => {
    if (FEATURES.TEAM_LEAD_PROPOSAL && isManager) {
      axios.get(`${API}/task-proposals/version/${version.id}`, { headers })
        .then(r => setProposals(r.data.filter((p: any) => !p.usedInTaskId)))
        .catch(() => {});
    }
  };

  const closeTeamPanel = () => {
    setTeamPanelOpen(null);
    onRefresh();
    refreshCrSummary();
    setCrPanelRefreshKey(k => k + 1);
  };

  // Phase management
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [editingPhaseName, setEditingPhaseName] = useState('');
  const [addingPhase, setAddingPhase] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [phaseManageLoading, setPhaseManageLoading] = useState(false);
  const [phaseManageError, setPhaseManageError] = useState<string | null>(null);

  useEffect(() => {
    axios.get(`${API}/teams`, { headers }).then(r => setTeams(r.data)).catch(() => {});
    axios.get(`${API}/users`, { headers })
      .then(r => setUsers(r.data.filter((u: any) => u.active).sort((a: any, b: any) => a.fullName.localeCompare(b.fullName, 'he'))))
      .catch(() => {});
    axios.get(`${API}/version-templates`, { headers }).then(r => setLocalTemplates(r.data)).catch(() => {});
    axios.get(`${API}/qc/cr-items?versionId=${version.id}`, { headers }).then(r => setCrItems(r.data)).catch(() => {});
    if (version.status === 'CR_REVIEW' && isManager) {
      // Auto-sync CR assignments from Excel in background, then fetch summary
      setCrSummaryLoading(true);
      axios.post(`${API}/version-cr-assignments/version/${version.id}/sync`, {}, { headers })
        .catch((e: any) => { console.warn('[CR Sync]', e?.response?.data?.message || e?.message); })
        .finally(() => {
          axios.get(`${API}/import/cr-summary?versionId=${version.id}`, { headers })
            .then(r => setCrSummary(r.data?.length > 0 ? r.data : null))
            .catch(() => setCrSummary(null))
            .finally(() => setCrSummaryLoading(false));
        });
    }
  }, []); // eslint-disable-line

  // Reload proposals whenever the version refreshes (onRefresh triggers re-render with new version object)
  useEffect(() => {
    if (FEATURES.TEAM_LEAD_PROPOSAL && isManager) {
      axios.get(`${API}/task-proposals/version/${version.id}`, { headers })
        .then(r => setProposals(r.data.filter((p: any) => !p.usedInTaskId)))
        .catch(() => {});
    }
  }, [version.id, version.updatedAt ?? version.id]); // eslint-disable-line

  // Real-time: reload proposals when a team lead submits a new proposal
  useEffect(() => {
    if (!FEATURES.TEAM_LEAD_PROPOSAL || !isManager) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.versionId === version.id) {
        axios.get(`${API}/task-proposals/version/${version.id}`, { headers })
          .then(r => setProposals(r.data.filter((p: any) => !p.usedInTaskId)))
          .catch(() => {});
      }
    };
    window.addEventListener('deploycenter:proposalCreated', handler);
    return () => window.removeEventListener('deploycenter:proposalCreated', handler);
  }, [version.id, isManager]); // eslint-disable-line

  const handleConvertProposals = async () => {
    setConverting(true);
    try {
      const res = await axios.post(`${API}/task-proposals/version/${version.id}/convert-approved`, {}, { headers });
      setConvertResult({ created: res.data.created ?? 0, skipped: res.data.skipped ?? [], tasks: res.data.tasks ?? [] });
      if ((res.data.created ?? 0) > 0) setLastConvertedAt(new Date());
      axios.get(`${API}/task-proposals/version/${version.id}`, { headers })
        .then(r => setProposals(r.data.filter((p: any) => !p.usedInTaskId)))
        .catch(() => {});
      onRefresh?.();
    } catch (err: any) {
      setConvertResult({ created: 0, skipped: [{ title: '—', reason: err?.response?.data?.message || 'שגיאה בשיבוץ' }], tasks: [] });
    } finally { setConverting(false); }
  };

  const openAssignPreview = () => {
    // Fetch fresh data so edits made after submission are reflected
    axios.get(`${API}/task-proposals/version/${version.id}`, { headers })
      .then(r => {
        const fresh = (r.data as any[]).filter((p: any) => !p.usedInTaskId);
        setProposals(fresh);
        setPreviewItems(fresh.map((p: any) => ({
          proposal: p,
          checked: p.reviewStatus === 'APPROVED',
        })));
        setShowAssignPreview(true);
      })
      .catch(() => {
        // Fallback to cached data
        const pending = proposals.filter((p: any) => !p.usedInTaskId);
        setPreviewItems(pending.map((p: any) => ({
          proposal: p,
          checked: p.reviewStatus === 'APPROVED',
        })));
        setShowAssignPreview(true);
      });
  };

  const handleDeleteFromPreview = async (id: string) => {
    try {
      await axios.delete(`${API}/task-proposals/${id}`, { headers });
      setPreviewItems(prev => prev.filter(item => item.proposal.id !== id));
      setProposals(prev => prev.filter((p: any) => p.id !== id));
    } catch { /* ignore */ }
  };

  const handleConfirmAssign = async () => {
    const selectedIds = previewItems.filter(i => i.checked).map(i => i.proposal.id);
    setShowAssignPreview(false);
    if (selectedIds.length === 0) return;
    setConverting(true);
    try {
      const res = await axios.post(
        `${API}/task-proposals/version/${version.id}/convert-approved`,
        { proposalIds: selectedIds },
        { headers },
      );
      setConvertResult({ created: res.data.created ?? 0, skipped: res.data.skipped ?? [], tasks: res.data.tasks ?? [] });
      if ((res.data.created ?? 0) > 0) setLastConvertedAt(new Date());
      axios.get(`${API}/task-proposals/version/${version.id}`, { headers })
        .then(r => setProposals(r.data.filter((p: any) => !p.usedInTaskId)))
        .catch(() => {});
      onRefresh?.();
    } catch (err: any) {
      setConvertResult({ created: 0, skipped: [{ title: '—', reason: err?.response?.data?.message || 'שגיאה בשיבוץ' }], tasks: [] });
    } finally { setConverting(false); }
  };

  const showAlert = (title: string, message: string, variant: DialogConfig['variant'] = 'info') =>
    setDialog({ title, message, variant, onConfirm: () => setDialog(null) });

  const showConfirm = (title: string, message: string, onConfirm: () => void, confirmLabel = 'אישור', variant: DialogConfig['variant'] = 'danger') =>
    setDialog({ title, message, variant, confirmLabel, onConfirm: () => { setDialog(null); onConfirm(); }, onCancel: () => setDialog(null) });

  // Deletes just this version's Tasks/Phases/SubPhases — the granular
  // counterpart to the whole-version delete (now admin-only, elsewhere).
  // Doesn't touch QA assignments, work plan, CR plans, or activity board.
  const [deletingPlan, setDeletingPlan] = useState(false);
  const deleteImplementationPlan = () => showConfirm(
    'מחיקת תוכנית הטמעה',
    `למחוק את כל השלבים והמשימות של "${version.name}" לצמיתות?\nשיבוצי QA, תוכנית בדיקות ולוח פעילויות לא יושפעו. פעולה זו אינה הפיכה.`,
    async () => {
      setDeletingPlan(true);
      try {
        await axios.delete(`${API}/versions/${version.id}/implementation-plan`, { headers });
        onRefresh();
      } catch (err: any) {
        showAlert('שגיאה', err?.response?.data?.message || 'שגיאה במחיקת תוכנית ההטמעה', 'danger');
      } finally { setDeletingPlan(false); }
    },
    'מחק תוכנית הטמעה',
  );

  const togglePhase = (id: string) => {
    setCollapsedPhases(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleSubPhase = (id: string) => {
    setCollapsedSubPhases(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const savePhaseRename = async (phaseId: string) => {
    const name = editingPhaseName.trim();
    if (!name) return;
    setPhaseManageLoading(true);
    setPhaseManageError(null);
    try {
      await axios.patch(`${API}/versions/phases/${phaseId}`, { name }, { headers });
      setEditingPhaseId(null);
      onRefresh();
    } catch (err: any) {
      setPhaseManageError(err?.response?.data?.message || 'שגיאה בשינוי שם');
    } finally { setPhaseManageLoading(false); }
  };

  const setGoNogoPhase = async (phaseId: string) => {
    setPhaseManageLoading(true);
    setPhaseManageError(null);
    try {
      await axios.patch(`${API}/versions/phases/${phaseId}`, { isGoNoGo: true }, { headers });
      onRefresh();
    } catch (err: any) {
      setPhaseManageError(err?.response?.data?.message || 'שגיאה');
    } finally { setPhaseManageLoading(false); }
  };

  const deletePhase = async (phaseId: string, phaseName: string) => {
    showConfirm('מחיקת שלב', `למחוק את השלב "${phaseName}"? פעולה זו אינה הפיכה.`, async () => {
      setPhaseManageLoading(true);
      setPhaseManageError(null);
      try {
        await axios.delete(`${API}/versions/phases/${phaseId}`, { headers });
        onRefresh();
      } catch (err: any) {
        setPhaseManageError(err?.response?.data?.message || 'שגיאה במחיקת שלב');
      } finally { setPhaseManageLoading(false); }
    });
  };

  const addPhase = async () => {
    const name = newPhaseName.trim();
    if (!name) return;
    const maxOrder = Math.max(0, ...(version.phases || []).map((p: any) => p.orderIndex));
    setPhaseManageLoading(true);
    setPhaseManageError(null);
    try {
      const phaseRes = await axios.post(`${API}/versions/${version.id}/phases`, { name, orderIndex: maxOrder + 1 }, { headers });
      await axios.post(`${API}/versions/phases/${phaseRes.data.id}/sub-phases`, { name: 'כללי', orderIndex: 1 }, { headers });
      setAddingPhase(false);
      setNewPhaseName('');
      onRefresh();
    } catch (err: any) {
      setPhaseManageError(err?.response?.data?.message || 'שגיאה בהוספת שלב');
    } finally { setPhaseManageLoading(false); }
  };

  const addSubPhase = async (phaseId: string) => {
    setPhaseManageLoading(true);
    setPhaseManageError(null);
    try {
      const phase = (version.phases || []).find((p: any) => p.id === phaseId);
      const maxOrder = Math.max(0, ...(phase?.subPhases || []).map((s: any) => s.orderIndex));
      await axios.post(`${API}/versions/phases/${phaseId}/sub-phases`, { name: 'כללי', orderIndex: maxOrder + 1 }, { headers });
      onRefresh();
    } catch (err: any) {
      setPhaseManageError(err?.response?.data?.message || 'שגיאה בהוספת תת-שלב');
    } finally { setPhaseManageLoading(false); }
  };

  const applyTemplateToVersion = async () => {
    if (!applyTemplateId) return;
    setApplyTemplateLoading(true);
    setApplyTemplateError(null);
    try {
      await axios.post(`${API}/version-templates/${applyTemplateId}/apply-to-version/${version.id}`, {}, { headers });
      onRefresh();
    } catch (err: any) {
      setApplyTemplateError(err?.response?.data?.message || 'שגיאה בהחלת התבנית');
    } finally {
      setApplyTemplateLoading(false);
    }
  };

  const formatTime = (iso: string) => iso ? fmtTimeShared(iso) : '';
  const formatDate = (iso: string) => iso ? fmtDateShared(iso) : '';
  const formatDateTimeShort = (iso: string) => iso ? fmtDateTimeShared(iso) : '';

  const calcDuration = (start: string, end: string) => {
    if (!start || !end) return null;
    const diff = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
    if (diff <= 0) return null;
    return diff >= 60 ? `${Math.floor(diff / 60)}ש' ${diff % 60}דק'` : `${diff} דק'`;
  };

  const parseDurationToMinutes = (dur: string): number | null => {
    if (!dur) return null;
    const hMatch = dur.match(/(\d+)ש/);
    const mMatch = dur.match(/(\d+)ד/);
    if (hMatch || mMatch) return (hMatch ? parseInt(hMatch[1]) * 60 : 0) + (mMatch ? parseInt(mMatch[1]) : 0);
    const colonMatch = dur.match(/^(\d+):(\d{2})$/);
    if (colonMatch) return parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2]);
    const n = parseInt(dur); return isNaN(n) ? null : n;
  };

  const computeEndFromDuration = (start: string, dur: string): string | null => {
    const mins = parseDurationToMinutes(dur);
    if (!mins || !start) return null;
    const d = new Date(new Date(start).getTime() + mins * 60000);
    return isNaN(d.getTime()) ? null : d.toISOString();
  };

  const minsToStr = (mins: number): string => {
    if (!mins || mins <= 0) return '';
    if (mins < 60) return `${mins} דק'`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}ש' ${m}דק'` : `${h}ש'`;
  };

  const calcEndFromMins = (start: string, mins: number): string => {
    const d = new Date(new Date(start).getTime() + mins * 60000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // Convert UTC ISO string to local-time string for datetime-local inputs
  const utcToLocalInputStr = (iso: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // Convert local-time string (from datetime-local input) to UTC ISO for the API
  const toUtcIso = (str: string): string | undefined => {
    if (!str) return undefined;
    const d = new Date(str);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  };

  // Cutoff = version.plannedEnd, or 04:00 next morning derived from version.plannedStart
  const cutoff: Date | null = (() => {
    if (version.plannedEnd) return new Date(version.plannedEnd);
    if (version.plannedStart) {
      const d = new Date(version.plannedStart);
      d.setDate(d.getDate() + 1);
      d.setHours(4, 0, 0, 0);
      return d;
    }
    return null;
  })();

  // Compute min start / max end for a list of tasks; flag overrun vs the effective cutoff.
  // phaseCutoff overrides the global cutoff when a phase has its own plannedEnd deadline.
  const getHierarchyTimes = (tasks: any[], phaseCutoff?: Date | null) => {
    const starts = tasks
      .filter(t => t.plannedStart)
      .map(t => new Date(t.plannedStart).getTime());

    const ends = tasks
      .map(t => {
        if (t.plannedEnd) return new Date(t.plannedEnd).getTime();
        if (t.plannedStart && t.duration) {
          const mins = parseDurationToMinutes(t.duration);
          if (mins) return new Date(t.plannedStart).getTime() + mins * 60000;
        }
        return null;
      })
      .filter((v): v is number => v !== null);

    if (!starts.length && !ends.length) return null;
    const minStart = starts.length ? Math.min(...starts) : null;
    const maxEnd = ends.length ? Math.max(...ends) : null;
    const startIso = minStart ? new Date(minStart).toISOString() : null;
    const endIso = maxEnd ? new Date(maxEnd).toISOString() : null;
    const dur = startIso && endIso ? calcDuration(startIso, endIso) : null;
    const effectiveCutoff = phaseCutoff !== undefined ? phaseCutoff : cutoff;
    const overrun = !!(effectiveCutoff && maxEnd && maxEnd > effectiveCutoff.getTime());
    return { startIso, endIso, dur, overrun, effectiveCutoff };
  };

  const savePlannedEnd = async () => {
    if (!plannedEndValue) return;
    try {
      await axios.patch(`${API}/versions/${version.id}/planned-end`, { plannedEnd: plannedEndValue }, { headers });
      setEditingPlannedEnd(false);
      onRefresh();
    } catch (err: any) {
      showAlert('שגיאה', err?.response?.data?.message || 'שגיאה בשמירת שעת סיום', 'danger');
    }
  };

  const saveReviewMeetingTime = async () => {
    try {
      await axios.patch(`${API}/versions/${version.id}/review-meeting-time`, { reviewMeetingTime: reviewMeetingValue || null }, { headers });
      // Sync to activity board
      if (reviewMeetingValue) {
        await axios.patch(`${API}/activity-board/${version.id}/by-key/cr_review`,
          { dateStart: reviewMeetingValue, dateEnd: reviewMeetingValue }, { headers }).catch(() => {});
      }
      setEditingReviewMeeting(false);
      onRefresh();
    } catch (err: any) {
      showAlert('שגיאה', err?.response?.data?.message || 'שגיאה בשמירת מועד הישיבה', 'danger');
    }
  };

  const saveWorkPlanMeetingTime = async () => {
    try {
      await axios.patch(`${API}/versions/${version.id}`, { workPlanMeetingTime: workPlanMeetingValue || null }, { headers });
      // Sync to activity board
      if (workPlanMeetingValue) {
        await axios.patch(`${API}/activity-board/${version.id}/by-key/runbook`,
          { dateStart: workPlanMeetingValue, dateEnd: workPlanMeetingValue }, { headers }).catch(() => {});
      }
      setEditingWorkPlanMeeting(false);
      onRefresh();
    } catch (err: any) {
      showAlert('שגיאה', err?.response?.data?.message || 'שגיאה בשמירת מועד הישיבה', 'danger');
    }
  };

  const saveSubmissionDeadline = async () => {
    try {
      await axios.patch(`${API}/versions/${version.id}`, { submissionDeadline: submissionDeadlineValue || null }, { headers });
      setEditingSubmissionDeadline(false);
      onRefresh();
    } catch (err: any) {
      showAlert('שגיאה', err?.response?.data?.message || 'שגיאה בשמירת מועד הגשה', 'danger');
    }
  };

  const saveApprovalDeadline = async () => {
    try {
      await axios.patch(`${API}/versions/${version.id}`, { approvalDeadline: approvalDeadlineValue || null }, { headers });
      setEditingApprovalDeadline(false);
      onRefresh();
    } catch (err: any) {
      showAlert('שגיאה', err?.response?.data?.message || 'שגיאה בשמירת מועד אישור', 'danger');
    }
  };

  const saveQaDates = async () => {
    try {
      await axios.patch(`${API}/versions/${version.id}`, {
        integrationStart: qaDatesValue.integrationStart || null,
        integrationEnd:   qaDatesValue.integrationEnd   || null,
        qaStart:          qaDatesValue.qaStart           || null,
        qaEnd:            qaDatesValue.qaEnd             || null,
      }, { headers });
      setEditingQaDates(false);
      onRefresh();
    } catch (err: any) {
      showAlert('שגיאה', err?.response?.data?.message || 'שגיאה בשמירת תאריכי QA', 'danger');
    }
  };

  const openReschedule = () => {
    const starts: Record<string, string> = {};
    const ends: Record<string, string> = {};

    // Fixed default times per phase position (Day D = version.plannedStart date)
    const PHASE_DEFAULTS = [
      { startH: 8,  startM: 30, startOff: 0, endH: 16, endM: 30, endOff: 0 }, // Phase 1: בוקר גרסה      08:30 → 16:30 יום D
      { startH: 22, startM: 0,  startOff: 0, endH: 23, endM: 59, endOff: 0 }, // Phase 2: לילה HOTNET    22:00 → 23:59 יום D
      { startH: 0,  startM: 48, startOff: 1, endH: 4,  endM: 0,  endOff: 1 }, // Phase 3: לילה HOT       00:48 → 04:00 יום D+1
      { startH: 7,  startM: 30, startOff: 1, endH: 16, endM: 30, endOff: 1 }, // Phase 4: בוקר לאחר      07:30 → 16:30 יום D+1
    ];

    // Base date: take the date component of version.plannedStart in local time
    const baseDate = version.plannedStart ? new Date(version.plannedStart) : null;

    const sortedPhases = [...(version.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);

    for (let i = 0; i < sortedPhases.length; i++) {
      const phase = sortedPhases[i];
      const def = PHASE_DEFAULTS[i]; // undefined for 5th+ phases

      // ── Start time: saved → task-derived → default ──
      if (phase.plannedStart) {
        starts[phase.id] = utcToLocalInputStr(phase.plannedStart);
      } else {
        const allTasks = (phase.subPhases || []).flatMap((s: any) => s.tasks || []);
        const firstTask = allTasks
          .filter((t: any) => t.plannedStart)
          .sort((a: any, b: any) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime())[0];
        if (firstTask?.plannedStart) {
          starts[phase.id] = utcToLocalInputStr(firstTask.plannedStart);
        } else if (baseDate && def) {
          const d = new Date(baseDate);
          d.setDate(d.getDate() + def.startOff);
          d.setHours(def.startH, def.startM, 0, 0);
          starts[phase.id] = utcToLocalInputStr(d.toISOString());
        } else {
          starts[phase.id] = '';
        }
      }

      // ── End time: saved → default → D+1 04:00 fallback ──
      if (phase.plannedEnd) {
        ends[phase.id] = utcToLocalInputStr(phase.plannedEnd);
      } else if (baseDate && def) {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + def.endOff);
        d.setHours(def.endH, def.endM, 0, 0);
        ends[phase.id] = utcToLocalInputStr(d.toISOString());
      } else if (starts[phase.id]) {
        const d = new Date(starts[phase.id]);
        d.setDate(d.getDate() + 1);
        d.setHours(4, 0, 0, 0);
        ends[phase.id] = utcToLocalInputStr(d.toISOString());
      } else {
        ends[phase.id] = '';
      }
    }
    setReschPhaseStarts(starts);
    setReschPhaseEnds(ends);
    setReschError(null);

    // Pre-populate preview AND overrides from current DB task times.
    // - dbPreview lets the UI show overrunning tasks immediately without needing an engine run.
    //   Including ALL scheduled tasks prevents stale-clear from wiping non-overrunning tasks.
    // - taskOverrides seeds the engine so "חשב ותצוגה מקדימה" respects saved task positions:
    //   the engine uses max(phaseStart, override), so saved times act as lower-bound anchors.
    const dbPreview: any[] = [];
    const dbOverrides: Record<string, string> = {};
    for (const phase of (version.phases || [])) {
      for (const sub of (phase.subPhases || [])) {
        for (const task of (sub.tasks || [])) {
          if (task.plannedStart && task.plannedEnd && parseDurationToMinutes(task.duration || '')) {
            dbPreview.push({
              taskId: task.id,
              title: task.title,
              phaseId: phase.id,
              phaseName: phase.name,
              duration: task.duration,
              plannedStart: task.plannedStart,
              plannedEnd: task.plannedEnd,
            });
            dbOverrides[task.id] = task.plannedStart;
          }
        }
      }
    }
    setReschPreview(dbPreview.length > 0 ? dbPreview : null);
    setReschTaskOverrides(dbOverrides);
    setReschWarnings([]);
    setRescheduleOpen(true);
  };

  const applyTaskEdit = async (taskId: string) => {
    const newStartIso = reschEditStart ? toUtcIso(reschEditStart) : undefined;
    const newEndIso = reschEditEnd ? toUtcIso(reschEditEnd) : undefined;
    const currentTask = reschPreview?.find(u => u.taskId === taskId);

    // Compute the updated preview imperatively so we can extract cascade results
    // and apply them to reschTaskOverrides without nested state-updater calls.
    const updatedPreview = reschPreview ? reschPreview.map(t => ({ ...t })) : null;
    const cascadeOverrides: Record<string, string> = {};

    if (updatedPreview) {
      const idx = updatedPreview.findIndex(u => u.taskId === taskId);
      if (idx !== -1) {
        const task = updatedPreview[idx];

        if (newStartIso) task.plannedStart = newStartIso;
        if (newEndIso) task.plannedEnd = newEndIso;
        if (reschEditDur) task.duration = reschEditDur;

        // If only start was edited (no explicit end), slide end by same duration
        if (newStartIso && !newEndIso) {
          const mins = parseDurationToMinutes(task.duration || '');
          if (mins && mins > 0) {
            task.plannedEnd = new Date(new Date(task.plannedStart).getTime() + mins * 60000).toISOString();
          }
        }

        if (newStartIso) cascadeOverrides[taskId] = task.plannedStart;

        // Cascade downstream tasks in the same phase
        let cursor = new Date(task.plannedEnd);
        for (let i = idx + 1; i < updatedPreview.length; i++) {
          if (updatedPreview[i].phaseId !== task.phaseId) break;
          const mins = parseDurationToMinutes(updatedPreview[i].duration || '');
          if (!mins || mins <= 0) continue;
          updatedPreview[i].plannedStart = cursor.toISOString();
          updatedPreview[i].plannedEnd = new Date(cursor.getTime() + mins * 60000).toISOString();
          cascadeOverrides[updatedPreview[i].taskId] = cursor.toISOString();
          cursor = new Date(updatedPreview[i].plannedEnd);
        }
      }
    }

    setReschPreview(updatedPreview);
    setReschTaskOverrides(prev => ({ ...prev, ...cascadeOverrides }));

    // Immediately persist the individual task edit to DB.
    // phases: [] prevents stale-clearing logic from touching other tasks.
    if (currentTask) {
      const updatedTask = updatedPreview?.find(u => u.taskId === taskId);
      const startIso = updatedTask?.plannedStart ?? currentTask.plannedStart;
      const endIso = updatedTask?.plannedEnd ?? currentTask.plannedEnd;
      const durationMins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
      const dur = reschEditDur || (durationMins > 0 ? minsToStr(durationMins) : (currentTask.duration ?? undefined));
      try {
        await axios.post(`${API}/versions/${version.id}/apply-schedule`, {
          updates: [{ taskId, plannedStart: startIso, plannedEnd: endIso, duration: dur }],
          phases: [],
        }, { headers });
      } catch (err) { console.error('[applyTaskEdit] immediate save failed', err); }
    }

    setReschEditingId(null);
    setReschEditStart('');
    setReschEditDur('');
    setReschEditEnd('');
  };

  const applyScheduleFromPreview = async () => {
    if (!reschPreview) return;
    setReschLoading(true);
    setReschError(null);
    try {
      const phases = buildPhases();
      const phasesInSchedule = new Set(phases.map(p => p.phaseId));
      // Only send tasks that belong to phases being rescheduled — others are DB previews
      // from phases with unchanged start times and should not be re-written.
      const updates = reschPreview
        .filter(u => phasesInSchedule.has(u.phaseId))
        .map(u => {
          const durationMins = Math.round(
            (new Date(u.plannedEnd).getTime() - new Date(u.plannedStart).getTime()) / 60000
          );
          return {
            taskId: u.taskId,
            plannedStart: u.plannedStart,
            plannedEnd: u.plannedEnd,
            duration: durationMins > 0 ? minsToStr(durationMins) : (u.duration ?? undefined),
          };
        });
      const res = await axios.post(`${API}/versions/${version.id}/apply-schedule`, { updates, phases }, { headers });
      setRescheduleOpen(false);
      setReschPreview(null);
      setReschTaskOverrides({});
      setTeamRefreshKey(k => k + 1);
      onRefresh();
    } catch (err: any) {
      setReschError(err?.response?.data?.message || 'שגיאה בעדכון התוכנית');
    } finally {
      setReschLoading(false);
    }
  };

  const applyPhaseStartToAllTasks = async () => {
    setReschLoading(true);
    setReschError(null);
    try {
      // Delegate to the reschedule engine (non-preview) with no task overrides.
      // The engine applies sub-phase sequential scheduling and respects task-level dependencies.
      await axios.post(`${API}/versions/${version.id}/reschedule?preview=false`, {
        phases: buildPhases(),
        respectDeps: true,
        taskOverrides: [],
      }, { headers });

      setRescheduleOpen(false);
      setReschPreview(null);
      setReschTaskOverrides({});
      setTeamRefreshKey(k => k + 1);
      onRefresh();
    } catch (err: any) {
      setReschError(err?.response?.data?.message || 'שגיאה בעדכון שעות התחלה');
    } finally {
      setReschLoading(false);
    }
  };

  const buildPhases = () =>
    Object.entries(reschPhaseStarts)
      .filter(([, v]) => v)
      .map(([phaseId, startTime]) => ({
        phaseId,
        startTime: toUtcIso(startTime) as string,
        endTime: reschPhaseEnds[phaseId] ? toUtcIso(reschPhaseEnds[phaseId]) as string : undefined,
      }));

  const previewReschedule = async () => {
    setReschLoading(true);
    setReschError(null);
    try {
      const taskOverrides = Object.entries(reschTaskOverrides).map(([taskId, plannedStart]) => ({ taskId, plannedStart }));
      const res = await axios.post(`${API}/versions/${version.id}/reschedule?preview=true`, { phases: buildPhases(), respectDeps: reschRespectDeps, taskOverrides }, { headers });
      setReschPreview(res.data.updates);
      setReschWarnings(res.data.phaseAdjustments ?? []);
      // Update inputs with engine-corrected starts so applyScheduleFromPreview saves the right value.
      if (res.data.adjustedPhaseStartsIso) {
        const corrected: Record<string, string> = {};
        for (const [id, iso] of Object.entries(res.data.adjustedPhaseStartsIso as Record<string, string>)) {
          corrected[id] = utcToLocalInputStr(iso as string);
        }
        setReschPhaseStarts(prev => ({ ...prev, ...corrected }));
      }
    } catch (err: any) {
      setReschError(err?.response?.data?.message || 'שגיאה בתצוגה מקדימה');
    } finally {
      setReschLoading(false);
    }
  };

  const confirmReschedule = async () => {
    setReschLoading(true);
    setReschError(null);
    try {
      await axios.post(`${API}/versions/${version.id}/reschedule?preview=false`, { phases: buildPhases() }, { headers });
      setRescheduleOpen(false);
      setReschPreview(null);
      onRefresh();
    } catch (err: any) {
      setReschError(err?.response?.data?.message || 'שגיאה בתזמון מחדש');
    } finally {
      setReschLoading(false);
    }
  };

  const addTask = async (subPhaseId: string) => {
    try {
      const { _durationMins, ...rest } = newTask;
      const mins = parseInt(_durationMins);
      if (mins > 0) {
        rest.duration = minsToStr(mins);
        if (rest.plannedStart) rest.plannedEnd = calcEndFromMins(rest.plannedStart, mins);
      }
      const taskData = {
        ...rest,
        assignedTeamId: selectedTeam,
        versionId: version.id,
        plannedStart: rest.plannedStart ? toUtcIso(rest.plannedStart) : undefined,
        plannedEnd: rest.plannedEnd ? toUtcIso(rest.plannedEnd) : undefined,
      };
      const res = await axios.post(`${API}/versions/sub-phases/${subPhaseId}/tasks`, taskData, { headers });
      const newTaskId = res.data.id;
      if (FEATURES.TEAM_LEAD_PROPOSAL && selectedProposalId) {
        await axios.patch(`${API}/task-proposals/${selectedProposalId}/mark-used`, { taskId: newTaskId }, { headers }).catch(() => {});
        setSelectedProposalId(null);
        setProposals(prev => prev.filter(p => p.id !== selectedProposalId));
      }
      if (newTaskDepIds.length) {
        await Promise.all(
          newTaskDepIds.map(depId =>
            axios.post(`${API}/versions/tasks/${newTaskId}/dependencies`, { dependsOnTaskId: depId }, { headers }).catch(() => {})
          )
        );
      }
      setAddingTask(null);
      setNewTask(EMPTY_TASK);
      setNewTaskDepIds([]);
      setNewDepAddSelectId('');
      setSelectedTeam('');
      onRefresh();
    } catch (err) { console.error(err); }
  };

  const confirmMove = async () => {
    if (!moveConfirm) return;
    try {
      await axios.patch(`${API}/tasks/${moveConfirm.taskId}`, { subPhaseId: moveConfirm.targetSubId }, { headers });
      onRefresh();
    } catch (err) { console.error(err); }
    finally { setMoveConfirm(null); }
  };

  const duplicateTask = async (taskId: string) => {
    try {
      await axios.post(`${API}/tasks/${taskId}/duplicate`, {}, { headers });
      onRefresh();
    } catch (err) { console.error(err); }
  };

  // Dependency changes are buffered in editingTask local state and only sent to the API on Save.
  // On Cancel the user discards changes without any network call having been made.
  const addDep = (depTask: any) => {
    const dependsOnTaskId = newDepId;
    if (!dependsOnTaskId || !depTask) return;

    // Compute dep's effective end time OUTSIDE setEditingTask so it runs synchronously.
    // Prefer explicit plannedEnd; fall back to plannedStart + duration.
    let depEndLocal: string | null = null;
    if (depTask.plannedEnd) {
      depEndLocal = utcToLocalInputStr(depTask.plannedEnd);
    }
    if (!depEndLocal && depTask.plannedStart) {
      const startLocal = utcToLocalInputStr(depTask.plannedStart);
      const depMins = parseDurationToMinutes(depTask.duration || '');
      if (depMins && depMins > 0) {
        depEndLocal = calcEndFromMins(startLocal, depMins);
      }
    }
    setEditingTask((prev: any) => {
      const newDep = {
        dependsOnTaskId,
        dependsOn: { id: depTask.id, title: depTask.title, status: depTask.status },
      };
      let updated: any = { ...prev, dependencies: [...(prev.dependencies || []), newDep] };

      if (depEndLocal) {
        updated = { ...updated, plannedStart: depEndLocal };
        const taskMins = parseInt(prev._durationMins);
        if (taskMins > 0) updated = { ...updated, plannedEnd: calcEndFromMins(depEndLocal, taskMins) };
      }

      return updated;
    });
    setNewDepId('');
  };

  const removeDep = (dependsOnTaskId: string) => {
    setEditingTask((prev: any) => ({
      ...prev,
      dependencies: prev.dependencies?.filter((d: any) => d.dependsOnTaskId !== dependsOnTaskId),
    }));
  };

  const deleteTask = (taskId: string, taskTitle?: string) => {
    const label = taskTitle ? `"${taskTitle}"` : 'המשימה';
    showConfirm('מחיקת משימה', `למחוק את ${label} לצמיתות? פעולה זו אינה הפיכה.`, async () => {
      try {
        await axios.delete(`${API}/tasks/${taskId}`, { headers });
        onRefresh();
      } catch (err: any) {
        showAlert('שגיאה במחיקת משימה', err?.response?.data?.message || 'שגיאה במחיקת משימה', 'danger');
      }
    }, 'מחק');
  };

  const updateTask = async (taskId: string, data: any) => {
    try {
      const { _durationMins, _originalDeps, dependencies, ...rest } = data;
      const mins = parseInt(_durationMins);
      if (mins > 0) {
        rest.duration = minsToStr(mins);
        if (rest.plannedStart) rest.plannedEnd = calcEndFromMins(rest.plannedStart, mins);
      }
      if (rest.plannedStart) rest.plannedStart = toUtcIso(rest.plannedStart);
      if (rest.plannedEnd) rest.plannedEnd = toUtcIso(rest.plannedEnd);
      await axios.patch(`${API}/tasks/${taskId}`, rest, { headers });

      // Apply buffered dependency changes (diff between original snapshot and current state)
      const origIds = (_originalDeps || []).map((d: any) => d.dependsOnTaskId as string);
      const curIds  = (dependencies || []).map((d: any) => d.dependsOnTaskId as string);
      const origSet = new Set<string>(origIds);
      const curSet  = new Set<string>(curIds);
      const toRemove = origIds.filter((id: string) => !curSet.has(id));
      const toAdd    = curIds.filter((id: string) => !origSet.has(id));
      const depResponses = await Promise.all([
        ...toRemove.map((id: string) => axios.post(`${API}/versions/tasks/${taskId}/dependencies/remove`, { dependsOnTaskId: id }, { headers })),
        ...toAdd.map((id: string) => axios.post(`${API}/versions/tasks/${taskId}/dependencies`, { dependsOnTaskId: id }, { headers })),
      ]);
      if (toRemove.length > 0 || toAdd.length > 0) {
        const allAffected = depResponses.flatMap((r: any) => r.data?.affected ?? []);
        if (allAffected.length > 0) {
          showDepToast?.(allAffected);
        } else {
          const action = toAdd.length > 0 ? 'הוספה' : 'הסרה';
          showDepToast?.([{ subPhaseName: '', phaseName: '', deltaMinutes: 0, action } as any]);
        }
      }

      setEditSaveOk(true);
      setTimeout(() => { setEditSaveOk(false); setEditingTask(null); }, 900);
      onRefresh();
    } catch (err) { console.error(err); }
  };

  // After rehearsal is done, APPROVED → ACTIVE (deploy); otherwise APPROVED → REHEARSAL
  const nextStatus = version.status === 'APPROVED' && version.lastRehearsalAt
    ? 'ACTIVE'
    : NEXT_STATUS[version.status];
  const nextLabel = version.status === 'APPROVED' && version.lastRehearsalAt
    ? 'הפעל פעילות ההטמעה'
    : NEXT_LABEL[version.status];

  return (
    <div>
      {/* ── Force-advance confirmation dialog ── */}
      {forceDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: C.bgOverlay }}>
          <div className="w-[90%] max-w-[480px] rounded-2xl border border-border bg-card p-[28px_32px] shadow-[0_28px_72px_rgba(20,21,42,.18)]">
            <div className="mb-2.5 text-[22px]">⚠️</div>
            <div className="mb-2.5 text-[17px] font-bold text-foreground">קיימות חסימות לפני המעבר</div>
            <div className="mb-[18px] rounded-lg border border-warning/27 bg-warning-bg p-[10px_14px] text-[15px] font-bold text-warning">
              {forceDialog.details}
            </div>
            <div className="mb-5 text-[15px] text-muted-foreground">
              כמנהל לילה, ביכולתך לאשר ולהמשיך בכל זאת.
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setForceDialog(null)} className="cursor-pointer rounded-lg border border-border bg-muted px-5 py-[9px] text-[15px] text-muted-foreground">ביטול</button>
              <button
                onClick={async () => { const s = forceDialog.targetStatus; setForceDialog(null); await handleStatusChange(s, true); }}
                className="cursor-pointer rounded-lg border-none bg-warning px-5 py-[9px] text-[15px] font-bold text-white"
              >
                אשר ודחוף קדימה בכל זאת
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Version header ── */}
      <div className="mb-5 rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={onBack} className="cursor-pointer rounded-lg border border-border bg-muted px-4 py-2 text-[15px] text-muted-foreground">→ חזור</button>
            <div>
              <h2 className="m-0 text-foreground">{version.name}</h2>
              {version.description && <p className="mt-1 mb-0 text-[15px] text-muted-foreground">{version.description}</p>}
            </div>
            <VersionStatusChip status={version.status} size="md" />
            {/* Total task count badge — updates live on add/remove */}
            {(() => {
              const total = (version.phases ?? []).flatMap((p: any) => (p.subPhases ?? []).flatMap((s: any) => s.tasks ?? [])).length;
              if (total === 0) return null;
              const done = (version.phases ?? []).flatMap((p: any) => (p.subPhases ?? []).flatMap((s: any) => (s.tasks ?? []).filter((t: any) => t.status === 'DONE'))).length;
              return (
                <span title="סה״כ משימות בתוכנית" className="whitespace-nowrap rounded-xl border border-border bg-muted px-2.5 py-0.5 text-sm font-semibold text-muted-foreground">
                  📋 {done > 0 ? `${done}/${total}` : total} משימות
                </span>
              );
            })()}
            {/* Total pending proposals — clickable assign button */}
            {FEATURES.TEAM_LEAD_PROPOSAL && isManager && proposals.filter(p => !p.usedInTaskId).length > 0 && (
              <button
                onClick={openAssignPreview}
                disabled={converting}
                title="פתח תצוגה מקדימה לשיבוץ הצעות"
                className={cn(
                  'flex items-center gap-1.5 whitespace-nowrap rounded-xl border-none px-3.5 py-1 text-[15px] font-bold text-white',
                  converting ? 'cursor-not-allowed bg-[#b7763a]' : 'cursor-pointer bg-[#e67e22] animate-pulse',
                )}
              >
                {converting ? '⏳ משבץ...' : `📥 שבץ הצעות`}
                <span className="rounded-[10px] bg-white/25 px-[7px] text-sm">
                  {proposals.filter(p => !p.usedInTaskId).length}
                </span>
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* UI utilities */}
            {version.status !== 'CR_REVIEW' && <button onClick={() => setCollapsedPhases(new Set(version.phases?.map((p: any) => p.id)))} className="cursor-pointer rounded-md border border-border bg-muted px-3.5 py-1.5 text-[15px] text-muted-foreground">▶ קפל הכל</button>}
            {version.status !== 'CR_REVIEW' && <button onClick={() => { setCollapsedPhases(new Set()); setCollapsedSubPhases(new Set()); }} className="cursor-pointer rounded-md border border-border bg-muted px-3.5 py-1.5 text-[15px] text-muted-foreground">▼ פתח הכל</button>}

            {/* Manager tools — הכן ותזמן והחלף עובד הועברו לאשף הכנת תוכנית */}
            {isManager && version.status !== 'CR_REVIEW' && (() => {
              const ws = version.wizardState as Record<string, string | null> | null;
              const stepKeys = ['step1', 'step2', 'step3', 'step4', 'step5'];
              const doneCount = ws ? stepKeys.filter(k => ws[k] === 'done').length : 0;
              const allDone = doneCount === 5;
              return (
                <button
                  onClick={() => setWizardOpen(true)}
                  className={cn('cursor-pointer rounded-md border-none px-3.5 py-1.5 text-[15px] font-bold text-white', allDone ? 'bg-success' : 'bg-warning')}
                >
                  {allDone ? '✅ תוכנית מוכנה — ערוך' : `🔧 הכן תוכנית${ws ? ` ${doneCount}/5` : ''}`}
                </button>
              );
            })()}
            {isManager && version.status !== 'CR_REVIEW' && (
              <button
                onClick={() => {
                  setSaveTemplateMode(localTemplates.length > 0 ? 'update' : 'new');
                  setSaveTemplateSelectId(localTemplates[0]?.id ?? '');
                  setSaveTemplateName('');
                  setSaveTemplateOpen(true);
                }}
                className="cursor-pointer rounded-md border-none bg-success px-3.5 py-1.5 text-[15px] font-bold text-white">
                💾 שמור כתבנית
              </button>
            )}

            {/* Status progression — back buttons (new order: DRAFT→COLLECTING→CR_REVIEW→REFINING) */}
            {isManager && version.status === 'COLLECTING' && (
              <button onClick={() => handleStatusChange('DRAFT')} disabled={statusLoading} className="cursor-pointer rounded-lg border border-border bg-muted px-4 py-2 text-[15px] text-subtle-foreground">← חזור לטיוטה</button>
            )}
            {isManager && version.status === 'CR_REVIEW' && (
              <button onClick={() => handleStatusChange('COLLECTING')} disabled={statusLoading} className="cursor-pointer rounded-lg border border-border bg-muted px-4 py-2 text-[15px] text-subtle-foreground">← חזור לאיסוף</button>
            )}
            {isManager && version.status === 'REFINING' && (
              <button onClick={() => handleStatusChange('CR_REVIEW')} disabled={statusLoading} className="cursor-pointer rounded-lg border border-border bg-muted px-4 py-2 text-[15px] text-subtle-foreground">← חזור לסקירת CR</button>
            )}
            {isManager && version.status === 'REVIEW' && (
              <button onClick={() => handleStatusChange('REFINING')} disabled={statusLoading} className="cursor-pointer rounded-lg border border-border bg-muted px-4 py-2 text-[15px] text-subtle-foreground">← חזור לטיוב</button>
            )}
            {version.status === 'APPROVED' && (
              <button onClick={() => handleStatusChange('DRAFT')} disabled={statusLoading} className="cursor-pointer rounded-lg border border-border bg-muted px-4 py-2 text-[15px] text-subtle-foreground">← איפוס לטיוטה</button>
            )}
            {version.status === 'APPROVED' && !version.lastRehearsalAt && (
              <button onClick={() => handleStatusChange('ACTIVE')} disabled={statusLoading} className={cn('rounded-lg border-none px-5 py-2.5 text-[15px] font-bold text-white', statusLoading ? 'cursor-not-allowed bg-subtle-foreground' : 'cursor-pointer bg-muted-foreground')}>
                {statusLoading ? '...' : 'הפעל ללא חזרה →'}
              </button>
            )}
            {nextStatus && (
              <button
                onClick={async () => {
                  if (nextStatus === 'REFINING') {
                    try {
                      const res = await axios.get(`${API}/import/teams-without-proposals?versionId=${version.id}`, { headers });
                      const missing: { name: string; crCount: number; notRequired: boolean }[] = res.data || [];
                      const pending = missing.filter((t: any) => !t.notRequired);
                      if (pending.length > 0) {
                        setForceDialog({ details: pending.map((t: any) => t.name).join(', '), targetStatus: 'REFINING' });
                        return;
                      }
                    } catch (err: any) {
                      setStatusError('שגיאה בבדיקת הגשות צוותים: ' + (err?.response?.data?.message || err?.message || 'שגיאה לא ידועה'));
                      return;
                    }
                  }
                  handleStatusChange(nextStatus);
                }}
                disabled={statusLoading || (false)}
                title={false ? 'יש לאשר את כל תוכניות ה-CR תחילה' : undefined}
                className={cn('rounded-lg border-none px-5 py-2.5 text-[15px] font-bold text-white', statusLoading ? 'cursor-not-allowed' : 'cursor-pointer')}
                style={{ background: statusLoading || (false) ? '#aaa' : STATUS_COLORS[nextStatus] }}>
                {statusLoading ? '...' : `${nextLabel} →`}
              </button>
            )}
            {version.status === 'APPROVED' && version.lastRehearsalAt && (
              <button
                onClick={handleRestartRehearsal}
                disabled={restartingRehearsal || statusLoading}
                title="הרצת החזרה הקודמת נשמרת ונגישה בדוח סיכום החזרה"
                className={cn(
                  'rounded-lg border border-[#8b5cf6] bg-transparent px-5 py-2.5 text-[15px] font-bold text-[#8b5cf6]',
                  restartingRehearsal || statusLoading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer opacity-100',
                )}>
                {restartingRehearsal ? '...' : '🔁 הרץ חזרה גנרלית שוב'}
              </button>
            )}
            {statusError && (
              <div className="flex items-center gap-2 rounded-lg border border-danger/27 bg-danger-bg px-3.5 py-2 text-[15px] text-danger">
                ⚠️ {statusError}
                <button onClick={() => setStatusError(null)} className="cursor-pointer border-none bg-transparent font-bold text-danger">×</button>
              </div>
            )}
          </div>
        </div>

        {/* ── Version metadata row ── */}
        {(() => {
          const sortedPhases = [...(version.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
          const phaseB = sortedPhases[1]; // 2nd phase = ליל HOTNET
          const phaseC = sortedPhases[2]; // 3rd phase = לילה HOT
          return (
        <div style={{ marginTop: '14px', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '15px', color: C.textSecondary, alignItems: 'center' }}>
          {version.importedFileName && (
            <span style={{ background: C.infoBg, color: C.info, padding: '3px 10px', borderRadius: RADIUS.full, fontWeight: 'bold' }}>
              📎 {version.importedFileName}
            </span>
          )}
          {phaseB?.plannedStart ? (
            <span title={`שעת התחלה של "${phaseB.name}"`}>
              📅 <strong>התחלה מתוכננת:</strong> {fmtDateTime(phaseB.plannedStart)}
            </span>
          ) : version.plannedStart ? (
            <span>
              📅 <strong>התחלה מתוכננת:</strong> {fmtDateTime(version.plannedStart)}
            </span>
          ) : null}
          <span className="flex items-center gap-1.5">
            🏁 <strong>סיום מתוכנן:</strong>
            {phaseC?.plannedEnd ? (
              <span className="text-warning" title={`שעת סיום של "${phaseC.name}"`}>
                {fmtDateTime(phaseC.plannedEnd)}
              </span>
            ) : editingPlannedEnd ? (
              <>
                <DateTimeField
                  value={plannedEndValue}
                  onChange={v => setPlannedEndValue(v)}
                  style={{ padding: '4px 8px', border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.md, fontSize: '15px' }}
                />
                <button onClick={savePlannedEnd} className="cursor-pointer rounded-md border-none bg-success px-2.5 py-1 text-sm text-white">שמור</button>
                <button onClick={() => setEditingPlannedEnd(false)} className="cursor-pointer rounded-md border-none bg-muted px-2.5 py-1 text-sm text-muted-foreground">ביטול</button>
              </>
            ) : (
              <>
                <span className={version.plannedEnd ? 'text-warning' : 'text-subtle-foreground'}>
                  {version.plannedEnd ? fmtDateTime(version.plannedEnd) : 'לא הוגדר (ברירת מחדל: 04:00)'}
                </span>
                {isManager && (
                  <button onClick={() => setEditingPlannedEnd(true)} className="cursor-pointer rounded-md border border-warning/27 bg-warning-bg px-2 py-0.5 text-xs text-warning">עריכה</button>
                )}
              </>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            🗓 <strong>ישיבת סקירת CR-ים:</strong>
            {editingReviewMeeting ? (
              <>
                <DateTimeField
                  value={reviewMeetingValue}
                  onChange={v => setReviewMeetingValue(v)}
                  style={{ padding: '4px 8px', border: `1px solid ${C.borderFocus}`, borderRadius: RADIUS.md, fontSize: '15px' }}
                />
                <button onClick={saveReviewMeetingTime} className="cursor-pointer rounded-md border-none bg-info px-2.5 py-1 text-sm text-white">שמור</button>
                <button onClick={() => setEditingReviewMeeting(false)} className="cursor-pointer rounded-md border-none bg-muted px-2.5 py-1 text-sm text-muted-foreground">ביטול</button>
              </>
            ) : (
              <>
                <span className={cn(version.reviewMeetingTime ? 'font-semibold text-info' : 'font-normal text-subtle-foreground')}>
                  {version.reviewMeetingTime ? fmtDateTime(version.reviewMeetingTime) : 'לא נקבע'}
                </span>
                {isManager && (
                  <button onClick={() => setEditingReviewMeeting(true)} className="cursor-pointer rounded-md border border-info/27 bg-info-bg px-2 py-0.5 text-xs text-info">עריכה</button>
                )}
              </>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            📋 <strong>ישיבת הצגת תוכנית עליה לאוויר:</strong>
            {editingWorkPlanMeeting ? (
              <>
                <DateTimeField
                  value={workPlanMeetingValue}
                  onChange={v => setWorkPlanMeetingValue(v)}
                  style={{ padding: '4px 8px', border: `1px solid ${C.borderFocus}`, borderRadius: RADIUS.md, fontSize: '15px' }}
                />
                <button onClick={saveWorkPlanMeetingTime} className="cursor-pointer rounded-md border-none bg-info px-2.5 py-1 text-sm text-white">שמור</button>
                <button onClick={() => setEditingWorkPlanMeeting(false)} className="cursor-pointer rounded-md border-none bg-muted px-2.5 py-1 text-sm text-muted-foreground">ביטול</button>
              </>
            ) : (
              <>
                <span className={cn(version.workPlanMeetingTime ? 'font-semibold text-info' : 'font-normal text-subtle-foreground')}>
                  {version.workPlanMeetingTime ? fmtDateTime(version.workPlanMeetingTime) : 'לא נקבע'}
                </span>
                {isManager && (
                  <button onClick={() => setEditingWorkPlanMeeting(true)} className="cursor-pointer rounded-md border border-info/27 bg-info-bg px-2 py-0.5 text-xs text-info">עריכה</button>
                )}
              </>
            )}
          </span>
          {/* Submission deadline */}
          {(version.status === 'CR_REVIEW' || (version as any).submissionDeadline) && isManager && (
            <span className="flex items-center gap-1.5">
              ⏰ <strong>מועד הגשה:</strong>
              {editingSubmissionDeadline ? (
                <>
                  <DateTimeField value={submissionDeadlineValue} onChange={v => setSubmissionDeadlineValue(v)}
                    style={{ padding: '4px 8px', border: `1px solid ${C.borderFocus}`, borderRadius: RADIUS.md, fontSize: '15px' }} />
                  <button onClick={saveSubmissionDeadline} className="cursor-pointer rounded-md border-none bg-danger px-2.5 py-1 text-sm text-white">שמור</button>
                  <button onClick={() => setEditingSubmissionDeadline(false)} className="cursor-pointer rounded-md border-none bg-muted px-2.5 py-1 text-sm text-muted-foreground">ביטול</button>
                </>
              ) : (() => {
                const dl = (version as any).submissionDeadline;
                const isPast = dl && new Date(dl) < new Date();
                return (
                  <>
                    <span className={cn(!dl ? 'text-subtle-foreground' : isPast ? 'text-danger' : 'text-warning', dl && 'font-semibold')}>
                      {dl ? fmtDateTime(dl) : 'לא נקבע'}
                      {isPast && dl && <span className="ms-1 text-xs text-danger">⚠ עבר</span>}
                    </span>
                    <button onClick={() => setEditingSubmissionDeadline(true)} className="cursor-pointer rounded-md border border-danger/27 bg-danger-bg px-2 py-0.5 text-xs text-danger">עריכה</button>
                  </>
                );
              })()}
            </span>
          )}
          {/* Approval deadline */}
          {(version.status === 'CR_REVIEW' || (version as any).approvalDeadline) && isManager && (
            <span className="flex items-center gap-1.5">
              ✅ <strong>מועד אישור:</strong>
              {editingApprovalDeadline ? (
                <>
                  <DateTimeField value={approvalDeadlineValue} onChange={v => setApprovalDeadlineValue(v)}
                    style={{ padding: '4px 8px', border: `1px solid ${C.borderFocus}`, borderRadius: RADIUS.md, fontSize: '15px' }} />
                  <button onClick={saveApprovalDeadline} className="cursor-pointer rounded-md border-none bg-[#2e7d32] px-2.5 py-1 text-sm text-white">שמור</button>
                  <button onClick={() => setEditingApprovalDeadline(false)} className="cursor-pointer rounded-md border-none bg-muted px-2.5 py-1 text-sm text-muted-foreground">ביטול</button>
                </>
              ) : (() => {
                const dl = (version as any).approvalDeadline;
                const isPast = dl && new Date(dl) < new Date();
                return (
                  <>
                    <span className={cn(!dl ? 'text-subtle-foreground' : isPast ? 'text-danger' : 'text-[#2e7d32]', dl && 'font-semibold')}>
                      {dl ? fmtDateTime(dl) : 'לא נקבע'}
                      {isPast && dl && <span className="ms-1 text-xs text-danger">⚠ עבר</span>}
                    </span>
                    <button onClick={() => setEditingApprovalDeadline(true)} className="cursor-pointer rounded-md border border-[#2e7d32]/30 bg-[#2e7d32]/10 px-2 py-0.5 text-xs text-[#2e7d32]">עריכה</button>
                  </>
                );
              })()}
            </span>
          )}
          {version.creator && <span>👤 {version.creator.fullName}</span>}
          {version.approvedAt && version.approver && (
            <span className="text-success">✅ אושר: {fmtDateShared(version.approvedAt)} ע"י {version.approver.fullName}</span>
          )}
          {version.lastRehearsalAt && (
            <span className="rounded-full bg-warning-bg px-2.5 py-0.5 text-sm font-bold text-warning">
              🎭 חזרה גנרלית: {fmtDateTimeShared(version.lastRehearsalAt)}
            </span>
          )}
          {version.lastNightAt && (
            <span className="rounded-xl bg-[#e8f4fd] px-2.5 py-0.5 text-sm font-bold text-[#1a5276]">
              🌙 ביצוע הטמעה: {fmtDateTimeShared(version.lastNightAt)}
            </span>
          )}
        </div>

        );})()}

        {/* ── Integration / QA dates row ── */}
        {isManager && (
          <div className="mt-2.5 flex flex-wrap items-center gap-[18px] rounded-md border border-border bg-muted p-[10px_14px] text-[15px]">
            <span className="whitespace-nowrap font-bold text-muted-foreground">🔧 תאריכי אינטגרציה / QA:</span>
            {editingQaDates ? (
              <>
                {([
                  { key: 'integrationStart', label: 'תחילת אינטגרציה' },
                  { key: 'integrationEnd',   label: 'סיום אינטגרציה' },
                  { key: 'qaStart',          label: 'תחילת QA' },
                  { key: 'qaEnd',            label: 'סיום QA' },
                ] as { key: keyof typeof qaDatesValue; label: string }[]).map(({ key, label }) => (
                  <label key={key} className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                    {label}
                    <DateField
                      value={qaDatesValue[key]}
                      onChange={v => setQaDatesValue(prev => ({ ...prev, [key]: v }))}
                      style={{ padding: '4px 7px', border: `1px solid ${C.borderFocus}`, borderRadius: RADIUS.md, fontSize: '15px', background: C.bgCard, color: C.textPrimary }}
                    />
                  </label>
                ))}
                <button onClick={saveQaDates} className="cursor-pointer self-end rounded-md border-none bg-success px-3.5 py-1.5 text-sm font-bold text-white">שמור</button>
                <button onClick={() => setEditingQaDates(false)} className="cursor-pointer self-end rounded-md border-none bg-muted px-2.5 py-1.5 text-sm text-muted-foreground">ביטול</button>
              </>
            ) : (
              <>
                {version.integrationStart && (
                  <span className="text-muted-foreground">🔧 {fmtDateShared(version.integrationStart)} → {version.integrationEnd ? fmtDateShared(version.integrationEnd) : '—'}</span>
                )}
                {version.qaStart && (
                  <span className="text-muted-foreground">🧪 {fmtDateShared(version.qaStart)} → {version.qaEnd ? fmtDateShared(version.qaEnd) : '—'}</span>
                )}
                {!version.integrationStart && !version.qaStart && (
                  <span className="italic text-subtle-foreground">לא הוגדרו תאריכים</span>
                )}
                <button
                  onClick={() => {
                    setQaDatesValue({
                      integrationStart: version.integrationStart ? new Date(version.integrationStart).toISOString().slice(0, 10) : '',
                      integrationEnd:   version.integrationEnd   ? new Date(version.integrationEnd).toISOString().slice(0, 10)   : '',
                      qaStart:          version.qaStart          ? new Date(version.qaStart).toISOString().slice(0, 10)          : '',
                      qaEnd:            version.qaEnd            ? new Date(version.qaEnd).toISOString().slice(0, 10)            : '',
                    });
                    setEditingQaDates(true);
                  }}
                  className="cursor-pointer rounded-md border border-info/27 bg-info-bg px-2.5 py-0.5 text-xs text-info"
                >
                  עריכה
                </button>
              </>
            )}
          </div>
        )}

        {version.submissions?.length > 0 && (
          <div className="mt-3">
            {/* CR_REVIEW: detailed CR-based submission status panel */}
            {version.status === 'CR_REVIEW' && isManager && (() => {
              if (crSummaryLoading) return (
                <div className="mb-1.5 rounded-lg border border-slate-200 bg-slate-50 p-[9px_14px] text-[15px] text-slate-500">
                  ⏳ טוען סטטוס הגשות...
                </div>
              );

              if (!crSummary || crSummary.length === 0) {
                // Sync pending or file not configured — show sync prompt only, no team cards
                return (
                  <div className="mb-1.5 flex items-center justify-between rounded-xl border border-amber-500 bg-amber-50 p-[10px_16px]">
                    <span className="text-[15px] text-amber-800">
                      ⏳ טוען נתוני CR מהקובץ... לחץ <strong>🔄 סנכרן</strong> לרענון
                    </span>
                    <button onClick={refreshCrSummary} disabled={crSummaryLoading}
                      className={cn('rounded-md border-none bg-amber-500 px-3 py-1 text-sm font-bold text-white', crSummaryLoading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer opacity-100')}>
                      {crSummaryLoading ? '⏳' : '🔄'} סנכרן
                    </button>
                  </div>
                );
              }

              const ORDER: Record<string, number> = { PARTIAL: 0, NONE: 1, COMPLETE: 2, NOT_REQUIRED: 3 };
              const sorted = [...crSummary].sort((a: any, b: any) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));
              const completeCount = crSummary.filter((t: any) => t.status === 'COMPLETE' || t.status === 'NOT_REQUIRED').length;
              const total = crSummary.length;
              const allDone = completeCount === total;

              const statusMeta = (t: any): { desc: string; accent: string; textColor: string } => {
                const rem = t.crListCount - t.proposedCount;
                switch (t.status) {
                  case 'PARTIAL':      return { accent: '#f59e0b', textColor: '#78350f', desc: `הגישו ${t.proposedCount} מתוך ${t.crListCount} פיתוחים — נותרו ${rem} להשלמה` };
                  case 'NONE':         return { accent: '#ef4444', textColor: '#7f1d1d', desc: `טרם נכנסו למערכת — ${t.crListCount} פיתוח${t.crListCount !== 1 ? 'ים' : ''} ממתין${t.crListCount !== 1 ? 'ים' : ''}` };
                  case 'COMPLETE':     return { accent: '#16a34a', textColor: '#14532d', desc: t.notNeededCount > 0 ? `הגישו ${t.proposedCount} פיתוחים, ${t.notNeededCount} לא נדרש — הכל טופל ✓` : `הגישו את כל ${t.crListCount} הפיתוחים ✓` };
                  case 'ALL_NOT_NEEDED': return { accent: '#94a3b8', textColor: '#475569', desc: `כל ${t.crListCount} הפיתוחים סומנו כ"לא נדרש לתוכנית" — הוגש` };
                  case 'SUBMITTED_EMPTY': return { accent: '#f59e0b', textColor: '#78350f', desc: 'הוגש ללא פיתוחים ולא סומנו "לא נדרש" — נדרשת בדיקה' };
                  case 'NOT_REQUIRED': return { accent: '#94a3b8', textColor: '#64748b', desc: 'לא נדרש לגרסה זו' };
                  default:             return { accent: '#94a3b8', textColor: '#64748b', desc: '' };
                }
              };

              return (
                <div className="mb-1.5 overflow-hidden rounded-xl bg-white" style={{ border: `1px solid ${allDone ? '#bbf7d0' : '#fecaca'}`, boxShadow: allDone ? 'none' : '0 0 0 3px rgba(239,68,68,0.08)' }}>
                  <style>{`@keyframes cr-pulse{0%,100%{background-color:#fff1f2}50%{background-color:#fde8e8}}.cr-header-alert{animation:cr-pulse 2s ease-in-out infinite;cursor:pointer}.cr-header-ok{background:#f0fdf4;cursor:pointer}`}</style>
                  <div className={cn(allDone ? 'cr-header-ok' : 'cr-header-alert', 'flex select-none items-center justify-between p-[10px_16px]', crSummaryExpanded ? 'border-b border-slate-100' : 'border-b-0')}
                    onClick={() => setCrSummaryExpanded(e => !e)}>
                    <span className={cn('flex items-center gap-2 text-[15px] font-bold', allDone ? 'text-green-700' : 'text-red-600')}>
                      <span className="text-[17px]">{allDone ? '✅' : '●'}</span>
                      <span>
                        {allDone ? `כל ${total} הצוותים הגישו את פיתוחיהם` : `הגישו הכל: ${completeCount} מתוך ${total} צוותים — לחץ לפירוט`}
                        {!crAllApproved && (
                          <span className="ms-2.5 text-sm font-semibold text-red-600">
                            · ⚠️ יש CR שטרם אושר ע"י המנהל — בדוק ברשימת הפיתוחים למטה
                          </span>
                        )}
                        {crAllApproved && (
                          <span className="ms-2.5 text-sm text-green-700">· ✅ כל CRים אושרו</span>
                        )}
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      <button onClick={e => { e.stopPropagation(); refreshCrSummary(); }} disabled={crSummaryLoading}
                        className={cn('rounded-md border border-slate-300 bg-white px-2.5 py-[3px] text-[13px] text-slate-600', crSummaryLoading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer opacity-100')}>
                        {crSummaryLoading ? '⏳' : '🔄'} סנכרן
                      </button>
                      <span className={cn('inline-block text-[15px] text-slate-400 transition-transform duration-base', crSummaryExpanded && 'rotate-180')}>▼</span>
                    </div>
                  </div>
                  {crSummaryExpanded && (
                    <div className="grid gap-2.5 p-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
                      {sorted.map((t: any) => {
                        const { desc, accent, textColor } = statusMeta(t);
                        const canReview = t.teamId && t.status !== 'NOT_REQUIRED';
                        const cardBg: Record<string, string> = { PARTIAL: '#fafafa', NONE: '#fafafa', SUBMITTED_EMPTY: '#fafafa', COMPLETE: '#fafafa', NOT_REQUIRED: '#f4f4f5' };
                        return (
                          <div key={t.teamId || t.teamName} className="flex flex-col gap-1.5 rounded-xl p-[12px_14px] shadow-[0_1px_4px_rgba(0,0,0,0.06)]" style={{ border: `1px solid ${accent}33`, borderTop: `4px solid ${accent}`, background: cardBg[t.status] ?? 'white' }}>
                            <span className="text-[15px] font-extrabold leading-tight text-[#1a2332]">{t.teamName}</span>
                            <span className="flex-1 text-sm leading-relaxed" style={{ color: textColor }}>{desc}</span>
                            {canReview && (
                              <button onClick={() => setTeamPanelOpen({ teamId: t.teamId, teamName: t.teamName })}
                                className="mt-1 w-full cursor-pointer rounded-md border border-[#2d4a7a] bg-transparent py-1.5 text-sm font-semibold text-[#2d4a7a]">
                                סקירה ←
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
            {/* Team filter pills */}
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-[13px] text-slate-400">סנן:</span>
              <span onClick={() => setFilterTeam(null)} className={cn('cursor-pointer rounded-full px-2.5 py-[3px] text-[13px] font-bold', filterTeam === null ? 'bg-[#1a2332] text-white' : 'bg-neutral-100 text-neutral-600')}>כולם</span>
              {(() => {
                const assignedTeamIds = new Set<string>(
                  (version.phases ?? [])
                    .flatMap((p: any) => p.subPhases ?? [])
                    .flatMap((sp: any) => sp.tasks ?? [])
                    .map((t: any) => t.assignedTeamId)
                    .filter(Boolean)
                );
                const base = version.status === 'CR_REVIEW'
                  ? version.submissions.filter((sub: any) => (version.involvedTeamIds ?? []).includes(sub.teamId))
                  : version.submissions.filter((sub: any) => assignedTeamIds.has(sub.teamId));
                return base;
              })().map((sub: any) => (
                <span key={sub.id} onClick={() => setFilterTeam(filterTeam === sub.team.id ? null : sub.team.id)}
                  className={cn(
                    'cursor-pointer rounded-full border px-2.5 py-[3px] text-[13px]',
                    filterTeam === sub.team.id ? 'border-[#1a2332] bg-[#1a2332] text-white' : 'border-transparent bg-neutral-100 text-neutral-600',
                  )}>
                  {sub.team.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── אזהרה: סינון צוות מסתיר משימות לא גמורות ── */}
      {filterTeam && ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(version.status) && (() => {
        const hiddenNotDone = (version.phases ?? []).flatMap((p: any) =>
          (p.subPhases ?? []).flatMap((s: any) =>
            (s.tasks ?? []).filter((t: any) =>
              t.status !== 'DONE' &&
              t.assignedTeamId !== filterTeam &&
              (t.assignedTeam?.id) !== filterTeam
            )
          )
        ).length;
        if (!hiddenNotDone) return null;
        return (
          <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-warning bg-warning-bg p-[10px_16px] text-[15px]">
            <span className="text-lg">⚠️</span>
            <span className="font-bold text-warning">
              סינון צוות פעיל — {hiddenNotDone} משימות לא גמורות מוסתרות.
            </span>
            <button onClick={() => setFilterTeam(null)} className="ms-auto cursor-pointer rounded-md border-none bg-warning px-2.5 py-[3px] text-sm font-bold text-white">
              הצג הכל
            </button>
          </div>
        );
      })()}

      {/* ── CR_REVIEW: רשימת פיתוחים — מחוץ לחלונית ── */}
      {version.status === 'CR_REVIEW' && isManager && (
        <div className="mt-3">
          <CrPlanReviewPanel
            token={token}
            versionId={version.id}
            versionStatus={version.status}
            isManager={isManager}
            section="crs"
            refreshKey={crPanelRefreshKey}
            onAllApproved={setCrAllApproved}
            onTeamReview={(teamId, teamName) => setTeamPanelOpen({ teamId, teamName })}
          />
        </div>
      )}

      {version.status !== 'CR_REVIEW' && <>

      {/* ── Lock banner ── */}
      {isLocked && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border-2 border-info/27 bg-info-bg p-[12px_20px]">
          <span className="text-2xl">🔒</span>
          <div>
            <div className="text-base font-bold text-info">
              {['APPROVED', 'ACTIVE'].includes(version.status) ? 'גרסה נעולה לעריכה' : 'גרסה פעילה — מצב קריאה בלבד'}
            </div>
            <div className="mt-0.5 text-[15px] text-muted-foreground">
              {['APPROVED', 'ACTIVE'].includes(version.status)
                ? 'לא ניתן לערוך משימות בסטטוס זה — נדרשת הרשאת override'
                : 'לא ניתן להוסיף, לערוך או למחוק משימות בזמן ביצוע'}
            </div>
          </div>
        </div>
      )}

      {/* ── Empty DRAFT: build deployment plan ── */}
      {version.status === 'DRAFT' && !(version.phases?.length) && isManager && (
        <div className="mb-5 rounded-2xl border-2 border-dashed border-[#2d4a7a] bg-[#f0f7ff] p-[28px_24px] text-center">
          <div className="mb-2.5 text-[32px]">📋</div>
          <div className="mb-1.5 text-[17px] font-bold text-[#1a2332]">
            בנה תוכנית הטמעה לגרסה
          </div>
          <div className="mb-5 text-[15px] leading-relaxed text-slate-600">
            הגרסה נוצרה. החל תבנית קיימת כדי לאכלס שלבים ומשימות אוטומטית.
          </div>
          {localTemplates.length > 0 ? (
            <div className="mx-auto flex max-w-[400px] flex-col items-center gap-3">
              <select
                value={applyTemplateId}
                onChange={e => setApplyTemplateId(e.target.value)}
                dir="rtl"
                className="w-full rounded-lg border-2 border-[#2d4a7a] bg-white p-[10px_14px] text-[15px] text-[#1a2332]"
              >
                <option value="">בחר תבנית...</option>
                {localTemplates.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {applyTemplateError && (
                <div className="text-[15px] text-red-600">⚠️ {applyTemplateError}</div>
              )}
              <button
                onClick={applyTemplateToVersion}
                disabled={!applyTemplateId || applyTemplateLoading}
                className={cn(
                  'w-full rounded-lg border-none px-7 py-2.5 text-[15px] font-bold text-white',
                  applyTemplateId && !applyTemplateLoading ? 'cursor-pointer bg-[#2d4a7a]' : 'cursor-not-allowed bg-slate-400',
                )}
              >
                {applyTemplateLoading ? '⏳ מחיל תבנית...' : '📋 החל תבנית על הגרסה'}
              </button>
            </div>
          ) : (
            <div className="text-[15px] text-slate-400">
              אין תבניות שמורות. תוכל להוסיף שלבים ידנית או לשמור תבנית מגרסה קיימת.
            </div>
          )}
        </div>
      )}

      {/* ── Delete implementation plan — granular, not the whole version ── */}
      {isManager && !isLocked && (version.phases?.length ?? 0) > 0 && (
        <div className="mb-2.5 flex justify-end">
          <button
            disabled={deletingPlan}
            onClick={deleteImplementationPlan}
            title="מוחק את השלבים והמשימות בלבד — לא נוגע בשיבוצי QA, תוכנית בדיקות או לוח פעילויות"
            className={cn(
              'rounded-lg border border-danger/33 bg-transparent px-3.5 py-1.5 text-sm text-danger',
              deletingPlan ? 'cursor-not-allowed opacity-60' : 'cursor-pointer opacity-100',
            )}
          >
            {deletingPlan ? '⏳ מוחק...' : '🗑 מחק תוכנית הטמעה'}
          </button>
        </div>
      )}

      {/* ── Phases ── */}
      {version.phases?.map((phase: any) => {
        const phaseTasks = phase.subPhases?.flatMap((s: any) => s.tasks || []) || [];
        // Phase deadline = ONLY what the user explicitly set in the reschedule dialog (phase.plannedEnd).
        // No global fallback — if the user hasn't set a deadline, no overrun is detected for this phase.
        const phaseCutoff: Date | null = phase.plannedEnd ? new Date(phase.plannedEnd) : null;
        const phaseTimes = getHierarchyTimes(phaseTasks, phaseCutoff);

        return (
          <div key={phase.id} className={cn('mb-4 rounded-xl border bg-card p-5', phase.isGoNoGo ? 'border-success/27 shadow-[0_0_0_2px_rgba(0,0,0,0.03)]' : 'border-border shadow-none')}>
            <div className="mb-4 flex flex-wrap items-start gap-2">
              {/* Clickable phase title */}
              <h3 onClick={() => togglePhase(phase.id)} className="m-0 flex flex-1 flex-wrap items-center gap-2 select-none cursor-pointer text-[17px] text-foreground">
                <span className="text-[15px] text-neutral-400">{collapsedPhases.has(phase.id) ? '►' : '▼'}</span>
                <span className={cn(
                  'rounded px-2 py-0.5 text-sm',
                  phase.environment === 'HOT' ? 'bg-red-100 text-red-700' : phase.environment === 'HOTNET' ? 'bg-sky-100 text-sky-700' : 'bg-neutral-100 text-neutral-600',
                )}>{phase.environment}</span>
                {editingPhaseId === phase.id ? (
                  <span onClick={e => e.stopPropagation()} className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={editingPhaseName}
                      onChange={e => setEditingPhaseName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') savePhaseRename(phase.id); if (e.key === 'Escape') setEditingPhaseId(null); }}
                      className="w-[260px] rounded-md border-2 border-primary bg-muted p-[4px_8px] text-base font-bold text-foreground"
                    />
                    <button onClick={() => savePhaseRename(phase.id)} disabled={phaseManageLoading} className="cursor-pointer rounded px-2.5 py-[3px] text-sm bg-success text-white border-none">שמור</button>
                    <button onClick={() => setEditingPhaseId(null)} className="cursor-pointer rounded border border-border bg-muted px-2 py-[3px] text-sm text-muted-foreground">×</button>
                  </span>
                ) : (
                  <span>{phase.name}</span>
                )}
                {FEATURES.TEAM_LEAD_PROPOSAL && (() => {
                  const pending = proposals.filter((p: any) => !p.usedInTaskId && Number(p.phase) === Number(phase.orderIndex)).length;
                  if (!pending) return null;
                  return (
                    <span title={`${pending} הצעות ראשי צוותים לשלב זה`} className="cursor-default whitespace-nowrap rounded-[10px] bg-[#e67e22] px-2.5 py-0.5 text-[13px] font-bold text-white">
                      💡 {pending}
                    </span>
                  );
                })()}
                {phase.isGoNoGo && (
                  <span className="whitespace-nowrap rounded-xl border border-success/27 bg-success-bg px-2.5 py-0.5 text-[13px] font-bold text-success">
                    🚦 שלב GO/NO GO
                  </span>
                )}
                <span className="text-sm font-normal text-muted-foreground">({phase.subPhases?.length || 0} תת-שלבים)</span>
              {phaseTimes && (
                <span className={cn(
                  'ms-1 rounded-xl border px-2.5 py-0.5 text-sm',
                  phaseTimes.overrun ? 'border-danger/27 bg-danger-bg font-bold text-danger' : 'border-border bg-muted font-normal text-info',
                )}>
                  {phaseTimes.overrun ? '⚠️ ' : '⏰ '}
                  {phaseTimes.startIso ? formatTime(phaseTimes.startIso) : '?'}
                  {phaseTimes.endIso ? ` — ${formatTime(phaseTimes.endIso)}` : ''}
                  {phaseTimes.dur ? ` · ${phaseTimes.dur}` : ''}
                  {phaseTimes.overrun && phaseCutoff ? ` (חורג מ-${formatDateTimeShort(phaseCutoff.toISOString())})` : ''}
                </span>
              )}
              {phaseCutoff && (
                <span className={cn(
                  'rounded-lg border border-border px-[7px] py-px text-[13px]',
                  phaseTimes?.overrun ? 'bg-danger-bg text-danger' : 'bg-muted text-muted-foreground',
                )}>
                  יעד: {formatDateTimeShort(phaseCutoff.toISOString())}
                </span>
              )}
              </h3>

              {/* Phase management actions (managers only, non-locked) */}
              {isManager && !isLocked && editingPhaseId !== phase.id && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    title="שנה שם שלב"
                    onClick={() => { setEditingPhaseId(phase.id); setEditingPhaseName(phase.name); }}
                    className="cursor-pointer rounded border border-primary/30 bg-muted px-2 py-[3px] text-sm text-primary">
                    ✏️
                  </button>
                  {!phase.isGoNoGo && (
                    <button
                      title="הגדר שלב זה כנקודת GO/NO GO"
                      onClick={() => setGoNogoPhase(phase.id)}
                      disabled={phaseManageLoading}
                      className="cursor-pointer whitespace-nowrap rounded border border-success/27 bg-success-bg px-2 py-[3px] text-sm text-success">
                      🚦 קבע GO/NO GO
                    </button>
                  )}
                  {(phase.subPhases ?? []).every((sp: any) => (sp.tasks ?? []).length === 0) && (
                    <button
                      title="מחק שלב (ריק)"
                      onClick={() => deletePhase(phase.id, phase.name)}
                      disabled={phaseManageLoading}
                      className="cursor-pointer rounded border border-danger/27 bg-danger-bg px-2 py-[3px] text-sm text-danger">
                      🗑️
                    </button>
                  )}
                </div>
              )}
            </div>

            {!collapsedPhases.has(phase.id) && phase.subPhases?.map((sub: any) => {
              const subTimes = getHierarchyTimes(sub.tasks || [], phaseCutoff);

              return (
                <div key={sub.id}
                  onDragOver={e => { e.preventDefault(); if (dragging && dragging.fromSubId !== sub.id) setDragOverSubId(sub.id); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setDragOverSubId(null); } }}
                  onDrop={e => {
                    e.preventDefault();
                    setDragOverSubId(null);
                    setDragOverTaskId(null);
                    if (!dragging) return;
                    if (dragging.fromSubId === sub.id) {
                      // Within same subphase — reorder by dropping on subphase background (append to end)
                      const currentTasks = [...(sub.tasks || [])].sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
                      const withoutDragged = currentTasks.filter((t: any) => t.id !== dragging.taskId);
                      const newOrder = [...withoutDragged, currentTasks.find((t: any) => t.id === dragging.taskId)!].map((t: any) => t.id);
                      axios.post(`${API}/versions/sub-phases/${sub.id}/reorder`, { taskIds: newOrder }, { headers }).then(() => onRefresh()).catch(console.error);
                      setDragging(null);
                      return;
                    }
                    const draggedTask = version.phases.flatMap((p: any) => p.subPhases?.flatMap((s: any) => s.tasks || []) || []).find((t: any) => t.id === dragging.taskId);
                    if (!draggedTask) return;
                    setMoveConfirm({ taskId: dragging.taskId, taskTitle: draggedTask.title, targetSubId: sub.id, targetSubName: sub.name });
                    setDragging(null);
                  }}
                  // Drop-zone visual feedback only (bound to `dragOverSubId`, set by the
                  // onDragOver/onDrop above) — those handlers and the reorder/move-confirm
                  // logic inside them are untouched; only this style→className changed.
                  // NOTE: original was physical `Right` — in this RTL app, right = logical
                  // *start*, so `ps-`/`border-s-`/`rounded-s-` (not `pe-`/`border-e-`) are
                  // the correct equivalents, not a mismatch with the other end-based spots.
                  className={cn(
                    'mb-3 ps-4 border-s-[3px] transition-[background-color,border-color] duration-fast ease-out',
                    dragOverSubId === sub.id ? 'border-primary bg-muted rounded-s-lg' : 'border-border bg-transparent'
                  )}>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 onClick={() => toggleSubPhase(sub.id)} className="m-0 flex flex-wrap select-none cursor-pointer items-center gap-1.5 text-[15px] text-foreground">
                      <span className="text-[13px] text-muted-foreground">{collapsedSubPhases.has(sub.id) ? '►' : '▼'}</span>
                      {sub.name}
                      <span className="text-[13px] font-normal text-muted-foreground">({sub.tasks?.length || 0})</span>
                      {FEATURES.TEAM_LEAD_PROPOSAL && (() => {
                        const subPending = proposals.filter((p: any) => !p.usedInTaskId && p.subPhaseId === sub.id).length;
                        if (!subPending) return null;
                        return (
                          <span title={`${subPending} הצעות ממתינות לתת-שלב זה`} className="cursor-default whitespace-nowrap rounded-[10px] bg-[#e67e22] px-[7px] py-px text-xs font-bold text-white">
                            💡 {subPending}
                          </span>
                        );
                      })()}
                      {subTimes && (
                        <span className={cn(
                          'rounded-[10px] px-2 py-px text-[13px]',
                          subTimes.overrun ? 'border border-danger/27 bg-danger-bg font-bold text-danger' : 'border-none bg-info-bg font-normal text-info',
                        )}>
                          {subTimes.overrun ? '⚠️ ' : '⏰ '}
                          {subTimes.startIso ? formatTime(subTimes.startIso) : '?'}
                          {subTimes.endIso ? ` — ${formatTime(subTimes.endIso)}` : ''}
                          {subTimes.dur ? ` · ${subTimes.dur}` : ''}
                          {subTimes.overrun && phaseCutoff ? ` (חורג מ-${formatDateTimeShort(phaseCutoff.toISOString())})` : ''}
                        </span>
                      )}
                    </h4>
                    {isManager && !isLocked && <button onClick={() => {
                      refreshProposals();
                      setSelectedTask(null);
                      setSelectedTaskSubId(sub.id);
                      setSelectedTaskPhaseOrder(phase.orderIndex);
                      setSelectedTaskPhaseStart(phase.plannedStart ?? undefined);
                      setSelectedTaskPhaseEnd(phase.plannedEnd ?? undefined);
                    }} className="cursor-pointer rounded-md border-none bg-primary px-3.5 py-1.5 text-[15px] font-semibold text-white">+ משימה</button>}
                  </div>

                  {!collapsedSubPhases.has(sub.id) && (() => {
                    const sortedTasks = [...(sub.tasks || [])].sort(
                      (a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
                    );
                    const orderMap = new Map(sortedTasks.map((t: any, i: number) => [t.id, i + 1]));
                    const filteredTasks = sortedTasks.filter((task: any) => !filterTeam || task.assignedTeam?.id === filterTeam || task.assignedTeamId === filterTeam);
                    return (<>
                      {filteredTasks.length > 0 && <VersionTaskHeader isLocked={isLocked} isManager={isManager} />}
                      {filteredTasks.map((task: any) => {
                        const displayOrder = orderMap.get(task.id) ?? task.orderIndex;
                        return (
                      editingTask?.id === task.id ? (
                        <div key={task.id} className="mb-1.5 rounded-lg border border-sky-200 bg-[#f0f7ff] p-3.5">
                          {/* Row 1: title | user (filtered) | team (filtered) */}
                          <div className="mb-2 grid grid-cols-[2fr_1fr_1fr] gap-2">
                            <input value={editingTask.title} onChange={e => setEditingTask({ ...editingTask, title: e.target.value })} placeholder="שם המשימה" className="rounded-md border border-neutral-300 p-[7px] text-[15px]" />
                            {/* User with letter filter */}
                            <div className="flex flex-col gap-0.5">
                              <input value={editFilters.user} onChange={e => setEditFilters(f => ({ ...f, user: e.target.value }))}
                                placeholder="סנן עובד..." className="rounded-t-md border border-b-0 border-neutral-300 px-[7px] py-1 text-[13px]" />
                              <select value={editingTask.assignedUserName || ''} onChange={e => setEditingTask({ ...editingTask, assignedUserName: e.target.value })}
                                className="rounded-b-md border border-t-0 border-neutral-300 px-[7px] py-[5px] text-[15px]">
                                <option value="">-- עובד --</option>
                                {(editingTask.assignedTeamId
                                  ? (teams.find((t: any) => t.id === editingTask.assignedTeamId)?.members || []).map((m: any) => m.user).filter(Boolean)
                                  : users
                                ).filter((u: any) => !editFilters.user || u.fullName.toLowerCase().startsWith(editFilters.user.toLowerCase()))
                                  .map((u: any) => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
                              </select>
                            </div>
                            {/* Team with letter filter */}
                            <div className="flex flex-col gap-0.5">
                              <input value={editFilters.team} onChange={e => setEditFilters(f => ({ ...f, team: e.target.value }))}
                                placeholder="סנן צוות..." className="rounded-t-md border border-b-0 border-neutral-300 px-[7px] py-1 text-[13px]" />
                              <select value={editingTask.assignedTeamId || ''} onChange={e => setEditingTask({ ...editingTask, assignedTeamId: e.target.value, assignedUserName: '', application: '' })}
                                className="rounded-b-md border border-t-0 border-neutral-300 px-[7px] py-[5px] text-[15px]">
                                <option value="">צוות</option>
                                {teams.filter((t: any) => t.active && (!editFilters.team || t.name.toLowerCase().startsWith(editFilters.team.toLowerCase()))).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </select>
                            </div>
                          </div>
                          {/* Row 2: CR# | app (filtered) | env | duration (minutes) */}
                          <div className="mb-2 grid grid-cols-4 gap-2">
                            <div>
                              {(() => {
                                const crList = (editingTask.crNumber || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                                return (
                                  <div className="box-border flex min-h-[34px] flex-wrap items-center gap-1 rounded-md border border-neutral-300 bg-white px-1.5 py-1">
                                    {crList.map((cr: string) => (
                                      <span key={cr} className="inline-flex items-center gap-[3px] rounded bg-[#e8f4fd] px-1.5 py-0.5 text-sm text-[#2980b9]">
                                        {cr}
                                        <button onClick={() => setEditingTask({ ...editingTask, crNumber: crList.filter((c: string) => c !== cr).join(',') })}
                                          className="cursor-pointer border-none bg-transparent p-0 text-[15px] leading-none text-[#2980b9]">×</button>
                                      </span>
                                    ))}
                                    <input
                                      list="cr-datalist"
                                      value={editCrInput}
                                      onChange={e => {
                                        setEditCrInput(e.target.value);
                                        const match = crItems.find(c => c.id === e.target.value || c.label === e.target.value);
                                        if (match) {
                                          if (!crList.includes(match.id)) {
                                            setEditingTask({ ...editingTask, crNumber: [...crList, match.id].join(',') });
                                          }
                                          setEditCrInput('');
                                        }
                                      }}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter' && editCrInput.trim()) {
                                          e.preventDefault();
                                          if (!crList.includes(editCrInput.trim())) {
                                            setEditingTask({ ...editingTask, crNumber: [...crList, editCrInput.trim()].join(',') });
                                          }
                                          setEditCrInput('');
                                        }
                                      }}
                                      placeholder={crList.length === 0 ? 'CR# (Enter להוספה)' : '+ הוסף CR'}
                                      className="min-w-[110px] flex-1 border-none px-1 py-0.5 text-[15px] outline-none"
                                    />
                                  </div>
                                );
                              })()}
                            </div>
                            {/* Application with letter filter */}
                            <div className="flex flex-col gap-0.5">
                              <input value={editFilters.app} onChange={e => setEditFilters(f => ({ ...f, app: e.target.value }))}
                                placeholder="סנן..." className="rounded-t-md border border-b-0 border-neutral-300 px-[7px] py-1 text-[13px]" />
                              <select value={editingTask.application || ''} onChange={e => setEditingTask({ ...editingTask, application: e.target.value })}
                                className="rounded-b-md border border-t-0 border-neutral-300 px-[7px] py-[5px] text-[15px]">
                                <option value="">Application</option>
                                {(editingTask.assignedTeamId
                                  ? (teams.find((t: any) => t.id === editingTask.assignedTeamId)?.apps?.length
                                      ? teams.find((t: any) => t.id === editingTask.assignedTeamId).apps
                                      : APPS)
                                  : APPS
                                ).filter((a: string) => !editFilters.app || a.toLowerCase().startsWith(editFilters.app.toLowerCase()))
                                  .map((a: string) => <option key={a} value={a}>{a}</option>)}
                              </select>
                            </div>
                            <select value={editingTask.environment || 'BOTH'} onChange={e => setEditingTask({ ...editingTask, environment: e.target.value })} className="rounded-md border border-neutral-300 p-[7px] text-[15px]">
                              <option value="BOTH">HOT + HOTNET</option>
                              <option value="HOT">HOT בלבד</option>
                              <option value="HOTNET">HOTNET בלבד</option>
                            </select>
                            <div>
                              <label className="mb-0.5 block text-[13px] text-neutral-500">משך (דקות)</label>
                              <input type="number" min="1" value={editingTask._durationMins || ''}
                                onChange={e => {
                                  const mins = parseInt(e.target.value);
                                  const upd: any = { ...editingTask, _durationMins: e.target.value };
                                  if (mins > 0 && upd.plannedStart) upd.plannedEnd = calcEndFromMins(upd.plannedStart, mins);
                                  setEditingTask(upd);
                                }}
                                onBlur={e => {
                                  const mins = parseInt(e.target.value);
                                  if (mins > 0 && editingTask.plannedStart)
                                    setEditingTask((t: any) => ({ ...t, plannedEnd: calcEndFromMins(t.plannedStart, mins) }));
                                }}
                                placeholder="דקות" className="box-border w-full rounded-md border border-neutral-300 p-[7px] text-[15px]" />
                            </div>
                          </div>
                          {/* Row 3: start | end (auto-calculated, read-only) */}
                          <div className="mb-2 grid grid-cols-2 gap-2">
                            <div>
                              <label className="mb-[3px] block text-[13px] text-neutral-500">תחילת משימה</label>
                              <DateTimeField value={editingTask.plannedStart ? utcToLocalInputStr(editingTask.plannedStart) : ''}
                                onChange={v => {
                                  const upd: any = { ...editingTask, plannedStart: v };
                                  const mins = parseInt(upd._durationMins);
                                  if (mins > 0 && upd.plannedStart) upd.plannedEnd = calcEndFromMins(upd.plannedStart, mins);
                                  setEditingTask(upd);
                                }}
                                style={{ width: '100%', padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '15px', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <label className="mb-[3px] block text-[13px] text-neutral-500">סיום משימה (מחושב)</label>
                              <DateTimeField disabled value={editingTask.plannedEnd ? utcToLocalInputStr(editingTask.plannedEnd) : ''} onChange={() => {}}
                                style={{ width: '100%', padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '15px', boxSizing: 'border-box', background: '#f5f5f5', color: '#666' }} />
                            </div>
                          </div>
                          {/* Row 4: dependency note | general note */}
                          <div className="mb-2 grid grid-cols-2 gap-2">
                            <input value={editingTask.dependencyNote || ''} onChange={e => setEditingTask({ ...editingTask, dependencyNote: e.target.value })} placeholder="הערת תלות (תלוי ב...)" className="rounded-md border border-neutral-300 p-[7px] text-[15px]" />
                            <input value={editingTask.notes || ''} onChange={e => setEditingTask({ ...editingTask, notes: e.target.value })} placeholder="הערה כללית" className="rounded-md border border-neutral-300 p-[7px] text-[15px]" />
                          </div>
                          {/* Row 5: dependency picker */}
                          {(() => {
                            const eligibleTasks = version.phases
                              .filter((p: any) => p.orderIndex <= phase.orderIndex)
                              .flatMap((p: any) =>
                                (p.subPhases || []).map((s: any) => ({
                                  phaseLabel: p.name,
                                  tasks: s.tasks || [],
                                }))
                              )
                              .flatMap(({ phaseLabel, tasks: ts }: any) =>
                                ts.map((t: any) => ({ ...t, phaseLabel }))
                              )
                              .filter((t: any) => t.id !== task.id);
                            const alreadyLinked = new Set((editingTask.dependencies || []).map((d: any) => d.dependsOnTaskId));
                            const available = eligibleTasks.filter((t: any) => !alreadyLinked.has(t.id));
                            return (
                              <div className="mb-2 rounded-md border border-neutral-300 bg-[#f9f9ff] px-2.5 py-2">
                                <label className="mb-1.5 block text-[13px] text-neutral-500">תלויות — המשימה תחכה לסיום:</label>
                                {/* תגיות תלויות קיימות */}
                                {(editingTask.dependencies || []).length > 0 && (
                                  <div className="mb-1.5 flex flex-wrap gap-1">
                                    {(editingTask.dependencies || []).map((dep: any) => (
                                      <span key={dep.dependsOnTaskId} className="flex items-center gap-1 rounded-xl bg-[#e8f4fd] px-2 py-0.5 text-sm text-[#2d4a7a]">
                                        🔗 {dep.dependsOn?.title || dep.dependsOnTaskId}
                                        <button
                                          onClick={() => removeDep(dep.dependsOnTaskId)}
                                          className="cursor-pointer border-none bg-transparent px-0.5 text-[15px] font-bold leading-none text-red-700">
                                          ✕
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {/* הוספת תלות */}
                                {available.length > 0 && (() => {
                                  // Preview the dep's computed end time before the user clicks הוסף
                                  const previewDep = newDepId ? eligibleTasks.find((t: any) => t.id === newDepId) : null;
                                  let previewEnd: string | null = null;
                                  if (previewDep) {
                                    if (previewDep.plannedEnd) {
                                      previewEnd = utcToLocalInputStr(previewDep.plannedEnd);
                                    } else if (previewDep.plannedStart) {
                                      const pMins = parseDurationToMinutes(previewDep.duration || '');
                                      previewEnd = pMins && pMins > 0
                                        ? calcEndFromMins(utcToLocalInputStr(previewDep.plannedStart), pMins)
                                        : null;
                                    }
                                  }
                                  const previewTime = previewEnd
                                    ? fmtTimeShared(previewEnd)
                                    : null;
                                  return (
                                    <div className="flex flex-col gap-1">
                                      <div className="flex items-center gap-1.5">
                                        <select
                                          value={newDepId}
                                          onChange={e => setNewDepId(e.target.value)}
                                          className="flex-1 rounded-md border border-neutral-300 px-[7px] py-1.5 text-sm">
                                          <option value="">— בחר משימה תלויה —</option>
                                          {version.phases
                                            .filter((p: any) => p.orderIndex <= phase.orderIndex)
                                            .map((p: any) => (
                                              <optgroup key={p.id} label={p.name}>
                                                {(p.subPhases || []).flatMap((s: any) =>
                                                  (s.tasks || [])
                                                    .filter((t: any) => t.id !== task.id && !alreadyLinked.has(t.id))
                                                    .map((t: any) => (
                                                      <option key={t.id} value={t.id}>{t.title}</option>
                                                    ))
                                                )}
                                              </optgroup>
                                            ))}
                                        </select>
                                        <button
                                          disabled={!newDepId}
                                          onClick={() => {
                                            const depTask = eligibleTasks.find((t: any) => t.id === newDepId);
                                            if (depTask) addDep(depTask);
                                          }}
                                          className={cn(
                                            'whitespace-nowrap rounded-md border-none px-3 py-1.5 text-sm text-white',
                                            newDepId ? 'cursor-pointer bg-[#2d4a7a]' : 'cursor-not-allowed bg-neutral-300',
                                          )}>
                                          + הוסף
                                        </button>
                                      </div>
                                      {previewDep && (
                                        <div className={cn('ps-0.5 text-[13px]', previewTime ? 'text-[#2d7a3a]' : 'text-neutral-400')}>
                                          {previewTime
                                            ? `⏰ שעת תחילה תתעדכן ל: ${previewTime}`
                                            : '⚠️ לתלות זו אין תזמון — שעת תחילה לא תתעדכן אוטומטית'}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                                {available.length === 0 && (editingTask.dependencies || []).length === 0 && (
                                  <span className="text-sm text-neutral-400">אין משימות קודמות זמינות לקישור</span>
                                )}
                              </div>
                            );
                          })()}
                          <div className="flex items-center gap-2">
                            <button onClick={() => updateTask(task.id, editingTask)}
                              className={cn('min-w-[70px] cursor-pointer rounded-md border-none px-4 py-[7px] text-[15px] font-bold text-white transition-colors duration-base ease-out', editSaveOk ? 'bg-[#1a7a3c]' : 'bg-success')}>
                              {editSaveOk ? '✓' : 'שמור'}
                            </button>
                            <button onClick={() => setEditingTask(null)} className="cursor-pointer rounded-md border-none bg-neutral-100 px-4 py-[7px] text-[15px] text-neutral-800">ביטול</button>
                          </div>
                        </div>
                      ) : (() => {
                          const computedEnd = !task.plannedEnd && task.plannedStart && task.duration
                            ? computeEndFromDuration(task.plannedStart, task.duration)
                            : null;
                          const displayEnd = task.plannedEnd || computedEnd;
                          const sc = statusColor(task.status);
                          const envColor = task.environment === 'HOT' ? C.statusBlocked : task.environment === 'HOTNET' ? C.statusOpen : C.textMuted;
                          const envBg    = task.environment === 'HOT' ? C.bgBlocked    : task.environment === 'HOTNET' ? C.bgOpen    : C.bgNested;
                          const borderRight = task.environment === 'HOT' ? C.statusBlocked : task.environment === 'HOTNET' ? C.statusOpen : C.border;
                          return (
                            <div key={task.id}
                              draggable={!isLocked}
                              onClick={() => { setSelectedTask(task); setSelectedTaskPhaseStart(phase.plannedStart ?? undefined); setSelectedTaskPhaseEnd(phase.plannedEnd ?? undefined); }}
                              onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragging({ taskId: task.id, fromSubId: sub.id }); }}
                              onDragEnd={() => { setDragging(null); setDragOverSubId(null); setDragOverTaskId(null); }}
                              onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (dragging && dragging.fromSubId === sub.id && dragging.taskId !== task.id) setDragOverTaskId(task.id); }}
                              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverTaskId(t => t === task.id ? null : t); }}
                              onDrop={e => {
                                e.preventDefault(); e.stopPropagation();
                                if (!dragging || dragging.fromSubId !== sub.id || dragging.taskId === task.id) return;
                                setDragOverTaskId(null);
                                const currentTasks = [...(sub.tasks || [])].sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
                                const withoutDragged = currentTasks.filter((t: any) => t.id !== dragging.taskId);
                                const dropIdx = withoutDragged.findIndex((t: any) => t.id === task.id);
                                const draggedTask = currentTasks.find((t: any) => t.id === dragging.taskId)!;
                                withoutDragged.splice(dropIdx, 0, draggedTask);
                                axios.post(`${API}/versions/sub-phases/${sub.id}/reorder`, { taskIds: withoutDragged.map((t: any) => t.id) }, { headers }).then(() => onRefresh()).catch(console.error);
                                setDragging(null);
                              }}
                              // Row chrome mixes real drag/selection/environment state
                              // (background/border colors, opacity) — kept as computed
                              // inline style, same as before; only layout/transition
                              // became static classes. Handlers above are untouched.
                              className="flex min-h-[40px] cursor-pointer items-center transition-colors duration-fast ease-out"
                              style={{
                                background: selectedTask?.id === task.id ? C.bgActive : dragOverTaskId === task.id ? C.bgActive : dragging?.taskId === task.id ? C.bgHover : C.bgCard,
                                borderBottom: `1px solid ${C.border}`,
                                borderRight: `3px solid ${selectedTask?.id === task.id ? C.brand : borderRight}`,
                                borderTop: dragOverTaskId === task.id ? `2px solid ${C.brand}` : undefined,
                                opacity: dragging?.taskId === task.id ? 0.5 : 1,
                              }}>

                              {/* # */}
                              {/* # */}
                              <div style={{ width: `${TV.num}px`, flexShrink: 0, textAlign: 'center', fontSize: '14px', color: C.textDisabled, fontFamily: FONT }}>
                                #{displayOrder}
                              </div>

                              {/* Name */}
                              <div style={{ flex: `${TV_NAME_FLEX} 1 0`, minWidth: '80px', padding: `0 ${SP[2]}`, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '3px', overflow: 'hidden' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: '15px', fontWeight: WEIGHT.semibold, color: task.status === 'DONE' ? C.textDisabled : C.textPrimary, fontFamily: FONT, lineHeight: '1.3' }}>
                                    {task.isCritical && <span style={{ color: C.statusBlocked, fontSize: '12px', marginLeft: '4px' }}>●</span>}
                                    {task.isCriticalForGo && <span style={{ fontSize: '12px', background: '#fff3e0', color: '#d35400', padding: '1px 4px', borderRadius: '3px', marginLeft: '3px' }}>GO</span>}
                                    {task.title}
                                  </span>
                                  {lastConvertedAt && task.createdByTeamLead && task.createdAt &&
                                    new Date(task.createdAt) >= lastConvertedAt && (
                                    <span style={{ fontSize: '12px', fontWeight: WEIGHT.bold, color: '#28a745', background: 'rgba(40,167,69,0.12)', border: '1px solid rgba(40,167,69,0.3)', padding: '1px 6px', borderRadius: RADIUS.sm, flexShrink: 0, whiteSpace: 'nowrap' as any }}>
                                      ✦ חדש
                                    </span>
                                  )}
                                  {task.crNumber && task.crNumber.split(',').map((cr: string) => cr.trim()).filter(Boolean).map((cr: string) => (
                                    <span key={cr} style={{ fontSize: '13px', color: C.info, background: C.infoBg, padding: '0 5px', borderRadius: RADIUS.sm, fontFamily: FONT, flexShrink: 0 }}>CR# {cr}</span>
                                  ))}
                                  {task.notes && <span style={{ fontSize: '13px', color: C.textMuted, flexShrink: 0 }} title={task.notes}>📝</span>}
                                  {task.dependencyNote && <span style={{ fontSize: '13px', color: C.statusWaiting, flexShrink: 0 }} title={task.dependencyNote}>🔗</span>}
                                </div>
                              </div>

                              {/* Dependencies — right after name */}
                              <div style={{ flex: `${TV_DEPS_FLEX} 1 0`, minWidth: '80px', padding: `0 ${SP[1]}`, display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}>
                                {task.dependencies?.length > 0 ? (
                                  task.dependencies.slice(0, 3).map((d: any) => {
                                    const dep = d.dependsOn;
                                    const depDone = dep?.status === 'DONE';
                                    return (
                                      <span key={d.dependsOnTaskId} title={dep?.title || ''}
                                        style={{
                                          fontSize: '13px', fontFamily: FONT,
                                          color: depDone ? C.statusDone : C.statusBlocked,
                                          background: depDone ? C.bgDone : C.bgBlocked,
                                          border: `1px solid ${depDone ? C.statusDone + '44' : C.statusBlocked + '44'}`,
                                          padding: '2px 7px', borderRadius: RADIUS.sm,
                                          maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block',
                                        }}>
                                        {depDone ? '✓' : '⏳'} {dep?.title?.slice(0, 20) || '?'}
                                      </span>
                                    );
                                  })
                                ) : <span style={{ fontSize: '13px', color: C.textDisabled }}>—</span>}
                                {task.dependencies?.length > 3 && (
                                  <span style={{ fontSize: '13px', color: C.textMuted, fontFamily: FONT }}>+{task.dependencies.length - 3}</span>
                                )}
                              </div>

                              {/* Duration */}
                              <div style={{ width: `${TV.dur}px`, flexShrink: 0, textAlign: 'center' }}>
                                <span style={{ fontSize: '14px', color: task.duration ? C.warning : C.textDisabled, fontFamily: FONT }}>
                                  {task.duration || '—'}
                                </span>
                              </div>

                              {/* Start */}
                              <div style={{ width: `${TV.start}px`, flexShrink: 0, textAlign: 'center' }}>
                                {task.plannedStart ? (
                                  <span style={{ fontSize: '13px', color: C.textSecondary, fontFamily: FONT, lineHeight: '1.4', display: 'block' }}>
                                    {formatDateTimeShort(task.plannedStart)}
                                  </span>
                                ) : <span style={{ fontSize: '13px', color: C.textDisabled }}>—</span>}
                                {task.startedAt && (
                                  <span style={{ fontSize: '12px', color: C.statusDone, fontFamily: FONT, display: 'block' }}>▶ {formatDateTimeShort(task.startedAt)}</span>
                                )}
                              </div>

                              {/* End */}
                              <div style={{ width: `${TV.end}px`, flexShrink: 0, textAlign: 'center' }}>
                                {displayEnd ? (
                                  <span style={{ fontSize: '13px', color: C.statusInProgress, fontFamily: FONT, lineHeight: '1.4', display: 'block' }}>
                                    {formatDateTimeShort(displayEnd)}
                                    {isNextDay(task.plannedStart, displayEnd) && (
                                      <span style={{ fontSize: '12px', color: C.warning, marginRight: '3px' }}> (+1)</span>
                                    )}
                                    {computedEnd && !task.plannedEnd && <span style={{ color: C.textDisabled }}>*</span>}
                                  </span>
                                ) : <span style={{ fontSize: '13px', color: C.textDisabled }}>—</span>}
                                {task.completedAt && (
                                  <span style={{ fontSize: '12px', color: C.statusDone, fontFamily: FONT, display: 'block' }}>■ {formatDateTimeShort(task.completedAt)}</span>
                                )}
                              </div>

                              {/* Team */}
                              {(() => {
                                const teamName = task.assignedTeam?.name;
                                const tc = teamName ? teamColor(teamName) : null;
                                return (
                                  <div style={{ width: `${TV.team}px`, flexShrink: 0, padding: `0 ${SP[1]}`, textAlign: 'center', overflow: 'hidden' }}>
                                    {teamName ? (
                                      <span style={{ fontSize: '13px', fontFamily: FONT, fontWeight: WEIGHT.semibold, padding: '2px 7px', borderRadius: RADIUS.sm, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', color: tc!.color, background: tc!.bg }}>
                                        {teamName}
                                      </span>
                                    ) : <span style={{ fontSize: '13px', color: C.textDisabled }}>—</span>}
                                  </div>
                                );
                              })()}

                              {/* Assignee */}
                              <div style={{ width: `${TV.assignee}px`, flexShrink: 0, padding: `0 ${SP[2]}`, display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden', direction: 'ltr' }}>
                                {task.assignedUserName ? (
                                  <>
                                    <Avatar name={task.assignedUserName} size={20} />
                                    <span style={{ fontSize: '14px', color: C.textSecondary, fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                      {task.assignedUserName.split(' ')[0]}
                                    </span>
                                  </>
                                ) : <span style={{ fontSize: '13px', color: C.textDisabled }}>—</span>}
                              </div>

                              {/* Application */}
                              <div style={{ width: `${TV.app}px`, flexShrink: 0, padding: `0 ${SP[1]}`, textAlign: 'center', overflow: 'hidden' }}>
                                {task.application ? (
                                  <span style={{ fontSize: '13px', color: C.textSecondary, fontFamily: FONT, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {task.application}
                                  </span>
                                ) : <span style={{ fontSize: '13px', color: C.textDisabled }}>—</span>}
                              </div>

                              {/* Environment */}
                              <div style={{ width: `${TV.env}px`, flexShrink: 0, textAlign: 'center' }}>
                                <span style={{ fontSize: '13px', fontWeight: WEIGHT.semibold, color: envColor, background: envBg, fontFamily: FONT, padding: '2px 6px', borderRadius: RADIUS.sm }}>
                                  {task.environment === 'BOTH' ? 'HOT+HOTNET' : (task.environment || 'BOTH')}
                                </span>
                              </div>

                              {/* Status */}
                              <div style={{ width: `${TV.status}px`, flexShrink: 0, textAlign: 'center', display: 'flex', justifyContent: 'center' }}>
                                <StatusChip status={task.status} size="xs" dot />
                              </div>

                              {/* Actions */}
                              {isManager && !isLocked && (
                                <div onClick={e => e.stopPropagation()} style={{ width: `${TV.actions}px`, flexShrink: 0, padding: `0 ${SP[1]}`, display: 'flex', gap: '3px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-start' }}>
                                  <button onClick={() => duplicateTask(task.id)}
                                    style={{ padding: '3px 7px', background: C.bgNested, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: 'pointer', fontSize: '13px' }} title="שכפל">⧉</button>
                                  <button
                                    onClick={() => setDialog({
                                      title: 'המרה לתת-שלב',
                                      message: `להפוך את "${task.title}" לתת-שלב?\nהמשימה תימחק וייווצר תת-שלב חדש במקומה.\nהפעולה בלתי הפיכה.`,
                                      variant: 'warning',
                                      confirmLabel: 'המר לתת-שלב',
                                      cancelLabel: 'ביטול',
                                      onConfirm: async () => {
                                        await axios.post(`${API}/versions/tasks/${task.id}/promote`, {}, { headers });
                                        onRefresh();
                                      },
                                      onCancel: () => {},
                                    })}
                                    style={{ padding: '3px 7px', background: C.bgWaiting, color: C.statusWaiting, border: `1px solid ${C.statusWaiting}44`, borderRadius: RADIUS.sm, cursor: 'pointer', fontSize: '13px' }} title="המר לתת-שלב">▲</button>
                                  <button onClick={() => {
                                    setSelectedTask(task);
                                    setSelectedTaskSubId(undefined);
                                    setSelectedTaskPhaseStart(phase.plannedStart ?? undefined);
                                    setSelectedTaskPhaseEnd(phase.plannedEnd ?? undefined);
                                  }} style={{ padding: '3px 7px', background: C.warningBg, color: C.warning, border: `1px solid ${C.warning}44`, borderRadius: RADIUS.sm, cursor: 'pointer', fontSize: '13px' }} title="ערוך משימה">✏️</button>
                                  <button onClick={() => deleteTask(task.id, task.title)}
                                    style={{ padding: '3px 7px', background: C.dangerBg, color: C.danger, border: `1px solid ${C.danger}44`, borderRadius: RADIUS.sm, cursor: 'pointer', fontSize: '13px' }} title="מחק משימה">🗑</button>
                                </div>
                              )}
                            </div>
                          );
                        })()
                    ); })}
                    </>); })()}

                  {addingTask === sub.id && !isLocked && (
                    <div className="mt-2 rounded-lg border border-sky-200 bg-[#f0f7ff] p-4">
                      {/* הצעות ראשי צוותים — מסוננות לפי שלב */}
                      {FEATURES.TEAM_LEAD_PROPOSAL && (() => {
                        const phaseProposals = proposals.filter((p: any) => p.phase === phase.orderIndex);
                        if (phaseProposals.length === 0) return null;
                        return (
                          <div className="mb-3 rounded-lg border-2 border-[#27ae60] bg-[#f0faf4] p-[10px_14px]">
                            <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-[#1a5c2a]">
                              <span className="rounded-[10px] bg-[#27ae60] px-2 py-0.5 text-[13px] text-white">
                                {phaseProposals.length}
                              </span>
                              💡 הצעות ראשי צוותים לשלב זה
                            </div>
                            <div className="flex max-h-[200px] flex-col gap-1 overflow-y-auto">
                              {phaseProposals.map((p: any) => {
                                const isSelected = selectedProposalId === p.id;
                                const teamName = teams.find((t: any) => t.id === p.teamId)?.name || '';
                                const sel = isSelected;
                                return (
                                  <div key={p.id} onClick={() => {
                                    setSelectedProposalId(p.id);
                                    const submitter = users.find((u: any) => u.id === p.submittedBy);
                                    setNewTask((t: any) => ({
                                      ...t,
                                      title: p.title,
                                      application: p.app ?? '',
                                      crNumber: p.crNumber ?? '',
                                      _durationMins: p.estimatedMins ? String(p.estimatedMins) : '',
                                      notes: p.notes ?? '',
                                      assignedUserName: p.assignedUserName || submitter?.fullName || t.assignedUserName,
                                    }));
                                    if (p.teamId) setSelectedTeam(p.teamId);
                                  }}
                                    className="cursor-pointer rounded-lg border-s-4 p-[10px_12px] transition-[background-color,border-color] duration-fast ease-out"
                                    style={{
                                      background: sel ? '#1a5c2a' : 'white',
                                      border: `1px solid ${sel ? '#27ae60' : '#c3e6cb'}`,
                                      borderInlineStartColor: sel ? '#27ae60' : '#a8d5b5',
                                    }}>
                                    {/* שורה 1: CR badge + כותרת */}
                                    <div className="mb-1.5 flex items-center gap-2">
                                      {p.crNumber && (
                                        <span className={cn('shrink-0 rounded px-2 py-0.5 font-mono text-[13px] font-bold text-white', sel ? 'bg-white/20' : 'bg-[#1a2332]')}>
                                          {p.crNumber}
                                        </span>
                                      )}
                                      <span className={cn('flex-1 text-[15px] font-bold', sel ? 'text-white' : 'text-[#1a2332]')}>
                                        {p.title}
                                      </span>
                                    </div>
                                    {/* שורה 2: badges */}
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {teamName && (
                                        <span className={cn('rounded px-2 py-0.5 text-sm font-semibold', sel ? 'bg-white/15 text-white/90' : 'bg-[#eef3fb] text-[#2d4a7a]')}>
                                          👥 {teamName}
                                        </span>
                                      )}
                                      {p.app && (
                                        <span className={cn('rounded border px-2 py-0.5 text-sm font-semibold', sel ? 'border-transparent bg-white/15 text-white/90' : 'border-[#dde3ee] bg-[#f0f4fa] text-neutral-800')}>
                                          {p.app}
                                        </span>
                                      )}
                                      {p.estimatedMins && (
                                        <span className={cn('text-sm font-semibold', sel ? 'text-white/80' : 'text-neutral-600')}>
                                          ⏱ {p.estimatedMins} דק'
                                        </span>
                                      )}
                                      {p.assignedUserName && (
                                        <span className={cn('text-sm', sel ? 'text-white/75' : 'text-neutral-600')}>
                                          👤 {p.assignedUserName}
                                        </span>
                                      )}
                                      {p.notes && (
                                        <span className={cn('text-[13px] italic', sel ? 'text-white/65' : 'text-neutral-400')}>
                                          💬 {cleanHtmlText(p.notes)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            {selectedProposalId && (
                              <button type="button" onClick={() => { setSelectedProposalId(null); setNewTask(EMPTY_TASK); }}
                                className="mt-1.5 cursor-pointer border-none bg-transparent p-0 text-[13px] text-neutral-500">
                                ✕ נקה בחירה
                              </button>
                            )}
                            <div className="mt-1 text-[13px] text-neutral-600">לחץ על הצעה לטעינה אוטומטית — ניתן לערוך לפני השמירה</div>
                          </div>
                        );
                      })()}
                      {/* Row 1: title | team | user (filtered by team) */}
                      <div className="mb-2 grid grid-cols-[2fr_1fr_1fr] gap-2">
                        <input placeholder="שם המשימה *" value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} className="rounded-md border border-neutral-300 p-2 text-[15px]" />
                        <select value={selectedTeam} onChange={e => {
                          setSelectedTeam(e.target.value);
                          setNewTask((t: any) => ({ ...t, assignedUserName: '' }));
                        }}
                          className="rounded-md border border-neutral-300 p-2 text-[15px]">
                          <option value="">צוות</option>
                          {teams.filter((t: any) => t.active).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        <select value={newTask.assignedUserName} onChange={e => setNewTask({ ...newTask, assignedUserName: e.target.value })}
                          className="rounded-md border border-neutral-300 p-2 text-[15px]">
                          <option value="">-- עובד אחראי --</option>
                          {(selectedTeam
                            ? (teams.find((t: any) => t.id === selectedTeam)?.members || [])
                                .map((m: any) => m.user)
                                .sort((a: any, b: any) => a.fullName.localeCompare(b.fullName, 'he'))
                            : users
                          ).map((u: any) => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
                        </select>
                      </div>
                      {/* Row 2: CR# | app (filtered) | env | duration (minutes) */}
                      <div className="mb-2 grid grid-cols-4 gap-2">
                        {(() => {
                          const crList = (newTask.crNumber || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                          return (
                            <div className="box-border flex min-h-[36px] flex-wrap items-center gap-1 rounded-md border border-neutral-300 bg-white px-1.5 py-1">
                              {crList.map((cr: string) => (
                                <span key={cr} className="inline-flex items-center gap-[3px] rounded bg-[#e8f4fd] px-1.5 py-0.5 text-sm text-[#2980b9]">
                                  {cr}
                                  <button onClick={() => setNewTask({ ...newTask, crNumber: crList.filter((c: string) => c !== cr).join(',') })}
                                    className="cursor-pointer border-none bg-transparent p-0 text-[15px] leading-none text-[#2980b9]">×</button>
                                </span>
                              ))}
                              <input
                                list="cr-datalist"
                                value={newCrInput}
                                onChange={e => {
                                  setNewCrInput(e.target.value);
                                  const match = crItems.find(c => c.id === e.target.value || c.label === e.target.value);
                                  if (match) {
                                    if (!crList.includes(match.id)) {
                                      setNewTask({ ...newTask, crNumber: [...crList, match.id].join(',') });
                                    }
                                    setNewCrInput('');
                                  }
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' && newCrInput.trim()) {
                                    e.preventDefault();
                                    if (!crList.includes(newCrInput.trim())) {
                                      setNewTask({ ...newTask, crNumber: [...crList, newCrInput.trim()].join(',') });
                                    }
                                    setNewCrInput('');
                                  }
                                }}
                                placeholder={crList.length === 0 ? 'CR# (Enter להוספה)' : '+ הוסף CR'}
                                className="min-w-[110px] flex-1 border-none px-1 py-0.5 text-[15px] outline-none"
                              />
                            </div>
                          );
                        })()}
                        <select value={newTask.application} onChange={e => setNewTask({ ...newTask, application: e.target.value })}
                          className="rounded-md border border-neutral-300 p-2 text-[15px]">
                          <option value="">Application</option>
                          {(selectedTeam && (teams.find((t: any) => t.id === selectedTeam)?.apps || []).length > 0
                            ? teams.find((t: any) => t.id === selectedTeam).apps
                            : APPS
                          ).map((a: string) => <option key={a} value={a}>{a}</option>)}
                        </select>
                        <select value={newTask.environment} onChange={e => setNewTask({ ...newTask, environment: e.target.value })} className="rounded-md border border-neutral-300 p-2 text-[15px]">
                          <option value="BOTH">HOT + HOTNET</option>
                          <option value="HOT">HOT בלבד</option>
                          <option value="HOTNET">HOTNET בלבד</option>
                        </select>
                        <div>
                          <label className="mb-0.5 block text-[13px] text-neutral-500">משך (דקות)</label>
                          <input type="number" min="1" value={newTask._durationMins}
                            onChange={e => {
                              const mins = parseInt(e.target.value);
                              const upd: any = { ...newTask, _durationMins: e.target.value };
                              if (mins > 0 && upd.plannedStart) upd.plannedEnd = calcEndFromMins(upd.plannedStart, mins);
                              setNewTask(upd);
                            }}
                            onBlur={e => {
                              const mins = parseInt(e.target.value);
                              if (mins > 0 && newTask.plannedStart)
                                setNewTask((t: any) => ({ ...t, plannedEnd: calcEndFromMins(t.plannedStart, mins) }));
                            }}
                            placeholder="דקות" className="box-border w-full rounded-md border border-neutral-300 p-2 text-[15px]" />
                        </div>
                      </div>
                      {/* Row 3: start | end (auto-calculated) */}
                      <div className="mb-2 grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-[3px] block text-[13px] text-neutral-500">תחילת משימה</label>
                          <DateTimeField value={newTask.plannedStart}
                            onChange={v => {
                              const upd: any = { ...newTask, plannedStart: v };
                              const mins = parseInt(upd._durationMins);
                              if (mins > 0 && upd.plannedStart) upd.plannedEnd = calcEndFromMins(upd.plannedStart, mins);
                              setNewTask(upd);
                            }}
                            style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '15px', boxSizing: 'border-box' }} />
                        </div>
                        <div>
                          <label className="mb-[3px] block text-[13px] text-neutral-500">סיום משימה (מחושב)</label>
                          <DateTimeField disabled value={newTask.plannedEnd} onChange={() => {}}
                            style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '15px', boxSizing: 'border-box', background: '#f5f5f5', color: '#666' }} />
                        </div>
                      </div>
                      <div className="mb-2 grid grid-cols-2 gap-2">
                        <input placeholder="הערת תלות (תלוי ב...)" value={newTask.dependencyNote} onChange={e => setNewTask({ ...newTask, dependencyNote: e.target.value })} className="rounded-md border border-neutral-300 p-2 text-[15px]" />
                        <input placeholder="הערה כללית" value={newTask.notes} onChange={e => setNewTask({ ...newTask, notes: e.target.value })} className="rounded-md border border-neutral-300 p-2 text-[15px]" />
                      </div>
                      {/* Dependency task selector */}
                      {(() => {
                        const allTasksInScope = version.phases
                          .filter((p: any) => p.orderIndex <= phase.orderIndex)
                          .flatMap((p: any) => (p.subPhases || []).flatMap((s: any) => (s.tasks || [])));
                        const available = allTasksInScope.filter((t: any) => !newTaskDepIds.includes(t.id));
                        if (allTasksInScope.length === 0) return null;
                        return (
                          <div className="mb-2 rounded-md border border-neutral-300 bg-[#f9f9ff] px-2.5 py-2">
                            <label className="mb-1.5 block text-[13px] text-neutral-500">תלויות — המשימה תחכה לסיום:</label>
                            {newTaskDepIds.length > 0 && (
                              <div className="mb-1.5 flex flex-wrap gap-1">
                                {newTaskDepIds.map(depId => {
                                  const depTask = allTasksInScope.find((t: any) => t.id === depId);
                                  return (
                                    <span key={depId} className="flex items-center gap-1 rounded-xl bg-[#e8f4fd] px-2 py-0.5 text-sm text-[#2d4a7a]">
                                      🔗 {depTask?.title || depId}
                                      <button type="button" onClick={() => setNewTaskDepIds(ids => ids.filter(id => id !== depId))}
                                        className="cursor-pointer border-none bg-transparent px-0.5 text-[15px] font-bold leading-none text-red-700">✕</button>
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            {available.length > 0 && (
                              <div className="flex items-center gap-1.5">
                                <select value={newDepAddSelectId} onChange={e => setNewDepAddSelectId(e.target.value)}
                                  className="flex-1 rounded-md border border-neutral-300 px-[7px] py-1.5 text-sm">
                                  <option value="">— בחר משימה תלויה —</option>
                                  {version.phases
                                    .filter((p: any) => p.orderIndex <= phase.orderIndex)
                                    .map((p: any) => (
                                      <optgroup key={p.id} label={p.name}>
                                        {(p.subPhases || []).flatMap((s: any) =>
                                          (s.tasks || [])
                                            .filter((t: any) => !newTaskDepIds.includes(t.id))
                                            .map((t: any) => (
                                              <option key={t.id} value={t.id}>{t.title}</option>
                                            ))
                                        )}
                                      </optgroup>
                                    ))}
                                </select>
                                <button type="button" disabled={!newDepAddSelectId}
                                  onClick={() => {
                                    if (!newDepAddSelectId) return;
                                    const depTask = allTasksInScope.find((t: any) => t.id === newDepAddSelectId);
                                    setNewTaskDepIds(ids => [...ids, newDepAddSelectId]);
                                    setNewDepAddSelectId('');
                                    if (!depTask) return;
                                    // compute dep end time
                                    let depEnd = '';
                                    if (depTask.plannedEnd) {
                                      depEnd = utcToLocalInputStr(String(depTask.plannedEnd));
                                    } else if (depTask.plannedStart) {
                                      const sl = utcToLocalInputStr(String(depTask.plannedStart));
                                      const dm = parseDurationToMinutes(String(depTask.duration || ''));
                                      if (dm && dm > 0) depEnd = calcEndFromMins(sl, dm);
                                    }
                                    if (!depEnd) return;
                                    // update newTask with new start (and recompute end if duration set)
                                    const tm = parseInt(newTask._durationMins);
                                    const patch: any = { plannedStart: depEnd };
                                    if (tm > 0) patch.plannedEnd = calcEndFromMins(depEnd, tm);
                                    setNewTask((t: any) => ({ ...t, ...patch }));
                                  }}
                                  className={cn('whitespace-nowrap rounded-md border-none px-3 py-1.5 text-sm text-white', newDepAddSelectId ? 'cursor-pointer bg-[#2d4a7a]' : 'cursor-not-allowed bg-neutral-300')}>
                                  + הוסף
                                </button>
                              </div>
                            )}
                            {available.length === 0 && newTaskDepIds.length === 0 && (
                              <span className="text-sm text-neutral-400">אין משימות קודמות זמינות לקישור</span>
                            )}
                          </div>
                        );
                      })()}
                      <div className="flex gap-2">
                        <button onClick={() => addTask(sub.id)} disabled={!newTask.title} className={cn('rounded-md border-none px-4 py-2 text-[15px] font-bold text-white', newTask.title ? 'cursor-pointer bg-success' : 'cursor-not-allowed bg-neutral-300')}>הוסף</button>
                        <button onClick={() => { setAddingTask(null); setNewTask(EMPTY_TASK); setNewTaskDepIds([]); setNewDepAddSelectId(''); }} className="cursor-pointer rounded-md border-none bg-neutral-100 px-4 py-2 text-[15px] text-neutral-800">ביטול</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {!collapsedPhases.has(phase.id) && !(phase.subPhases?.length > 0) && !isLocked && (
              <div className="flex items-center gap-2.5 p-[14px_16px] text-[15px] text-muted-foreground">
                <span>אין תת-שלבים בשלב זה.</span>
                {isManager && (
                  <button onClick={() => addSubPhase(phase.id)} disabled={phaseManageLoading}
                    className="cursor-pointer rounded-md border-none bg-primary px-3.5 py-1.5 text-[15px] font-semibold text-white">
                    + הוסף תת-שלב
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Add Phase + error ── */}
      {isManager && !isLocked && (
        <div className="mb-3">
          {phaseManageError && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-red-500 bg-red-50 px-3.5 py-2 text-[15px] text-red-700">
              ⚠️ {phaseManageError}
              <button onClick={() => setPhaseManageError(null)} className="cursor-pointer border-none bg-transparent font-bold text-red-700">×</button>
            </div>
          )}
          {addingPhase ? (
            <div className="flex items-center gap-2 rounded-xl bg-white p-[12px_16px] shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
              <input
                autoFocus
                value={newPhaseName}
                onChange={e => setNewPhaseName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addPhase(); if (e.key === 'Escape') { setAddingPhase(false); setNewPhaseName(''); } }}
                placeholder="שם השלב החדש"
                className="flex-1 rounded-md border-2 border-[#2d4a7a] px-3 py-2 text-[15px]"
              />
              <button onClick={addPhase} disabled={!newPhaseName.trim() || phaseManageLoading} className="cursor-pointer rounded-md border-none bg-[#2d4a7a] px-4 py-2 text-[15px] font-bold text-white">הוסף</button>
              <button onClick={() => { setAddingPhase(false); setNewPhaseName(''); }} className="cursor-pointer rounded-md border-none bg-neutral-100 px-3.5 py-2 text-[15px] text-neutral-800">ביטול</button>
            </div>
          ) : (
            <button
              onClick={() => setAddingPhase(true)}
              className="w-full cursor-pointer rounded-xl border-2 border-dashed border-[#2d4a7a] bg-white px-[18px] py-2 text-[15px] font-bold text-[#2d4a7a]">
              + הוסף שלב
            </button>
          )}
        </div>
      )}
    </>}

      {/* ── דיאלוג אישור העברת משימה ── */}
      {moveConfirm && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/45">
          <div dir="rtl" className="w-[90%] max-w-[420px] rounded-2xl bg-white p-[28px_32px] shadow-[0_8px_32px_rgba(0,0,0,0.25)]">
            <div className="mb-3 text-center text-[28px]">🚚</div>
            <h3 className="m-0 mb-2.5 text-center text-[#1a2332]">העברת משימה</h3>
            <p className="m-0 mb-5 text-center text-[15px] leading-relaxed text-neutral-700">
              להעביר את <strong>"{moveConfirm.taskTitle}"</strong><br />
              לתת-שלב <strong>"{moveConfirm.targetSubName}"</strong>?
            </p>
            <div className="flex justify-center gap-2.5">
              <button onClick={confirmMove} className="cursor-pointer rounded-lg border-none bg-[#2d4a7a] px-6 py-[9px] text-[15px] font-bold text-white">אשר העברה</button>
              <button onClick={() => setMoveConfirm(null)} className="cursor-pointer rounded-lg border-none bg-neutral-100 px-6 py-[9px] text-[15px] text-neutral-800">ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* ── דיאלוג תזמון מחדש ── */}
      {rescheduleOpen && (() => {
        // Compute overruns from current preview
        const overrunTaskIds = new Set<string>();
        if (reschPreview) {
          for (const u of reschPreview) {
            const phaseEnd = reschPhaseEnds[u.phaseId];
            if (phaseEnd && new Date(u.plannedEnd).getTime() > new Date(phaseEnd).getTime()) {
              overrunTaskIds.add(u.taskId);
            }
          }
        }
        // Group overrunning tasks by phase for display
        const overrunPhaseOrder: string[] = [];
        const overrunByPhase: Record<string, any[]> = {};
        if (reschPreview) {
          for (const u of reschPreview) {
            if (!overrunTaskIds.has(u.taskId)) continue;
            if (!overrunByPhase[u.phaseId]) { overrunByPhase[u.phaseId] = []; overrunPhaseOrder.push(u.phaseId); }
            overrunByPhase[u.phaseId].push(u);
          }
        }
        const totalOverrunTasks = overrunTaskIds.size;

        return (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50">
            <div dir="rtl" className="max-h-[92vh] min-w-[560px] max-w-[800px] overflow-y-auto rounded-2xl bg-white p-[28px_32px] shadow-[0_8px_40px_rgba(0,0,0,0.3)]">
              <h3 className="m-0 mb-1 text-[#1a2332]">📅 הכן ותזמן</h3>
              <p className="m-0 mb-4 text-[15px] text-neutral-600">
                הכן תלויות ומבנה, ואז הגדר שעות לכל שלב כדי לחשב את תוכנית הביצוע.
              </p>

              {/* ── Prep section ── */}
              <div className="mb-[18px] overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
                <div
                  onClick={() => { setPrepOpen(o => !o); setPrepMessage(null); }}
                  className="flex cursor-pointer select-none items-center justify-between p-[10px_16px]"
                >
                  <span className="text-[15px] font-bold text-[#1a2332]">🔧 הכנה לפני תזמון — תלויות ומבנה</span>
                  <span className="text-sm text-neutral-500">{prepOpen ? '▲ סגור' : '▼ פתח'}</span>
                </div>
                {prepOpen && (
                  <div className="border-t border-neutral-200 p-[14px_16px]">
                    <p className="m-0 mb-3 text-sm text-neutral-600">
                      הפעל לפי הסדר: סדר משימות ← תלויות לפי עובד ← עדכן שרשראות ← נקה תלויות שגויות
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={async () => {
                        try {
                          const res = await axios.post(`${API}/versions/${version.id}/fix-task-order`, {}, { headers });
                          setPrepMessage({ text: `✅ סדר משימות תוקן — ${res.data.fixed} משימות עודכנו`, ok: true });
                          onRefresh();
                        } catch (err: any) {
                          setPrepMessage({ text: `❌ ${err?.response?.data?.message || 'שגיאה בתיקון סדר משימות'}`, ok: false });
                        }
                      }} className="cursor-pointer rounded-lg border-none bg-[#2d4a7a] px-3.5 py-1.5 text-sm font-bold text-white">
                        🔢 סדר משימות
                      </button>
                      <button onClick={async () => {
                        try {
                          const res = await axios.post(`${API}/versions/${version.id}/auto-deps-by-user`, {}, { headers });
                          setLastUserDepPairs(res.data.createdPairs ?? []);
                          setPrepMessage({ text: `✅ תלויות לפי עובד — ${res.data.created} חדשות, ${res.data.skipped} קיימות`, ok: true });
                          onRefresh();
                        } catch (err: any) {
                          setPrepMessage({ text: `❌ ${err?.response?.data?.message || 'שגיאה ביצירת תלויות'}`, ok: false });
                        }
                      }} className="cursor-pointer rounded-lg border-none bg-[#7f3fbf] px-3.5 py-1.5 text-sm font-bold text-white">
                        👤 צור תלויות לפי עובד
                      </button>
                      {lastUserDepPairs && lastUserDepPairs.length > 0 && (
                        <button onClick={() => showConfirm(
                          'ביטול תלויות עובד',
                          `לבטל ${lastUserDepPairs.length} תלויות שנוצרו בריצה האחרונה?`,
                          async () => {
                            try {
                              const res = await axios.post(`${API}/versions/${version.id}/rollback-user-deps`, { pairs: lastUserDepPairs }, { headers });
                              setLastUserDepPairs(null);
                              setPrepMessage({ text: `✅ בוטלו ${res.data.deleted} תלויות`, ok: true });
                              onRefresh();
                            } catch (err: any) {
                              setPrepMessage({ text: `❌ ${err?.response?.data?.message || 'שגיאה ברולבק'}`, ok: false });
                            }
                          }, 'בטל תלויות', 'warning'
                        )} className="cursor-pointer rounded-lg border-none bg-[#e67e22] px-3.5 py-1.5 text-sm font-bold text-white">
                          ↩ בטל תלויות עובד ({lastUserDepPairs.length})
                        </button>
                      )}
                      <button onClick={async () => {
                        try {
                          const res = await axios.post(`${API}/versions/${version.id}/resolve-deps`, {}, { headers });
                          setPrepMessage({ text: `✅ שרשראות תלות עודכנו — ${res.data.resolved} טופלו`, ok: true });
                          onRefresh();
                        } catch (err: any) {
                          setPrepMessage({ text: `❌ ${err?.response?.data?.message || 'שגיאה בעדכון תלויות'}`, ok: false });
                        }
                      }} className="cursor-pointer rounded-lg border-none bg-[#7f3fbf] px-3.5 py-1.5 text-sm font-bold text-white">
                        🔗 עדכן שרשראות תלות
                      </button>
                      <button onClick={() => showConfirm(
                        'ניקוי תלויות שגויות',
                        'למחוק תלויות בין-שלביות שגויות? פעולה זו אינה הפיכה.',
                        async () => {
                          try {
                            const res = await axios.post(`${API}/versions/${version.id}/fix-cross-phase-deps`, {}, { headers });
                            setPrepMessage({ text: `✅ נמחקו ${res.data.deleted} תלויות בין-שלביות`, ok: true });
                            onRefresh();
                          } catch (err: any) {
                            setPrepMessage({ text: `❌ ${err?.response?.data?.message || 'שגיאה'}`, ok: false });
                          }
                        }, 'נקה', 'warning'
                      )} className="cursor-pointer rounded-lg border-none bg-[#c0392b] px-3.5 py-1.5 text-sm font-bold text-white">
                        🗑 נקה תלויות בין-שלביות
                      </button>
                    </div>
                    {prepMessage && (
                      <div className={cn('mt-2.5 rounded-lg border p-[8px_12px] text-sm', prepMessage.ok ? 'border-green-300 bg-[#d5f0dc] text-[#1a5c2a]' : 'border-red-500 bg-red-50 text-[#c0392b]')}>
                        {prepMessage.text}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Dependencies toggle */}
              <label className="mb-4 flex cursor-pointer select-none items-center gap-2">
                <input type="checkbox" checked={reschRespectDeps} onChange={e => setReschRespectDeps(e.target.checked)}
                  className="h-4 w-4 cursor-pointer" />
                <span className="text-[15px] text-[#1a2332]">התחשב בתלויות בין משימות</span>
                <span className="text-[13px] text-neutral-500">(שעת התחלה = max(תחילת השלב, סיום תלויות))</span>
              </label>

              {/* Phase start/end inputs */}
              <div className="mb-1.5 grid grid-cols-3 gap-2 ps-0.5 text-[13px] font-bold text-neutral-500">
                <span>שלב</span><span className="text-center">שעת התחלה</span><span className="text-center">שעת סיום (יעד)</span>
              </div>
              <div className="mb-[18px] flex flex-col gap-[7px]">
                {([...(version.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex)).map((phase: any, idx: number, arr: any[]) => {
                  const prevPhase = idx > 0 ? arr[idx - 1] : null;

                  // Compute previous phase's known end (from preview data, or DB stored end)
                  let prevEnd: Date | null = null;
                  if (prevPhase) {
                    if (reschPreview) {
                      const prevTasks = reschPreview.filter((u: any) => u.phaseId === prevPhase.id);
                      if (prevTasks.length > 0)
                        prevEnd = new Date(Math.max(...prevTasks.map((u: any) => new Date(u.plannedEnd).getTime())));
                    }
                    if (!prevEnd && prevPhase.plannedEnd)
                      prevEnd = new Date(prevPhase.plannedEnd);
                  }

                  const thisStart = reschPhaseStarts[phase.id] ? new Date(reschPhaseStarts[phase.id]) : null;
                  const hasOverlap = !!(prevEnd && thisStart && thisStart.getTime() < prevEnd.getTime());

                  return (
                    <div key={phase.id}>
                      <div className="grid grid-cols-3 items-center gap-2">
                        <label className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-bold text-[#1a2332]" title={phase.name}>{phase.name}</label>
                        <div>
                          <DateTimeField value={reschPhaseStarts[phase.id] || ''}
                            onChange={v => setReschPhaseStarts(prev => ({ ...prev, [phase.id]: v }))}
                            style={{ padding: '6px 8px', border: `1.5px solid ${hasOverlap ? '#e74c3c' : '#ddd'}`, borderRadius: '7px', fontSize: '14px', width: '100%', boxSizing: 'border-box' as any }} />
                          {hasOverlap && prevEnd && (
                            <div className="mt-0.5 text-xs text-red-500">
                              ⚠️ מתחיל לפני סיום השלב הקודם ({fmtDateTimeShared(prevEnd)})
                            </div>
                          )}
                        </div>
                        <DateTimeField value={reschPhaseEnds[phase.id] || ''}
                          onChange={v => setReschPhaseEnds(prev => ({ ...prev, [phase.id]: v }))}
                          style={{ padding: '6px 8px', border: '1.5px solid #e67e22', borderRadius: '7px', fontSize: '14px', width: '100%', boxSizing: 'border-box' as any }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {reschError && (
                <div className="mb-3 rounded-md border border-red-500 bg-red-50 px-3 py-2 text-[15px] text-[#c0392b]">
                  {reschError}
                </div>
              )}

              {reschWarnings.length > 0 && (
                <div className="mb-3 rounded-md border border-[#f39c12] bg-[#fff8e1] px-3 py-2 text-sm text-[#7d5200]">
                  <div className="mb-1 font-bold">⚠️ התאמות אוטומטיות — שלבים שהוזזו קדימה:</div>
                  {reschWarnings.map((w, i) => <div key={i}>• {w}</div>)}
                </div>
              )}

              {/* Preview — only overrunning tasks */}
              {reschPreview && (
                <div className="mb-4">
                  <div className="mb-2 flex items-center gap-2.5">
                    <span className="text-[15px] font-bold text-[#1a2332]">
                      תצוגה מקדימה — {reschPreview.length} משימות יעודכנו
                    </span>
                    {totalOverrunTasks > 0 ? (
                      <span className="rounded-[10px] border border-red-500 bg-red-50 px-2.5 py-0.5 text-sm font-bold text-[#c0392b]">
                        ⚠️ {totalOverrunTasks} משימות חורגות
                      </span>
                    ) : (
                      <span className="rounded-[10px] border border-green-300 bg-[#d5f0dc] px-2.5 py-0.5 text-sm text-[#1a5c2a]">
                        ✅ אין חריגות
                      </span>
                    )}
                  </div>

                  {totalOverrunTasks > 0 && (
                    <div className="max-h-[320px] overflow-hidden overflow-y-auto rounded-lg border border-neutral-200">
                      {overrunPhaseOrder.map(phaseId => {
                        const tasks = overrunByPhase[phaseId];
                        const phaseEndStr = reschPhaseEnds[phaseId];
                        return (
                          <React.Fragment key={phaseId}>
                            {/* Phase header */}
                            <div className="flex justify-between border-b border-[#ffe0b2] bg-[#fff3e0] px-3 py-1.5 text-sm font-bold text-[#b7380a]">
                              <span>{tasks[0]?.phaseName}</span>
                              {phaseEndStr && (
                                <span className="font-normal text-[#c0392b]">
                                  יעד סיום: {formatDateTimeShort(phaseEndStr)}
                                </span>
                              )}
                            </div>
                            {/* Overrunning task rows */}
                            {tasks.map((u: any) => {
                              const isEditing = reschEditingId === u.taskId;
                              const overrunMins = phaseEndStr
                                ? Math.round((new Date(u.plannedEnd).getTime() - new Date(phaseEndStr).getTime()) / 60000)
                                : 0;
                              return (
                                <div key={u.taskId} className={cn('border-b border-neutral-100', isEditing ? 'bg-[#fffbf0]' : 'bg-[#fff8f8]')}>
                                  {/* Task info row */}
                                  <div className="flex items-center gap-2 p-[7px_12px]">
                                    <div className="flex-1 text-sm">
                                      <span className="font-bold text-[#1a2332]">{u.title}</span>
                                      <span className="ms-2 font-mono text-[13px] text-neutral-500">
                                        {formatDateTimeShort(u.plannedStart)} — <span className="font-bold text-[#c0392b]">{formatDateTimeShort(u.plannedEnd)}</span>
                                      </span>
                                      {u.duration && <span className="rounded bg-[#fef9e7] px-1.5 py-0.5 text-[13px] text-[#b7950b]">⏱ {u.duration}</span>}
                                      {overrunMins > 0 && (
                                        <span className="ms-1.5 text-[13px] text-[#c0392b]">({overrunMins} דק' חריגה)</span>
                                      )}
                                    </div>
                                    <button
                                      onClick={() => {
                                        if (isEditing) { setReschEditingId(null); setReschEditStart(''); setReschEditDur(''); setReschEditEnd(''); }
                                        else { setReschEditingId(u.taskId); setReschEditStart(utcToLocalInputStr(u.plannedStart)); setReschEditDur(u.duration || ''); setReschEditEnd(utcToLocalInputStr(u.plannedEnd)); }
                                      }}
                                      className={cn('cursor-pointer whitespace-nowrap rounded-md border-none px-2.5 py-[3px] text-[13px] text-white', isEditing ? 'bg-neutral-600' : 'bg-[#e67e22]')}>
                                      {isEditing ? '✕ סגור' : '✏️ תקן'}
                                    </button>
                                  </div>
                                  {/* Inline edit form */}
                                  {isEditing && (
                                    <div className="flex flex-wrap items-end gap-2.5 border-t border-[#ffe082] bg-[#fffde7] p-[10px_12px]">
                                      <div>
                                        <div className="mb-0.5 text-[13px] font-bold text-[#3498db]">שעת התחלה</div>
                                        <DateTimeField value={reschEditStart}
                                          onChange={v => {
                                            setReschEditStart(v);
                                            const mins = parseDurationToMinutes(reschEditDur);
                                            if (mins && mins > 0 && v) setReschEditEnd(calcEndFromMins(v, mins));
                                          }}
                                          style={{ padding: '5px 8px', border: '1.5px solid #3498db', borderRadius: '6px', fontSize: '14px' }} />
                                      </div>
                                      <div className="pb-1 font-bold text-neutral-300">|</div>
                                      <div>
                                        <div className="mb-0.5 text-[13px] text-neutral-600">משך (45ד' / 1ש' 30ד')</div>
                                        <input value={reschEditDur}
                                          onChange={e => {
                                            const v = e.target.value;
                                            setReschEditDur(v);
                                            const mins = parseDurationToMinutes(v);
                                            if (mins && mins > 0 && reschEditStart) setReschEditEnd(calcEndFromMins(reschEditStart, mins));
                                          }}
                                          placeholder="למשל: 30ד'"
                                          className="w-[100px] rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
                                      </div>
                                      <div className="pb-1 font-bold text-neutral-500">→</div>
                                      <div>
                                        <div className="mb-0.5 text-[13px] text-neutral-600">שעת סיום</div>
                                        <DateTimeField value={reschEditEnd} onChange={v => setReschEditEnd(v)}
                                          style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }} />
                                      </div>
                                      <button onClick={() => applyTaskEdit(u.taskId)}
                                        className="cursor-pointer rounded-md border-none bg-success px-3.5 py-1.5 text-sm font-bold text-white">
                                        עדכן חישוב
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-wrap justify-end gap-2.5 border-t border-neutral-200 pt-3.5">
                <button onClick={() => { setRescheduleOpen(false); setReschPreview(null); setReschEditingId(null); }}
                  className="cursor-pointer rounded-lg border-none bg-neutral-100 px-[18px] py-2 text-[15px]">
                  ביטול
                </button>
                <button onClick={applyPhaseStartToAllTasks} disabled={reschLoading}
                  className={cn('rounded-lg border-none bg-[#7f3fbf] px-[18px] py-2 text-[15px] text-white', reschLoading ? 'cursor-not-allowed' : 'cursor-pointer')}>
                  {reschLoading ? '...' : '⚡ קבע שעת שלב לכל המשימות'}
                </button>
                <button onClick={previewReschedule} disabled={reschLoading}
                  className={cn('rounded-lg border-none bg-[#2d4a7a] px-[18px] py-2 text-[15px] text-white', reschLoading ? 'cursor-not-allowed' : 'cursor-pointer')}>
                  {reschLoading ? '...' : '👁 חשב ותצוגה מקדימה'}
                </button>
                {reschPreview && (
                  <button onClick={applyScheduleFromPreview} disabled={reschLoading}
                    className={cn('rounded-lg border-none bg-success px-[18px] py-2 text-[15px] font-bold text-white', reschLoading ? 'cursor-not-allowed' : 'cursor-pointer')}>
                    {reschLoading ? '...' : `✅ אשר ועדכן תוכנית (${reschPreview.length} משימות)`}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Global datalist for CR# combo-box — shared by add and edit forms */}
      <datalist id="cr-datalist">
        {crItems.map(cr => (
          <option key={cr.id} value={cr.id}>{cr.label}</option>
        ))}
      </datalist>

      {/* ── Save template modal ── */}
      {saveTemplateOpen && (() => {
        const selectedTemplate = localTemplates.find(t => t.id === saveTemplateSelectId);
        const effectiveName = saveTemplateMode === 'update'
          ? (selectedTemplate?.name ?? '')
          : saveTemplateName.trim();
        const canSave = !!effectiveName && !savingTemplate;

        const doSave = async () => {
          if (!canSave) return;
          setSavingTemplate(true);
          try {
            await axios.post(`${API}/version-templates/from-version/${version.id}`, { name: effectiveName }, { headers });
            setSaveTemplateOpen(false);
            // Refresh local template list
            const res = await axios.get(`${API}/version-templates`, { headers });
            setLocalTemplates(res.data);
            const verb = saveTemplateMode === 'update' ? 'עודכנה' : 'נשמרה';
            showAlert('תבנית נשמרה', `התבנית "${effectiveName}" ${verb} בהצלחה עם כל נתוני העובדים והצוותים.`, 'success');
          } catch (err: any) {
            showAlert('שגיאה', err?.response?.data?.message || 'שגיאה בשמירת התבנית', 'danger');
          } finally {
            setSavingTemplate(false);
          }
        };

        return (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/45">
            <div dir="rtl" className="w-[460px] max-w-[95vw] rounded-2xl bg-white p-7 shadow-[0_8px_32px_rgba(0,0,0,0.25)]">
              <h3 className="m-0 mb-1.5 text-lg text-[#1a2332]">💾 שמירת תבנית</h3>
              <p className="m-0 mb-5 text-[15px] text-neutral-600">
                שומר עותק מלא של הגרסה כולל שמות עובדים, צוותים ותלויות.
              </p>

              {/* Mode selector */}
              <div className="mb-5 flex flex-col gap-3">
                {localTemplates.length > 0 && (
                  <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-xl border-2 p-3', saveTemplateMode === 'update' ? 'border-green-500 bg-[#f0faf4]' : 'border-neutral-200 bg-white')}>
                    <input type="radio" name="tplMode" value="update" checked={saveTemplateMode === 'update'} onChange={() => setSaveTemplateMode('update')} className="mt-0.5" />
                    <div className="flex-1">
                      <div className="mb-1.5 text-[15px] font-bold">🔄 עדכן תבנית קיימת</div>
                      <select
                        value={saveTemplateSelectId}
                        onChange={e => { setSaveTemplateSelectId(e.target.value); setSaveTemplateMode('update'); }}
                        className="box-border w-full rounded-md border border-neutral-300 p-2 text-[15px]"
                      >
                        {localTemplates.map(t => (
                          <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>
                        ))}
                      </select>
                    </div>
                  </label>
                )}
                <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-xl border-2 p-3', saveTemplateMode === 'new' ? 'border-[#2d4a7a] bg-[#f0f4fa]' : 'border-neutral-200 bg-white')}>
                  <input type="radio" name="tplMode" value="new" checked={saveTemplateMode === 'new'} onChange={() => setSaveTemplateMode('new')} className="mt-0.5" />
                  <div className="flex-1">
                    <div className="mb-1.5 text-[15px] font-bold">✨ צור תבנית חדשה</div>
                    <input
                      type="text"
                      value={saveTemplateName}
                      onChange={e => { setSaveTemplateName(e.target.value); setSaveTemplateMode('new'); }}
                      placeholder="שם התבנית החדשה"
                      className="box-border w-full rounded-md border border-neutral-300 p-2 text-[15px]"
                    />
                  </div>
                </label>
              </div>

              <div className="flex justify-end gap-2.5">
                <button onClick={() => setSaveTemplateOpen(false)} className="cursor-pointer rounded-lg border-none bg-neutral-100 px-5 py-2.5 text-[15px] text-neutral-800">ביטול</button>
                <button
                  onClick={doSave}
                  disabled={!canSave}
                  className={cn('rounded-lg border-none px-6 py-2.5 text-[15px] font-bold text-white', canSave ? 'cursor-pointer bg-success' : 'cursor-not-allowed bg-neutral-300')}
                >
                  {savingTemplate ? 'שומר...' : '💾 שמור תבנית'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />

      {/* ── Reassign employee modal ── */}
      {reassignOpen && (() => {
        const sortedPhases = [...(version.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);

        // Distinct assigned user names currently in this version
        const nameSet = new Set<string>();
        sortedPhases.forEach((p: any) =>
          (p.subPhases || []).forEach((s: any) =>
            (s.tasks || []).forEach((t: any) => {
              if (t.assignedUserName && t.assignedUserName !== 'Missing') nameSet.add(t.assignedUserName);
            })
          )
        );
        const assignedNames = Array.from(nameSet).sort((a, b) => a.localeCompare(b, 'he'));

        // Per-phase task count for selected user
        const phaseCountsForUser: { phase: any; count: number }[] = reassignFrom
          ? sortedPhases.map((p: any) => ({
              phase: p,
              count: (p.subPhases || []).reduce((acc: number, s: any) =>
                acc + (s.tasks || []).filter((t: any) => t.assignedUserName === reassignFrom).length, 0),
            })).filter(x => x.count > 0)
          : [];

        const totalCount = phaseCountsForUser.reduce((a, x) => a + x.count, 0);
        const filteredCount = reassignPhaseId
          ? (phaseCountsForUser.find(x => x.phase.id === reassignPhaseId)?.count ?? 0)
          : totalCount;

        const canSubmit = !!reassignFrom && !!reassignTo && !reassigning;

        const doReassign = async () => {
          setReassigning(true);
          setReassignResult(null);
          try {
            const res = await axios.patch(
              `${API}/versions/${version.id}/reassign-tasks`,
              { fromUserName: reassignFrom, toUserId: reassignTo, ...(reassignPhaseId ? { phaseId: reassignPhaseId } : {}) },
              { headers },
            );
            setReassignResult(res.data);
            onRefresh();
          } catch (err: any) {
            showAlert('שגיאה', err?.response?.data?.message || 'שגיאה בהחלפת עובד', 'danger');
          } finally {
            setReassigning(false);
          }
        };

        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'white', borderRadius: '14px', padding: '28px', width: '480px', maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.25)', direction: 'rtl' }}>
              <h3 style={{ margin: '0 0 20px', color: '#1a2332', fontSize: '18px' }}>🔄 החלפת עובד במשימות</h3>

              {!reassignResult ? (
                <>
                  {/* From user */}
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '6px', fontSize: '15px', color: '#333' }}>החלף את</label>
                    <select
                      value={reassignFrom}
                      onChange={e => { setReassignFrom(e.target.value); setReassignPhaseId(''); }}
                      style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '15px', boxSizing: 'border-box' }}
                    >
                      <option value="">-- בחר עובד להחלפה --</option>
                      {(assignedNames as string[]).map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Phase scope — shown only after selecting a user */}
                  {reassignFrom && phaseCountsForUser.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '6px', fontSize: '15px', color: '#333' }}>בשלב</label>
                      <select
                        value={reassignPhaseId}
                        onChange={e => setReassignPhaseId(e.target.value)}
                        style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '15px', boxSizing: 'border-box' }}
                      >
                        <option value="">כל הגרסה ({totalCount} משימות)</option>
                        {phaseCountsForUser.map(({ phase, count }) => (
                          <option key={phase.id} value={phase.id}>{phase.name} ({count} משימות)</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {reassignFrom && phaseCountsForUser.length === 0 && (
                    <div style={{ marginBottom: '16px', padding: '10px 14px', background: '#fff8e1', border: '1px solid #f39c12', borderRadius: '8px', fontSize: '15px', color: '#856404' }}>
                      אין משימות מוקצות ל-{reassignFrom} בגרסה זו
                    </div>
                  )}

                  {/* To user */}
                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '6px', fontSize: '15px', color: '#333' }}>
                      {reassignPhaseId
                        ? `בעובד חדש — ${filteredCount} משימות יעודכנו`
                        : `בעובד חדש${filteredCount > 0 ? ` — ${filteredCount} משימות יעודכנו` : ''}`}
                    </label>
                    <select
                      value={reassignTo}
                      onChange={e => setReassignTo(e.target.value)}
                      style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '15px', boxSizing: 'border-box' }}
                    >
                      <option value="">-- בחר עובד חדש --</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.fullName}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button onClick={() => setReassignOpen(false)} style={{ padding: '10px 20px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '15px' }}>ביטול</button>
                    <button
                      onClick={doReassign}
                      disabled={!canSubmit || filteredCount === 0}
                      style={{ padding: '10px 24px', background: canSubmit && filteredCount > 0 ? '#e67e22' : '#ccc', color: 'white', border: 'none', borderRadius: '8px', cursor: canSubmit && filteredCount > 0 ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontSize: '15px' }}
                    >
                      {reassigning ? 'מחליף...' : `החלף (${filteredCount} משימות)`}
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '40px', marginBottom: '12px' }}>✅</div>
                  <p style={{ fontSize: '17px', color: '#1a2332', marginBottom: '4px' }}>
                    <strong>{reassignResult.updated}</strong> משימות עודכנו בהצלחה
                  </p>
                  <p style={{ fontSize: '15px', color: '#555', marginBottom: '24px' }}>
                    "{reassignFrom}" הוחלף ב-"{reassignResult.toUserName}"
                    {reassignPhaseId && ` בשלב הנבחר`}
                  </p>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                    <button
                      onClick={() => { setReassignFrom(''); setReassignTo(''); setReassignPhaseId(''); setReassignResult(null); }}
                      style={{ padding: '10px 20px', background: '#e67e22', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                      החלף עוד
                    </button>
                    <button onClick={() => setReassignOpen(false)} style={{ padding: '10px 20px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>סגור</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── פאנל סקירת הגשת צוות ── */}
      {teamPanelOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, direction: 'rtl' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,20,40,0.6)' }} onClick={closeTeamPanel} />
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '800px', maxWidth: '95vw', background: 'white', boxShadow: '-8px 0 32px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', background: '#1a2332', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '17px' }}>📋 סקירת הגשת משימות</div>
                <div style={{ fontSize: '14px', color: '#94a3b8', marginTop: '2px' }}>{teamPanelOpen.teamName} — {version.name}</div>
              </div>
              <button onClick={closeTeamPanel} style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '15px' }}>✕ סגור</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <TeamLeadProposalView
                token={token}
                versionId={version.id}
                versionName={version.name}
                teamIdOverride={teamPanelOpen.teamId}
                teamNameOverride={teamPanelOpen.teamName}
                isManager={isManager}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── אשף הכנת תוכנית ── */}
      {wizardOpen && (
        <PlanWizard
          version={version}
          token={token}
          users={users}
          teams={teams}
          onClose={() => setWizardOpen(false)}
          onRefresh={() => { onRefresh(); }}
        />
      )}

      {/* ── Task detail / edit / add modal ── */}
      {(selectedTask !== null || selectedTaskSubId) && (() => {
        const isExec = ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(version.status);
        const phaseForTask = selectedTask
          ? version.phases?.find((p: any) => p.subPhases?.some((s: any) => s.tasks?.some((t: any) => t.id === selectedTask.id)))
          : undefined;
        return (
          <>
            <div
              onClick={() => { setSelectedTask(null); setSelectedTaskSubId(undefined); }}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 499 }}
            />
            <div style={{
              position: 'fixed',
              top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '760px', maxWidth: '94vw',
              maxHeight: '84vh', height: 'auto',
              zIndex: 500, borderRadius: '16px',
              overflow: 'visible',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
            }}>
              <TaskDetailPanel
                key={selectedTask?.id ?? `add-${selectedTaskSubId}`}
                task={selectedTask}
                subPhaseId={selectedTaskSubId}
                versionId={version.id}
                token={token}
                isLocked={isLocked}
                readonlyStatus={!isExec}
                teams={teams}
                users={users}
                crItems={crItems}
                proposals={proposals.filter((p: any) => Number(p.phase) === Number(selectedTask
                  ? (version.phases?.find((ph: any) => ph.subPhases?.some((s: any) => s.tasks?.some((t: any) => t.id === selectedTask.id)))?.orderIndex ?? 0)
                  : selectedTaskPhaseOrder
                ))}
                versionPhases={version.phases ?? []}
                currentPhaseOrder={phaseForTask?.orderIndex ?? 999}
                phaseStart={selectedTaskPhaseStart}
                phaseEnd={selectedTaskPhaseEnd}
                onClose={() => { setSelectedTask(null); setSelectedTaskSubId(undefined); }}
                onSave={() => { onRefresh(); refreshProposals(); setSelectedTask(null); setSelectedTaskSubId(undefined); }}
              />
            </div>
          </>
        );
      })()}

      {/* ── Assign preview modal ── */}
      {showAssignPreview && (() => {
        // Phase colors matching TeamView environment palette (light theme)
        const PHASE_META: Record<number, { label: string; color: string; bg: string; border: string }> = {
          1: { label: 'שלב 1 — בוקר לפני גרסה', color: '#17a2b8', bg: 'rgba(23,162,184,0.08)',   border: '#17a2b8' },
          2: { label: 'שלב 2 — HOTNET',          color: C.statusOpen,    bg: C.bgOpen,             border: C.statusOpen },
          3: { label: 'שלב 3 — HOT',             color: C.statusBlocked, bg: C.bgBlocked,           border: C.statusBlocked },
          4: { label: 'שלב 4 — בוקר שלאחר גרסה', color: '#6366f1', bg: 'rgba(99,102,241,0.08)',   border: '#6366f1' },
        };
        const phaseOf = (n: number) => PHASE_META[n] ?? { label: `שלב ${n}`, color: C.textSecondary, bg: C.bgNested, border: C.border };

        const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
          APPROVED:       { label: '✓ מאושר',  color: '#2e7d32', bg: 'rgba(46,125,50,0.10)'   },
          PENDING:        { label: '⏳ ממתין',  color: '#d4840a', bg: 'rgba(212,132,10,0.10)'  },
          REJECTED:       { label: '✗ נדחה',   color: C.statusBlocked, bg: C.bgBlocked          },
          NEEDS_REVISION: { label: '↩ לתיקון', color: '#d4840a', bg: 'rgba(212,132,10,0.10)'  },
        };

        const teamMap = new Map<string, string>(teams.map((t: any) => [t.id, t.name]));
        const phases = Array.from(new Set(previewItems.map(i => i.proposal.phase))).sort((a, b) => a - b);
        const checkedCount = previewItems.filter(i => i.checked).length;
        const missingFields = (p: any) => !p.assignedUserName?.trim() || !p.estimatedMins;

        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
            onClick={() => setShowAssignPreview(false)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: C.bgCard, borderRadius: RADIUS.xl, padding: `${SP[5]} ${SP[6]}`,
                minWidth: '580px', maxWidth: '740px', width: '92%', maxHeight: '87vh',
                display: 'flex', flexDirection: 'column', gap: SP[4],
                boxShadow: SHADOW.lg, direction: 'rtl', fontFamily: FONT,
                border: `1px solid ${C.border}`,
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: SP[4] }}>
                <div>
                  <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary, letterSpacing: '-0.3px' }}>
                    📋 שיבוץ הצעות — תצוגה מקדימה
                  </div>
                  <div style={{ ...TEXT.sm, color: C.textMuted, marginTop: SP[1] }}>
                    {previewItems.length} הצעות •{' '}
                    <span style={{ color: checkedCount > 0 ? '#2e7d32' : C.textMuted, fontWeight: WEIGHT.semibold }}>{checkedCount} מסומנות לשיבוץ</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: SP[2] }}>
                  <button
                    onClick={() => setPreviewItems(prev => prev.map(i => ({ ...i, checked: true })))}
                    style={{ padding: '5px 12px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textPrimary, fontFamily: FONT, fontSize: '14px', cursor: 'pointer', fontWeight: WEIGHT.semibold }}
                  >
                    ✔ בחר הכל
                  </button>
                  <button
                    onClick={() => setPreviewItems(prev => prev.map(i => ({ ...i, checked: false })))}
                    style={{ padding: '5px 12px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textMuted, fontFamily: FONT, fontSize: '14px', cursor: 'pointer' }}
                  >
                    ☐ בטל הכל
                  </button>
                </div>
              </div>

              {/* Proposal list grouped by phase */}
              <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: SP[2] }}>
                {phases.map(phaseNum => {
                  const ph = phaseOf(phaseNum);
                  const phaseItems = previewItems.filter(i => i.proposal.phase === phaseNum);
                  return (
                    <div key={phaseNum} style={{ marginBottom: SP[2] }}>
                      {/* Phase header — matches TeamView env badge style */}
                      <div style={{
                        padding: `${SP[2]} ${SP[3]}`,
                        borderRadius: RADIUS.md,
                        background: `linear-gradient(135deg, ${C.bgElevated} 0%, ${C.bgCard} 100%)`,
                        borderBottom: `2px solid ${ph.border}`,
                        borderRight: `4px solid ${ph.border}`,
                        border: `1px solid ${C.border}`,
                        borderRightWidth: '4px',
                        fontSize: '14px', fontWeight: WEIGHT.bold, color: ph.color,
                        letterSpacing: '0.3px',
                        marginBottom: SP[2],
                        display: 'flex', alignItems: 'center', gap: SP[2],
                      }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: ph.color, flexShrink: 0, display: 'inline-block' }} />
                        {ph.label}
                        <span style={{ marginRight: 'auto', color: C.textMuted, fontWeight: WEIGHT.medium, fontSize: '13px' }}>{phaseItems.length} הצעות</span>
                      </div>

                      {/* Items */}
                      {phaseItems.map((item) => {
                        const p = item.proposal;
                        const warn = missingFields(p);
                        const sb = STATUS_BADGE[p.reviewStatus] ?? { label: p.reviewStatus, color: C.textMuted, bg: C.bgNested };
                        return (
                          <div
                            key={p.id}
                            onClick={() => setPreviewItems(prev => prev.map(i => i.proposal.id === p.id ? { ...i, checked: !i.checked } : i))}
                            style={{
                              display: 'grid', gridTemplateColumns: '22px 1fr auto auto',
                              alignItems: 'center', gap: SP[3],
                              padding: `${SP[2]} ${SP[3]}`,
                              borderRadius: RADIUS.md,
                              background: item.checked ? ph.bg : C.bgNested,
                              border: `1px solid ${item.checked ? ph.border + '55' : C.border}`,
                              borderRight: `3px solid ${item.checked ? ph.border : 'transparent'}`,
                              marginBottom: SP[1],
                              opacity: item.checked ? 1 : 0.7,
                              cursor: 'pointer',
                              transition: EASE.fast,
                            }}
                          >
                            {/* Checkbox */}
                            <input
                              type="checkbox"
                              checked={item.checked}
                              onChange={e => { e.stopPropagation(); setPreviewItems(prev => prev.map(i => i.proposal.id === p.id ? { ...i, checked: e.target.checked } : i)); }}
                              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: ph.color }}
                            />

                            {/* Title + meta */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: SP[1], minWidth: 0 }}>
                              <span style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {p.title}
                              </span>
                              <div style={{ display: 'flex', gap: SP[1], flexWrap: 'wrap', alignItems: 'center' }}>
                                {/* Team */}
                                <span style={{ fontSize: '13px', background: C.bgOpen, color: C.statusOpen, padding: '2px 8px', borderRadius: RADIUS.sm, fontWeight: WEIGHT.semibold, border: `1px solid ${C.statusOpen}33`, whiteSpace: 'nowrap' }}>
                                  {teamMap.get(p.teamId) ?? p.teamId}
                                </span>
                                {/* Assignee */}
                                {p.assignedUserName && (
                                  <span style={{ fontSize: '13px', color: C.textMuted }}>• {p.assignedUserName}</span>
                                )}
                                {/* CR badge */}
                                {p.crNumber && (
                                  <span style={{
                                    fontSize: '13px', fontWeight: WEIGHT.bold, fontFamily: 'monospace',
                                    background: 'rgba(23,162,184,0.10)', color: '#17a2b8',
                                    padding: '2px 8px', borderRadius: RADIUS.sm,
                                    border: '1px solid rgba(23,162,184,0.30)', whiteSpace: 'nowrap',
                                  }}>
                                    {p.crNumber}
                                  </span>
                                )}
                                {/* Duration */}
                                {p.estimatedMins && (
                                  <span style={{ fontSize: '13px', color: C.textMuted, background: C.bgCard, padding: '2px 7px', borderRadius: RADIUS.sm, border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                                    ⏱ {p.estimatedMins} דק׳
                                  </span>
                                )}
                                {warn && (
                                  <span style={{ fontSize: '13px', color: C.statusBlocked, fontWeight: WEIGHT.semibold }}>⚠ חסרים פרטי ביצוע</span>
                                )}
                              </div>
                            </div>

                            {/* Status badge */}
                            <span style={{ fontSize: '13px', fontWeight: WEIGHT.semibold, whiteSpace: 'nowrap', color: sb.color, background: sb.bg, padding: '3px 9px', borderRadius: RADIUS.sm, border: `1px solid ${sb.color}33` }}>
                              {sb.label}
                            </span>

                            {/* Delete */}
                            <button
                              onClick={e => { e.stopPropagation(); handleDeleteFromPreview(p.id); }}
                              title="מחק הצעה לצמיתות"
                              style={{ padding: '4px 8px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: 'transparent', color: C.statusBlocked, fontFamily: FONT, fontSize: '14px', cursor: 'pointer', opacity: 0.7 }}
                            >
                              🗑
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {previewItems.length === 0 && (
                  <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[8] }}>
                    אין הצעות ממתינות לשיבוץ
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{ display: 'flex', gap: SP[2], justifyContent: 'flex-end', borderTop: `1px solid ${C.border}`, paddingTop: SP[4] }}>
                <button
                  onClick={() => setShowAssignPreview(false)}
                  style={{ padding: `${SP[2]} ${SP[4]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textMuted, fontFamily: FONT, fontSize: '15px', cursor: 'pointer', fontWeight: WEIGHT.semibold }}
                >
                  ביטול
                </button>
                <button
                  onClick={handleConfirmAssign}
                  disabled={checkedCount === 0}
                  style={{
                    padding: `${SP[2]} ${SP[5]}`, borderRadius: RADIUS.md, border: 'none',
                    background: checkedCount > 0 ? '#17a2b8' : C.bgNested,
                    color: checkedCount > 0 ? '#fff' : C.textDisabled,
                    fontFamily: FONT, fontSize: '15px', fontWeight: WEIGHT.bold,
                    cursor: checkedCount > 0 ? 'pointer' : 'not-allowed',
                    boxShadow: checkedCount > 0 ? '0 2px 8px rgba(23,162,184,0.35)' : 'none',
                    transition: EASE.fast,
                  }}
                >
                  ✔ אשר שיבוץ ({checkedCount})
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Convert proposals result dialog ── */}
      {convertResult && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300,
        }} onClick={() => setConvertResult(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: C.bgCard, borderRadius: RADIUS.lg, padding: SP[6],
            minWidth: '340px', maxWidth: '480px', width: '90%',
            boxShadow: SHADOW.lg, direction: 'rtl', fontFamily: FONT,
          }}>
            <h3 style={{ margin: `0 0 ${SP[4]} 0`, ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>
              תוצאות שיבוץ הצעות
            </h3>
            <div style={{
              display: 'flex', alignItems: 'center', gap: SP[2],
              padding: `${SP[2]} ${SP[3]}`, borderRadius: convertResult.tasks.length > 0 ? `${RADIUS.md} ${RADIUS.md} 0 0` : RADIUS.md,
              background: 'rgba(40,167,69,0.1)', marginBottom: convertResult.tasks.length > 0 ? 0 : SP[3],
            }}>
              <span style={{ fontSize: '18px' }}>✅</span>
              <span style={{ ...TEXT.sm, color: '#28a745', fontWeight: WEIGHT.semibold }}>
                {convertResult.created > 0 ? `שובצו ${convertResult.created} משימות לתוכנית` : 'לא שובצו משימות חדשות'}
              </span>
            </div>
            {convertResult.tasks.length > 0 && (
              <div style={{
                border: '1px solid rgba(40,167,69,0.25)', borderTop: 'none',
                borderRadius: `0 0 ${RADIUS.md} ${RADIUS.md}`,
                background: 'rgba(40,167,69,0.04)',
                maxHeight: '200px', overflowY: 'auto',
                marginBottom: SP[3],
              }}>
                {convertResult.tasks.map((t, i) => (
                  <div key={i} style={{
                    padding: `${SP[2]} ${SP[3]}`,
                    borderBottom: i < convertResult.tasks.length - 1 ? '1px solid rgba(40,167,69,0.12)' : 'none',
                    display: 'flex', flexDirection: 'column', gap: '2px',
                  }}>
                    <span style={{ ...TEXT.sm, color: C.textPrimary, fontWeight: WEIGHT.medium }}>{t.title}</span>
                    <span style={{ ...TEXT.xs, color: C.textMuted }}>
                      {t.phaseName}{t.subPhaseName ? ` › ${t.subPhaseName}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {convertResult.skipped.length > 0 && (
              <div style={{ marginBottom: SP[4] }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: SP[2],
                  padding: `${SP[2]} ${SP[3]}`, borderRadius: `${RADIUS.md} ${RADIUS.md} 0 0`,
                  background: 'rgba(255,193,7,0.12)',
                }}>
                  <span style={{ fontSize: '17px' }}>⚠️</span>
                  <span style={{ ...TEXT.sm, color: '#856404', fontWeight: WEIGHT.semibold }}>
                    דולגו {convertResult.skipped.length} הצעות:
                  </span>
                </div>
                <div style={{
                  border: `1px solid rgba(255,193,7,0.3)`, borderTop: 'none',
                  borderRadius: `0 0 ${RADIUS.md} ${RADIUS.md}`,
                  background: 'rgba(255,193,7,0.05)',
                  maxHeight: '180px', overflowY: 'auto',
                }}>
                  {convertResult.skipped.map((s, i) => (
                    <div key={i} style={{
                      padding: `${SP[2]} ${SP[3]}`,
                      borderBottom: i < convertResult.skipped.length - 1 ? `1px solid rgba(255,193,7,0.2)` : 'none',
                      display: 'flex', gap: SP[2], alignItems: 'flex-start',
                    }}>
                      <span style={{ ...TEXT.xs, color: C.textPrimary, fontWeight: WEIGHT.medium, flex: 1 }}>{s.title}</span>
                      <span style={{ ...TEXT.xs, color: C.textMuted, flexShrink: 0 }}>{s.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button
              onClick={() => setConvertResult(null)}
              style={{
                width: '100%', padding: `${SP[2]} 0`,
                background: C.bgNested, border: `1px solid ${C.border}`,
                borderRadius: RADIUS.md, color: C.textPrimary,
                fontFamily: FONT, ...TEXT.sm, cursor: 'pointer',
              }}
            >
              סגור
            </button>
          </div>
        </div>
      )}
  </div>
  );
};
