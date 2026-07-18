import React, { useMemo, useState, useEffect } from 'react';
import axios from 'axios';
import { C, FONT, FONT_MONO, TEXT, WEIGHT, RADIUS, SHADOW, EASE } from '../theme';
import { VersionStatusChip } from './ui';
import RunbookModal, { RUNBOOKS, getRunbookTrigger, RunbookTrigger } from './qa/RunbookModal';

const API = process.env.REACT_APP_API_URL ?? 'http://localhost:3000';

interface TeamStatusRow {
  teamId: string;
  teamName: string;
  total: number;
  draft: number;
  submitted: number;
  returned: number;
  approved: number;
  allDone: boolean;
}

type ModuleKey = 'version-management' | 'deployments' | 'qa' | 'release-intelligence' | 'quality-hub';

interface Props {
  versions: any[];
  role: string;
  fullName: string;
  token: string;
  selectedVersionId?: string;
  onSelectVersion: (id: string, tab?: string) => void;
  onNewVersion?: () => void;
  onSwitchToQa?: () => void;
  canAccessQa?: boolean;
  isQaTeamMember?: boolean;
  canAccessVersionManagement?: boolean;
  canAccessReleaseIntelligence?: boolean;
  canAccessQualityHub?: boolean;
  onSwitchToModule?: (m: ModuleKey) => void;
  onGoToLeaves?: () => void;
}

const STATUS_PRIORITY: Record<string, number> = {
  ACTIVE: 0, REHEARSAL: 1, MORNING_AFTER: 2,
  APPROVED: 3, REVIEW: 4, REFINING: 5, CR_REVIEW: 6,
  COLLECTING: 7, DRAFT: 8, COMPLETED: 9, ROLLED_BACK: 10,
};

const PHASE_META: Record<string, {
  label: string; icon: string; color: string; bg: string;
  desc: (role: string) => string;
  cta: (role: string) => string;
  ctaTab: string | ((role: string) => string);
  pulse?: boolean;
}> = {
  DRAFT:        { label: 'שלב טיוטה',          icon: '📋', color: '#4573D2', bg: 'rgba(69,115,210,0.07)',    desc: r => isRm(r) ? 'הגדר לוח זמנים, תכולה ומסגרת הגרסה.' : 'ממתין לפתיחת שלב האיסוף.',               cta: r => isRm(r) ? 'הגדר גרסה' : 'ראה פרטים',       ctaTab: 'list' },
  COLLECTING:   { label: 'איסוף משימות',        icon: '📝', color: '#9C6ADE', bg: 'rgba(156,106,222,0.07)', desc: r => r === 'TEAM_LEAD' ? 'הגש את הצעות המשימות לאישור.' : isRm(r) ? 'עקב אחר שיבוץ הצוותים.'  : 'בדוק אם שובצת למשימות.',                     cta: r => r === 'TEAM_LEAD' ? 'הגש תוכניות' : 'ראה סטטוס', ctaTab: 'proposals' },
  // Managers review CR plans on the version detail page itself (team-status grid + CR list) — the
  // separate implementation-plans screen is redundant for them. Team leads still use it to submit.
  CR_REVIEW:    { label: 'סקירת CR',             icon: '🔍', color: '#E8AF00', bg: 'rgba(232,175,0,0.07)',   desc: r => r === 'TEAM_LEAD' ? 'יש להגיש תוכנית CR לאישור.' : 'צוותים מגישים תוכניות עלייה לאוויר.', cta: r => r === 'TEAM_LEAD' ? 'הגש תוכנית CR' : 'סקור תוכניות', ctaTab: r => r === 'TEAM_LEAD' ? 'implementation-plans' : 'list' },
  REFINING:     { label: 'טיוב תוכנית',         icon: '✏️', color: '#E8AF00', bg: 'rgba(232,175,0,0.07)',   desc: () => 'שלב טיוב ועדכון תוכניות לאחר הסקירה.',                                                     cta: () => 'פרטי גרסה',            ctaTab: 'list' },
  REVIEW:       { label: 'ישיבת מעבר',          icon: '👥', color: '#4573D2', bg: 'rgba(69,115,210,0.07)',   desc: () => 'ישיבת מעבר עם כלל המשתתפים לאישור סופי.',                                                 cta: () => 'פרטי גרסה',            ctaTab: 'list' },
  APPROVED:     { label: 'תוכנית מאושרת',       icon: '✅', color: '#37C47A', bg: 'rgba(55,196,122,0.07)',   desc: () => 'התוכנית אושרה. ממתינים לחזרה הגנרלית.',                                                    cta: () => 'פרטי גרסה',            ctaTab: 'list' },
  REHEARSAL:    { label: 'חזרה גנרלית פעילה',   icon: '🎭', color: '#8b5cf6', bg: 'rgba(139,92,246,0.07)',   desc: () => 'החזרה הגנרלית בביצוע. עקב אחרי התקדמות הצוותים.',                                         cta: () => 'כנס ל-War Room',       ctaTab: 'dashboard', pulse: true },
  ACTIVE:       { label: 'עלייה לאוויר — לייב', icon: '🚀', color: '#F06A6A', bg: 'rgba(240,106,106,0.07)', desc: () => 'עלייה לאוויר פעילה. מעקב בזמן אמת אחרי כלל הצוותים.',                                    cta: () => 'War Room',             ctaTab: 'dashboard', pulse: true },
  MORNING_AFTER:{ label: 'בוקר שלאחר',          icon: '🌅', color: '#F0883E', bg: 'rgba(240,136,62,0.07)',   desc: () => 'שלב בקרות הבוקר. ודא שכל הבדיקות הושלמו.',                                                cta: () => 'לוח בקרה',             ctaTab: 'dashboard', pulse: true },
  COMPLETED:    { label: 'הושלם',               icon: '🏁', color: '#37C47A', bg: 'rgba(55,196,122,0.07)',   desc: () => 'הגרסה הושלמה בהצלחה.',                                                                    cta: () => 'ראה סיכום',            ctaTab: 'summary-night' },
  ROLLED_BACK:  { label: 'Rollback בוצע',       icon: '⏪', color: '#F06A6A', bg: 'rgba(240,106,106,0.07)', desc: () => 'בוצעה חזרה אחורה.',                                                                        cta: () => 'ראה פרטים',            ctaTab: 'list' },
};

function isRm(r: string) { return ['RELEASE_MANAGER', 'ADMIN'].includes(r); }

// Shared with ManagerDashboard's sidebar module switcher — clicking "הטמעות"
// should land on whatever tab is actually relevant for the version's current
// stage (proposals while collecting, War Room while live, etc.), the same
// resolution the old hero CTA used, not just whatever tab happened to be
// active before (which is 'home' when coming from the Home dashboard).
export function getDeploymentsTabForStatus(status: string, role: string): string {
  const ph = PHASE_META[status] ?? PHASE_META['DRAFT'];
  return typeof ph.ctaTab === 'function' ? ph.ctaTab(role) : ph.ctaTab;
}

// ────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────
// Module status card — used by the home-page module grid, one per
// top-level module, showing the 1-3 lines most relevant to a manager.
// ────────────────────────────────────────────────────────────────
function KpiTile({ icon, accent, value, label, sub, subTone, footer, onClick }: {
  icon: string; accent: string; value: string; label: string;
  sub?: string | null; subTone?: 'ok' | 'warn' | 'muted'; footer?: string | null; onClick?: () => void;
}) {
  const subColor = subTone === 'ok' ? C.success : subTone === 'warn' ? C.warning : C.textMuted;
  return (
    <div
      onClick={onClick}
      style={{
        background: C.bgCard, border: `1px solid ${C.border}`, borderTop: `3px solid ${accent}`,
        borderRadius: RADIUS.lg, padding: '16px 18px', cursor: onClick ? 'pointer' : 'default',
        transition: EASE.fast, display: 'flex', flexDirection: 'column', gap: '10px',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'; (e.currentTarget as HTMLElement).style.boxShadow = SHADOW.md; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'none'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ width: '30px', height: '30px', borderRadius: RADIUS.md, background: `color-mix(in oklch, ${accent} 14%, transparent)`, color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px' }}>{icon}</div>
        <span style={{ fontSize: '13px', color: C.textMuted }}>←</span>
      </div>
      <div>
        <div style={{ fontSize: '26px', fontWeight: WEIGHT.bold, color: C.textPrimary, lineHeight: 1, fontVariantNumeric: 'tabular-nums' as const }}>{value}</div>
        <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textSecondary, marginTop: '4px' }}>{label}</div>
      </div>
      {sub && <div style={{ ...TEXT.xs, color: subColor, fontWeight: subTone === 'warn' ? WEIGHT.semibold : WEIGHT.normal }}>{sub}</div>}
      {footer && <div style={{ ...TEXT.xs, color: C.textMuted, paddingTop: '8px', borderTop: `1px solid ${C.border}` }}>{footer}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Stat card
// ────────────────────────────────────────────────────────────────
function StatCard({ value, label, delta, deltaColor }: { value: string; label: string; delta?: string; deltaColor?: string }) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', flex: 1 }}>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
      {delta && <div style={{ ...TEXT.xs, color: deltaColor ?? C.textMuted, marginTop: '6px' }}>{delta}</div>}
    </div>
  );
}

interface QaSummary { totalCrs: number; assignedCrs: number; hasWorkPlan: boolean; priorityCount: number; }

// ────────────────────────────────────────────────────────────────
// Version row (compact)
// ────────────────────────────────────────────────────────────────
function VersionRow({ v, isPrimary, onSelect, qaSummary, role }: { v: any; isPrimary: boolean; onSelect: (id: string, tab?: string) => void; qaSummary?: QaSummary | null; role: string }) {
  const ph = PHASE_META[v.status] ?? PHASE_META['DRAFT'];
  const isTrulyLive = ['ACTIVE', 'REHEARSAL'].includes(v.status);
  const isMorningAfter = v.status === 'MORNING_AFTER';
  const resolvedCtaTab = typeof ph.ctaTab === 'function' ? ph.ctaTab(role) : ph.ctaTab;
  return (
    <div
      onClick={() => onSelect(v.id, resolvedCtaTab)}
      style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '10px 14px', borderRadius: RADIUS.md, cursor: 'pointer',
        background: isPrimary ? `${ph.color}09` : 'transparent',
        border: `1px solid ${isPrimary ? ph.color + '30' : C.border}`,
        marginBottom: '6px', transition: EASE.fast,
      }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = isPrimary ? `${ph.color}14` : C.bgHover}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = isPrimary ? `${ph.color}09` : 'transparent'}
    >
      <span style={{ fontSize: '17px', flexShrink: 0 }}>{ph.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, display: 'flex', alignItems: 'center', gap: '6px' }}>
          {v.name}
          {isTrulyLive && <span style={{ fontSize: '11px', background: C.danger, color: 'white', borderRadius: '10px', padding: '1px 6px', fontWeight: WEIGHT.bold, letterSpacing: '0.05em', animation: 'home-pulse 2s ease-in-out infinite' }}>LIVE</span>}
          {isMorningAfter && <span style={{ fontSize: '11px', background: '#F0883E', color: 'white', borderRadius: '10px', padding: '1px 6px', fontWeight: WEIGHT.bold, letterSpacing: '0.05em' }}>בוקר</span>}
        </div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '1px' }}>{ph.label}</div>
      </div>
      {qaSummary && qaSummary.totalCrs > 0 && (
        <span style={{ ...TEXT.xs, color: '#7c3aed', background: 'rgba(124,58,237,0.08)', borderRadius: '10px', padding: '2px 7px', flexShrink: 0, whiteSpace: 'nowrap' as const }}>
          🧪 {qaSummary.assignedCrs}/{qaSummary.totalCrs}
        </span>
      )}
      <VersionStatusChip status={v.status} size="xs" />
      <span style={{ ...TEXT.xs, color: ph.color, fontWeight: WEIGHT.medium, flexShrink: 0 }}>פתח ←</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Risk / activity row — the unified cross-module feed. Each item is
// tagged with the module it belongs to (colored chip), so "risks and
// activities from every module" reads as one prioritized list instead
// of a deployments-only to-do list.
// ────────────────────────────────────────────────────────────────
const MODULE_META: Record<ModuleKey, { label: string; color: string }> = {
  'version-management':   { label: 'ניהול גרסה',   color: C.moduleRelease },
  'qa':                   { label: 'ניהול QA',     color: C.moduleTestPlan },
  'deployments':          { label: 'הטמעות',       color: C.moduleGoLive },
  'release-intelligence': { label: 'ניהול בדיקות', color: C.moduleTracking },
  'quality-hub':          { label: 'איכות גרסה',   color: C.moduleAnalytics },
};

// `detail` items skip navigation entirely and expand inline instead — the
// point of a drill-down is showing the specific list (which teams, which
// CRs) right where you clicked, not sending the user off to re-find it on
// a whole-module screen.
function RiskRow({ icon, title, desc, urgent, module, onClick, detail, expanded, onToggle }: {
  icon: string; title: string; desc: string; urgent?: boolean; module?: ModuleKey; onClick?: () => void;
  detail?: string[]; expanded?: boolean; onToggle?: () => void;
}) {
  const meta = MODULE_META[module ?? 'deployments'];
  const hasDetail = !!detail && detail.length > 0;
  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <div
        onClick={hasDetail ? onToggle : onClick}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: '10px',
          padding: '10px 0',
          cursor: (hasDetail || onClick) ? 'pointer' : 'default',
        }}
      >
        <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: urgent ? C.danger : meta.color, flexShrink: 0, marginTop: '6px' }} />
        <span style={{ fontSize: '16px', flexShrink: 0, marginTop: '1px' }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...TEXT.sm, fontWeight: WEIGHT.medium, color: urgent ? C.danger : C.textPrimary }}>{title}</div>
          <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px' }}>{desc}</div>
        </div>
        {hasDetail && <span style={{ ...TEXT.xs, color: C.textMuted, flexShrink: 0, marginTop: '2px' }}>{expanded ? '▲' : '▼'}</span>}
        <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: meta.color, background: `color-mix(in oklch, ${meta.color} 14%, transparent)`, borderRadius: RADIUS.full, padding: '2px 9px', flexShrink: 0, whiteSpace: 'nowrap' as const }}>
          {meta.label}
        </span>
      </div>
      {hasDetail && expanded && (
        <div style={{ padding: '0 0 10px 19px', display: 'flex', flexWrap: 'wrap' as const, gap: '6px' }}>
          {detail!.map((d, i) => (
            <span key={i} style={{ ...TEXT.xs, color: C.textSecondary, background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: '3px 9px' }}>{d}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Empty state
// ────────────────────────────────────────────────────────────────
function EmptyState({ canCreate, onNewVersion }: { canCreate: boolean; onNewVersion?: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', gap: '16px', flex: 1 }}>
      <span style={{ fontSize: '52px' }}>📦</span>
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: C.textPrimary }}>אין גרסאות פעילות</div>
      <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', maxWidth: '340px', lineHeight: 1.6 }}>
        {canCreate ? 'לא קיימות גרסאות פעילות. צור גרסה חדשה כדי להתחיל תהליך.' : 'פנה למנהל הגרסה לפתיחת גרסה.'}
      </div>
      {canCreate && (
        <button
          onClick={onNewVersion}
          style={{ marginTop: '8px', background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, padding: '10px 24px', ...TEXT.sm, fontWeight: WEIGHT.semibold, cursor: 'pointer', fontFamily: FONT }}
        >
          + פתח גרסה חדשה
        </button>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────
const CR_REVIEW_STAGES = ['CR_REVIEW', 'REFINING', 'REVIEW'];

export const HomeDashboard: React.FC<Props> = ({
  versions, role, fullName, token, selectedVersionId, onSelectVersion, onNewVersion, onSwitchToQa, canAccessQa,
  isQaTeamMember, canAccessVersionManagement, canAccessReleaseIntelligence, canAccessQualityHub, onSwitchToModule, onGoToLeaves,
}) => {
  const canCreate = isRm(role);
  const canManageLeaves = ['ADMIN', 'TEAM_LEAD'].includes(role);
  // TEAM_LEAD gets a blanket screen:qa role permission (for QA-team leads
  // whose team happens to be the QA team) that ORs with actual QA-team
  // membership — fine for gating the QA module itself, but on Home it means
  // every team lead sees QA-planning cards regardless of whether QA is
  // actually their concern. Narrow to real membership here; leave the
  // module-level permission (and RM/ADMIN visibility) untouched.
  const homeShowQa = role === 'TEAM_LEAD' ? !!isQaTeamMember : !!canAccessQa;

  const [pendingLeaveCount, setPendingLeaveCount] = useState(0);
  const [teamStatus, setTeamStatus] = useState<TeamStatusRow[]>([]);
  const [teamStatusLoading, setTeamStatusLoading] = useState(false);
  const [myTeamSummary, setMyTeamSummary] = useState<{ total: number; ready: number; draft: number } | null>(null);
  const [qaSummary, setQaSummary] = useState<QaSummary | null>(null);
  const [livePhases, setLivePhases] = useState<{ name: string; done: number; total: number; state: 'done' | 'active' | 'upcoming' }[]>([]);
  const [nextPhaseInfo, setNextPhaseInfo] = useState<{ name: string; startTime?: string | null } | null>(null);
  const [firstPhaseInfo, setFirstPhaseInfo] = useState<{ name: string; startTime?: string | null } | null>(null);
  const [estimateStats, setEstimateStats] = useState<{
    totalEstimateDays: number;
    qaFilteredEstimateDays: number;
    byTeam: { teamId: string; teamName: string; totalDays: number; qaFilteredDays: number; crs: { crNumber: string; crLabel: string; teamDays: number; hasQa: boolean }[] }[];
  } | null>(null);

  // Pick the most urgent non-archived version
  const activeVersions = useMemo(
    () => versions.filter(v => !v.isArchived).sort((a, b) => (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99)),
    [versions]
  );
  const inProgressVersions = activeVersions.filter(v => !['COMPLETED', 'ROLLED_BACK'].includes(v.status));
  // primary = whichever version is selected in the sidebar, as long as it's
  // still in progress — falls back to the most urgent one (by STATUS_PRIORITY)
  // when nothing valid is selected, so Home actually follows sidebar clicks
  // instead of always pinning to the single "most urgent" version.
  const selectedInProgress = selectedVersionId ? inProgressVersions.find(v => v.id === selectedVersionId) : undefined;
  const primary = selectedInProgress ?? inProgressVersions[0] ?? null;
  const others  = inProgressVersions.filter(v => v.id !== primary?.id);
  const allDone = activeVersions.length > 0 && inProgressVersions.length === 0;

  const firstName = fullName.split(' ')[0] || fullName;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'שלום' : hour < 21 ? 'ערב טוב' : 'לילה טוב';

  const isLiveNow = primary && ['ACTIVE', 'REHEARSAL'].includes(primary.status);
  const isMorningAfterNow = primary?.status === 'MORNING_AFTER';

  const myUserId = (() => { try { return JSON.parse(atob(token.split('.')[1])).sub; } catch { return null; } })();

  // Which risk-feed row (by index) is inline-expanded to show its specific detail list
  const [expandedRiskIdx, setExpandedRiskIdx] = useState<number | null>(null);

  // Manual, RM/ADMIN-authored notice pinned atop the risks/activities feed —
  // local override so edits reflect immediately without waiting on a parent refetch.
  const [localNotice, setLocalNotice] = useState<string | null | undefined>(undefined);
  const [editingNotice, setEditingNotice] = useState(false);
  const [noticeDraft, setNoticeDraft] = useState('');
  const [savingNotice, setSavingNotice] = useState(false);
  useEffect(() => { setLocalNotice(primary?.homeNotice ?? null); setEditingNotice(false); }, [primary?.id, primary?.homeNotice]);
  const canEditNotice = isRm(role);
  const saveNotice = async (text: string) => {
    if (!primary) return;
    setSavingNotice(true);
    try {
      await axios.patch(`${API}/versions/${primary.id}`, { homeNotice: text || null }, { headers: { Authorization: `Bearer ${token}` } });
      setLocalNotice(text || null);
      setEditingNotice(false);
    } catch (e) { console.error('Failed to save home notice', e); }
    setSavingNotice(false);
  };

  const [upcomingRunbookSteps, setUpcomingRunbookSteps] = useState<{
    runbookId: string; stepIndex: number; employee: string; employeeUserId: string | null;
    startTime: string; endTime: string; runDate: string; team: string; status: string;
  }[]>([]);

  useEffect(() => {
    if (!primary?.id) { setUpcomingRunbookSteps([]); return; }
    axios.get(`${API}/runbook/${primary.id}/upcoming`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setUpcomingRunbookSteps(res.data ?? []))
      .catch(() => setUpcomingRunbookSteps([]));
  }, [primary?.id, token]);

  // All activity-board entries for the version — QA-module access (where the
  // activities board normally lives) is gated to QA-team-members/admin only,
  // so RELEASE_MANAGER has no other way to see these otherwise. Any entry
  // scheduled today/tomorrow is surfaced under "your next actions"; ones that
  // also map to a runbook (refresh/version-transfer activities) get a direct
  // "launch" link that opens straight into run mode.
  const [activityBoard, setActivityBoard] = useState<{
    activityKey: string; label: string; owner: string; ownerEmployee: string;
    dateStart: string | null; dateEnd: string | null;
  }[]>([]);
  const [runbookItem, setRunbookItem] = useState<{ trigger: RunbookTrigger; dateStartISO: string } | null>(null);

  useEffect(() => {
    if (!primary?.id || !isRm(role)) { setActivityBoard([]); return; }
    axios.get(`${API}/activity-board/${primary.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setActivityBoard(res.data ?? []))
      .catch(() => setActivityBoard([]));
  }, [primary?.id, role, token]);

  const todayOrTomorrowActivities = activityBoard.filter(a => {
    if (!a.dateStart) return false;
    const d = new Date(a.dateStart).toDateString();
    const todayStr = new Date().toDateString();
    const tomorrowStr = new Date(Date.now() + 86400000).toDateString();
    return d === todayStr || d === tomorrowStr;
  });

  const TEAM_STATUS_STAGES = ['COLLECTING', ...CR_REVIEW_STAGES];
  const showTeamStatus = isRm(role) && primary && TEAM_STATUS_STAGES.includes(primary.status);
  const isCollecting   = primary?.status === 'COLLECTING';

  useEffect(() => {
    if (!showTeamStatus || !primary) { setTeamStatus([]); return; }
    setTeamStatusLoading(true);
    const url = isCollecting
      ? `${API}/task-proposals/version/${primary.id}/team-status`
      : `${API}/cr-plans/version/${primary.id}/team-status`;
    axios.get(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setTeamStatus(r.data))
      .catch(() => setTeamStatus([]))
      .finally(() => setTeamStatusLoading(false));
  }, [primary?.id, primary?.status, showTeamStatus, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch team lead's own submission summary when in DRAFT/COLLECTING/CR_REVIEW
  const isTl = role === 'TEAM_LEAD';
  const showMyTeamWarning = isTl && primary && ['DRAFT', 'COLLECTING', 'CR_REVIEW'].includes(primary.status);
  useEffect(() => {
    if (!showMyTeamWarning || !primary) { setMyTeamSummary(null); return; }
    const url = primary.status === 'COLLECTING'
      ? `${API}/task-proposals/version/${primary.id}/my-team-summary`
      : `${API}/cr-plans/version/${primary.id}/team-status`; // team lead sees only their team via this endpoint
    axios.get(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (primary.status === 'COLLECTING') {
          setMyTeamSummary(r.data);
        } else {
          // cr-plans endpoint returns array; take first row (team lead's own team)
          const row = (r.data as any[])[0];
          setMyTeamSummary(row ? { total: row.total, ready: row.submitted, draft: row.draft } : null);
        }
      })
      .catch(() => setMyTeamSummary(null));
  }, [primary?.id, primary?.status, showMyTeamWarning, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pending leave requests needing this manager's attention (ADMIN: all; TEAM_LEAD: own team only)
  useEffect(() => {
    if (!canManageLeaves) { setPendingLeaveCount(0); return; }
    axios.get(`${API}/leaves/requests/pending-count`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setPendingLeaveCount(r.data ?? 0))
      .catch(() => setPendingLeaveCount(0));
  }, [canManageLeaves, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch QA summary for primary version — gated to whoever should actually see QA-planning info on Home
  useEffect(() => {
    if (!homeShowQa || !primary) { setQaSummary(null); return; }
    axios.get(`${API}/qa-stats/summary?versionId=${primary.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setQaSummary(r.data))
      .catch(() => setQaSummary(null));
  }, [homeShowQa, primary?.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lightweight per-module summaries for the module-status card grid below —
  // release-intelligence's defect KPIs and quality-hub's release score.
  const [defectsSummary, setDefectsSummary] = useState<{ open: number } | null>(null);
  useEffect(() => {
    if (!canAccessReleaseIntelligence || !primary) { setDefectsSummary(null); return; }
    axios.get(`${API}/release-intelligence/defects/${primary.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setDefectsSummary(r.data?.kpis ?? null))
      .catch(() => setDefectsSummary(null));
  }, [canAccessReleaseIntelligence, primary?.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Testing progress (% of planned test cases passed) — distinct from the defect
  // count, so the release-intelligence tile shows execution progress too, not just
  // how many bugs are open. Real coverage data only exists once integration
  // testing has actually started — gate by integrationStart, not by version
  // status, so we don't show a misleading "0%" before that date.
  const integrationStarted = !!primary?.integrationStart && new Date(primary.integrationStart).getTime() <= Date.now();
  const [testCoveragePct, setTestCoveragePct] = useState<number | null>(null);
  useEffect(() => {
    if (!canAccessReleaseIntelligence || !primary || !integrationStarted) { setTestCoveragePct(null); return; }
    axios.get(`${API}/release-intelligence/overview/${primary.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setTestCoveragePct(typeof r.data?.coveragePct === 'number' ? r.data.coveragePct : null))
      .catch(() => setTestCoveragePct(null));
  }, [canAccessReleaseIntelligence, primary?.id, integrationStarted, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tasks converted from approved team plans but not yet placed in the runbook
  // (subPhase assigned at conversion, but no plannedStart yet) — invisible
  // otherwise until someone opens the scheduling wizard. Also counts tasks
  // flagged morningFollowup=true (set at template level, today only surfaced
  // in the night-summary Word doc) so MORNING_AFTER can show it live.
  const [taskSchedule, setTaskSchedule] = useState<{ total: number; unscheduled: number; morningFollowup: number } | null>(null);
  useEffect(() => {
    if (!primary) { setTaskSchedule(null); return; }
    axios.get(`${API}/tasks?versionId=${primary.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        const list: any[] = Array.isArray(r.data) ? r.data : [];
        setTaskSchedule({
          total: list.length,
          unscheduled: list.filter(t => !t.plannedStart).length,
          morningFollowup: list.filter(t => t.morningFollowup).length,
        });
      })
      .catch(() => setTaskSchedule(null));
  }, [primary?.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // QA classification progress (isCore/urgent/priorityTestDate) — meaningful
  // even before scope approval, unlike scope-change flags.
  const [classificationStats, setClassificationStats] = useState<{ totalCrs: number; classifiedCrs: number } | null>(null);
  useEffect(() => {
    if (!homeShowQa || !primary) { setClassificationStats(null); return; }
    axios.get(`${API}/version-cr-assignments/version/${primary.id}/classification-stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setClassificationStats(r.data ?? null))
      .catch(() => setClassificationStats(null));
  }, [homeShowQa, primary?.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const [qualityScore, setQualityScore] = useState<{ totalScore: number; status: string } | null>(null);
  // Reference score from the most recent release that DOES have quality-hub
  // data — shown in place of the version's own score until it gets one
  // (own quality data is normally only imported after COMPLETED), so the
  // tile isn't dead for most of the version's lifecycle.
  const [previousReleaseScore, setPreviousReleaseScore] = useState<{ releaseName: string; totalScore: number } | null>(null);
  useEffect(() => {
    if (!canAccessQualityHub) { setPreviousReleaseScore(null); return; }
    axios.get(`${API}/quality-hub/releases`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        const list: any[] = Array.isArray(r.data) ? r.data : [];
        setPreviousReleaseScore(list.length > 0 ? { releaseName: list[0].releaseName, totalScore: list[0].totalScore } : null);
      })
      .catch(() => setPreviousReleaseScore(null));
  }, [canAccessQualityHub, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!canAccessQualityHub || !primary) { setQualityScore(null); return; }
    axios.get(`${API}/quality-hub/overview/${encodeURIComponent(primary.name)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setQualityScore(r.data ? { totalScore: r.data.totalScore, status: r.data.status } : null))
      .catch(() => setQualityScore(null));
  }, [canAccessQualityHub, primary?.id, primary?.name, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real defect rows (not just counts) for the "תקלות שדורשות תשומת לב" panel —
  // filtered client-side to open + high/critical severity.
  const [defectsList, setDefectsList] = useState<{ id: string; title: string; severity: string; status: string }[]>([]);
  useEffect(() => {
    if (!canAccessReleaseIntelligence || !primary) { setDefectsList([]); return; }
    axios.get(`${API}/qc/defects?versionId=${primary.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setDefectsList(Array.isArray(r.data) ? r.data : []))
      .catch(() => setDefectsList([]));
  }, [canAccessReleaseIntelligence, primary?.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Same definitions as release-intelligence.service.ts (CLOSED_DEFECT_STATUSES / CRITICAL_SEVERITIES) —
  // must stay in sync so this panel's count agrees with the "תקלות פתוחות" KPI tile above it.
  const openDefects = useMemo(
    () => defectsList.filter(d => !['Closed', 'Canceled', 'Rejected', 'Fixed'].includes(d.status)),
    [defectsList]
  );
  const criticalDefectsCount = useMemo(
    () => openDefects.filter(d => ['Show Stopper', 'Severe'].includes(d.severity)).length,
    [openDefects]
  );

  // CRs whose scope changed after the version's scope was already approved —
  // "ניהול גרסה" module's own ongoing-change signal, surfaced here too.
  const [scopeAttentionCount, setScopeAttentionCount] = useState(0);
  useEffect(() => {
    if (!canAccessVersionManagement || !primary?.scopeApprovedAt) { setScopeAttentionCount(0); return; }
    axios.get(`${API}/version-cr-assignments/version/${primary.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setScopeAttentionCount((r.data || []).filter((a: any) => a.needsAttention).length))
      .catch(() => setScopeAttentionCount(0));
  }, [canAccessVersionManagement, primary?.id, primary?.scopeApprovedAt, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch CR investment estimate stats; if empty, auto-sync from Excel then re-fetch
  useEffect(() => {
    if (!primary) { setEstimateStats(null); return; }
    const headers = { Authorization: `Bearer ${token}` };
    const statsUrl = `${API}/version-cr-assignments/version/${primary.id}/stats`;
    axios.get(statsUrl, { headers })
      .then(r => {
        const data = r.data ?? null;
        if (data && (data.crCount === 0 || data.crCount == null)) {
          // No assignments yet — trigger background sync then re-fetch
          return axios.post(`${API}/version-cr-assignments/version/${primary.id}/sync`, {}, { headers })
            .then(() => axios.get(statsUrl, { headers }))
            .then(r2 => setEstimateStats(r2.data ?? null))
            .catch(() => setEstimateStats(data));
        }
        setEstimateStats(data);
      })
      .catch(() => setEstimateStats(null));
  }, [primary?.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch phase progress when version is ACTIVE or REHEARSAL
  useEffect(() => {
    if (!primary || !['ACTIVE', 'REHEARSAL'].includes(primary.status)) { setLivePhases([]); setNextPhaseInfo(null); return; }
    axios.get(`${API}/versions/${primary.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        const phases = [...(res.data.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
        let foundActive = false;
        let lastTouchedOrderIndex: number | null = null; // last phase with at least one activated (non-WAITING) task, done or not
        const result = phases
          .map((ph: any) => {
            const tasks = (ph.subPhases || []).flatMap((sp: any) => sp.tasks || []);
            const nightTasks = tasks.filter((t: any) => t.status !== 'WAITING');
            const done = nightTasks.filter((t: any) => ['DONE', 'FAILED', 'ROLLED_BACK'].includes(t.status)).length;
            const total = nightTasks.length;
            // Skip phases with no activated tasks (all WAITING — not part of this night)
            if (total === 0) return null;
            lastTouchedOrderIndex = ph.orderIndex;
            let state: 'done' | 'active' | 'upcoming';
            if (done === total) {
              state = 'done';
            } else if (!foundActive) {
              foundActive = true;
              state = 'active';
            } else {
              state = 'upcoming';
            }
            return { name: ph.name, done, total, state };
          })
          .filter(Boolean) as { name: string; done: number; total: number; state: 'done' | 'active' | 'upcoming' }[];
        setLivePhases(result);

        // Next phase to come — the first one after the last touched phase, whether
        // that's still in progress or (once it's fully done) not yet started at all.
        // Start time comes from the earliest task in that phase (rehearsal-aware),
        // not Phase.plannedStart, which only ever reflects the production schedule.
        const nextPhase = lastTouchedOrderIndex !== null
          ? phases.find((ph: any) => ph.orderIndex > (lastTouchedOrderIndex as number))
          : undefined;
        if (nextPhase) {
          const nextTasks = (nextPhase.subPhases || []).flatMap((sp: any) => sp.tasks || []);
          const times = nextTasks
            .map((t: any) => t.rehearsalPlannedStart ?? t.plannedStart)
            .filter(Boolean)
            .map((d: any) => new Date(d).getTime());
          setNextPhaseInfo({ name: nextPhase.name, startTime: times.length ? new Date(Math.min(...times)).toISOString() : null });
        } else {
          setNextPhaseInfo(null);
        }
      })
      .catch(() => { setLivePhases([]); setNextPhaseInfo(null); });
  }, [primary?.id, primary?.status, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the first phase's name + start time for the "פתח לילה פעיל" action —
  // nothing has run yet at APPROVED, so this uses the phase's own plannedStart
  // (the production schedule), not a task-derived time like the in-run views do.
  useEffect(() => {
    if (!primary || primary.status !== 'APPROVED') { setFirstPhaseInfo(null); return; }
    axios.get(`${API}/versions/${primary.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        const phases = [...(res.data.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
        const first = phases[0];
        setFirstPhaseInfo(first ? { name: first.name, startTime: first.plannedStart ?? null } : null);
      })
      .catch(() => setFirstPhaseInfo(null));
  }, [primary?.id, primary?.status, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warning logic helpers
  const WARN_HOURS = 48;
  const reviewMeetingTime = primary?.reviewMeetingTime ? new Date(primary.reviewMeetingTime) : null;
  const hoursUntilReview  = reviewMeetingTime ? (reviewMeetingTime.getTime() - Date.now()) / 3_600_000 : null;
  const reviewIsApproaching = hoursUntilReview !== null && hoursUntilReview > 0 && hoursUntilReview <= WARN_HOURS;
  const reviewHoursLabel = hoursUntilReview !== null && hoursUntilReview > 0
    ? hoursUntilReview < 1 ? 'פחות משעה' : `${Math.round(hoursUntilReview)} שעות`
    : null;

  // Build role-specific action list based on primary version state
  const actions = useMemo(() => {
    if (!primary) return [];
    const st = primary.status;
    const rm = isRm(role);
    const tl = role === 'TEAM_LEAD';
    const list: { icon: string; title: string; desc: string; urgent?: boolean; tab?: string; onClick?: () => void; module?: ModuleKey; detail?: string[] }[] = [];

    if (canManageLeaves && pendingLeaveCount > 0) {
      list.push({
        icon: '🏖', title: `${pendingLeaveCount} בקשות חופשה ממתינות לאישור`,
        desc: 'עובדים הגישו בקשות חופשה שממתינות לטיפולך', urgent: true,
        onClick: onGoToLeaves, module: 'qa',
      });
    }

    if (showTeamStatus && teamStatus.some(t => !t.allDone)) {
      const missing = teamStatus.filter(t => !t.allDone);
      list.push({
        icon: '📋', title: `${missing.length} תוכניות חסרות`,
        desc: isCollecting ? 'צוותים שטרם הגישו הצעות משימות' : 'צוותים שטרם הגישו תוכנית CR',
        urgent: !!reviewIsApproaching,
        detail: missing.map(t => t.teamName),
        module: 'deployments',
      });
    }

    if (homeShowQa && qaSummary && qaSummary.priorityCount > 0) {
      list.push({
        icon: '🚩', title: `${qaSummary.priorityCount} CR-ים דורשים בדיקה ראשונית בעדיפות`,
        desc: 'CR-ים שעולים לייצור לפני הגרסה או מחוץ למסגרתה — סומנו לבדיקה ראשונה בשיבוץ', urgent: true,
        onClick: onSwitchToQa, module: 'qa',
      });
    }

    if (canAccessVersionManagement && scopeAttentionCount > 0) {
      list.push({
        icon: '🧭', title: `${scopeAttentionCount} CR-ים נוספו/הוסרו מהתכולה אחרי אישורה`,
        desc: 'דורשים סקירה ואישור תכולה מחדש', urgent: true,
        onClick: () => onSwitchToModule?.('version-management'), module: 'version-management',
      });
    }

    if (canAccessReleaseIntelligence && criticalDefectsCount > 0) {
      list.push({
        icon: '🔍', title: `${criticalDefectsCount} תקלות קריטיות פתוחות`,
        desc: 'תקלות בחומרה קריטית שטרם טופלו', urgent: true,
        onClick: () => onSwitchToModule?.('release-intelligence'), module: 'release-intelligence',
      });
    }

    if (canAccessQualityHub && qualityScore && qualityScore.status !== 'ABOVE_TARGET') {
      list.push({
        icon: '🏆', title: `ציון האיכות מתחת ליעד (${qualityScore.totalScore})`,
        desc: 'כדאי לבדוק את פירוט ה-KPI לגרסה זו', urgent: false,
        onClick: () => onSwitchToModule?.('quality-hub'), module: 'quality-hub',
      });
    }

    if (st === 'DRAFT' && rm) {
      const hasDates = !!(primary.integrationStart && primary.integrationEnd && primary.qaStart && primary.qaEnd);
      if (!hasDates) {
        list.push({ icon: '📅', title: 'קבע תאריכי גרסה', desc: 'הגדר תאריכי אינטגרציה ו-QA לפני בניית תוכנית ההטמעה', tab: 'version-detail' });
      } else {
        list.push({ icon: '📋', title: 'בנה תוכנית הטמעה', desc: 'החל תבנית על הגרסה ובנה את לוח הזמנים', tab: 'version-detail' });
      }
    }
    if (st === 'COLLECTING' && tl)      list.push({ icon: '📝', title: 'הגש תוכניות', desc: 'הגש את הצעות המשימות לאישור', urgent: true, tab: 'proposals' });
    if (st === 'COLLECTING' && rm)      list.push({ icon: '👥', title: 'מעקב הגשת תוכניות', desc: 'בדוק שכל הצוותים הגישו את תוכניות ה-CR', tab: 'proposals' });
    if (st === 'CR_REVIEW' && tl) {
      const deadline = (primary as any).submissionDeadline;
      const deadlineDesc = deadline
        ? ` — מועד הגשה: ${new Date(deadline).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${new Date(deadline) < new Date() ? ' ⚠ עבר' : ''}`
        : '';
      list.push({ icon: '📋', title: 'הגש תוכנית CR', desc: `הגדר תוכנית עלייה לאוויר לצוות שלך${deadlineDesc}`, urgent: true, tab: 'implementation-plans' });
    }
    if (st === 'CR_REVIEW' && rm)       list.push({ icon: '🔍', title: 'סקור תוכניות CR', desc: 'אשר או החזר הערות על תוכניות הצוותים', tab: 'list' });
    if (st === 'REFINING' && rm)        list.push({ icon: '✏️', title: 'ודא עדכוני תוכניות', desc: 'צוותים מעדכנים לפי הערות', tab: 'list' });
    if (st === 'REVIEW' && rm)          list.push({ icon: '👥', title: 'קיים ישיבת מעבר', desc: 'ישיבה עם כלל המשתתפים לאישור סופי', tab: 'list' });
    if (st === 'APPROVED' && rm) {
      if (primary.rehearsalSummary) {
        const dateStr = primary.plannedStart
          ? new Date(primary.plannedStart).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
          : null;
        const timeStr = primary.plannedStart
          ? new Date(primary.plannedStart).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
          : null;
        const dateTimeDesc = dateStr && timeStr ? ` — מתוכנן ל-${dateStr}, ${timeStr}` : '';
        const firstPhaseDesc = firstPhaseInfo
          ? ` · שלב ראשון: ${firstPhaseInfo.name}${firstPhaseInfo.startTime ? ` (${new Date(firstPhaseInfo.startTime).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })})` : ''}`
          : '';
        list.push({ icon: '🚀', title: 'פתח לילה פעיל', desc: `החזרה הגנרלית הושלמה — מוכן להתחיל את הלילה הפעיל${dateTimeDesc}${firstPhaseDesc}`, tab: 'list' });
      } else {
        list.push({ icon: '🎭', title: 'פתח חזרה גנרלית', desc: 'הרץ את התוכנית המאושרת כחזרה', tab: 'list' });
      }
    }
    // All activated phases done, nothing left queued up next — the run itself is
    // finished even though the version hasn't been formally closed yet.
    const allPhasesDone = livePhases.length > 0 && livePhases.every(p => p.state === 'done') && !nextPhaseInfo;

    if (['REHEARSAL', 'ACTIVE'].includes(st) && !allPhasesDone) {
      const nextDesc = nextPhaseInfo
        ? `שלב הבא: ${nextPhaseInfo.name}${nextPhaseInfo.startTime ? ` יחל בשעה ${new Date(nextPhaseInfo.startTime).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : ''}`
        : 'עקב אחר ביצוע המשימות בזמן אמת';
      list.push({ icon: '⚡', title: 'War Room', desc: nextDesc, urgent: true, tab: 'dashboard' });
    }
    if (st === 'REHEARSAL' && allPhasesDone && rm) {
      list.push({ icon: '🎭', title: 'החזרה הגנרלית הושלמה', desc: 'הפק דוח סיכום חזרה גנרלית וסיים אותה כדי לפתוח את הלילה הפעיל', urgent: true, tab: 'summary-rehearsal' });
    }
    if (st === 'ACTIVE' && allPhasesDone && rm) {
      list.push({ icon: '✅', title: 'ליל ההטמעה הושלם', desc: 'כל המשימות בוצעו — עבור לבקרות הבוקר ולסגירת הגרסה', urgent: true, tab: 'summary-night' });
    }
    if (st === 'MORNING_AFTER' && rm)   list.push({ icon: '🌅', title: 'אשר בקרות בוקר', desc: 'ודא השלמת כל הבדיקות ואשר סיום', urgent: true, tab: 'dashboard' });
    if (st === 'MORNING_AFTER' && rm)   list.push({ icon: '📄', title: 'הכן דוח סיכום', desc: 'צור וסכם את פעילות הלילה', urgent: true, tab: 'summary-night' });

    // Runbook steps happening today/tomorrow — visible to team leads, admin,
    // release manager, and the specific employee assigned to that step.
    const todayStr = new Date().toDateString();
    const tomorrowStr = new Date(Date.now() + 86400000).toDateString();
    for (const step of upcomingRunbookSteps) {
      const isMine = !!myUserId && step.employeeUserId === myUserId;
      if (!rm && !tl && !isMine) continue;
      const def = RUNBOOKS[step.runbookId];
      const stepDef = def?.steps[step.stepIndex];
      if (!stepDef) continue;
      const stepDate = new Date(step.runDate).toDateString();
      const dayLabel = stepDate === todayStr ? 'היום' : stepDate === tomorrowStr ? 'מחר' : null;
      if (!dayLabel) continue;
      list.push({
        icon: '🛠',
        title: `${stepDef.activity} — ${dayLabel} ${step.startTime}`,
        desc: `${step.team || stepDef.defaultTeam}${step.employee ? ` · ${step.employee}` : ''}${isMine ? ' · המשימה שלך' : ''}`,
        urgent: dayLabel === 'היום',
        onClick: onSwitchToQa, module: 'qa',
      });
    }

    // Every activity-board entry scheduled today/tomorrow — release manager/
    // admin only (activity board access is otherwise QA-module gated). Ones
    // that map to a runbook get a direct "launch" link into run mode.
    if (rm) {
      for (const a of todayOrTomorrowActivities) {
        const trigger = getRunbookTrigger(a.activityKey);
        const dayLabel = new Date(a.dateStart!).toDateString() === new Date().toDateString() ? 'היום' : 'מחר';
        const timeLabel = new Date(a.dateStart!).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
        list.push({
          icon: trigger ? '▶' : '🗓',
          title: `${a.label} — ${dayLabel} ${timeLabel}`,
          desc: [a.owner, a.ownerEmployee].filter(Boolean).join(' · ') + (trigger ? ' · לחץ להפעלת Runbook' : ''),
          urgent: dayLabel === 'היום',
          onClick: trigger ? (() => setRunbookItem({ trigger, dateStartISO: a.dateStart! })) : undefined,
        });
      }
    }

    return list;
  }, [primary, role, canManageLeaves, pendingLeaveCount, onGoToLeaves, nextPhaseInfo, firstPhaseInfo, upcomingRunbookSteps, myUserId, onSwitchToQa, todayOrTomorrowActivities, homeShowQa, qaSummary, canAccessVersionManagement, scopeAttentionCount, onSwitchToModule, canAccessReleaseIntelligence, criticalDefectsCount, canAccessQualityHub, qualityScore, showTeamStatus, teamStatus, isCollecting, reviewIsApproaching]);

  // Stats — only count non-terminal versions as "in progress"
  const totalVersions  = inProgressVersions.length;
  const liveCount      = inProgressVersions.filter(v => ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(v.status)).length;
  const planningCount  = inProgressVersions.filter(v => !['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(v.status)).length;
  const endedCount     = activeVersions.filter(v => ['COMPLETED', 'ROLLED_BACK'].includes(v.status)).length + versions.filter(v => v.isArchived).length;

  // ── Render ──
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: C.bgApp, fontFamily: FONT, direction: 'rtl', color: C.textPrimary, minHeight: 0 }}>
      <style>{`
        @keyframes home-pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
        @keyframes home-glow  { 0%,100%{box-shadow:0 0 0 3px rgba(240,106,106,0.15)} 50%{box-shadow:0 0 0 6px rgba(240,106,106,0.08)} }
      `}</style>

      {/* ── Topbar ── */}
      <div style={{ background: C.bgCard, borderBottom: `1px solid ${C.border}`, padding: '14px 28px', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0, boxShadow: SHADOW.xs }}>
        <div>
          <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{greeting}, {firstName} 👋</div>
          <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '1px' }}>
            {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
        <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isLiveNow && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(240,106,106,0.08)', border: '1px solid rgba(240,106,106,0.25)', borderRadius: RADIUS.full, padding: '4px 12px' }}>
              <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: C.danger, animation: 'home-pulse 1.5s ease-in-out infinite' }} />
              <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.danger }}>LIVE</span>
            </div>
          )}
          {isMorningAfterNow && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(240,136,62,0.08)', border: '1px solid rgba(240,136,62,0.30)', borderRadius: RADIUS.full, padding: '4px 12px' }}>
              <span style={{ fontSize: '14px' }}>🌅</span>
              <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: '#F0883E' }}>בוקר שלאחר</span>
            </div>
          )}
          {canCreate && onNewVersion && (
            <button
              onClick={onNewVersion}
              style={{ background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, padding: '7px 16px', ...TEXT.sm, fontWeight: WEIGHT.semibold, cursor: 'pointer', fontFamily: FONT, transition: EASE.fast }}
              onMouseEnter={e => (e.currentTarget.style.background = '#E05555')}
              onMouseLeave={e => (e.currentTarget.style.background = C.brand)}
            >
              + גרסה חדשה
            </button>
          )}
        </div>
      </div>

      {/* ── No versions at all ── */}
      {!primary && !allDone && <EmptyState canCreate={canCreate} onNewVersion={onNewVersion} />}

      {/* ── All versions completed — show compact notice + history ── */}
      {allDone && (
        <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Notice bar */}
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontSize: '28px', flexShrink: 0 }}>🏁</span>
            <div style={{ flex: 1 }}>
              <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>אין גרסאות פעילות כרגע</div>
              <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px' }}>כל הגרסאות הושלמו — ניתן לעיין בהן למטה</div>
            </div>
            {canCreate && onNewVersion && (
              <button
                onClick={onNewVersion}
                style={{ flexShrink: 0, background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, padding: '8px 18px', ...TEXT.sm, fontWeight: WEIGHT.semibold, cursor: 'pointer', fontFamily: FONT }}
              >
                + פתח גרסה חדשה
              </button>
            )}
          </div>
          {/* Stats */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <StatCard value="0" label="גרסאות בתהליך" />
            <StatCard value={String(activeVersions.filter(v => ['COMPLETED', 'ROLLED_BACK'].includes(v.status)).length + versions.filter(v => v.isArchived).length)} label="גרסאות שהסתיימו" deltaColor={C.success} delta="✓ הושלמו" />
          </div>
          {/* Version list */}
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '20px' }}>
            <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '14px' }}>📦 גרסאות אחרונות</div>
            {activeVersions.map(v => <VersionRow key={v.id} v={v} isPrimary={false} onSelect={onSelectVersion} role={role} />)}
            {canCreate && onNewVersion && (
              <button
                onClick={onNewVersion}
                style={{ width: '100%', marginTop: '10px', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: RADIUS.md, padding: '9px', ...TEXT.xs, color: C.textMuted, cursor: 'pointer', fontFamily: FONT, transition: EASE.fast }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.brand; e.currentTarget.style.color = C.brand; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted; }}
              >
                + פתח גרסה חדשה
              </button>
            )}
          </div>
        </div>
      )}

      {primary && (
        <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* ── Hero banner ── */}
          {(() => {
            const ph = PHASE_META[primary.status] ?? PHASE_META['DRAFT'];
            return (
              <div style={{
                background: 'linear-gradient(135deg, #14152A 0%, #22244a 60%, #241f42 100%)',
                borderRadius: RADIUS.lg,
                padding: '20px 24px', display: 'flex', alignItems: 'center', gap: '20px',
                animation: ph.pulse ? 'home-glow 3s ease-in-out infinite' : 'none',
                boxShadow: SHADOW.md,
              }}>
                <span style={{ fontSize: '36px', flexShrink: 0 }}>{ph.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '28px', fontWeight: WEIGHT.bold, color: 'white', lineHeight: 1.1, marginBottom: '4px', letterSpacing: '-0.01em' }}>
                    {primary.name}
                  </div>
                  {/* Key-dates timeline — the whole calendar arc (integration → QA →
                      rehearsal → go-live) in one glance, not just the single next
                      date. Once the night is actually running the live phase strip
                      below takes over, so this stops being the useful view. */}
                  {!['ACTIVE', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(primary.status) && (() => {
                    const milestones: { label: string; date: Date }[] = [];
                    if (primary.integrationStart) milestones.push({ label: 'תחילת אינטגרציה', date: new Date(primary.integrationStart) });
                    if (primary.integrationEnd) milestones.push({ label: 'סיום אינטגרציה', date: new Date(primary.integrationEnd) });
                    if (primary.qaStart) milestones.push({ label: 'תחילת QA', date: new Date(primary.qaStart) });
                    if (primary.qaEnd) milestones.push({ label: 'סיום QA', date: new Date(primary.qaEnd) });
                    if (primary.plannedRehearsalStart) milestones.push({ label: 'חזרה גנרלית', date: new Date(primary.plannedRehearsalStart) });
                    if (primary.plannedStart) milestones.push({ label: 'עלייה לאוויר', date: new Date(primary.plannedStart) });
                    if (milestones.length === 0) return null;
                    // Sort by actual date, not fixed process order — rehearsal and QA
                    // windows can genuinely overlap, and the timeline should read as
                    // real chronology, not an idealized stage sequence.
                    milestones.sort((a, b) => a.date.getTime() - b.date.getTime());
                    const now = Date.now();
                    return (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '2px', marginTop: '10px', overflowX: 'auto' as const, paddingBottom: '2px' }}>
                        {milestones.map((m, i) => {
                          const isPast = m.date.getTime() <= now;
                          const isNext = !isPast && milestones.slice(0, i).every(mm => mm.date.getTime() <= now);
                          return (
                            <React.Fragment key={i}>
                              {i > 0 && (
                                <div style={{ width: '16px', height: 0, marginTop: '4px', borderTop: `1.5px dashed ${isPast ? 'rgba(110,231,168,.4)' : 'rgba(255,255,255,.2)'}`, flexShrink: 0 }} />
                              )}
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', flexShrink: 0, opacity: isPast ? 0.55 : 1 }}>
                                <div style={{
                                  width: '8px', height: '8px', borderRadius: '50%',
                                  background: isPast ? '#6EE7A8' : isNext ? 'white' : 'rgba(255,255,255,.35)',
                                  boxShadow: isNext ? '0 0 0 3px rgba(255,255,255,.15)' : 'none',
                                }} />
                                <div style={{ ...TEXT.xs, color: isNext ? 'white' : 'rgba(255,255,255,.55)', fontWeight: isNext ? WEIGHT.semibold : WEIGHT.normal, whiteSpace: 'nowrap' as const }}>
                                  {m.label}
                                </div>
                                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,.45)', whiteSpace: 'nowrap' as const }}>
                                  {m.date.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}
                                </div>
                              </div>
                            </React.Fragment>
                          );
                        })}
                      </div>
                    );
                  })()}
                  {/* Phase progress strip for ACTIVE/REHEARSAL */}
                  {livePhases.some(p => p.state !== 'done') && (
                    <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {livePhases.filter(p => p.state !== 'done').map((p, i) => {
                        const isDone     = p.state === 'done';
                        const isActive   = p.state === 'active';
                        const isUpcoming = p.state === 'upcoming';
                        const icon = isDone ? '✅' : isActive ? '▶' : '○';
                        const color = isDone ? '#6EE7A8' : isActive ? 'white' : 'rgba(255,255,255,.55)';
                        const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
                        return (
                          <div
                            key={i}
                            onClick={() => onSelectVersion(primary.id, 'dashboard')}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                              padding: '5px 8px', borderRadius: RADIUS.sm,
                              background: isActive ? 'rgba(255,255,255,.08)' : 'transparent',
                              border: isActive ? '1px solid rgba(255,255,255,.16)' : '1px solid transparent',
                              opacity: isUpcoming ? 0.5 : 1,
                            }}
                          >
                            <span style={{ fontSize: '13px', width: '14px', flexShrink: 0, color }}>{icon}</span>
                            <span style={{ ...TEXT.xs, fontWeight: isActive ? WEIGHT.semibold : WEIGHT.normal, color, flex: 1 }}>{p.name}</span>
                            {p.total > 0 && (
                              <>
                                <span style={{ ...TEXT.xs, color: 'rgba(255,255,255,.55)', flexShrink: 0 }}>{p.done}/{p.total}</span>
                                <div style={{ width: 48, height: 4, background: 'rgba(255,255,255,.14)', borderRadius: 2, flexShrink: 0, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${pct}%`, background: isDone ? '#6EE7A8' : 'white', borderRadius: 2 }} />
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* Go-live date + countdown — this is the one piece of info that's
                      genuinely specific to the hero (not duplicated by any KPI tile
                      below it). Navigation buttons were removed entirely — every
                      destination they led to (version details, War Room, etc.) is
                      already one click away from a KPI tile or the risks feed below,
                      so a dedicated hero CTA was pure duplication. */}
                  {primary.plannedStart && !['ACTIVE', 'REHEARSAL', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(primary.status) && (() => {
                    const goLive = new Date(primary.plannedStart);
                    const msLeft = goLive.getTime() - Date.now();
                    const dateLabel = `${goLive.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' })} · ${goLive.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
                    const overdue = msLeft <= 0;
                    const daysLeft = Math.ceil(msLeft / 86400000);
                    const countdownLabel = overdue ? '⚠ תאריך היעד חלף' : daysLeft <= 1 ? '🚀 עולים לאוויר מחר' : `🚀 בעוד ${daysLeft} ימים`;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' as const }}>
                        <span style={{
                          ...TEXT.xs, fontWeight: WEIGHT.bold, color: 'white',
                          background: overdue ? 'rgba(240,106,106,.25)' : 'rgba(255,255,255,.14)',
                          border: `1px solid ${overdue ? 'rgba(240,106,106,.4)' : 'rgba(255,255,255,.22)'}`,
                          borderRadius: '10px', padding: '2px 10px',
                        }}>
                          {countdownLabel}
                        </span>
                        <span style={{ ...TEXT.xs, color: 'rgba(255,255,255,.6)' }}>
                          עלייה לאוויר: {dateLabel}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })()}

          {/* ── KPI tile grid — one tile per module, real data, top border = module accent ── */}
          <h2 style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: '0.06em', margin: '4px 0 -4px' }}>תמונת מצב לפי מודול</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px' }}>

            {canAccessVersionManagement && (
              <KpiTile
                icon="🧭" accent={C.moduleRelease}
                value={estimateStats && (estimateStats as any).crCount != null ? String((estimateStats as any).crCount) : '—'}
                label="CR-ים בתכולה"
                sub={primary?.scopeApprovedAt ? '✓ תכולה אושרה' : scopeAttentionCount > 0 ? `⚠ ${scopeAttentionCount} דורשים אישור מחדש` : 'ממתין לאישור תכולה'}
                subTone={primary?.scopeApprovedAt && scopeAttentionCount === 0 ? 'ok' : 'warn'}
                footer={estimateStats ? `📊 ${estimateStats.totalEstimateDays} ימ״ע השקעה כוללת · ${planningCount} גרסאות בתכנון` : `${planningCount} גרסאות בתכנון · ${endedCount} הסתיימו`}
                onClick={() => onSwitchToModule?.('version-management')}
              />
            )}

            {homeShowQa && (() => {
              // qaSummary.totalCrs counts raw VersionCrAssignment rows (one per
              // team per CR, not deduplicated) — it's nonzero the moment CR_LIST
              // syncs, long before QA assignment actually starts, and CRs that
              // don't need QA at all still inflate it. Use assignedCrs (real
              // QaAssignment rows) to gate "has assignment started," and never
              // show totalCrs as a denominator — it doesn't mean what it looks
              // like it means.
              const assignmentStarted = !!qaSummary && qaSummary.assignedCrs > 0;
              const hasClassification = !assignmentStarted && !!classificationStats && classificationStats.totalCrs > 0;
              return (
                <KpiTile
                  icon="🧪" accent={C.moduleTestPlan}
                  value={
                    assignmentStarted ? String(qaSummary!.assignedCrs)
                    : hasClassification ? `${classificationStats!.classifiedCrs}/${classificationStats!.totalCrs}`
                    : '—'
                  }
                  label={assignmentStarted ? 'משימות משובצות לבדיקות' : 'CR-ים סווגו (core/עדיפות)'}
                  sub={
                    assignmentStarted
                      ? (qaSummary!.priorityCount > 0 ? `⚠ ${qaSummary!.priorityCount} בעדיפות דחופה` : qaSummary!.hasWorkPlan ? '✓ לוח פעילויות מוכן' : 'לוח פעילויות טרם נבנה')
                      : hasClassification ? 'שיבוץ לבודקים טרם החל' : 'ממתין לתכולה'
                  }
                  subTone={assignmentStarted ? (qaSummary!.priorityCount > 0 ? 'warn' : qaSummary!.hasWorkPlan ? 'ok' : 'muted') : 'muted'}
                  footer={estimateStats ? `📊 ${estimateStats.qaFilteredEstimateDays} ימ״ע ב-CR-ים עם QA` : null}
                  onClick={onSwitchToQa}
                />
              );
            })()}

            <KpiTile
              icon="🌙" accent={C.moduleGoLive}
              value={taskSchedule ? String(taskSchedule.total) : '—'}
              label="משימות בתוכנית העלייה"
              sub={(() => {
                if (teamStatus.length === 0) return (PHASE_META[primary.status] ?? PHASE_META['DRAFT']).label;
                const missing = teamStatus.filter(t => !t.allDone);
                if (missing.length === 0) return `✓ ${teamStatus.length}/${teamStatus.length} צוותים השלימו הגשה`;
                return missing.length <= 2
                  ? `⚠ ממתין ל: ${missing.map(t => t.teamName).join(', ')}`
                  : `⚠ ${missing.length} צוותים טרם השלימו הגשה`;
              })()}
              subTone={teamStatus.length > 0 && teamStatus.every(t => t.allDone) ? 'ok' : 'warn'}
              footer={(() => {
                if (primary.status === 'MORNING_AFTER' && taskSchedule && taskSchedule.morningFollowup > 0) {
                  return `☀️ ${taskSchedule.morningFollowup} משימות דורשות מעקב בוקר`;
                }
                if (livePhases.length > 0) return `${livePhases.filter(p => p.state === 'done').length}/${livePhases.length} שלבים הושלמו`;
                if (reviewMeetingTime && reviewMeetingTime.getTime() > Date.now()) {
                  return `🗓 תוכנית מסגרת נבנתה · ישיבת סקירה: ${reviewMeetingTime.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })} ${reviewMeetingTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
                }
                if (taskSchedule && taskSchedule.unscheduled > 0) return `⏳ ${taskSchedule.unscheduled} משימות ממתינות לשיבוץ`;
                return null;
              })()}
              onClick={() => onSelectVersion(primary.id, 'list')}
            />

            {canAccessReleaseIntelligence && (
              <KpiTile
                icon="🔍" accent={C.moduleTracking}
                value={defectsSummary ? String(defectsSummary.open) : '—'}
                label="תקלות פתוחות"
                sub={criticalDefectsCount > 0 ? `⚠ ${criticalDefectsCount} קריטיות` : defectsSummary ? '✓ אין תקלות קריטיות' : null}
                subTone={criticalDefectsCount > 0 ? 'warn' : 'ok'}
                footer={testCoveragePct !== null ? `📊 ${testCoveragePct}% מהבדיקות המתוכננות בוצעו` : null}
                onClick={() => onSwitchToModule?.('release-intelligence')}
              />
            )}

            {canAccessQualityHub && (
              <KpiTile
                icon="🏆" accent={C.moduleAnalytics}
                value={qualityScore ? String(qualityScore.totalScore) : previousReleaseScore ? String(previousReleaseScore.totalScore) : '—'}
                label={qualityScore ? 'ציון איכות' : previousReleaseScore ? `ציון גרסה קודמת (${previousReleaseScore.releaseName})` : 'ציון איכות'}
                sub={qualityScore ? (qualityScore.status === 'ABOVE_TARGET' ? '✓ מעל יעד' : '↓ מתחת ליעד') : previousReleaseScore ? 'רפרנס בלבד — עוד אין ציון לגרסה זו' : 'אין ציון איכות עדיין'}
                subTone={qualityScore?.status === 'ABOVE_TARGET' ? 'ok' : qualityScore ? 'warn' : 'muted'}
                onClick={() => onSwitchToModule?.('quality-hub')}
              />
            )}
          </div>

          {/* ── Review-meeting approaching alert (manager) ── */}
          {isRm(role) && reviewIsApproaching && primary && (
            <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', background: 'rgba(232,175,0,0.09)', border: `1.5px solid rgba(232,175,0,0.4)`, borderRadius: RADIUS.lg, padding: '14px 18px' }}>
              <span style={{ fontSize: '22px', flexShrink: 0 }}>⏰</span>
              <div style={{ flex: 1 }}>
                <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: '#C97A00' }}>
                  פגישת סקירת תוכניות CR בעוד {reviewHoursLabel}
                </div>
                <div style={{ ...TEXT.xs, color: C.textSecondary, marginTop: '3px' }}>
                  {teamStatus.length > 0 && teamStatus.some(t => !t.allDone)
                    ? `${teamStatus.filter(t => !t.allDone).length} צוותים עדיין לא הגישו: ${teamStatus.filter(t => !t.allDone).map(t => t.teamName).join(', ')}`
                    : primary.status === 'DRAFT'
                      ? 'ודא שהגרסה עברה לשלב האיסוף ושהצוותים הגישו תוכניות'
                      : 'בדוק שכל הצוותים הגישו את תוכניות ה-CR לפני הפגישה'}
                </div>
              </div>
              {reviewMeetingTime && (
                <div style={{ flexShrink: 0, textAlign: 'center' as const, ...TEXT.xs, color: '#C97A00', fontWeight: WEIGHT.semibold, whiteSpace: 'nowrap' as const }}>
                  {reviewMeetingTime.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' })}
                  <br />{reviewMeetingTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
          )}

          {/* Estimate breakdown + team-submission detail now live inside the ניהול גרסה
              module itself (VersionOpeningModule) — the compact team-status panel in
              the right column below is the only summary kept here. */}

          {/* ── Two-column body ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', alignItems: 'start' }}>

            {/* Left: unified cross-module risk/activity feed */}
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📌 סיכונים ופעילויות — כל המודולים</div>
                {actions.length > 0 && <div style={{ ...TEXT.xs, color: C.textMuted }}>{actions.length} פריטים</div>}
              </div>
              <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '12px' }}>בהתאם לתפקידך ושלב הגרסה הפעילה, מכל המודולים יחד</div>

              {/* ── Manual notice — RM/ADMIN-authored, pinned above the computed feed ── */}
              {editingNotice ? (
                <div style={{ background: C.bgHover, border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.md, padding: '10px 12px', marginBottom: '14px' }}>
                  <textarea
                    autoFocus
                    value={noticeDraft}
                    onChange={e => setNoticeDraft(e.target.value)}
                    placeholder="הודעה ידנית לצוותים (למשל: תזכורת לישיבת סטטוס)…"
                    style={{ width: '100%', minHeight: '54px', resize: 'vertical' as const, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: '7px 9px', ...TEXT.sm, color: C.textPrimary, fontFamily: FONT, background: C.bgCard }}
                  />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px', justifyContent: 'flex-end' }}>
                    <button onClick={() => setEditingNotice(false)} style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: '5px 12px', ...TEXT.xs, color: C.textMuted, cursor: 'pointer', fontFamily: FONT }}>ביטול</button>
                    {localNotice && <button onClick={() => saveNotice('')} disabled={savingNotice} style={{ background: 'transparent', border: `1px solid ${C.danger}`, borderRadius: RADIUS.sm, padding: '5px 12px', ...TEXT.xs, color: C.danger, cursor: 'pointer', fontFamily: FONT }}>הסר הודעה</button>}
                    <button onClick={() => saveNotice(noticeDraft)} disabled={savingNotice} style={{ background: C.brand, border: 'none', borderRadius: RADIUS.sm, padding: '5px 14px', ...TEXT.xs, fontWeight: WEIGHT.semibold, color: 'white', cursor: 'pointer', fontFamily: FONT }}>{savingNotice ? '...' : 'שמור'}</button>
                  </div>
                </div>
              ) : localNotice ? (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: 'rgba(69,115,210,0.06)', border: `1px solid rgba(69,115,210,0.25)`, borderRadius: RADIUS.md, padding: '10px 14px', marginBottom: '14px' }}>
                  <span style={{ fontSize: '16px', flexShrink: 0 }}>📌</span>
                  <div style={{ flex: 1, ...TEXT.sm, color: C.textPrimary, whiteSpace: 'pre-wrap' as const }}>{localNotice}</div>
                  {canEditNotice && (
                    <button onClick={() => { setNoticeDraft(localNotice); setEditingNotice(true); }} style={{ flexShrink: 0, background: 'transparent', border: 'none', ...TEXT.xs, color: C.brand, cursor: 'pointer', fontFamily: FONT, fontWeight: WEIGHT.semibold }}>✏️ ערוך</button>
                  )}
                </div>
              ) : canEditNotice ? (
                <button
                  onClick={() => { setNoticeDraft(''); setEditingNotice(true); }}
                  style={{ width: '100%', marginBottom: '14px', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: RADIUS.md, padding: '8px', ...TEXT.xs, color: C.textMuted, cursor: 'pointer', fontFamily: FONT, transition: EASE.fast }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.brand; e.currentTarget.style.color = C.brand; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted; }}
                >
                  📌 + הוסף הודעה ידנית לצוותים
                </button>
              ) : null}

              {/* ── Sub-phase progress (ACTIVE / REHEARSAL only) ── */}
              {livePhases.length > 0 && (() => {
                const ph = PHASE_META[primary!.status] ?? PHASE_META['DRAFT'];
                return (
                  <div style={{ background: C.bgHover, borderRadius: RADIUS.md, padding: '10px 12px', marginBottom: '14px' }}>
                    <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '8px', fontWeight: WEIGHT.semibold }}>התקדמות שלבי הלילה</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      {livePhases.map((p, i) => {
                        const isDone     = p.state === 'done';
                        const isActive   = p.state === 'active';
                        const isUpcoming = p.state === 'upcoming';
                        const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
                        const color = isDone ? C.success : isActive ? ph.color : C.textMuted;
                        return (
                          <div
                            key={i}
                            onClick={() => primary && onSelectVersion(primary.id, 'dashboard')}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                              padding: '5px 7px', borderRadius: RADIUS.sm,
                              background: isActive ? `${ph.color}12` : 'transparent',
                              border: isActive ? `1px solid ${ph.color}30` : '1px solid transparent',
                              opacity: isUpcoming ? 0.5 : 1,
                            }}
                          >
                            <span style={{ fontSize: '13px', width: '14px', flexShrink: 0, color, textAlign: 'center' as const }}>
                              {isDone ? '✓' : isActive ? '▶' : '○'}
                            </span>
                            <span style={{ ...TEXT.xs, flex: 1, color: isDone ? C.textMuted : C.textPrimary, fontWeight: isActive ? WEIGHT.semibold : WEIGHT.normal }}>{p.name}</span>
                            <span style={{ ...TEXT.xs, color: C.textMuted, flexShrink: 0 }}>{p.done}/{p.total}</span>
                            <div style={{ width: 36, height: 3, background: C.border, borderRadius: 2, flexShrink: 0, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: isDone ? C.success : ph.color, borderRadius: 2 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Team lead warning: review approaching + no ready submissions (null = fetch failed/pending = treat as not submitted) */}
              {isTl && reviewIsApproaching && showMyTeamWarning && (myTeamSummary === null || myTeamSummary.ready === 0) && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: 'rgba(240,106,106,0.08)', border: `1px solid rgba(240,106,106,0.3)`, borderRadius: RADIUS.md, padding: '10px 14px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '18px', flexShrink: 0 }}>⚠️</span>
                  <div>
                    <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.danger }}>
                      {primary.status === 'COLLECTING' ? 'לא הגשת הצעות משימות עדיין' : 'לא הגשת תוכנית CR עדיין'}
                    </div>
                    <div style={{ ...TEXT.xs, color: C.textSecondary, marginTop: '2px' }}>
                      פגישת הסקירה בעוד {reviewHoursLabel}
                      {reviewMeetingTime && ` (${reviewMeetingTime.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})`}
                    </div>
                  </div>
                  <button
                    onClick={() => onSelectVersion(primary.id, primary.status === 'COLLECTING' ? 'proposals' : 'implementation-plans')}
                    style={{ marginRight: 'auto', flexShrink: 0, background: C.danger, color: 'white', border: 'none', borderRadius: RADIUS.sm, padding: '5px 12px', ...TEXT.xs, fontWeight: WEIGHT.semibold, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' as const }}
                  >
                    הגש עכשיו ←
                  </button>
                </div>
              )}

              {actions.length === 0 ? (
                <div style={{ ...TEXT.sm, color: C.textMuted, padding: '20px 0', textAlign: 'center' }}>
                  אין פעולות ממתינות כרגע ✓
                </div>
              ) : (
                <div>
                  {actions.map((a, i) => (
                    <RiskRow
                      key={i}
                      icon={a.icon}
                      title={a.title}
                      desc={a.desc}
                      urgent={a.urgent}
                      module={a.module}
                      detail={a.detail}
                      expanded={expandedRiskIdx === i}
                      onToggle={() => setExpandedRiskIdx(prev => prev === i ? null : i)}
                      onClick={a.onClick ?? (a.tab ? () => onSelectVersion(primary.id, a.tab) : undefined)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Right: team status + defects needing attention + other versions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

              {canAccessReleaseIntelligence && openDefects.length > 0 && (
                <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '18px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>תקלות שדורשות תשומת לב</div>
                    <div style={{ ...TEXT.xs, color: C.textMuted }}>{openDefects.length} פתוחות</div>
                  </div>
                  <div>
                    {[...openDefects]
                      .sort((a, b) => (['Show Stopper', 'Severe'].includes(b.severity) ? 1 : 0) - (['Show Stopper', 'Severe'].includes(a.severity) ? 1 : 0))
                      .slice(0, 5).map(d => {
                      const sevColor = ['Show Stopper', 'Severe'].includes(d.severity) ? C.danger : d.severity === 'Medium' ? C.warning : C.textMuted;
                      return (
                        <div key={d.id} onClick={() => onSwitchToModule?.('release-intelligence')} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 0', borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: sevColor, flexShrink: 0 }} />
                          <span style={{ ...TEXT.xs, fontFamily: FONT_MONO, fontWeight: WEIGHT.bold, color: C.textSecondary, background: C.bgNested, borderRadius: RADIUS.sm, padding: '1px 6px', flexShrink: 0 }}>{d.id}</span>
                          <span style={{ ...TEXT.xs, color: C.textPrimary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{d.title}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderTop: `3px solid ${C.moduleRelease}`, borderRadius: RADIUS.lg, padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>
                    🧭 כל הגרסאות
                  </div>
                  <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.moduleRelease, background: `color-mix(in oklch, ${C.moduleRelease} 14%, transparent)`, borderRadius: RADIUS.full, padding: '2px 9px' }}>ניהול גרסה</span>
                </div>

                <VersionRow v={primary} isPrimary onSelect={onSelectVersion} qaSummary={qaSummary} role={role} />
                {others.map(v => <VersionRow key={v.id} v={v} isPrimary={false} onSelect={onSelectVersion} role={role} />)}

                {others.length === 0 && (
                  <div style={{ ...TEXT.xs, color: C.textMuted, textAlign: 'center', padding: '8px 0' }}>
                    גרסה אחת בלבד
                  </div>
                )}

                {canCreate && onNewVersion && (
                  <button
                    onClick={onNewVersion}
                    style={{ width: '100%', marginTop: '10px', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: RADIUS.md, padding: '9px', ...TEXT.xs, color: C.textMuted, cursor: 'pointer', fontFamily: FONT, transition: EASE.fast }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.brand; e.currentTarget.style.color = C.brand; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted; }}
                  >
                    + פתח גרסה חדשה
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {runbookItem && (
        <RunbookModal
          trigger={runbookItem.trigger}
          dateStartISO={runbookItem.dateStartISO}
          versionId={primary?.id ?? ''}
          token={token}
          startInRunMode
          onClose={() => setRunbookItem(null)}
        />
      )}
    </div>
  );
};
