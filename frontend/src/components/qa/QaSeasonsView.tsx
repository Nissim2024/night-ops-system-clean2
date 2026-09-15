import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C, SHADOW, EASE } from '../../theme';
import { cn } from '../../lib/utils';
import { useDialog } from '../../context/DialogContext';
import { formatDate } from '../../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface SeasonDate {
  id: string;
  date: string;
  label: string;
  type: 'holiday' | 'chol_hamoed';
  orderIndex: number;
}

interface Season {
  id: string;
  name: string;
  dateRange: string;
  isActive: boolean;
  forcesOff: boolean; // true = real holiday (mandatory non-working day, blocks scheduling); false = optional leave-request window (e.g. summer vacation) — independent of isActive ("open for requests")
  sortOrder: number;
  dates: SeasonDate[];
}

interface LeaveRequest {
  id: string;
  date: string;
  kind: 'leave' | 'work';
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  user: { id: string; fullName: string; email: string };
  season?: { id: string; name: string };
}

interface UserSummary {
  userId: string;
  fullName: string;
  email: string;
  workDates: string[];
  leaveDates: string[];
  hasPending: boolean;
}

interface Props {
  token: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtShort = (d: string) => formatDate(d);

const daysUntil = (dateStr: string): number => {
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

// Lock date = 3 days before first season date
const getLockDays = (dates: SeasonDate[]): number | null => {
  if (!dates.length) return null;
  const sorted = [...dates].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return daysUntil(sorted[0].date) - 3;
};

// ── Component ─────────────────────────────────────────────────────────────────

export const QaSeasonsView: React.FC<Props> = ({ token }) => {
  const dialog  = useDialog();
  const headers = { Authorization: `Bearer ${token}` };

  const [seasons, setSeasons]       = useState<Season[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [requests, setRequests]     = useState<LeaveRequest[]>([]);
  const [loading, setLoading]       = useState(true);
  const [reqLoading, setReqLoading] = useState(false);

  const loadSeasons = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API}/leaves/seasons`, { headers: { Authorization: `Bearer ${token}` } });
      const data: Season[] = res.data;
      setSeasons(data);
      if (data.length > 0) {
        const active = data.find(s => s.isActive) ?? data[0];
        setSelectedId(active.id);
      }
    } catch { /* ignore fetch errors */ } finally { setLoading(false); }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadSeasons().catch(() => {}); }, [loadSeasons]);

  useEffect(() => {
    if (!selectedId || !token) return;
    setReqLoading(true);
    axios.get(`${API}/leaves/requests`, { headers: { Authorization: `Bearer ${token}` }, params: { seasonId: selectedId } })
      .then(r => setRequests(r.data))
      .catch(() => setRequests([]))
      .finally(() => setReqLoading(false));
  }, [selectedId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const season = seasons.find(s => s.id === selectedId) ?? null;

  // ── Group requests by user ──────────────────────────────────────────────────
  const userMap = new Map<string, UserSummary>();
  for (const req of requests) {
    if (!req.user) continue;
    if (!userMap.has(req.user.id)) {
      userMap.set(req.user.id, {
        userId: req.user.id,
        fullName: req.user.fullName,
        email: req.user.email,
        workDates: [],
        leaveDates: [],
        hasPending: false,
      });
    }
    const u = userMap.get(req.user.id)!;
    if (req.kind === 'work') u.workDates.push(req.date);
    else u.leaveDates.push(req.date);
    if (req.status === 'PENDING') u.hasPending = true;
  }
  const userList = Array.from(userMap.values()).sort((a, b) =>
    a.fullName.localeCompare(b.fullName, 'he')
  );

  // ── Timeline state ──────────────────────────────────────────────────────────
  const lockDays     = season ? getLockDays(season.dates) : null;
  const isLocked     = lockDays !== null && lockDays <= 0;
  const firstDateObj = season?.dates?.length ? new Date(season.dates[0].date) : null;
  const daysToHoliday = firstDateObj ? daysUntil(season!.dates[0].date) : null;

  const pendingCount = userList.filter(u => u.hasPending).length;

  const [importing, setImporting] = useState(false);
  const [importYear, setImportYear] = useState(new Date().getFullYear());
  const [importResult, setImportResult] = useState<{ created: number; skipped: number } | null>(null);
  const [togglingActive, setTogglingActive] = useState(false);
  const [togglingForcesOff, setTogglingForcesOff] = useState(false);

  const toggleSeasonActive = async () => {
    if (!season) return;
    setTogglingActive(true);
    try {
      await axios.patch(`${API}/leaves/seasons/${season.id}`, { isActive: !season.isActive }, { headers });
      await loadSeasons();
    } catch {
      dialog.alert('שגיאה בעדכון סטטוס העונה', 'שגיאה', 'danger');
    } finally {
      setTogglingActive(false);
    }
  };

  // forcesOff is independent of isActive — it decides whether this season's
  // dates block scheduling everywhere (work plans, activity plans, cycle
  // length) regardless of whether its leave-request window is open or
  // closed. Added 2026-08-03 after a real holiday (Rosh Hashana) silently
  // stopped blocking scheduling once its season's request window closed,
  // while an unrelated open "summer vacation" window wrongly blocked
  // everyone's schedule just because it happened to be open for requests.
  const toggleSeasonForcesOff = async () => {
    if (!season) return;
    setTogglingForcesOff(true);
    try {
      await axios.patch(`${API}/leaves/seasons/${season.id}`, { forcesOff: !season.forcesOff }, { headers });
      await loadSeasons();
    } catch {
      dialog.alert('שגיאה בעדכון האם העונה חוסמת שיבוץ', 'שגיאה', 'danger');
    } finally {
      setTogglingForcesOff(false);
    }
  };

  const handleImport = async () => {
    if (!token) return;
    setImporting(true);
    setImportResult(null);
    try {
      const authHeader = { Authorization: `Bearer ${token}` };
      const res = await axios.post(
        `${API}/leaves/seasons/import-holidays?year=${importYear}`,
        {},
        { headers: authHeader },
      );
      setImportResult(res.data);
      await loadSeasons();
    } catch {
      dialog.alert('שגיאה בייבוא חגים', 'שגיאה', 'danger');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex items-start gap-5 text-foreground [direction:rtl]">

      {/* ── Season list ── */}
      <div className="flex w-[280px] shrink-0 flex-col gap-3">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-xl font-bold">מועדי חופשות</div>
          <button className="cursor-pointer rounded-md border-none bg-primary px-3.5 py-1.5 text-sm font-semibold text-white">
            + חדשה
          </button>
        </div>

        {/* ── Auto-import row ── */}
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <select
            value={importYear}
            onChange={e => { setImportYear(Number(e.target.value)); setImportResult(null); }}
            className="cursor-pointer rounded-md border border-border bg-muted px-1.5 py-[3px] text-sm text-foreground"
          >
            {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={handleImport}
            disabled={importing}
            className={cn(
              'flex-1 rounded-md border-none px-2.5 py-1 text-sm font-semibold text-white',
              importing ? 'cursor-not-allowed bg-neutral-400' : 'cursor-pointer bg-info'
            )}
          >
            {importing ? 'מייבא...' : '📅 ייבוא חגים אוטומטי'}
          </button>
        </div>
        {importResult && (
          <div className="rounded-md bg-success-bg px-2.5 py-1 text-center text-xs text-success">
            נוספו {importResult.created} | דולגו {importResult.skipped}
          </div>
        )}

        {loading ? (
          <div className="p-5 text-center text-sm text-subtle-foreground">טוען...</div>
        ) : (() => {
          const now = new Date();

          const getSeasonStatus = (s: Season): 'ongoing' | 'open' | 'future' | 'past' => {
            const first = s.dates?.[0]?.date ? new Date(s.dates[0].date) : null;
            const last  = s.dates?.length    ? new Date(s.dates[s.dates.length - 1].date) : null;
            if (last && last < now)                   return 'past';
            if (first && first <= now && last && last >= now) return 'ongoing';
            if (s.isActive)                           return 'open';   // registration open, holiday future
            return 'future';
          };

          const isPastSeason = (s: Season) => getSeasonStatus(s) === 'past';

          // Sort closest first by first date (ascending), past sorted newest-first
          const byClosest = (a: Season, b: Season) => {
            const da = a.dates?.[0]?.date ? new Date(a.dates[0].date).getTime() : 0;
            const db = b.dates?.[0]?.date ? new Date(b.dates[0].date).getTime() : 0;
            return da - db;
          };
          const byNewest = (a: Season, b: Season) => {
            const da = a.dates?.[0]?.date ? new Date(a.dates[0].date).getTime() : 0;
            const db = b.dates?.[0]?.date ? new Date(b.dates[0].date).getTime() : 0;
            return db - da;
          };

          const upcoming = seasons.filter(s => !isPastSeason(s)).sort(byClosest);
          const past     = seasons.filter(s => isPastSeason(s)).sort(byNewest);

          const renderCard = (s: Season) => {
            const isSel   = selectedId === s.id;
            const status  = getSeasonStatus(s);
            const isP     = status === 'past';

            const STATUS_META = {
              ongoing: { label: 'בתקופת החג',     color: C.success,     bg: C.successBg                  },
              open:    { label: 'פתוחה לרישום',   color: C.info,        bg: C.infoBg                     },
              future:  { label: 'עתידית',          color: C.warning,     bg: C.warningBg                  },
              past:    { label: 'הסתיימה',         color: C.textDisabled, bg: 'rgba(158,158,158,0.08)'    },
            };
            const { label: statusLabel, color: statusColor, bg: statusBg } = STATUS_META[status];

            return (
              <div
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className="cursor-pointer rounded-2xl p-4 transition-[background,box-shadow] duration-fast ease-out"
                style={{
                  background: isSel ? C.bgActive : C.bgCard,
                  border: `1px solid ${isSel ? C.borderFocus : C.border}`,
                  boxShadow: isSel ? SHADOW.sm : 'none',
                  opacity: isP ? 0.7 : 1,
                }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = C.bgHover; }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = isP ? C.bgCard : C.bgCard; }}
              >
                <div className="mb-1 text-base font-semibold">{s.name}</div>
                <div className="mb-2 text-xs text-subtle-foreground">{s.dateRange}</div>
                <div className="flex items-center justify-between">
                  <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: statusColor, background: statusBg }}>
                    {statusLabel}
                  </span>
                  {isSel && requests.length > 0 && (
                    <span className="text-xs text-subtle-foreground">{requests.length} בקשות</span>
                  )}
                </div>
              </div>
            );
          };

          return (
            <>
              {upcoming.map(renderCard)}

              {past.length > 0 && (
                <>
                  <div className="mb-1 mt-2 flex items-center gap-2">
                    <div className="h-px flex-1 bg-border" />
                    <span className="whitespace-nowrap text-xs text-subtle-foreground">חגים שהסתיימו</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  {past.map(renderCard)}
                </>
              )}
            </>
          );
        })()}
      </div>

      {/* ── Detail panel ── */}
      {season && (
        <div className="min-w-0 flex-1">

          {/* Header card */}
          <div className="mb-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="mb-1 text-2xl font-bold">{season.name}</div>
                <div className="text-sm text-subtle-foreground">{season.dateRange}</div>
              </div>

              <div className="flex items-center gap-3">
                {/* Manual activate / reopen — lets a manager open registration regardless of the auto lock/date window */}
                <button
                  onClick={toggleSeasonActive}
                  disabled={togglingActive}
                  className={cn(
                    'whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold',
                    togglingActive ? 'cursor-not-allowed' : 'cursor-pointer'
                  )}
                  style={{
                    background: season.isActive ? C.bgNested : C.brand,
                    color: season.isActive ? C.textSecondary : C.textInverse,
                    border: `1px solid ${season.isActive ? C.border : C.brand}`,
                  }}
                >
                  {togglingActive ? '...' : season.isActive ? 'סגור לבקשות' : (isLocked ? '🔓 פתח מחדש לבקשות' : 'הפעל לבקשות')}
                </button>

                {/* forcesOff — independent of the request-window toggle above: does this
                    season's dates actually block scheduling (real חג) or not (e.g. חופשת קיץ)? */}
                <button
                  onClick={toggleSeasonForcesOff}
                  disabled={togglingForcesOff}
                  title="חג = ברירת מחדל לא עובדים (אפשר לבקש חריגה לעבוד). חלון-בקשות = ברירת מחדל עובדים (אפשר לבקש חופש) — לא קשור לפתיחה/סגירה של הבקשות למעלה"
                  className={cn(
                    'whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold',
                    togglingForcesOff ? 'cursor-not-allowed' : 'cursor-pointer'
                  )}
                  style={{
                    background: season.forcesOff ? C.dangerBg : C.bgNested,
                    color: season.forcesOff ? C.danger : C.textSecondary,
                    border: `1px solid ${season.forcesOff ? C.danger + '55' : C.border}`,
                  }}
                >
                  {togglingForcesOff ? '...' : season.forcesOff ? '🚫 חג — חוסם שיבוץ' : '📅 חלון-בקשות בלבד'}
                </button>

                {/* Days counter or lock badge */}
                {isLocked ? (
                  <div className="rounded-xl border border-danger/20 bg-danger-bg px-[18px] py-2.5 text-center">
                    <div className="mb-0.5 text-[22px]">🔒</div>
                    <div className="text-xs font-semibold text-danger">נעול לבקשות</div>
                  </div>
                ) : daysToHoliday !== null && daysToHoliday > 0 ? (
                  <div className="rounded-xl border border-info/20 bg-info-bg px-4 py-2 text-center">
                    <div className="text-2xl font-bold text-info">{daysToHoliday}</div>
                    <div className="text-xs text-subtle-foreground">ימים לפתיחה</div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Timeline */}
            {daysToHoliday !== null && (
              <div className="mb-4 flex items-center gap-0">
                {[
                  { label: 'פתיחת חופשה לדיווח', desc: '30 יום לפני', done: daysToHoliday <= 30 },
                  { label: 'תזכורות יומיות',      desc: '29–4 ימים',   done: daysToHoliday <= 4  },
                  { label: 'לא ניתן לבקש חופשה', desc: '3 ימים לפני', done: daysToHoliday <= 3  },
                  { label: 'נעילה',               desc: 'מועד החגים',  done: daysToHoliday <= 0  },
                ].map((step, i, arr) => (
                  <React.Fragment key={i}>
                    <div className="flex-1 text-center">
                      <div
                        className="mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold"
                        style={{
                          background: step.done ? C.success : C.bgNested,
                          borderColor: step.done ? C.success : C.border,
                          color: step.done ? C.textInverse : C.textMuted,
                        }}
                      >
                        {step.done ? '✓' : i + 1}
                      </div>
                      <div className="text-xs font-semibold" style={{ color: step.done ? C.success : C.textSecondary }}>{step.label}</div>
                      <div className="text-xs text-subtle-foreground">{step.desc}</div>
                    </div>
                    {i < arr.length - 1 && (
                      <div className="h-0.5 w-6 shrink-0 bg-border" />
                    )}
                  </React.Fragment>
                ))}
              </div>
            )}

            {/* Summary bar */}
            {userList.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-info transition-[width] duration-slow ease-out"
                    style={{ width: `${Math.round((userList.filter(u => u.workDates.length > 0 || u.leaveDates.length > 0).length / Math.max(userList.length, 1)) * 100)}%` }}
                  />
                </div>
                <span className="min-w-[60px] text-sm font-bold text-info">
                  {userList.length} בקשות
                </span>
              </div>
            )}
          </div>

          {/* Requests table */}
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="text-base font-semibold">בקשות עובדים</span>
              {pendingCount > 0 && season.isActive && (
                <button className="cursor-pointer rounded-md border border-danger/20 bg-danger-bg px-3 py-1.5 text-xs font-semibold text-danger">
                  📧 שלח תזכורת ל-{pendingCount} ממתינים
                </button>
              )}
            </div>

            {reqLoading && (
              <div className="p-8 text-center text-sm text-subtle-foreground">טוען...</div>
            )}

            {!reqLoading && userList.length === 0 && (
              <div className="p-8 text-center">
                <div className="mb-2 text-3xl">📭</div>
                <div className="text-sm text-subtle-foreground">ללא בקשה עד כה</div>
              </div>
            )}

            {!reqLoading && userList.map((u, i) => (
              <div
                key={u.userId}
                className="flex items-start justify-between gap-3 px-5 py-3"
                style={{
                  borderBottom: i < userList.length - 1 ? `1px solid ${C.border}` : 'none',
                  background: i % 2 === 0 ? C.bgCard : C.bgNested,
                }}
              >

                {/* User */}
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-info/20 bg-info-bg text-sm font-bold text-info">
                    {u.fullName.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{u.fullName}</div>
                    <div className="text-xs text-subtle-foreground">{u.email}</div>
                  </div>
                </div>

                {/* Dates per status */}
                <div className="flex shrink-0 flex-col items-end gap-1.5">

                  {u.workDates.length > 0 && (
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <span className="whitespace-nowrap text-xs font-semibold text-success">
                        💼 ימי עבודה:
                      </span>
                      {u.workDates.sort().map(d => (
                        <span key={d} className="whitespace-nowrap rounded-sm border border-success/13 bg-success-bg px-1.5 py-px text-xs text-success">
                          {fmtShort(d)}
                        </span>
                      ))}
                    </div>
                  )}

                  {u.leaveDates.length > 0 && (
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <span className="whitespace-nowrap text-xs font-semibold text-warning">
                        🏖 ימי חופשה:
                      </span>
                      {u.leaveDates.sort().map(d => (
                        <span key={d} className="whitespace-nowrap rounded-sm border border-warning/13 bg-warning-bg px-1.5 py-px text-xs text-warning">
                          {fmtShort(d)}
                        </span>
                      ))}
                    </div>
                  )}

                  {u.workDates.length === 0 && u.leaveDates.length === 0 && (
                    <span className="text-xs text-subtle-foreground">ללא בקשה</span>
                  )}

                  {u.hasPending && (
                    <span className="rounded-full border border-warning/13 bg-warning-bg px-2 py-px text-xs text-warning">
                      ⏳ ממתין לאישור
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Warning footer */}
          {pendingCount > 0 && season.isActive && (
            <div className="mt-3 rounded-xl border border-danger/20 bg-danger-bg p-4 text-sm text-danger">
              ⚠️ <strong>{pendingCount} בקשות</strong> ממתינות לאישור
              {daysToHoliday !== null && daysToHoliday <= 7 ? ' — שלח דוח למנהל' : ' — תזכורת אוטומטית תישלח מחר'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
