import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { DateField, DateRangeField } from './DatePicker';
import { formatDate } from '../utils/dateFormat';

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

type RequestKind = 'leave' | 'work';
type ApprovalStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'CANCELLED';

interface LeaveRequest {
  id: string;
  date: string;
  kind: RequestKind;
  reason?: string;
  status: ApprovalStatus;
  seasonId?: string;
  season?: { id: string; name: string };
  groupId?: string | null;
  cancelledByName?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
}

// Collapses requests that share a groupId (submitted together as one date
// range) into a single display entry — a manager-approved/declined range
// stays one row per day in the DB, but reads as one chip here.
interface DisplayGroup {
  key: string;
  dates: string[]; // sorted ascending
  kind: RequestKind;
  status: ApprovalStatus;
}

function groupForDisplay(reqs: LeaveRequest[]): DisplayGroup[] {
  const byGroup = new Map<string, LeaveRequest[]>();
  const out: DisplayGroup[] = [];
  for (const r of reqs) {
    if (r.groupId) {
      if (!byGroup.has(r.groupId)) byGroup.set(r.groupId, []);
      byGroup.get(r.groupId)!.push(r);
    } else {
      out.push({ key: r.id, dates: [r.date], kind: r.kind, status: r.status });
    }
  }
  Array.from(byGroup.entries()).forEach(([groupId, list]) => {
    const sorted = [...list].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    out.push({ key: groupId, dates: sorted.map(r => r.date), kind: sorted[0].kind, status: sorted[0].status });
  });
  out.sort((a, b) => new Date(a.dates[0]).getTime() - new Date(b.dates[0]).getTime());
  return out;
}

interface Props {
  token: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LEAVE_DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const fmt = (d: string) => `יום ${LEAVE_DOW[new Date(d).getDay()]}, ${formatDate(d)}`;

// Returns true if today >= firstHolidayDate - 3 days
const isSeasonLocked = (dates: SeasonDate[]): boolean => {
  if (!dates.length) return false;
  const sorted = [...dates].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const lockDate = new Date(sorted[0].date);
  lockDate.setDate(lockDate.getDate() - 3);
  lockDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today >= lockDate;
};

// Returns the (optional) cancellation reason if the user wants to proceed,
// or undefined if they backed out. An approved leave gets an extra confirm
// step since cancelling it is more consequential than a still-pending one.
function confirmCancelReason(req: LeaveRequest): string | undefined {
  if (req.status === 'APPROVED') {
    if (!window.confirm('החופשה כבר אושרה. לבטל אותה בכל זאת?')) return undefined;
  }
  return window.prompt('סיבת ביטול (לא חובה):') ?? undefined;
}

// Explicit literal class lookups (never string-interpolated with a runtime
// value) for every "pick one of N known states" spot in this file.
const STATUS_META: Record<ApprovalStatus, { label: string; className: string }> = {
  PENDING:   { label: 'ממתין',  className: 'text-warning bg-warning-bg border-warning/20' },
  APPROVED:  { label: 'אושר',   className: 'text-success bg-success-bg border-success/20' },
  DECLINED:  { label: 'נדחה',   className: 'text-danger bg-danger-bg border-danger/20' },
  CANCELLED: { label: 'בוטל',   className: 'text-subtle-foreground bg-muted border-border' },
};

// Season-date type dot/label colors — raw hex (holiday=red, chol hamoed=orange),
// not design-system tokens, kept as literal arbitrary-value classes 1:1 with
// the old inline hex.
function seasonDateTypeClasses(isHoliday: boolean): { dot: string; text: string; bg: string } {
  return isHoliday
    ? { dot: 'bg-[#e74c3c]', text: 'text-[#e74c3c]', bg: 'bg-[#e74c3c]/10' }
    : { dot: 'bg-[#e67e22]', text: 'text-[#e67e22]', bg: 'bg-[#e67e22]/10' };
}

// Day-card tint by request kind — the old code used raw hardcoded rgba greens
// /blues here (not the theme's success/info tokens), so those exact values are
// preserved via arbitrary-value classes rather than swapped for the tokens.
function dayCardClasses(kind: RequestKind | undefined): { bg: string; border: string } {
  if (kind === 'leave') return { bg: 'bg-[rgba(46,204,113,0.08)]', border: 'border-success/25' };
  if (kind === 'work') return { bg: 'bg-[rgba(52,152,219,0.08)]', border: 'border-info/25' };
  return { bg: 'bg-muted', border: 'border-border' };
}

function seasonBadgeClasses(locked: boolean, isActive: boolean): string {
  if (locked) return 'bg-danger-bg text-danger border-danger/20';
  if (isActive) return 'bg-success-bg text-success border-success/20';
  return 'bg-muted text-subtle-foreground border-border';
}

function toggleBtnClass(kind: RequestKind, active: boolean): string {
  const activeMap: Record<RequestKind, string> = {
    leave: 'bg-success border-success text-white',
    work: 'bg-info border-info text-white',
  };
  const base = 'flex-1 cursor-pointer rounded-md border px-1 py-[5px] text-xs font-semibold transition-colors duration-fast ease-out';
  return `${base} ${active ? activeMap[kind] : 'bg-transparent border-border text-subtle-foreground'}`;
}

function groupChipClass(kind: RequestKind): string {
  return kind === 'leave'
    ? 'bg-success-bg text-success border-success/20'
    : 'bg-info-bg text-info border-info/20';
}

function rangeApplyBtnClass(hasRange: boolean, busy: boolean): string {
  const base = 'rounded-md border-none px-[18px] py-[7px] text-sm font-semibold transition-colors duration-fast ease-out';
  const color = hasRange ? 'bg-primary text-white' : 'bg-card text-subtle-foreground';
  const cursor = (!hasRange || busy) ? 'cursor-not-allowed' : 'cursor-pointer';
  return `${base} ${color} ${cursor}`;
}

function submitBtnClass(hasDate: boolean): string {
  const base = 'rounded-md border-none px-5 py-2 text-sm font-semibold transition-colors duration-fast ease-out';
  return hasDate ? `${base} bg-primary text-white cursor-pointer` : `${base} bg-muted text-subtle-foreground cursor-not-allowed`;
}

// Two DatePicker components (DateField/DateRangeField) don't accept a
// className — they're a separate, unmigrated component (not in scope here) —
// so the handful of call sites below that need a non-default look still pass
// a `style` override. Kept as literal hardcoded values (not theme.ts imports)
// so this file no longer depends on the old token system; values match
// theme.ts's bgCard/bgNested/border/textPrimary/FONT/TEXT.sm 1:1.
const FONT_STACK = "'Rubik', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";
const dateInputStyleOnCard: React.CSSProperties = {
  padding: '6px 10px', borderRadius: '8px', border: '1px solid #E5E7EE',
  background: '#FFFFFF', color: '#14152A', fontSize: '17px', lineHeight: '24px',
  outline: 'none', fontFamily: FONT_STACK,
};
const dateInputStyleNested: React.CSSProperties = {
  padding: '7px 12px', borderRadius: '8px', border: '1px solid #E5E7EE',
  background: '#F1F2F7', color: '#14152A', fontSize: '17px', lineHeight: '24px',
  outline: 'none', fontFamily: FONT_STACK,
};

// ── Component ─────────────────────────────────────────────────────────────────

export const EmployeeLeavesView: React.FC<Props> = ({ token }) => {
  const headers = { Authorization: `Bearer ${token}` };

  const [seasons, setSeasons]       = useState<Season[]>([]);
  const [myRequests, setMyRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState<string | null>(null); // date being saved
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');

  // Free-form
  const [freeDate, setFreeDate]     = useState('');
  const [freeReason, setFreeReason] = useState('');
  const [freeKind, setFreeKind]     = useState<RequestKind>('leave');
  const [freeSaving, setFreeSaving] = useState(false);

  // Bulk range selection — for long seasons (e.g. summer) picking every day
  // one-by-one is tedious; this applies a kind to every open day in a range
  // in one action, on top of the existing per-day toggle below.
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd]     = useState('');
  const [rangeKind, setRangeKind]   = useState<RequestKind>('leave');
  const [rangeSaving, setRangeSaving] = useState(false);
  const [rangeSkipped, setRangeSkipped] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        axios.get(`${API}/leaves/seasons`, { headers }),
        axios.get(`${API}/leaves/my-requests`, { headers }),
      ]);
      setSeasons(s.data);
      setMyRequests(r.data);
      if (!selectedSeasonId && s.data.length > 0) {
        const active = s.data.find((x: Season) => x.isActive) ?? s.data[0];
        setSelectedSeasonId(active.id);
      }
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const reqForDate = (date: string) =>
    myRequests.find(r => r.date.startsWith(date) || new Date(r.date).toISOString().startsWith(date));

  const toggleDate = async (sd: SeasonDate, seasonId: string, kind: RequestKind) => {
    const existing = reqForDate(sd.date);
    const isoDate = new Date(sd.date).toISOString().split('T')[0];
    setSaving(isoDate);
    try {
      if (existing && existing.kind === kind && existing.status !== 'CANCELLED') {
        // cancel — clicking a range that shares a groupId cancels the whole
        // range on the server, so refetch instead of patching just this row.
        const reason = confirmCancelReason(existing);
        if (reason === undefined) { setSaving(null); return; }
        await axios.delete(`${API}/leaves/requests/${existing.id}`, { headers, data: { reason } });
        await load();
      } else {
        // create / update (also re-requesting a previously cancelled day)
        const res = await axios.post(`${API}/leaves/requests`, { seasonId, date: isoDate, kind }, { headers });
        setMyRequests(prev => {
          const filtered = prev.filter(r => r.id !== existing?.id);
          return [...filtered, res.data];
        });
      }
    } catch { /* silent */ }
    finally { setSaving(null); }
  };

  const applyRange = async (season: Season) => {
    if (!rangeStart || !rangeEnd) return;
    setRangeSaving(true);
    setRangeSkipped(0);
    try {
      // One groupId shared by every day created in this range submission — lets
      // the UI display/approve the whole range as one unit, while storage stays
      // one row per day (qa-workplan.service.ts's per-day leave lookup is unaffected).
      const groupId = (crypto as any).randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // Walk every calendar day in the picked range — NOT season.dates. For a
      // multi-month season like summer, season.dates only holds a couple of
      // sparse marker entries (e.g. just the first and last day), so filtering
      // against it silently matched nothing for any sub-range the user picked.
      const start = new Date(rangeStart);
      const end = new Date(rangeEnd);
      let skipped = 0;
      for (const d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
        const dow = d.getDay(); // 5 = Friday, 6 = Saturday — not work days, skip silently
        if (dow === 5 || dow === 6) continue;
        const isoDate = d.toISOString().split('T')[0];
        if (isSeasonLocked([{ id: '', date: isoDate, label: '', type: 'holiday', orderIndex: 0 }])) { skipped++; continue; }
        const existing = reqForDate(isoDate);
        if (existing?.kind === rangeKind) continue; // already set correctly
        try {
          const res = await axios.post(`${API}/leaves/requests`, { seasonId: season.id, date: isoDate, kind: rangeKind, groupId }, { headers });
          setMyRequests(prev => [...prev.filter(r => r.id !== existing?.id), res.data]);
        } catch { skipped++; }
      }
      setRangeSkipped(skipped);
    } finally {
      setRangeSaving(false);
    }
  };

  const submitFree = async () => {
    if (!freeDate) return;
    setFreeSaving(true);
    try {
      const res = await axios.post(`${API}/leaves/requests`, { date: freeDate, kind: freeKind, reason: freeReason || undefined }, { headers });
      setMyRequests(prev => [...prev, res.data]);
      setFreeDate('');
      setFreeReason('');
      setFreeKind('leave');
    } finally { setFreeSaving(false); }
  };

  const cancelFree = async (r: LeaveRequest) => {
    const reason = confirmCancelReason(r);
    if (reason === undefined) return;
    await axios.delete(`${API}/leaves/requests/${r.id}`, { headers, data: { reason } });
    await load();
  };

  const selectedSeason = seasons.find(s => s.id === selectedSeasonId);

  const approvedCount = myRequests.filter(r => r.status === 'APPROVED').length;
  const pendingCount  = myRequests.filter(r => r.status === 'PENDING').length;

  // requests not linked to any season date (free-form)
  const freeRequests = myRequests.filter(r => !r.seasonId || !seasons.find(s => s.id === r.seasonId));

  if (loading) {
    return (
      <div className="p-[60px] text-center text-subtle-foreground">
        <div className="text-4xl">📅</div>
        <p className="mt-3">טוען...</p>
      </div>
    );
  }

  return (
    <div className="text-foreground">

      {/* ── Header ── */}
      <div className="mb-5 flex items-center gap-3">
        <span className="text-xl">📅</span>
        <div>
          <div className="text-lg font-bold">החופשות שלי</div>
          <div className="text-sm text-subtle-foreground">בקש חופשה או עבודה בימי החג</div>
        </div>
        <div className="ms-auto flex gap-2">
          {approvedCount > 0 && (
            <span className="rounded-full border border-success/20 bg-success-bg px-3 py-1 text-xs font-bold text-success">
              ✓ {approvedCount} אושרו
            </span>
          )}
          {pendingCount > 0 && (
            <span className="rounded-full border border-warning/20 bg-warning-bg px-3 py-1 text-xs font-bold text-warning">
              ⏳ {pendingCount} ממתינים
            </span>
          )}
        </div>
      </div>

      {/* ── Season selector ── */}
      <div className="mb-5 flex flex-wrap gap-3">
        {seasons.map(season => {
          const isSelected = season.id === selectedSeasonId;
          const myCount = myRequests.filter(r => r.seasonId === season.id).length;
          return (
            <button key={season.id}
              onClick={() => setSelectedSeasonId(season.id)}
              className={[
                'min-w-[180px] cursor-pointer rounded-2xl px-4 py-3 text-start',
                'transition-[background-color,border-color,opacity] duration-fast ease-out',
                isSelected ? 'border-2 border-primary' : 'border border-border',
                isSelected ? 'bg-primary-100' : season.isActive ? 'bg-card' : 'bg-muted',
                !season.isActive && !isSelected ? 'opacity-[0.55]' : 'opacity-100',
              ].join(' ')}>
              <div className="mb-1 flex items-center gap-2">
                <span className={`text-[11px] ${season.isActive ? 'text-success' : 'text-subtle-foreground'}`}>
                  {season.isActive ? '●' : '○'}
                </span>
                <span className={`text-md font-semibold ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                  {season.name}
                </span>
              </div>
              <div className="text-xs text-subtle-foreground">{season.dateRange}</div>
              {myCount > 0 && (
                <div className="mt-1.5 text-xs text-info">{myCount} בקשות שלי</div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Season calendar ── */}
      {selectedSeason && (
        <div className="mb-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
          {(() => {
            // Locked only once every date in the season has passed its own 3-day cutoff —
            // a multi-month season (e.g. summer) must stay open for its later dates even
            // after its earliest date's cutoff has passed.
            const locked = selectedSeason.isActive && selectedSeason.dates.every((sd: SeasonDate) => isSeasonLocked([sd]));
            return (
              <div className="mb-4 flex items-center gap-2">
                <span className="text-[18px]">🗓</span>
                <span className="text-lg font-semibold">{selectedSeason.name}</span>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${seasonBadgeClasses(locked, selectedSeason.isActive)}`}>
                  {locked ? '🔒 נעול לבקשות' : selectedSeason.isActive ? 'חופשה פעילה' : 'עתידי'}
                </span>
              </div>
            );
          })()}

          {selectedSeason.isActive && selectedSeason.dates.length > 1 && (
            <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted p-3">
              <div className="min-w-[260px]">
                <div className="mb-1 text-xs text-subtle-foreground">טווח תאריכים</div>
                <DateRangeField startIso={rangeStart} endIso={rangeEnd}
                  onChange={(s, e) => { setRangeStart(s); setRangeEnd(e); }}
                  style={dateInputStyleOnCard} />
              </div>
              <div>
                <div className="mb-1 text-xs text-subtle-foreground">סוג</div>
                <div className="flex gap-1 rounded-md border border-border bg-card p-1">
                  {(['leave', 'work'] as const).map(k => (
                    <button key={k} onClick={() => setRangeKind(k)}
                      className={`cursor-pointer rounded-sm border-none px-3.5 py-[5px] text-xs ${rangeKind === k ? 'bg-muted font-semibold text-foreground' : 'bg-transparent font-normal text-subtle-foreground'}`}>
                      {k === 'leave' ? '🏖 חופשה' : '💼 עבודה'}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => applyRange(selectedSeason)}
                disabled={!rangeStart || !rangeEnd || rangeSaving}
                className={rangeApplyBtnClass(!!rangeStart && !!rangeEnd, rangeSaving)}>
                {rangeSaving ? 'מחיל...' : 'החל על הטווח'}
              </button>
              {rangeSkipped > 0 && !rangeSaving && (
                <div className="text-xs text-subtle-foreground">{rangeSkipped} ימים בטווח דולגו (נעולים)</div>
              )}
            </div>
          )}

          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {selectedSeason.dates.map(sd => {
              const isoDate  = new Date(sd.date).toISOString().split('T')[0];
              const req      = reqForDate(isoDate);
              const isBusy   = saving === isoDate;
              // Lock this specific date based on its own cutoff, not the season's earliest date —
              // otherwise a long season (e.g. summer) locks its whole range as soon as it opens.
              const locked   = selectedSeason.isActive && isSeasonLocked([sd]);
              const disabled = !selectedSeason.isActive || isBusy || locked;
              const isHoliday = sd.type === 'holiday';
              const typeClasses = seasonDateTypeClasses(isHoliday);
              const dayClasses = dayCardClasses(req?.kind);

              return (
                <div key={sd.id} className={[
                  'rounded-xl border p-3 transition-opacity duration-fast ease-out',
                  dayClasses.bg, dayClasses.border,
                  (disabled && !req) ? 'opacity-[0.55]' : 'opacity-100',
                ].join(' ')}>
                  <div className="mb-2 flex items-start justify-between">
                    <div>
                      <div className="text-sm font-bold text-foreground">{fmt(isoDate)}</div>
                      <div className="mt-[3px] flex items-center gap-1">
                        <span className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${typeClasses.dot}`} />
                        <span className={`text-xs font-semibold ${typeClasses.text}`}>{sd.label}</span>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-sm px-[7px] py-0.5 text-xs font-medium ${typeClasses.text} ${typeClasses.bg}`}>
                      {isHoliday ? 'חג' : 'ח"מ'}
                    </span>
                  </div>

                  {req && (
                    <div className="mb-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_META[req.status].className}`}>
                        {req.kind === 'leave' ? '🏖 חופשה' : '💼 עבודה'} — {STATUS_META[req.status].label}
                      </span>
                      {req.status === 'CANCELLED' && req.cancelledByName && (
                        <div className="mt-[3px] text-xs text-subtle-foreground">
                          בוטל ע"י {req.cancelledByName}{req.cancelReason ? ` — ${req.cancelReason}` : ''}
                        </div>
                      )}
                    </div>
                  )}

                  {!disabled && !locked ? (
                    <div className="flex gap-[5px]">
                      <button onClick={() => toggleDate(sd, selectedSeason.id, 'leave')}
                        className={toggleBtnClass('leave', req?.kind === 'leave')}>
                        🏖 חופשה
                      </button>
                      <button onClick={() => toggleDate(sd, selectedSeason.id, 'work')}
                        className={toggleBtnClass('work', req?.kind === 'work')}>
                        💼 עבודה
                      </button>
                    </div>
                  ) : locked ? (
                    !req && <div className="text-xs text-danger">🔒 נעול — לא ניתן לבקש</div>
                  ) : (
                    !req && <div className="text-xs text-subtle-foreground">נפתח בהמשך</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Summary row — consecutive days submitted together (same groupId) show as one range chip */}
          {myRequests.some(r => r.seasonId === selectedSeason.id) && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-muted px-4 py-3">
              <span className="text-sm text-subtle-foreground">הבקשות שלי:</span>
              {groupForDisplay(myRequests.filter(r => r.seasonId === selectedSeason.id))
                .map(g => (
                <span key={g.key} className={`rounded-full border px-2.5 py-[3px] text-xs font-semibold ${groupChipClass(g.kind)}`}>
                  {g.dates.length > 1
                    ? `${fmt(g.dates[0])} — ${fmt(g.dates[g.dates.length - 1])} (${g.dates.length} ימים)`
                    : fmt(g.dates[0])}
                  {' '}— {g.kind === 'leave' ? 'חופשה' : 'עבודה'}
                  {g.status !== 'PENDING' && ` (${STATUS_META[g.status].label})`}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Free-form request ── */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-[18px]">📝</span>
          <span className="text-lg font-semibold">בקשה לתאריך אחר</span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="mb-1 text-xs text-subtle-foreground">תאריך</div>
            <DateField value={freeDate} onChange={v => setFreeDate(v)}
              style={dateInputStyleNested} />
          </div>
          <div>
            <div className="mb-1 text-xs text-subtle-foreground">סוג</div>
            <div className="flex gap-1 rounded-md border border-border bg-muted p-1">
              {(['leave', 'work'] as const).map(k => (
                <button key={k} onClick={() => setFreeKind(k)}
                  className={`cursor-pointer rounded-sm border-none px-3.5 py-[5px] text-xs transition-[background-color,color,box-shadow] duration-fast ease-out ${freeKind === k ? 'bg-card font-semibold text-foreground shadow-xs' : 'bg-transparent font-normal text-subtle-foreground'}`}>
                  {k === 'leave' ? '🏖 חופשה' : '💼 עבודה'}
                </button>
              ))}
            </div>
          </div>
          <div className="min-w-[160px] flex-1">
            <div className="mb-1 text-xs text-subtle-foreground">סיבה (אופציונלי)</div>
            <input type="text" placeholder="חופשה משפחתית, אירוע..." value={freeReason} onChange={e => setFreeReason(e.target.value)}
              className="box-border w-full rounded-md border border-border bg-muted px-3 py-[7px] text-sm text-foreground outline-none" />
          </div>
          <button onClick={submitFree} disabled={!freeDate || freeSaving}
            className={submitBtnClass(!!freeDate)}>
            {freeSaving ? '...' : 'שלח'}
          </button>
        </div>

        {/* Free requests list */}
        {freeRequests.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <div className="text-xs font-semibold text-subtle-foreground">בקשות חופשה חופשיות:</div>
            {freeRequests.map(r => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border border-border bg-muted px-3 py-2">
                <span>{r.kind === 'leave' ? '🏖' : '💼'}</span>
                <span className="text-sm font-medium text-foreground">{fmt(r.date)}</span>
                {r.reason && <span className="text-sm text-subtle-foreground">{r.reason}</span>}
                {r.status === 'CANCELLED' && r.cancelledByName && (
                  <span className="text-xs text-subtle-foreground">
                    בוטל ע"י {r.cancelledByName}{r.cancelReason ? ` — ${r.cancelReason}` : ''}
                  </span>
                )}
                <span className={`ms-auto rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_META[r.status].className}`}>
                  {STATUS_META[r.status].label}
                </span>
                {(r.status === 'PENDING' || r.status === 'APPROVED') && (
                  <button onClick={() => cancelFree(r)}
                    className="cursor-pointer rounded border-none bg-transparent px-1.5 py-0.5 text-xs text-danger">
                    ביטול
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
