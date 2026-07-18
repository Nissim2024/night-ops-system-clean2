import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { DateField, DateTimeField } from './DatePicker';
import { C, FONT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface CrRow {
  crNumber: string;
  crLabel: string | null;
  teamNames: string[];
  needsAttention: boolean;
  syncStatus: string;
}

interface VersionOpeningModuleProps {
  version: any;
  token: string;
  isManager: boolean;
  onRefresh: () => void;
  onStatusChange?: (s: string) => Promise<void>;
  focusStep?: StepKey;
}

export type StepKey = 'open' | 'scope' | 'approve' | 'manage';

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'open',     label: 'פתיחת גרסה' },
  { key: 'scope',    label: 'תכולת משימות' },
  { key: 'approve',  label: 'אישור תכולה' },
  { key: 'manage',   label: 'ניהול שינויים (מתמשך)' },
];

function utcToLocalInputStr(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function toUtcIso(str: string): string | undefined {
  if (!str) return undefined;
  const d = new Date(str);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}
function toDateOnly(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}
function fmtDateOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL');
}

function btnStyle(bg: string, disabled: boolean): React.CSSProperties {
  return {
    padding: '9px 20px', background: disabled ? C.textDisabled : bg, color: 'white', border: 'none',
    borderRadius: RADIUS.md, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '15px', fontWeight: WEIGHT.bold, fontFamily: FONT,
  };
}

export const VersionOpeningModule: React.FC<VersionOpeningModuleProps> = ({ version, token, isManager, onRefresh, onStatusChange, focusStep }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  const [dates, setDates] = useState({
    integrationStart: toDateOnly(version.integrationStart),
    integrationEnd: toDateOnly(version.integrationEnd),
    plannedStart: version.plannedStart ? utcToLocalInputStr(version.plannedStart) : '',
  });
  const [savingDates, setSavingDates] = useState(false);

  useEffect(() => {
    setDates({
      integrationStart: toDateOnly(version.integrationStart),
      integrationEnd: toDateOnly(version.integrationEnd),
      plannedStart: version.plannedStart ? utcToLocalInputStr(version.plannedStart) : '',
    });
  }, [version.integrationStart, version.integrationEnd, version.plannedStart]);

  const [rows, setRows] = useState<CrRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);

  const [estimateStats, setEstimateStats] = useState<{
    totalEstimateDays: number;
    qaFilteredEstimateDays: number;
    byTeam: { teamId: string; teamName: string; totalDays: number; qaFilteredDays: number; crs: { crNumber: string; crLabel: string; teamDays: number; hasQa: boolean }[] }[];
  } | null>(null);
  const [estimateQaFilter, setEstimateQaFilter] = useState(false);
  const [estimateExpandedTeam, setEstimateExpandedTeam] = useState<string | null>(null);

  useEffect(() => {
    const statsUrl = `${API}/version-cr-assignments/version/${version.id}/stats`;
    axios.get(statsUrl, { headers })
      .then(r => setEstimateStats(r.data ?? null))
      .catch(() => setEstimateStats(null));
  }, [version.id]); // eslint-disable-line

  const loadRows = async () => {
    setLoadingRows(true);
    try {
      const res = await axios.get(`${API}/version-cr-assignments/version/${version.id}`, { headers });
      const raw: any[] = res.data;
      const byCr = new Map<string, CrRow>();
      for (const r of raw) {
        const existing = byCr.get(r.crNumber);
        if (existing) {
          if (r.team?.name && !existing.teamNames.includes(r.team.name)) existing.teamNames.push(r.team.name);
          existing.needsAttention = existing.needsAttention || r.needsAttention;
        } else {
          byCr.set(r.crNumber, {
            crNumber: r.crNumber, crLabel: r.crLabel,
            teamNames: r.team?.name ? [r.team.name] : [],
            needsAttention: r.needsAttention, syncStatus: r.syncStatus,
          });
        }
      }
      setRows(Array.from(byCr.values()).sort((a, b) => a.crNumber.localeCompare(b.crNumber)));
    } catch (e) { console.error(e); }
    setLoadingRows(false);
  };

  useEffect(() => { loadRows(); }, [version.id]); // eslint-disable-line

  const saveDates = async () => {
    setSavingDates(true);
    setError(null);
    try {
      await axios.patch(`${API}/versions/${version.id}`, {
        integrationStart: dates.integrationStart || null,
        integrationEnd: dates.integrationEnd || null,
        plannedStart: dates.plannedStart ? toUtcIso(dates.plannedStart) : null,
      }, { headers });
      onRefresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'שגיאה בשמירת תאריכים');
    }
    setSavingDates(false);
  };

  const resync = async () => {
    setLoadingRows(true);
    try {
      await axios.post(`${API}/version-cr-assignments/version/${version.id}/sync`, {}, { headers });
      await loadRows();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'שגיאה בסנכרון תכולה');
      setLoadingRows(false);
    }
  };

  const acknowledgeAttention = async () => {
    setError(null);
    try {
      await axios.post(`${API}/versions/${version.id}/approve-scope`, {}, { headers });
      onRefresh();
      await loadRows();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'שגיאה באישור השינויים');
    }
  };

  const activeRows = rows.filter(r => r.syncStatus !== 'REMOVED');
  const attentionRows = rows.filter(r => r.needsAttention);

  const doApprove = async () => {
    setApproving(true);
    setError(null);
    try {
      await axios.post(`${API}/versions/${version.id}/approve-scope`, {}, { headers });
      if (version.status === 'COLLECTING' && onStatusChange) {
        await onStatusChange('CR_REVIEW');
      }
      onRefresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'שגיאה באישור תכולה');
    }
    setApproving(false);
  };

  const datesComplete = !!(dates.integrationStart && dates.integrationEnd && dates.plannedStart);
  const scopeExists = activeRows.length > 0;
  const scopeApproved = !!version.scopeApprovedAt;

  const stepDone: Record<StepKey, boolean> = {
    open: datesComplete,
    scope: scopeExists,
    approve: scopeApproved,
    manage: false, // ongoing state — never "done"
  };
  const firstNotDone = STEPS.find(s => !stepDone[s.key])?.key ?? 'manage';
  const activeStepKey: StepKey = scopeApproved ? 'manage' : firstNotDone;

  const [openStep, setOpenStep] = useState<StepKey>(activeStepKey);
  useEffect(() => { setOpenStep(activeStepKey); }, [activeStepKey]); // eslint-disable-line

  const [expanded, setExpanded] = useState(!scopeApproved || attentionRows.length > 0);
  useEffect(() => {
    if (!scopeApproved || attentionRows.length > 0) setExpanded(true);
  }, [scopeApproved, attentionRows.length]);

  useEffect(() => {
    if (focusStep) { setOpenStep(focusStep); setExpanded(true); }
  }, [focusStep]);

  const stepDescriptions: Record<StepKey, string> = {
    open: 'הזנת תאריכי פתיחת הגרסה — תחילת וסיום בדיקות אינטגרציה, ותאריך היעד לעליה לאוויר.',
    scope: `רשימת ה-CR-ים שסונכרנו לגרסה זו מ-CR_LIST (${activeRows.length} פעילים).`,
    approve: 'אישור סופי של תכולת הגרסה.',
    manage: `בניהול שינויי תכולה${version.plannedStart ? ` · יעד עלייה: ${fmtDateOnly(version.plannedStart)}` : ''}.`,
  };

  return (
    <div style={{ background: C.bgCard, borderRadius: RADIUS.xl, marginBottom: '20px', boxShadow: SHADOW.sm, border: `1px solid ${C.border}`, overflow: 'hidden', fontFamily: FONT, direction: 'rtl' }}>
      {/* ── Header: title + numbered badge + step chain ── */}
      <div
        style={{ padding: '14px 24px 16px', cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginLeft: '20px' }}>
            <span style={{ fontSize: '16px', fontWeight: WEIGHT.bold, color: C.textPrimary }}>ניהול גרסה</span>
            <span style={{
              width: '22px', height: '22px', borderRadius: '50%', background: C.brand, color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: WEIGHT.bold, flexShrink: 0,
            }}>1</span>
            <span style={{ fontSize: '14px', color: C.textMuted, marginRight: '4px' }}>{expanded ? '▾' : '▸'}</span>
          </div>

          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            {STEPS.map((s, i) => {
              const isDone = stepDone[s.key];
              const isActive = s.key === activeStepKey;
              const isNodeOpen = s.key === openStep;
              const bubbleBg = isDone ? C.success : isActive ? C.brand : C.bgNested;
              const bubbleBorder = isDone ? C.success : isActive ? C.brand : C.borderEm;
              const labelColor = isDone ? C.success : isActive ? C.brand : C.textDisabled;
              return (
                <React.Fragment key={s.key}>
                  <div
                    onClick={(e) => { e.stopPropagation(); setOpenStep(s.key); setExpanded(true); }}
                    title={s.label}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flexShrink: 0, cursor: 'pointer' }}
                  >
                    <div style={{
                      width: '32px', height: '32px', borderRadius: '50%', background: bubbleBg,
                      border: `2px solid ${bubbleBorder}`,
                      boxShadow: isNodeOpen ? `0 0 0 3px ${C.brandDim}` : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: EASE.fast,
                    }}>
                      {isDone ? (
                        <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
                          <path d="M1 5L4.5 8.5L11 1.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : isActive ? (
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'white' }} />
                      ) : null}
                    </div>
                    <span style={{ fontSize: '13px', fontWeight: isActive ? WEIGHT.semibold : WEIGHT.normal, color: labelColor, whiteSpace: 'nowrap' }}>
                      {s.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div style={{ flex: 1, height: '1.5px', minWidth: '10px', background: stepDone[STEPS[i + 1].key] || stepDone[s.key] ? `${C.success}80` : C.border, margin: '0 6px', alignSelf: 'flex-start', marginTop: '15px' }} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: '10px', fontSize: '13px', color: C.textMuted }}>
          {stepDescriptions[openStep]}
        </div>

        {openStep === 'manage' && (
          <div
            onClick={e => e.stopPropagation()}
            style={{
              marginTop: '10px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md,
              padding: '8px 12px', fontSize: '13px', color: C.textSecondary, display: 'flex', alignItems: 'center', gap: '6px',
            }}
          >
            <span>●</span>
            <span>כל שינוי בתכולה (הוספה/הסרה של משימה) מפעיל עדכון אוטומטי במודול 2 (תכנון ושיבוץ בדיקות) ובמודול 6 (תכנון ושיבוץ משימות לעלייה לאוויר)</span>
          </div>
        )}
      </div>

      {/* ── Expandable content ── */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '20px 24px' }} onClick={e => e.stopPropagation()}>
          {error && (
            <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}`, borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', color: C.danger, fontSize: '14px' }}>⚠️ {error}</div>
          )}

          {openStep === 'open' && (
            <div>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: WEIGHT.semibold, color: C.textSecondary, marginBottom: '6px' }}>תחילת בדיקות אינטגרציה</label>
                  <DateField value={dates.integrationStart} onChange={v => setDates(d => ({ ...d, integrationStart: v }))} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: WEIGHT.semibold, color: C.textSecondary, marginBottom: '6px' }}>סיום בדיקות אינטגרציה</label>
                  <DateField value={dates.integrationEnd} onChange={v => setDates(d => ({ ...d, integrationEnd: v }))} minIso={dates.integrationStart || undefined} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: WEIGHT.semibold, color: C.textSecondary, marginBottom: '6px' }}>יעד לעליה לאוויר (ליל ההטמעה)</label>
                  <DateTimeField value={dates.plannedStart} onChange={v => setDates(d => ({ ...d, plannedStart: v }))} />
                </div>
                <button onClick={saveDates} disabled={savingDates} style={btnStyle(C.brand, savingDates)}>
                  {savingDates ? '...' : '💾 שמור תאריכים'}
                </button>
              </div>
            </div>
          )}

          {(openStep === 'scope' || openStep === 'manage') && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ fontSize: '14px', color: C.textSecondary }}>
                  {activeRows.length} CR-ים פעילים{attentionRows.length > 0 ? `, ${attentionRows.length} דורשים תשומת לב` : ''}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={resync} disabled={loadingRows} style={{ padding: '6px 14px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px' }}>
                    🔄 סנכרן מ-CR_LIST
                  </button>
                  {openStep === 'manage' && attentionRows.length > 0 && (
                    <button onClick={acknowledgeAttention} style={{ padding: '6px 14px', background: C.warning, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontWeight: WEIGHT.bold }}>
                      ✓ אשר שינויים
                    </button>
                  )}
                </div>
              </div>
              {loadingRows ? <div style={{ color: C.textMuted }}>טוען...</div> : (
                <CrList rows={rows} />
              )}

              {estimateStats && (
                <EstimateBreakdown
                  stats={estimateStats}
                  qaFilter={estimateQaFilter}
                  onQaFilterChange={v => { setEstimateQaFilter(v); setEstimateExpandedTeam(null); }}
                  expandedTeam={estimateExpandedTeam}
                  onExpandTeam={t => setEstimateExpandedTeam(t)}
                />
              )}
            </div>
          )}

          {openStep === 'approve' && (
            <div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px', maxWidth: '420px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                  <span style={{ color: C.textMuted }}>תחילת אינטגרציה</span>
                  <span style={{ color: C.textPrimary, fontWeight: WEIGHT.semibold }}>{dates.integrationStart || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                  <span style={{ color: C.textMuted }}>סיום אינטגרציה</span>
                  <span style={{ color: C.textPrimary, fontWeight: WEIGHT.semibold }}>{dates.integrationEnd || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                  <span style={{ color: C.textMuted }}>יעד עליה לאוויר</span>
                  <span style={{ color: C.textPrimary, fontWeight: WEIGHT.semibold }}>{dates.plannedStart ? dates.plannedStart.replace('T', ' ') : '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                  <span style={{ color: C.textMuted }}>CR-ים בתכולה</span>
                  <span style={{ color: C.textPrimary, fontWeight: WEIGHT.semibold }}>{activeRows.length}</span>
                </div>
              </div>
              <button onClick={doApprove} disabled={approving || !datesComplete || !scopeExists} style={btnStyle(C.success, approving || !datesComplete || !scopeExists)}>
                {approving ? '...' : version.status === 'COLLECTING' ? '✓ אשר תכולה ועבור לסקירת CR' : '✓ אשר תכולה'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const EstimateBreakdown: React.FC<{
  stats: {
    totalEstimateDays: number;
    qaFilteredEstimateDays: number;
    byTeam: { teamId: string; teamName: string; totalDays: number; qaFilteredDays: number; crs: { crNumber: string; crLabel: string; teamDays: number; hasQa: boolean }[] }[];
  };
  qaFilter: boolean;
  onQaFilterChange: (v: boolean) => void;
  expandedTeam: string | null;
  onExpandTeam: (teamId: string | null) => void;
}> = ({ stats, qaFilter, onQaFilterChange, expandedTeam, onExpandTeam }) => {
  const teams = qaFilter ? stats.byTeam.filter(t => t.qaFilteredDays > 0) : stats.byTeam;
  const maxDays = Math.max(...(teams.length ? teams.map(t => qaFilter ? t.qaFilteredDays : t.totalDays) : [1]), 1);

  return (
    <div style={{ marginTop: '16px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <span style={{ fontSize: '17px' }}>📊</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', fontWeight: WEIGHT.bold, color: C.textPrimary }}>פירוט הערכות השקעה לפי צוות</div>
          <div style={{ fontSize: '12px', color: C.textMuted }}>לחץ על צוות לפירוט CRs</div>
        </div>
        <div style={{ display: 'flex', gap: '4px', background: C.bgCard, borderRadius: RADIUS.md, padding: '3px' }}>
          {[
            { key: false, label: 'כל CRs' },
            { key: true, label: 'CRs עם QA' },
          ].map(opt => (
            <button
              key={String(opt.key)}
              onClick={() => onQaFilterChange(opt.key)}
              style={{
                border: 'none', borderRadius: RADIUS.sm, padding: '5px 14px',
                fontSize: '12px', fontWeight: WEIGHT.semibold, fontFamily: FONT, cursor: 'pointer',
                background: qaFilter === opt.key ? C.bgNested : 'transparent',
                color: qaFilter === opt.key ? C.textPrimary : C.textMuted,
                boxShadow: qaFilter === opt.key ? SHADOW.xs : 'none',
                transition: EASE.fast,
              }}
            >{opt.label}</button>
          ))}
        </div>
        <div style={{ fontSize: '13px', fontWeight: WEIGHT.bold, color: C.brand, background: C.brandDim, borderRadius: RADIUS.md, padding: '4px 12px' }}>
          סה"כ: {qaFilter ? stats.qaFilteredEstimateDays : stats.totalEstimateDays} ימ"ע
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {teams.map(team => {
          const days = qaFilter ? team.qaFilteredDays : team.totalDays;
          const crs = qaFilter ? team.crs.filter(c => c.hasQa) : team.crs;
          const isOpen = expandedTeam === team.teamId;
          const barPct = Math.round((days / maxDays) * 100);
          return (
            <div key={team.teamId} style={{ borderRadius: RADIUS.md, overflow: 'hidden', border: `1px solid ${isOpen ? C.brand : C.border}`, transition: EASE.fast }}>
              <div
                onClick={() => onExpandTeam(isOpen ? null : team.teamId)}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', cursor: 'pointer', background: isOpen ? C.brandDim : C.bgCard }}
              >
                <div style={{ fontSize: '13px', fontWeight: WEIGHT.semibold, color: C.textPrimary, minWidth: '130px' }}>{team.teamName}</div>
                <div style={{ flex: 1, background: C.bgNested, borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                  <div style={{ width: `${barPct}%`, height: '100%', background: C.brand, borderRadius: '4px', transition: 'width 0.4s ease' }} />
                </div>
                <div style={{ fontSize: '13px', fontWeight: WEIGHT.bold, color: C.brand, minWidth: '60px', textAlign: 'left' }}>{days} ימ"ע</div>
                <div style={{ fontSize: '12px', color: C.textMuted, minWidth: '50px', textAlign: 'left' }}>{crs.length} CRs</div>
                <div style={{ fontSize: '12px', color: C.brand }}>{isOpen ? '▲' : '▼'}</div>
              </div>
              {isOpen && (
                <div style={{ background: C.bgNested, padding: '8px 14px 10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {crs.map(cr => (
                    <div key={cr.crNumber} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 6px', borderRadius: RADIUS.sm }}>
                      <div style={{ fontSize: '12px', fontWeight: WEIGHT.semibold, color: C.textMuted, minWidth: '60px' }}>{cr.crNumber}</div>
                      <div style={{ fontSize: '12px', color: C.textSecondary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cr.crLabel.replace(cr.crNumber + ' - ', '')}</div>
                      {cr.hasQa && <span style={{ fontSize: '12px', color: C.success, fontWeight: WEIGHT.semibold }}>QA</span>}
                      <div style={{ fontSize: '12px', fontWeight: WEIGHT.bold, color: C.brand, minWidth: '50px', textAlign: 'left' }}>{cr.teamDays} ימ"ע</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {teams.length === 0 && (
          <div style={{ fontSize: '13px', color: C.textMuted, textAlign: 'center', padding: '20px' }}>
            הפירוט לפי צוות זמין לאחר סינכרון CR_LIST עם הגרסה
          </div>
        )}
      </div>
    </div>
  );
};

const CrList: React.FC<{ rows: CrRow[] }> = ({ rows }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
    {rows.map(r => (
      <div key={r.crNumber} style={{
        display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px',
        background: r.needsAttention ? C.warningBg : C.bgNested,
        border: `1px solid ${r.needsAttention ? C.warning : C.border}`, borderRadius: RADIUS.md,
        opacity: r.syncStatus === 'REMOVED' ? 0.6 : 1,
      }}>
        <span style={{ fontWeight: WEIGHT.semibold, color: C.textPrimary, minWidth: '90px' }}>{r.crNumber}</span>
        <span style={{ color: C.textSecondary, flex: 1, textDecoration: r.syncStatus === 'REMOVED' ? 'line-through' : 'none' }}>{r.crLabel?.replace(/^\d+\s*-\s*/, '') ?? '—'}</span>
        <span style={{ fontSize: '13px', color: C.textMuted }}>{r.teamNames.join(', ')}</span>
        {r.syncStatus === 'NEW' && <span style={{ fontSize: '12px', color: C.brand, fontWeight: WEIGHT.bold }}>חדש</span>}
        {r.syncStatus === 'REMOVED' && <span style={{ fontSize: '12px', color: C.danger, fontWeight: WEIGHT.bold }}>הוסר</span>}
        {r.needsAttention && <span style={{ fontSize: '12px', color: C.warning, fontWeight: WEIGHT.bold }}>⚠ דורש תשומת לב</span>}
      </div>
    ))}
    {rows.length === 0 && <div style={{ color: C.textMuted }}>אין CR-ים בתכולת הגרסה. יש לסנכרן מקובץ CR_LIST.</div>}
  </div>
);
