import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../theme';

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
type ApprovalStatus = 'PENDING' | 'APPROVED' | 'DECLINED';

interface LeaveRequest {
  id: string;
  date: string;
  kind: RequestKind;
  reason?: string;
  status: ApprovalStatus;
  seasonId?: string;
  season?: { id: string; name: string };
}

interface Props {
  token: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', weekday: 'short' });

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

const STATUS_META: Record<ApprovalStatus, { label: string; color: string; bg: string }> = {
  PENDING:  { label: 'ממתין',  color: C.warning, bg: C.warningBg },
  APPROVED: { label: 'אושר',   color: C.success, bg: C.successBg },
  DECLINED: { label: 'נדחה',   color: C.danger,  bg: C.dangerBg  },
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
      if (existing && existing.kind === kind) {
        // cancel
        await axios.delete(`${API}/leaves/requests/${existing.id}`, { headers });
        setMyRequests(prev => prev.filter(r => r.id !== existing.id));
      } else {
        // create / update
        const res = await axios.post(`${API}/leaves/requests`, { seasonId, date: isoDate, kind }, { headers });
        setMyRequests(prev => {
          const filtered = prev.filter(r => r.id !== existing?.id);
          return [...filtered, res.data];
        });
      }
    } catch { /* silent */ }
    finally { setSaving(null); }
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

  const cancelFree = async (id: string) => {
    await axios.delete(`${API}/leaves/requests/${id}`, { headers });
    setMyRequests(prev => prev.filter(r => r.id !== id));
  };

  const selectedSeason = seasons.find(s => s.id === selectedSeasonId);

  const approvedCount = myRequests.filter(r => r.status === 'APPROVED').length;
  const pendingCount  = myRequests.filter(r => r.status === 'PENDING').length;

  // requests not linked to any season date (free-form)
  const freeRequests = myRequests.filter(r => !r.seasonId || !seasons.find(s => s.id === r.seasonId));

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted }}>
        <div style={{ fontSize: '36px' }}>📅</div>
        <p style={{ marginTop: '12px' }}>טוען...</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', color: C.textPrimary }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: SP[3], marginBottom: SP[5] }}>
        <span style={{ fontSize: '24px' }}>📅</span>
        <div>
          <div style={{ fontSize: '22px', fontWeight: WEIGHT.bold }}>החופשות שלי</div>
          <div style={{ ...TEXT.sm, color: C.textMuted }}>בקש חופשה או עבודה בימי החג</div>
        </div>
        <div style={{ marginRight: 'auto', display: 'flex', gap: SP[2] }}>
          {approvedCount > 0 && (
            <span style={{ background: C.successBg, color: C.success, border: `1px solid ${C.success}33`, ...TEXT.xs, fontWeight: WEIGHT.bold, padding: '4px 12px', borderRadius: RADIUS.full }}>
              ✓ {approvedCount} אושרו
            </span>
          )}
          {pendingCount > 0 && (
            <span style={{ background: C.warningBg, color: C.warning, border: `1px solid ${C.warning}33`, ...TEXT.xs, fontWeight: WEIGHT.bold, padding: '4px 12px', borderRadius: RADIUS.full }}>
              ⏳ {pendingCount} ממתינים
            </span>
          )}
        </div>
      </div>

      {/* ── Season selector ── */}
      <div style={{ display: 'flex', gap: SP[3], marginBottom: SP[5], flexWrap: 'wrap' }}>
        {seasons.map(season => {
          const isSelected = season.id === selectedSeasonId;
          const myCount = myRequests.filter(r => r.seasonId === season.id).length;
          return (
            <button key={season.id}
              onClick={() => setSelectedSeasonId(season.id)}
              style={{
                padding: `${SP[3]} ${SP[4]}`, borderRadius: RADIUS['2xl'], cursor: 'pointer',
                border: isSelected ? `2px solid ${C.brand}` : `1px solid ${C.border}`,
                background: isSelected ? C.brandDim : season.isActive ? C.bgCard : C.bgNested,
                textAlign: 'right' as const,
                opacity: !season.isActive && !isSelected ? 0.55 : 1,
                transition: EASE.fast, minWidth: '180px',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], marginBottom: '4px' }}>
                <span style={{ fontSize: '11px', color: season.isActive ? C.success : C.textDisabled }}>
                  {season.isActive ? '●' : '○'}
                </span>
                <span style={{ ...TEXT.md, fontWeight: WEIGHT.semibold, color: isSelected ? C.brand : C.textPrimary }}>
                  {season.name}
                </span>
              </div>
              <div style={{ ...TEXT.xs, color: C.textMuted }}>{season.dateRange}</div>
              {myCount > 0 && (
                <div style={{ marginTop: '6px', ...TEXT.xs, color: C.info }}>{myCount} בקשות שלי</div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Season calendar ── */}
      {selectedSeason && (
        <div style={{ background: C.bgCard, borderRadius: RADIUS['2xl'], border: `1px solid ${C.border}`, padding: SP[5], marginBottom: SP[5], boxShadow: SHADOW.sm }}>
          {(() => {
            // Locked only once every date in the season has passed its own 3-day cutoff —
            // a multi-month season (e.g. summer) must stay open for its later dates even
            // after its earliest date's cutoff has passed.
            const locked = selectedSeason.isActive && selectedSeason.dates.every((sd: SeasonDate) => isSeasonLocked([sd]));
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], marginBottom: SP[4] }}>
                <span style={{ fontSize: '18px' }}>🗓</span>
                <span style={{ ...TEXT.lg, fontWeight: WEIGHT.semibold }}>{selectedSeason.name}</span>
                <span style={{
                  ...TEXT.xs, fontWeight: WEIGHT.bold, padding: '2px 10px', borderRadius: RADIUS.full,
                  ...(locked
                    ? { background: C.dangerBg, color: C.danger, border: `1px solid ${C.danger}33` }
                    : selectedSeason.isActive
                    ? { background: C.successBg, color: C.success, border: `1px solid ${C.success}33` }
                    : { background: C.bgNested,  color: C.textDisabled, border: `1px solid ${C.border}` }),
                }}>
                  {locked ? '🔒 נעול לבקשות' : selectedSeason.isActive ? 'חופשה פעילה' : 'עתידי'}
                </span>
              </div>
            );
          })()}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: SP[3] }}>
            {selectedSeason.dates.map(sd => {
              const isoDate  = new Date(sd.date).toISOString().split('T')[0];
              const req      = reqForDate(isoDate);
              const isBusy   = saving === isoDate;
              // Lock this specific date based on its own cutoff, not the season's earliest date —
              // otherwise a long season (e.g. summer) locks its whole range as soon as it opens.
              const locked   = selectedSeason.isActive && isSeasonLocked([sd]);
              const disabled = !selectedSeason.isActive || isBusy || locked;
              const isHoliday = sd.type === 'holiday';
              const dotColor  = isHoliday ? '#e74c3c' : '#e67e22';
              const typeColor = isHoliday ? '#e74c3c' : '#e67e22';
              const typeBg    = isHoliday ? 'rgba(231,76,60,0.12)' : 'rgba(230,126,34,0.12)';

              return (
                <div key={sd.id} style={{
                  background: req
                    ? (req.kind === 'leave' ? 'rgba(46,204,113,0.08)' : 'rgba(52,152,219,0.08)')
                    : C.bgNested,
                  border: `1px solid ${req
                    ? (req.kind === 'leave' ? C.success + '44' : C.info + '44')
                    : C.border}`,
                  borderRadius: RADIUS.xl, padding: SP[3],
                  opacity: disabled && !req ? 0.55 : 1,
                  transition: EASE.fast,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: SP[2] }}>
                    <div>
                      <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold }}>{fmt(isoDate)}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px' }}>
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: dotColor, display: 'inline-block', flexShrink: 0 }} />
                        <span style={{ ...TEXT.xs, color: typeColor, fontWeight: WEIGHT.semibold }}>{sd.label}</span>
                      </div>
                    </div>
                    <span style={{ ...TEXT.xs, padding: '2px 7px', borderRadius: RADIUS.sm, background: typeBg, color: typeColor, fontWeight: WEIGHT.medium, flexShrink: 0 }}>
                      {isHoliday ? 'חג' : 'ח"מ'}
                    </span>
                  </div>

                  {req && (
                    <div style={{ marginBottom: SP[2] }}>
                      <span style={{
                        ...TEXT.xs, fontWeight: WEIGHT.semibold,
                        color: STATUS_META[req.status].color,
                        background: STATUS_META[req.status].bg,
                        padding: '2px 8px', borderRadius: RADIUS.full,
                        border: `1px solid ${STATUS_META[req.status].color}33`,
                      }}>
                        {req.kind === 'leave' ? '🏖 חופשה' : '💼 עבודה'} — {STATUS_META[req.status].label}
                      </span>
                    </div>
                  )}

                  {!disabled && !locked ? (
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <button onClick={() => toggleDate(sd, selectedSeason.id, 'leave')}
                        style={{
                          flex: 1, padding: '5px 4px', borderRadius: RADIUS.md, cursor: 'pointer',
                          background: req?.kind === 'leave' ? C.success : 'transparent',
                          border: `1px solid ${req?.kind === 'leave' ? C.success : C.border}`,
                          color: req?.kind === 'leave' ? 'white' : C.textMuted,
                          ...TEXT.xs, fontWeight: WEIGHT.semibold, transition: EASE.fast,
                        }}>
                        🏖 חופשה
                      </button>
                      <button onClick={() => toggleDate(sd, selectedSeason.id, 'work')}
                        style={{
                          flex: 1, padding: '5px 4px', borderRadius: RADIUS.md, cursor: 'pointer',
                          background: req?.kind === 'work' ? C.info : 'transparent',
                          border: `1px solid ${req?.kind === 'work' ? C.info : C.border}`,
                          color: req?.kind === 'work' ? 'white' : C.textMuted,
                          ...TEXT.xs, fontWeight: WEIGHT.semibold, transition: EASE.fast,
                        }}>
                        💼 עבודה
                      </button>
                    </div>
                  ) : locked ? (
                    !req && <div style={{ ...TEXT.xs, color: C.danger }}>🔒 נעול — לא ניתן לבקש</div>
                  ) : (
                    !req && <div style={{ ...TEXT.xs, color: C.textDisabled }}>נפתח בהמשך</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Summary row */}
          {myRequests.some(r => r.seasonId === selectedSeason.id) && (
            <div style={{ marginTop: SP[4], padding: `${SP[3]} ${SP[4]}`, background: C.bgNested, borderRadius: RADIUS.lg, display: 'flex', gap: SP[3], flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ ...TEXT.sm, color: C.textMuted }}>הבקשות שלי:</span>
              {myRequests.filter(r => r.seasonId === selectedSeason.id).map(r => (
                <span key={r.id} style={{
                  ...TEXT.xs, fontWeight: WEIGHT.semibold, padding: '3px 10px', borderRadius: RADIUS.full,
                  background: r.kind === 'leave' ? C.successBg : C.infoBg,
                  color: r.kind === 'leave' ? C.success : C.info,
                  border: `1px solid ${r.kind === 'leave' ? C.success : C.info}33`,
                }}>
                  {fmt(r.date)} — {r.kind === 'leave' ? 'חופשה' : 'עבודה'}
                  {r.status !== 'PENDING' && ` (${STATUS_META[r.status].label})`}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Free-form request ── */}
      <div style={{ background: C.bgCard, borderRadius: RADIUS['2xl'], border: `1px solid ${C.border}`, padding: SP[5], boxShadow: SHADOW.sm }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], marginBottom: SP[4] }}>
          <span style={{ fontSize: '18px' }}>📝</span>
          <span style={{ ...TEXT.lg, fontWeight: WEIGHT.semibold }}>בקשה לתאריך אחר</span>
        </div>
        <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>תאריך</div>
            <input type="date" value={freeDate} onChange={e => setFreeDate(e.target.value)}
              style={{ padding: '7px 12px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textPrimary, ...TEXT.sm, outline: 'none', fontFamily: FONT }} />
          </div>
          <div>
            <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>סוג</div>
            <div style={{ display: 'flex', gap: '4px', background: C.bgNested, padding: '4px', borderRadius: RADIUS.md, border: `1px solid ${C.border}` }}>
              {(['leave', 'work'] as const).map(k => (
                <button key={k} onClick={() => setFreeKind(k)}
                  style={{
                    padding: '5px 14px', borderRadius: RADIUS.sm, border: 'none', cursor: 'pointer',
                    background: freeKind === k ? C.bgCard : 'transparent',
                    color: freeKind === k ? C.textPrimary : C.textMuted,
                    ...TEXT.xs, fontWeight: freeKind === k ? WEIGHT.semibold : WEIGHT.normal,
                    boxShadow: freeKind === k ? SHADOW.xs : 'none', transition: EASE.fast,
                  }}>
                  {k === 'leave' ? '🏖 חופשה' : '💼 עבודה'}
                </button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: '160px' }}>
            <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>סיבה (אופציונלי)</div>
            <input type="text" placeholder="חופשה משפחתית, אירוע..." value={freeReason} onChange={e => setFreeReason(e.target.value)}
              style={{ width: '100%', padding: '7px 12px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textPrimary, ...TEXT.sm, outline: 'none', fontFamily: FONT, boxSizing: 'border-box' }} />
          </div>
          <button onClick={submitFree} disabled={!freeDate || freeSaving}
            style={{
              padding: '8px 20px', borderRadius: RADIUS.md, cursor: freeDate ? 'pointer' : 'not-allowed',
              background: freeDate ? C.brand : C.bgNested,
              color: freeDate ? 'white' : C.textDisabled,
              border: 'none', ...TEXT.sm, fontWeight: WEIGHT.semibold, transition: EASE.fast,
            }}>
            {freeSaving ? '...' : 'שלח'}
          </button>
        </div>

        {/* Free requests list */}
        {freeRequests.length > 0 && (
          <div style={{ marginTop: SP[4], display: 'flex', flexDirection: 'column', gap: SP[2] }}>
            <div style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.semibold }}>בקשות חופשה חופשיות:</div>
            {freeRequests.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: SP[3], padding: `${SP[2]} ${SP[3]}`, background: C.bgNested, borderRadius: RADIUS.lg, border: `1px solid ${C.border}` }}>
                <span>{r.kind === 'leave' ? '🏖' : '💼'}</span>
                <span style={{ ...TEXT.sm, fontWeight: WEIGHT.medium }}>{fmt(r.date)}</span>
                {r.reason && <span style={{ ...TEXT.sm, color: C.textMuted }}>{r.reason}</span>}
                <span style={{ marginRight: 'auto', ...TEXT.xs, fontWeight: WEIGHT.semibold, color: STATUS_META[r.status].color, background: STATUS_META[r.status].bg, padding: '2px 8px', borderRadius: RADIUS.full, border: `1px solid ${STATUS_META[r.status].color}33` }}>
                  {STATUS_META[r.status].label}
                </span>
                {r.status === 'PENDING' && (
                  <button onClick={() => cancelFree(r.id)}
                    style={{ ...TEXT.xs, color: C.danger, background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>
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
