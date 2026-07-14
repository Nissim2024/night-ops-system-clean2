import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, RADIUS } from '../../theme';
import { Card, Badge } from '../ui';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Version { id: string; name: string; status: string; isArchived: boolean; }

interface BugDashboardDto {
  reported: number;
  open: number;
  rejected: number;
  production: number;
  regression: number;
  changes: number;
  reopen: number;
  targetTotal: number;
  targetOpen: number;
  dailyReported: { date: string; count: number }[];
  openByType: { label: string; count: number }[];
  openByResponsibility: { label: string; count: number }[];
  openByCr: { label: string; count: number }[];
}

interface Props { token: string; initialVersionId?: string; }

const pct = (n: number, total: number) => total > 0 ? `${((n / total) * 100).toFixed(2)}%` : '0%';

const KpiCard: React.FC<{ label: string; value: string; sub?: string; color: string }> = ({ label, value, sub, color }) => (
  <Card padding={4} style={{ flex: 1, minWidth: '110px', textAlign: 'center' }}>
    <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, marginBottom: '4px', whiteSpace: 'nowrap' }}>{label}</div>
    <div style={{ fontSize: '26px', fontWeight: WEIGHT.bold, color, fontFamily: FONT, lineHeight: 1.1 }}>{value}</div>
    {sub && <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, marginTop: '2px' }}>{sub}</div>}
  </Card>
);

const BreakdownPanel: React.FC<{ title: string; total: number; rows: { label: string; count: number }[] }> = ({ title, total, rows }) => {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <Card padding={4} style={{ flex: 1, minWidth: '260px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, fontFamily: FONT }}>{title}</div>
        <Badge color={C.textMuted} bg={C.bgHover}>{total}</Badge>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '260px', overflowY: 'auto' }}>
        {rows.length === 0 && <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>אין נתונים</div>}
        {rows.map(r => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ ...TEXT.xs, color: C.textSecondary, fontFamily: FONT, width: '140px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</div>
            <div style={{ flex: 1, height: '14px', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden' }}>
              <div style={{ width: `${(r.count / max) * 100}%`, height: '100%', background: C.brand, borderRadius: RADIUS.sm }} />
            </div>
            <div style={{ ...TEXT.xs, color: C.textPrimary, fontFamily: FONT, width: '24px', textAlign: 'left' }}>{r.count}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

const DailyTrendChart: React.FC<{ data: { date: string; count: number }[] }> = ({ data }) => {
  if (data.length === 0) {
    return <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, padding: '20px', textAlign: 'center' }}>אין נתוני מגמה</div>;
  }
  const width = 720, height = 140, padX = 30, padY = 20;
  const max = Math.max(1, ...data.map(d => d.count));
  const stepX = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = padX + i * stepX;
    const y = height - padY - (d.count / max) * (height - padY * 2);
    return { x, y, d };
  });
  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <polyline points={polyline} fill="none" stroke={C.brand} strokeWidth={2} />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} fill={C.brand} />
          <text x={p.x} y={p.y - 8} fontSize="11" fill={C.textPrimary} textAnchor="middle" fontFamily={FONT}>{p.d.count}</text>
          {i % labelEvery === 0 && (
            <text x={p.x} y={height - 4} fontSize="10" fill={C.textMuted} textAnchor="middle" fontFamily={FONT}>
              {new Date(p.d.date).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
};

export const QcBugDashboardView: React.FC<Props> = ({ token, initialVersionId }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [versions, setVersions] = useState<Version[]>([]);
  // Deliberately NOT falling back to localStorage — a manually-browsed
  // version shouldn't outlive the session and silently diverge from
  // whatever the global header shows on the next visit.
  const [selectedVId, setSelectedVId] = useState(() => initialVersionId ?? '');
  const [dashboard, setDashboard] = useState<BugDashboardDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qcMock, setQcMock] = useState(true);

  useEffect(() => {
    if (initialVersionId) setSelectedVId(initialVersionId);
  }, [initialVersionId]);

  useEffect(() => {
    axios.get(`${API}/versions`, { headers })
      .then(r => setVersions((r.data as Version[]).filter(v => !v.isArchived)))
      .catch(() => {});
  }, [headers]);

  useEffect(() => {
    axios.get(`${API}/qc/status`, { headers })
      .then(r => setQcMock(!r.data?.enabled))
      .catch(() => setQcMock(true));
  }, [headers]);

  const loadDashboard = useCallback(async (vId: string) => {
    if (!vId) { setDashboard(null); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API}/qc/bug-dashboard?versionId=${vId}`, { headers });
      setDashboard(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'שגיאה בטעינת נתוני QC');
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { loadDashboard(selectedVId); }, [selectedVId, loadDashboard]);

  const handleVersionChange = (vId: string) => {
    setSelectedVId(vId);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px 28px', fontFamily: FONT }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '22px' }}>🐛</span>
            <div style={{ fontSize: '18px', fontWeight: WEIGHT.bold, color: C.textPrimary }}>לוח באגים (QC)</div>
            {qcMock && (
              <span style={{ fontSize: '13px', background: C.bgInProgress, color: C.statusInProgress, padding: '3px 10px', borderRadius: '10px', border: `1px solid ${C.statusInProgress}44` }}>Mock — ממתין לחיבור QC</span>
            )}
          </div>
          <select
            value={selectedVId}
            onChange={e => handleVersionChange(e.target.value)}
            style={{ padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, fontSize: '15px', background: C.bgCard, color: C.textPrimary, fontFamily: FONT, minWidth: '220px' }}
          >
            <option value="">— בחר גרסה —</option>
            {versions.map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
      </Card>

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: C.textMuted }}>טוען...</div>}
      {error && <div style={{ textAlign: 'center', padding: '24px', color: C.danger }}>{error}</div>}
      {!loading && !error && !selectedVId && (
        <div style={{ textAlign: 'center', padding: '24px', color: C.textMuted }}>בחר גרסה כדי להציג נתוני באגים</div>
      )}

      {!loading && !error && dashboard && (
        <>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <KpiCard label="Reported Bugs" value={String(dashboard.reported)} color={C.textPrimary} />
            <KpiCard label="Open Bugs" value={String(dashboard.open)} sub={pct(dashboard.open, dashboard.reported)} color={C.statusInProgress} />
            <KpiCard label="Rejected Bugs" value={String(dashboard.rejected)} sub={pct(dashboard.rejected, dashboard.reported)} color={C.textMuted} />
            <KpiCard label="Production Bugs" value={String(dashboard.production)} sub={pct(dashboard.production, dashboard.reported)} color={C.danger} />
            <KpiCard label="Regression Bugs" value={String(dashboard.regression)} sub={pct(dashboard.regression, dashboard.reported)} color={C.danger} />
            <KpiCard label="Changes" value={String(dashboard.changes)} sub={pct(dashboard.changes, dashboard.reported)} color={C.brand} />
            <KpiCard label="Reopen Bugs" value={String(dashboard.reopen)} sub={pct(dashboard.reopen, dashboard.reported)} color={C.statusFailed} />
            <KpiCard label="Target Left" value={`${dashboard.targetOpen}/${dashboard.targetTotal}`} color={C.statusDone} />
          </div>

          <Card>
            <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, marginBottom: '8px' }}>Daily Reported</div>
            <DailyTrendChart data={dashboard.dailyReported} />
          </Card>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <BreakdownPanel title="Open By Type" total={dashboard.open} rows={dashboard.openByType} />
            <BreakdownPanel title="Open By Responsibility" total={dashboard.open} rows={dashboard.openByResponsibility} />
            <BreakdownPanel title="Open By CR Name" total={dashboard.open} rows={dashboard.openByCr} />
          </div>
        </>
      )}
    </div>
  );
};

export default QcBugDashboardView;
