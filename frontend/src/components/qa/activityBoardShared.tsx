import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, RADIUS } from '../../theme';
import { formatDate } from '../../utils/dateFormat';
import { useDialog } from '../../context/DialogContext';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Shared between the QA module's editable activity board (QaActivityPlanView)
// and ניהול בדיקות's read-only "ציר זמן ופעילויות" (TimelineActivitiesView) —
// same rows (ActivityBoardEntry), so same categories, status logic and look.

export type ActivityCategory = 'meeting' | 'refresh' | 'deployment' | 'testing' | 'golive' | 'billing' | 'other';

export const CAT_LABELS: Record<ActivityCategory | 'all', string> = {
  all:        'הכל',
  meeting:    'פגישות',
  refresh:    'רענונים',
  deployment: 'העברות גרסה',
  testing:    'בדיקות',
  golive:     'עלייה לאוויר',
  billing:    'בילינג',
  other:      'אחר',
};

export const ACTIVITY_BLUE = '#4573D2';

const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export function fmtActivityDate(d: Date): string {
  return `${formatDate(d)} ${DOW[d.getDay()]}`;
}

export function activityRowHighlight(category?: string): React.CSSProperties {
  if (category === 'golive')  return { background: 'rgba(34,197,94,0.07)', borderRight: `3px solid ${C.success}` };
  if (category === 'billing') return { background: 'rgba(234,179,8,0.06)', borderRight: `3px solid ${C.warning}` };
  return {};
}

export type ActivityStatus = 'DONE' | 'DELAYED' | 'IN_PROGRESS' | 'UPCOMING' | 'UNSCHEDULED';

// Day-granularity status — mirrors release-intelligence.service.ts's
// getTimelineActivities: an activity ending today is not late yet.
export function activityStatus(a: { doneAt?: string | null; dateStart?: string | null; dateEnd?: string | null }, now = new Date()): ActivityStatus {
  if (a.doneAt) return 'DONE';
  const key = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const startK = a.dateStart ? key(new Date(a.dateStart)) : null;
  const endK = a.dateEnd ? key(new Date(a.dateEnd)) : startK;
  if (endK == null) return 'UNSCHEDULED';
  const today = key(now);
  if (endK < today) return 'DELAYED';
  if (startK != null && startK <= today) return 'IN_PROGRESS';
  return 'UPCOMING';
}

export const ACTIVITY_STATUS_META: Record<ActivityStatus, { label: string; color: string; bg: string }> = {
  DONE:        { label: '✓ בוצע',    color: C.success,   bg: C.successBg },
  DELAYED:     { label: 'באיחור',    color: C.danger,    bg: C.dangerBg },
  IN_PROGRESS: { label: 'בביצוע',    color: C.warning,   bg: C.warningBg },
  UPCOMING:    { label: 'עתידי',     color: ACTIVITY_BLUE, bg: 'rgba(69,115,210,0.10)' },
  UNSCHEDULED: { label: 'ללא תאריך', color: C.textMuted, bg: C.bgNested },
};

export const ActivityStatusBadge: React.FC<{ status: ActivityStatus; title?: string }> = ({ status, title }) => {
  const m = ACTIVITY_STATUS_META[status];
  return (
    <span title={title} style={{
      display: 'inline-block', padding: '1px 9px', borderRadius: RADIUS.full, whiteSpace: 'nowrap',
      background: m.bg, color: m.color, fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.bold,
    }}>
      {m.label}
    </span>
  );
};

// "✓ / ↺" toggle used in both screens' action column.
export const DoneToggleButton: React.FC<{ done: boolean; disabled?: boolean; busy?: boolean; onClick: () => void; disabledReason?: string }> = ({
  done, disabled, busy, onClick, disabledReason,
}) => (
  <button
    onClick={onClick}
    disabled={disabled || busy}
    title={disabled ? (disabledReason ?? '') : done ? 'בטל סימון בוצע' : 'סמן כבוצע'}
    style={{
      padding: '3px 8px', borderRadius: RADIUS.md, fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.bold,
      border: `1px solid ${done ? C.success : C.border}`,
      background: done ? C.successBg : C.bgNested,
      color: disabled ? C.textDisabled : done ? C.success : C.textMuted,
      cursor: disabled || busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
    }}
  >
    {busy ? '…' : done ? '↺' : '✓'}
  </button>
);

// ── Personal activity tasks (2026-10-05) ─────────────────────────────────────
// An activity whose ownerEmployee is the logged-in user shows on their own
// Home (manager HomeDashboard and employee EmployeeHomeView) as a task — from
// a week ahead until it's marked "בוצע" (or two weeks past its end, so a
// forgotten one doesn't linger forever). Never auto-completes on the calendar.
const MY_ACTIVITY_LEAD_DAYS = 7;
const MY_ACTIVITY_OVERDUE_DAYS = 14;
const dayOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86400000);

export function describeMyActivity(
  a: { label: string; dateStart: string | null; dateEnd: string | null; doneAt?: string | null },
  now: Date,
): { text: string; urgent: boolean; dueNow: boolean } | null {
  if (a.doneAt || !a.dateStart) return null;
  const startDay = dayOnly(new Date(a.dateStart));
  const endDay = dayOnly(new Date(a.dateEnd || a.dateStart));
  const today = dayOnly(now);
  const daysUntilStart = dayDiff(startDay, today);
  const daysSinceEnd = dayDiff(today, endDay);
  if (daysUntilStart > MY_ACTIVITY_LEAD_DAYS || daysSinceEnd > MY_ACTIVITY_OVERDUE_DAYS) return null;
  if (daysSinceEnd >= 1) return { text: `${a.label} — באיחור, הסתיים ב-${formatDate(a.dateEnd || a.dateStart)} ולא סומן כבוצע`, urgent: true, dueNow: true };
  if (daysUntilStart <= 0) {
    return { text: `${a.label} — ${daysSinceEnd === 0 ? 'היום' : `בביצוע עד ${formatDate(a.dateEnd!)}`}`, urgent: true, dueNow: true };
  }
  if (daysUntilStart === 1) return { text: `${a.label} — מחר`, urgent: true, dueNow: false };
  return { text: `${a.label} — ב-${formatDate(a.dateStart)} (בעוד ${daysUntilStart} ימים)`, urgent: false, dueNow: false };
}

export interface MyActivityEntry {
  id: string; activityKey: string; label: string; category: string; owner: string; ownerEmployee: string;
  dateStart: string | null; dateEnd: string | null; isRelevant?: boolean; doneAt?: string | null;
}

export function isMyActivity(a: { ownerEmployee: string }, fullName?: string): boolean {
  return !!fullName && !!a.ownerEmployee && a.ownerEmployee.trim().toLowerCase() === fullName.trim().toLowerCase();
}

// Self-contained fetch + "mark done" for a home page that doesn't already
// load the board (EmployeeHomeView). HomeDashboard has its own board fetch
// (shared with the release-manager reminders) and uses describeMyActivity directly.
export function useMyActivityTasks(token: string, versionId: string | undefined, fullName: string) {
  const dialog = useDialog();
  const [board, setBoard] = useState<MyActivityEntry[]>([]);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!versionId) { setBoard([]); return; }
    axios.get(`${API}/activity-board/${versionId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setBoard((res.data ?? []).filter((a: any) => a.isRelevant !== false)))
      .catch(() => setBoard([]));
  }, [versionId, token, nonce]);

  const tasks = useMemo(() => {
    const now = new Date();
    return board
      .filter(a => isMyActivity(a, fullName))
      .map(a => ({ a, task: describeMyActivity(a, now) }))
      .filter((x): x is { a: MyActivityEntry; task: NonNullable<ReturnType<typeof describeMyActivity>> } => x.task !== null);
  }, [board, fullName]);

  const markDone = useCallback(async (a: { id: string; label: string }) => {
    if (!await dialog.confirm(`לסמן את "${a.label}" כבוצע?`, 'סימון פעילות כבוצעה', 'success')) return;
    try {
      await axios.patch(`${API}/activity-board/entry/${a.id}/done`, { done: true }, { headers: { Authorization: `Bearer ${token}` } });
      setNonce(n => n + 1);
    } catch (err: any) {
      dialog.alert(err?.response?.data?.message || 'שגיאה בסימון הפעילות', 'שגיאה', 'danger');
    }
  }, [dialog, token]);

  return { tasks, markDone };
}
