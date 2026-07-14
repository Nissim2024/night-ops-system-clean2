import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE, versionStatusColor, versionStatusBg, versionStatusLabel } from '../theme';
import { useDialog } from '../context/DialogContext';
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
    <div style={{ fontFamily: FONT, direction: 'rtl', color: C.textPrimary }}>

      {/* ─── Page title ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: SP[3], marginBottom: SP[5] }}>
        <span style={{ fontSize: '22px' }}>🛡</span>
        <div>
          <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold }}>לוח מנהל CR</div>
          <div style={{ ...TEXT.sm, color: C.textMuted }}>אישור תוכניות הטמעה לפני ישיבת סקירה</div>
        </div>
        {totalPending > 0 && (
          <span style={{ background: C.danger, color: C.textInverse, ...TEXT.xs, fontWeight: WEIGHT.bold, borderRadius: RADIUS.full, padding: '3px 10px', marginRight: 'auto' }}>
            {totalPending} ממתינים לאישור
          </span>
        )}
      </div>

      {/* ─── Toast ─── */}
      {successMsg && (
        <div style={{ position: 'fixed', top: '70px', left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: C.success, color: C.textInverse, padding: '10px 20px', borderRadius: RADIUS.lg, ...TEXT.sm, fontWeight: WEIGHT.semibold, boxShadow: SHADOW.md }}>
          ✓ {successMsg}
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: SP[10], color: C.textMuted }}>טוען...</div>}

      {error && (
        <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}44`, borderRadius: RADIUS.lg, padding: SP[4], color: C.danger, ...TEXT.sm, marginBottom: SP[4] }}>
          {error}
          <button onClick={load} style={{ marginRight: SP[3], background: 'none', border: 'none', cursor: 'pointer', color: C.info, textDecoration: 'underline', ...TEXT.sm }}>נסה שוב</button>
        </div>
      )}

      {!loading && !error && data.length === 0 && (
        <div style={{ textAlign: 'center', padding: SP[10], color: C.textMuted }}>
          <div style={{ fontSize: '48px', marginBottom: SP[3] }}>✓</div>
          <div style={{ ...TEXT.lg, fontWeight: WEIGHT.semibold }}>אין גרסאות פעילות הדורשות אישור</div>
          <div style={{ ...TEXT.sm, color: C.textMuted, marginTop: SP[2] }}>גרסאות יופיעו כאן כאשר הן בשלב איסוף / טיוב / סקירה</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: SP[4] }}>
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
          style={{ position: 'fixed', inset: 0, zIndex: 3000, background: C.bgOverlay, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl' }}
          onClick={e => { if (e.target === e.currentTarget) { setReturnModal(null); setReturnNote(''); } }}
        >
          <div style={{ background: C.bgCard, borderRadius: RADIUS['3xl'], width: '460px', maxWidth: '94vw', boxShadow: '0 24px 64px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ ...TEXT.lg, fontWeight: WEIGHT.bold }}>החזרת תוכנית לתיקון</span>
              <button onClick={() => { setReturnModal(null); setReturnNote(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '18px' }}>✕</button>
            </div>
            <div style={{ padding: '20px' }}>
              <div style={{ ...TEXT.sm, color: C.textSecondary, marginBottom: SP[3] }}>
                <strong>CR:</strong> {returnModal.crNumber} &nbsp;|&nbsp; <strong>צוות:</strong> {returnModal.teamName}
              </div>
              <label style={{ display: 'block', ...TEXT.sm, fontWeight: WEIGHT.semibold, marginBottom: SP[2] }}>הערה לראש הצוות</label>
              <textarea
                value={returnNote}
                onChange={e => setReturnNote(e.target.value)}
                placeholder="פרט מה צריך לתקן בתוכנית..."
                rows={4}
                style={{ width: '100%', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, padding: '8px 12px', fontFamily: FONT, ...TEXT.sm, resize: 'vertical', outline: 'none', boxSizing: 'border-box', transition: EASE.fast }}
                onFocus={e => (e.currentTarget.style.borderColor = C.borderFocus)}
                onBlur={e => (e.currentTarget.style.borderColor = C.border)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-start', gap: SP[2], marginTop: SP[4] }}>
                <button
                  onClick={submitReturn}
                  disabled={!returnNote.trim() || returnLoading}
                  style={{ background: C.danger, color: C.textInverse, border: 'none', borderRadius: RADIUS.md, padding: '8px 20px', cursor: 'pointer', ...TEXT.sm, fontWeight: WEIGHT.semibold, opacity: !returnNote.trim() || returnLoading ? 0.5 : 1 }}
                >
                  {returnLoading ? 'שולח...' : 'החזר לתיקון'}
                </button>
                <button
                  onClick={() => { setReturnModal(null); setReturnNote(''); }}
                  style={{ background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '8px 20px', cursor: 'pointer', ...TEXT.sm, color: C.textSecondary }}
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

  const formatDate = (d: string | null) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={{ background: C.bgCard, borderRadius: RADIUS['2xl'], border: `1px solid ${C.border}`, boxShadow: SHADOW.sm, overflow: 'hidden' }}>
      <div
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${SP[4]} ${SP[5]}`, cursor: 'pointer', background: C.bgCard, transition: EASE.fast }}
        onMouseEnter={e => (e.currentTarget.style.background = C.bgHover)}
        onMouseLeave={e => (e.currentTarget.style.background = C.bgCard)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: SP[3] }}>
          <span style={{ ...TEXT.lg, fontWeight: WEIGHT.bold }}>{version.name}</span>
          <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: statusColor, background: statusBg, padding: '2px 10px', borderRadius: RADIUS.full }}>{statusText}</span>
          {version.pendingApprovalCount > 0 && (
            <span style={{ background: C.dangerBg, color: C.danger, ...TEXT.xs, fontWeight: WEIGHT.bold, padding: '2px 10px', borderRadius: RADIUS.full, border: `1px solid ${C.danger}33` }}>
              {version.pendingApprovalCount} ממתינים
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: SP[3] }}>
          {version.plannedStart && <span style={{ ...TEXT.xs, color: C.textMuted }}>{formatDate(version.plannedStart)}</span>}
          <span style={{ ...TEXT.sm, color: C.textMuted, display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: EASE.fast }}>▶</span>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${C.border}` }}>
          {version.crs.length === 0
            ? <div style={{ padding: `${SP[4]} ${SP[5]}`, ...TEXT.sm, color: C.textMuted, textAlign: 'center' }}>אין CRים לגרסה זו</div>
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
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '14px', color: accent, fontWeight: 800, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span>{icon}</span><span>{label}</span>
        </div>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: i < items.length - 1 ? '8px' : 0 }}>
            <span style={{ color: accent, flexShrink: 0, marginTop: '2px' }}>•</span>
            {multi && (
              <span style={{ fontSize: '13px', fontWeight: 700, background: 'rgba(163,113,247,0.18)', color: '#a371f7', padding: '2px 8px', borderRadius: RADIUS.sm, border: '1px solid rgba(163,113,247,0.3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                {item.team}
              </span>
            )}
            <span style={{ ...TEXT.sm, color: C.textSecondary, lineHeight: 1.6, whiteSpace: 'pre-wrap', flex: 1 }}>{item.text}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      {/* ── Header (click to expand) ── */}
      <div
        style={{ padding: `${SP[4]} ${SP[5]}`, background: C.bgCard, cursor: 'pointer', transition: EASE.fast }}
        onClick={() => setIsOpen(p => !p)}
        onMouseEnter={e => (e.currentTarget.style.background = C.bgHover)}
        onMouseLeave={e => (e.currentTarget.style.background = C.bgCard)}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: SP[4], marginBottom: SP[3] }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], flexWrap: 'wrap' }}>
              <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, fontFamily: "'Courier New', monospace" }}>{cr.crNumber}</span>
              {cr.crLabel && <span style={{ ...TEXT.sm, color: C.textSecondary }}>{cr.crLabel}</span>}
              {cr.crManager && (
                <span style={{ ...TEXT.xs, color: C.textMuted, background: C.bgNested, padding: '2px 8px', borderRadius: RADIUS.sm }}>
                  מנהל CR: {cr.crManager}
                </span>
              )}
              {highRisk && RISK_META[highRisk] && (
                <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, padding: '2px 8px', borderRadius: RADIUS.sm, background: RISK_META[highRisk].bg, color: RISK_META[highRisk].color }}>
                  {RISK_META[highRisk].label}
                </span>
              )}
              {proposals.length > 0 && (
                <span style={{ ...TEXT.xs, color: C.textMuted, background: C.bgNested, padding: '2px 8px', borderRadius: RADIUS.sm }}>
                  💡 {proposals.length} משימות
                </span>
              )}
            </div>
            {cr.crDescription && (
              <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '500px' }}>
                {cleanHtmlText(cr.crDescription)}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], flexShrink: 0 }}>
            {cr.crManagerApproved ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: SP[1], background: C.successBg, border: `1px solid ${C.success}33`, borderRadius: RADIUS.md, padding: '5px 12px' }}>
                <span style={{ color: C.success }}>✓</span>
                <span style={{ ...TEXT.xs, color: C.success, fontWeight: WEIGHT.semibold }}>אושר ע"י {cr.crManagerApprovedBy ?? 'מנהל CR'}</span>
              </div>
            ) : !cr.allTeamsSubmitted ? (
              <div style={{ background: C.warningBg, border: `1px solid ${C.warning}33`, borderRadius: RADIUS.md, padding: '5px 12px' }}>
                <span style={{ ...TEXT.xs, color: C.warning, fontWeight: WEIGHT.semibold }}>ממתין להגשת כל הצוותים</span>
              </div>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); onApproveCr(); }}
                disabled={approving}
                style={{ background: C.success, color: C.textInverse, border: 'none', borderRadius: RADIUS.md, padding: '6px 16px', cursor: 'pointer', ...TEXT.sm, fontWeight: WEIGHT.semibold, opacity: approving ? 0.6 : 1, transition: EASE.fast }}
                onMouseEnter={e => !approving && (e.currentTarget.style.filter = 'brightness(1.1)')}
                onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
              >
                {approving ? '...' : 'אשר CR'}
              </button>
            )}
            <span style={{ ...TEXT.sm, color: C.textMuted, display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: EASE.standard }}>▶</span>
          </div>
        </div>

        {/* Team chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: SP[2] }}>
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
        <div style={{ background: C.bgApp, borderTop: `1px solid ${C.border}` }}>

          {cr.crDescription && (
            <div style={{ padding: '8px 20px', borderBottom: `1px solid ${C.border}`, background: 'rgba(163,113,247,0.06)', ...TEXT.xs, color: '#c9b8f7', display: 'flex', gap: '6px' }}>
              <span style={{ color: '#a371f7', fontWeight: WEIGHT.bold, flexShrink: 0 }}>פרטי CR:</span>
              <span style={{ lineHeight: 1.5 }}>{cleanHtmlText(cr.crDescription)}</span>
            </div>
          )}

          {returnedTeams.length > 0 && (
            <div style={{ padding: '10px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: SP[2] }}>
              {returnedTeams.map(t => (
                <div key={t.planId} style={{ background: C.dangerBg, border: `1px solid ${C.danger}33`, borderRadius: RADIUS.md, padding: '8px 12px', ...TEXT.xs }}>
                  <span style={{ color: C.danger, fontWeight: WEIGHT.bold }}>↩ הוחזר — {t.teamName}: </span>
                  <span style={{ color: C.textSecondary }}>{t.returnReason}</span>
                </div>
              ))}
            </div>
          )}

          {hasContent && (
            <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '24px', borderBottom: `1px solid ${C.border}` }}>
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
            <div style={{ padding: '14px 20px', ...TEXT.xs, color: C.textMuted, fontStyle: 'italic', textAlign: 'center', borderBottom: `1px solid ${C.border}` }}>
              ראשי הצוותים הגישו אך לא מילאו שדות תוכנית
            </div>
          )}

          {proposals.length > 0 ? (
            <div>
              <div style={{ padding: '7px 20px', ...TEXT.xs, color: '#d4a843', fontWeight: WEIGHT.bold, textTransform: 'uppercase' as const, letterSpacing: '0.5px', background: 'rgba(212,168,67,0.05)' }}>
                💡 משימות לביצוע ({proposals.length})
              </div>
              {proposals.map((prop, i) => {
                const ph = PHASE_COLOR[prop.phase] ?? { bg: C.bgNested, color: C.textMuted };
                const phaseName = PHASE_LABEL[prop.phase] ?? `שלב ${prop.phase}`;
                const teamName = cr.teams.find(t => t.teamId === prop.teamId)?.teamName ?? prop.teamId;
                return (
                  <div key={prop.id} style={{ padding: '10px 20px', borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.bgApp : C.bgNested, display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', rowGap: '4px', columnGap: '6px' }}>
                      <span style={{ color: '#d4a843' }}>•</span>
                      <span style={{ ...TEXT.sm, color: C.textSecondary }}>בפעילות</span>
                      <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, padding: '2px 8px', borderRadius: RADIUS.sm, background: ph.bg, color: ph.color }}>{phaseName}</span>
                      <span style={{ ...TEXT.sm, color: C.textSecondary }}>, צוות</span>
                      <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, background: 'rgba(163,113,247,0.18)', color: '#b48ef5', padding: '2px 8px', borderRadius: RADIUS.sm, border: '1px solid rgba(163,113,247,0.35)' }}>{teamName}</span>
                      {prop.assignedUserName && <span style={{ ...TEXT.sm, color: C.textSecondary }}>ע"י {prop.assignedUserName}</span>}
                      <span style={{ ...TEXT.sm, color: C.textSecondary }}>מבצע</span>
                      <span style={{ ...TEXT.base, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{prop.title}</span>
                      {prop.estimatedMins && <span style={{ ...TEXT.xs, color: C.textSecondary }}>· {prop.estimatedMins} דק'</span>}
                      {prop.notes && (
                        <div style={{ width: '100%', marginTop: '2px', paddingRight: '18px', ...TEXT.xs, color: C.textSecondary, display: 'flex', gap: '4px' }}>
                          <span>💬</span><span>{cleanHtmlText(prop.notes)}</span>
                        </div>
                      )}
                    </div>
                    <span style={{ flexShrink: 0, ...TEXT.xs, padding: '2px 8px', borderRadius: RADIUS.sm, fontWeight: WEIGHT.semibold, background: prop.status === 'READY' ? 'rgba(63,185,80,0.18)' : 'rgba(210,153,34,0.18)', color: prop.status === 'READY' ? '#3fb950' : '#d29922' }}>
                      {prop.status === 'READY' ? 'מוכן' : 'טיוטא'}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : activeTeams.length > 0 && (
            <div style={{ padding: '12px 20px', ...TEXT.xs, color: C.textMuted, fontStyle: 'italic', textAlign: 'center' }}>
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
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: bg, border: `1px solid ${color}33`, borderRadius: RADIUS.full, padding: '4px 10px 4px 6px', transition: EASE.fast }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{team.teamName}</span>
      <span style={{ ...TEXT.xs, color }}>{label}</span>
      {canReturn && hover && (
        <button
          onClick={onReturn}
          title="החזר לתיקון"
          style={{ background: C.dangerBg, border: `1px solid ${C.danger}33`, borderRadius: RADIUS.sm, padding: '1px 6px', cursor: 'pointer', ...TEXT.xs, color: C.danger, marginRight: '2px' }}
        >
          ↩
        </button>
      )}
    </div>
  );
};
