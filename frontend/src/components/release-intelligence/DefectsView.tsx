import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';
import { DefectDrilldownModal } from './DefectDrilldownModal';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Bucket { label: string; count: number; }
interface Defects {
  kpis: { open: number; fixed: number; closed: number; rejected: number; reopen: number };
  bySeverity: Bucket[]; byStatus: Bucket[]; byTeam: Bucket[]; byProject: Bucket[];
}

function KpiCard({ value, label, valueColor, onClick }: { value: string; label: string; valueColor?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', flex: 1, minWidth: '140px', cursor: onClick ? 'pointer' : 'default' }}
    >
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: valueColor ?? C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
    </div>
  );
}

const BreakdownPanel: React.FC<{ title: string; rows: Bucket[]; onBarClick: (label: string) => void }> = ({ title, rows, onBarClick }) => {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], flex: 1, minWidth: '280px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP[3] }}>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{title}</div>
        <span style={{ ...TEXT.xs, color: C.textMuted, background: C.bgNested, borderRadius: RADIUS.full, padding: '2px 8px' }}>{rows.reduce((s, r) => s + r.count, 0)}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '240px', overflowY: 'auto' }}>
        {rows.length === 0 && <div style={{ ...TEXT.xs, color: C.textMuted }}>אין נתונים</div>}
        {rows.map(r => (
          <div key={r.label} onClick={() => onBarClick(r.label)} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <div style={{ ...TEXT.xs, color: C.textSecondary, width: '140px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</div>
            <div style={{ flex: 1, height: '14px', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden' }}>
              <div style={{ width: `${(r.count / max) * 100}%`, height: '100%', background: C.brand, borderRadius: RADIUS.sm }} />
            </div>
            <div style={{ ...TEXT.xs, color: C.textPrimary, width: '24px', textAlign: 'left' }}>{r.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

interface Props {
  token: string; versionId?: string; role: string;
  // Set when navigation into this screen already carries intent (e.g. the
  // Home page's "תקלות פתוחות" tile) — opens straight into the filtered list
  // instead of landing on the KPI overview and requiring a second click
  // (spec confirmed 2026-08-31).
  autoOpenDrilldown?: { filter: string; value?: string; title: string } | null;
}

export const DefectsView: React.FC<Props> = ({ token, versionId, autoOpenDrilldown }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<Defects | null>(null);
  const [loading, setLoading] = useState(false);
  const [drilldown, setDrilldown] = useState<{ filter: string; value?: string; title: string } | null>(autoOpenDrilldown ?? null);

  const load = useCallback(() => {
    if (!versionId) { setData(null); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/defects/${versionId}`, { headers })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);

  useEffect(() => { load(); }, [load]);

  if (!versionId) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>טוען...</div>;
  if (!data) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🐞 באגים</div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <KpiCard value={String(data.kpis.open)} label="Open" valueColor={data.kpis.open > 0 ? C.danger : C.success} onClick={() => setDrilldown({ filter: 'kpi', value: 'open', title: 'תקלות פתוחות (Open)' })} />
        <KpiCard value={String(data.kpis.fixed)} label="Fixed" valueColor={C.success} onClick={() => setDrilldown({ filter: 'kpi', value: 'fixed', title: 'תקלות שתוקנו (Fixed)' })} />
        <KpiCard value={String(data.kpis.closed)} label="Closed" onClick={() => setDrilldown({ filter: 'kpi', value: 'closed', title: 'תקלות סגורות (Closed)' })} />
        <KpiCard value={String(data.kpis.rejected)} label="Rejected" onClick={() => setDrilldown({ filter: 'kpi', value: 'rejected', title: 'תקלות שנדחו (Rejected)' })} />
        <KpiCard value={String(data.kpis.reopen)} label="Reopen" valueColor={data.kpis.reopen > 0 ? '#e8af00' : C.success} onClick={() => setDrilldown({ filter: 'kpi', value: 'reopen', title: 'תקלות שנפתחו מחדש (Reopen)' })} />
      </div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <BreakdownPanel title="לפי חומרה" rows={data.bySeverity} onBarClick={label => setDrilldown({ filter: 'severity', value: label, title: `תקלות פתוחות — חומרה: ${label}` })} />
        <BreakdownPanel title="לפי סטטוס" rows={data.byStatus} onBarClick={label => setDrilldown({ filter: 'status', value: label, title: `תקלות — סטטוס: ${label}` })} />
        <BreakdownPanel title="לפי צוות" rows={data.byTeam} onBarClick={label => setDrilldown({ filter: 'team', value: label, title: `תקלות פתוחות — צוות: ${label}` })} />
        <BreakdownPanel title="לפי פרויקט" rows={data.byProject} onBarClick={label => setDrilldown({ filter: 'project', value: label, title: `תקלות פתוחות — פרויקט: ${label}` })} />
      </div>

      {drilldown && (
        <DefectDrilldownModal
          token={token}
          versionId={versionId}
          screen="defects"
          filter={drilldown.filter}
          value={drilldown.value}
          title={drilldown.title}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
};
