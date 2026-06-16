import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../../theme';
import { useDialog } from '../../context/DialogContext';

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

const fmtShort = (d: string) =>
  new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });

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
    <div style={{ fontFamily: FONT, direction: 'rtl', color: C.textPrimary, display: 'flex', gap: SP[5], alignItems: 'flex-start' }}>

      {/* ── Season list ── */}
      <div style={{ width: '280px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: SP[3] }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP[1] }}>
          <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold }}>מועדי חופשות</div>
          <button style={{ background: C.brand, color: C.textInverse, border: 'none', borderRadius: RADIUS.md, padding: '6px 14px', cursor: 'pointer', ...TEXT.sm, fontWeight: WEIGHT.semibold }}>
            + חדשה
          </button>
        </div>

        {/* ── Auto-import row ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.xl, padding: `${SP[2]} ${SP[3]}` }}>
          <select
            value={importYear}
            onChange={e => { setImportYear(Number(e.target.value)); setImportResult(null); }}
            style={{ border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '3px 6px', ...TEXT.sm, background: C.bgNested, color: C.textPrimary, cursor: 'pointer' }}
          >
            {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={handleImport}
            disabled={importing}
            style={{ flex: 1, background: importing ? C.textMuted : C.info, color: C.textInverse, border: 'none', borderRadius: RADIUS.md, padding: '4px 10px', cursor: importing ? 'not-allowed' : 'pointer', ...TEXT.sm, fontWeight: WEIGHT.semibold }}
          >
            {importing ? 'מייבא...' : '📅 ייבוא חגים אוטומטי'}
          </button>
        </div>
        {importResult && (
          <div style={{ ...TEXT.xs, color: C.success, background: C.successBg, padding: '4px 10px', borderRadius: RADIUS.md, textAlign: 'center' }}>
            נוספו {importResult.created} | דולגו {importResult.skipped}
          </div>
        )}

        {loading ? (
          <div style={{ color: C.textMuted, ...TEXT.sm, textAlign: 'center', padding: SP[5] }}>טוען...</div>
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
                style={{
                  background: isSel ? C.bgActive : C.bgCard,
                  border: `1px solid ${isSel ? C.borderFocus : C.border}`,
                  borderRadius: RADIUS['2xl'], padding: SP[4],
                  cursor: 'pointer', transition: EASE.fast,
                  boxShadow: isSel ? SHADOW.sm : 'none',
                  opacity: isP ? 0.7 : 1,
                }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = C.bgHover; }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = isP ? C.bgCard : C.bgCard; }}
              >
                <div style={{ ...TEXT.base, fontWeight: WEIGHT.semibold, marginBottom: '4px' }}>{s.name}</div>
                <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: SP[2] }}>{s.dateRange}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: statusColor, background: statusBg, padding: '2px 8px', borderRadius: RADIUS.full }}>
                    {statusLabel}
                  </span>
                  {isSel && requests.length > 0 && (
                    <span style={{ ...TEXT.xs, color: C.textMuted }}>{requests.length} בקשות</span>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], margin: `${SP[2]} 0 ${SP[1]}` }}>
                    <div style={{ flex: 1, height: '1px', background: C.border }} />
                    <span style={{ ...TEXT.xs, color: C.textMuted, whiteSpace: 'nowrap' }}>חגים שהסתיימו</span>
                    <div style={{ flex: 1, height: '1px', background: C.border }} />
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
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Header card */}
          <div style={{ background: C.bgCard, borderRadius: RADIUS['2xl'], border: `1px solid ${C.border}`, padding: SP[5], marginBottom: SP[4], boxShadow: SHADOW.sm }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: SP[4] }}>
              <div>
                <div style={{ ...TEXT['2xl'], fontWeight: WEIGHT.bold, marginBottom: '4px' }}>{season.name}</div>
                <div style={{ ...TEXT.sm, color: C.textMuted }}>{season.dateRange}</div>
              </div>

              {/* Days counter or lock badge */}
              {isLocked ? (
                <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}33`, borderRadius: RADIUS.xl, padding: '10px 18px', textAlign: 'center' }}>
                  <div style={{ fontSize: '22px', marginBottom: '2px' }}>🔒</div>
                  <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.danger }}>נעול לבקשות</div>
                </div>
              ) : daysToHoliday !== null && daysToHoliday > 0 ? (
                <div style={{ background: C.infoBg, border: `1px solid ${C.info}33`, borderRadius: RADIUS.xl, padding: '8px 16px', textAlign: 'center' }}>
                  <div style={{ ...TEXT['2xl'], fontWeight: WEIGHT.bold, color: C.info }}>{daysToHoliday}</div>
                  <div style={{ ...TEXT.xs, color: C.textMuted }}>ימים לפתיחה</div>
                </div>
              ) : null}
            </div>

            {/* Timeline */}
            {daysToHoliday !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: SP[4] }}>
                {[
                  { label: 'פתיחת חופשה לדיווח', desc: '30 יום לפני', done: daysToHoliday <= 30 },
                  { label: 'תזכורות יומיות',      desc: '29–4 ימים',   done: daysToHoliday <= 4  },
                  { label: 'לא ניתן לבקש חופשה', desc: '3 ימים לפני', done: daysToHoliday <= 3  },
                  { label: 'נעילה',               desc: 'מועד החגים',  done: daysToHoliday <= 0  },
                ].map((step, i, arr) => (
                  <React.Fragment key={i}>
                    <div style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{
                        width: '28px', height: '28px', borderRadius: '50%', margin: '0 auto 4px',
                        background: step.done ? C.success : C.bgNested,
                        border: `2px solid ${step.done ? C.success : C.border}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        ...TEXT.xs, color: step.done ? C.textInverse : C.textMuted, fontWeight: WEIGHT.bold,
                      }}>
                        {step.done ? '✓' : i + 1}
                      </div>
                      <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: step.done ? C.success : C.textSecondary }}>{step.label}</div>
                      <div style={{ ...TEXT.xs, color: C.textMuted }}>{step.desc}</div>
                    </div>
                    {i < arr.length - 1 && (
                      <div style={{ height: '2px', width: '24px', background: C.border, flexShrink: 0 }} />
                    )}
                  </React.Fragment>
                ))}
              </div>
            )}

            {/* Summary bar */}
            {userList.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: SP[3] }}>
                <div style={{ flex: 1, height: '8px', background: C.bgNested, borderRadius: RADIUS.full, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.round((userList.filter(u => u.workDates.length > 0 || u.leaveDates.length > 0).length / Math.max(userList.length, 1)) * 100)}%`,
                    background: C.info, borderRadius: RADIUS.full, transition: EASE.slow,
                  }} />
                </div>
                <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.info, minWidth: '60px' }}>
                  {userList.length} בקשות
                </span>
              </div>
            )}
          </div>

          {/* Requests table */}
          <div style={{ background: C.bgCard, borderRadius: RADIUS['2xl'], border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: SHADOW.sm }}>
            <div style={{ padding: `${SP[3]} ${SP[5]}`, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ ...TEXT.base, fontWeight: WEIGHT.semibold }}>בקשות עובדים</span>
              {pendingCount > 0 && season.isActive && (
                <button style={{ background: C.dangerBg, color: C.danger, border: `1px solid ${C.danger}33`, borderRadius: RADIUS.md, padding: '5px 12px', cursor: 'pointer', ...TEXT.xs, fontWeight: WEIGHT.semibold }}>
                  📧 שלח תזכורת ל-{pendingCount} ממתינים
                </button>
              )}
            </div>

            {reqLoading && (
              <div style={{ padding: SP[8], textAlign: 'center', color: C.textMuted, ...TEXT.sm }}>טוען...</div>
            )}

            {!reqLoading && userList.length === 0 && (
              <div style={{ padding: SP[8], textAlign: 'center' }}>
                <div style={{ fontSize: '32px', marginBottom: SP[2] }}>📭</div>
                <div style={{ ...TEXT.sm, color: C.textMuted }}>ללא בקשה עד כה</div>
              </div>
            )}

            {!reqLoading && userList.map((u, i) => (
              <div key={u.userId} style={{
                padding: `${SP[3]} ${SP[5]}`,
                borderBottom: i < userList.length - 1 ? `1px solid ${C.border}` : 'none',
                background: i % 2 === 0 ? C.bgCard : C.bgNested,
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: SP[3],
              }}>

                {/* User */}
                <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], minWidth: 0 }}>
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                    background: C.infoBg, border: `1px solid ${C.info}33`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.info,
                  }}>
                    {u.fullName.charAt(0)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ ...TEXT.sm, fontWeight: WEIGHT.medium }}>{u.fullName}</div>
                    <div style={{ ...TEXT.xs, color: C.textMuted }}>{u.email}</div>
                  </div>
                </div>

                {/* Dates per status */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px', flexShrink: 0 }}>

                  {u.workDates.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <span style={{ ...TEXT.xs, color: C.success, fontWeight: WEIGHT.semibold, whiteSpace: 'nowrap' }}>
                        💼 ימי עבודה:
                      </span>
                      {u.workDates.sort().map(d => (
                        <span key={d} style={{
                          ...TEXT.xs, background: C.successBg, color: C.success,
                          padding: '1px 7px', borderRadius: RADIUS.sm,
                          border: `1px solid ${C.success}22`, whiteSpace: 'nowrap',
                        }}>
                          {fmtShort(d)}
                        </span>
                      ))}
                    </div>
                  )}

                  {u.leaveDates.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <span style={{ ...TEXT.xs, color: C.warning, fontWeight: WEIGHT.semibold, whiteSpace: 'nowrap' }}>
                        🏖 ימי חופשה:
                      </span>
                      {u.leaveDates.sort().map(d => (
                        <span key={d} style={{
                          ...TEXT.xs, background: C.warningBg, color: C.warning,
                          padding: '1px 7px', borderRadius: RADIUS.sm,
                          border: `1px solid ${C.warning}22`, whiteSpace: 'nowrap',
                        }}>
                          {fmtShort(d)}
                        </span>
                      ))}
                    </div>
                  )}

                  {u.workDates.length === 0 && u.leaveDates.length === 0 && (
                    <span style={{ ...TEXT.xs, color: C.textDisabled }}>ללא בקשה</span>
                  )}

                  {u.hasPending && (
                    <span style={{ ...TEXT.xs, color: C.warning, background: C.warningBg, padding: '1px 8px', borderRadius: RADIUS.full, border: `1px solid ${C.warning}22` }}>
                      ⏳ ממתין לאישור
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Warning footer */}
          {pendingCount > 0 && season.isActive && (
            <div style={{ marginTop: SP[3], background: C.dangerBg, border: `1px solid ${C.danger}33`, borderRadius: RADIUS.xl, padding: SP[4], ...TEXT.sm, color: C.danger }}>
              ⚠️ <strong>{pendingCount} בקשות</strong> ממתינות לאישור
              {daysToHoliday !== null && daysToHoliday <= 7 ? ' — שלח דוח למנהל' : ' — תזכורת אוטומטית תישלח מחר'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
