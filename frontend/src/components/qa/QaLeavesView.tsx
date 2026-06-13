import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../../theme';
import { QaSeasonsView } from './QaSeasonsView';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// ── Types ─────────────────────────────────────────────────────────────────────

type ApprovalStatus = 'PENDING' | 'APPROVED' | 'DECLINED';

interface LeaveRequest {
  id: string;
  date: string;
  kind: 'leave' | 'work';
  reason?: string;
  status: ApprovalStatus;
  seasonId?: string;
  season?: { id: string; name: string };
  user: { id: string; fullName: string; email: string };
}

interface Season {
  id: string;
  name: string;
  dateRange: string;
  isActive: boolean;
  sortOrder: number;
}

interface Props {
  role?: string;
  token?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', weekday: 'short' });

const STATUS_META: Record<ApprovalStatus, { label: string; color: string; bg: string; border: string }> = {
  PENDING:  { label: 'ממתין לאישור', color: C.warning, bg: C.warningBg, border: `${C.warning}33` },
  APPROVED: { label: 'מאושר',        color: C.success, bg: C.successBg, border: `${C.success}33` },
  DECLINED: { label: 'נדחה',         color: C.danger,  bg: C.dangerBg,  border: `${C.danger}33`  },
};

type FilterStatus = 'all' | ApprovalStatus;

// ── Component ─────────────────────────────────────────────────────────────────

export const QaLeavesView: React.FC<Props> = ({ role, token }) => {
  const isAdmin = role === 'ADMIN';
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const [requests, setRequests]       = useState<LeaveRequest[]>([]);
  const [seasons, setSeasons]         = useState<Season[]>([]);
  const [loading, setLoading]         = useState(true);
  const [filterStatus, setFilter]     = useState<FilterStatus>('all');
  const [filterSeason, setFilterSeason] = useState<string>('all');
  const [filterUser, setFilterUser]   = useState<string>('all');
  const [saving, setSaving]           = useState<string | null>(null);
  const [mainTab, setMainTab]         = useState<'requests' | 'holidays'>('requests');

  // Report form (for all roles)
  const [showForm, setShowForm]         = useState(false);
  const [formDate, setFormDate]         = useState('');
  const [formReason, setFormReason]     = useState('');
  const [formSaving, setFormSaving]     = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [rRes, sRes] = await Promise.all([
        isAdmin
          ? axios.get(`${API}/leaves/requests`, { headers })
          : axios.get(`${API}/leaves/my-requests`, { headers }),
        axios.get(`${API}/leaves/seasons`, { headers }),
      ]);
      setRequests(rRes.data);
      setSeasons(sRes.data);
    } finally {
      setLoading(false);
    }
  }, [token, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id: string, status: 'APPROVED' | 'DECLINED') => {
    setSaving(id);
    try {
      const res = await axios.patch(`${API}/leaves/requests/${id}`, { status }, { headers });
      setRequests(prev => prev.map(r => r.id === id ? { ...r, status: res.data.status } : r));
    } finally { setSaving(null); }
  };

  const submitReport = async () => {
    if (!formDate || !token) return;
    setFormSaving(true);
    try {
      const res = await axios.post(`${API}/leaves/requests`, { date: formDate, kind: 'leave', reason: formReason || undefined }, { headers });
      setRequests(prev => [...prev, res.data]);
      setFormDate(''); setFormReason(''); setShowForm(false);
    } finally { setFormSaving(false); }
  };

  // Unique users from requests (for admin filter)
  const uniqueUsers = Array.from(
    new Map(requests.filter(r => r.user).map(r => [r.user.id, r.user])).values()
  );

  const filtered = requests.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (filterSeason !== 'all' && r.seasonId !== filterSeason) return false;
    if (isAdmin && filterUser !== 'all' && r.user?.id !== filterUser) return false;
    return true;
  });

  const counts = {
    pending:  requests.filter(r => r.status === 'PENDING').length,
    approved: requests.filter(r => r.status === 'APPROVED').length,
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, fontFamily: FONT }}>
        <div style={{ fontSize: '36px' }}>📅</div>
        <p style={{ marginTop: '12px' }}>טוען...</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', color: C.textPrimary }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP[4] }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SP[3] }}>
          <span style={{ fontSize: '22px' }}>📅</span>
          <div>
            <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold }}>
              {isAdmin ? 'ניהול חופשות' : 'לוח חופשות'}
            </div>
            <div style={{ ...TEXT.sm, color: C.textMuted }}>
              {isAdmin ? 'אישור ודחיית בקשות חופשה' : 'הגש בקשת חופשה וצפה בסטטוס'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: SP[2], alignItems: 'center' }}>
          {isAdmin && counts.pending > 0 && (
            <span style={{ background: C.warningBg, color: C.warning, border: `1px solid ${C.warning}33`, ...TEXT.xs, fontWeight: WEIGHT.bold, padding: '4px 12px', borderRadius: RADIUS.full }}>
              {counts.pending} ממתינים לאישור
            </span>
          )}
          {isAdmin && counts.approved > 0 && (
            <span style={{ background: C.successBg, color: C.success, border: `1px solid ${C.success}33`, ...TEXT.xs, fontWeight: WEIGHT.bold, padding: '4px 12px', borderRadius: RADIUS.full }}>
              {counts.approved} אושרו
            </span>
          )}
          <button
            onClick={() => setShowForm(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px', borderRadius: RADIUS.lg, cursor: 'pointer',
              background: showForm ? C.successBg : C.bgCard,
              border: `1px solid ${showForm ? C.success + '55' : C.border}`,
              color: showForm ? C.success : C.textPrimary,
              ...TEXT.sm, fontWeight: WEIGHT.semibold, transition: EASE.fast,
            }}
          >
            <span>📝</span><span>דווח חופשה</span>
          </button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: `2px solid ${C.border}`, marginBottom: SP[5] }}>
        {[
          { key: 'requests', label: '📋 בקשות חופשה' },
          ...(isAdmin ? [{ key: 'holidays', label: '🗓 מועדי חופשות' }] : []),
        ].map(t => (
          <button key={t.key} onClick={() => setMainTab(t.key as any)}
            style={{
              padding: '8px 18px', border: 'none', cursor: 'pointer', fontFamily: FONT,
              background: 'transparent', fontWeight: mainTab === t.key ? WEIGHT.bold : WEIGHT.normal,
              color: mainTab === t.key ? C.brand : C.textMuted,
              borderBottom: mainTab === t.key ? `2px solid ${C.brand}` : '2px solid transparent',
              marginBottom: '-2px', ...TEXT.sm, transition: EASE.fast,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {mainTab === 'holidays' && <QaSeasonsView token={token ?? ''} />}

      {mainTab === 'requests' && <>

      {/* ── Report form ── */}
      {showForm && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.success}33`, borderRadius: RADIUS['2xl'], padding: SP[5], marginBottom: SP[5], boxShadow: SHADOW.sm }}>
          <div style={{ ...TEXT.md, fontWeight: WEIGHT.semibold, marginBottom: SP[3] }}>בקשת חופשה חדשה</div>
          <div style={{ display: 'flex', gap: SP[3], alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>תאריך</div>
              <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                style={{ padding: '7px 12px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textPrimary, ...TEXT.sm, outline: 'none', fontFamily: FONT }} />
            </div>
            <div style={{ flex: 1, minWidth: '160px' }}>
              <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>סיבה (אופציונלי)</div>
              <input type="text" placeholder="חופשה משפחתית, חג..." value={formReason} onChange={e => setFormReason(e.target.value)}
                style={{ width: '100%', padding: '7px 12px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textPrimary, ...TEXT.sm, outline: 'none', fontFamily: FONT, boxSizing: 'border-box' }} />
            </div>
            <button onClick={submitReport} disabled={!formDate || formSaving}
              style={{ padding: '8px 20px', borderRadius: RADIUS.md, cursor: formDate ? 'pointer' : 'not-allowed', background: formDate ? C.success : C.bgNested, color: formDate ? 'white' : C.textDisabled, border: 'none', ...TEXT.sm, fontWeight: WEIGHT.semibold }}>
              {formSaving ? '...' : 'שלח בקשה'}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '8px 14px', borderRadius: RADIUS.md, cursor: 'pointer', background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}`, ...TEXT.sm }}>
              ביטול
            </button>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: SP[2], marginBottom: SP[4], flexWrap: 'wrap' }}>
        {/* Status filter */}
        <div style={{ display: 'flex', gap: '4px', background: C.bgNested, borderRadius: RADIUS.lg, padding: '4px', border: `1px solid ${C.border}` }}>
          {(['all', 'PENDING', 'APPROVED', 'DECLINED'] as FilterStatus[]).map(s => {
            const isActive = filterStatus === s;
            const label = s === 'all' ? 'הכל' : STATUS_META[s as ApprovalStatus]?.label ?? s;
            return (
              <button key={s} onClick={() => setFilter(s)}
                style={{ padding: '5px 12px', borderRadius: RADIUS.md, border: 'none', background: isActive ? C.bgCard : 'transparent', boxShadow: isActive ? SHADOW.xs : 'none', cursor: 'pointer', ...TEXT.xs, fontWeight: isActive ? WEIGHT.semibold : WEIGHT.normal, color: isActive ? C.textPrimary : C.textMuted, transition: EASE.fast, whiteSpace: 'nowrap' }}>
                {label}
              </button>
            );
          })}
        </div>

        {/* Season filter */}
        {seasons.length > 0 && (
          <select value={filterSeason} onChange={e => setFilterSeason(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgCard, color: C.textPrimary, ...TEXT.sm, cursor: 'pointer', outline: 'none', fontFamily: FONT }}>
            <option value="all">כל החופשות</option>
            {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="">ללא חופשה</option>
          </select>
        )}

        {/* User filter — admin only */}
        {isAdmin && uniqueUsers.length > 0 && (
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgCard, color: C.textPrimary, ...TEXT.sm, cursor: 'pointer', outline: 'none', fontFamily: FONT }}>
            <option value="all">כל העובדים</option>
            {uniqueUsers.map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
        )}
      </div>

      {/* ── Table ── */}
      <div style={{ background: C.bgCard, borderRadius: RADIUS['2xl'], border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: SHADOW.sm }}>

        {/* Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isAdmin ? '1.4fr 1.2fr 1fr 1.2fr 1.5fr 1fr' : '1.4fr 1fr 1.5fr 1.2fr 1fr',
          padding: `${SP[2]} ${SP[5]}`, borderBottom: `1px solid ${C.border}`, background: C.bgNested,
        }}>
          {[...(isAdmin ? ['עובד'] : []), 'תאריך', 'סוג', 'חופשה', 'סטטוס', 'פעולות'].map(h => (
            <span key={h} style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{h}</span>
          ))}
        </div>

        {filtered.length === 0 && (
          <div style={{ padding: SP[10], textAlign: 'center', color: C.textMuted, ...TEXT.sm }}>
            אין תוצאות
          </div>
        )}

        {filtered.map((req, i) => {
          const meta = STATUS_META[req.status];
          const isPending = req.status === 'PENDING';
          const isSaving  = saving === req.id;
          const cols = isAdmin
            ? '1.4fr 1.2fr 1fr 1.2fr 1.5fr 1fr'
            : '1.4fr 1fr 1.5fr 1.2fr 1fr';

          return (
            <div key={req.id} style={{
              display: 'grid', gridTemplateColumns: cols,
              padding: `${SP[3]} ${SP[5]}`,
              borderBottom: i < filtered.length - 1 ? `1px solid ${C.border}` : 'none',
              background: i % 2 === 0 ? C.bgCard : C.bgNested,
              alignItems: 'center', transition: EASE.fast,
            }}>

              {/* Employee (admin only) */}
              {isAdmin && (
                <div style={{ display: 'flex', alignItems: 'center', gap: SP[2] }}>
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    background: C.infoBg, border: `1px solid ${C.info}33`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.info, flexShrink: 0,
                  }}>
                    {req.user?.fullName?.charAt(0) ?? '?'}
                  </div>
                  <div>
                    <div style={{ ...TEXT.sm, fontWeight: WEIGHT.medium }}>{req.user?.fullName ?? '—'}</div>
                    <div style={{ ...TEXT.xs, color: C.textMuted }}>{req.user?.email ?? ''}</div>
                  </div>
                </div>
              )}

              {/* Date */}
              <span style={{ ...TEXT.sm, color: C.textSecondary }}>{fmt(req.date)}</span>

              {/* Kind */}
              <span style={{ ...TEXT.sm }}>
                {req.kind === 'leave' ? '🏖 חופשה' : '💼 עבודה'}
              </span>

              {/* Season / reason */}
              <div>
                {req.season?.name && (
                  <span style={{ ...TEXT.xs, color: C.info, background: C.infoBg, padding: '1px 7px', borderRadius: RADIUS.sm, display: 'inline-block' }}>
                    {req.season.name}
                  </span>
                )}
                {req.reason && (
                  <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: req.season ? '3px' : 0 }}>{req.reason}</div>
                )}
                {!req.season?.name && !req.reason && <span style={{ ...TEXT.sm, color: C.textDisabled }}>—</span>}
              </div>

              {/* Status badge */}
              <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: meta.color, background: meta.bg, border: `1px solid ${meta.border}`, padding: '3px 10px', borderRadius: RADIUS.full, display: 'inline-block' }}>
                {meta.label}
              </span>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '6px' }}>
                {isAdmin && isPending && (
                  <>
                    <button onClick={() => updateStatus(req.id, 'APPROVED')} disabled={isSaving}
                      style={{ background: C.successBg, color: C.success, border: `1px solid ${C.success}33`, borderRadius: RADIUS.sm, padding: '4px 10px', cursor: 'pointer', ...TEXT.xs, fontWeight: WEIGHT.semibold, transition: EASE.fast, opacity: isSaving ? 0.5 : 1 }}
                      onMouseEnter={e => e.currentTarget.style.background = C.success + '25'}
                      onMouseLeave={e => e.currentTarget.style.background = C.successBg}>
                      {isSaving ? '...' : 'אשר'}
                    </button>
                    <button onClick={() => updateStatus(req.id, 'DECLINED')} disabled={isSaving}
                      style={{ background: C.dangerBg, color: C.danger, border: `1px solid ${C.danger}33`, borderRadius: RADIUS.sm, padding: '4px 10px', cursor: 'pointer', ...TEXT.xs, fontWeight: WEIGHT.semibold, transition: EASE.fast, opacity: isSaving ? 0.5 : 1 }}
                      onMouseEnter={e => e.currentTarget.style.background = C.danger + '22'}
                      onMouseLeave={e => e.currentTarget.style.background = C.dangerBg}>
                      דחה
                    </button>
                  </>
                )}
                {!isAdmin && <span style={{ ...TEXT.xs, color: C.textDisabled }}>—</span>}
              </div>
            </div>
          );
        })}
      </div>

      </>}

    </div>
  );
};
