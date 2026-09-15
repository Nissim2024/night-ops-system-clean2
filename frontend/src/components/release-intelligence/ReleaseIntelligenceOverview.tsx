import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C } from '../../theme';
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
      className={`min-w-[140px] flex-1 rounded-lg border border-border bg-card px-5 py-4 ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="text-xl font-bold leading-tight" style={{ color: valueColor ?? undefined }}>
        <span className={valueColor ? '' : 'text-foreground'}>{value}</span>
      </div>
      <div className="mt-1 text-xs text-subtle-foreground">{label}</div>
    </div>
  );
}

function Widget({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[320px] flex-1 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 text-sm font-bold text-foreground">{title}</div>
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
      <div dir="rtl" className="p-8 text-center font-sans text-subtle-foreground">
        בחר גרסה מתפריט הצד כדי לראות את סקירת ה-Release Intelligence שלה.
      </div>
    );
  }

  if (loading && !overview) {
    return <div dir="rtl" className="p-6 font-sans text-subtle-foreground">טוען...</div>;
  }

  if (!overview) {
    return <div dir="rtl" className="p-6 font-sans text-subtle-foreground">לא ניתן לטעון נתונים עבור גרסה זו.</div>;
  }

  const forecast = FORECAST_LABEL[overview.forecastStatus];

  return (
    <div dir="rtl" className="flex flex-col gap-4 font-sans">
      <div className="text-lg font-bold text-foreground">📊 סקירה כללית — Release Intelligence</div>

      {/* KPI row */}
      <div className="flex flex-wrap gap-3">
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
      <div className="flex flex-wrap gap-3">
        <Widget title="⚠️ Top Risks">
          {overview.topRisks.length === 0 && !addingRisk && (
            <div className="text-sm text-subtle-foreground">אין סיכונים פתוחים.</div>
          )}
          {overview.topRisks.map(r => (
            <div key={r.id} className="flex items-center gap-2 border-b border-border py-1">
              <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[r.severity] ?? C.textMuted }} />
              <span className="flex-1 text-sm text-foreground">{r.title}</span>
              <span className="text-xs text-subtle-foreground">{r.severity}</span>
            </div>
          ))}
          {canWriteRisks && (
            addingRisk ? (
              <div className="mt-3 flex flex-col gap-2">
                <input
                  value={newRiskTitle}
                  onChange={e => setNewRiskTitle(e.target.value)}
                  placeholder="כותרת הסיכון"
                  className="rounded-md border border-border px-2.5 py-2 font-sans text-sm"
                />
                <select value={newRiskSeverity} onChange={e => setNewRiskSeverity(e.target.value)}
                  className="rounded-md border border-border px-2.5 py-2 font-sans text-sm">
                  <option value="CRITICAL">CRITICAL</option>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
                <div className="flex gap-2">
                  <button onClick={submitRisk} disabled={saving || !newRiskTitle.trim()}
                    className="cursor-pointer rounded-md border-none bg-primary px-4 py-[7px] text-sm font-semibold text-primary-foreground">
                    {saving ? 'שומר...' : 'שמור'}
                  </button>
                  <button onClick={() => setAddingRisk(false)}
                    className="cursor-pointer rounded-md border border-border bg-muted px-4 py-[7px] text-sm text-muted-foreground">
                    ביטול
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAddingRisk(true)}
                className="mt-3 w-full cursor-pointer rounded-md border border-dashed border-border bg-transparent px-3.5 py-[7px] text-sm text-subtle-foreground">
                + הוסף סיכון
              </button>
            )
          )}
        </Widget>

        <Widget title="🚦 QG Summary">
          {Object.entries(overview.qgSummary).map(([key, v]) => (
            <div key={key} className="flex justify-between border-b border-border py-1">
              <span className="text-sm text-foreground">{key}</span>
              <span className={`text-sm ${v.count > v.threshold ? 'font-bold text-danger' : 'font-normal text-subtle-foreground'}`}>
                {v.count} / {v.threshold}
              </span>
            </div>
          ))}
          <div className={`mt-3 text-sm font-bold ${overview.qgPass ? 'text-success' : 'text-danger'}`}>
            {overview.qgPass ? '✅ עומד ב-QG' : '❌ חורג מ-QG'}
          </div>
        </Widget>

        <Widget title="🔔 Critical Alerts">
          {overview.criticalAlerts.length === 0
            ? <div className="text-sm text-subtle-foreground">אין התראות קריטיות.</div>
            : overview.criticalAlerts.map((a, i) => (
              <div key={i} className="py-1 text-sm text-danger">⚠ {a.message}</div>
            ))}
        </Widget>

        <Widget title="📈 Forecast Warnings">
          {overview.forecastWarnings.length === 0
            ? <div className="text-sm text-subtle-foreground">אין אזהרות תחזית.</div>
            : overview.forecastWarnings.map((w, i) => (
              <div key={i} className="py-1 text-sm text-warning">{w}</div>
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
