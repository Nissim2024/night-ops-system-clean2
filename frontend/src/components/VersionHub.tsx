import React, { useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { C, SHADOW } from '../theme';
import { useDialog } from '../context/DialogContext';
import { VersionStatusChip } from './ui';
import { formatDate as fmtDateShared, formatDateTime as fmtDateTimeShared } from '../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Props {
  version: any;
  onNavigate: (tab: string) => void;
  userRole: string;
  token: string;
  onVersionUpdated?: () => void;
}

interface Card {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  tab: string;
  enabled: boolean;
  badge?: string;
  badgeColor?: string;
}

const fmt = (d: string | null | undefined) => d ? fmtDateTimeShared(d) : null;

export const VersionHub: React.FC<Props> = ({ version, onNavigate, userRole, token, onVersionUpdated }) => {
  const dialog = useDialog();
  if (!version) return null;

  const s = version.status;
  const isManager = ['RELEASE_MANAGER', 'ADMIN'].includes(userRole);
  const isClosed  = ['COMPLETED', 'ROLLED_BACK'].includes(s);
  const isAdmin   = userRole === 'ADMIN';
  const isLocked  = isClosed;   // גרסות סגורות נעולות לכולם — כולל ADMIN
  const canEdit   = !isLocked && ['RELEASE_MANAGER', 'ADMIN', 'CR_MANAGER'].includes(userRole);
  const now       = new Date();
  const plannedStartPassed = version.plannedStart ? new Date(version.plannedStart) <= now : false;
  const rehearsalTimePassed = version.lastRehearsalAt ? true : s === 'REHEARSAL';   // ADMIN תמיד יכול לערוך, שאר — רק גרסה לא סגורה

  const headers = { Authorization: `Bearer ${token}` };

  // ── נתוני-מאקרו ──
  const [stats, setStats] = useState<{
    totalTasks: number; doneTasks: number; blockedTasks: number; inProgressTasks: number; waitingTasks: number;
    submittedTeams: number; totalTeams: number;
    approvedCRs: number; totalCRs: number;
    alerts: { type: 'error' | 'warn'; text: string }[];
  } | null>(null);
  const [rehearsalStats, setRehearsalStats] = useState<{
    totalTasks: number; doneTasks: number; blockedTasks: number; inProgressTasks: number; waitingTasks: number;
    submittedTeams: number; totalTeams: number; approvedCRs: number; totalCRs: number;
    alerts: { type: 'error' | 'warn'; text: string }[];
  } | null>(null);
  const [crStats, setCrStats] = useState<{
    qaTaskCount: number; totalEstimateDays: number; actualsCount: number;
  } | null>(null);
  const [myTeamRequiresPlan, setMyTeamRequiresPlan] = useState<boolean>(true);

  useEffect(() => {
    if (userRole === 'TEAM_LEAD') {
      axios.get(`${API}/teams/mine`, { headers })
        .then(r => { if (r.data && r.data.requiresPlan === false) setMyTeamRequiresPlan(false); })
        .catch(() => {});
    }
  }, []); // eslint-disable-line

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [verRes, subsRes, teamsRes] = await Promise.all([
          axios.get(`${API}/versions/${version.id}`, { headers }),
          axios.get(`${API}/versions/${version.id}/submissions`, { headers }).catch(() => ({ data: [] })),
          axios.get(`${API}/teams`, { headers }).catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        const v = verRes.data;
        const allTasks: any[] = (v.phases ?? []).flatMap((p: any) =>
          (p.subPhases ?? []).flatMap((sp: any) => sp.tasks ?? []));
        const subs: any[] = subsRes.data ?? [];
        // צוותים הפטורים מהגשת תוכנית (Team.requiresPlan=false) לא נספרים כ"מעורבים"
        const exemptTeamIds = new Set<string>(
          (teamsRes.data ?? []).filter((t: any) => t.requiresPlan === false).map((t: any) => t.id)
        );
        // צוותים מעורבים = רק צוותים שיש להם משימה בגרסה בפועל, ושאינם פטורים
        const involvedTeamIds = new Set<string>(
          allTasks.map((t: any) => t.assignedTeamId).filter((id: any) => id && !exemptTeamIds.has(id))
        );
        const totalTeams     = involvedTeamIds.size;
        const submittedTeams = subs.filter((s: any) =>
          s.status === 'SUBMITTED' && involvedTeamIds.has(s.teamId)
        ).length;
        // CRs from cr-plans (if available) — best-effort
        let approvedCRs = 0, totalCRs = 0;
        try {
          const crRes = await axios.get(`${API}/cr-plans/version/${version.id}`, { headers });
          if (!cancelled) {
            const crs = crRes.data ?? [];
            const crNums: string[]      = crs.map((c: any) => c.crNumber as string);
            const approvedNums: string[] = crs.filter((c: any) => c.planApproved || c.notNeededForPlan).map((c: any) => c.crNumber as string);
            totalCRs    = crNums.filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).length;
            approvedCRs = approvedNums.filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).length;
            // Save approved plans for display in hub
          }
        } catch {}
        if (cancelled) return;

        const alerts: { type: 'error' | 'warn'; text: string }[] = [];
        const blocked = allTasks.filter(t => t.status === 'BLOCKED');
        const failed  = allTasks.filter(t => t.status === 'FAILED');
        if (blocked.length) alerts.push({ type: 'error', text: `${blocked.length} משימות חסומות` });
        if (failed.length)  alerts.push({ type: 'error', text: `${failed.length} משימות נכשלו` });
        if (totalTeams > 0 && submittedTeams < totalTeams && ['COLLECTING', 'CR_REVIEW', 'REFINING'].includes(s)) {
          alerts.push({ type: 'warn', text: `${totalTeams - submittedTeams} מתוך ${totalTeams} צוותים מעורבים טרם הגישו תוכנית` });
        }
        if (totalCRs > 0 && approvedCRs < totalCRs && ['CR_REVIEW', 'REFINING'].includes(s)) {
          alerts.push({ type: 'warn', text: `${totalCRs - approvedCRs} CR-ים טרם אושרו` });
        }

        setStats({
          totalTasks: allTasks.length,
          doneTasks:  allTasks.filter(t => t.status === 'DONE').length,
          blockedTasks: blocked.length + failed.length,
          inProgressTasks: allTasks.filter(t => t.status === 'IN_PROGRESS').length,
          waitingTasks: allTasks.filter(t => t.status === 'WAITING').length,
          submittedTeams, totalTeams, approvedCRs, totalCRs, alerts,
        });

        // CR assignment stats (best-effort — requires Excel sync to have run)
        try {
          const crStatsRes = await axios.get(`${API}/version-cr-assignments/version/${version.id}/stats`, { headers });
          if (!cancelled) setCrStats(crStatsRes.data);
        } catch {}

        // Rehearsal stats from snapshot (after rehearsal ends tasks are reset)
        const snapshot: any[] = v.lastRehearsalSnapshot ?? [];
        if (snapshot.length > 0) {
          setRehearsalStats({
            totalTasks: snapshot.length,
            doneTasks: snapshot.filter((t: any) => t.status === 'DONE').length,
            blockedTasks: snapshot.filter((t: any) => ['BLOCKED', 'FAILED'].includes(t.status)).length,
            inProgressTasks: snapshot.filter((t: any) => t.status === 'IN_PROGRESS').length,
            waitingTasks: snapshot.filter((t: any) => t.status === 'WAITING').length,
            submittedTeams: 0, totalTeams: 0, approvedCRs: 0, totalCRs: 0, alerts: [],
          });
        }
      } catch {}
    };
    load();
    return () => { cancelled = true; };
  }, [version.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── "הצעד הבא" לפי סטטוס — fixed 11-value enum, mapped to literal Tailwind
  // class strings (not built via interpolation) rather than raw hex.
  const CTA_MAP: Record<string, { icon: string; text: string; colorClass: string; tab?: string }> = {
    DRAFT:         { icon: '📝', text: 'פתח לאיסוף משימות מהצוותים', colorClass: 'text-primary', tab: 'version-detail' },
    COLLECTING:    { icon: '📥', text: stats ? `${stats.submittedTeams}/${stats.totalTeams} צוותים הגישו — עקוב אחר ההגשות` : 'ממתין להגשות צוותים', colorClass: 'text-warning', tab: 'proposals' },
    CR_REVIEW:     { icon: '🔍', text: stats ? `${stats.approvedCRs}/${stats.totalCRs} CR-ים אושרו — השלם סקירה` : 'בסקירת תוכניות CR', colorClass: 'text-warning', tab: 'cr-review' },
    REFINING:      { icon: '✏️', text: 'בשלב טיוב התוכנית — עבור לישיבת מעבר', colorClass: 'text-primary', tab: 'version-detail' },
    REVIEW:        { icon: '✅', text: 'ניתן לאשר את התוכנית', colorClass: 'text-success', tab: 'version-detail' },
    APPROVED:      { icon: '🎭', text: 'התוכנית מאושרת — ניתן להתחיל חזרה גנרלית', colorClass: 'text-[#7c3aed]', tab: 'version-detail' },
    REHEARSAL:     { icon: '🎭', text: 'חזרה גנרלית פעילה — עבור ל-War Room', colorClass: 'text-[#7c3aed]', tab: 'board' },
    ACTIVE:        { icon: '🚀', text: stats && stats.totalTasks > 0 ? `הרצה פעילה — ${Math.round(stats.doneTasks / stats.totalTasks * 100)}% הושלמו` : 'הרצה פעילה', colorClass: 'text-danger', tab: 'board' },
    MORNING_AFTER: { icon: '🌅', text: stats ? `${stats.totalTasks - stats.doneTasks} משימות בוקר נותרו` : 'משימות בוקר שלאחר הגרסה', colorClass: 'text-warning', tab: 'board' },
    COMPLETED:     { icon: '🏆', text: 'הגרסה הושלמה בהצלחה', colorClass: 'text-success' },
    ROLLED_BACK:   { icon: '🔄', text: 'הגרסה עברה Rollback', colorClass: 'text-subtle-foreground' },
  };
  const cta = CTA_MAP[s];

  // שמירה אוטומטית בשינוי שדה
  const saveField = useCallback(async (field: string, value: string) => {
    try {
      await axios.patch(`${API}/versions/${version.id}`, { [field]: value || null }, { headers });
      onVersionUpdated?.();
    } catch { /* שגיאות נשמטות בשקט */ }
  }, [version.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const isExecution      = ['REHEARSAL', 'ACTIVE', 'MORNING_AFTER'].includes(s);
  const isNightExecution = ['ACTIVE', 'MORNING_AFTER'].includes(s); // excludes REHEARSAL
  const isPlanning       = ['DRAFT', 'COLLECTING', 'CR_REVIEW', 'REFINING', 'REVIEW', 'APPROVED'].includes(s);
  const hasRehearsal  = !!version.lastRehearsalAt;
  const hasNight      = s !== 'REHEARSAL' && (!!version.actualStart || ['ACTIVE', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(s));
  const hasCrPlans    = version.crPlanCount > 0 || ['CR_REVIEW', 'REFINING', 'REVIEW', 'APPROVED', 'REHEARSAL', 'ACTIVE', 'MORNING_AFTER', 'COMPLETED'].includes(s);
  const hasNightSummary  = !!version.nightSummary?.sentAt;
  const hasRehearsalSummary = !!version.rehearsalSummary?.sentAt;
  const isCompleted   = ['COMPLETED', 'ROLLED_BACK'].includes(s);

  // גרסה סגורה — כל כרטיס עם נתונים מאופשר לצפייה
  const enabledWhenClosed = (hasData: boolean) => isClosed ? hasData : false;

  const ROWS: { title: string; accent: string; cards: Card[] }[] = [
    {
      title: 'תכנון',
      accent: C.brand,
      cards: [
        {
          id: 'plan',
          icon: '📊',
          title: isPlanning && s !== 'APPROVED' ? 'בנה תוכנית' : 'תוכנית עבודה',
          subtitle: isPlanning && s !== 'APPROVED'
            ? 'ייבוא, אשף, תבנית או בנייה ידנית'
            : 'כל המשימות לפי שלבים',
          tab: isPlanning && s !== 'APPROVED' ? 'version-detail' : 'board',
          enabled: true,
        },
        {
          id: 'timeline',
          icon: '⏱',
          title: 'ציר זמן',
          subtitle: (() => {
            if (plannedStartPassed || hasRehearsal || hasNight) return 'מפת זמנים מתוכננת מול בפועל';
            if (!version.plannedStart) return 'יפתח עם תחילת ההרצה';
            const diffMs = new Date(version.plannedStart).getTime() - now.getTime();
            const diffDays = Math.ceil(diffMs / 86400000);
            const diffHours = Math.ceil(diffMs / 3600000);
            if (diffDays > 1) return `יפתח בעוד ${diffDays} ימים`;
            if (diffHours > 1) return `יפתח בעוד ${diffHours} שעות`;
            return 'יפתח בקרוב';
          })(),
          tab: 'timeline',
          enabled: plannedStartPassed || hasRehearsal || hasNight || isClosed,
          badge: !plannedStartPassed && !hasRehearsal && !hasNight && !isClosed ? '⏳ טרם הגיע הזמן' : undefined,
          badgeColor: C.textMuted,
        },
        ...(userRole === 'TEAM_LEAD' ? [{
          id: 'proposals',
          icon: '📝',
          title: 'הגשת משימות',
          subtitle: s === 'COLLECTING' ? 'הגש משימות לגרסה עבור צוותך'
                  : s === 'CR_REVIEW'  ? 'שלב האיסוף הסתיים — בסקירת מנהל'
                  : 'הגשת משימות סגורה',
          tab: 'proposals',
          enabled: ['COLLECTING', 'CR_REVIEW'].includes(s),
          badge: s === 'CR_REVIEW' ? '🔍 בסקירה' : !['COLLECTING', 'CR_REVIEW'].includes(s) ? 'סגור' : undefined,
          badgeColor: s === 'CR_REVIEW' ? '#2980b9' : C.textMuted,
        }] : []),
        ...(isManager ? [{
          id: 'cr-plans',
          icon: '🔍',
          title: 'תוכניות CR',
          subtitle: 'CR-ים שנסקרו ואושרו',
          tab: 'cr-review',
          enabled: hasCrPlans || enabledWhenClosed(hasCrPlans),
          badge: undefined as string | undefined,
          badgeColor: C.textMuted,
        }] : []),
        ...(isManager ? [{
          id: 'unified-plan',
          icon: '📜',
          title: 'תוכנית מאוחדת',
          subtitle: 'תסריט אחד רציף לכל הצוותים לפי סדר זמנים',
          tab: 'unified-plan',
          enabled: hasCrPlans || enabledWhenClosed(hasCrPlans),
          badge: undefined as string | undefined,
          badgeColor: C.textMuted,
        }] : []),
        ...(['RELEASE_MANAGER', 'ADMIN', 'CR_MANAGER'].includes(userRole) ? [{
          id: 'implementation-plans',
          icon: '📁',
          title: 'תוכניות הטמעה',
          subtitle: 'הגשה, סקירה ואישור תוכניות הטמעה',
          tab: 'implementation-plans',
          enabled: ['COLLECTING', 'CR_REVIEW', 'REFINING', 'REVIEW', 'APPROVED', 'REHEARSAL', 'ACTIVE', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(s),
          badge: undefined as string | undefined,
          badgeColor: C.textMuted,
        }] : []),
      ],
    },
    {
      title: 'חזרה גנרלית',
      accent: '#f0883e',
      cards: [
        {
          id: 'rehearsal-board',
          icon: '🎭',
          title: 'War Room — חזרה',
          subtitle: s === 'REHEARSAL'
            ? 'פעיל כעת'
            : hasRehearsal
            ? `הסתיים: ${fmt(version.lastRehearsalAt)} — ראה דוח סיכום`
            : 'טרם הורצה',
          tab: 'board',
          enabled: s === 'REHEARSAL',
          badge: hasRehearsal && s !== 'REHEARSAL' ? '✓ הסתיים' : undefined,
          badgeColor: hasRehearsal && s !== 'REHEARSAL' ? C.statusDone : undefined,
        },
        {
          id: 'rehearsal-dashboard',
          icon: '🎛',
          title: 'לוח בקרה — חזרה',
          subtitle: s === 'REHEARSAL'
            ? 'מעקב חזרה בזמן-אמת עם GO/NO-GO'
            : hasRehearsal
            ? 'הסתיים — ראה דוח סיכום'
            : 'יפתח בעת החזרה הגנרלית',
          tab: 'dashboard',
          enabled: s === 'REHEARSAL',
          badge: hasRehearsal && s !== 'REHEARSAL'
            ? '✓ הסתיים'
            : !rehearsalTimePassed
            ? '⏳ טרם הגיע הזמן'
            : undefined,
          badgeColor: hasRehearsal && s !== 'REHEARSAL' ? C.statusDone : C.textMuted,
        },
        {
          id: 'rehearsal-summary',
          icon: '📄',
          title: 'דוח סיכום — חזרה',
          subtitle: hasRehearsalSummary
            ? `אושר: ${fmt(version.rehearsalSummary?.sentAt)}`
            : hasRehearsal ? 'טרם הופק' : 'טרם הורצה חזרה',
          tab: 'summary-rehearsal',
          enabled: hasRehearsal || s === 'REHEARSAL',
          badge: hasRehearsalSummary ? '✓ מאושר' : undefined,
          badgeColor: hasRehearsalSummary ? C.statusDone : undefined,
        },
      ],
    },
    {
      title: 'הרצה אמיתית',
      accent: '#ff7b72',
      cards: [
        {
          id: 'night-board',
          icon: '🚀',
          title: 'War Room — הרצה',
          subtitle: hasNight
            ? version.actualStart ? `התחיל: ${fmt(version.actualStart)}` : 'פעיל כעת'
            : 'טרם הורצה',
          tab: 'board',
          enabled: hasNight || isNightExecution,
        },
        {
          id: 'dashboard',
          icon: '🎛',
          title: 'לוח בקרה',
          subtitle: isNightExecution ? 'מעקב זמן-אמת פעיל' : 'פעיל בזמן הרצה בלבד',
          tab: 'dashboard',
          enabled: isNightExecution,
          badge: !isNightExecution ? 'בזמן הרצה' : undefined,
          badgeColor: C.textMuted,
        },
        {
          id: 'night-summary',
          icon: '🌙',
          title: 'דוח סיכום — הרצה',
          subtitle: hasNightSummary
            ? `אושר: ${fmt(version.nightSummary?.sentAt)}`
            : hasNight ? 'טרם הופק' : 'טרם הורצה לילה',
          tab: 'summary-night',
          enabled: hasNight || isNightExecution,
          badge: hasNightSummary ? '✓ מאושר' : undefined,
          badgeColor: hasNightSummary ? C.statusDone : undefined,
        },
      ],
    },
  ];

  // Restrict visible cards based on role
  const TEAM_LEAD_CARDS = new Set(['proposals', 'implementation-plans', 'rehearsal-board', 'night-board']);
  const TEAM_LEAD_TABS  = new Set(['proposals', 'implementation-plans', 'board']);
  const CR_MANAGER_CARDS = new Set(['implementation-plans']);
  const visibleRows = ROWS.map(row => ({
    ...row,
    cards: userRole === 'TEAM_LEAD' ? row.cards.filter(c => TEAM_LEAD_CARDS.has(c.id))
         : userRole === 'CR_MANAGER' ? row.cards.filter(c => CR_MANAGER_CARDS.has(c.id))
         : row.cards,
  })).filter(row => row.cards.length > 0);
  // CTA tab guard: suppress navigation when role restricts target tab
  const ctaTab = userRole === 'TEAM_LEAD' && cta?.tab && !TEAM_LEAD_TABS.has(cta.tab) ? undefined
               : userRole === 'CR_MANAGER' && cta?.tab && cta.tab !== 'implementation-plans' ? undefined
               : cta?.tab;

  return (
    <div>

      {/* בנר נעילה לגרסאות סגורות */}
      {isLocked && (
        <div className="bg-muted border border-border rounded-md px-4 py-2.5 mb-4 flex items-center gap-2 text-[15px] text-subtle-foreground">
          🔒 <strong className="text-muted-foreground">גרסה סגורה — תצוגה בלבד.</strong> רק מנהל מערכת (ADMIN) יכול לערוך.
        </div>
      )}

      {/* ── פאנל שלבי בנייה — DRAFT בלבד ── */}
      {s === 'DRAFT' && isManager && (
        <div className="bg-card border-2 border-primary/30 rounded-xl px-5 py-[18px] mb-4">
          <div className="flex items-center gap-2 mb-3.5">
            <span className="text-lg">🏗️</span>
            <span className="text-base font-bold text-foreground">איך לבנות את התוכנית?</span>
          </div>
          <div className="grid grid-cols-4 gap-2.5">
            {[
              { icon: '📤', title: 'ייבוא מ-Excel', sub: 'טען קובץ XLS עם משימות', color: C.statusDone },
              { icon: '🏷️', title: 'שימוש בתבנית', sub: 'טעינה מתבנית שמורה',   color: C.statusOpen },
              { icon: '🔧', title: 'אשף הכנת תוכנית', sub: 'מסגרת זמן, עובדים, תלויות', color: C.warning },
              { icon: '✏️', title: 'בנייה ידנית',  sub: 'הוסף שלבים ומשימות', color: C.textSecondary },
            ].map(step => (
              // Kept as inline style (unchanged pattern): per-step accent color is
              // dynamic and its hover effect is driven imperatively via
              // onMouseEnter/onMouseLeave, not a static Tailwind pseudo-class.
              <button
                key={step.title}
                onClick={() => onNavigate('version-detail')}
                style={{
                  background: C.bgNested, border: `1px solid ${step.color}44`,
                  borderRadius: '10px', padding: '14px 12px',
                  cursor: 'pointer', textAlign: 'right' as const,
                  display: 'flex', flexDirection: 'column', gap: '6px',
                  transition: 'transform 0.12s, box-shadow 0.12s',
                  boxShadow: SHADOW.sm,
                  borderRight: `4px solid ${step.color}`,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.12)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = SHADOW.sm; }}
              >
                <span className="text-[22px]">{step.icon}</span>
                <span className="text-[15px] font-bold text-foreground">{step.title}</span>
                <span className="text-[13px] text-subtle-foreground leading-snug">{step.sub}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 text-sm text-subtle-foreground flex items-center gap-1.5">
            <span>💡</span>
            <span>לחץ על אחד הכפתורים — תגיע ל"פרטי גרסה" שם נמצאים כל הכלים לבנייה.</span>
          </div>
        </div>
      )}


      {/* כרטיס פרטי גרסה — עם עריכה אינליין */}
      <div className={`bg-card rounded-2xl px-6 py-5 mb-5 border-s-4 border-s-primary shadow-sm ${isClosed ? 'border border-neutral-300' : 'border border-border'}`}>
        {/* שורת כותרת */}
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <h2 className="m-0 text-xl font-bold text-foreground">{version.name}</h2>
            <VersionStatusChip status={version.status} size="sm" />
            {version.creator?.fullName && (
              <span className="text-sm text-subtle-foreground">👤 {version.creator.fullName}</span>
            )}
          </div>
          <div className="flex gap-2 items-center">
            {isAdmin && (
              <button
                onClick={async () => {
                  if (!await dialog.confirm(`למחוק את הגרסה "${version.name}" לצמיתות?\nפעולה זו אינה הפיכה.`, 'מחיקת גרסה', 'danger')) return;
                  try {
                    await axios.delete(`${API}/versions/${version.id}`, { headers });
                    onVersionUpdated?.();
                  } catch (err: any) {
                    dialog.alert(err?.response?.data?.message || 'שגיאה במחיקת הגרסה', 'שגיאה', 'danger');
                  }
                }}
                className="px-3 py-1.5 bg-danger-bg text-danger border border-danger/30 rounded-md cursor-pointer text-sm font-semibold"
                title="מחק גרסה (Admin בלבד)"
              >
                🗑 מחק
              </button>
            )}
          </div>
        </div>

        {/* שדות תאריכים — עריכה אינליין, ממוינים לפי מועד */}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {([
            { icon: '📅', label: 'התחלה מתוכננת',   field: 'plannedStart',      value: version.plannedStart,      dateOnly: false },
            { icon: '🏁', label: 'סיום מתוכנן',      field: 'plannedEnd',        value: version.plannedEnd,        dateOnly: false },
            { icon: '🗓', label: 'ישיבת סקירת CR-ים',   field: 'reviewMeetingTime',    value: version.reviewMeetingTime,    dateOnly: false },
            { icon: '📋', label: 'ישיבת הצגת תוכנית עליה לאוויר',  field: 'workPlanMeetingTime',  value: version.workPlanMeetingTime,  dateOnly: false },
            { icon: '🔧', label: 'תחילת אינטגרציה',   field: 'integrationStart',  value: version.integrationStart,  dateOnly: true  },
            { icon: '🔧', label: 'סיום אינטגרציה',    field: 'integrationEnd',    value: version.integrationEnd,    dateOnly: true  },
            { icon: '🧪', label: 'תחילת בדיקות QA',   field: 'qaStart',           value: version.qaStart,           dateOnly: true  },
            { icon: '🧪', label: 'סיום בדיקות QA',    field: 'qaEnd',             value: version.qaEnd,             dateOnly: true  },
          ] as { icon: string; label: string; field: string; value: any; dateOnly: boolean }[])
            .sort((a, b) => {
              if (!a.value && !b.value) return 0;
              if (!a.value) return 1;
              if (!b.value) return -1;
              return new Date(a.value).getTime() - new Date(b.value).getTime();
            })
            .map(({ icon, label, field, value, dateOnly }) => {
            const inputType = dateOnly ? 'date' : 'datetime-local';
            const currentVal = value ? (dateOnly ? value.slice(0, 10) : value.slice(0, 16)) : '';
            return (
              <div key={field} className="flex flex-col gap-1">
                <span className="text-[13px] text-subtle-foreground font-semibold">
                  {icon} {label}
                </span>
                {canEdit ? (
                  // Focus/blur border-color swap kept as imperative handlers
                  // (matches the original — a static focus-visible ring would
                  // change the interaction, not just its styling).
                  <input
                    type={inputType}
                    defaultValue={currentVal}
                    onBlur={e => { if (e.target.value !== currentVal) saveField(field, e.target.value); }}
                    className="bg-muted text-foreground border border-border rounded-sm px-2 py-1.5 text-[15px] outline-none cursor-pointer w-full box-border"
                    onFocus={e => (e.target as HTMLElement).style.borderColor = C.brand}
                    onBlurCapture={e => (e.target as HTMLElement).style.borderColor = C.border}
                  />
                ) : (
                  <span className={`text-[15px] py-1.5 ${value ? 'text-foreground' : 'text-subtle-foreground'}`}>
                    {value ? (dateOnly ? fmtDateShared(value) : fmt(value)) : '—'}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* סיכום נתוני גרסה — צוותים, משימות, CR-ים */}
        {stats && (stats.totalTeams > 0 || stats.totalTasks > 0 || stats.totalCRs > 0) && (
          <div className="flex gap-1.5 flex-wrap mt-3.5 pt-3 border-t border-border">
            {stats.totalTeams > 0 && (
              <span className="text-sm px-2.5 py-[3px] rounded-full bg-muted border border-border text-muted-foreground">
                👥 <strong>{stats.totalTeams}</strong> צוותים
              </span>
            )}
            {stats.totalTasks > 0 && (
              <span className="text-sm px-2.5 py-[3px] rounded-full bg-muted border border-border text-muted-foreground">
                📋 <strong>{stats.totalTasks}</strong> משימות
              </span>
            )}
            {stats.totalCRs > 0 && (
              <span className={`text-sm px-2.5 py-[3px] rounded-full border ${stats.approvedCRs === stats.totalCRs ? 'bg-success-bg border-success/30 text-success' : 'bg-muted border-border text-muted-foreground'}`}>
                🔧 <strong>{stats.approvedCRs}/{stats.totalCRs}</strong> CR-ים אושרו
              </span>
            )}
            {stats.submittedTeams > 0 && stats.totalTeams > 0 && stats.submittedTeams < stats.totalTeams && (
              <span className="text-sm px-2.5 py-[3px] rounded-full bg-warning-bg border border-warning/30 text-warning">
                📥 <strong>{stats.submittedTeams}/{stats.totalTeams}</strong> צוותים הגישו
              </span>
            )}
            {crStats && (
              <span className="text-sm px-2.5 py-[3px] rounded-full bg-muted border border-border text-muted-foreground">
                🧪 QA &gt; 0.5 יום: <strong>{crStats.qaTaskCount}</strong> CR-ים
              </span>
            )}
            {crStats && (
              <span className="text-sm px-2.5 py-[3px] rounded-full bg-muted border border-border text-muted-foreground">
                📊 סך כל הערכות: <strong>{crStats.totalEstimateDays}</strong> ימים
              </span>
            )}
            {crStats && (
              <span className={`text-sm px-2.5 py-[3px] rounded-full border ${crStats.actualsCount > 0 ? 'bg-success-bg border-success/30 text-success' : 'bg-muted border-border text-muted-foreground'}`}>
                ✅ דיווח בפועל: <strong>{crStats.actualsCount}</strong> CR-ים
              </span>
            )}
          </div>
        )}

        {/* נתוני הרצה בפועל (קריאה בלבד) */}
        {(version.actualStart || version.lastRehearsalAt || version.lastNightAt) && (
          <div className="flex gap-4 flex-wrap mt-3.5 pt-3 border-t border-border text-sm">
            {version.actualStart && (
              <span className="text-warning">🚀 הרצה התחילה: {fmt(version.actualStart)}</span>
            )}
            {version.lastRehearsalAt && (
              <span className="text-[#f0883e]">🎭 חזרה הסתיימה: {fmt(version.lastRehearsalAt)}</span>
            )}
            {version.lastNightAt && (
              <span className="text-success">✅ לילה הסתיים: {fmt(version.lastNightAt)}</span>
            )}
          </div>
        )}
      </div>

      {/* שלוש שורות */}
      {visibleRows.map(row => {
        const isPlanningRow  = row.title === 'תכנון';
        const isRehearsalRow = row.title === 'חזרה גנרלית';
        const isExecRow      = row.title === 'הרצה אמיתית';
        const showDates      = isRehearsalRow || isExecRow;
        const effectiveStats = isRehearsalRow && rehearsalStats && s !== 'REHEARSAL'
          ? rehearsalStats
          : stats;
        const showStats      = !!effectiveStats && effectiveStats.totalTasks > 0 && (isRehearsalRow || (isExecRow && hasNight));
        const showProgress   = showStats && (
          (isRehearsalRow && (s === 'REHEARSAL' || (!!rehearsalStats && s !== 'REHEARSAL'))) ||
          (isExecRow && hasNight)
        );
        const planningCta    = ['DRAFT','COLLECTING','CR_REVIEW','REFINING','REVIEW','APPROVED'].includes(s);
        const showAlerts     = isPlanningRow && !!stats && ((!!cta && planningCta) || stats.alerts.length > 0);
        return (
        <div key={row.title} className="mb-4">
          {/* כותרת שורה */}
          <div className="flex items-center gap-2 mb-2.5 flex-wrap">
            <div className="h-[3px] w-6 rounded-sm shrink-0" style={{ background: row.accent }} />
            <span className="text-[13px] font-bold text-subtle-foreground tracking-wider uppercase shrink-0">
              {row.title}
            </span>
            {/* תאריכי הטמעה בכותרת שורת חזרה/הרצה */}
            {showDates && (version.plannedStart || version.plannedEnd) && (
              <div className="flex gap-3.5 ms-auto text-sm text-muted-foreground">
                {version.plannedStart && <span>📅 <strong>התחלה מתוכננת</strong> {fmt(version.plannedStart)}</span>}
                {version.plannedEnd   && <span>🏁 <strong>סיום מתוכנן</strong> {fmt(version.plannedEnd)}</span>}
              </div>
            )}
          </div>

          {/* פנל CTA + התראות — בשורת תכנון בלבד */}
          {showAlerts && (
            <div className="bg-card border border-border rounded-[10px] px-4 py-3 mb-2.5">
              {cta && (
                <div
                  onClick={() => ctaTab && onNavigate(ctaTab)}
                  className={`flex items-center gap-2 py-1 ${ctaTab ? 'cursor-pointer' : 'cursor-default'} ${stats!.alerts.length > 0 ? 'border-b border-border/30 mb-2' : 'mb-0'}`}
                >
                  <span className="text-[17px]">{cta.icon}</span>
                  <span className={`text-[15px] font-bold flex-1 ${cta.colorClass}`}>{cta.text}</span>
                  {ctaTab && <span className={`text-[13px] opacity-70 ${cta.colorClass}`}>← לחץ למעבר</span>}
                </div>
              )}
              {stats!.alerts.map((a, i) => (
                <div key={i} className={`flex items-center gap-2 py-1 font-semibold text-[15px] ${i > 0 ? 'border-t border-border/20' : ''} ${a.type === 'error' ? 'text-danger' : 'text-warning'}`}>
                  <span className="text-base">{a.type === 'error' ? '🚨' : '⚠️'}</span>
                  <span>{a.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* פנל stats + גרף התקדמות — בשורות חזרה והרצה */}
          {showStats && (
            <div className="bg-card border border-border rounded-[10px] px-4 py-2.5 mb-2.5">
              {/* שורת קוביות */}
              <div className="flex items-center">
                {[
                  { label: 'משימות',   value: effectiveStats!.totalTasks,      colorClass: 'text-foreground' },
                  { label: 'הושלמו',  value: effectiveStats!.doneTasks,       colorClass: 'text-success' },
                  { label: 'בביצוע',  value: effectiveStats!.inProgressTasks, colorClass: 'text-warning' },
                  { label: 'ממתינות', value: effectiveStats!.waitingTasks,    colorClass: effectiveStats!.waitingTasks > 0 ? 'text-warning' : 'text-subtle-foreground' },
                  { label: 'חסומות',  value: effectiveStats!.blockedTasks,    colorClass: effectiveStats!.blockedTasks > 0 ? 'text-danger' : 'text-subtle-foreground' },
                  ...(effectiveStats!.totalTeams > 0 ? [{ label: 'צוותים', value: effectiveStats!.totalTeams, colorClass: 'text-muted-foreground' }] : []),
                  ...(effectiveStats!.totalCRs  > 0 ? [{ label: 'CR-ים',  value: effectiveStats!.totalCRs,   colorClass: 'text-muted-foreground' }] : []),
                ].map((stat, i, arr) => (
                  <div key={stat.label} className="flex flex-col items-center px-4 min-w-[65px]" style={{ borderInlineStart: i < arr.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                    <span className={`text-xl font-bold leading-tight ${stat.colorClass}`}>{stat.value}</span>
                    <span className="text-[13px] text-subtle-foreground mt-0.5">{stat.label}</span>
                  </div>
                ))}
              </div>
              {/* בר התקדמות — תמיד מתחת לקוביות */}
              {showProgress && (
                <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-border/20">
                  <div className="flex-1 h-[5px] bg-muted rounded-[3px] overflow-hidden">
                    <div
                      className="h-full rounded-[3px] transition-[width] duration-slow ease-out"
                      style={{
                        background: effectiveStats!.doneTasks === effectiveStats!.totalTasks ? C.statusDone : row.accent,
                        width: `${Math.round(effectiveStats!.doneTasks / effectiveStats!.totalTasks * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-[13px] text-subtle-foreground whitespace-nowrap">
                    {effectiveStats!.doneTasks}/{effectiveStats!.totalTasks} ({Math.round(effectiveStats!.doneTasks / effectiveStats!.totalTasks * 100)}%)
                  </span>
                </div>
              )}
            </div>
          )}


          {/* כרטיסים בשורה */}
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${row.cards.length}, 1fr)` }}>
            {row.cards.map(card => (
              // Kept as inline style (unchanged pattern): enabled/disabled +
              // per-row accent color are dynamic, and hover is driven
              // imperatively via onMouseEnter/onMouseLeave, not a static
              // Tailwind pseudo-class.
              <button
                key={card.id}
                onClick={() => card.enabled && onNavigate(card.tab)}
                style={{
                  background: card.enabled ? C.bgCard : C.bgNested,
                  border: `1px solid ${card.enabled ? C.borderEm : C.border}`,
                  borderRadius: '14px',
                  padding: '24px 20px 20px',
                  minHeight: '150px',
                  cursor: card.enabled ? 'pointer' : 'not-allowed',
                  opacity: card.enabled ? 1 : 0.4,
                  textAlign: 'right' as const,
                  transition: `transform 0.15s, box-shadow 0.15s, border-color 0.15s`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  boxShadow: card.enabled ? SHADOW.sm : 'none',
                  borderRight: `4px solid ${card.enabled ? row.accent : C.border}`,
                  position: 'relative' as const,
                }}
                onMouseEnter={e => {
                  if (!card.enabled) return;
                  const el = e.currentTarget as HTMLElement;
                  el.style.transform = 'translateY(-3px)';
                  el.style.boxShadow = `0 8px 24px rgba(0,0,0,0.28)`;
                  el.style.borderColor = row.accent;
                }}
                onMouseLeave={e => {
                  if (!card.enabled) return;
                  const el = e.currentTarget as HTMLElement;
                  el.style.transform = '';
                  el.style.boxShadow = SHADOW.sm;
                  el.style.borderColor = C.borderEm;
                }}
              >
                {/* badge — per-card dynamic color with alpha blend, kept inline */}
                {card.badge && (
                  <div style={{ position: 'absolute' as const, top: '14px', left: '14px' }}>
                    <span style={{
                      fontSize: '12px', padding: '3px 8px', borderRadius: '9999px',
                      background: (card.badgeColor ?? C.textMuted) + '25',
                      color: card.badgeColor ?? C.textMuted,
                      fontWeight: 700,
                      border: `1px solid ${(card.badgeColor ?? C.textMuted)}44`,
                    }}>
                      {card.badge}
                    </span>
                  </div>
                )}

                {/* אייקון */}
                <span className="text-[38px] leading-none block">{card.icon}</span>

                {/* כותרת */}
                <div className={`text-[17px] font-bold leading-tight ${card.enabled ? 'text-foreground' : 'text-subtle-foreground'}`}>
                  {card.title}
                </div>

                {/* תיאור */}
                <div className="text-sm text-subtle-foreground leading-relaxed mt-auto">
                  {card.subtitle}
                </div>
              </button>
            ))}
          </div>
        </div>
        );
      })}
    </div>
  );
};
