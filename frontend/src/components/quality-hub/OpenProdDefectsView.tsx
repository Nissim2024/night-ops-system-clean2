import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, RADIUS } from '../../theme';
import { Card, Badge } from '../ui';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// KPI 11 — "מצב תקלות ייצור פתוחות לאורך חודשים". Cross-release, all-history
// report (no version scoping) — matches the reference Power BI page, which
// filters by Responsibility/Status/Year/FixType/Type only, never by release.

interface OpenProdDefectMonthRow {
  monthDate: string;
  monthLabel: string;
  defectId: string;
  statusAtMonth: string;
  currentStatus: string;
  releaseId: string | null;
  severity: string | null;
  priority: string | null;
  responsibility: string | null;
  testPhase: string | null;
  detectedBy: string | null;
  detectedDate: string | null;
  reopenYn: string | null;
  area: string | null;
  bugType: string | null;
  fixType: string | null;
}

interface DefectStatusHistoryRow { status: string; changeTime: string; }

interface Props { token: string; }

const SEVERITY_COLOR: Record<string, string> = {
  'Show Stopper': C.danger,
  'Severe':       C.statusFailed,
  'Medium':       C.statusInProgress,
  'Low':          C.textMuted,
};

const KpiCard: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <Card padding={4} style={{ flex: 1, minWidth: '110px', textAlign: 'center' }}>
    <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, marginBottom: '4px', whiteSpace: 'nowrap' }}>{label}</div>
    <div style={{ fontSize: '32px', fontWeight: WEIGHT.bold, color, fontFamily: FONT, lineHeight: 1.1 }}>{value}</div>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
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

const MonthlyTrendChart: React.FC<{
  data: { monthLabel: string; count: number }[];
  selectedMonth: string | null;
  onSelectMonth: (m: string) => void;
}> = ({ data, selectedMonth, onSelectMonth }) => {
  if (data.length === 0) {
    return <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, padding: '20px', textAlign: 'center' }}>אין נתוני מגמה</div>;
  }
  const width = 760, height = 160, padX = 30, padY = 24;
  const max = Math.max(1, ...data.map(d => d.count));
  const stepX = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = padX + i * stepX;
    const y = height - padY - (d.count / max) * (height - padY * 2);
    return { x, y, d };
  });
  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <polyline points={polyline} fill="none" stroke={C.brand} strokeWidth={2} />
      {points.map((p, i) => {
        const isSelected = p.d.monthLabel === selectedMonth;
        return (
          <g key={i} style={{ cursor: 'pointer' }} onClick={() => onSelectMonth(p.d.monthLabel)}>
            <circle cx={p.x} cy={p.y} r={isSelected ? 6 : 3} fill={isSelected ? C.danger : C.brand} />
            <text x={p.x} y={p.y - 10} fontSize="14" fill={C.textPrimary} textAnchor="middle" fontFamily={FONT}>{p.d.count}</text>
            <text x={p.x} y={height - 4} fontSize="12" fill={isSelected ? C.danger : C.textMuted} fontWeight={isSelected ? 'bold' : 'normal'} textAnchor="middle" fontFamily={FONT}>
              {p.d.monthLabel}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

function groupCount(items: OpenProdDefectMonthRow[], keyFn: (r: OpenProdDefectMonthRow) => string | null) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item) || 'ללא סיווג';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export const OpenProdDefectsView: React.FC<Props> = ({ token }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [rows, setRows] = useState<OpenProdDefectMonthRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qcMock, setQcMock] = useState(true);

  const [fResponsibility, setFResponsibility] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fYear, setFYear] = useState('');
  const [fFixType, setFFixType] = useState('');
  const [fBugType, setFBugType] = useState('');

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedDefect, setSelectedDefect] = useState<string | null>(null);
  const [history, setHistory] = useState<DefectStatusHistoryRow[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    axios.get(`${API}/qc/status`, { headers })
      .then(r => setQcMock(!r.data?.enabled))
      .catch(() => setQcMock(true));
  }, [headers]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    axios.get(`${API}/qc/open-production-defects-history`, { headers })
      .then(r => setRows(r.data ?? []))
      .catch(err => setError(err?.response?.data?.message || 'שגיאה בטעינת נתוני תקלות ייצור'))
      .finally(() => setLoading(false));
  }, [headers]);

  // ── Filter option lists (derived from the full dataset, not the filtered one) ──
  const responsibilityOptions = useMemo(() => Array.from(new Set(rows.map(r => r.responsibility).filter(Boolean))).sort() as string[], [rows]);
  const statusOptions         = useMemo(() => Array.from(new Set(rows.map(r => r.statusAtMonth).filter(Boolean))).sort() as string[], [rows]);
  const yearOptions           = useMemo(() => Array.from(new Set(rows.map(r => r.monthLabel.slice(0, 4)).filter(Boolean))).sort() as string[], [rows]);
  const fixTypeOptions        = useMemo(() => Array.from(new Set(rows.map(r => r.fixType).filter(Boolean))).sort() as string[], [rows]);
  const bugTypeOptions        = useMemo(() => Array.from(new Set(rows.map(r => r.bugType).filter(Boolean))).sort() as string[], [rows]);

  const filteredRows = useMemo(() => rows.filter(r =>
    (!fResponsibility || r.responsibility === fResponsibility) &&
    (!fStatus || r.statusAtMonth === fStatus) &&
    (!fYear || r.monthLabel.startsWith(fYear)) &&
    (!fFixType || r.fixType === fFixType) &&
    (!fBugType || r.bugType === fBugType)
  ), [rows, fResponsibility, fStatus, fYear, fFixType, fBugType]);

  const monthlyTrend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of filteredRows) counts.set(r.monthLabel, (counts.get(r.monthLabel) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([monthLabel, count]) => ({ monthLabel, count }))
      .sort((a, b) => a.monthLabel.localeCompare(b.monthLabel));
  }, [filteredRows]);

  const latestMonth = monthlyTrend.length > 0 ? monthlyTrend[monthlyTrend.length - 1].monthLabel : null;
  const activeMonth = selectedMonth ?? latestMonth;

  const monthRows = useMemo(() => filteredRows.filter(r => r.monthLabel === activeMonth), [filteredRows, activeMonth]);

  const severityCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of monthRows) { const s = r.severity || 'ללא סיווג'; m.set(s, (m.get(s) ?? 0) + 1); }
    return m;
  }, [monthRows]);

  const openStatusHistory = useCallback((defectId: string) => {
    setSelectedDefect(defectId);
    setHistory(null);
    setHistoryLoading(true);
    axios.get(`${API}/qc/defect-status-history?defectId=${encodeURIComponent(defectId)}`, { headers })
      .then(r => setHistory(r.data ?? []))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [headers]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px 28px', fontFamily: FONT }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '27px' }}>📆</span>
          <div style={{ fontSize: '22px', fontWeight: WEIGHT.bold, color: C.textPrimary }}>תקלות ייצור פתוחות בכל חודש</div>
          {qcMock && (
            <span style={{ fontSize: '16px', background: C.bgInProgress, color: C.statusInProgress, padding: '3px 10px', borderRadius: '10px', border: `1px solid ${C.statusInProgress}44` }}>Mock — ממתין לחיבור QC</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <select value={fResponsibility} onChange={e => setFResponsibility(e.target.value)} style={selectStyle}>
            <option value="">Responsibility — הכל</option>
            {responsibilityOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={fStatus} onChange={e => setFStatus(e.target.value)} style={selectStyle}>
            <option value="">Status — הכל</option>
            {statusOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={fYear} onChange={e => setFYear(e.target.value)} style={selectStyle}>
            <option value="">Year — הכל</option>
            {yearOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={fFixType} onChange={e => setFFixType(e.target.value)} style={selectStyle}>
            <option value="">Fix Type — הכל</option>
            {fixTypeOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={fBugType} onChange={e => setFBugType(e.target.value)} style={selectStyle}>
            <option value="">Type — הכל</option>
            {bugTypeOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </Card>

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: C.textMuted }}>טוען...</div>}
      {error && <div style={{ textAlign: 'center', padding: '24px', color: C.danger }}>{error}</div>}

      {!loading && !error && (
        <>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <KpiCard label={`סה"כ (${activeMonth ?? '—'})`} value={String(monthRows.length)} color={C.textPrimary} />
            {(['Show Stopper', 'Severe', 'Medium', 'Low'] as const).map(s => (
              <KpiCard key={s} label={s} value={String(severityCounts.get(s) ?? 0)} color={SEVERITY_COLOR[s]} />
            ))}
          </div>

          <Card>
            <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, marginBottom: '8px' }}>
              מגמה חודשית — לחץ על נקודה כדי לראות את התקלות של אותו חודש
            </div>
            <MonthlyTrendChart data={monthlyTrend} selectedMonth={activeMonth} onSelectMonth={setSelectedMonth} />
          </Card>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <BreakdownPanel title="לפי חומרה" total={monthRows.length} rows={groupCount(monthRows, r => r.severity)} />
            <BreakdownPanel title="לפי מודול" total={monthRows.length} rows={groupCount(monthRows, r => r.area)} />
            <BreakdownPanel title="לפי צוות" total={monthRows.length} rows={groupCount(monthRows, r => r.responsibility)} />
            <BreakdownPanel title="לפי סוג תקלה" total={monthRows.length} rows={groupCount(monthRows, r => r.bugType)} />
          </div>

          <Card>
            <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, marginBottom: '10px' }}>
              תקלות פתוחות — {activeMonth ?? '—'} ({monthRows.length})
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', ...TEXT.xs, fontFamily: FONT }}>
                <thead>
                  <tr style={{ background: C.bgNested }}>
                    {['תקלה', 'חומרה', 'צוות', 'מודול', 'סוג', 'סטטוס', 'תאריך גילוי', 'Reopen'].map(h => (
                      <th key={h} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: WEIGHT.semibold, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthRows.map(r => (
                    <tr
                      key={r.defectId}
                      onClick={() => openStatusHistory(r.defectId)}
                      style={{ cursor: 'pointer', background: selectedDefect === r.defectId ? C.bgActive : 'transparent' }}
                    >
                      <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, color: C.textLink, fontWeight: WEIGHT.semibold }}>{r.defectId}</td>
                      <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, color: SEVERITY_COLOR[r.severity ?? ''] ?? C.textPrimary }}>{r.severity}</td>
                      <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{r.responsibility}</td>
                      <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{r.area}</td>
                      <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{r.bugType}</td>
                      <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{r.statusAtMonth}</td>
                      <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{r.detectedDate}</td>
                      <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{r.reopenYn}</td>
                    </tr>
                  ))}
                  {monthRows.length === 0 && (
                    <tr><td colSpan={8} style={{ padding: '14px', textAlign: 'center', color: C.textMuted }}>אין תקלות פתוחות בחודש זה</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {selectedDefect && (
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>היסטוריית סטטוסים — תקלה {selectedDefect}</div>
                <button onClick={() => setSelectedDefect(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '17px' }}>✕</button>
              </div>
              {historyLoading && <div style={{ color: C.textMuted, ...TEXT.xs }}>טוען...</div>}
              {!historyLoading && history && history.length === 0 && (
                <div style={{ color: C.textMuted, ...TEXT.xs }}>אין היסטוריית סטטוסים זמינה לתקלה זו</div>
              )}
              {!historyLoading && history && history.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {history.map((h, i) => (
                    <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'center', ...TEXT.xs }}>
                      <span style={{ color: C.textMuted, width: '160px', flexShrink: 0 }}>{new Date(h.changeTime).toLocaleString('he-IL')}</span>
                      <span style={{ fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{h.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
};

const selectStyle: React.CSSProperties = {
  padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md,
  fontSize: '17px', background: C.bgCard, color: C.textPrimary, fontFamily: FONT, minWidth: '150px',
};

export default OpenProdDefectsView;
