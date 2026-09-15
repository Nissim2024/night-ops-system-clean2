import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C, versionStatusColor, versionStatusBg, versionStatusLabel } from '../theme';
import { cn } from '../lib/utils';
import { DeployCenterLogo } from './DeployCenterLogo';
import { useDialog } from '../context/DialogContext';
import { formatDateTime } from '../utils/dateFormat';
import { cleanHtmlText } from '../utils/textSanitize';

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
  LOW:    { color: '#3fb950', bg: 'rgba(63,185,80,0.15)',   label: 'סיכון נמוך'   },
  MEDIUM: { color: '#d29922', bg: 'rgba(210,153,34,0.15)',  label: 'סיכון בינוני' },
  HIGH:   { color: '#f85149', bg: 'rgba(248,81,73,0.18)',   label: 'סיכון גבוה'   },
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
  submittedAt?: string | null;
  submittedByName?: string | null;
  returnReason?: string | null;
}

interface Proposal {
  id: string;
  title: string;
  phase: number;
  app?: string;
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
  onLogout: () => void;
}

const headers = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

const subStatusLabel = (s: string, notNeeded: boolean) => {
  if (notNeeded) return 'לא נדרש';
  return ({ DRAFT: 'טיוטה', SUBMITTED: 'הוגש', RETURNED: 'הוחזר', APPROVED: 'אושר' }[s] ?? s);
};
const subStatusColor = (s: string, notNeeded: boolean) => {
  if (notNeeded) return C.textMuted;
  return ({ DRAFT: C.warning, SUBMITTED: C.info, RETURNED: C.danger, APPROVED: C.success }[s] ?? C.textMuted);
};
const subStatusBg = (s: string, notNeeded: boolean) => {
  if (notNeeded) return 'rgba(158,158,158,0.08)';
  return ({ DRAFT: C.warningBg, SUBMITTED: C.infoBg, RETURNED: C.dangerBg, APPROVED: C.successBg }[s] ?? 'transparent');
};

export const CrManagerDashboard: React.FC<Props> = ({ token, onLogout }) => {
  const dialog = useDialog();
  const [data, setData] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvingCr, setApprovingCr] = useState<string | null>(null); // `${versionId}__${crNumber}`
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
  const [returnModal, setReturnModal] = useState<{ planId: string; teamName: string; crNumber: string } | null>(null);
  const [returnNote, setReturnNote] = useState('');
  const [returnLoading, setReturnLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const userInfo = (() => {
    try { const p = JSON.parse(atob(token.split('.')[1])); return { name: p.fullName ?? p.email ?? '', role: p.role }; }
    catch { return { name: '', role: '' }; }
  })();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await axios.get(`${API}/cr-plans/manager-dashboard`, headers(token));
      setData(res.data);
      // Auto-expand versions with pending approvals
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
      await axios.patch(`${API}/cr-plans/version/${versionId}/cr-manager-approve`, { crNumber }, headers(token));
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
      await axios.patch(`${API}/cr-plans/${returnModal.planId}/cr-manager-return`, { note: returnNote }, headers(token));
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
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">

      {/* ─── Header ─── */}
      <div className="bg-card px-6 flex items-center justify-between h-[58px] border-b border-border shrink-0 shadow-xs">
        <div className="flex items-center gap-3">
          <DeployCenterLogo variant="nav" />
          <div className="w-px h-5 bg-border" />
          <span className="text-base font-semibold text-foreground">לוח מנהל CR</span>
          {totalPending > 0 && (
            <span className="bg-danger text-white text-xs font-bold rounded-full py-0.5 px-2">
              {totalPending} ממתינים לאישור
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-subtle-foreground">{userInfo.name}</span>
          <button
            onClick={onLogout}
            className="bg-transparent border border-border rounded-md py-1.5 px-3.5 cursor-pointer text-sm text-muted-foreground transition-colors duration-fast ease-out"
            onMouseEnter={e => (e.currentTarget.style.background = C.bgHover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            התנתק
          </button>
        </div>
      </div>

      {/* ─── Toast ─── */}
      {successMsg && (
        <div className="fixed top-[70px] left-1/2 -translate-x-1/2 z-[9999] bg-success text-white py-2.5 px-5 rounded-lg text-sm font-semibold shadow-md transition-all duration-base ease-out">
          ✓ {successMsg}
        </div>
      )}

      {/* ─── Body ─── */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-[900px] mx-auto flex flex-col gap-4">

          {loading && (
            <div className="text-center p-10 text-subtle-foreground text-base">טוען...</div>
          )}

          {error && (
            <div className="bg-danger-bg border border-danger/[26.7%] rounded-lg p-4 text-danger text-sm">
              {error}
              <button onClick={load} className="ms-3 bg-transparent border-none cursor-pointer text-info underline text-sm">נסה שוב</button>
            </div>
          )}

          {!loading && !error && data.length === 0 && (
            <div className="text-center p-10 text-subtle-foreground">
              <div className="text-5xl mb-3">✓</div>
              <div className="text-lg font-semibold text-subtle-foreground">אין גרסאות פעילות הדורשות אישור</div>
              <div className="text-sm text-subtle-foreground mt-2">גרסאות יופיעו כאן כאשר הן בשלב איסוף / טיוב / סקירה</div>
            </div>
          )}

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
      </div>

      {/* ─── Return Plan Modal ─── */}
      {returnModal && (
        <div
          className="fixed inset-0 z-[3000] flex items-center justify-center"
          style={{ background: C.bgOverlay }}
          onClick={e => { if (e.target === e.currentTarget) { setReturnModal(null); setReturnNote(''); } }}
        >
          <div className="bg-card rounded-3xl w-[460px] max-w-[94vw] overflow-hidden" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
            <div className="py-4 px-5 border-b border-border flex items-center justify-between">
              <span className="text-lg font-bold">החזרת תוכנית לתיקון</span>
              <button onClick={() => { setReturnModal(null); setReturnNote(''); }} className="bg-transparent border-none cursor-pointer text-subtle-foreground text-lg">✕</button>
            </div>
            <div className="p-5">
              <div className="text-sm text-muted-foreground mb-3">
                <strong>CR:</strong> {returnModal.crNumber} &nbsp;|&nbsp; <strong>צוות:</strong> {returnModal.teamName}
              </div>
              <label className="block text-sm font-semibold mb-2 text-foreground">הערה לראש הצוות</label>
              <textarea
                value={returnNote}
                onChange={e => setReturnNote(e.target.value)}
                placeholder="פרט מה צריך לתקן בתוכנית..."
                rows={4}
                className="w-full rounded-md border border-border py-2 px-3 text-sm resize-y outline-none transition-colors duration-fast ease-out"
                onFocus={e => (e.currentTarget.style.borderColor = C.borderFocus)}
                onBlur={e => (e.currentTarget.style.borderColor = C.border)}
              />
              <div className="flex justify-start gap-2 mt-4">
                <button
                  onClick={submitReturn}
                  disabled={!returnNote.trim() || returnLoading}
                  className={cn(
                    'bg-danger text-white border-none rounded-md py-2 px-5 cursor-pointer text-sm font-semibold transition-opacity duration-fast ease-out',
                    (!returnNote.trim() || returnLoading) ? 'opacity-50' : 'opacity-100'
                  )}
                >
                  {returnLoading ? 'שולח...' : 'החזר לתיקון'}
                </button>
                <button
                  onClick={() => { setReturnModal(null); setReturnNote(''); }}
                  className="bg-muted border border-border rounded-md py-2 px-5 cursor-pointer text-sm text-muted-foreground transition-colors duration-fast ease-out"
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
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
      {/* Card header */}
      <div
        onClick={onToggle}
        className="flex items-center justify-between py-4 px-5 cursor-pointer transition-colors duration-fast ease-out bg-card"
        onMouseEnter={e => (e.currentTarget.style.background = C.bgHover)}
        onMouseLeave={e => (e.currentTarget.style.background = C.bgCard)}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-foreground">{version.name}</span>
          <span className="text-xs font-semibold py-0.5 px-2.5 rounded-full" style={{ color: statusColor, background: statusBg }}>{statusText}</span>
          {version.pendingApprovalCount > 0 && (
            <span className="bg-danger-bg text-danger text-xs font-bold py-0.5 px-2.5 rounded-full border border-danger/20">
              {version.pendingApprovalCount} ממתינים לאישור
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {version.plannedStart && (
            <span className="text-xs text-subtle-foreground">{formatDate(version.plannedStart)}</span>
          )}
          <span className={cn('text-sm text-subtle-foreground inline-block transition-transform duration-fast ease-out', expanded ? 'rotate-90' : 'rotate-0')}>▶</span>
        </div>
      </div>

      {/* CRs list */}
      {expanded && (
        <div className="border-t border-border">
          {version.crs.length === 0 ? (
            <div className="py-4 px-5 text-sm text-subtle-foreground text-center">אין CRים לגרסה זו</div>
          ) : (
            version.crs.map(cr => (
              <CrRow
                key={cr.crNumber}
                cr={cr}
                versionId={version.id}
                approving={approvingCr === `${version.id}__${cr.crNumber}`}
                onApproveCr={() => onApproveCr(cr.crNumber)}
                onReturnPlan={onReturnPlan}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ── CR Row ────────────────────────────────────────────────────────────────────

interface CrRowProps {
  cr: CrEntry;
  versionId: string;
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
        <div className="text-sm font-extrabold mb-2 flex items-center gap-[5px]" style={{ color: accent }}>
          <span>{icon}</span><span>{label}</span>
        </div>
        {items.map((item, i) => (
          <div key={i} className={cn('flex gap-2 items-start', i < items.length - 1 ? 'mb-2' : 'mb-0')}>
            <span className="shrink-0 mt-0.5" style={{ color: accent }}>•</span>
            {multi && (
              <span className="text-[13px] font-bold rounded-sm border shrink-0 whitespace-nowrap py-0.5 px-2 bg-[rgba(163,113,247,0.18)] text-[#a371f7] border-[rgba(163,113,247,0.3)]">
                {item.team}
              </span>
            )}
            <span className="text-sm text-muted-foreground leading-[1.6] whitespace-pre-wrap flex-1">{item.text}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="border-b border-border">
      {/* ── Header row (click to expand) ── */}
      <div
        className="py-4 px-5 transition-colors duration-fast ease-out cursor-pointer bg-card"
        onClick={() => setIsOpen(p => !p)}
        onMouseEnter={e => (e.currentTarget.style.background = C.bgHover)}
        onMouseLeave={e => (e.currentTarget.style.background = C.bgCard)}
      >
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-foreground font-mono">{cr.crNumber}</span>
              {cr.crLabel && <span className="text-sm text-muted-foreground">{cr.crLabel}</span>}
              {cr.crManager && <span className="text-xs text-subtle-foreground bg-muted py-0.5 px-2 rounded-sm">מנהל CR: {cr.crManager}</span>}
              {highRisk && RISK_META[highRisk] && (
                <span className="text-xs font-semibold py-0.5 px-2 rounded-sm" style={{ background: RISK_META[highRisk].bg, color: RISK_META[highRisk].color }}>
                  {RISK_META[highRisk].label}
                </span>
              )}
              {proposals.length > 0 && (
                <span className="text-xs text-subtle-foreground bg-muted py-0.5 px-2 rounded-sm">
                  💡 {proposals.length} משימות
                </span>
              )}
            </div>
            {cr.crDescription && (
              <div className="text-xs text-subtle-foreground mt-1 overflow-hidden text-ellipsis whitespace-nowrap max-w-[500px]">{cleanHtmlText(cr.crDescription)}</div>
            )}
          </div>

          {/* Approval status + actions */}
          <div className="flex items-center gap-2 shrink-0">
            {cr.crManagerApproved ? (
              <div className="flex items-center gap-1 bg-success-bg border border-success/20 rounded-md py-[5px] px-3">
                <span className="text-success text-[15px]">✓</span>
                <span className="text-xs text-success font-semibold">אושר ע"י {cr.crManagerApprovedBy ?? 'מנהל CR'}</span>
              </div>
            ) : !cr.allTeamsSubmitted ? (
              <div className="bg-warning-bg border border-warning/20 rounded-md py-[5px] px-3">
                <span className="text-xs text-warning font-semibold">ממתין להגשת כל הצוותים</span>
              </div>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); onApproveCr(); }}
                disabled={approving}
                className={cn(
                  'bg-success text-white border-none rounded-md py-1.5 px-4 cursor-pointer text-sm font-semibold transition-opacity duration-fast ease-out',
                  approving ? 'opacity-60' : 'opacity-100'
                )}
                onMouseEnter={e => !approving && (e.currentTarget.style.filter = 'brightness(1.1)')}
                onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
              >
                {approving ? '...' : 'אשר CR'}
              </button>
            )}
            <span className={cn('text-sm text-subtle-foreground inline-block transition-transform duration-base ease-out', isOpen ? 'rotate-90' : 'rotate-0')}>▶</span>
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
        <div className="bg-background border-t border-border">

          {/* CR description block */}
          {cr.crDescription && (
            <div className="py-2 px-5 border-b border-border text-xs flex gap-1.5 bg-[rgba(163,113,247,0.06)] text-[#c9b8f7]">
              <span className="text-[#a371f7] font-bold shrink-0">פרטי CR:</span>
              <span className="leading-normal">{cleanHtmlText(cr.crDescription)}</span>
            </div>
          )}

          {/* Return reasons */}
          {returnedTeams.length > 0 && (
            <div className="py-2.5 px-5 border-b border-border flex flex-col gap-2">
              {returnedTeams.map(t => (
                <div key={t.planId} className="bg-danger-bg border border-danger/20 rounded-md py-2 px-3 text-xs">
                  <span className="text-danger font-bold">↩ הוחזר — {t.teamName}:</span>
                  <span className="text-muted-foreground ms-1.5">{t.returnReason}</span>
                </div>
              ))}
            </div>
          )}

          {/* Plan content fields */}
          {hasContent && (
            <div className="py-4 px-5 grid grid-cols-[3fr_2fr] gap-6 border-b border-border">
              <div>
                {aggField('📋', 'תוכנית עבודה',            workItems,    '#d4a843')}
                {aggField('📜', 'סקריפטים',                scriptsItems,  '#8b949e')}
                {aggField('💡', 'המלצות בדיקות ליל גרסה',  nightItems,   '#58a6ff')}
                {aggField('🌅', 'המלצות בקרות בוקר',       morningItems, '#a371f7')}
              </div>
              <div>
                {aggField('📈', 'עלייה מדורגת',    gradualItems,  '#d29922')}
                {aggField('🛡️', 'תוכנית Rollback', rollbackItems, '#f85149')}
              </div>
            </div>
          )}

          {!hasContent && activeTeams.some(t => t.submissionStatus === 'SUBMITTED' || t.submissionStatus === 'APPROVED') && (
            <div className="py-3.5 px-5 text-xs text-subtle-foreground italic text-center border-b border-border">
              ראשי הצוותים הגישו אך לא מילאו שדות תוכנית
            </div>
          )}

          {/* Task proposals */}
          {proposals.length > 0 ? (
            <div>
              <div className="py-[7px] px-5 text-xs font-bold uppercase tracking-[0.5px] text-[#d4a843] bg-[rgba(212,168,67,0.05)]">
                💡 משימות לביצוע ({proposals.length})
              </div>
              {proposals.map((prop, i) => {
                const ph = PHASE_COLOR[prop.phase] ?? { bg: C.bgNested, color: C.textMuted };
                const phaseName = PHASE_LABEL[prop.phase] ?? `שלב ${prop.phase}`;
                const teamEntry = cr.teams.find(t => t.teamId === prop.teamId);
                const teamName = teamEntry?.teamName ?? prop.teamId;
                return (
                  <div key={prop.id} className={cn('py-2.5 px-5 border-t border-border flex items-start gap-2.5', i % 2 === 0 ? 'bg-background' : 'bg-muted')}>
                    <div className="flex-1 flex flex-wrap items-center gap-y-1 gap-x-1.5">
                      <span className="text-[#d4a843]">•</span>
                      <span className="text-sm text-muted-foreground">בפעילות</span>
                      <span className="text-xs font-bold py-0.5 px-2 rounded-sm" style={{ background: ph.bg, color: ph.color }}>{phaseName}</span>
                      <span className="text-sm text-muted-foreground">, צוות</span>
                      <span className="text-xs font-bold rounded-sm py-0.5 px-2 border bg-[rgba(163,113,247,0.18)] text-[#b48ef5] border-[rgba(163,113,247,0.35)]">{teamName}</span>
                      {prop.assignedUserName && <span className="text-sm text-muted-foreground">ע"י {prop.assignedUserName}</span>}
                      <span className="text-sm text-muted-foreground">מבצע</span>
                      <span className="text-base font-bold text-foreground">{prop.title}</span>
                      {prop.estimatedMins && (
                        <span className="text-xs text-muted-foreground">· {prop.estimatedMins} דק'</span>
                      )}
                      {prop.notes && (
                        <div className="w-full mt-0.5 ps-[18px] text-xs text-muted-foreground flex gap-1">
                          <span>💬</span><span>{cleanHtmlText(prop.notes)}</span>
                        </div>
                      )}
                    </div>
                    <span className={cn('shrink-0 text-xs py-0.5 px-2 rounded-sm font-semibold', prop.status === 'READY' ? 'bg-[rgba(63,185,80,0.18)] text-[#3fb950]' : 'bg-[rgba(210,153,34,0.18)] text-[#d29922]')}>
                      {prop.status === 'READY' ? 'מוכן' : 'טיוטא'}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : activeTeams.length > 0 && (
            <div className="py-3 px-5 text-xs text-subtle-foreground italic text-center">
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
  const canReturn = !team.notNeededForPlan && (team.submissionStatus === 'SUBMITTED' || team.submissionStatus === 'APPROVED' || crApproved);

  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full py-1 ps-2.5 pe-1 relative transition-colors duration-fast ease-out"
      style={{ background: bg, border: `1px solid ${color}33` }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: color }} />
      <span className="text-xs font-semibold text-foreground">{team.teamName}</span>
      <span className="text-xs" style={{ color }}>{label}</span>
      {canReturn && hover && (
        <button
          onClick={onReturn}
          title="החזר לתיקון"
          className="bg-danger-bg border border-danger/20 rounded-sm py-px px-1.5 cursor-pointer text-xs text-danger ms-0.5 transition-colors duration-fast ease-out"
        >
          ↩
        </button>
      )}
    </div>
  );
};
