import React, { useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE, versionStatusLabel, versionStatusColor } from '../theme';
import { VersionStatusChip } from './ui';

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

const fmt = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;

export const VersionHub: React.FC<Props> = ({ version, onNavigate, userRole, token, onVersionUpdated }) => {
  if (!version) return null;

  const s = version.status;
  const isManager = ['RELEASE_MANAGER', 'ADMIN'].includes(userRole);
  const isClosed  = ['COMPLETED', 'ROLLED_BACK'].includes(s);
  const isAdmin   = userRole === 'ADMIN';
  const isLocked  = isClosed && !isAdmin;
  const canEdit   = !isLocked;
  const now       = new Date();
  const plannedStartPassed = version.plannedStart ? new Date(version.plannedStart) <= now : false;
  const rehearsalTimePassed = version.lastRehearsalAt ? true : s === 'REHEARSAL';   // ADMIN תמיד יכול לערוך, שאר — רק גרסה לא סגורה

  const headers = { Authorization: `Bearer ${token}` };

  // ── נתוני-מאקרו ──
  const [stats, setStats] = useState<{
    totalTasks: number; doneTasks: number; blockedTasks: number; inProgressTasks: number;
    submittedTeams: number; totalTeams: number;
    approvedCRs: number; totalCRs: number;
    alerts: { type: 'error' | 'warn'; text: string }[];
  } | null>(null);
  const [approvedPlans, setApprovedPlans] = useState<any[]>([]);
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
        const [verRes, subsRes] = await Promise.all([
          axios.get(`${API}/versions/${version.id}`, { headers }),
          axios.get(`${API}/versions/${version.id}/submissions`, { headers }).catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        const v = verRes.data;
        const allTasks: any[] = (v.phases ?? []).flatMap((p: any) =>
          (p.subPhases ?? []).flatMap((sp: any) => sp.tasks ?? []));
        const subs: any[] = subsRes.data ?? [];
        // צוותים מעורבים = רק צוותים שיש להם משימה בגרסה בפועל
        const involvedTeamIds = new Set<string>(
          allTasks.map((t: any) => t.assignedTeamId).filter(Boolean)
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
            const approved = crs.filter((c: any) => c.planApproved || c.notNeededForPlan);
            setApprovedPlans(approved);
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
          submittedTeams, totalTeams, approvedCRs, totalCRs, alerts,
        });
      } catch {}
    };
    load();
    return () => { cancelled = true; };
  }, [version.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── "הצעד הבא" לפי סטטוס ──
  const CTA_MAP: Record<string, { icon: string; text: string; color: string; bg: string; tab?: string }> = {
    DRAFT:         { icon: '📝', text: 'פתח לאיסוף משימות מהצוותים', color: C.brand,          bg: C.brandDim,   tab: 'version-detail' },
    COLLECTING:    { icon: '📥', text: stats ? `${stats.submittedTeams}/${stats.totalTeams} צוותים הגישו — עקוב אחר ההגשות` : 'ממתין להגשות צוותים', color: C.warning, bg: C.warningBg, tab: 'proposals' },
    CR_REVIEW:     { icon: '🔍', text: stats ? `${stats.approvedCRs}/${stats.totalCRs} CR-ים אושרו — השלם סקירה` : 'בסקירת תוכניות CR', color: C.warning,  bg: C.warningBg,  tab: 'cr-review' },
    REFINING:      { icon: '✏️', text: 'בשלב טיוב התוכנית — עבור לישיבת מעבר', color: C.brand, bg: C.brandDim, tab: 'version-detail' },
    REVIEW:        { icon: '✅', text: 'ניתן לאשר את התוכנית', color: C.statusDone, bg: C.bgDone, tab: 'version-detail' },
    APPROVED:      { icon: '🎭', text: 'התוכנית מאושרת — ניתן להתחיל חזרה גנרלית', color: '#f0883e', bg: 'rgba(240,136,62,0.12)', tab: 'version-detail' },
    REHEARSAL:     { icon: '🎭', text: 'חזרה גנרלית פעילה — עבור ל-War Room', color: '#f0883e', bg: 'rgba(240,136,62,0.12)', tab: 'board' },
    ACTIVE:        { icon: '🚀', text: stats && stats.totalTasks > 0 ? `הרצה פעילה — ${Math.round(stats.doneTasks / stats.totalTasks * 100)}% הושלמו` : 'הרצה פעילה', color: C.statusFailed, bg: C.dangerBg, tab: 'board' },
    MORNING_AFTER: { icon: '🌅', text: stats ? `${stats.totalTasks - stats.doneTasks} משימות בוקר נותרו` : 'משימות בוקר שלאחר הגרסה', color: C.statusInProgress, bg: C.bgInProgress, tab: 'board' },
    COMPLETED:     { icon: '🏆', text: 'הגרסה הושלמה בהצלחה', color: C.statusDone, bg: C.bgDone },
    ROLLED_BACK:   { icon: '🔄', text: 'הגרסה עברה Rollback', color: C.statusRollback, bg: C.bgNested },
  };
  const cta = CTA_MAP[s];

  // שמירה אוטומטית בשינוי שדה
  const saveField = useCallback(async (field: string, value: string) => {
    try {
      await axios.patch(`${API}/versions/${version.id}`, { [field]: value || null }, { headers });
      onVersionUpdated?.();
    } catch { /* שגיאות נשמטות בשקט */ }
  }, [version.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const isExecution   = ['REHEARSAL', 'ACTIVE', 'MORNING_AFTER'].includes(s);
  const isPlanning    = ['DRAFT', 'COLLECTING', 'CR_REVIEW', 'REFINING', 'REVIEW', 'APPROVED'].includes(s);
  const hasRehearsal  = !!version.lastRehearsalAt;
  const hasNight      = !!version.actualStart || ['ACTIVE', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(s);
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
          id: 'details',
          icon: '📋',
          title: 'פרטי גרסה',
          subtitle: 'תאריכים, צוותים, סטטוס',
          tab: 'version-detail',
          enabled: true,
        },
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
        {
          id: 'implementation-plans',
          icon: '📁',
          title: 'תוכניות הטמעה',
          subtitle: ['TEAM_LEAD'].includes(userRole)
            ? 'מלא והגש את תוכניות ה-CR שלך'
            : 'הגשה, סקירה ואישור תוכניות הטמעה',
          tab: 'implementation-plans',
          enabled: ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN', 'CR_MANAGER'].includes(userRole) &&
                   (userRole !== 'TEAM_LEAD' || myTeamRequiresPlan) &&
                   ['COLLECTING', 'CR_REVIEW', 'REFINING', 'REVIEW', 'APPROVED', 'REHEARSAL', 'ACTIVE', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(s),
          badge: !['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN', 'CR_MANAGER'].includes(userRole) ? 'ראש צוות ומנהל בלבד' : undefined,
          badgeColor: C.textMuted,
        },
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
          subtitle: hasRehearsal
            ? `הורצה: ${fmt(version.lastRehearsalAt)}`
            : s === 'REHEARSAL' ? 'פעיל כעת' : 'טרם הורצה',
          tab: 'board',
          enabled: hasRehearsal || s === 'REHEARSAL',
        },
        {
          id: 'rehearsal-dashboard',
          icon: '🎛',
          title: 'לוח בקרה — חזרה',
          subtitle: s === 'REHEARSAL'
            ? 'מעקב חזרה בזמן-אמת'
            : hasRehearsal
            ? `הורצה: ${fmt(version.lastRehearsalAt)}`
            : 'יפתח בעת החזרה הגנרלית',
          tab: 'overview',
          enabled: rehearsalTimePassed,
          badge: !rehearsalTimePassed ? '⏳ טרם הגיע הזמן' : undefined,
          badgeColor: C.textMuted,
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
          enabled: hasNight || isExecution,
        },
        {
          id: 'dashboard',
          icon: '🎛',
          title: 'לוח בקרה',
          subtitle: isExecution ? 'מעקב זמן-אמת פעיל' : 'פעיל בזמן הרצה בלבד',
          tab: 'dashboard',
          enabled: isExecution,
          badge: !isExecution ? 'בזמן הרצה' : undefined,
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
          enabled: hasNight || isExecution,
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
    <div style={{ direction: 'rtl', fontFamily: FONT }}>

      {/* בנר נעילה לגרסאות סגורות */}
      {isLocked && (
        <div style={{ background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '10px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: C.textMuted }}>
          🔒 <strong style={{ color: C.textSecondary }}>גרסה סגורה — תצוגה בלבד.</strong> רק מנהל מערכת (ADMIN) יכול לערוך.
        </div>
      )}

      {/* ── פאנל שלבי בנייה — DRAFT בלבד ── */}
      {s === 'DRAFT' && isManager && (
        <div style={{ background: C.bgCard, border: `2px solid ${C.brand}44`, borderRadius: '12px', padding: '18px 20px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <span style={{ fontSize: '18px' }}>🏗️</span>
            <span style={{ fontSize: '15px', fontWeight: 700, color: C.textPrimary }}>איך לבנות את התוכנית?</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px' }}>
            {[
              { icon: '📤', title: 'ייבוא מ-Excel', sub: 'טען קובץ XLS עם משימות', color: C.statusDone },
              { icon: '🏷️', title: 'שימוש בתבנית', sub: 'טעינה מתבנית שמורה',   color: C.statusOpen },
              { icon: '🔧', title: 'אשף הכנת תוכנית', sub: 'מסגרת זמן, עובדים, תלויות', color: C.warning },
              { icon: '✏️', title: 'בנייה ידנית',  sub: 'הוסף שלבים ומשימות', color: C.textSecondary },
            ].map(step => (
              <button
                key={step.title}
                onClick={() => onNavigate('version-detail')}
                style={{
                  background: C.bgNested, border: `1px solid ${step.color}44`,
                  borderRadius: '10px', padding: '14px 12px',
                  cursor: 'pointer', textAlign: 'right' as const, direction: 'rtl',
                  display: 'flex', flexDirection: 'column', gap: '6px',
                  transition: 'transform 0.12s, box-shadow 0.12s',
                  boxShadow: SHADOW.sm,
                  borderRight: `4px solid ${step.color}`,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.12)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = SHADOW.sm; }}
              >
                <span style={{ fontSize: '22px' }}>{step.icon}</span>
                <span style={{ fontSize: '13px', fontWeight: 700, color: C.textPrimary }}>{step.title}</span>
                <span style={{ fontSize: '11px', color: C.textMuted, lineHeight: 1.4 }}>{step.sub}</span>
              </button>
            ))}
          </div>
          <div style={{ marginTop: '12px', fontSize: '12px', color: C.textMuted, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>💡</span>
            <span>לחץ על אחד הכפתורים — תגיע ל"פרטי גרסה" שם נמצאים כל הכלים לבנייה.</span>
          </div>
        </div>
      )}

      {/* ── CTA — הצעד הבא ── */}
      {cta && (
        <div
          onClick={() => ctaTab && onNavigate(ctaTab)}
          style={{
            background: cta.bg, border: `1px solid ${cta.color}44`,
            borderRadius: '10px', padding: '12px 18px', marginBottom: '14px',
            display: 'flex', alignItems: 'center', gap: '10px',
            cursor: ctaTab ? 'pointer' : 'default',
            transition: EASE.fast,
          }}
          onMouseEnter={e => { if (ctaTab) (e.currentTarget as HTMLElement).style.borderColor = cta.color + '88'; }}
          onMouseLeave={e => { if (ctaTab) (e.currentTarget as HTMLElement).style.borderColor = cta.color + '44'; }}
        >
          <span style={{ fontSize: '20px' }}>{cta.icon}</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: cta.color, flex: 1 }}>{cta.text}</span>
          {ctaTab && <span style={{ fontSize: '12px', color: cta.color, opacity: 0.7 }}>← לחץ למעבר</span>}
        </div>
      )}

      {/* ── התראות ── */}
      {stats && stats.alerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
          {stats.alerts.map((a, i) => (
            <div key={i} style={{
              background: a.type === 'error' ? C.dangerBg : C.warningBg,
              border: `1px solid ${a.type === 'error' ? C.statusFailed : C.warning}44`,
              borderRadius: '8px', padding: '8px 14px',
              display: 'flex', alignItems: 'center', gap: '8px',
              fontSize: '13px', color: a.type === 'error' ? C.statusFailed : C.warning,
              fontWeight: 600,
            }}>
              {a.type === 'error' ? '🚨' : '⚠️'} {a.text}
            </div>
          ))}
        </div>
      )}

      {/* ── Stats bar ── */}
      {stats && stats.totalTasks > 0 && (
        <div style={{
          background: C.bgCard, border: `1px solid ${C.border}`,
          borderRadius: '10px', padding: '12px 18px', marginBottom: '14px',
          display: 'flex', gap: '0', flexWrap: 'wrap',
        }}>
          {[
            { label: 'משימות',   value: stats.totalTasks,       color: C.textPrimary },
            { label: 'הושלמו',  value: stats.doneTasks,        color: C.statusDone },
            { label: 'בביצוע',  value: stats.inProgressTasks,  color: C.statusInProgress },
            { label: 'חסומות',  value: stats.blockedTasks,     color: stats.blockedTasks > 0 ? C.statusFailed : C.textDisabled },
            ...(stats.totalTeams > 0 ? [{ label: 'צוותים', value: stats.totalTeams, color: C.textSecondary }] : []),
            ...(stats.totalCRs  > 0 ? [{ label: 'CR-ים',  value: stats.totalCRs,   color: C.textSecondary }] : []),
          ].map((stat, i, arr) => (
            <div key={stat.label} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '0 20px', borderLeft: i < arr.length - 1 ? `1px solid ${C.border}` : 'none',
              minWidth: '70px',
            }}>
              <span style={{ fontSize: '22px', fontWeight: 700, color: stat.color, lineHeight: 1.2 }}>{stat.value}</span>
              <span style={{ fontSize: '11px', color: C.textMuted, marginTop: '2px' }}>{stat.label}</span>
            </div>
          ))}
          {stats.totalTasks > 0 && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', paddingRight: '20px' }}>
              <div style={{ flex: 1, height: '6px', background: C.bgHover, borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: '3px',
                  background: stats.doneTasks === stats.totalTasks ? C.statusDone : C.brand,
                  width: `${Math.round(stats.doneTasks / stats.totalTasks * 100)}%`,
                  transition: 'width 0.5s ease',
                }} />
              </div>
              <span style={{ fontSize: '11px', color: C.textMuted, marginRight: '8px', whiteSpace: 'nowrap' }}>
                {Math.round(stats.doneTasks / stats.totalTasks * 100)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* כרטיס פרטי גרסה — עם עריכה אינליין */}
      <div style={{
        background: C.bgCard, borderRadius: '14px', padding: '20px 24px', marginBottom: '20px',
        border: `1px solid ${isClosed ? C.borderEm : C.border}`, boxShadow: SHADOW.sm,
        borderRight: `4px solid ${C.brand}`,
      }}>
        {/* שורת כותרת */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: C.textPrimary }}>{version.name}</h2>
            <VersionStatusChip status={version.status} size="sm" />
            {version.creator?.fullName && (
              <span style={{ fontSize: '12px', color: C.textMuted }}>👤 {version.creator.fullName}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {isAdmin && (
              <button
                onClick={async () => {
                  if (!window.confirm(`למחוק את הגרסה "${version.name}" לצמיתות?\nפעולה זו אינה הפיכה.`)) return;
                  try {
                    await axios.delete(`${API}/versions/${version.id}`, { headers });
                    onVersionUpdated?.();
                  } catch (err: any) {
                    alert(err?.response?.data?.message || 'שגיאה במחיקת הגרסה');
                  }
                }}
                style={{
                  padding: '6px 12px',
                  background: C.dangerBg ?? '#fff0f0',
                  color: C.statusFailed,
                  border: `1px solid ${C.statusFailed}44`,
                  borderRadius: RADIUS.md, cursor: 'pointer',
                  fontSize: '12px', fontWeight: 600, fontFamily: FONT,
                }}
                title="מחק גרסה (Admin בלבד)"
              >
                🗑 מחק
              </button>
            )}
            <button
              onClick={() => onNavigate('version-detail')}
              style={{
                padding: '6px 14px',
                background: C.bgNested,
                color: C.textSecondary,
                border: `1px solid ${C.border}`,
                borderRadius: RADIUS.md, cursor: 'pointer',
                fontSize: '12px', fontWeight: 600, fontFamily: FONT,
              }}>
              🔍 כל הפרטים
            </button>
          </div>
        </div>

        {/* שדות תאריכים — עריכה אינליין */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
          {[
            { icon: '📅', label: 'התחלה מתוכננת', field: 'plannedStart',        value: version.plannedStart },
            { icon: '🏁', label: 'סיום מתוכנן',   field: 'plannedEnd',          value: version.plannedEnd },
            { icon: '🗓', label: 'ישיבת מעבר',     field: 'reviewMeetingTime',  value: version.reviewMeetingTime },
          ].map(({ icon, label, field, value }) => (
            <div key={field} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: C.textMuted, fontWeight: 600 }}>
                {icon} {label}
              </span>
              {canEdit ? (
                <input
                  type="datetime-local"
                  defaultValue={value ? value.slice(0, 16) : ''}
                  onBlur={e => { if (e.target.value !== (value ? value.slice(0, 16) : '')) saveField(field, e.target.value); }}
                  style={{
                    background: C.bgNested, color: C.textPrimary,
                    border: `1px solid ${C.border}`, borderRadius: RADIUS.sm,
                    padding: '6px 8px', fontSize: '13px', fontFamily: FONT,
                    outline: 'none', cursor: 'pointer', width: '100%', boxSizing: 'border-box' as const,
                  }}
                  onFocus={e => (e.target as HTMLElement).style.borderColor = C.brand}
                  onBlurCapture={e => (e.target as HTMLElement).style.borderColor = C.border}
                />
              ) : (
                <span style={{ fontSize: '13px', color: value ? C.textPrimary : C.textDisabled, padding: '6px 0' }}>
                  {value ? fmt(value) : '—'}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* נתוני הרצה בפועל (קריאה בלבד) */}
        {(version.actualStart || version.lastRehearsalAt || version.lastNightAt) && (
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '14px', paddingTop: '12px', borderTop: `1px solid ${C.border}`, fontSize: '12px' }}>
            {version.actualStart && (
              <span style={{ color: C.statusInProgress }}>🚀 הרצה התחילה: {fmt(version.actualStart)}</span>
            )}
            {version.lastRehearsalAt && (
              <span style={{ color: '#f0883e' }}>🎭 חזרה הסתיימה: {fmt(version.lastRehearsalAt)}</span>
            )}
            {version.lastNightAt && (
              <span style={{ color: C.statusDone }}>✅ לילה הסתיים: {fmt(version.lastNightAt)}</span>
            )}
          </div>
        )}
      </div>

      {/* שלוש שורות */}
      {visibleRows.map(row => (
        <div key={row.title} style={{ marginBottom: '16px' }}>
          {/* כותרת שורה */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <div style={{ height: '3px', width: '24px', background: row.accent, borderRadius: '2px' }} />
            <span style={{ fontSize: '11px', fontWeight: 700, color: C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>
              {row.title}
            </span>
          </div>

          {/* כרטיסים בשורה */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${row.cards.length}, 1fr)`, gap: '12px' }}>
            {row.cards.map(card => (
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
                  direction: 'rtl',
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
                {/* badge */}
                {card.badge && (
                  <div style={{ position: 'absolute' as const, top: '14px', left: '14px' }}>
                    <span style={{
                      fontSize: '10px', padding: '3px 8px', borderRadius: RADIUS.full,
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
                <span style={{ fontSize: '38px', lineHeight: 1, display: 'block' }}>{card.icon}</span>

                {/* כותרת */}
                <div style={{ fontSize: '16px', fontWeight: 700, color: card.enabled ? C.textPrimary : C.textMuted, lineHeight: 1.2 }}>
                  {card.title}
                </div>

                {/* תיאור */}
                <div style={{ fontSize: '12px', color: C.textMuted, lineHeight: 1.5, marginTop: 'auto' }}>
                  {card.subtitle}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* ── תוכניות מאושרות ── */}
      {approvedPlans.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <div style={{ height: '3px', width: '24px', background: C.statusDone, borderRadius: '2px' }} />
            <span style={{ fontSize: '11px', fontWeight: 700, color: C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>
              תוכניות שאושרו ({approvedPlans.length})
            </span>
          </div>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
            {/* Header row */}
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 100px 80px', gap: '0', background: C.bgNested, borderBottom: `1px solid ${C.border}`, padding: '7px 14px', fontSize: '11px', fontWeight: 700, color: C.textMuted }}>
              <span>CR</span>
              <span>תיאור</span>
              <span>צוות</span>
              <span style={{ textAlign: 'center' as const }}>סטטוס</span>
            </div>
            {approvedPlans.map((plan: any, i: number) => (
              <div key={plan.id ?? i} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 100px 80px', gap: '0', padding: '8px 14px', borderBottom: i < approvedPlans.length - 1 ? `1px solid ${C.border}` : 'none', alignItems: 'center', fontSize: '13px' }}>
                <span style={{ color: C.info, fontWeight: 600, fontFamily: 'monospace' }}>{plan.crNumber || '—'}</span>
                <span style={{ color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {plan.description || plan.title || plan.crTitle || '—'}
                </span>
                <span style={{ color: C.textMuted, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {plan.team?.name || plan.teamName || '—'}
                </span>
                <span style={{ textAlign: 'center' as const }}>
                  {plan.notNeededForPlan ? (
                    <span style={{ fontSize: '11px', background: C.bgNested, color: C.textMuted, padding: '2px 8px', borderRadius: '10px', border: `1px solid ${C.border}` }}>לא נדרש</span>
                  ) : (
                    <span style={{ fontSize: '11px', background: C.successBg ?? '#f0faf4', color: C.statusDone, padding: '2px 8px', borderRadius: '10px', border: `1px solid ${C.statusDone}44` }}>✓ אושר</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
