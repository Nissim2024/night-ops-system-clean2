import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { QaSeasonsView } from './QaSeasonsView';
import { DateField } from '../DatePicker';
import { formatDate } from '../../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// ── Types ─────────────────────────────────────────────────────────────────────

type ApprovalStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'CANCELLED';

interface LeaveRequest {
  id: string;
  date: string;
  kind: 'leave' | 'work';
  reason?: string;
  status: ApprovalStatus;
  seasonId?: string;
  season?: { id: string; name: string };
  user: { id: string; fullName: string; email: string };
  groupId?: string | null;
  decidedByName?: string | null;
  decidedAt?: string | null;
  cancelledByName?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
}

// A leave range is submitted as one LeaveRequest row per day, sharing one
// groupId (see EmployeeLeavesView.applyRange). Collapse those rows into a
// single displayed range so a manager approves/declines the whole range in
// one action instead of once per day.
interface DisplayRow {
  key: string;
  ids: string[];
  representativeId: string;
  user: LeaveRequest['user'];
  dates: string[]; // sorted ascending
  kind: 'leave' | 'work';
  season?: LeaveRequest['season'];
  seasonId?: string;
  reason?: string;
  status: ApprovalStatus;
  decidedByName?: string | null;
  decidedAt?: string | null;
  cancelledByName?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
}

function buildDisplayRows(reqs: LeaveRequest[]): DisplayRow[] {
  const byGroup = new Map<string, LeaveRequest[]>();
  const rows: DisplayRow[] = [];
  for (const r of reqs) {
    if (r.groupId) {
      if (!byGroup.has(r.groupId)) byGroup.set(r.groupId, []);
      byGroup.get(r.groupId)!.push(r);
    } else {
      rows.push({
        key: r.id, ids: [r.id], representativeId: r.id, user: r.user, dates: [r.date],
        kind: r.kind, season: r.season, seasonId: r.seasonId, reason: r.reason, status: r.status,
        decidedByName: r.decidedByName, decidedAt: r.decidedAt,
        cancelledByName: r.cancelledByName, cancelledAt: r.cancelledAt, cancelReason: r.cancelReason,
      });
    }
  }
  Array.from(byGroup.entries()).forEach(([groupId, list]) => {
    const sorted = [...list].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const rep = sorted[0];
    rows.push({
      key: groupId, ids: sorted.map(r => r.id), representativeId: rep.id, user: rep.user,
      dates: sorted.map(r => r.date), kind: rep.kind, season: rep.season,
      seasonId: rep.seasonId, reason: rep.reason, status: rep.status,
      decidedByName: rep.decidedByName, decidedAt: rep.decidedAt,
      cancelledByName: rep.cancelledByName, cancelledAt: rep.cancelledAt, cancelReason: rep.cancelReason,
    });
  });
  rows.sort((a, b) => new Date(a.dates[0]).getTime() - new Date(b.dates[0]).getTime());
  return rows;
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

const LEAVE_DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
// Unified DD/MM/YYYY date (2026-08-31 spec) — weekday kept: knowing which
// day of week a leave request falls on is genuinely useful scheduling
// context, not just a stylistic date-format difference.
const fmt = (d: string) => `יום ${LEAVE_DOW[new Date(d).getDay()]}, ${formatDate(d)}`;

const STATUS_META: Record<ApprovalStatus, { label: string; className: string }> = {
  PENDING:   { label: 'ממתין לאישור', className: 'text-warning bg-warning-bg border-warning/20' },
  APPROVED:  { label: 'מאושר',        className: 'text-success bg-success-bg border-success/20' },
  DECLINED:  { label: 'נדחה',         className: 'text-danger bg-danger-bg border-danger/20' },
  CANCELLED: { label: 'בוטל',         className: 'text-subtle-foreground bg-muted border-border' },
};

type FilterStatus = 'all' | ApprovalStatus;

// ── Component ─────────────────────────────────────────────────────────────────

export const QaLeavesView: React.FC<Props> = ({ role, token }) => {
  const isAdmin = role === 'ADMIN' || role === 'TEAM_LEAD'; // can view team/all requests + approve/decline
  const isFullAdmin = role === 'ADMIN'; // season/holiday definitions stay admin-only
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

  // Backend cascades the status to every sibling row sharing the same groupId
  // (see LeavesService.updateRequestStatus) — reload the full list rather than
  // patching just the one id locally, so the whole range reflects the new status.
  const updateStatus = async (row: DisplayRow, status: 'APPROVED' | 'DECLINED') => {
    setSaving(row.key);
    try {
      await axios.patch(`${API}/leaves/requests/${row.representativeId}`, { status }, { headers });
      setRequests(prev => prev.map(r => row.ids.includes(r.id) ? { ...r, status } : r));
    } finally { setSaving(null); }
  };

  // Manager-initiated cancel — allowed on PENDING or already-APPROVED leave.
  // Reload rather than patch locally: the backend cascades to every sibling
  // row sharing the range's groupId (see LeavesService.applyCancellation).
  const cancelRow = async (row: DisplayRow) => {
    if (row.status === 'APPROVED' && !window.confirm('לבטל חופשה שכבר אושרה לעובד?')) return;
    const reason = window.prompt('סיבת ביטול (לא חובה):');
    if (reason === null) return;
    setSaving(row.key);
    try {
      await axios.patch(`${API}/leaves/requests/${row.representativeId}`, { status: 'CANCELLED', reason: reason || undefined }, { headers });
      await load();
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

  const displayRows = buildDisplayRows(filtered);

  // Counted by range (display row), not by day — a 10-day pending request
  // reads as "1 ממתין", matching what the manager actually needs to act on.
  const allDisplayRows = buildDisplayRows(requests);
  const counts = {
    pending:  allDisplayRows.filter(r => r.status === 'PENDING').length,
    approved: allDisplayRows.filter(r => r.status === 'APPROVED').length,
  };

  if (loading) {
    return (
      <div className="text-center p-[60px] text-subtle-foreground">
        <div className="text-4xl">📅</div>
        <p className="mt-3">טוען...</p>
      </div>
    );
  }

  return (
    <div className="text-foreground">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-[22px]">📅</span>
          <div>
            <div className="text-xl font-bold">
              {isAdmin ? 'ניהול חופשות' : 'לוח חופשות'}
            </div>
            <div className="text-sm text-subtle-foreground">
              {isAdmin ? 'אישור ודחיית בקשות חופשה' : 'הגש בקשת חופשה וצפה בסטטוס'}
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {isAdmin && counts.pending > 0 && (
            <span className="bg-warning-bg text-warning border border-warning/20 text-xs font-bold px-3 py-1 rounded-full">
              {counts.pending} ממתינים לאישור
            </span>
          )}
          {isAdmin && counts.approved > 0 && (
            <span className="bg-success-bg text-success border border-success/20 text-xs font-bold px-3 py-1 rounded-full">
              {counts.approved} אושרו
            </span>
          )}
          <button
            onClick={() => setShowForm(v => !v)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg cursor-pointer text-sm font-semibold border transition-[background-color,border-color,color] duration-fast ease-out ${showForm ? 'bg-success-bg border-success/40 text-success' : 'bg-card border-border text-foreground'}`}
          >
            <span>📝</span><span>דווח חופשה</span>
          </button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-1 border-b-2 border-border mb-5">
        {[
          { key: 'requests', label: '📋 בקשות חופשה' },
          ...(isFullAdmin ? [{ key: 'holidays', label: '🗓 מועדי חופשות' }] : []),
        ].map(t => (
          <button key={t.key} onClick={() => setMainTab(t.key as any)}
            className={`px-[18px] py-2 border-0 border-b-2 -mb-0.5 cursor-pointer bg-transparent text-sm transition-[color,border-color] duration-fast ease-out ${mainTab === t.key ? 'font-bold text-primary border-primary' : 'font-normal text-subtle-foreground border-transparent'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {mainTab === 'holidays' && <QaSeasonsView token={token ?? ''} />}

      {mainTab === 'requests' && <>

      {/* ── Report form ── */}
      {showForm && (
        <div className="bg-card border border-success/20 rounded-2xl p-5 mb-5 shadow-sm">
          <div className="text-md font-semibold mb-3">בקשת חופשה חדשה</div>
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <div className="text-xs text-subtle-foreground mb-1">תאריך</div>
              {/* DateField only accepts a `style` prop (no className) — left as inline
                  style, unchanged from before, matching its existing look. */}
              <DateField value={formDate} onChange={v => setFormDate(v)}
                style={{ padding: '7px 12px', borderRadius: '8px', border: '1px solid #E5E7EE', background: '#F1F2F7', color: '#14152A', fontSize: '17px', lineHeight: '24px', outline: 'none' }} />
            </div>
            <div className="flex-1 min-w-[160px]">
              <div className="text-xs text-subtle-foreground mb-1">סיבה (אופציונלי)</div>
              <input type="text" placeholder="חופשה משפחתית, חג..." value={formReason} onChange={e => setFormReason(e.target.value)}
                className="w-full px-3 py-[7px] rounded-md border border-border bg-muted text-foreground text-sm outline-none box-border" />
            </div>
            <button onClick={submitReport} disabled={!formDate || formSaving}
              className={`px-5 py-2 rounded-md border-none text-sm font-semibold ${formDate ? 'cursor-pointer bg-success text-white' : 'cursor-not-allowed bg-muted text-subtle-foreground'}`}>
              {formSaving ? '...' : 'שלח בקשה'}
            </button>
            <button onClick={() => setShowForm(false)}
              className="px-3.5 py-2 rounded-md cursor-pointer bg-transparent text-subtle-foreground border border-border text-sm">
              ביטול
            </button>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {/* Status filter */}
        <div className="flex gap-1 bg-muted rounded-lg p-1 border border-border">
          {(['all', 'PENDING', 'APPROVED', 'DECLINED', 'CANCELLED'] as FilterStatus[]).map(s => {
            const isActive = filterStatus === s;
            const label = s === 'all' ? 'הכל' : STATUS_META[s as ApprovalStatus]?.label ?? s;
            return (
              <button key={s} onClick={() => setFilter(s)}
                className={`px-3 py-[5px] rounded-md border-none cursor-pointer text-xs whitespace-nowrap transition-[background-color,box-shadow] duration-fast ease-out ${isActive ? 'bg-card shadow-xs font-semibold text-foreground' : 'bg-transparent font-normal text-subtle-foreground'}`}>
                {label}
              </button>
            );
          })}
        </div>

        {/* Season filter */}
        {seasons.length > 0 && (
          <select value={filterSeason} onChange={e => setFilterSeason(e.target.value)}
            className="px-3 py-1.5 rounded-md border border-border bg-card text-foreground text-sm cursor-pointer outline-none">
            <option value="all">כל החופשות</option>
            {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="">ללא חופשה</option>
          </select>
        )}

        {/* User filter — admin only */}
        {isAdmin && uniqueUsers.length > 0 && (
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)}
            className="px-3 py-1.5 rounded-md border border-border bg-card text-foreground text-sm cursor-pointer outline-none">
            <option value="all">כל העובדים</option>
            {uniqueUsers.map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
        )}
      </div>

      {/* ── Table ── */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">

        {/* Header */}
        <div
          className="grid px-5 py-2 border-b border-border bg-muted"
          style={{ gridTemplateColumns: isAdmin ? '1.4fr 1.2fr 1fr 1.2fr 1.5fr 1fr' : '1.4fr 1fr 1.5fr 1.2fr 1fr' }}
        >
          {[...(isAdmin ? ['עובד'] : []), 'תאריך', 'סוג', 'חופשה', 'סטטוס', 'פעולות'].map(h => (
            <span key={h} className="text-xs font-bold text-subtle-foreground uppercase tracking-wide">{h}</span>
          ))}
        </div>

        {displayRows.length === 0 && (
          <div className="p-10 text-center text-subtle-foreground text-sm">
            אין תוצאות
          </div>
        )}

        {displayRows.map((row, i) => {
          const meta = STATUS_META[row.status];
          const isPending = row.status === 'PENDING';
          const isSaving  = saving === row.key;
          const isRange   = row.dates.length > 1;
          const cols = isAdmin
            ? '1.4fr 1.2fr 1fr 1.2fr 1.5fr 1fr'
            : '1.4fr 1fr 1.5fr 1.2fr 1fr';

          return (
            <div key={row.key}
              className={`grid px-5 py-3 items-center transition-[background-color] duration-fast ease-out ${i < displayRows.length - 1 ? 'border-b border-border' : ''} ${i % 2 === 0 ? 'bg-card' : 'bg-muted'}`}
              style={{ gridTemplateColumns: cols }}
            >

              {/* Employee (admin only) */}
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-info-bg border border-info/20 flex items-center justify-center text-xs font-bold text-info shrink-0">
                    {row.user?.fullName?.charAt(0) ?? '?'}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{row.user?.fullName ?? '—'}</div>
                    <div className="text-xs text-subtle-foreground">{row.user?.email ?? ''}</div>
                  </div>
                </div>
              )}

              {/* Date (range if submitted together) */}
              <span className="text-sm text-muted-foreground">
                {isRange
                  ? `${fmt(row.dates[0])} – ${fmt(row.dates[row.dates.length - 1])} (${row.dates.length} ימים)`
                  : fmt(row.dates[0])}
              </span>

              {/* Kind */}
              <span className="text-sm">
                {row.kind === 'leave' ? '🏖 חופשה' : '💼 עבודה'}
              </span>

              {/* Season / reason */}
              <div>
                {row.season?.name && (
                  <span className="text-xs text-info bg-info-bg px-[7px] py-px rounded-sm inline-block">
                    {row.season.name}
                  </span>
                )}
                {row.reason && (
                  <div className={`text-xs text-subtle-foreground ${row.season ? 'mt-[3px]' : 'mt-0'}`}>{row.reason}</div>
                )}
                {!row.season?.name && !row.reason && <span className="text-sm text-subtle-foreground">—</span>}
              </div>

              {/* Status badge + audit trail (who decided/cancelled it, and when) */}
              <div>
                <span className={`text-xs font-semibold px-2.5 py-[3px] rounded-full inline-block border ${meta.className}`}>
                  {meta.label}
                </span>
                {row.status === 'CANCELLED' && row.cancelledByName && (
                  <div className="text-xs text-subtle-foreground mt-[3px]">
                    ע"י {row.cancelledByName}{row.cancelReason ? ` — ${row.cancelReason}` : ''}
                  </div>
                )}
                {(row.status === 'APPROVED' || row.status === 'DECLINED') && row.decidedByName && (
                  <div className="text-xs text-subtle-foreground mt-[3px]">
                    ע"י {row.decidedByName}
                  </div>
                )}
              </div>

              {/* Actions — approving/declining/cancelling a range acts on all its days in one call */}
              <div className="flex gap-1.5">
                {isAdmin && isPending && (
                  <>
                    <button onClick={() => updateStatus(row, 'APPROVED')} disabled={isSaving}
                      className={`bg-success-bg hover:bg-success/25 text-success border border-success/20 rounded-sm px-2.5 py-1 cursor-pointer text-xs font-semibold transition-[background-color] duration-fast ease-out ${isSaving ? 'opacity-50' : 'opacity-100'}`}>
                      {isSaving ? '...' : (isRange ? 'אשר טווח' : 'אשר')}
                    </button>
                    <button onClick={() => updateStatus(row, 'DECLINED')} disabled={isSaving}
                      className={`bg-danger-bg hover:bg-danger/20 text-danger border border-danger/20 rounded-sm px-2.5 py-1 cursor-pointer text-xs font-semibold transition-[background-color] duration-fast ease-out ${isSaving ? 'opacity-50' : 'opacity-100'}`}>
                      דחה
                    </button>
                  </>
                )}
                {isAdmin && (row.status === 'PENDING' || row.status === 'APPROVED') && (
                  <button onClick={() => cancelRow(row)} disabled={isSaving}
                    className={`bg-transparent text-subtle-foreground border border-border rounded-sm px-2.5 py-1 cursor-pointer text-xs font-semibold transition-[background-color] duration-fast ease-out ${isSaving ? 'opacity-50' : 'opacity-100'}`}>
                    {isSaving ? '...' : 'בטל'}
                  </button>
                )}
                {!isAdmin && <span className="text-xs text-subtle-foreground">—</span>}
              </div>
            </div>
          );
        })}
      </div>

      </>}

    </div>
  );
};
