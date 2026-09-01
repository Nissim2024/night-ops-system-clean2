import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW } from '../../theme';
import { DefectDrilldownModal } from './DefectDrilldownModal';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Risk {
  id: string; title: string; description?: string | null; severity: string;
  impact?: string | null; probability?: string | null; owner?: string | null;
  mitigation?: string | null; status: string; createdAt: string;
}

interface Overview {
  healthScore: number;
  coveragePct: number;
  criticalDefects: number;
  openRisksCount: number;
  daysToGoLive: number | null;
  forecastStatus: 'ON_TRACK' | 'AT_RISK' | 'BEHIND_PLAN';
  qgSummary: Record<string, { count: number; threshold: number }>;
  qgPass: boolean;
  topRisks: Risk[];
  criticalAlerts: { category: string; message: string }[];
  forecastWarnings: string[];
}

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: C.danger, HIGH: '#f0883e', MEDIUM: '#e8af00', LOW: C.textMuted,
};
const FORECAST_LABEL: Record<string, { label: string; color: string }> = {
  ON_TRACK:    { label: 'בקצב', color: C.success },
  AT_RISK:     { label: 'בסיכון', color: '#e8af00' },
  BEHIND_PLAN: { label: 'בחריגה', color: C.danger },
};

function KpiCard({ value, label, valueColor, onClick }: { value: string; label: string; valueColor?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '16px 20px', flex: 1, minWidth: '140px', cursor: onClick ? 'pointer' : undefined }}
    >
      <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, color: valueColor ?? C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
    </div>
  );
}

function Widget({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, boxShadow: SHADOW.sm, padding: SP[4], flex: 1, minWidth: '320px' }}>
      <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: SP[3] }}>{title}</div>
      {children}
    </div>
  );
}

interface Props { token: string; versionId?: string; role: string; }

const RISK_WRITERS = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];

export const ReleaseIntelligenceOverview: React.FC<Props> = ({ token, versionId, role }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [addingRisk, setAddingRisk] = useState(false);
  const [newRiskTitle, setNewRiskTitle] = useState('');
  const [newRiskSeverity, setNewRiskSeverity] = useState('MEDIUM');
  const [saving, setSaving] = useState(false);
  const [showDefectDrilldown, setShowDefectDrilldown] = useState(false);

  const canWriteRisks = RISK_WRITERS.includes(role);

  const load = useCallback(() => {
    if (!versionId) { setOverview(null); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/overview/${versionId}`, { headers })
      .then(res => setOverview(res.data))
      .catch(() => setOverview(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);

  useEffect(() => { load(); }, [load]);

  const submitRisk = async () => {
    if (!versionId || !newRiskTitle.trim()) return;
    setSaving(true);
    try {
      await axios.post(`${API}/release-intelligence/risks`, {
        versionId, title: newRiskTitle.trim(), severity: newRiskSeverity,
      }, { headers });
      setNewRiskTitle('');
      setNewRiskSeverity('MEDIUM');
      setAddingRisk(false);
      load();
    } catch (e) {
      console.error('failed to create risk', e);
    } finally {
      setSaving(false);
    }
  };

  if (!versionId) {
    return (
      <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>
        בחר גרסה מתפריט הצד כדי לראות את סקירת ה-Release Intelligence שלה.
      </div>
    );
  }

  if (loading && !overview) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>טוען...</div>;
  }

  if (!overview) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>לא ניתן לטעון נתונים עבור גרסה זו.</div>;
  }

  const forecast = FORECAST_LABEL[overview.forecastStatus];

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📊 סקירה כללית — Release Intelligence</div>

      {/* KPI row */}
      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <KpiCard value={String(overview.healthScore)} label="Release Health" valueColor={overview.healthScore >= 70 ? C.success : overview.healthScore >= 40 ? '#e8af00' : C.danger} />
        <KpiCard value={`${overview.coveragePct}%`} label="Coverage" />
        <KpiCard
          value={String(overview.criticalDefects)}
          label="Critical Defects"
          valueColor={overview.criticalDefects > 0 ? C.danger : C.success}
          onClick={() => setShowDefectDrilldown(true)}
        />
        <KpiCard value={String(overview.openRisksCount)} label="Open Risks" valueColor={overview.openRisksCount > 0 ? '#e8af00' : C.success} />
        <KpiCard value={overview.daysToGoLive !== null ? String(overview.daysToGoLive) : '—'} label="Days To Go Live" />
        <KpiCard value={forecast.label} label="Forecast Status" valueColor={forecast.color} />
      </div>

      {/* Widgets */}
      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <Widget title="⚠️ Top Risks">
          {overview.topRisks.length === 0 && !addingRisk && (
            <div style={{ ...TEXT.sm, color: C.textMuted }}>אין סיכונים פתוחים.</div>
          )}
          {overview.topRisks.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: SP[2], padding: `${SP[1]} 0`, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: SEVERITY_COLOR[r.severity] ?? C.textMuted, flexShrink: 0 }} />
              <span style={{ ...TEXT.sm, color: C.textPrimary, flex: 1 }}>{r.title}</span>
              <span style={{ ...TEXT.xs, color: C.textMuted }}>{r.severity}</span>
            </div>
          ))}
          {canWriteRisks && (
            addingRisk ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2], marginTop: SP[3] }}>
                <input
                  value={newRiskTitle}
                  onChange={e => setNewRiskTitle(e.target.value)}
                  placeholder="כותרת הסיכון"
                  style={{ padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, fontFamily: FONT, ...TEXT.sm }}
                />
                <select value={newRiskSeverity} onChange={e => setNewRiskSeverity(e.target.value)}
                  style={{ padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, fontFamily: FONT, ...TEXT.sm }}>
                  <option value="CRITICAL">CRITICAL</option>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
                <div style={{ display: 'flex', gap: SP[2] }}>
                  <button onClick={submitRisk} disabled={saving || !newRiskTitle.trim()}
                    style={{ padding: '7px 16px', background: C.brand, color: '#fff', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', ...TEXT.sm, fontWeight: WEIGHT.semibold }}>
                    {saving ? 'שומר...' : 'שמור'}
                  </button>
                  <button onClick={() => setAddingRisk(false)}
                    style={{ padding: '7px 16px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', ...TEXT.sm }}>
                    ביטול
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAddingRisk(true)}
                style={{ marginTop: SP[3], padding: '7px 14px', background: 'none', border: `1px dashed ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', color: C.textMuted, ...TEXT.sm, width: '100%' }}>
                + הוסף סיכון
              </button>
            )
          )}
        </Widget>

        <Widget title="🚦 QG Summary">
          {Object.entries(overview.qgSummary).map(([key, v]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: `${SP[1]} 0`, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ ...TEXT.sm, color: C.textPrimary }}>{key}</span>
              <span style={{ ...TEXT.sm, color: v.count > v.threshold ? C.danger : C.textMuted, fontWeight: v.count > v.threshold ? WEIGHT.bold : WEIGHT.normal }}>
                {v.count} / {v.threshold}
              </span>
            </div>
          ))}
          <div style={{ marginTop: SP[3], ...TEXT.sm, fontWeight: WEIGHT.bold, color: overview.qgPass ? C.success : C.danger }}>
            {overview.qgPass ? '✅ עומד ב-QG' : '❌ חורג מ-QG'}
          </div>
        </Widget>

        <Widget title="🔔 Critical Alerts">
          {overview.criticalAlerts.length === 0
            ? <div style={{ ...TEXT.sm, color: C.textMuted }}>אין התראות קריטיות.</div>
            : overview.criticalAlerts.map((a, i) => (
              <div key={i} style={{ ...TEXT.sm, color: C.danger, padding: `${SP[1]} 0` }}>⚠ {a.message}</div>
            ))}
        </Widget>

        <Widget title="📈 Forecast Warnings">
          {overview.forecastWarnings.length === 0
            ? <div style={{ ...TEXT.sm, color: C.textMuted }}>אין אזהרות תחזית.</div>
            : overview.forecastWarnings.map((w, i) => (
              <div key={i} style={{ ...TEXT.sm, color: '#e8af00', padding: `${SP[1]} 0` }}>{w}</div>
            ))}
        </Widget>
      </div>

      {showDefectDrilldown && (
        <DefectDrilldownModal
          token={token}
          versionId={versionId}
          screen="status-board"
          filter="openSevereOrWorse"
          title="Critical Defects"
          onClose={() => setShowDefectDrilldown(false)}
        />
      )}
    </div>
  );
};
