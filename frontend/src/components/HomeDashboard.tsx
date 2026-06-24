import React, { useMemo, useState, useEffect } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, RADIUS, SHADOW, EASE } from '../theme';
import { VersionStatusChip } from './ui';

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

interface Props {
  versions: any[];
  role: string;
  fullName: string;
  token: string;
  onSelectVersion: (id: string, tab?: string) => void;
  onNewVersion?: () => void;
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
  ctaTab: string;
  pulse?: boolean;
}> = {
  DRAFT:        { label: 'שלב טיוטה',          icon: '📋', color: '#4573D2', bg: 'rgba(69,115,210,0.07)',    desc: r => isRm(r) ? 'הגדר לוח זמנים, תכולה ומסגרת הגרסה.' : 'ממתין לפתיחת שלב האיסוף.',               cta: r => isRm(r) ? 'הגדר גרסה' : 'ראה פרטים',       ctaTab: 'list' },
  COLLECTING:   { label: 'איסוף משימות',        icon: '📝', color: '#9C6ADE', bg: 'rgba(156,106,222,0.07)', desc: r => r === 'TEAM_LEAD' ? 'הגש את הצעות המשימות לאישור.' : isRm(r) ? 'עקב אחר שיבוץ הצוותים.'  : 'בדוק אם שובצת למשימות.',                     cta: r => r === 'TEAM_LEAD' ? 'הגש תוכניות' : 'ראה סטטוס', ctaTab: 'proposals' },
  CR_REVIEW:    { label: 'סקירת CR',             icon: '🔍', color: '#E8AF00', bg: 'rgba(232,175,0,0.07)',   desc: r => r === 'TEAM_LEAD' ? 'יש להגיש תוכנית CR לאישור.' : 'צוותים מגישים תוכניות עלייה לאוויר.', cta: r => r === 'TEAM_LEAD' ? 'הגש תוכנית CR' : 'סקור תוכניות', ctaTab: 'implementation-plans' },
  REFINING:     { label: 'טיוב תוכנית',         icon: '✏️', color: '#E8AF00', bg: 'rgba(232,175,0,0.07)',   desc: () => 'שלב טיוב ועדכון תוכניות לאחר הסקירה.',                                                     cta: () => 'פרטי גרסה',            ctaTab: 'list' },
  REVIEW:       { label: 'ישיבת מעבר',          icon: '👥', color: '#4573D2', bg: 'rgba(69,115,210,0.07)',   desc: () => 'ישיבת מעבר עם כלל המשתתפים לאישור סופי.',                                                 cta: () => 'פרטי גרסה',            ctaTab: 'list' },
  APPROVED:     { label: 'תוכנית מאושרת',       icon: '✅', color: '#37C47A', bg: 'rgba(55,196,122,0.07)',   desc: () => 'התוכנית אושרה. ממתינים לחזרה הגנרלית.',                                                    cta: () => 'פרטי גרסה',            ctaTab: 'list' },
  REHEARSAL:    { label: 'חזרה גנרלית פעילה',   icon: '🎭', color: '#7c3aed', bg: 'rgba(124,58,237,0.07)',   desc: () => 'החזרה הגנרלית בביצוע. עקב אחרי התקדמות הצוותים.',                                         cta: () => 'כנס ל-War Room',       ctaTab: 'board', pulse: true },
  ACTIVE:       { label: 'עלייה לאוויר — לייב', icon: '🚀', color: '#F06A6A', bg: 'rgba(240,106,106,0.07)', desc: () => 'עלייה לאוויר פעילה. מעקב בזמן אמת אחרי כלל הצוותים.',                                    cta: () => 'War Room',             ctaTab: 'board', pulse: true },
  MORNING_AFTER:{ label: 'בוקר שלאחר',          icon: '🌅', color: '#F0883E', bg: 'rgba(240,136,62,0.07)',   desc: () => 'שלב בקרות הבוקר. ודא שכל הבדיקות הושלמו.',                                                cta: () => 'לוח בקרה',             ctaTab: 'dashboard', pulse: true },
  COMPLETED:    { label: 'הושלם',               icon: '🏁', color: '#37C47A', bg: 'rgba(55,196,122,0.07)',   desc: () => 'הגרסה הושלמה בהצלחה.',                                                                    cta: () => 'ראה סיכום',            ctaTab: 'summary-night' },
  ROLLED_BACK:  { label: 'Rollback בוצע',       icon: '⏪', color: '#F06A6A', bg: 'rgba(240,106,106,0.07)', desc: () => 'בוצעה חזרה אחורה.',                                                                        cta: () => 'ראה פרטים',            ctaTab: 'list' },
};

function isRm(r: string) { return ['RELEASE_MANAGER', 'ADMIN'].includes(r); }



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

// ────────────────────────────────────────────────────────────────
// Version row (compact)
// ────────────────────────────────────────────────────────────────
function VersionRow({ v, isPrimary, onSelect }: { v: any; isPrimary: boolean; onSelect: (id: string, tab?: string) => void }) {
  const ph = PHASE_META[v.status] ?? PHASE_META['DRAFT'];
  const isLive = ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(v.status);
  return (
    <div
      onClick={() => onSelect(v.id, ph.ctaTab)}
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
      <span style={{ fontSize: '16px', flexShrink: 0 }}>{ph.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, display: 'flex', alignItems: 'center', gap: '6px' }}>
          {v.name}
          {isLive && <span style={{ fontSize: '9px', background: ph.color, color: 'white', borderRadius: '10px', padding: '1px 6px', fontWeight: WEIGHT.bold, letterSpacing: '0.05em', animation: isLive ? 'home-pulse 2s ease-in-out infinite' : 'none' }}>LIVE</span>}
        </div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '1px' }}>{ph.label}</div>
      </div>
      <VersionStatusChip status={v.status} size="xs" />
      <span style={{ ...TEXT.xs, color: ph.color, fontWeight: WEIGHT.medium, flexShrink: 0 }}>פתח ←</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Next action item
// ────────────────────────────────────────────────────────────────
function ActionItem({ icon, title, desc, urgent, onClick }: { icon: string; title: string; desc: string; urgent?: boolean; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '10px',
        padding: '10px 0', borderBottom: `1px solid ${C.border}`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{ fontSize: '16px', flexShrink: 0, marginTop: '1px' }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.medium, color: urgent ? C.danger : C.textPrimary }}>{title}</div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px' }}>{desc}</div>
      </div>
      {urgent && <span style={{ ...TEXT.xs, color: C.danger, fontWeight: WEIGHT.semibold, flexShrink: 0, marginTop: '2px' }}>⚠ דחוף</span>}
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

export const HomeDashboard: React.FC<Props> = ({ versions, role, fullName, token, onSelectVersion, onNewVersion }) => {
  const canCreate = isRm(role);

  const [teamStatus, setTeamStatus] = useState<TeamStatusRow[]>([]);
  const [teamStatusLoading, setTeamStatusLoading] = useState(false);
  const [myTeamSummary, setMyTeamSummary] = useState<{ total: number; ready: number; draft: number } | null>(null);

  // Pick the most urgent non-archived version
  const activeVersions = useMemo(
    () => versions.filter(v => !v.isArchived).sort((a, b) => (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99)),
    [versions]
  );
  const primary = activeVersions[0] ?? null;
  const others  = activeVersions.slice(1);

  const firstName = fullName.split(' ')[0] || fullName;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'שלום' : hour < 21 ? 'ערב טוב' : 'לילה טוב';

  const isLiveNow = primary && ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(primary.status);

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
    const list: { icon: string; title: string; desc: string; urgent?: boolean; tab?: string }[] = [];

    if (st === 'DRAFT' && rm)           list.push({ icon: '📅', title: 'הגדר לוח זמנים', desc: 'קבע תאריכי בדיקות אינטגרציה ועלייה לאוויר', tab: 'list' });
    if (st === 'COLLECTING' && tl)      list.push({ icon: '📝', title: 'הגש תוכניות', desc: 'הגש את הצעות המשימות לאישור', urgent: true, tab: 'proposals' });
    if (st === 'COLLECTING' && rm)      list.push({ icon: '👥', title: 'מעקב הגשת תוכניות', desc: 'בדוק שכל הצוותים הגישו את תוכניות ה-CR', tab: 'proposals' });
    if (st === 'CR_REVIEW' && tl)       list.push({ icon: '📋', title: 'הגש תוכנית CR', desc: 'הגדר תוכנית עלייה לאוויר לצוות שלך', urgent: true, tab: 'implementation-plans' });
    if (st === 'CR_REVIEW' && rm)       list.push({ icon: '🔍', title: 'סקור תוכניות CR', desc: 'אשר או החזר הערות על תוכניות הצוותים', tab: 'implementation-plans' });
    if (st === 'REFINING' && rm)        list.push({ icon: '✏️', title: 'ודא עדכוני תוכניות', desc: 'צוותים מעדכנים לפי הערות', tab: 'implementation-plans' });
    if (st === 'REVIEW' && rm)          list.push({ icon: '👥', title: 'קיים ישיבת מעבר', desc: 'ישיבה עם כלל המשתתפים לאישור סופי', tab: 'list' });
    if (st === 'APPROVED' && rm)        list.push({ icon: '🎭', title: 'פתח חזרה גנרלית', desc: 'הרץ את התוכנית המאושרת כחזרה', tab: 'list' });
    if (['REHEARSAL', 'ACTIVE'].includes(st)) list.push({ icon: '⚡', title: 'War Room', desc: 'עקב אחר ביצוע המשימות בזמן אמת', urgent: true, tab: 'board' });
    if (st === 'MORNING_AFTER' && rm)   list.push({ icon: '🌅', title: 'אשר בקרות בוקר', desc: 'ודא השלמת כל הבדיקות ואשר סיום', tab: 'dashboard' });
    if (st === 'MORNING_AFTER' && rm)   list.push({ icon: '📄', title: 'הכן דוח סיכום', desc: 'צור וסכם את פעילות הלילה', tab: 'summary-night' });

    return list;
  }, [primary, role]);

  // Stats
  const totalVersions  = activeVersions.length;
  const liveCount      = activeVersions.filter(v => ['ACTIVE', 'REHEARSAL'].includes(v.status)).length;
  const planningCount  = activeVersions.filter(v => !['ACTIVE', 'REHEARSAL', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(v.status)).length;

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

      {/* ── No versions ── */}
      {!primary && <EmptyState canCreate={canCreate} onNewVersion={onNewVersion} />}

      {primary && (
        <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* ── Hero banner ── */}
          {(() => {
            const ph = PHASE_META[primary.status] ?? PHASE_META['DRAFT'];
            return (
              <div style={{
                background: ph.bg, border: `1.5px solid ${ph.color}30`, borderRadius: RADIUS.lg,
                padding: '20px 24px', display: 'flex', alignItems: 'center', gap: '20px',
                animation: ph.pulse ? 'home-glow 3s ease-in-out infinite' : 'none',
              }}>
                <span style={{ fontSize: '36px', flexShrink: 0 }}>{ph.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: ph.color, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: '2px' }}>
                    {primary.name}
                  </div>
                  <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: ph.color, marginBottom: '4px' }}>{ph.label}</div>
                  <div style={{ ...TEXT.sm, color: C.textSecondary }}>{ph.desc(role)}</div>
                </div>
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
                  <button
                    onClick={() => onSelectVersion(primary.id, ph.ctaTab)}
                    style={{ background: ph.color, color: 'white', border: 'none', borderRadius: RADIUS.md, padding: '10px 20px', ...TEXT.sm, fontWeight: WEIGHT.semibold, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' as const }}
                  >
                    {ph.cta(role)} ←
                  </button>
                  <button
                    onClick={() => onSelectVersion(primary.id, 'list')}
                    style={{ background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '7px 16px', ...TEXT.xs, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' as const }}
                  >
                    פרטי גרסה
                  </button>
                </div>
              </div>
            );
          })()}

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

          {/* ── Stats row ── */}
          {totalVersions > 0 && (
            <div style={{ display: 'flex', gap: '12px' }}>
              <StatCard value={String(totalVersions)} label="גרסאות פעילות" delta={liveCount > 0 ? `🔴 ${liveCount} בביצוע` : undefined} deltaColor={C.danger} />
              <StatCard value={String(planningCount)} label="בשלבי תכנון" />
              <StatCard value={String(actions.filter(a => a.urgent).length)} label="פעולות דחופות" deltaColor={C.danger} delta={actions.filter(a=>a.urgent).length > 0 ? '⚠ דרוש טיפול' : '✓ הכל תקין'} />
              <StatCard value={String(activeVersions.filter(v=>['COMPLETED','ROLLED_BACK'].includes(v.status)).length + versions.filter(v=>v.isArchived).length)} label="גרסאות שהסתיימו" deltaColor={C.success} />
              {teamStatus.length > 0 && (() => {
                const done = teamStatus.filter(t => t.allDone).length;
                const total = teamStatus.length;
                const hasReturned = teamStatus.some(t => t.returned > 0);
                return (
                  <StatCard
                    value={`${done}/${total}`}
                    label={isCollecting ? 'צוותים הגישו הצעות' : 'צוותים הגישו תוכניות CR'}
                    delta={hasReturned ? `↩ ${teamStatus.reduce((s,t)=>s+t.returned,0)} הוחזרו` : done === total ? '✓ כולם הגישו' : `${total - done} ממתינים`}
                    deltaColor={hasReturned ? C.warning : done === total ? C.success : C.textMuted}
                  />
                );
              })()}
            </div>
          )}

          {/* ── Team submission status panel ── */}
          {showTeamStatus && (
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <span style={{ fontSize: '16px' }}>📋</span>
                <div>
                  <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{isCollecting ? 'סטטוס הגשות הצעות משימות לפי צוות' : 'סטטוס הגשות תוכניות CR לפי צוות'}</div>
                  <div style={{ ...TEXT.xs, color: C.textMuted }}>{isCollecting ? 'מעקב אחר הגשת הצעות המשימות של הצוותים' : 'מעקב אחר הגשת תוכניות עלייה לאוויר'}</div>
                </div>
                {!teamStatusLoading && teamStatus.length > 0 && (() => {
                  const done = teamStatus.filter(t => t.allDone).length;
                  const all  = teamStatus.length;
                  return (
                    <div style={{ marginRight: 'auto', ...TEXT.xs, color: done === all ? C.success : C.warning, fontWeight: WEIGHT.semibold }}>
                      {done}/{all} צוותים השלימו
                    </div>
                  );
                })()}
              </div>

              {/* Warning banner: review approaching + teams haven't submitted */}
              {reviewIsApproaching && !teamStatusLoading && teamStatus.some(t => !t.allDone) && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: 'rgba(232,175,0,0.08)', border: `1px solid rgba(232,175,0,0.35)`, borderRadius: RADIUS.md, padding: '10px 14px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '16px', flexShrink: 0 }}>⏰</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.warning }}>
                      פגישת סקירת התוכניות בעוד {reviewHoursLabel}
                    </div>
                    <div style={{ ...TEXT.xs, color: C.textSecondary, marginTop: '2px' }}>
                      {teamStatus.filter(t => !t.allDone).length} צוותים עדיין לא {isCollecting ? 'הגישו הצעות' : 'הגישו תוכנית CR'} —
                      {' '}{teamStatus.filter(t => !t.allDone).map(t => t.teamName).join(', ')}
                    </div>
                  </div>
                  {reviewMeetingTime && (
                    <div style={{ flexShrink: 0, ...TEXT.xs, color: C.textMuted, textAlign: 'center' as const, whiteSpace: 'nowrap' as const }}>
                      {reviewMeetingTime.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' })}
                      <br />{reviewMeetingTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
              )}

              {teamStatusLoading ? (
                <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: '16px 0' }}>טוען...</div>
              ) : teamStatus.length === 0 ? (
                <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: '16px 0' }}>אין תוכניות CR בגרסה זו</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {teamStatus.map(t => {
                    const pct = t.total > 0 ? Math.round(((t.approved + t.submitted) / t.total) * 100) : 0;
                    const icon = t.allDone ? '✅' : t.returned > 0 ? '↩️' : t.submitted > 0 ? '⏳' : '🔴';
                    const barColor = t.allDone ? C.success : t.returned > 0 ? C.warning : t.submitted > 0 ? '#4573D2' : C.danger;
                    return (
                      <div
                        key={t.teamId}
                        onClick={() => primary && onSelectVersion(primary.id, isCollecting ? 'proposals' : 'implementation-plans')}
                        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: RADIUS.sm, cursor: 'pointer', border: `1px solid ${C.border}`, transition: EASE.fast }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.bgHover}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                      >
                        <span style={{ fontSize: '14px', flexShrink: 0 }}>{icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{t.teamName}</span>
                            <span style={{ ...TEXT.xs, color: C.textMuted, flexShrink: 0, marginRight: '8px' }}>
                              {isCollecting ? (
                                <>
                                  {t.submitted > 0 && <span style={{ color: C.success }}>✓{t.submitted} מוכנות </span>}
                                  {t.draft > 0    && <span style={{ color: C.textMuted }}>✎{t.draft} טיוטה</span>}
                                </>
                              ) : (
                                <>
                                  {t.approved > 0 && <span style={{ color: C.success }}>✓{t.approved} </span>}
                                  {t.submitted > 0 && <span style={{ color: '#4573D2' }}>↑{t.submitted} </span>}
                                  {t.returned > 0 && <span style={{ color: C.warning }}>↩{t.returned} </span>}
                                  {t.draft > 0 && <span style={{ color: C.textMuted }}>✎{t.draft}</span>}
                                </>
                              )}
                            </span>
                          </div>
                          <div style={{ height: '4px', borderRadius: '2px', background: C.border, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: '2px', transition: 'width 0.4s ease' }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Two-column body ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', alignItems: 'start' }}>

            {/* Left: Actions */}
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '20px' }}>
              <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '4px' }}>📌 הפעולות הבאות שלך</div>
              <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '14px' }}>לפי תפקיד ושלב הגרסה הנוכחי</div>

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
                    <ActionItem
                      key={i}
                      icon={a.icon}
                      title={a.title}
                      desc={a.desc}
                      urgent={a.urgent}
                      onClick={a.tab ? () => onSelectVersion(primary.id, a.tab) : undefined}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Right: All versions */}
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '20px' }}>
              <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '14px' }}>
                📦 כל הגרסאות הפעילות
              </div>

              <VersionRow v={primary} isPrimary onSelect={onSelectVersion} />
              {others.map(v => <VersionRow key={v.id} v={v} isPrimary={false} onSelect={onSelectVersion} />)}

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
      )}
    </div>
  );
};
