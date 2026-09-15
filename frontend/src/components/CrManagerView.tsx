import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C, versionStatusColor, versionStatusBg, versionStatusLabel } from '../theme';
import { useDialog } from '../context/DialogContext';
import { cleanHtmlText } from '../utils/textSanitize';
import { formatDateTime } from '../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const PHASE_LABEL: Record<number, string> = {
  1: 'בוקר גרסה', 2: 'HOTNET', 3: 'HOT', 4: 'בוקר לאחר גרסה',
};
const PHASE_COLOR: Record<number, { bg: string; color: string }> = {
  1: { bg: 'rgba(88,166,255,0.18)',  color: '#58a6ff' },
  2: { bg: 'rgba(63,185,80,0.18)',   color: '#3fb950' },
  3: { bg: 'rgba(240,136,62,0.18)',  color: '#f0883e' },
  4: { bg: 'rgba(163,113,247,0.18)', color: '#a371f7' },
};
const RISK_META: Record<string, { color: string; bg: string; label: string }> = {
  LOW:    { color: '#3fb950', bg: 'rgba(63,185,80,0.15)',  label: 'סיכון נמוך'   },
  MEDIUM: { color: '#d29922', bg: 'rgba(210,153,34,0.15)', label: 'סיכון בינוני' },
  HIGH:   { color: '#f85149', bg: 'rgba(248,81,73,0.18)',  label: 'סיכון גבוה'   },
};

interface TeamEntry {
  teamId: string;
  teamName: string;
  planId: string;
  submissionStatus: string;
  notNeededForPlan: boolean;
  crManagerNote: string | null;
  workPlan?: string | null;
  nightTestingNotes?: string | null;
  morningMonitoring?: string | null;
  rollbackPlan?: string | null;
  gradualRollout?: boolean;
  gradualDetails?: string | null;
  riskLevel?: string | null;
  scripts?: string | null;
  returnReason?: string | null;
}

interface Proposal {
  id: string;
  title: string;
  phase: number;
  estimatedMins?: number;
  assignedUserName?: string;
  notes?: string;
  status: string;
  teamId: string;
}

interface CrEntry {
  crNumber: string;
  crLabel: string | null;
  crManager: string | null;
  crDescription: string | null;
  crManagerApproved: boolean;
  crManagerApprovedAt: string | null;
  crManagerApprovedBy: string | null;
  crManagerNote: string | null;
  teams: TeamEntry[];
  proposals: Proposal[];
  allTeamsSubmitted: boolean;
}

interface VersionEntry {
  id: string;
  name: string;
  status: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  crs: CrEntry[];
  pendingApprovalCount: number;
}

interface Props {
  token: string;
}

const hdrs = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

const subStatusLabel = (s: string, notNeeded: boolean) => {
  if (notNeeded) return 'לא נדרש';
  return ({ DRAFT: 'טיוטה', SUBMITTED: 'הוגש', RETURNED: 'הוחזר', APPROVED: 'אושר' }[s] ?? s);
};
const subStatusColor = (s: string, notNeeded: boolean): string => {
  if (notNeeded) return C.textMuted;
  return ({ DRAFT: C.warning, SUBMITTED: C.info, RETURNED: C.danger, APPROVED: C.success }[s] ?? C.textMuted);
};
const subStatusBg = (s: string, notNeeded: boolean): string => {
  if (notNeeded) return 'rgba(158,158,158,0.08)';
  return ({ DRAFT: C.warningBg, SUBMITTED: C.infoBg, RETURNED: C.dangerBg, APPROVED: C.successBg }[s] ?? 'transparent');
};

export const CrManagerView: React.FC<Props> = ({ token }) => {
  const dialog = useDialog();
  const [data, setData] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvingCr, setApprovingCr] = useState<string | null>(null);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
  const [returnModal, setReturnModal] = useState<{ planId: string; teamName: string; crNumber: string } | null>(null);
  const [returnNote, setReturnNote] = useState('');
  const [returnLoading, setReturnLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await axios.get(`${API}/cr-plans/manager-dashboard`, hdrs(token));
      setData(res.data);
      const pending = res.data.filter((v: VersionEntry) => v.pendingApprovalCount > 0).map((v: VersionEntry) => v.id);
      if (pending.length > 0) setExpandedVersions(new Set(pending));
      else setExpandedVersions(new Set(res.data.map((v: VersionEntry) => v.id)));
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'שגיאה בטעינת נתונים');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const flashSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const toggleVersion = (id: string) =>
    setExpandedVersions(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const approveCr = async (versionId: string, crNumber: string) => {
    const key = `${versionId}__${crNumber}`;
    setApprovingCr(key);
    try {
      await axios.patch(`${API}/cr-plans/version/${versionId}/cr-manager-approve`, { crNumber }, hdrs(token));
      flashSuccess(`CR ${crNumber} אושר בהצלחה`);
      load();
    } catch (e: any) {
      dialog.alert(e.response?.data?.message ?? 'שגיאה באישור', 'שגיאה', 'danger');
    } finally {
      setApprovingCr(null);
    }
  };

  const submitReturn = async () => {
    if (!returnModal || !returnNote.trim()) return;
    setReturnLoading(true);
    try {
      await axios.patch(`${API}/cr-plans/${returnModal.planId}/cr-manager-return`, { note: returnNote }, hdrs(token));
      flashSuccess(`תוכנית הוחזרה לצוות ${returnModal.teamName}`);
      setReturnModal(null);
      setReturnNote('');
      load();
    } catch (e: any) {
      dialog.alert(e.response?.data?.message ?? 'שגיאה בהחזרה', 'שגיאה', 'danger');
    } finally {
      setReturnLoading(false);
    }
  };

  const totalPending = data.reduce((s, v) => s + v.pendingApprovalCount, 0);

  return (
    <div dir="rtl" className="font-sans text-foreground">

      {/* ─── Page title ─── */}
      <div className="mb-5 flex items-center gap-3">
        <span className="text-[22px]">🛡</span>
        <div>
          <div className="text-xl font-bold">לוח מנהל CR</div>
          <div className="text-sm text-subtle-foreground">אישור תוכניות הטמעה לפני ישיבת סקירה</div>
        </div>
        {totalPending > 0 && (
          <span className="ms-auto rounded-full bg-danger px-2.5 py-0.5 text-xs font-bold text-white">
            {totalPending} ממתינים לאישור
          </span>
        )}
      </div>

      {/* ─── Toast ─── */}
      {successMsg && (
        <div className="fixed left-1/2 top-[70px] z-[9999] -translate-x-1/2 rounded-lg bg-success px-5 py-2.5 text-sm font-semibold text-white shadow-md">
          ✓ {successMsg}
        </div>
      )}

      {loading && <div className="p-10 text-center text-subtle-foreground">טוען...</div>}

      {error && (
        <div className="mb-4 rounded-lg bg-danger/10 p-4 text-sm text-danger" style={{ border: `1px solid ${C.danger}44` }}>
          {error}
          <button onClick={load} className="ms-3 cursor-pointer border-none bg-transparent text-sm text-info underline">נסה שוב</button>
        </div>
      )}

      {!loading && !error && data.length === 0 && (
        <div className="p-10 text-center text-subtle-foreground">
          <div className="mb-3 text-5xl">✓</div>
          <div className="text-lg font-semibold">אין גרסאות פעילות הדורשות אישור</div>
          <div className="mt-2 text-sm text-subtle-foreground">גרסאות יופיעו כאן כאשר הן בשלב איסוף / טיוב / סקירה</div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {!loading && data.map(version => (
          <VersionCard
            key={version.id}
            version={version}
            expanded={expandedVersions.has(version.id)}
            onToggle={() => toggleVersion(version.id)}
            approvingCr={approvingCr}
            onApproveCr={(crNumber) => approveCr(version.id, crNumber)}
            onReturnPlan={(planId, teamName, crNumber) => { setReturnModal({ planId, teamName, crNumber }); setReturnNote(''); }}
          />
        ))}
      </div>

      {/* ─── Return Plan Modal ─── */}
      {returnModal && (
        <div
          dir="rtl"
          className="fixed inset-0 z-[3000] flex items-center justify-center bg-[rgba(20,21,42,0.45)]"
          onClick={e => { if (e.target === e.currentTarget) { setReturnModal(null); setReturnNote(''); } }}
        >
          <div className="w-[460px] max-w-[94vw] overflow-hidden rounded-3xl bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <span className="text-lg font-bold">החזרת תוכנית לתיקון</span>
              <button onClick={() => { setReturnModal(null); setReturnNote(''); }} className="cursor-pointer border-none bg-transparent text-lg text-subtle-foreground">✕</button>
            </div>
            <div className="p-5">
              <div className="mb-3 text-sm text-muted-foreground">
                <strong>CR:</strong> {returnModal.crNumber} &nbsp;|&nbsp; <strong>צוות:</strong> {returnModal.teamName}
              </div>
              <label className="mb-2 block text-sm font-semibold">הערה לראש הצוות</label>
              <textarea
                value={returnNote}
                onChange={e => setReturnNote(e.target.value)}
                placeholder="פרט מה צריך לתקן בתוכנית..."
                rows={4}
                className="w-full resize-y rounded-md border border-border px-3 py-2 font-sans text-sm outline-none transition-colors duration-fast ease-out focus:border-primary"
                style={{ boxSizing: 'border-box' }}
              />
              <div className="mt-4 flex justify-start gap-2">
                <button
                  onClick={submitReturn}
                  disabled={!returnNote.trim() || returnLoading}
                  className={`cursor-pointer rounded-md border-none bg-danger px-5 py-2 text-sm font-semibold text-white ${!returnNote.trim() || returnLoading ? 'opacity-50' : 'opacity-100'}`}
                >
                  {returnLoading ? 'שולח...' : 'החזר לתיקון'}
                </button>
                <button
                  onClick={() => { setReturnModal(null); setReturnNote(''); }}
                  className="cursor-pointer rounded-md border border-border bg-muted px-5 py-2 text-sm text-muted-foreground"
                >
                  ביטול
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Version Card ──────────────────────────────────────────────────────────────

interface VersionCardProps {
  version: VersionEntry;
  expanded: boolean;
  onToggle: () => void;
  approvingCr: string | null;
  onApproveCr: (crNumber: string) => void;
  onReturnPlan: (planId: string, teamName: string, crNumber: string) => void;
}

const VersionCard: React.FC<VersionCardProps> = ({ version, expanded, onToggle, approvingCr, onApproveCr, onReturnPlan }) => {
  const statusColor = versionStatusColor[version.status] ?? C.textMuted;
  const statusBg    = versionStatusBg[version.status]    ?? 'transparent';
  const statusText  = versionStatusLabel[version.status] ?? version.status;

  const formatDate = (d: string | null) => d ? formatDateTime(d) : '';

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div
        onClick={onToggle}
        className="flex cursor-pointer items-center justify-between bg-card px-5 py-4 transition-colors duration-fast ease-out hover:bg-muted"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold">{version.name}</span>
          <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ color: statusColor, background: statusBg }}>{statusText}</span>
          {version.pendingApprovalCount > 0 && (
            <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-bold text-danger" style={{ border: `1px solid ${C.danger}33` }}>
              {version.pendingApprovalCount} ממתינים
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {version.plannedStart && <span className="text-xs text-subtle-foreground">{formatDate(version.plannedStart)}</span>}
          <span className={`inline-block text-sm text-subtle-foreground transition-transform duration-fast ease-out ${expanded ? 'rotate-90' : 'rotate-0'}`}>▶</span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border">
          {version.crs.length === 0
            ? <div className="px-5 py-4 text-center text-sm text-subtle-foreground">אין CRים לגרסה זו</div>
            : version.crs.map(cr => (
              <CrRow
                key={cr.crNumber}
                cr={cr}
                approving={approvingCr === `${version.id}__${cr.crNumber}`}
                onApproveCr={() => onApproveCr(cr.crNumber)}
                onReturnPlan={onReturnPlan}
              />
            ))
          }
        </div>
      )}
    </div>
  );
};

// ── CR Row ────────────────────────────────────────────────────────────────────

interface CrRowProps {
  cr: CrEntry;
  approving: boolean;
  onApproveCr: () => void;
  onReturnPlan: (planId: string, teamName: string, crNumber: string) => void;
}

const CrRow: React.FC<CrRowProps> = ({ cr, approving, onApproveCr, onReturnPlan }) => {
  const [isOpen, setIsOpen] = useState(false);
  const proposals = cr.proposals ?? [];

  const activeTeams = cr.teams.filter(t => !t.notNeededForPlan);
  const highRisk = activeTeams.find(t => t.riskLevel === 'HIGH')?.riskLevel
    ?? activeTeams.find(t => t.riskLevel === 'MEDIUM')?.riskLevel
    ?? activeTeams[0]?.riskLevel;

  type AggItem = { team: string; text: string };
  const workItems:     AggItem[] = activeTeams.filter(t => t.workPlan).map(t => ({ team: t.teamName, text: t.workPlan! }));
  const scriptsItems:  AggItem[] = activeTeams.filter(t => t.scripts).map(t => ({ team: t.teamName, text: t.scripts! }));
  const nightItems:    AggItem[] = activeTeams.filter(t => t.nightTestingNotes).map(t => ({ team: t.teamName, text: t.nightTestingNotes! }));
  const morningItems:  AggItem[] = activeTeams.filter(t => t.morningMonitoring).map(t => ({ team: t.teamName, text: t.morningMonitoring! }));
  const rollbackItems: AggItem[] = activeTeams.filter(t => t.rollbackPlan).map(t => ({ team: t.teamName, text: t.rollbackPlan! }));
  const gradualItems:  AggItem[] = activeTeams.filter(t => t.gradualRollout && t.gradualDetails).map(t => ({ team: t.teamName, text: t.gradualDetails! }));
  const hasContent = workItems.length || scriptsItems.length || nightItems.length || morningItems.length || rollbackItems.length || gradualItems.length;
  const returnedTeams = activeTeams.filter(t => t.submissionStatus === 'RETURNED' && t.returnReason);

  const aggField = (icon: string, label: string, items: AggItem[], accent: string) => {
    if (!items.length) return null;
    const multi = items.length > 1;
    return (
      <div className="mb-4">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-extrabold" style={{ color: accent }}>
          <span>{icon}</span><span>{label}</span>
        </div>
        {items.map((item, i) => (
          <div key={i} className={`flex items-start gap-2 ${i < items.length - 1 ? 'mb-2' : 'mb-0'}`}>
            <span className="mt-0.5 flex-shrink-0" style={{ color: accent }}>•</span>
            {multi && (
              <span className="flex-shrink-0 whitespace-nowrap rounded-sm border border-[rgba(163,113,247,0.3)] bg-[rgba(163,113,247,0.18)] px-2 py-0.5 text-[13px] font-bold text-[#a371f7]">
                {item.team}
              </span>
            )}
            <span className="flex-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{item.text}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="border-b border-border">
      {/* ── Header (click to expand) ── */}
      <div
        className="cursor-pointer bg-card px-5 py-4 transition-colors duration-fast ease-out hover:bg-muted"
        onClick={() => setIsOpen(p => !p)}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold" style={{ fontFamily: "'Courier New', monospace" }}>{cr.crNumber}</span>
              {cr.crLabel && <span className="text-sm text-muted-foreground">{cr.crLabel}</span>}
              {cr.crManager && (
                <span className="rounded-sm bg-muted px-2 py-0.5 text-xs text-subtle-foreground">
                  מנהל CR: {cr.crManager}
                </span>
              )}
              {highRisk && RISK_META[highRisk] && (
                <span className="rounded-sm px-2 py-0.5 text-xs font-semibold" style={{ background: RISK_META[highRisk].bg, color: RISK_META[highRisk].color }}>
                  {RISK_META[highRisk].label}
                </span>
              )}
              {proposals.length > 0 && (
                <span className="rounded-sm bg-muted px-2 py-0.5 text-xs text-subtle-foreground">
                  💡 {proposals.length} משימות
                </span>
              )}
            </div>
            {cr.crDescription && (
              <div className="mt-1 max-w-[500px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-subtle-foreground">
                {cleanHtmlText(cr.crDescription)}
              </div>
            )}
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            {cr.crManagerApproved ? (
              <div className="flex items-center gap-1 rounded-md bg-success/10 px-3 py-1.5" style={{ border: `1px solid ${C.success}33` }}>
                <span className="text-success">✓</span>
                <span className="text-xs font-semibold text-success">אושר ע"י {cr.crManagerApprovedBy ?? 'מנהל CR'}</span>
              </div>
            ) : !cr.allTeamsSubmitted ? (
              <div className="rounded-md bg-warning/10 px-3 py-1.5" style={{ border: `1px solid ${C.warning}33` }}>
                <span className="text-xs font-semibold text-warning">ממתין להגשת כל הצוותים</span>
              </div>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); onApproveCr(); }}
                disabled={approving}
                className={`cursor-pointer rounded-md border-none bg-success px-4 py-1.5 text-sm font-semibold text-white transition-[filter] duration-fast ease-out hover:brightness-110 ${approving ? 'opacity-60' : 'opacity-100'}`}
              >
                {approving ? '...' : 'אשר CR'}
              </button>
            )}
            <span className={`inline-block text-sm text-subtle-foreground transition-transform duration-base ease-out ${isOpen ? 'rotate-90' : 'rotate-0'}`}>▶</span>
          </div>
        </div>

        {/* Team chips */}
        <div className="flex flex-wrap gap-2">
          {cr.teams.map(t => (
            <TeamChip
              key={t.planId}
              team={t}
              crApproved={cr.crManagerApproved}
              onReturn={e => { e.stopPropagation(); onReturnPlan(t.planId, t.teamName, cr.crNumber); }}
            />
          ))}
        </div>
      </div>

      {/* ── Expanded plan content ── */}
      {isOpen && (
        <div className="border-t border-border bg-background">

          {cr.crDescription && (
            <div className="flex gap-1.5 border-b border-border bg-[rgba(163,113,247,0.06)] px-5 py-2 text-xs text-[#c9b8f7]">
              <span className="flex-shrink-0 font-bold text-[#a371f7]">פרטי CR:</span>
              <span className="leading-relaxed">{cleanHtmlText(cr.crDescription)}</span>
            </div>
          )}

          {returnedTeams.length > 0 && (
            <div className="flex flex-col gap-2 border-b border-border px-5 py-2.5">
              {returnedTeams.map(t => (
                <div key={t.planId} className="rounded-md bg-danger/10 px-3 py-2 text-xs" style={{ border: `1px solid ${C.danger}33` }}>
                  <span className="font-bold text-danger">↩ הוחזר — {t.teamName}: </span>
                  <span className="text-muted-foreground">{t.returnReason}</span>
                </div>
              ))}
            </div>
          )}

          {hasContent && (
            <div className="grid grid-cols-[3fr_2fr] gap-6 border-b border-border px-5 py-4">
              <div>
                {aggField('📋', 'תוכנית עבודה',           workItems,    '#d4a843')}
                {aggField('📜', 'סקריפטים',               scriptsItems,  '#8b949e')}
                {aggField('💡', 'המלצות בדיקות ליל גרסה', nightItems,   '#58a6ff')}
                {aggField('🌅', 'המלצות בקרות בוקר',      morningItems, '#a371f7')}
              </div>
              <div>
                {aggField('📈', 'עלייה מדורגת',   gradualItems,  '#d29922')}
                {aggField('🛡️', 'תוכנית Rollback', rollbackItems, '#f85149')}
              </div>
            </div>
          )}

          {!hasContent && activeTeams.some(t => t.submissionStatus === 'SUBMITTED' || t.submissionStatus === 'APPROVED') && (
            <div className="border-b border-border px-5 py-3.5 text-center text-xs italic text-subtle-foreground">
              ראשי הצוותים הגישו אך לא מילאו שדות תוכנית
            </div>
          )}

          {proposals.length > 0 ? (
            <div>
              <div className="bg-[rgba(212,168,67,0.05)] px-5 py-1.5 text-xs font-bold uppercase tracking-wide text-[#d4a843]">
                💡 משימות לביצוע ({proposals.length})
              </div>
              {proposals.map((prop, i) => {
                const ph = PHASE_COLOR[prop.phase] ?? { bg: C.bgNested, color: C.textMuted };
                const phaseName = PHASE_LABEL[prop.phase] ?? `שלב ${prop.phase}`;
                const teamName = cr.teams.find(t => t.teamId === prop.teamId)?.teamName ?? prop.teamId;
                return (
                  <div key={prop.id} className="flex items-start gap-2.5 border-t border-border px-5 py-2.5" style={{ background: i % 2 === 0 ? C.bgApp : C.bgNested }}>
                    <div className="flex flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
                      <span style={{ color: '#d4a843' }}>•</span>
                      <span className="text-sm text-muted-foreground">בפעילות</span>
                      <span className="rounded-sm px-2 py-0.5 text-xs font-bold" style={{ background: ph.bg, color: ph.color }}>{phaseName}</span>
                      <span className="text-sm text-muted-foreground">, צוות</span>
                      <span className="rounded-sm border border-[rgba(163,113,247,0.35)] bg-[rgba(163,113,247,0.18)] px-2 py-0.5 text-xs font-bold text-[#b48ef5]">{teamName}</span>
                      {prop.assignedUserName && <span className="text-sm text-muted-foreground">ע"י {prop.assignedUserName}</span>}
                      <span className="text-sm text-muted-foreground">מבצע</span>
                      <span className="text-base font-bold text-foreground">{prop.title}</span>
                      {prop.estimatedMins && <span className="text-xs text-muted-foreground">· {prop.estimatedMins} דק'</span>}
                      {prop.notes && (
                        <div className="mt-0.5 flex w-full gap-1 pe-[18px] text-xs text-muted-foreground">
                          <span>💬</span><span>{cleanHtmlText(prop.notes)}</span>
                        </div>
                      )}
                    </div>
                    <span
                      className="flex-shrink-0 rounded-sm px-2 py-0.5 text-xs font-semibold"
                      style={{
                        background: prop.status === 'READY' ? 'rgba(63,185,80,0.18)' : 'rgba(210,153,34,0.18)',
                        color: prop.status === 'READY' ? '#3fb950' : '#d29922',
                      }}
                    >
                      {prop.status === 'READY' ? 'מוכן' : 'טיוטא'}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : activeTeams.length > 0 && (
            <div className="px-5 py-3 text-center text-xs italic text-subtle-foreground">
              לא הוגשו משימות לפיתוח זה
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Team Chip ─────────────────────────────────────────────────────────────────

interface TeamChipProps {
  team: TeamEntry;
  crApproved: boolean;
  onReturn: (e: React.MouseEvent) => void;
}

const TeamChip: React.FC<TeamChipProps> = ({ team, crApproved, onReturn }) => {
  const [hover, setHover] = useState(false);
  const color  = subStatusColor(team.submissionStatus, team.notNeededForPlan);
  const bg     = subStatusBg(team.submissionStatus, team.notNeededForPlan);
  const label  = subStatusLabel(team.submissionStatus, team.notNeededForPlan);
  const canReturn = !team.notNeededForPlan && (
    team.submissionStatus === 'SUBMITTED' || team.submissionStatus === 'APPROVED' || crApproved
  );

  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full py-1 pe-2.5 ps-1.5 transition-[background,border-color] duration-fast ease-out"
      style={{ background: bg, border: `1px solid ${color}33` }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="h-[7px] w-[7px] flex-shrink-0 rounded-full" style={{ background: color }} />
      <span className="text-xs font-semibold text-foreground">{team.teamName}</span>
      <span className="text-xs" style={{ color }}>{label}</span>
      {canReturn && hover && (
        <button
          onClick={onReturn}
          title="החזר לתיקון"
          className="me-0.5 cursor-pointer rounded-sm bg-danger/10 px-1.5 py-px text-xs text-danger"
          style={{ border: `1px solid ${C.danger}33` }}
        >
          ↩
        </button>
      )}
    </div>
  );
};
