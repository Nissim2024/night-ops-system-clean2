import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { usePermissions } from '../context/PermissionsContext';
import { TeamView } from './TeamView';
import { TeamLeadProposalView } from './TeamLeadProposalView';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';
import { PlanWizard } from './PlanWizard';
import { CrPlanReviewPanel } from './CrPlanReviewPanel';
import { FEATURES } from '../featureFlags';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE,
         versionStatusColor, versionStatusBg, versionStatusLabel, statusColor } from '../theme';
import { Button, Card, VersionStatusChip, Badge, SectionHeader, EmptyState, Divider, Alert, Avatar, StatusChip } from './ui';
import { TaskDetailPanel } from './TaskDetailPanel';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Keep legacy maps for any inline usage not yet migrated
const STATUS_COLORS: Record<string, string> = versionStatusColor as any;
const STATUS_LABELS: Record<string, string> = versionStatusLabel as any;

const NEXT_STATUS: Record<string, string> = {
  DRAFT: 'COLLECTING', COLLECTING: 'CR_REVIEW', CR_REVIEW: 'REFINING', REFINING: 'REVIEW',
  REVIEW: 'APPROVED', APPROVED: 'REHEARSAL',
};

const NEXT_LABEL: Record<string, string> = {
  DRAFT: 'פתח לאיסוף משימות', COLLECTING: 'פתח לסקירת תוכניות CR', CR_REVIEW: 'עבור לטיוב',
  REFINING: 'פתח ישיבת מעבר', REVIEW: 'אשר תוכנית',
  APPROVED: 'התחל חזרה גנרלית',
};

const APPS = [
  'BILI', 'CRM', 'OSB', 'DP', 'WEB-RETAIL', 'WEB-NEXT', 'WEB-HOT',
  'TOP', 'IRB', 'NC', 'ERP', 'CONNECT', 'CREDIT GUARD', 'ARCHIVE',
  'PRINT BOSS', 'NIFI', 'CAWA', 'BEERI', 'IVR', 'MEDIATION',
  'PROVISIONING LDAP', 'PROVISIONING TIBCO', 'PROVISIONING NAGRA',
  'PROVISIONING OTT', 'PROVISIONING TEL', 'REMEDY', 'ZOO', 'אחר',
];

interface Version {
  id: string;
  name: string;
  description: string;
  status: string;
  plannedStart: string;
  plannedEnd?: string;
  reviewMeetingTime?: string;
  workPlanMeetingTime?: string;
  importedFileName?: string;
  createdAt: string;
  approvedAt?: string;
  creator: { fullName: string };
  approver?: { fullName: string };
  taskCount?: number;
  lastRehearsalAt?: string;
  lastNightAt?: string;
  isArchived?: boolean;
  archivedAt?: string;
}

interface QcRelease {
  id: string;
  relId: number;
  relName: string;
  goLiveDate?: string;
  rehearsalDate?: string;
  filterDate?: string;
  relEndDate?: string;
}

interface Props {
  token: string;
  onVersionsChanged?: () => void;
  onGoLive?: (versionId: string, versionName: string, isRehearsal: boolean) => void;
  onVersionFocus?: (versionId: string) => void;
  onGoToAdmin?: () => void;
  initialSelectedId?: string;
  autoNew?: boolean;
}

const EMPTY_TASK = { title: '', assignedUserName: '', crNumber: '', application: '', environment: 'BOTH', notes: '', dependencyNote: '', duration: '', plannedStart: '', plannedEnd: '', _durationMins: '' };

// Compute the default plannedEnd from a given plannedStart value:
// next calendar day at 04:00 (night finishes at 04:00 AM next morning)
const defaultPlannedEnd = (plannedStart: string): string => {
  if (!plannedStart) return '';
  const d = new Date(plannedStart);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + 1);
  d.setHours(4, 0, 0, 0);
  return d.toISOString().slice(0, 16);
};

// Subtract N working days (skip Fri=5, Sat=6) from a Date, return "YYYY-MM-DDT10:00" string
const subtractWorkingDays = (from: string, days: number): string => {
  if (!from) return '';
  const d = new Date(from);
  if (isNaN(d.getTime())) return '';
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 5 && dow !== 6) remaining--;
  }
  d.setHours(10, 0, 0, 0);
  return d.toISOString().slice(0, 16);
};

export const VersionsView: React.FC<Props> = ({ token, onVersionsChanged, onGoLive, onVersionFocus, onGoToAdmin, initialSelectedId, autoNew }) => {
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(autoNew ?? false);
  const [newVersion, setNewVersion] = useState({ name: '', description: '', plannedStart: '', plannedEnd: '', reviewMeetingTime: '', workPlanMeetingTime: '', integrationStart: '', integrationEnd: '', qaStart: '', qaEnd: '', qcReleaseId: '' });
  const [qcReleases, setQcReleases] = useState<QcRelease[]>([]);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [creatingFromTemplate, setCreatingFromTemplate] = useState(false);
  const [outerDialog, setOuterDialog] = useState<DialogConfig | null>(null);
  const [depToastOuter, setDepToastOuter] = useState<any[] | null>(null);
  const depToastTimerOuter = React.useRef<any>(null);
  const showDepToastOuter = (affected: any[]) => {
    if (!affected?.length) return;
    if (depToastTimerOuter.current) clearTimeout(depToastTimerOuter.current);
    setDepToastOuter(affected);
    depToastTimerOuter.current = setTimeout(() => setDepToastOuter(null), 6000);
  };

  const headers = { Authorization: `Bearer ${token}` };
  const tokenPayload = token ? JSON.parse(atob(token.split('.')[1])) : {};
  const userRole: string = tokenPayload.role || '';
  const isManager = ['RELEASE_MANAGER', 'ADMIN'].includes(userRole);
  const { can: outerCan } = usePermissions();

  const fetchVersions = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/versions`, { headers });
      setVersions(res.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchVersion = async (id: string) => {
    try {
      const res = await axios.get(`${API}/versions/${id}`, { headers });
      setSelected(res.data);
      onVersionFocus?.(id);
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    fetchVersions();
    axios.get(`${API}/qc-releases/active`, { headers }).then(res => setQcReleases(res.data)).catch(() => {});
    axios.get(`${API}/version-templates`, { headers }).then(res => setTemplates(res.data)).catch(() => {});
  }, []); // eslint-disable-line

  // Auto-select version when initialSelectedId changes (e.g. from sidebar selection)
  useEffect(() => {
    if (initialSelectedId) fetchVersion(initialSelectedId);
  }, [initialSelectedId]); // eslint-disable-line

  const handlePlannedStartChange = (val: string) => {
    setNewVersion(prev => ({
      ...prev,
      plannedStart: val,
      plannedEnd: prev.plannedEnd ? prev.plannedEnd : defaultPlannedEnd(val),
      reviewMeetingTime: prev.reviewMeetingTime ? prev.reviewMeetingTime : subtractWorkingDays(val, 10),
      workPlanMeetingTime: prev.workPlanMeetingTime ? prev.workPlanMeetingTime : subtractWorkingDays(val, 9),
    }));
  };

  const syncCrsInBackground = (versionId: string) => {
    axios.post(`${API}/version-cr-assignments/version/${versionId}/sync`, {}, { headers }).catch(() => {});
  };

  const createEmpty = async () => {
    if (!newVersion.name.trim()) return;
    setCreatingTemplate(true);
    try {
      const res = await axios.post(`${API}/versions`, {
        ...newVersion,
        qcReleaseId: newVersion.qcReleaseId || undefined,
      }, { headers });
      const versionId = res.data.id;
      syncCrsInBackground(versionId);
      setShowNew(false);
      setNewVersion({ name: '', description: '', plannedStart: '', plannedEnd: '', reviewMeetingTime: '', workPlanMeetingTime: '', integrationStart: '', integrationEnd: '', qaStart: '', qaEnd: '', qcReleaseId: '' });
      await fetchVersions();
      await fetchVersion(versionId);
      onVersionsChanged?.();
    } catch (err: any) { setActionError(err?.response?.data?.message || 'שגיאה ביצירת גרסה'); }
    finally { setCreatingTemplate(false); }
  };

  const importFromFile = async () => {
    if (!importFile || !newVersion.name.trim()) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      formData.append('versionName', newVersion.name);
      if (newVersion.plannedStart) formData.append('plannedStart', newVersion.plannedStart.slice(0, 10));
      if (newVersion.qcReleaseId) formData.append('qcReleaseId', newVersion.qcReleaseId);
      const res = await axios.post(`${API}/import/excel`, formData, { headers });
      if (res.data.success) {
        if (res.data.versionId) syncCrsInBackground(res.data.versionId);
        setShowNew(false);
        setNewVersion({ name: '', description: '', plannedStart: '', plannedEnd: '', reviewMeetingTime: '', workPlanMeetingTime: '', integrationStart: '', integrationEnd: '', qaStart: '', qaEnd: '', qcReleaseId: '' });
        setImportFile(null);
        await fetchVersions();
        onVersionsChanged?.();
      } else {
        setActionError(res.data.message || 'שגיאה בייבוא הקובץ');
      }
    } catch (err: any) {
      setActionError(err?.response?.data?.message || 'שגיאה בייבוא הקובץ');
    } finally { setImporting(false); }
  };

  const createFromTemplate = async () => {
    if (!selectedTemplateId) { setActionError('יש לבחור תבנית לפני יצירה'); return; }
    if (!newVersion.name.trim()) { setActionError('נדרש שם גרסה לפני יצירה'); return; }
    if (!newVersion.plannedStart) { setActionError('נדרש תאריך ושעת התחלה מתוכנן לפני יצירה'); return; }
    if (!newVersion.plannedEnd) { setActionError('נדרש תאריך ושעת סיום מתוכנן לפני יצירה'); return; }
    setCreatingFromTemplate(true);
    try {
      const res = await axios.post(`${API}/versions`, {
        ...newVersion,
        qcReleaseId: newVersion.qcReleaseId || undefined,
      }, { headers });
      const versionId = res.data.id;
      await axios.post(`${API}/version-templates/${selectedTemplateId}/apply-to-version/${versionId}`, {}, { headers });
      syncCrsInBackground(versionId);
      setShowNew(false);
      setNewVersion({ name: '', description: '', plannedStart: '', plannedEnd: '', reviewMeetingTime: '', workPlanMeetingTime: '', integrationStart: '', integrationEnd: '', qaStart: '', qaEnd: '', qcReleaseId: '' });
      setSelectedTemplateId('');
      await fetchVersions();
      await fetchVersion(versionId);
      onVersionsChanged?.();
    } catch (err: any) {
      setActionError(err?.response?.data?.message || 'שגיאה ביצירה מתבנית');
    } finally { setCreatingFromTemplate(false); }
  };

  const updateStatus = async (id: string, status: string, force?: boolean): Promise<void> => {
    await axios.patch(`${API}/versions/${id}/status`, { status, ...(force ? { force: true } : {}) }, { headers });
    await fetchVersions();
    await fetchVersion(id);
    onVersionsChanged?.();
  };

  const deleteVersion = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOuterDialog({
      title: 'מחיקת גרסה',
      message: `למחוק את הגרסה "${name}" וכל הנתונים שלה לצמיתות?\nפעולה זו אינה הפיכה.`,
      confirmLabel: 'מחק',
      variant: 'danger',
      onConfirm: async () => {
        setOuterDialog(null);
        setDeletingId(id);
        setActionError(null);
        try {
          await axios.delete(`${API}/versions/${id}`, { headers });
          await fetchVersions();
          onVersionsChanged?.();
        } catch (err: any) {
          const msg = err?.response?.data?.message || err?.message || 'שגיאה במחיקת הגרסה';
          setActionError(`שגיאת מחיקה: ${msg}`);
        } finally { setDeletingId(null); }
      },
      onCancel: () => setOuterDialog(null),
    });
  };

  const archiveVersion = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOuterDialog({
      title: 'העברה לארכיון',
      message: 'להעביר גרסה זו לארכיון? ניתן לשחזר בכל עת.',
      confirmLabel: 'העבר לארכיון',
      variant: 'warning',
      onConfirm: async () => {
        setOuterDialog(null);
        setActionError(null);
        try {
          await axios.patch(`${API}/versions/${id}/archive`, {}, { headers });
          await fetchVersions();
          onVersionsChanged?.();
        } catch (err: any) {
          setActionError(`שגיאת ארכיון: ${err?.response?.data?.message || err?.message || 'שגיאה'}`);
        }
      },
      onCancel: () => setOuterDialog(null),
    });
  };

  const restoreVersion = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOuterDialog({
      title: 'שחזור גרסה',
      message: 'לשחזר גרסה זו מהארכיון? הסטטוס ישוחזר ל"מאושר".',
      confirmLabel: 'שחזר',
      variant: 'info',
      onConfirm: async () => {
        setOuterDialog(null);
        setActionError(null);
        try {
          await axios.patch(`${API}/versions/${id}/restore`, {}, { headers });
          await fetchVersions();
          onVersionsChanged?.();
        } catch (err: any) {
          setActionError(`שגיאת שחזור: ${err?.response?.data?.message || err?.message || 'שגיאה'}`);
        }
      },
      onCancel: () => setOuterDialog(null),
    });
  };

  if (selected) {
    return (
      <>
        <VersionDetail
          version={selected}
          token={token}
          userRole={userRole}
          onBack={() => { setSelected(null); fetchVersions(); }}
          onRefresh={() => fetchVersion(selected.id)}
          onStatusChange={(status, force) => updateStatus(selected.id, status, force)}
          onGoLive={onGoLive}
          showDepToast={showDepToastOuter}
        />
        {depToastOuter && depToastOuter.length > 0 && (
          <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 99999, display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '340px', pointerEvents: 'auto' }}>
            {depToastOuter.map((item: any, i: number) => {
              const noTiming = item.deltaMinutes === 0;
              const shortened = item.deltaMinutes < 0;
              const absMins = Math.abs(item.deltaMinutes);
              const label = item.subPhaseName ? `"${item.subPhaseName}"` : item.phaseName ? `"${item.phaseName}"` : '';
              const bg = noTiming ? '#e8f4fd' : shortened ? '#d4edda' : '#fff3cd';
              const border = noTiming ? '#17a2b8' : shortened ? '#28a745' : '#ffc107';
              const textColor = noTiming ? '#0c5460' : shortened ? '#155724' : '#856404';
              const icon = noTiming ? '🔗' : shortened ? '⏫' : '⏬';
              return (
                <div key={i} style={{ background: bg, border: `1px solid ${border}`, borderRadius: '10px', padding: '10px 14px', fontSize: '13px', color: textColor, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'flex-start', gap: '8px', direction: 'rtl' }}>
                  <span style={{ fontSize: '16px', lineHeight: 1 }}>{icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>
                      {noTiming ? (item.action === 'הסרה' ? 'תלות הוסרה' : 'תלות נוספה') : 'עדכון לוחות זמנים'}
                    </div>
                    {!noTiming && label && <div>תת-שלב {label} <strong>{shortened ? 'קוצר' : 'הוארך'} ב-{absMins} דק'</strong></div>}
                    {!noTiming && item.phaseName && item.subPhaseName && <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>שלב: {item.phaseName}</div>}
                    {noTiming && <div style={{ fontSize: '12px', opacity: 0.8 }}>אין משימות עם לוח זמנים מוגדר</div>}
                  </div>
                  <button onClick={() => setDepToastOuter(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: textColor, fontSize: '16px', padding: 0, lineHeight: 1, opacity: 0.6 }}>✕</button>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  }

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: SP[3] }}>
            <h2 style={{ ...TEXT['2xl'], fontWeight: WEIGHT.bold, color: C.textPrimary, margin: 0, fontFamily: FONT }}>
              גרסאות
            </h2>
            <Badge color={C.textMuted} bg={C.bgActive}>
              {versions.filter(v => !v.isArchived).length}
            </Badge>
          </div>
          <button
            onClick={() => setShowArchived(a => !a)}
            style={{
              display: 'flex', alignItems: 'center', gap: SP[2],
              padding: '5px 14px',
              background: showArchived ? C.bgActive : C.bgNested,
              color: showArchived ? C.textPrimary : C.textMuted,
              border: `1px solid ${showArchived ? C.borderEm : C.border}`,
              borderRadius: RADIUS.full, cursor: 'pointer',
              ...TEXT.xs, fontWeight: WEIGHT.semibold, fontFamily: FONT,
              transition: EASE.fast,
            }}
          >
            <span>📦</span>
            ארכיון
            <Badge color={C.textDisabled} bg={C.bgHover}>
              {versions.filter(v => v.isArchived).length}
            </Badge>
          </button>
        </div>
        <div style={{ display: 'flex', gap: SP[2] }}>
          {isManager && (
          <Button
            variant="primary"
            size="md"
            onClick={() => { setShowNew(true); setImportFile(null); }}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            }
          >
            גרסה חדשה
          </Button>
          )}
        </div>
      </div>

      {showNew && (
        <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px', marginBottom: '24px', border: `2px solid ${C.brand}` }}>
          <h3 style={{ margin: '0 0 20px', color: C.textPrimary }}>יצירת גרסה חדשה</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>

            {/* שם גרסה — spans 2 cols */}
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: C.textPrimary, fontSize: '14px' }}>
                שם גרסה <span style={{ color: C.statusBlocked }}>*</span>
                {qcReleases.length === 0 && (
                  <span style={{ fontSize: '11px', color: C.warning, marginRight: '6px', fontWeight: 'normal' }}>
                    (סנכרן גרסאות QC מ-AdminPanel)
                  </span>
                )}
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <select
                  value={newVersion.qcReleaseId || '__manual__'}
                  onChange={e => {
                    const val = e.target.value;
                    if (val === '__manual__') {
                      setNewVersion(v => ({ ...v, qcReleaseId: '', name: v.qcReleaseId ? '' : v.name }));
                    } else {
                      const rel = qcReleases.find(r => r.id === val);
                      setNewVersion(v => ({ ...v, qcReleaseId: val, name: rel?.relName || v.name }));
                    }
                  }}
                  style={{ flex: '0 0 auto', padding: '10px', border: `2px solid ${C.border}`, borderRadius: '8px', fontSize: '13px', background: C.bgNested, color: C.textPrimary }}
                >
                  <option value="__manual__">✏️ הקלד ידנית</option>
                  {qcReleases.length > 0 && <option disabled>── גרסאות QC ──</option>}
                  {[...qcReleases]
                    .sort((a, b) => {
                      if (a.goLiveDate && b.goLiveDate) return new Date(a.goLiveDate).getTime() - new Date(b.goLiveDate).getTime();
                      if (a.goLiveDate) return -1;
                      if (b.goLiveDate) return 1;
                      return a.relName.localeCompare(b.relName, 'he');
                    })
                    .map(r => (
                    <option key={r.id} value={r.id}>
                      {r.relName}
                      {r.goLiveDate ? ` — ${new Date(r.goLiveDate).toLocaleDateString('he-IL')}` : r.relEndDate ? ` — ${new Date(r.relEndDate).toLocaleDateString('he-IL')}` : ''}
                    </option>
                  ))}
                </select>
                <input
                  value={newVersion.name}
                  onChange={e => setNewVersion(v => ({ ...v, name: e.target.value, qcReleaseId: '' }))}
                  placeholder="לדוגמה: ITv04-2026"
                  style={{ flex: 1, padding: '10px', border: `2px solid ${newVersion.qcReleaseId ? C.statusDone : C.border}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', background: C.bgNested, color: C.textPrimary }}
                />
              </div>
            </div>

            {/* Row: Description — spans 2 cols */}
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: C.textPrimary, fontSize: '13px' }}>תיאור</label>
              <input value={newVersion.description} onChange={e => setNewVersion({ ...newVersion, description: e.target.value })} placeholder="תיאור קצר"
                style={{ width: '100%', padding: '9px', border: `1px solid ${C.border}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', background: C.bgNested, color: C.textPrimary }} />
            </div>

            {/* Row: Integration dates */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: C.textPrimary, fontSize: '13px' }}>🔧 תאריך תחילת אינטגרציה</label>
              <input type="date" value={newVersion.integrationStart}
                onChange={e => setNewVersion({ ...newVersion, integrationStart: e.target.value })}
                style={{ width: '100%', padding: '9px', border: `1px solid ${C.border}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', background: C.bgNested, color: C.textPrimary }} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: C.textPrimary, fontSize: '13px' }}>🔧 תאריך סיום אינטגרציה</label>
              <input type="date" value={newVersion.integrationEnd}
                onChange={e => setNewVersion({ ...newVersion, integrationEnd: e.target.value })}
                style={{ width: '100%', padding: '9px', border: `1px solid ${C.border}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', background: C.bgNested, color: C.textPrimary }} />
            </div>

            {/* Row: QA dates */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: C.textPrimary, fontSize: '13px' }}>🧪 תאריך תחילת בדיקות QA</label>
              <input type="date" value={newVersion.qaStart}
                onChange={e => setNewVersion({ ...newVersion, qaStart: e.target.value })}
                style={{ width: '100%', padding: '9px', border: `1px solid ${C.border}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', background: C.bgNested, color: C.textPrimary }} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: C.textPrimary, fontSize: '13px' }}>🧪 תאריך סיום בדיקות QA</label>
              <input type="date" value={newVersion.qaEnd}
                onChange={e => setNewVersion({ ...newVersion, qaEnd: e.target.value })}
                style={{ width: '100%', padding: '9px', border: `1px solid ${C.border}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', background: C.bgNested, color: C.textPrimary }} />
            </div>

            {/* Row: Meeting dates */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: C.textPrimary, fontSize: '13px' }}>
                📅 ישיבת סקירת CR-ים
                <span style={{ fontSize: '10px', color: C.textMuted, marginRight: '5px', fontWeight: 'normal' }}>T−10 ימי עבודה</span>
              </label>
              <input type="datetime-local" value={newVersion.reviewMeetingTime}
                onChange={e => setNewVersion({ ...newVersion, reviewMeetingTime: e.target.value })}
                style={{ width: '100%', padding: '9px', border: `1px solid ${C.border}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', background: C.bgNested, color: C.textPrimary }} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: C.textPrimary, fontSize: '13px' }}>
                📋 ישיבת מעבר תוכנית עבודה
                <span style={{ fontSize: '10px', color: C.textMuted, marginRight: '5px', fontWeight: 'normal' }}>T−9 ימי עבודה</span>
              </label>
              <input type="datetime-local" value={newVersion.workPlanMeetingTime}
                onChange={e => setNewVersion({ ...newVersion, workPlanMeetingTime: e.target.value })}
                style={{ width: '100%', padding: '9px', border: `1px solid ${C.border}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', background: C.bgNested, color: C.textPrimary }} />
            </div>

            {/* Row: Go-live dates — required */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: C.textPrimary, fontSize: '13px' }}>
                תאריך ושעת התחלה מתוכנן <span style={{ color: C.statusBlocked }}>*</span>
              </label>
              <input type="datetime-local" value={newVersion.plannedStart}
                onChange={e => handlePlannedStartChange(e.target.value)}
                style={{ width: '100%', padding: '9px', border: `2px solid ${!newVersion.plannedStart ? C.statusBlocked : C.statusDone}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', background: C.bgNested, color: C.textPrimary }} />
              {!newVersion.plannedStart && (
                <p style={{ margin: '4px 0 0', fontSize: '11px', color: C.danger }}>שדה חובה</p>
              )}
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: C.textPrimary, fontSize: '13px' }}>
                תאריך ושעת סיום מתוכנן <span style={{ color: C.statusBlocked }}>*</span>
              </label>
              <input type="datetime-local" value={newVersion.plannedEnd}
                onChange={e => setNewVersion({ ...newVersion, plannedEnd: e.target.value })}
                style={{ width: '100%', padding: '9px', border: `2px solid ${!newVersion.plannedEnd ? C.statusBlocked : C.statusDone}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', background: C.bgNested, color: C.textPrimary }} />
              {!newVersion.plannedEnd && (
                <p style={{ margin: '4px 0 0', fontSize: '11px', color: C.danger }}>שדה חובה</p>
              )}
            </div>

          </div>

          {/* ── Create options ── */}
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Row 1: compact template selector */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <label style={{ fontSize: '13px', color: C.textSecondary, fontWeight: 'bold', whiteSpace: 'nowrap' }}>📋 תבנית שמורה:</label>
              {templates.length > 0 ? (
                <select
                  value={selectedTemplateId}
                  onChange={e => setSelectedTemplateId(e.target.value)}
                  style={{ padding: '7px 10px', border: `2px solid ${C.statusDone}`, borderRadius: '8px', fontSize: '13px', maxWidth: '280px', background: C.bgNested, color: C.textPrimary }}
                >
                  <option value="">-- בחר תבנית --</option>
                  {templates.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>
                  ))}
                </select>
              ) : (
                <span style={{ fontSize: '12px', color: C.textMuted, fontStyle: 'italic' }}>אין תבניות שמורות — שמור תבנית מגרסה קיימת</span>
              )}
            </div>

            {/* Row 2: action buttons */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={createFromTemplate}
                disabled={creatingFromTemplate || !selectedTemplateId || !newVersion.name.trim() || !newVersion.plannedStart}
                style={{ padding: '9px 18px', background: !selectedTemplateId || !newVersion.name.trim() || !newVersion.plannedStart ? C.textDisabled : C.statusDone, color: 'white', border: 'none', borderRadius: '8px', cursor: !selectedTemplateId || !newVersion.name.trim() || !newVersion.plannedStart ? 'not-allowed' : 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap', fontSize: '13px' }}>
                {creatingFromTemplate ? 'יוצר...' : '📋 צור תוכנית גרסה מתבנית שמורה'}
              </button>
              <button
                onClick={createEmpty}
                disabled={creatingTemplate || !newVersion.name.trim() || !newVersion.plannedStart}
                style={{ padding: '9px 18px', background: creatingTemplate || !newVersion.name.trim() || !newVersion.plannedStart ? C.textDisabled : C.statusWaiting, color: 'white', border: 'none', borderRadius: '8px', cursor: creatingTemplate || !newVersion.name.trim() || !newVersion.plannedStart ? 'not-allowed' : 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap', fontSize: '13px' }}>
                {creatingTemplate ? 'יוצר...' : '📄 גרסה ריקה'}
              </button>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <label style={{ padding: '9px 18px', background: C.brand, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap', fontSize: '13px' }}>
                  📤 {importFile ? importFile.name : 'ייבוא מ-Excel'}
                  <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                    onChange={e => setImportFile(e.target.files?.[0] || null)} />
                </label>
                {importFile && (
                  <button
                    onClick={importFromFile}
                    disabled={importing || !newVersion.name.trim() || !newVersion.plannedStart}
                    style={{ padding: '9px 14px', background: importing || !newVersion.name.trim() || !newVersion.plannedStart ? C.textDisabled : C.statusDone, color: 'white', border: 'none', borderRadius: '8px', cursor: importing || !newVersion.name.trim() || !newVersion.plannedStart ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>
                    {importing ? 'מייבא...' : 'ייבא'}
                  </button>
                )}
                {importFile && (
                  <button onClick={() => setImportFile(null)} style={{ padding: '9px 12px', background: C.bgNested, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, cursor: 'pointer', fontSize: '12px' }}>✕</button>
                )}
              </div>

              <button onClick={() => { setShowNew(false); setImportFile(null); setSelectedTemplateId(''); }} style={{ padding: '9px 18px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.lg, cursor: 'pointer' }}>ביטול</button>
            </div>
          </div>
          {(!newVersion.name.trim() || !newVersion.plannedStart || !newVersion.plannedEnd) && (
            <p style={{ margin: '10px 0 0', fontSize: '12px', color: C.danger }}>
              {[
                !newVersion.name.trim()   && 'שם גרסה',
                !newVersion.plannedStart  && 'תאריך ושעת התחלה מתוכנן',
                !newVersion.plannedEnd    && 'תאריך ושעת סיום מתוכנן',
              ].filter(Boolean).join(', ')} — שדה חובה
            </p>
          )}
          {actionError && (
            <div style={{ margin: '10px 0 0', background: C.bgBlocked, border: `1px solid ${C.statusFailed}44`, borderRadius: '8px', padding: '10px 16px', color: C.statusFailed, fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{actionError}</span>
              <button onClick={() => setActionError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.statusFailed, fontWeight: 'bold', fontSize: '16px' }}>×</button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted }}>טוען...</div>
      ) : versions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted }}>
          <div style={{ fontSize: '48px' }}>📋</div>
          <p>אין גרסאות עדיין — צור את הראשונה!</p>
        </div>
      ) : (
        <>
        {actionError && (
          <div style={{ background: C.bgBlocked, border: `1px solid ${C.statusFailed}44`, borderRadius: '8px', padding: '10px 16px', marginBottom: '12px', color: C.statusFailed, fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.statusFailed, fontWeight: 'bold', fontSize: '16px' }}>×</button>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {versions
            .filter(v => !v.isArchived)
            .map(v => (
            <VersionCard
              key={v.id}
              v={v}
              isDeleting={deletingId === v.id}
              onOpen={() => fetchVersion(v.id)}
              onDelete={userRole === 'ADMIN' ? (e) => deleteVersion(v.id, v.name, e) : undefined}
              onArchive={(e) => archiveVersion(v.id, e)}
            />
          ))}
        </div>

        {showArchived && (
          <div style={{ marginTop: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, color: C.textMuted }}>📦 ארכיון</h3>
              <span style={{ fontSize: '12px', color: C.textDisabled }}>גרסאות שהסתיימו — ניתן לשחזר</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', opacity: 0.8 }}>
              {versions
                .filter(v => v.isArchived)
                .map(v => (
                <VersionCard
                  key={v.id}
                  v={v}
                  isDeleting={deletingId === v.id}
                  onOpen={() => fetchVersion(v.id)}
                  onDelete={userRole === 'ADMIN' ? (e) => deleteVersion(v.id, v.name, e) : undefined}
                  onArchive={undefined}
                  onRestore={(e) => restoreVersion(v.id, e)}
                />
              ))}
              {versions.filter(v => ['COMPLETED', 'ROLLED_BACK'].includes(v.status)).length === 0 && (
                <div style={{ textAlign: 'center', padding: '30px', color: C.textMuted, background: C.bgCard, borderRadius: '12px', border: `1px solid ${C.border}` }}>
                  אין גרסאות בארכיון
                </div>
              )}
            </div>
          </div>
        )}
        </>
      )}
      <ConfirmDialog config={outerDialog} onClose={() => setOuterDialog(null)} />

    </div>
  );
};

const fmtDateTime = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('he-IL')} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
};

const VersionCard: React.FC<{
  v: Version;
  isDeleting: boolean;
  onOpen: () => void;
  onDelete?: (e: React.MouseEvent) => void;
  onArchive?: (e: React.MouseEvent) => void;
  onRestore?: (e: React.MouseEvent) => void;
}> = ({ v, isDeleting, onOpen, onDelete, onArchive, onRestore }) => {
  const [hovered, setHovered] = React.useState(false);
  const statusColor = versionStatusColor[v.status] ?? C.textMuted;
  const isActive = ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(v.status);

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? C.bgHover : C.bgElevated,
        borderRadius: RADIUS.xl,
        padding: `${SP[4]} ${SP[5]}`,
        border: `1px solid ${hovered ? C.borderEm : C.border}`,
        borderRight: `3px solid ${statusColor}`,
        cursor: 'pointer',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: FONT, gap: SP[4],
        transition: EASE.fast,
        boxShadow: hovered ? SHADOW.md : SHADOW.sm,
        position: 'relative', overflow: 'hidden',
      }}
    >
      {/* Glow for active versions */}
      {isActive && (
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: '120px', pointerEvents: 'none',
          background: `linear-gradient(to left, ${statusColor}08, transparent)`,
        }} />
      )}

      {/* Left: metadata */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Row 1: Name + chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], marginBottom: SP[2], flexWrap: 'wrap' }}>
          <span style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{v.name}</span>
          <VersionStatusChip status={v.status} size="sm" />
          {v.status === 'APPROVED' && v.lastRehearsalAt && (
            <Badge color={C.brand} bg={C.brandDim}>🚀 ממתין לייצור</Badge>
          )}
          {v.status === 'MORNING_AFTER' && (
            <Badge color={C.statusWaiting} bg={C.bgWaiting}>🌅 פעילות בוקר</Badge>
          )}
          {v.status === 'COMPLETED' && (
            <Badge color={C.success} bg={C.successBg}>✅ בייצור</Badge>
          )}
        </div>

        {/* Row 2: Meta info */}
        <div style={{ display: 'flex', gap: SP[4], flexWrap: 'wrap', alignItems: 'center' }}>
          {v.description && (
            <span style={{ ...TEXT.sm, color: C.textMuted }}>{v.description}</span>
          )}
          {v.importedFileName && (
            <span style={{ ...TEXT.xs, color: C.textLink, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              {v.importedFileName}
            </span>
          )}
          {v.plannedStart && (
            <span style={{ ...TEXT.xs, color: C.textMuted, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              {fmtDateTime(v.plannedStart)}
            </span>
          )}
          {v.plannedEnd && (
            <span style={{ ...TEXT.xs, color: C.warning, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              {fmtDateTime(v.plannedEnd)}
            </span>
          )}
          {v.reviewMeetingTime && (
            <span style={{ ...TEXT.xs, color: C.brand, display: 'flex', alignItems: 'center', gap: '4px' }}>
              🗓 סקירת CR-ים: {fmtDateTime(v.reviewMeetingTime)}
            </span>
          )}
          {v.taskCount !== undefined && (
            <Badge color={C.statusOpen} bg={C.bgOpen}>{v.taskCount} משימות</Badge>
          )}
          <span style={{ ...TEXT.xs, color: C.textDisabled }}>
            {v.creator?.fullName} · {new Date(v.createdAt).toLocaleDateString('he-IL')}
          </span>
          {v.lastRehearsalAt && (
            <Badge color={C.warning} bg={C.bgInProgress}>🎭 {fmtDateTime(v.lastRehearsalAt)}</Badge>
          )}
        </div>
      </div>

      {/* Right: actions */}
      <div
        style={{ display: 'flex', gap: SP[2], alignItems: 'center', flexShrink: 0 }}
        onClick={e => e.stopPropagation()}
      >
        {onRestore && (
          <Button variant="success" size="sm" onClick={e => onRestore(e as any)}>↩ שחזר</Button>
        )}
        {onArchive && (
          <Button variant="ghost" size="sm" onClick={e => onArchive(e as any)}>📦</Button>
        )}
        {onDelete && (
          <Button
            variant="danger"
            size="sm"
            loading={isDeleting}
            onClick={e => onDelete(e as any)}
          >
            {isDeleting ? 'מוחק...' : '🗑'}
          </Button>
        )}
        <span style={{ color: C.brand, fontSize: '16px', marginRight: SP[1] }}>←</span>
      </div>
    </div>
  );
};

// ── Task table column widths (used by header + rows) ─────────────────────────
// Fixed-width columns (px). name + deps are flex (see VersionTaskHeader / task row).
const TV = { num: 36, dur: 88, start: 118, end: 118, team: 128, assignee: 148, app: 110, env: 96, status: 116, actions: 96 };

// Team color palette — consistent per team name via hash
const TEAM_PALETTE = [
  { bg: '#dbeafe', color: '#1e40af' }, { bg: '#dcfce7', color: '#166534' },
  { bg: '#fef3c7', color: '#92400e' }, { bg: '#fce7f3', color: '#9d174d' },
  { bg: '#ede9fe', color: '#5b21b6' }, { bg: '#ffedd5', color: '#9a3412' },
  { bg: '#cffafe', color: '#164e63' }, { bg: '#f0fdf4', color: '#14532d' },
  { bg: '#fdf4ff', color: '#7e22ce' }, { bg: '#fff1f2', color: '#9f1239' },
];
const teamColorFor = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TEAM_PALETTE[h % TEAM_PALETTE.length];
};
const isNextDay = (startIso: string, endIso: string) => {
  if (!startIso || !endIso) return false;
  return new Date(endIso).setHours(0,0,0,0) > new Date(startIso).setHours(0,0,0,0);
};
// Flex-grow ratios: name gets 3 parts, deps gets 2 parts of the remaining space
const TV_NAME_FLEX = 3;
const TV_DEPS_FLEX = 2;

const VColH: React.FC<{ label: string; width?: number; flexGrow?: number; center?: boolean }> = ({ label, width, flexGrow, center }) => (
  <div style={{
    width: width ? `${width}px` : undefined,
    flex: flexGrow ? `${flexGrow} 1 0` : undefined,
    flexShrink: width ? 0 : undefined,
    minWidth: flexGrow ? '80px' : undefined,
    padding: `0 ${SP[2]}`, fontSize: '12px', fontWeight: WEIGHT.semibold, color: C.textMuted, fontFamily: FONT,
    textAlign: (center ? 'center' : 'right') as any, textTransform: 'uppercase' as any, letterSpacing: '0.04em', whiteSpace: 'nowrap' as any,
  }}>{label}</div>
);

const VersionTaskHeader: React.FC<{ isLocked: boolean; isManager?: boolean }> = ({ isLocked, isManager }) => (
  <div style={{
    display: 'flex', alignItems: 'center',
    background: C.bgNested, borderBottom: `2px solid ${C.border}`,
    padding: `${SP[1]} 0`, userSelect: 'none' as any,
  }}>
    <div style={{ width: `${TV.num}px`, flexShrink: 0 }} />
    <VColH label="שם משימה"  flexGrow={TV_NAME_FLEX} />
    <VColH label="תלויות"    flexGrow={TV_DEPS_FLEX} />
    <VColH label="משך"       width={TV.dur}      center />
    <VColH label="התחלה"    width={TV.start}    center />
    <VColH label="סיום"     width={TV.end}      center />
    <VColH label="צוות"     width={TV.team}     center />
    <VColH label="אחראי"    width={TV.assignee} center />
    <VColH label="אפליקציה" width={TV.app}      center />
    <VColH label="סביבה"    width={TV.env}      center />
    <VColH label="סטטוס"    width={TV.status}   center />
    {isManager && !isLocked && <div style={{ width: `${TV.actions}px`, flexShrink: 0 }} />}
  </div>
);

const VersionDetail: React.FC<{
  version: any;
  token: string;
  userRole: string;
  onBack: () => void;
  onRefresh: () => void;
  onStatusChange: (s: string, force?: boolean) => Promise<void>;
  onGoLive?: (versionId: string, versionName: string, isRehearsal: boolean) => void;
  showDepToast?: (affected: any[]) => void;
}> = ({ version, token, userRole, onBack, onRefresh, onStatusChange, onGoLive, showDepToast }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const isManager = ['RELEASE_MANAGER', 'ADMIN'].includes(userRole);
  const { can } = usePermissions();
  const hasOverride = can('action:override_version_edit');
  // APPROVED and ACTIVE: locked unless user has override permission
  // REHEARSAL, MORNING_AFTER, COMPLETED, ROLLED_BACK: always locked
  const isLocked =
    ['REHEARSAL', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(version.status) ||
    (['APPROVED', 'ACTIVE'].includes(version.status) && !hasOverride);

  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [forceDialog, setForceDialog] = useState<{ details: string; targetStatus: string } | null>(null);

  const handleStatusChange = async (s: string, force?: boolean) => {
    setStatusError(null);
    setStatusLoading(true);
    try {
      await onStatusChange(s, force);
      if ((s === 'ACTIVE' || s === 'REHEARSAL') && onGoLive) {
        onGoLive(version.id, version.name, s === 'REHEARSAL');
      }
    } catch (err: any) {
      const msg: string = err?.response?.data?.message || err?.message || 'שגיאה';
      if (!force && msg.startsWith('הצוותים הבאים טרם הגישו:')) {
        const details = msg.replace('הצוותים הבאים טרם הגישו: ', '');
        setForceDialog({ details, targetStatus: s });
      } else if (!force && msg.includes('שטרם אושרו ע"י מנהל CR')) {
        setForceDialog({ details: msg, targetStatus: s });
      } else {
        setStatusError(msg);
      }
    } finally {
      setStatusLoading(false);
    }
  };

  const [viewMode, setViewMode] = useState<'detail' | 'plan'>('detail');

  const [addingTask, setAddingTask] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<any | null>(null);
  const [editFilters, setEditFilters] = useState({ user: '', team: '', app: '' });
  const [editSaveOk, setEditSaveOk] = useState(false);
  const [newDepId, setNewDepId] = useState('');
  const [newTaskDepIds, setNewTaskDepIds] = useState<string[]>([]);
  const [newDepAddSelectId, setNewDepAddSelectId] = useState('');
  const [dragging, setDragging] = useState<{ taskId: string; fromSubId: string } | null>(null);
  const [dragOverSubId, setDragOverSubId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [lastUserDepPairs, setLastUserDepPairs] = useState<{ taskId: string; dependsOnTaskId: string }[] | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<{ taskId: string; taskTitle: string; targetSubId: string; targetSubName: string } | null>(null);
  const [newTask, setNewTask] = useState<any>(EMPTY_TASK);
  const [proposals, setProposals] = useState<any[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [users, setUsers] = useState<{ id: string; fullName: string }[]>([]);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [collapsedSubPhases, setCollapsedSubPhases] = useState<Set<string>>(new Set());
  const [filterTeam, setFilterTeam] = useState<string | null>(null);
  const [editingPlannedEnd, setEditingPlannedEnd] = useState(false);
  const [plannedEndValue, setPlannedEndValue] = useState(
    version.plannedEnd ? new Date(version.plannedEnd).toISOString().slice(0, 16) : ''
  );
  const [editingReviewMeeting, setEditingReviewMeeting] = useState(false);
  const [reviewMeetingValue, setReviewMeetingValue] = useState(
    version.reviewMeetingTime ? new Date(version.reviewMeetingTime).toISOString().slice(0, 16) : ''
  );
  const [editingWorkPlanMeeting, setEditingWorkPlanMeeting] = useState(false);
  const [workPlanMeetingValue, setWorkPlanMeetingValue] = useState(
    version.workPlanMeetingTime ? new Date(version.workPlanMeetingTime).toISOString().slice(0, 16) : ''
  );
  const [editingSubmissionDeadline, setEditingSubmissionDeadline] = useState(false);
  const [submissionDeadlineValue, setSubmissionDeadlineValue] = useState(
    (version as any).submissionDeadline ? new Date((version as any).submissionDeadline).toISOString().slice(0, 16) : ''
  );
  const [editingApprovalDeadline, setEditingApprovalDeadline] = useState(false);
  const [approvalDeadlineValue, setApprovalDeadlineValue] = useState(
    (version as any).approvalDeadline ? new Date((version as any).approvalDeadline).toISOString().slice(0, 16) : ''
  );
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [reschPhaseStarts, setReschPhaseStarts] = useState<Record<string, string>>({});
  const [reschPhaseEnds, setReschPhaseEnds] = useState<Record<string, string>>({});
  const [reschPreview, setReschPreview] = useState<any[] | null>(null);
  const [reschLoading, setReschLoading] = useState(false);
  const [reschError, setReschError] = useState<string | null>(null);
  const [reschWarnings, setReschWarnings] = useState<string[]>([]);
  const [reschRespectDeps, setReschRespectDeps] = useState(false);
  const [reschTaskOverrides, setReschTaskOverrides] = useState<Record<string, string>>({});
  const [reschEditingId, setReschEditingId] = useState<string | null>(null);
  const [reschEditStart, setReschEditStart] = useState('');
  const [reschEditDur, setReschEditDur] = useState('');
  const [reschEditEnd, setReschEditEnd] = useState('');
  const [teamRefreshKey, setTeamRefreshKey] = useState(0);
  const [dialog, setDialog] = useState<DialogConfig | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertResult, setConvertResult] = useState<{ created: number; skipped: { title: string; reason: string }[]; tasks: { title: string; phaseName: string; subPhaseName: string }[] } | null>(null);
  const [lastConvertedAt, setLastConvertedAt] = useState<Date | null>(null);
  const [showAssignPreview, setShowAssignPreview] = useState(false);
  const [previewItems, setPreviewItems] = useState<{ proposal: any; checked: boolean }[]>([]);
  const [prepOpen, setPrepOpen] = useState(false);
  const [prepMessage, setPrepMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [saveTemplateMode, setSaveTemplateMode] = useState<'update' | 'new'>('update');
  const [saveTemplateSelectId, setSaveTemplateSelectId] = useState('');
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [localTemplates, setLocalTemplates] = useState<any[]>([]);
  const [crItems, setCrItems] = useState<{ id: string; label: string }[]>([]);
  const [newCrInput, setNewCrInput] = useState('');
  const [editCrInput, setEditCrInput] = useState('');
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignFrom, setReassignFrom] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [reassignPhaseId, setReassignPhaseId] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [reassignResult, setReassignResult] = useState<{ updated: number; toUserName: string } | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [collectingTeamsExpanded, setCollectingTeamsExpanded] = useState(false);
  const [reminderSending, setReminderSending] = useState(false);
  const [reminderResult, setReminderResult] = useState<{ sent: number; teams: string[] } | null>(null);
  const [crSummary, setCrSummary] = useState<any[] | null>(null);
  const [crSummaryLoading, setCrSummaryLoading] = useState(false);
  const [crSummaryExpanded, setCrSummaryExpanded] = useState(false);
  const [teamPanelOpen, setTeamPanelOpen] = useState<{ teamId: string; teamName: string } | null>(null);
  const [crAllApproved, setCrAllApproved] = useState(false);
  const [crReviewExpanded, setCrReviewExpanded] = useState(false);
  const [crPanelRefreshKey, setCrPanelRefreshKey] = useState(0);
  const [selectedTask, setSelectedTask] = useState<any | null>(null);
  const [selectedTaskSubId, setSelectedTaskSubId] = useState<string | undefined>();
  const [selectedTaskPhaseOrder, setSelectedTaskPhaseOrder] = useState<number>(0);
  const [selectedTaskPhaseStart, setSelectedTaskPhaseStart] = useState<string | undefined>();
  const [selectedTaskPhaseEnd, setSelectedTaskPhaseEnd] = useState<string | undefined>();

  useEffect(() => {
    if (!crSummary || crSummary.length === 0) return;
    const done = crSummary.filter((t: any) => t.status === 'COMPLETE' || t.status === 'NOT_REQUIRED').length;
    setCrAllApproved(done === crSummary.length);
  }, [crSummary]); // eslint-disable-line

  const refreshCrSummary = () => {
    if (!isManager) return;
    setCrSummaryLoading(true);
    // Re-sync from file then refresh summary
    axios.post(`${API}/version-cr-assignments/version/${version.id}/sync`, {}, { headers })
      .catch(() => {})
      .finally(() => {
        axios.get(`${API}/import/cr-summary?versionId=${version.id}`, { headers })
          .then(r => setCrSummary(r.data))
          .catch(() => {})
          .finally(() => setCrSummaryLoading(false));
      });
  };

  const refreshProposals = () => {
    if (FEATURES.TEAM_LEAD_PROPOSAL && isManager) {
      axios.get(`${API}/task-proposals/version/${version.id}`, { headers })
        .then(r => setProposals(r.data.filter((p: any) => !p.usedInTaskId)))
        .catch(() => {});
    }
  };

  const closeTeamPanel = () => {
    setTeamPanelOpen(null);
    onRefresh();
    refreshCrSummary();
    setCrPanelRefreshKey(k => k + 1);
  };

  // Phase management
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [editingPhaseName, setEditingPhaseName] = useState('');
  const [addingPhase, setAddingPhase] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [phaseManageLoading, setPhaseManageLoading] = useState(false);
  const [phaseManageError, setPhaseManageError] = useState<string | null>(null);

  useEffect(() => {
    axios.get(`${API}/teams`, { headers }).then(r => setTeams(r.data)).catch(() => {});
    axios.get(`${API}/users`, { headers })
      .then(r => setUsers(r.data.filter((u: any) => u.active).sort((a: any, b: any) => a.fullName.localeCompare(b.fullName, 'he'))))
      .catch(() => {});
    axios.get(`${API}/version-templates`, { headers }).then(r => setLocalTemplates(r.data)).catch(() => {});
    axios.get(`${API}/qc/cr-items?versionId=${version.id}`, { headers }).then(r => setCrItems(r.data)).catch(() => {});
    if (version.status === 'CR_REVIEW' && isManager) {
      // Auto-sync CR assignments from Excel in background, then fetch summary
      setCrSummaryLoading(true);
      axios.post(`${API}/version-cr-assignments/version/${version.id}/sync`, {}, { headers })
        .catch((e: any) => { console.warn('[CR Sync]', e?.response?.data?.message || e?.message); })
        .finally(() => {
          axios.get(`${API}/import/cr-summary?versionId=${version.id}`, { headers })
            .then(r => setCrSummary(r.data?.length > 0 ? r.data : null))
            .catch(() => setCrSummary(null))
            .finally(() => setCrSummaryLoading(false));
        });
    }
  }, []); // eslint-disable-line

  // Reload proposals whenever the version refreshes (onRefresh triggers re-render with new version object)
  useEffect(() => {
    if (FEATURES.TEAM_LEAD_PROPOSAL && isManager) {
      axios.get(`${API}/task-proposals/version/${version.id}`, { headers })
        .then(r => setProposals(r.data.filter((p: any) => !p.usedInTaskId)))
        .catch(() => {});
    }
  }, [version.id, version.updatedAt ?? version.id]); // eslint-disable-line

  // Real-time: reload proposals when a team lead submits a new proposal
  useEffect(() => {
    if (!FEATURES.TEAM_LEAD_PROPOSAL || !isManager) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.versionId === version.id) {
        axios.get(`${API}/task-proposals/version/${version.id}`, { headers })
          .then(r => setProposals(r.data.filter((p: any) => !p.usedInTaskId)))
          .catch(() => {});
      }
    };
    window.addEventListener('deploycenter:proposalCreated', handler);
    return () => window.removeEventListener('deploycenter:proposalCreated', handler);
  }, [version.id, isManager]); // eslint-disable-line

  const handleConvertProposals = async () => {
    setConverting(true);
    try {
      const res = await axios.post(`${API}/task-proposals/version/${version.id}/convert-approved`, {}, { headers });
      setConvertResult({ created: res.data.created ?? 0, skipped: res.data.skipped ?? [], tasks: res.data.tasks ?? [] });
      if ((res.data.created ?? 0) > 0) setLastConvertedAt(new Date());
      axios.get(`${API}/task-proposals/version/${version.id}`, { headers })
        .then(r => setProposals(r.data.filter((p: any) => !p.usedInTaskId)))
        .catch(() => {});
      onRefresh?.();
    } catch (err: any) {
      setConvertResult({ created: 0, skipped: [{ title: '—', reason: err?.response?.data?.message || 'שגיאה בשיבוץ' }], tasks: [] });
    } finally { setConverting(false); }
  };

  const openAssignPreview = () => {
    // Fetch fresh data so edits made after submission are reflected
    axios.get(`${API}/task-proposals/version/${version.id}`, { headers })
      .then(r => {
        const fresh = (r.data as any[]).filter((p: any) => !p.usedInTaskId);
        setProposals(fresh);
        setPreviewItems(fresh.map((p: any) => ({
          proposal: p,
          checked: p.reviewStatus === 'APPROVED',
        })));
        setShowAssignPreview(true);
      })
      .catch(() => {
        // Fallback to cached data
        const pending = proposals.filter((p: any) => !p.usedInTaskId);
        setPreviewItems(pending.map((p: any) => ({
          proposal: p,
          checked: p.reviewStatus === 'APPROVED',
        })));
        setShowAssignPreview(true);
      });
  };

  const handleDeleteFromPreview = async (id: string) => {
    try {
      await axios.delete(`${API}/task-proposals/${id}`, { headers });
      setPreviewItems(prev => prev.filter(item => item.proposal.id !== id));
      setProposals(prev => prev.filter((p: any) => p.id !== id));
    } catch { /* ignore */ }
  };

  const handleConfirmAssign = async () => {
    const selectedIds = previewItems.filter(i => i.checked).map(i => i.proposal.id);
    setShowAssignPreview(false);
    if (selectedIds.length === 0) return;
    setConverting(true);
    try {
      const res = await axios.post(
        `${API}/task-proposals/version/${version.id}/convert-approved`,
        { proposalIds: selectedIds },
        { headers },
      );
      setConvertResult({ created: res.data.created ?? 0, skipped: res.data.skipped ?? [], tasks: res.data.tasks ?? [] });
      if ((res.data.created ?? 0) > 0) setLastConvertedAt(new Date());
      axios.get(`${API}/task-proposals/version/${version.id}`, { headers })
        .then(r => setProposals(r.data.filter((p: any) => !p.usedInTaskId)))
        .catch(() => {});
      onRefresh?.();
    } catch (err: any) {
      setConvertResult({ created: 0, skipped: [{ title: '—', reason: err?.response?.data?.message || 'שגיאה בשיבוץ' }], tasks: [] });
    } finally { setConverting(false); }
  };

  const showAlert = (title: string, message: string, variant: DialogConfig['variant'] = 'info') =>
    setDialog({ title, message, variant, onConfirm: () => setDialog(null) });

  const showConfirm = (title: string, message: string, onConfirm: () => void, confirmLabel = 'אישור', variant: DialogConfig['variant'] = 'danger') =>
    setDialog({ title, message, variant, confirmLabel, onConfirm: () => { setDialog(null); onConfirm(); }, onCancel: () => setDialog(null) });

  const togglePhase = (id: string) => {
    setCollapsedPhases(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleSubPhase = (id: string) => {
    setCollapsedSubPhases(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const savePhaseRename = async (phaseId: string) => {
    const name = editingPhaseName.trim();
    if (!name) return;
    setPhaseManageLoading(true);
    setPhaseManageError(null);
    try {
      await axios.patch(`${API}/versions/phases/${phaseId}`, { name }, { headers });
      setEditingPhaseId(null);
      onRefresh();
    } catch (err: any) {
      setPhaseManageError(err?.response?.data?.message || 'שגיאה בשינוי שם');
    } finally { setPhaseManageLoading(false); }
  };

  const setGoNogoPhase = async (phaseId: string) => {
    setPhaseManageLoading(true);
    setPhaseManageError(null);
    try {
      await axios.patch(`${API}/versions/phases/${phaseId}`, { isGoNoGo: true }, { headers });
      onRefresh();
    } catch (err: any) {
      setPhaseManageError(err?.response?.data?.message || 'שגיאה');
    } finally { setPhaseManageLoading(false); }
  };

  const deletePhase = async (phaseId: string, phaseName: string) => {
    showConfirm('מחיקת שלב', `למחוק את השלב "${phaseName}"? פעולה זו אינה הפיכה.`, async () => {
      setPhaseManageLoading(true);
      setPhaseManageError(null);
      try {
        await axios.delete(`${API}/versions/phases/${phaseId}`, { headers });
        onRefresh();
      } catch (err: any) {
        setPhaseManageError(err?.response?.data?.message || 'שגיאה במחיקת שלב');
      } finally { setPhaseManageLoading(false); }
    });
  };

  const addPhase = async () => {
    const name = newPhaseName.trim();
    if (!name) return;
    const maxOrder = Math.max(0, ...(version.phases || []).map((p: any) => p.orderIndex));
    setPhaseManageLoading(true);
    setPhaseManageError(null);
    try {
      const phaseRes = await axios.post(`${API}/versions/${version.id}/phases`, { name, orderIndex: maxOrder + 1 }, { headers });
      await axios.post(`${API}/versions/phases/${phaseRes.data.id}/sub-phases`, { name: 'כללי', orderIndex: 1 }, { headers });
      setAddingPhase(false);
      setNewPhaseName('');
      onRefresh();
    } catch (err: any) {
      setPhaseManageError(err?.response?.data?.message || 'שגיאה בהוספת שלב');
    } finally { setPhaseManageLoading(false); }
  };

  const addSubPhase = async (phaseId: string) => {
    setPhaseManageLoading(true);
    setPhaseManageError(null);
    try {
      const phase = (version.phases || []).find((p: any) => p.id === phaseId);
      const maxOrder = Math.max(0, ...(phase?.subPhases || []).map((s: any) => s.orderIndex));
      await axios.post(`${API}/versions/phases/${phaseId}/sub-phases`, { name: 'כללי', orderIndex: maxOrder + 1 }, { headers });
      onRefresh();
    } catch (err: any) {
      setPhaseManageError(err?.response?.data?.message || 'שגיאה בהוספת תת-שלב');
    } finally { setPhaseManageLoading(false); }
  };

  const formatTime = (iso: string) => iso ? new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '';
  const formatDate = (iso: string) => iso ? new Date(iso).toLocaleDateString('he-IL') : '';
  const formatDateTimeShort = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
  };

  const calcDuration = (start: string, end: string) => {
    if (!start || !end) return null;
    const diff = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
    if (diff <= 0) return null;
    return diff >= 60 ? `${Math.floor(diff / 60)}ש' ${diff % 60}דק'` : `${diff} דק'`;
  };

  const parseDurationToMinutes = (dur: string): number | null => {
    if (!dur) return null;
    const hMatch = dur.match(/(\d+)ש/);
    const mMatch = dur.match(/(\d+)ד/);
    if (hMatch || mMatch) return (hMatch ? parseInt(hMatch[1]) * 60 : 0) + (mMatch ? parseInt(mMatch[1]) : 0);
    const colonMatch = dur.match(/^(\d+):(\d{2})$/);
    if (colonMatch) return parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2]);
    const n = parseInt(dur); return isNaN(n) ? null : n;
  };

  const computeEndFromDuration = (start: string, dur: string): string | null => {
    const mins = parseDurationToMinutes(dur);
    if (!mins || !start) return null;
    const d = new Date(new Date(start).getTime() + mins * 60000);
    return isNaN(d.getTime()) ? null : d.toISOString();
  };

  const minsToStr = (mins: number): string => {
    if (!mins || mins <= 0) return '';
    if (mins < 60) return `${mins} דק'`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}ש' ${m}דק'` : `${h}ש'`;
  };

  const calcEndFromMins = (start: string, mins: number): string => {
    const d = new Date(new Date(start).getTime() + mins * 60000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // Convert UTC ISO string to local-time string for datetime-local inputs
  const utcToLocalInputStr = (iso: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // Convert local-time string (from datetime-local input) to UTC ISO for the API
  const toUtcIso = (str: string): string | undefined => {
    if (!str) return undefined;
    const d = new Date(str);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  };

  // Cutoff = version.plannedEnd, or 04:00 next morning derived from version.plannedStart
  const cutoff: Date | null = (() => {
    if (version.plannedEnd) return new Date(version.plannedEnd);
    if (version.plannedStart) {
      const d = new Date(version.plannedStart);
      d.setDate(d.getDate() + 1);
      d.setHours(4, 0, 0, 0);
      return d;
    }
    return null;
  })();

  // Compute min start / max end for a list of tasks; flag overrun vs the effective cutoff.
  // phaseCutoff overrides the global cutoff when a phase has its own plannedEnd deadline.
  const getHierarchyTimes = (tasks: any[], phaseCutoff?: Date | null) => {
    const starts = tasks
      .filter(t => t.plannedStart)
      .map(t => new Date(t.plannedStart).getTime());

    const ends = tasks
      .map(t => {
        if (t.plannedEnd) return new Date(t.plannedEnd).getTime();
        if (t.plannedStart && t.duration) {
          const mins = parseDurationToMinutes(t.duration);
          if (mins) return new Date(t.plannedStart).getTime() + mins * 60000;
        }
        return null;
      })
      .filter((v): v is number => v !== null);

    if (!starts.length && !ends.length) return null;
    const minStart = starts.length ? Math.min(...starts) : null;
    const maxEnd = ends.length ? Math.max(...ends) : null;
    const startIso = minStart ? new Date(minStart).toISOString() : null;
    const endIso = maxEnd ? new Date(maxEnd).toISOString() : null;
    const dur = startIso && endIso ? calcDuration(startIso, endIso) : null;
    const effectiveCutoff = phaseCutoff !== undefined ? phaseCutoff : cutoff;
    const overrun = !!(effectiveCutoff && maxEnd && maxEnd > effectiveCutoff.getTime());
    return { startIso, endIso, dur, overrun, effectiveCutoff };
  };

  const savePlannedEnd = async () => {
    if (!plannedEndValue) return;
    try {
      await axios.patch(`${API}/versions/${version.id}/planned-end`, { plannedEnd: plannedEndValue }, { headers });
      setEditingPlannedEnd(false);
      onRefresh();
    } catch (err: any) {
      showAlert('שגיאה', err?.response?.data?.message || 'שגיאה בשמירת שעת סיום', 'danger');
    }
  };

  const saveReviewMeetingTime = async () => {
    try {
      await axios.patch(`${API}/versions/${version.id}/review-meeting-time`, { reviewMeetingTime: reviewMeetingValue || null }, { headers });
      setEditingReviewMeeting(false);
      onRefresh();
    } catch (err: any) {
      showAlert('שגיאה', err?.response?.data?.message || 'שגיאה בשמירת מועד הישיבה', 'danger');
    }
  };

  const saveWorkPlanMeetingTime = async () => {
    try {
      await axios.patch(`${API}/versions/${version.id}`, { workPlanMeetingTime: workPlanMeetingValue || null }, { headers });
      setEditingWorkPlanMeeting(false);
      onRefresh();
    } catch (err: any) {
      showAlert('שגיאה', err?.response?.data?.message || 'שגיאה בשמירת מועד הישיבה', 'danger');
    }
  };

  const saveSubmissionDeadline = async () => {
    try {
      await axios.patch(`${API}/versions/${version.id}`, { submissionDeadline: submissionDeadlineValue || null }, { headers });
      setEditingSubmissionDeadline(false);
      onRefresh();
    } catch (err: any) {
      showAlert('שגיאה', err?.response?.data?.message || 'שגיאה בשמירת מועד הגשה', 'danger');
    }
  };

  const saveApprovalDeadline = async () => {
    try {
      await axios.patch(`${API}/versions/${version.id}`, { approvalDeadline: approvalDeadlineValue || null }, { headers });
      setEditingApprovalDeadline(false);
      onRefresh();
    } catch (err: any) {
      showAlert('שגיאה', err?.response?.data?.message || 'שגיאה בשמירת מועד אישור', 'danger');
    }
  };

  const openReschedule = () => {
    const starts: Record<string, string> = {};
    const ends: Record<string, string> = {};

    // Fixed default times per phase position (Day D = version.plannedStart date)
    const PHASE_DEFAULTS = [
      { startH: 8,  startM: 30, startOff: 0, endH: 16, endM: 30, endOff: 0 }, // Phase 1: בוקר גרסה      08:30 → 16:30 יום D
      { startH: 22, startM: 0,  startOff: 0, endH: 23, endM: 59, endOff: 0 }, // Phase 2: לילה HOTNET    22:00 → 23:59 יום D
      { startH: 0,  startM: 48, startOff: 1, endH: 4,  endM: 0,  endOff: 1 }, // Phase 3: לילה HOT       00:48 → 04:00 יום D+1
      { startH: 7,  startM: 30, startOff: 1, endH: 16, endM: 30, endOff: 1 }, // Phase 4: בוקר לאחר      07:30 → 16:30 יום D+1
    ];

    // Base date: take the date component of version.plannedStart in local time
    const baseDate = version.plannedStart ? new Date(version.plannedStart) : null;

    const sortedPhases = [...(version.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);

    for (let i = 0; i < sortedPhases.length; i++) {
      const phase = sortedPhases[i];
      const def = PHASE_DEFAULTS[i]; // undefined for 5th+ phases

      // ── Start time: saved → task-derived → default ──
      if (phase.plannedStart) {
        starts[phase.id] = utcToLocalInputStr(phase.plannedStart);
      } else {
        const allTasks = (phase.subPhases || []).flatMap((s: any) => s.tasks || []);
        const firstTask = allTasks
          .filter((t: any) => t.plannedStart)
          .sort((a: any, b: any) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime())[0];
        if (firstTask?.plannedStart) {
          starts[phase.id] = utcToLocalInputStr(firstTask.plannedStart);
        } else if (baseDate && def) {
          const d = new Date(baseDate);
          d.setDate(d.getDate() + def.startOff);
          d.setHours(def.startH, def.startM, 0, 0);
          starts[phase.id] = utcToLocalInputStr(d.toISOString());
        } else {
          starts[phase.id] = '';
        }
      }

      // ── End time: saved → default → D+1 04:00 fallback ──
      if (phase.plannedEnd) {
        ends[phase.id] = utcToLocalInputStr(phase.plannedEnd);
      } else if (baseDate && def) {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + def.endOff);
        d.setHours(def.endH, def.endM, 0, 0);
        ends[phase.id] = utcToLocalInputStr(d.toISOString());
      } else if (starts[phase.id]) {
        const d = new Date(starts[phase.id]);
        d.setDate(d.getDate() + 1);
        d.setHours(4, 0, 0, 0);
        ends[phase.id] = utcToLocalInputStr(d.toISOString());
      } else {
        ends[phase.id] = '';
      }
    }
    setReschPhaseStarts(starts);
    setReschPhaseEnds(ends);
    setReschError(null);

    // Pre-populate preview AND overrides from current DB task times.
    // - dbPreview lets the UI show overrunning tasks immediately without needing an engine run.
    //   Including ALL scheduled tasks prevents stale-clear from wiping non-overrunning tasks.
    // - taskOverrides seeds the engine so "חשב ותצוגה מקדימה" respects saved task positions:
    //   the engine uses max(phaseStart, override), so saved times act as lower-bound anchors.
    const dbPreview: any[] = [];
    const dbOverrides: Record<string, string> = {};
    for (const phase of (version.phases || [])) {
      for (const sub of (phase.subPhases || [])) {
        for (const task of (sub.tasks || [])) {
          if (task.plannedStart && task.plannedEnd && parseDurationToMinutes(task.duration || '')) {
            dbPreview.push({
              taskId: task.id,
              title: task.title,
              phaseId: phase.id,
              phaseName: phase.name,
              duration: task.duration,
              plannedStart: task.plannedStart,
              plannedEnd: task.plannedEnd,
            });
            dbOverrides[task.id] = task.plannedStart;
          }
        }
      }
    }
    setReschPreview(dbPreview.length > 0 ? dbPreview : null);
    setReschTaskOverrides(dbOverrides);
    setReschWarnings([]);
    setRescheduleOpen(true);
  };

  const applyTaskEdit = async (taskId: string) => {
    const newStartIso = reschEditStart ? toUtcIso(reschEditStart) : undefined;
    const newEndIso = reschEditEnd ? toUtcIso(reschEditEnd) : undefined;
    const currentTask = reschPreview?.find(u => u.taskId === taskId);

    // Compute the updated preview imperatively so we can extract cascade results
    // and apply them to reschTaskOverrides without nested state-updater calls.
    const updatedPreview = reschPreview ? reschPreview.map(t => ({ ...t })) : null;
    const cascadeOverrides: Record<string, string> = {};

    if (updatedPreview) {
      const idx = updatedPreview.findIndex(u => u.taskId === taskId);
      if (idx !== -1) {
        const task = updatedPreview[idx];

        if (newStartIso) task.plannedStart = newStartIso;
        if (newEndIso) task.plannedEnd = newEndIso;
        if (reschEditDur) task.duration = reschEditDur;

        // If only start was edited (no explicit end), slide end by same duration
        if (newStartIso && !newEndIso) {
          const mins = parseDurationToMinutes(task.duration || '');
          if (mins && mins > 0) {
            task.plannedEnd = new Date(new Date(task.plannedStart).getTime() + mins * 60000).toISOString();
          }
        }

        if (newStartIso) cascadeOverrides[taskId] = task.plannedStart;

        // Cascade downstream tasks in the same phase
        let cursor = new Date(task.plannedEnd);
        for (let i = idx + 1; i < updatedPreview.length; i++) {
          if (updatedPreview[i].phaseId !== task.phaseId) break;
          const mins = parseDurationToMinutes(updatedPreview[i].duration || '');
          if (!mins || mins <= 0) continue;
          updatedPreview[i].plannedStart = cursor.toISOString();
          updatedPreview[i].plannedEnd = new Date(cursor.getTime() + mins * 60000).toISOString();
          cascadeOverrides[updatedPreview[i].taskId] = cursor.toISOString();
          cursor = new Date(updatedPreview[i].plannedEnd);
        }
      }
    }

    setReschPreview(updatedPreview);
    setReschTaskOverrides(prev => ({ ...prev, ...cascadeOverrides }));

    // Immediately persist the individual task edit to DB.
    // phases: [] prevents stale-clearing logic from touching other tasks.
    if (currentTask) {
      const updatedTask = updatedPreview?.find(u => u.taskId === taskId);
      const startIso = updatedTask?.plannedStart ?? currentTask.plannedStart;
      const endIso = updatedTask?.plannedEnd ?? currentTask.plannedEnd;
      const durationMins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
      const dur = reschEditDur || (durationMins > 0 ? minsToStr(durationMins) : (currentTask.duration ?? undefined));
      try {
        await axios.post(`${API}/versions/${version.id}/apply-schedule`, {
          updates: [{ taskId, plannedStart: startIso, plannedEnd: endIso, duration: dur }],
          phases: [],
        }, { headers });
      } catch (err) { console.error('[applyTaskEdit] immediate save failed', err); }
    }

    setReschEditingId(null);
    setReschEditStart('');
    setReschEditDur('');
    setReschEditEnd('');
  };

  const applyScheduleFromPreview = async () => {
    if (!reschPreview) return;
    setReschLoading(true);
    setReschError(null);
    try {
      const phases = buildPhases();
      const phasesInSchedule = new Set(phases.map(p => p.phaseId));
      // Only send tasks that belong to phases being rescheduled — others are DB previews
      // from phases with unchanged start times and should not be re-written.
      const updates = reschPreview
        .filter(u => phasesInSchedule.has(u.phaseId))
        .map(u => {
          const durationMins = Math.round(
            (new Date(u.plannedEnd).getTime() - new Date(u.plannedStart).getTime()) / 60000
          );
          return {
            taskId: u.taskId,
            plannedStart: u.plannedStart,
            plannedEnd: u.plannedEnd,
            duration: durationMins > 0 ? minsToStr(durationMins) : (u.duration ?? undefined),
          };
        });
      const res = await axios.post(`${API}/versions/${version.id}/apply-schedule`, { updates, phases }, { headers });
      setRescheduleOpen(false);
      setReschPreview(null);
      setReschTaskOverrides({});
      setTeamRefreshKey(k => k + 1);
      onRefresh();
    } catch (err: any) {
      setReschError(err?.response?.data?.message || 'שגיאה בעדכון התוכנית');
    } finally {
      setReschLoading(false);
    }
  };

  const applyPhaseStartToAllTasks = async () => {
    setReschLoading(true);
    setReschError(null);
    try {
      // Delegate to the reschedule engine (non-preview) with no task overrides.
      // The engine applies sub-phase sequential scheduling and respects task-level dependencies.
      await axios.post(`${API}/versions/${version.id}/reschedule?preview=false`, {
        phases: buildPhases(),
        respectDeps: true,
        taskOverrides: [],
      }, { headers });

      setRescheduleOpen(false);
      setReschPreview(null);
      setReschTaskOverrides({});
      setTeamRefreshKey(k => k + 1);
      onRefresh();
    } catch (err: any) {
      setReschError(err?.response?.data?.message || 'שגיאה בעדכון שעות התחלה');
    } finally {
      setReschLoading(false);
    }
  };

  const buildPhases = () =>
    Object.entries(reschPhaseStarts)
      .filter(([, v]) => v)
      .map(([phaseId, startTime]) => ({
        phaseId,
        startTime: toUtcIso(startTime) as string,
        endTime: reschPhaseEnds[phaseId] ? toUtcIso(reschPhaseEnds[phaseId]) as string : undefined,
      }));

  const previewReschedule = async () => {
    setReschLoading(true);
    setReschError(null);
    try {
      const taskOverrides = Object.entries(reschTaskOverrides).map(([taskId, plannedStart]) => ({ taskId, plannedStart }));
      const res = await axios.post(`${API}/versions/${version.id}/reschedule?preview=true`, { phases: buildPhases(), respectDeps: reschRespectDeps, taskOverrides }, { headers });
      setReschPreview(res.data.updates);
      setReschWarnings(res.data.phaseAdjustments ?? []);
      // Update inputs with engine-corrected starts so applyScheduleFromPreview saves the right value.
      if (res.data.adjustedPhaseStartsIso) {
        const corrected: Record<string, string> = {};
        for (const [id, iso] of Object.entries(res.data.adjustedPhaseStartsIso as Record<string, string>)) {
          corrected[id] = utcToLocalInputStr(iso as string);
        }
        setReschPhaseStarts(prev => ({ ...prev, ...corrected }));
      }
    } catch (err: any) {
      setReschError(err?.response?.data?.message || 'שגיאה בתצוגה מקדימה');
    } finally {
      setReschLoading(false);
    }
  };

  const confirmReschedule = async () => {
    setReschLoading(true);
    setReschError(null);
    try {
      await axios.post(`${API}/versions/${version.id}/reschedule?preview=false`, { phases: buildPhases() }, { headers });
      setRescheduleOpen(false);
      setReschPreview(null);
      onRefresh();
    } catch (err: any) {
      setReschError(err?.response?.data?.message || 'שגיאה בתזמון מחדש');
    } finally {
      setReschLoading(false);
    }
  };

  const addTask = async (subPhaseId: string) => {
    try {
      const { _durationMins, ...rest } = newTask;
      const mins = parseInt(_durationMins);
      if (mins > 0) {
        rest.duration = minsToStr(mins);
        if (rest.plannedStart) rest.plannedEnd = calcEndFromMins(rest.plannedStart, mins);
      }
      const taskData = {
        ...rest,
        assignedTeamId: selectedTeam,
        versionId: version.id,
        plannedStart: rest.plannedStart ? toUtcIso(rest.plannedStart) : undefined,
        plannedEnd: rest.plannedEnd ? toUtcIso(rest.plannedEnd) : undefined,
      };
      const res = await axios.post(`${API}/versions/sub-phases/${subPhaseId}/tasks`, taskData, { headers });
      const newTaskId = res.data.id;
      if (FEATURES.TEAM_LEAD_PROPOSAL && selectedProposalId) {
        await axios.patch(`${API}/task-proposals/${selectedProposalId}/mark-used`, { taskId: newTaskId }, { headers }).catch(() => {});
        setSelectedProposalId(null);
        setProposals(prev => prev.filter(p => p.id !== selectedProposalId));
      }
      if (newTaskDepIds.length) {
        await Promise.all(
          newTaskDepIds.map(depId =>
            axios.post(`${API}/versions/tasks/${newTaskId}/dependencies`, { dependsOnTaskId: depId }, { headers }).catch(() => {})
          )
        );
      }
      setAddingTask(null);
      setNewTask(EMPTY_TASK);
      setNewTaskDepIds([]);
      setNewDepAddSelectId('');
      setSelectedTeam('');
      onRefresh();
    } catch (err) { console.error(err); }
  };

  const confirmMove = async () => {
    if (!moveConfirm) return;
    try {
      await axios.patch(`${API}/tasks/${moveConfirm.taskId}`, { subPhaseId: moveConfirm.targetSubId }, { headers });
      onRefresh();
    } catch (err) { console.error(err); }
    finally { setMoveConfirm(null); }
  };

  const duplicateTask = async (taskId: string) => {
    try {
      await axios.post(`${API}/tasks/${taskId}/duplicate`, {}, { headers });
      onRefresh();
    } catch (err) { console.error(err); }
  };

  // Dependency changes are buffered in editingTask local state and only sent to the API on Save.
  // On Cancel the user discards changes without any network call having been made.
  const addDep = (depTask: any) => {
    const dependsOnTaskId = newDepId;
    if (!dependsOnTaskId || !depTask) return;

    // Compute dep's effective end time OUTSIDE setEditingTask so it runs synchronously.
    // Prefer explicit plannedEnd; fall back to plannedStart + duration.
    let depEndLocal: string | null = null;
    if (depTask.plannedEnd) {
      depEndLocal = utcToLocalInputStr(depTask.plannedEnd);
    }
    if (!depEndLocal && depTask.plannedStart) {
      const startLocal = utcToLocalInputStr(depTask.plannedStart);
      const depMins = parseDurationToMinutes(depTask.duration || '');
      if (depMins && depMins > 0) {
        depEndLocal = calcEndFromMins(startLocal, depMins);
      }
    }
    setEditingTask((prev: any) => {
      const newDep = {
        dependsOnTaskId,
        dependsOn: { id: depTask.id, title: depTask.title, status: depTask.status },
      };
      let updated: any = { ...prev, dependencies: [...(prev.dependencies || []), newDep] };

      if (depEndLocal) {
        updated = { ...updated, plannedStart: depEndLocal };
        const taskMins = parseInt(prev._durationMins);
        if (taskMins > 0) updated = { ...updated, plannedEnd: calcEndFromMins(depEndLocal, taskMins) };
      }

      return updated;
    });
    setNewDepId('');
  };

  const removeDep = (dependsOnTaskId: string) => {
    setEditingTask((prev: any) => ({
      ...prev,
      dependencies: prev.dependencies?.filter((d: any) => d.dependsOnTaskId !== dependsOnTaskId),
    }));
  };

  const deleteTask = (taskId: string, taskTitle?: string) => {
    const label = taskTitle ? `"${taskTitle}"` : 'המשימה';
    showConfirm('מחיקת משימה', `למחוק את ${label} לצמיתות? פעולה זו אינה הפיכה.`, async () => {
      try {
        await axios.delete(`${API}/tasks/${taskId}`, { headers });
        onRefresh();
      } catch (err: any) {
        showAlert('שגיאה במחיקת משימה', err?.response?.data?.message || 'שגיאה במחיקת משימה', 'danger');
      }
    }, 'מחק');
  };

  const updateTask = async (taskId: string, data: any) => {
    try {
      const { _durationMins, _originalDeps, dependencies, ...rest } = data;
      const mins = parseInt(_durationMins);
      if (mins > 0) {
        rest.duration = minsToStr(mins);
        if (rest.plannedStart) rest.plannedEnd = calcEndFromMins(rest.plannedStart, mins);
      }
      if (rest.plannedStart) rest.plannedStart = toUtcIso(rest.plannedStart);
      if (rest.plannedEnd) rest.plannedEnd = toUtcIso(rest.plannedEnd);
      await axios.patch(`${API}/tasks/${taskId}`, rest, { headers });

      // Apply buffered dependency changes (diff between original snapshot and current state)
      const origIds = (_originalDeps || []).map((d: any) => d.dependsOnTaskId as string);
      const curIds  = (dependencies || []).map((d: any) => d.dependsOnTaskId as string);
      const origSet = new Set<string>(origIds);
      const curSet  = new Set<string>(curIds);
      const toRemove = origIds.filter((id: string) => !curSet.has(id));
      const toAdd    = curIds.filter((id: string) => !origSet.has(id));
      const depResponses = await Promise.all([
        ...toRemove.map((id: string) => axios.post(`${API}/versions/tasks/${taskId}/dependencies/remove`, { dependsOnTaskId: id }, { headers })),
        ...toAdd.map((id: string) => axios.post(`${API}/versions/tasks/${taskId}/dependencies`, { dependsOnTaskId: id }, { headers })),
      ]);
      if (toRemove.length > 0 || toAdd.length > 0) {
        const allAffected = depResponses.flatMap((r: any) => r.data?.affected ?? []);
        if (allAffected.length > 0) {
          showDepToast?.(allAffected);
        } else {
          const action = toAdd.length > 0 ? 'הוספה' : 'הסרה';
          showDepToast?.([{ subPhaseName: '', phaseName: '', deltaMinutes: 0, action } as any]);
        }
      }

      setEditSaveOk(true);
      setTimeout(() => { setEditSaveOk(false); setEditingTask(null); }, 900);
      onRefresh();
    } catch (err) { console.error(err); }
  };

  // After rehearsal is done, APPROVED → ACTIVE (deploy); otherwise APPROVED → REHEARSAL
  const nextStatus = version.status === 'APPROVED' && version.lastRehearsalAt
    ? 'ACTIVE'
    : NEXT_STATUS[version.status];
  const nextLabel = version.status === 'APPROVED' && version.lastRehearsalAt
    ? 'הפעל פעילות ההטמעה'
    : NEXT_LABEL[version.status];

  return (
    <div>
      {/* ── Force-advance confirmation dialog ── */}
      {forceDialog && (
        <div style={{ position: 'fixed', inset: 0, background: C.bgOverlay, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: C.bgCard, borderRadius: RADIUS['2xl'], padding: '28px 32px', maxWidth: '480px', width: '90%', boxShadow: SHADOW.floating, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: '22px', marginBottom: '10px' }}>⚠️</div>
            <div style={{ fontWeight: 'bold', fontSize: '16px', color: C.textPrimary, marginBottom: '10px' }}>קיימות חסימות לפני המעבר</div>
            <div style={{ background: C.warningBg, border: `1px solid ${C.warning}44`, borderRadius: RADIUS.lg, padding: '10px 14px', fontSize: '14px', fontWeight: 'bold', color: C.warning, marginBottom: '18px' }}>
              {forceDialog.details}
            </div>
            <div style={{ fontSize: '13px', color: C.textMuted, marginBottom: '20px' }}>
              כמנהל לילה, ביכולתך לאשר ולהמשיך בכל זאת.
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button onClick={() => setForceDialog(null)} style={{ padding: '9px 20px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.lg, cursor: 'pointer', fontSize: '14px' }}>ביטול</button>
              <button
                onClick={async () => { const s = forceDialog.targetStatus; setForceDialog(null); await handleStatusChange(s, true); }}
                style={{ padding: '9px 20px', background: C.warning, color: 'white', border: 'none', borderRadius: RADIUS.lg, cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}
              >
                אשר ודחוף קדימה בכל זאת
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Version header ── */}
      <div style={{ background: C.bgCard, borderRadius: RADIUS.xl, padding: '20px', marginBottom: '20px', boxShadow: SHADOW.sm, border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <button onClick={onBack} style={{ padding: '8px 16px', background: C.bgNested, border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.lg, cursor: 'pointer', fontSize: '14px', color: C.textSecondary }}>→ חזור</button>
            <div>
              <h2 style={{ margin: 0, color: C.textPrimary }}>{version.name}</h2>
              {version.description && <p style={{ margin: '4px 0 0', color: C.textMuted, fontSize: '14px' }}>{version.description}</p>}
            </div>
            <VersionStatusChip status={version.status} size="md" />
            {/* Total task count badge — updates live on add/remove */}
            {(() => {
              const total = (version.phases ?? []).flatMap((p: any) => (p.subPhases ?? []).flatMap((s: any) => s.tasks ?? [])).length;
              if (total === 0) return null;
              const done = (version.phases ?? []).flatMap((p: any) => (p.subPhases ?? []).flatMap((s: any) => (s.tasks ?? []).filter((t: any) => t.status === 'DONE'))).length;
              return (
                <span title="סה״כ משימות בתוכנית" style={{ background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '3px 10px', fontSize: '12px', color: C.textSecondary, fontWeight: '600', whiteSpace: 'nowrap' }}>
                  📋 {done > 0 ? `${done}/${total}` : total} משימות
                </span>
              );
            })()}
            {/* Total pending proposals — clickable assign button */}
            {FEATURES.TEAM_LEAD_PROPOSAL && isManager && proposals.filter(p => !p.usedInTaskId).length > 0 && (
              <button
                onClick={openAssignPreview}
                disabled={converting}
                title="פתח תצוגה מקדימה לשיבוץ הצעות"
                style={{
                  background: converting ? '#b7763a' : '#e67e22', color: 'white',
                  padding: '4px 14px', borderRadius: '12px',
                  fontSize: '13px', fontWeight: 'bold', border: 'none',
                  cursor: converting ? 'not-allowed' : 'pointer',
                  animation: converting ? 'none' : 'pulse 2s infinite',
                  whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                {converting ? '⏳ משבץ...' : `📥 שבץ הצעות`}
                <span style={{ background: 'rgba(255,255,255,0.25)', borderRadius: '10px', padding: '0 7px', fontSize: '12px' }}>
                  {proposals.filter(p => !p.usedInTaskId).length}
                </span>
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* UI utilities */}
            {version.status !== 'CR_REVIEW' && <button onClick={() => setCollapsedPhases(new Set(version.phases?.map((p: any) => p.id)))} style={{ padding: '6px 14px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px' }}>▶ קפל הכל</button>}
            {version.status !== 'CR_REVIEW' && <button onClick={() => { setCollapsedPhases(new Set()); setCollapsedSubPhases(new Set()); }} style={{ padding: '6px 14px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px' }}>▼ פתח הכל</button>}

            {/* Manager tools — הכן ותזמן והחלף עובד הועברו לאשף הכנת תוכנית */}
            {isManager && version.status !== 'CR_REVIEW' && (() => {
              const ws = version.wizardState as Record<string, string | null> | null;
              const stepKeys = ['step1', 'step2', 'step3', 'step4', 'step5'];
              const doneCount = ws ? stepKeys.filter(k => ws[k] === 'done').length : 0;
              const allDone = doneCount === 5;
              return (
                <button
                  onClick={() => setWizardOpen(true)}
                  style={{ padding: '6px 14px', background: allDone ? C.success : C.statusWaiting, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}
                >
                  {allDone ? '✅ תוכנית מוכנה — ערוך' : `🔧 הכן תוכנית${ws ? ` ${doneCount}/5` : ''}`}
                </button>
              );
            })()}
            {isManager && version.status !== 'CR_REVIEW' && (
              <button
                onClick={() => {
                  setSaveTemplateMode(localTemplates.length > 0 ? 'update' : 'new');
                  setSaveTemplateSelectId(localTemplates[0]?.id ?? '');
                  setSaveTemplateName('');
                  setSaveTemplateOpen(true);
                }}
                style={{ padding: '6px 14px', background: C.success, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                💾 שמור כתבנית
              </button>
            )}

            {/* Status progression — back buttons (new order: DRAFT→COLLECTING→CR_REVIEW→REFINING) */}
            {isManager && version.status === 'COLLECTING' && (
              <button onClick={() => handleStatusChange('DRAFT')} disabled={statusLoading} style={{ padding: '8px 16px', background: C.bgNested, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, cursor: 'pointer', fontSize: '14px' }}>← חזור לטיוטה</button>
            )}
            {isManager && version.status === 'CR_REVIEW' && (
              <button onClick={() => handleStatusChange('COLLECTING')} disabled={statusLoading} style={{ padding: '8px 16px', background: C.bgNested, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, cursor: 'pointer', fontSize: '14px' }}>← חזור לאיסוף</button>
            )}
            {isManager && version.status === 'REFINING' && (
              <button onClick={() => handleStatusChange('CR_REVIEW')} disabled={statusLoading} style={{ padding: '8px 16px', background: C.bgNested, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, cursor: 'pointer', fontSize: '14px' }}>← חזור לסקירת CR</button>
            )}
            {isManager && version.status === 'REVIEW' && (
              <button onClick={() => handleStatusChange('REFINING')} disabled={statusLoading} style={{ padding: '8px 16px', background: C.bgNested, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, cursor: 'pointer', fontSize: '14px' }}>← חזור לטיוב</button>
            )}
            {version.status === 'APPROVED' && (
              <button onClick={() => handleStatusChange('DRAFT')} disabled={statusLoading} style={{ padding: '8px 16px', background: C.bgNested, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, cursor: 'pointer', fontSize: '14px' }}>← איפוס לטיוטה</button>
            )}
            {version.status === 'APPROVED' && !version.lastRehearsalAt && (
              <button onClick={() => handleStatusChange('ACTIVE')} disabled={statusLoading} style={{ padding: '10px 20px', background: statusLoading ? C.textDisabled : C.textMuted, color: 'white', border: 'none', borderRadius: RADIUS.lg, cursor: statusLoading ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
                {statusLoading ? '...' : 'הפעל ללא חזרה →'}
              </button>
            )}
            {nextStatus && (
              <button
                onClick={async () => {
                  if (nextStatus === 'REFINING') {
                    try {
                      const res = await axios.get(`${API}/import/teams-without-proposals?versionId=${version.id}`, { headers });
                      const missing: { name: string; crCount: number; notRequired: boolean }[] = res.data || [];
                      const pending = missing.filter((t: any) => !t.notRequired);
                      if (pending.length > 0) {
                        setForceDialog({ details: pending.map((t: any) => t.name).join(', '), targetStatus: 'REFINING' });
                        return;
                      }
                    } catch (err: any) {
                      setStatusError('שגיאה בבדיקת הגשות צוותים: ' + (err?.response?.data?.message || err?.message || 'שגיאה לא ידועה'));
                      return;
                    }
                  }
                  handleStatusChange(nextStatus);
                }}
                disabled={statusLoading || (false)}
                title={false ? 'יש לאשר את כל תוכניות ה-CR תחילה' : undefined}
                style={{
                  padding: '10px 20px', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '14px',
                  background: statusLoading || (false) ? '#aaa' : STATUS_COLORS[nextStatus],
                  cursor: statusLoading || (false) ? 'not-allowed' : 'pointer',
                }}>
                {statusLoading ? '...' : `${nextLabel} →`}
              </button>
            )}
            {statusError && (
              <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}44`, borderRadius: RADIUS.lg, padding: '8px 14px', fontSize: '13px', color: C.danger, display: 'flex', alignItems: 'center', gap: '8px' }}>
                ⚠️ {statusError}
                <button onClick={() => setStatusError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.danger, fontWeight: 'bold' }}>×</button>
              </div>
            )}
          </div>
        </div>

        {/* ── Version metadata row ── */}
        {(() => {
          const sortedPhases = [...(version.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
          const phaseB = sortedPhases[1]; // 2nd phase = ליל HOTNET
          const phaseC = sortedPhases[2]; // 3rd phase = לילה HOT
          return (
        <div style={{ marginTop: '14px', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '13px', color: C.textSecondary, alignItems: 'center' }}>
          {version.importedFileName && (
            <span style={{ background: C.infoBg, color: C.info, padding: '3px 10px', borderRadius: RADIUS.full, fontWeight: 'bold' }}>
              📎 {version.importedFileName}
            </span>
          )}
          {phaseB?.plannedStart ? (
            <span title={`שעת התחלה של "${phaseB.name}"`}>
              📅 <strong>התחלה מתוכננת:</strong> {fmtDateTime(phaseB.plannedStart)}
            </span>
          ) : version.plannedStart ? (
            <span>
              📅 <strong>התחלה מתוכננת:</strong> {fmtDateTime(version.plannedStart)}
            </span>
          ) : null}
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            🏁 <strong>סיום מתוכנן:</strong>
            {phaseC?.plannedEnd ? (
              <span style={{ color: C.warning }} title={`שעת סיום של "${phaseC.name}"`}>
                {fmtDateTime(phaseC.plannedEnd)}
              </span>
            ) : editingPlannedEnd ? (
              <>
                <input
                  type="datetime-local"
                  value={plannedEndValue}
                  onChange={e => setPlannedEndValue(e.target.value)}
                  style={{ padding: '4px 8px', border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.md, fontSize: '13px' }}
                />
                <button onClick={savePlannedEnd} style={{ padding: '4px 10px', background: C.success, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '12px' }}>שמור</button>
                <button onClick={() => setEditingPlannedEnd(false)} style={{ padding: '4px 10px', background: C.bgNested, color: C.textSecondary, border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '12px' }}>ביטול</button>
              </>
            ) : (
              <>
                <span style={{ color: version.plannedEnd ? C.warning : C.textDisabled }}>
                  {version.plannedEnd ? fmtDateTime(version.plannedEnd) : 'לא הוגדר (ברירת מחדל: 04:00)'}
                </span>
                {isManager && (
                  <button onClick={() => setEditingPlannedEnd(true)} style={{ padding: '2px 8px', background: C.warningBg, color: C.warning, border: `1px solid ${C.warning}44`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '11px' }}>עריכה</button>
                )}
              </>
            )}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            🗓 <strong>ישיבת סקירת CR-ים:</strong>
            {editingReviewMeeting ? (
              <>
                <input
                  type="datetime-local"
                  value={reviewMeetingValue}
                  onChange={e => setReviewMeetingValue(e.target.value)}
                  style={{ padding: '4px 8px', border: `1px solid ${C.borderFocus}`, borderRadius: RADIUS.md, fontSize: '13px' }}
                />
                <button onClick={saveReviewMeetingTime} style={{ padding: '4px 10px', background: C.info, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '12px' }}>שמור</button>
                <button onClick={() => setEditingReviewMeeting(false)} style={{ padding: '4px 10px', background: C.bgNested, color: C.textSecondary, border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '12px' }}>ביטול</button>
              </>
            ) : (
              <>
                <span style={{ color: version.reviewMeetingTime ? C.info : C.textDisabled, fontWeight: version.reviewMeetingTime ? '600' : 'normal' }}>
                  {version.reviewMeetingTime ? fmtDateTime(version.reviewMeetingTime) : 'לא נקבע'}
                </span>
                {isManager && (
                  <button onClick={() => setEditingReviewMeeting(true)} style={{ padding: '2px 8px', background: C.infoBg, color: C.info, border: `1px solid ${C.borderFocus}44`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '11px' }}>עריכה</button>
                )}
              </>
            )}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            📋 <strong>ישיבת מעבר תוכנית עבודה:</strong>
            {editingWorkPlanMeeting ? (
              <>
                <input
                  type="datetime-local"
                  value={workPlanMeetingValue}
                  onChange={e => setWorkPlanMeetingValue(e.target.value)}
                  style={{ padding: '4px 8px', border: `1px solid ${C.borderFocus}`, borderRadius: RADIUS.md, fontSize: '13px' }}
                />
                <button onClick={saveWorkPlanMeetingTime} style={{ padding: '4px 10px', background: C.info, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '12px' }}>שמור</button>
                <button onClick={() => setEditingWorkPlanMeeting(false)} style={{ padding: '4px 10px', background: C.bgNested, color: C.textSecondary, border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '12px' }}>ביטול</button>
              </>
            ) : (
              <>
                <span style={{ color: version.workPlanMeetingTime ? C.info : C.textDisabled, fontWeight: version.workPlanMeetingTime ? '600' : 'normal' }}>
                  {version.workPlanMeetingTime ? fmtDateTime(version.workPlanMeetingTime) : 'לא נקבע'}
                </span>
                {isManager && (
                  <button onClick={() => setEditingWorkPlanMeeting(true)} style={{ padding: '2px 8px', background: C.infoBg, color: C.info, border: `1px solid ${C.borderFocus}44`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '11px' }}>עריכה</button>
                )}
              </>
            )}
          </span>
          {/* Submission deadline */}
          {(version.status === 'CR_REVIEW' || (version as any).submissionDeadline) && isManager && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              ⏰ <strong>מועד הגשה:</strong>
              {editingSubmissionDeadline ? (
                <>
                  <input type="datetime-local" value={submissionDeadlineValue} onChange={e => setSubmissionDeadlineValue(e.target.value)}
                    style={{ padding: '4px 8px', border: `1px solid ${C.borderFocus}`, borderRadius: RADIUS.md, fontSize: '13px' }} />
                  <button onClick={saveSubmissionDeadline} style={{ padding: '4px 10px', background: C.statusBlocked, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '12px' }}>שמור</button>
                  <button onClick={() => setEditingSubmissionDeadline(false)} style={{ padding: '4px 10px', background: C.bgNested, color: C.textSecondary, border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '12px' }}>ביטול</button>
                </>
              ) : (() => {
                const dl = (version as any).submissionDeadline;
                const isPast = dl && new Date(dl) < new Date();
                return (
                  <>
                    <span style={{ color: !dl ? C.textDisabled : isPast ? C.statusBlocked : C.statusWaiting, fontWeight: dl ? '600' : 'normal' }}>
                      {dl ? fmtDateTime(dl) : 'לא נקבע'}
                      {isPast && dl && <span style={{ marginRight: '4px', fontSize: '11px', color: C.statusBlocked }}>⚠ עבר</span>}
                    </span>
                    <button onClick={() => setEditingSubmissionDeadline(true)} style={{ padding: '2px 8px', background: C.bgBlocked, color: C.statusBlocked, border: `1px solid ${C.statusBlocked}44`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '11px' }}>עריכה</button>
                  </>
                );
              })()}
            </span>
          )}
          {/* Approval deadline */}
          {(version.status === 'CR_REVIEW' || (version as any).approvalDeadline) && isManager && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              ✅ <strong>מועד אישור:</strong>
              {editingApprovalDeadline ? (
                <>
                  <input type="datetime-local" value={approvalDeadlineValue} onChange={e => setApprovalDeadlineValue(e.target.value)}
                    style={{ padding: '4px 8px', border: `1px solid ${C.borderFocus}`, borderRadius: RADIUS.md, fontSize: '13px' }} />
                  <button onClick={saveApprovalDeadline} style={{ padding: '4px 10px', background: '#2e7d32', color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '12px' }}>שמור</button>
                  <button onClick={() => setEditingApprovalDeadline(false)} style={{ padding: '4px 10px', background: C.bgNested, color: C.textSecondary, border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '12px' }}>ביטול</button>
                </>
              ) : (() => {
                const dl = (version as any).approvalDeadline;
                const isPast = dl && new Date(dl) < new Date();
                return (
                  <>
                    <span style={{ color: !dl ? C.textDisabled : isPast ? C.statusBlocked : '#2e7d32', fontWeight: dl ? '600' : 'normal' }}>
                      {dl ? fmtDateTime(dl) : 'לא נקבע'}
                      {isPast && dl && <span style={{ marginRight: '4px', fontSize: '11px', color: C.statusBlocked }}>⚠ עבר</span>}
                    </span>
                    <button onClick={() => setEditingApprovalDeadline(true)} style={{ padding: '2px 8px', background: 'rgba(46,125,50,0.10)', color: '#2e7d32', border: '1px solid rgba(46,125,50,0.30)', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '11px' }}>עריכה</button>
                  </>
                );
              })()}
            </span>
          )}
          {version.creator && <span>👤 {version.creator.fullName}</span>}
          {version.approvedAt && version.approver && (
            <span style={{ color: C.success }}>✅ אושר: {new Date(version.approvedAt).toLocaleDateString('he-IL')} ע"י {version.approver.fullName}</span>
          )}
          {version.lastRehearsalAt && (
            <span style={{ background: C.warningBg, color: C.warning, padding: '3px 10px', borderRadius: RADIUS.full, fontWeight: 'bold', fontSize: '12px' }}>
              🎭 חזרה גנרלית: {new Date(version.lastRehearsalAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {version.lastNightAt && (
            <span style={{ background: '#e8f4fd', color: '#1a5276', padding: '3px 10px', borderRadius: '12px', fontWeight: 'bold', fontSize: '12px' }}>
              🌙 ביצוע הטמעה: {new Date(version.lastNightAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        );})()}

        {version.submissions?.length > 0 && (
          <div style={{ marginTop: '12px' }}>
            {/* CR_REVIEW: detailed CR-based submission status panel */}
            {version.status === 'CR_REVIEW' && isManager && (() => {
              if (crSummaryLoading) return (
                <div style={{ padding: '9px 14px', color: '#64748b', fontSize: '13px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '6px' }}>
                  ⏳ טוען סטטוס הגשות...
                </div>
              );

              if (!crSummary || crSummary.length === 0) {
                // Sync pending or file not configured — show sync prompt only, no team cards
                return (
                  <div style={{ padding: '10px 16px', background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: '10px', marginBottom: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px', color: '#92400e' }}>
                      ⏳ טוען נתוני CR מהקובץ... לחץ <strong>🔄 סנכרן</strong> לרענון
                    </span>
                    <button onClick={refreshCrSummary} disabled={crSummaryLoading}
                      style={{ fontSize: '12px', padding: '4px 12px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '6px', cursor: crSummaryLoading ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: crSummaryLoading ? 0.6 : 1 }}>
                      {crSummaryLoading ? '⏳' : '🔄'} סנכרן
                    </button>
                  </div>
                );
              }

              const ORDER: Record<string, number> = { PARTIAL: 0, NONE: 1, COMPLETE: 2, NOT_REQUIRED: 3 };
              const sorted = [...crSummary].sort((a: any, b: any) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));
              const completeCount = crSummary.filter((t: any) => t.status === 'COMPLETE' || t.status === 'NOT_REQUIRED').length;
              const total = crSummary.length;
              const allDone = completeCount === total;

              const statusMeta = (t: any): { desc: string; accent: string; textColor: string } => {
                const rem = t.crListCount - t.proposedCount;
                switch (t.status) {
                  case 'PARTIAL':      return { accent: '#f59e0b', textColor: '#78350f', desc: `הגישו ${t.proposedCount} מתוך ${t.crListCount} פיתוחים — נותרו ${rem} להשלמה` };
                  case 'NONE':         return { accent: '#ef4444', textColor: '#7f1d1d', desc: `טרם נכנסו למערכת — ${t.crListCount} פיתוח${t.crListCount !== 1 ? 'ים' : ''} ממתין${t.crListCount !== 1 ? 'ים' : ''}` };
                  case 'COMPLETE':     return { accent: '#16a34a', textColor: '#14532d', desc: t.notNeededCount > 0 ? `הגישו ${t.proposedCount} פיתוחים, ${t.notNeededCount} לא נדרש — הכל טופל ✓` : `הגישו את כל ${t.crListCount} הפיתוחים ✓` };
                  case 'ALL_NOT_NEEDED': return { accent: '#94a3b8', textColor: '#475569', desc: `כל ${t.crListCount} הפיתוחים סומנו כ"לא נדרש לתוכנית" — הוגש` };
                  case 'SUBMITTED_EMPTY': return { accent: '#f59e0b', textColor: '#78350f', desc: 'הוגש ללא פיתוחים ולא סומנו "לא נדרש" — נדרשת בדיקה' };
                  case 'NOT_REQUIRED': return { accent: '#94a3b8', textColor: '#64748b', desc: 'לא נדרש לגרסה זו' };
                  default:             return { accent: '#94a3b8', textColor: '#64748b', desc: '' };
                }
              };

              return (
                <div style={{ background: 'white', border: `1px solid ${allDone ? '#bbf7d0' : '#fecaca'}`, borderRadius: '10px', overflow: 'hidden', marginBottom: '6px', boxShadow: allDone ? 'none' : '0 0 0 3px rgba(239,68,68,0.08)' }}>
                  <style>{`@keyframes cr-pulse{0%,100%{background-color:#fff1f2}50%{background-color:#fde8e8}}.cr-header-alert{animation:cr-pulse 2s ease-in-out infinite;cursor:pointer}.cr-header-ok{background:#f0fdf4;cursor:pointer}`}</style>
                  <div className={allDone ? 'cr-header-ok' : 'cr-header-alert'}
                    onClick={() => setCrSummaryExpanded(e => !e)}
                    style={{ padding: '10px 16px', borderBottom: crSummaryExpanded ? '1px solid #f1f5f9' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: allDone ? '#15803d' : '#dc2626', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px' }}>{allDone ? '✅' : '●'}</span>
                      <span>
                        {allDone ? `כל ${total} הצוותים הגישו את פיתוחיהם` : `הגישו הכל: ${completeCount} מתוך ${total} צוותים — לחץ לפירוט`}
                        {!crAllApproved && (
                          <span style={{ marginRight: '10px', fontSize: '12px', color: '#dc2626', fontWeight: '600' }}>
                            · ⚠️ יש CR שטרם אושר ע"י המנהל — בדוק ברשימת הפיתוחים למטה
                          </span>
                        )}
                        {crAllApproved && (
                          <span style={{ marginRight: '10px', fontSize: '12px', color: '#15803d' }}>· ✅ כל CRים אושרו</span>
                        )}
                      </span>
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button onClick={e => { e.stopPropagation(); refreshCrSummary(); }} disabled={crSummaryLoading}
                        style={{ fontSize: '11px', padding: '3px 10px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: crSummaryLoading ? 'not-allowed' : 'pointer', color: '#475569', opacity: crSummaryLoading ? 0.5 : 1 }}>
                        {crSummaryLoading ? '⏳' : '🔄'} סנכרן
                      </button>
                      <span style={{ fontSize: '13px', color: '#94a3b8', transform: crSummaryExpanded ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>▼</span>
                    </div>
                  </div>
                  {crSummaryExpanded && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '10px', padding: '12px' }}>
                      {sorted.map((t: any) => {
                        const { desc, accent, textColor } = statusMeta(t);
                        const canReview = t.teamId && t.status !== 'NOT_REQUIRED';
                        const cardBg: Record<string, string> = { PARTIAL: '#fafafa', NONE: '#fafafa', SUBMITTED_EMPTY: '#fafafa', COMPLETE: '#fafafa', NOT_REQUIRED: '#f4f4f5' };
                        return (
                          <div key={t.teamId || t.teamName} style={{ borderRadius: '10px', border: `1px solid ${accent}33`, borderTop: `4px solid ${accent}`, background: cardBg[t.status] ?? 'white', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                            <span style={{ fontWeight: '800', fontSize: '14px', color: '#1a2332', lineHeight: 1.2 }}>{t.teamName}</span>
                            <span style={{ fontSize: '12px', color: textColor, lineHeight: 1.5, flex: 1 }}>{desc}</span>
                            {canReview && (
                              <button onClick={() => setTeamPanelOpen({ teamId: t.teamId, teamName: t.teamName })}
                                style={{ marginTop: '4px', padding: '5px 0', background: 'transparent', color: '#2d4a7a', border: '1px solid #2d4a7a', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', width: '100%' }}>
                                סקירה ←
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
            {/* Team filter pills */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '4px' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>סנן:</span>
              <span onClick={() => setFilterTeam(null)} style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', background: filterTeam === null ? '#1a2332' : '#f0f0f0', color: filterTeam === null ? 'white' : '#666' }}>כולם</span>
              {(() => {
                const assignedTeamIds = new Set<string>(
                  (version.phases ?? [])
                    .flatMap((p: any) => p.subPhases ?? [])
                    .flatMap((sp: any) => sp.tasks ?? [])
                    .map((t: any) => t.assignedTeamId)
                    .filter(Boolean)
                );
                const base = version.status === 'CR_REVIEW'
                  ? version.submissions.filter((sub: any) => (version.involvedTeamIds ?? []).includes(sub.teamId))
                  : version.submissions.filter((sub: any) => assignedTeamIds.has(sub.teamId));
                return base;
              })().map((sub: any) => (
                <span key={sub.id} onClick={() => setFilterTeam(filterTeam === sub.team.id ? null : sub.team.id)}
                  style={{
                    padding: '3px 10px', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
                    background: filterTeam === sub.team.id ? '#1a2332' : '#f0f0f0',
                    color: filterTeam === sub.team.id ? 'white' : '#555',
                    border: filterTeam === sub.team.id ? '1px solid #1a2332' : '1px solid transparent',
                  }}>
                  {sub.team.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── אזהרה: סינון צוות מסתיר משימות לא גמורות ── */}
      {filterTeam && ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(version.status) && (() => {
        const hiddenNotDone = (version.phases ?? []).flatMap((p: any) =>
          (p.subPhases ?? []).flatMap((s: any) =>
            (s.tasks ?? []).filter((t: any) =>
              t.status !== 'DONE' &&
              t.assignedTeamId !== filterTeam &&
              (t.assignedTeam?.id) !== filterTeam
            )
          )
        ).length;
        if (!hiddenNotDone) return null;
        return (
          <div style={{ marginBottom: '12px', background: C.warningBg, border: `1px solid ${C.warning}`, borderRadius: '10px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
            <span style={{ fontSize: '18px' }}>⚠️</span>
            <span style={{ color: C.warning, fontWeight: 'bold' }}>
              סינון צוות פעיל — {hiddenNotDone} משימות לא גמורות מוסתרות.
            </span>
            <button onClick={() => setFilterTeam(null)} style={{ marginRight: 'auto', padding: '3px 10px', background: C.warning, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
              הצג הכל
            </button>
          </div>
        );
      })()}

      {/* ── CR_REVIEW: רשימת פיתוחים — מחוץ לחלונית ── */}
      {version.status === 'CR_REVIEW' && isManager && (
        <div style={{ marginTop: '12px' }}>
          <CrPlanReviewPanel
            token={token}
            versionId={version.id}
            versionStatus={version.status}
            isManager={isManager}
            section="crs"
            refreshKey={crPanelRefreshKey}
            onAllApproved={setCrAllApproved}
            onTeamReview={(teamId, teamName) => setTeamPanelOpen({ teamId, teamName })}
          />
        </div>
      )}

      {/* ── COLLECTING: סטטוס הגשות צוותים + כפתור תזכורת ── */}
      {version.status === 'COLLECTING' && isManager && (
        <div style={{ marginBottom: '16px', background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
          <div
            onClick={() => setCollectingTeamsExpanded(p => !p)}
            style={{ padding: '12px 20px', borderBottom: collectingTeamsExpanded ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none', background: C.bgNested }}
          >
            <span style={{ fontSize: '14px', fontWeight: '700', color: C.textPrimary, display: 'flex', alignItems: 'center', gap: '8px' }}>
              👥 סטטוס הגשות צוותים
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {isManager && (
                <button
                  onClick={async e => {
                    e.stopPropagation();
                    setReminderSending(true);
                    setReminderResult(null);
                    try {
                      const res = await axios.post(`${API}/versions/${version.id}/send-collecting-reminder`, {}, { headers });
                      setReminderResult({ sent: res.data.sent, teams: res.data.teams });
                    } catch (err: any) {
                      showAlert('שגיאה בשליחת תזכורת', err?.response?.data?.message || 'שגיאה לא ידועה', 'danger');
                    } finally {
                      setReminderSending(false);
                    }
                  }}
                  disabled={reminderSending}
                  style={{ padding: '5px 14px', background: reminderSending ? C.textDisabled : C.statusInProgress, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: reminderSending ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                >
                  {reminderSending ? 'שולח...' : '📧 שלח תזכורת למי שלא סיים'}
                </button>
              )}
              <span style={{ color: C.textMuted, fontSize: '13px' }}>{collectingTeamsExpanded ? '▲ סגור' : '▼ פתח'}</span>
            </div>
          </div>
          {reminderResult && (
            <div style={{ padding: '8px 20px', background: reminderResult.sent > 0 ? C.successBg : C.warningBg, borderBottom: `1px solid ${C.border}`, fontSize: '12px', color: reminderResult.sent > 0 ? C.success : C.warning }}>
              {reminderResult.sent > 0
                ? `✅ נשלחו ${reminderResult.sent} תזכורות: ${reminderResult.teams.join(', ')}`
                : 'כל הצוותים כבר הגישו, לא נשלחו תזכורות'}
            </div>
          )}
          {collectingTeamsExpanded && (
            <div style={{ padding: '16px 20px' }}>
              <CrPlanReviewPanel
                token={token}
                versionId={version.id}
                versionStatus={version.status}
                isManager={isManager}
                section="teams"
                onTeamReview={(teamId, teamName) => setTeamPanelOpen({ teamId, teamName })}
              />
            </div>
          )}
        </div>
      )}


      {/* ── View mode tabs ── */}
      {version.status !== 'CR_REVIEW' && (
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', background: C.bgNested, borderRadius: '10px', padding: '6px', border: `1px solid ${C.border}` }}>
        <button
          onClick={() => setViewMode('detail')}
          style={{ flex: 1, padding: '8px 0', background: viewMode === 'detail' ? C.brandDim : 'transparent', color: viewMode === 'detail' ? C.textPrimary : C.textMuted, border: viewMode === 'detail' ? `1px solid ${C.brand}` : '1px solid transparent', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', fontFamily: FONT }}
        >
          ⚙️ עריכת גרסה
        </button>
        <button
          onClick={() => setViewMode('plan')}
          style={{ flex: 1, padding: '8px 0', background: viewMode === 'plan' ? C.brandDim : 'transparent', color: viewMode === 'plan' ? C.textPrimary : C.textMuted, border: viewMode === 'plan' ? `1px solid ${C.brand}` : '1px solid transparent', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', fontFamily: FONT }}
        >
          🔍 תוכנית ביצוע + חריגות
        </button>
      </div>
      )}

      {/* ── Plan view (TeamView with anomaly detection) ── */}
      {viewMode === 'plan' && version.status !== 'CR_REVIEW' && (
        <div>
          <div style={{
            background: 'linear-gradient(135deg, #2c3e50 0%, #4a6741 100%)',
            borderRadius: '12px', padding: '10px 18px', marginBottom: '14px',
            display: 'flex', alignItems: 'center', gap: '10px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}>
            <span style={{ fontSize: '20px' }}>📋</span>
            <div>
              <div style={{ fontWeight: 'bold', color: 'white', fontSize: '14px' }}>מצב תכנון — {version.name}</div>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.75)', marginTop: '2px' }}>
                {({
                  DRAFT: 'טיוטה — בניית תוכנית ראשונית',
                  COLLECTING: 'איסוף משימות — הצוותים מוסיפים משימות',
                  REFINING: 'עיבוד — עדכון ובדיקת התוכנית',
                  REVIEW: 'סקירה — ממתין לאישור',
                  APPROVED: 'תוכנית מאושרת — נעולה',
                  REHEARSAL: 'חזרה גנרלית',
                  ACTIVE: 'פעיל — ביצוע הטמעה',
                  MORNING_AFTER: 'פעילות בוקר לאחר גרסה',
                  COMPLETED: 'הושלם — ארכיון',
                  ROLLED_BACK: 'בוצע Rollback',
                } as Record<string, string>)[version.status] ?? version.status}
                {' · '}כלי בדיקת החריגות פעיל לבניית התוכנית
              </div>
            </div>
          </div>
          <TeamView token={token} versionId={version.id} refreshKey={teamRefreshKey} onTaskUpdated={onRefresh} onOpenReschedule={isManager ? openReschedule : undefined} />
        </div>
      )}

      {viewMode === 'detail' && version.status !== 'CR_REVIEW' && <>

      {/* ── Lock banner ── */}
      {isLocked && (
        <div style={{ background: C.bgInProgress, border: `2px solid ${C.statusInProgress}44`, borderRadius: '10px', padding: '12px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>🔒</span>
          <div>
            <div style={{ fontWeight: 'bold', color: C.statusInProgress, fontSize: '15px' }}>
              {['APPROVED', 'ACTIVE'].includes(version.status) ? 'גרסה נעולה לעריכה' : 'גרסה פעילה — מצב קריאה בלבד'}
            </div>
            <div style={{ color: C.textSecondary, fontSize: '13px', marginTop: '2px' }}>
              {['APPROVED', 'ACTIVE'].includes(version.status)
                ? 'לא ניתן לערוך משימות בסטטוס זה — נדרשת הרשאת override'
                : 'לא ניתן להוסיף, לערוך או למחוק משימות בזמן ביצוע'}
            </div>
          </div>
        </div>
      )}

      {/* ── Phases ── */}
      {version.phases?.map((phase: any) => {
        const phaseTasks = phase.subPhases?.flatMap((s: any) => s.tasks || []) || [];
        // Phase deadline = ONLY what the user explicitly set in the reschedule dialog (phase.plannedEnd).
        // No global fallback — if the user hasn't set a deadline, no overrun is detected for this phase.
        const phaseCutoff: Date | null = phase.plannedEnd ? new Date(phase.plannedEnd) : null;
        const phaseTimes = getHierarchyTimes(phaseTasks, phaseCutoff);

        return (
          <div key={phase.id} style={{ background: C.bgCard, borderRadius: '12px', padding: '20px', marginBottom: '16px', border: phase.isGoNoGo ? `1px solid ${C.statusDone}44` : `1px solid ${C.border}`, boxShadow: phase.isGoNoGo ? `0 0 0 2px ${C.statusDone}22` : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              {/* Clickable phase title */}
              <h3 onClick={() => togglePhase(phase.id)} style={{ margin: 0, color: C.textPrimary, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' as any, flexWrap: 'wrap', flex: 1 }}>
                <span style={{ fontSize: '14px', color: '#999' }}>{collapsedPhases.has(phase.id) ? '►' : '▼'}</span>
                <span style={{ background: phase.environment === 'HOT' ? '#fee' : phase.environment === 'HOTNET' ? '#e8f4fd' : '#f0f0f0', color: phase.environment === 'HOT' ? '#c0392b' : phase.environment === 'HOTNET' ? '#2980b9' : '#666', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>{phase.environment}</span>
                {editingPhaseId === phase.id ? (
                  <span onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      autoFocus
                      value={editingPhaseName}
                      onChange={e => setEditingPhaseName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') savePhaseRename(phase.id); if (e.key === 'Escape') setEditingPhaseId(null); }}
                      style={{ padding: '4px 8px', border: `2px solid ${C.brand}`, borderRadius: '6px', fontSize: '15px', fontWeight: 'bold', width: '260px', background: C.bgNested, color: C.textPrimary }}
                    />
                    <button onClick={() => savePhaseRename(phase.id)} disabled={phaseManageLoading} style={{ padding: '3px 10px', background: C.statusDone, color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '12px' }}>שמור</button>
                    <button onClick={() => setEditingPhaseId(null)} style={{ padding: '3px 8px', background: C.bgHover, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '5px', cursor: 'pointer', fontSize: '12px' }}>×</button>
                  </span>
                ) : (
                  <span>{phase.name}</span>
                )}
                {FEATURES.TEAM_LEAD_PROPOSAL && (() => {
                  const pending = proposals.filter((p: any) => !p.usedInTaskId && Number(p.phase) === Number(phase.orderIndex)).length;
                  if (!pending) return null;
                  return (
                    <span title={`${pending} הצעות ראשי צוותים לשלב זה`} style={{
                      background: '#e67e22', color: 'white',
                      padding: '2px 9px', borderRadius: '10px',
                      fontSize: '11px', fontWeight: 'bold',
                      cursor: 'default', whiteSpace: 'nowrap',
                    }}>
                      💡 {pending}
                    </span>
                  );
                })()}
                {phase.isGoNoGo && (
                  <span style={{ background: C.bgDone, color: C.statusDone, padding: '2px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold', border: `1px solid ${C.statusDone}44`, whiteSpace: 'nowrap' }}>
                    🚦 שלב GO/NO GO
                  </span>
                )}
                <span style={{ fontSize: '12px', color: C.textMuted, fontWeight: 'normal' }}>({phase.subPhases?.length || 0} תת-שלבים)</span>
              {phaseTimes && (
                <span style={{ fontSize: '12px', background: phaseTimes.overrun ? C.bgBlocked : C.bgNested, color: phaseTimes.overrun ? C.statusFailed : C.statusInProgress, padding: '2px 10px', borderRadius: '12px', fontWeight: phaseTimes.overrun ? 'bold' : 'normal', marginRight: '4px', border: phaseTimes.overrun ? `1px solid ${C.statusFailed}44` : `1px solid ${C.border}` }}>
                  {phaseTimes.overrun ? '⚠️ ' : '⏰ '}
                  {phaseTimes.startIso ? formatTime(phaseTimes.startIso) : '?'}
                  {phaseTimes.endIso ? ` — ${formatTime(phaseTimes.endIso)}` : ''}
                  {phaseTimes.dur ? ` · ${phaseTimes.dur}` : ''}
                  {phaseTimes.overrun && phaseCutoff ? ` (חורג מ-${formatDateTimeShort(phaseCutoff.toISOString())})` : ''}
                </span>
              )}
              {phaseCutoff && (
                <span style={{ fontSize: '11px', color: phaseTimes?.overrun ? C.statusFailed : C.textMuted, background: phaseTimes?.overrun ? C.bgBlocked : C.bgNested, padding: '1px 7px', borderRadius: '8px', border: `1px solid ${C.border}` }}>
                  יעד: {formatDateTimeShort(phaseCutoff.toISOString())}
                </span>
              )}
              </h3>

              {/* Phase management actions (managers only, non-locked) */}
              {isManager && !isLocked && editingPhaseId !== phase.id && (
                <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexShrink: 0 }}>
                  <button
                    title="שנה שם שלב"
                    onClick={() => { setEditingPhaseId(phase.id); setEditingPhaseName(phase.name); }}
                    style={{ padding: '3px 8px', background: C.bgNested, color: C.brand, border: `1px solid ${C.brandDim}`, borderRadius: '5px', cursor: 'pointer', fontSize: '12px' }}>
                    ✏️
                  </button>
                  {!phase.isGoNoGo && (
                    <button
                      title="הגדר שלב זה כנקודת GO/NO GO"
                      onClick={() => setGoNogoPhase(phase.id)}
                      disabled={phaseManageLoading}
                      style={{ padding: '3px 8px', background: C.bgDone, color: C.statusDone, border: `1px solid ${C.statusDone}44`, borderRadius: '5px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' }}>
                      🚦 קבע GO/NO GO
                    </button>
                  )}
                  {(phase.subPhases ?? []).every((sp: any) => (sp.tasks ?? []).length === 0) && (
                    <button
                      title="מחק שלב (ריק)"
                      onClick={() => deletePhase(phase.id, phase.name)}
                      disabled={phaseManageLoading}
                      style={{ padding: '3px 8px', background: C.bgBlocked, color: C.statusFailed, border: `1px solid ${C.statusFailed}44`, borderRadius: '5px', cursor: 'pointer', fontSize: '12px' }}>
                      🗑️
                    </button>
                  )}
                </div>
              )}
            </div>

            {!collapsedPhases.has(phase.id) && phase.subPhases?.map((sub: any) => {
              const subTimes = getHierarchyTimes(sub.tasks || [], phaseCutoff);

              return (
                <div key={sub.id}
                  onDragOver={e => { e.preventDefault(); if (dragging && dragging.fromSubId !== sub.id) setDragOverSubId(sub.id); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setDragOverSubId(null); } }}
                  onDrop={e => {
                    e.preventDefault();
                    setDragOverSubId(null);
                    setDragOverTaskId(null);
                    if (!dragging) return;
                    if (dragging.fromSubId === sub.id) {
                      // Within same subphase — reorder by dropping on subphase background (append to end)
                      const currentTasks = [...(sub.tasks || [])].sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
                      const withoutDragged = currentTasks.filter((t: any) => t.id !== dragging.taskId);
                      const newOrder = [...withoutDragged, currentTasks.find((t: any) => t.id === dragging.taskId)!].map((t: any) => t.id);
                      axios.post(`${API}/versions/sub-phases/${sub.id}/reorder`, { taskIds: newOrder }, { headers }).then(() => onRefresh()).catch(console.error);
                      setDragging(null);
                      return;
                    }
                    const draggedTask = version.phases.flatMap((p: any) => p.subPhases?.flatMap((s: any) => s.tasks || []) || []).find((t: any) => t.id === dragging.taskId);
                    if (!draggedTask) return;
                    setMoveConfirm({ taskId: dragging.taskId, taskTitle: draggedTask.title, targetSubId: sub.id, targetSubName: sub.name });
                    setDragging(null);
                  }}
                  style={{ marginBottom: '12px', paddingRight: '16px', borderRight: dragOverSubId === sub.id ? `3px solid ${C.brand}` : `3px solid ${C.border}`, background: dragOverSubId === sub.id ? C.bgHover : 'transparent', borderRadius: dragOverSubId === sub.id ? '0 8px 8px 0' : undefined, transition: 'background 0.15s, border-color 0.15s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <h4 onClick={() => toggleSubPhase(sub.id)} style={{ margin: 0, color: C.textPrimary, fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', userSelect: 'none' as any, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', color: C.textMuted }}>{collapsedSubPhases.has(sub.id) ? '►' : '▼'}</span>
                      {sub.name}
                      <span style={{ fontSize: '11px', color: C.textMuted, fontWeight: 'normal' }}>({sub.tasks?.length || 0})</span>
                      {FEATURES.TEAM_LEAD_PROPOSAL && (() => {
                        const subPending = proposals.filter((p: any) => !p.usedInTaskId && p.subPhaseId === sub.id).length;
                        if (!subPending) return null;
                        return (
                          <span title={`${subPending} הצעות ממתינות לתת-שלב זה`} style={{
                            background: '#e67e22', color: 'white',
                            padding: '1px 7px', borderRadius: '10px',
                            fontSize: '10px', fontWeight: 'bold',
                            cursor: 'default', whiteSpace: 'nowrap',
                          }}>
                            💡 {subPending}
                          </span>
                        );
                      })()}
                      {subTimes && (
                        <span style={{ fontSize: '11px', background: subTimes.overrun ? C.bgBlocked : C.bgInProgress, color: subTimes.overrun ? C.statusFailed : C.statusInProgress, padding: '1px 8px', borderRadius: '10px', fontWeight: subTimes.overrun ? 'bold' : 'normal', border: subTimes.overrun ? `1px solid ${C.statusFailed}44` : 'none' }}>
                          {subTimes.overrun ? '⚠️ ' : '⏰ '}
                          {subTimes.startIso ? formatTime(subTimes.startIso) : '?'}
                          {subTimes.endIso ? ` — ${formatTime(subTimes.endIso)}` : ''}
                          {subTimes.dur ? ` · ${subTimes.dur}` : ''}
                          {subTimes.overrun && phaseCutoff ? ` (חורג מ-${formatDateTimeShort(phaseCutoff.toISOString())})` : ''}
                        </span>
                      )}
                    </h4>
                    {isManager && !isLocked && <button onClick={() => {
                      refreshProposals();
                      setSelectedTask(null);
                      setSelectedTaskSubId(sub.id);
                      setSelectedTaskPhaseOrder(phase.orderIndex);
                      setSelectedTaskPhaseStart(phase.plannedStart ?? undefined);
                      setSelectedTaskPhaseEnd(phase.plannedEnd ?? undefined);
                    }} style={{ padding: '5px 14px', background: C.brand, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>+ משימה</button>}
                  </div>

                  {!collapsedSubPhases.has(sub.id) && (() => {
                    const sortedTasks = [...(sub.tasks || [])].sort(
                      (a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
                    );
                    const orderMap = new Map(sortedTasks.map((t: any, i: number) => [t.id, i + 1]));
                    const filteredTasks = sortedTasks.filter((task: any) => !filterTeam || task.assignedTeam?.id === filterTeam || task.assignedTeamId === filterTeam);
                    return (<>
                      {filteredTasks.length > 0 && <VersionTaskHeader isLocked={isLocked} isManager={isManager} />}
                      {filteredTasks.map((task: any) => {
                        const displayOrder = orderMap.get(task.id) ?? task.orderIndex;
                        return (
                      editingTask?.id === task.id ? (
                        <div key={task.id} style={{ background: '#f0f7ff', borderRadius: '8px', padding: '14px', marginBottom: '6px', border: '1px solid #bee3f8' }}>
                          {/* Row 1: title | user (filtered) | team (filtered) */}
                          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                            <input value={editingTask.title} onChange={e => setEditingTask({ ...editingTask, title: e.target.value })} placeholder="שם המשימה" style={{ padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                            {/* User with letter filter */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <input value={editFilters.user} onChange={e => setEditFilters(f => ({ ...f, user: e.target.value }))}
                                placeholder="סנן עובד..." style={{ padding: '4px 7px', border: '1px solid #ddd', borderRadius: '6px 6px 0 0', fontSize: '11px', borderBottom: 'none' }} />
                              <select value={editingTask.assignedUserName || ''} onChange={e => setEditingTask({ ...editingTask, assignedUserName: e.target.value })}
                                style={{ padding: '5px 7px', border: '1px solid #ddd', borderRadius: '0 0 6px 6px', fontSize: '13px', borderTop: 'none' }}>
                                <option value="">-- עובד --</option>
                                {(editingTask.assignedTeamId
                                  ? (teams.find((t: any) => t.id === editingTask.assignedTeamId)?.members || []).map((m: any) => m.user).filter(Boolean)
                                  : users
                                ).filter((u: any) => !editFilters.user || u.fullName.toLowerCase().startsWith(editFilters.user.toLowerCase()))
                                  .map((u: any) => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
                              </select>
                            </div>
                            {/* Team with letter filter */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <input value={editFilters.team} onChange={e => setEditFilters(f => ({ ...f, team: e.target.value }))}
                                placeholder="סנן צוות..." style={{ padding: '4px 7px', border: '1px solid #ddd', borderRadius: '6px 6px 0 0', fontSize: '11px', borderBottom: 'none' }} />
                              <select value={editingTask.assignedTeamId || ''} onChange={e => setEditingTask({ ...editingTask, assignedTeamId: e.target.value, assignedUserName: '', application: '' })}
                                style={{ padding: '5px 7px', border: '1px solid #ddd', borderRadius: '0 0 6px 6px', fontSize: '13px', borderTop: 'none' }}>
                                <option value="">צוות</option>
                                {teams.filter((t: any) => t.active && (!editFilters.team || t.name.toLowerCase().startsWith(editFilters.team.toLowerCase()))).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </select>
                            </div>
                          </div>
                          {/* Row 2: CR# | app (filtered) | env | duration (minutes) */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                            <div>
                              {(() => {
                                const crList = (editingTask.crNumber || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                                return (
                                  <div style={{ border: '1px solid #ddd', borderRadius: '6px', padding: '4px 6px', background: 'white', minHeight: '34px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px', boxSizing: 'border-box' }}>
                                    {crList.map((cr: string) => (
                                      <span key={cr} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', background: '#e8f4fd', color: '#2980b9', borderRadius: '4px', padding: '2px 6px', fontSize: '12px' }}>
                                        {cr}
                                        <button onClick={() => setEditingTask({ ...editingTask, crNumber: crList.filter((c: string) => c !== cr).join(',') })}
                                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2980b9', padding: '0', lineHeight: 1, fontSize: '14px' }}>×</button>
                                      </span>
                                    ))}
                                    <input
                                      list="cr-datalist"
                                      value={editCrInput}
                                      onChange={e => {
                                        setEditCrInput(e.target.value);
                                        const match = crItems.find(c => c.id === e.target.value || c.label === e.target.value);
                                        if (match) {
                                          if (!crList.includes(match.id)) {
                                            setEditingTask({ ...editingTask, crNumber: [...crList, match.id].join(',') });
                                          }
                                          setEditCrInput('');
                                        }
                                      }}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter' && editCrInput.trim()) {
                                          e.preventDefault();
                                          if (!crList.includes(editCrInput.trim())) {
                                            setEditingTask({ ...editingTask, crNumber: [...crList, editCrInput.trim()].join(',') });
                                          }
                                          setEditCrInput('');
                                        }
                                      }}
                                      placeholder={crList.length === 0 ? 'CR# (Enter להוספה)' : '+ הוסף CR'}
                                      style={{ border: 'none', outline: 'none', fontSize: '13px', padding: '2px 4px', minWidth: '110px', flex: 1 }}
                                    />
                                  </div>
                                );
                              })()}
                            </div>
                            {/* Application with letter filter */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <input value={editFilters.app} onChange={e => setEditFilters(f => ({ ...f, app: e.target.value }))}
                                placeholder="סנן..." style={{ padding: '4px 7px', border: '1px solid #ddd', borderRadius: '6px 6px 0 0', fontSize: '11px', borderBottom: 'none' }} />
                              <select value={editingTask.application || ''} onChange={e => setEditingTask({ ...editingTask, application: e.target.value })}
                                style={{ padding: '5px 7px', border: '1px solid #ddd', borderRadius: '0 0 6px 6px', fontSize: '13px', borderTop: 'none' }}>
                                <option value="">Application</option>
                                {(editingTask.assignedTeamId
                                  ? (teams.find((t: any) => t.id === editingTask.assignedTeamId)?.apps?.length
                                      ? teams.find((t: any) => t.id === editingTask.assignedTeamId).apps
                                      : APPS)
                                  : APPS
                                ).filter((a: string) => !editFilters.app || a.toLowerCase().startsWith(editFilters.app.toLowerCase()))
                                  .map((a: string) => <option key={a} value={a}>{a}</option>)}
                              </select>
                            </div>
                            <select value={editingTask.environment || 'BOTH'} onChange={e => setEditingTask({ ...editingTask, environment: e.target.value })} style={{ padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}>
                              <option value="BOTH">HOT + HOTNET</option>
                              <option value="HOT">HOT בלבד</option>
                              <option value="HOTNET">HOTNET בלבד</option>
                            </select>
                            <div>
                              <label style={{ fontSize: '11px', color: '#777', display: 'block', marginBottom: '2px' }}>משך (דקות)</label>
                              <input type="number" min="1" value={editingTask._durationMins || ''}
                                onChange={e => {
                                  const mins = parseInt(e.target.value);
                                  const upd: any = { ...editingTask, _durationMins: e.target.value };
                                  if (mins > 0 && upd.plannedStart) upd.plannedEnd = calcEndFromMins(upd.plannedStart, mins);
                                  setEditingTask(upd);
                                }}
                                onBlur={e => {
                                  const mins = parseInt(e.target.value);
                                  if (mins > 0 && editingTask.plannedStart)
                                    setEditingTask((t: any) => ({ ...t, plannedEnd: calcEndFromMins(t.plannedStart, mins) }));
                                }}
                                placeholder="דקות" style={{ width: '100%', padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} />
                            </div>
                          </div>
                          {/* Row 3: start | end (auto-calculated, read-only) */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                            <div>
                              <label style={{ fontSize: '11px', color: '#777', display: 'block', marginBottom: '3px' }}>תחילת משימה</label>
                              <input type="datetime-local" value={editingTask.plannedStart ? utcToLocalInputStr(editingTask.plannedStart) : ''}
                                onChange={e => {
                                  const upd: any = { ...editingTask, plannedStart: e.target.value };
                                  const mins = parseInt(upd._durationMins);
                                  if (mins > 0 && upd.plannedStart) upd.plannedEnd = calcEndFromMins(upd.plannedStart, mins);
                                  setEditingTask(upd);
                                }}
                                style={{ width: '100%', padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: '11px', color: '#777', display: 'block', marginBottom: '3px' }}>סיום משימה (מחושב)</label>
                              <input type="datetime-local" readOnly value={editingTask.plannedEnd ? utcToLocalInputStr(editingTask.plannedEnd) : ''}
                                style={{ width: '100%', padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box', background: '#f5f5f5', color: '#666' }} />
                            </div>
                          </div>
                          {/* Row 4: dependency note | general note */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                            <input value={editingTask.dependencyNote || ''} onChange={e => setEditingTask({ ...editingTask, dependencyNote: e.target.value })} placeholder="הערת תלות (תלוי ב...)" style={{ padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                            <input value={editingTask.notes || ''} onChange={e => setEditingTask({ ...editingTask, notes: e.target.value })} placeholder="הערה כללית" style={{ padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                          </div>
                          {/* Row 5: dependency picker */}
                          {(() => {
                            const eligibleTasks = version.phases
                              .filter((p: any) => p.orderIndex <= phase.orderIndex)
                              .flatMap((p: any) =>
                                (p.subPhases || []).map((s: any) => ({
                                  phaseLabel: p.name,
                                  tasks: s.tasks || [],
                                }))
                              )
                              .flatMap(({ phaseLabel, tasks: ts }: any) =>
                                ts.map((t: any) => ({ ...t, phaseLabel }))
                              )
                              .filter((t: any) => t.id !== task.id);
                            const alreadyLinked = new Set((editingTask.dependencies || []).map((d: any) => d.dependsOnTaskId));
                            const available = eligibleTasks.filter((t: any) => !alreadyLinked.has(t.id));
                            return (
                              <div style={{ marginBottom: '8px', background: '#f9f9ff', border: '1px solid #ddd', borderRadius: '6px', padding: '8px 10px' }}>
                                <label style={{ fontSize: '11px', color: '#777', display: 'block', marginBottom: '6px' }}>תלויות — המשימה תחכה לסיום:</label>
                                {/* תגיות תלויות קיימות */}
                                {(editingTask.dependencies || []).length > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                                    {(editingTask.dependencies || []).map((dep: any) => (
                                      <span key={dep.dependsOnTaskId} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#e8f4fd', color: '#2d4a7a', padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>
                                        🔗 {dep.dependsOn?.title || dep.dependsOnTaskId}
                                        <button
                                          onClick={() => removeDep(dep.dependsOnTaskId)}
                                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontWeight: 'bold', fontSize: '13px', padding: '0 2px', lineHeight: 1 }}>
                                          ✕
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {/* הוספת תלות */}
                                {available.length > 0 && (() => {
                                  // Preview the dep's computed end time before the user clicks הוסף
                                  const previewDep = newDepId ? eligibleTasks.find((t: any) => t.id === newDepId) : null;
                                  let previewEnd: string | null = null;
                                  if (previewDep) {
                                    if (previewDep.plannedEnd) {
                                      previewEnd = utcToLocalInputStr(previewDep.plannedEnd);
                                    } else if (previewDep.plannedStart) {
                                      const pMins = parseDurationToMinutes(previewDep.duration || '');
                                      previewEnd = pMins && pMins > 0
                                        ? calcEndFromMins(utcToLocalInputStr(previewDep.plannedStart), pMins)
                                        : null;
                                    }
                                  }
                                  const previewTime = previewEnd
                                    ? new Date(previewEnd).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
                                    : null;
                                  return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                        <select
                                          value={newDepId}
                                          onChange={e => setNewDepId(e.target.value)}
                                          style={{ flex: 1, padding: '5px 7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px' }}>
                                          <option value="">— בחר משימה תלויה —</option>
                                          {version.phases
                                            .filter((p: any) => p.orderIndex <= phase.orderIndex)
                                            .map((p: any) => (
                                              <optgroup key={p.id} label={p.name}>
                                                {(p.subPhases || []).flatMap((s: any) =>
                                                  (s.tasks || [])
                                                    .filter((t: any) => t.id !== task.id && !alreadyLinked.has(t.id))
                                                    .map((t: any) => (
                                                      <option key={t.id} value={t.id}>{t.title}</option>
                                                    ))
                                                )}
                                              </optgroup>
                                            ))}
                                        </select>
                                        <button
                                          disabled={!newDepId}
                                          onClick={() => {
                                            const depTask = eligibleTasks.find((t: any) => t.id === newDepId);
                                            if (depTask) addDep(depTask);
                                          }}
                                          style={{ padding: '5px 12px', background: newDepId ? '#2d4a7a' : '#ccc', color: 'white', border: 'none', borderRadius: '6px', cursor: newDepId ? 'pointer' : 'not-allowed', fontSize: '12px', whiteSpace: 'nowrap' }}>
                                          + הוסף
                                        </button>
                                      </div>
                                      {previewDep && (
                                        <div style={{ fontSize: '11px', color: previewTime ? '#2d7a3a' : '#999', paddingRight: '2px' }}>
                                          {previewTime
                                            ? `⏰ שעת תחילה תתעדכן ל: ${previewTime}`
                                            : '⚠️ לתלות זו אין תזמון — שעת תחילה לא תתעדכן אוטומטית'}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                                {available.length === 0 && (editingTask.dependencies || []).length === 0 && (
                                  <span style={{ fontSize: '12px', color: '#aaa' }}>אין משימות קודמות זמינות לקישור</span>
                                )}
                              </div>
                            );
                          })()}
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <button onClick={() => updateTask(task.id, editingTask)}
                              style={{ padding: '7px 16px', background: editSaveOk ? '#1a7a3c' : '#27ae60', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', minWidth: '70px', transition: 'background 0.2s' }}>
                              {editSaveOk ? '✓' : 'שמור'}
                            </button>
                            <button onClick={() => setEditingTask(null)} style={{ padding: '7px 16px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>ביטול</button>
                          </div>
                        </div>
                      ) : (() => {
                          const computedEnd = !task.plannedEnd && task.plannedStart && task.duration
                            ? computeEndFromDuration(task.plannedStart, task.duration)
                            : null;
                          const displayEnd = task.plannedEnd || computedEnd;
                          const sc = statusColor(task.status);
                          const envColor = task.environment === 'HOT' ? C.statusBlocked : task.environment === 'HOTNET' ? C.statusOpen : C.textMuted;
                          const envBg    = task.environment === 'HOT' ? C.bgBlocked    : task.environment === 'HOTNET' ? C.bgOpen    : C.bgNested;
                          const borderRight = task.environment === 'HOT' ? C.statusBlocked : task.environment === 'HOTNET' ? C.statusOpen : C.border;
                          return (
                            <div key={task.id}
                              draggable={!isLocked}
                              onClick={() => { setSelectedTask(task); setSelectedTaskPhaseStart(phase.plannedStart ?? undefined); setSelectedTaskPhaseEnd(phase.plannedEnd ?? undefined); }}
                              onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragging({ taskId: task.id, fromSubId: sub.id }); }}
                              onDragEnd={() => { setDragging(null); setDragOverSubId(null); setDragOverTaskId(null); }}
                              onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (dragging && dragging.fromSubId === sub.id && dragging.taskId !== task.id) setDragOverTaskId(task.id); }}
                              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverTaskId(t => t === task.id ? null : t); }}
                              onDrop={e => {
                                e.preventDefault(); e.stopPropagation();
                                if (!dragging || dragging.fromSubId !== sub.id || dragging.taskId === task.id) return;
                                setDragOverTaskId(null);
                                const currentTasks = [...(sub.tasks || [])].sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
                                const withoutDragged = currentTasks.filter((t: any) => t.id !== dragging.taskId);
                                const dropIdx = withoutDragged.findIndex((t: any) => t.id === task.id);
                                const draggedTask = currentTasks.find((t: any) => t.id === dragging.taskId)!;
                                withoutDragged.splice(dropIdx, 0, draggedTask);
                                axios.post(`${API}/versions/sub-phases/${sub.id}/reorder`, { taskIds: withoutDragged.map((t: any) => t.id) }, { headers }).then(() => onRefresh()).catch(console.error);
                                setDragging(null);
                              }}
                              style={{
                                display: 'flex', alignItems: 'center', minHeight: '40px',
                                background: selectedTask?.id === task.id ? C.bgActive : dragOverTaskId === task.id ? C.bgActive : dragging?.taskId === task.id ? C.bgHover : C.bgCard,
                                borderBottom: `1px solid ${C.border}`,
                                borderRight: `3px solid ${selectedTask?.id === task.id ? C.brand : borderRight}`,
                                borderTop: dragOverTaskId === task.id ? `2px solid ${C.brand}` : undefined,
                                opacity: dragging?.taskId === task.id ? 0.5 : 1,
                                cursor: 'pointer',
                                transition: EASE.fast,
                              }}>

                              {/* # */}
                              {/* # */}
                              <div style={{ width: `${TV.num}px`, flexShrink: 0, textAlign: 'center', fontSize: '12px', color: C.textDisabled, fontFamily: FONT }}>
                                #{displayOrder}
                              </div>

                              {/* Name */}
                              <div style={{ flex: `${TV_NAME_FLEX} 1 0`, minWidth: '80px', padding: `0 ${SP[2]}`, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '3px', overflow: 'hidden' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: '13px', fontWeight: WEIGHT.semibold, color: task.status === 'DONE' ? C.textDisabled : C.textPrimary, fontFamily: FONT, lineHeight: '1.3' }}>
                                    {task.isCritical && <span style={{ color: C.statusBlocked, fontSize: '10px', marginLeft: '4px' }}>●</span>}
                                    {task.isCriticalForGo && <span style={{ fontSize: '10px', background: '#fff3e0', color: '#d35400', padding: '1px 4px', borderRadius: '3px', marginLeft: '3px' }}>GO</span>}
                                    {task.title}
                                  </span>
                                  {lastConvertedAt && task.createdByTeamLead && task.createdAt &&
                                    new Date(task.createdAt) >= lastConvertedAt && (
                                    <span style={{ fontSize: '10px', fontWeight: WEIGHT.bold, color: '#28a745', background: 'rgba(40,167,69,0.12)', border: '1px solid rgba(40,167,69,0.3)', padding: '1px 6px', borderRadius: RADIUS.sm, flexShrink: 0, whiteSpace: 'nowrap' as any }}>
                                      ✦ חדש
                                    </span>
                                  )}
                                  {task.crNumber && task.crNumber.split(',').map((cr: string) => cr.trim()).filter(Boolean).map((cr: string) => (
                                    <span key={cr} style={{ fontSize: '11px', color: C.info, background: C.infoBg, padding: '0 5px', borderRadius: RADIUS.sm, fontFamily: FONT, flexShrink: 0 }}>CR# {cr}</span>
                                  ))}
                                  {task.notes && <span style={{ fontSize: '11px', color: C.textMuted, flexShrink: 0 }} title={task.notes}>📝</span>}
                                  {task.dependencyNote && <span style={{ fontSize: '11px', color: C.statusWaiting, flexShrink: 0 }} title={task.dependencyNote}>🔗</span>}
                                </div>
                              </div>

                              {/* Dependencies — right after name */}
                              <div style={{ flex: `${TV_DEPS_FLEX} 1 0`, minWidth: '80px', padding: `0 ${SP[1]}`, display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}>
                                {task.dependencies?.length > 0 ? (
                                  task.dependencies.slice(0, 3).map((d: any) => {
                                    const dep = d.dependsOn;
                                    const depDone = dep?.status === 'DONE';
                                    return (
                                      <span key={d.dependsOnTaskId} title={dep?.title || ''}
                                        style={{
                                          fontSize: '11px', fontFamily: FONT,
                                          color: depDone ? C.statusDone : C.statusBlocked,
                                          background: depDone ? C.bgDone : C.bgBlocked,
                                          border: `1px solid ${depDone ? C.statusDone + '44' : C.statusBlocked + '44'}`,
                                          padding: '2px 7px', borderRadius: RADIUS.sm,
                                          maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block',
                                        }}>
                                        {depDone ? '✓' : '⏳'} {dep?.title?.slice(0, 20) || '?'}
                                      </span>
                                    );
                                  })
                                ) : <span style={{ fontSize: '11px', color: C.textDisabled }}>—</span>}
                                {task.dependencies?.length > 3 && (
                                  <span style={{ fontSize: '11px', color: C.textMuted, fontFamily: FONT }}>+{task.dependencies.length - 3}</span>
                                )}
                              </div>

                              {/* Duration */}
                              <div style={{ width: `${TV.dur}px`, flexShrink: 0, textAlign: 'center' }}>
                                <span style={{ fontSize: '12px', color: task.duration ? C.warning : C.textDisabled, fontFamily: FONT }}>
                                  {task.duration || '—'}
                                </span>
                              </div>

                              {/* Start */}
                              <div style={{ width: `${TV.start}px`, flexShrink: 0, textAlign: 'center' }}>
                                {task.plannedStart ? (
                                  <span style={{ fontSize: '11px', color: C.textSecondary, fontFamily: FONT, lineHeight: '1.4', display: 'block' }}>
                                    {formatDateTimeShort(task.plannedStart)}
                                  </span>
                                ) : <span style={{ fontSize: '11px', color: C.textDisabled }}>—</span>}
                                {task.startedAt && (
                                  <span style={{ fontSize: '10px', color: C.statusDone, fontFamily: FONT, display: 'block' }}>▶ {formatDateTimeShort(task.startedAt)}</span>
                                )}
                              </div>

                              {/* End */}
                              <div style={{ width: `${TV.end}px`, flexShrink: 0, textAlign: 'center' }}>
                                {displayEnd ? (
                                  <span style={{ fontSize: '11px', color: C.statusInProgress, fontFamily: FONT, lineHeight: '1.4', display: 'block' }}>
                                    {formatDateTimeShort(displayEnd)}
                                    {isNextDay(task.plannedStart, displayEnd) && (
                                      <span style={{ fontSize: '10px', color: C.warning, marginRight: '3px' }}> (+1)</span>
                                    )}
                                    {computedEnd && !task.plannedEnd && <span style={{ color: C.textDisabled }}>*</span>}
                                  </span>
                                ) : <span style={{ fontSize: '11px', color: C.textDisabled }}>—</span>}
                                {task.completedAt && (
                                  <span style={{ fontSize: '10px', color: C.statusDone, fontFamily: FONT, display: 'block' }}>■ {formatDateTimeShort(task.completedAt)}</span>
                                )}
                              </div>

                              {/* Team */}
                              {(() => {
                                const teamName = task.assignedTeam?.name;
                                const tc = teamName ? teamColorFor(teamName) : null;
                                return (
                                  <div style={{ width: `${TV.team}px`, flexShrink: 0, padding: `0 ${SP[1]}`, textAlign: 'center', overflow: 'hidden' }}>
                                    {teamName ? (
                                      <span style={{ fontSize: '11px', fontFamily: FONT, fontWeight: WEIGHT.semibold, padding: '2px 7px', borderRadius: RADIUS.sm, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', color: tc!.color, background: tc!.bg }}>
                                        {teamName}
                                      </span>
                                    ) : <span style={{ fontSize: '11px', color: C.textDisabled }}>—</span>}
                                  </div>
                                );
                              })()}

                              {/* Assignee */}
                              <div style={{ width: `${TV.assignee}px`, flexShrink: 0, padding: `0 ${SP[2]}`, display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden', direction: 'ltr' }}>
                                {task.assignedUserName ? (
                                  <>
                                    <Avatar name={task.assignedUserName} size={20} />
                                    <span style={{ fontSize: '12px', color: C.textSecondary, fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                      {task.assignedUserName.split(' ')[0]}
                                    </span>
                                  </>
                                ) : <span style={{ fontSize: '11px', color: C.textDisabled }}>—</span>}
                              </div>

                              {/* Application */}
                              <div style={{ width: `${TV.app}px`, flexShrink: 0, padding: `0 ${SP[1]}`, textAlign: 'center', overflow: 'hidden' }}>
                                {task.application ? (
                                  <span style={{ fontSize: '11px', color: C.textSecondary, fontFamily: FONT, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {task.application}
                                  </span>
                                ) : <span style={{ fontSize: '11px', color: C.textDisabled }}>—</span>}
                              </div>

                              {/* Environment */}
                              <div style={{ width: `${TV.env}px`, flexShrink: 0, textAlign: 'center' }}>
                                <span style={{ fontSize: '11px', fontWeight: WEIGHT.semibold, color: envColor, background: envBg, fontFamily: FONT, padding: '2px 6px', borderRadius: RADIUS.sm }}>
                                  {task.environment === 'BOTH' ? 'HOT+HOTNET' : (task.environment || 'BOTH')}
                                </span>
                              </div>

                              {/* Status */}
                              <div style={{ width: `${TV.status}px`, flexShrink: 0, textAlign: 'center', display: 'flex', justifyContent: 'center' }}>
                                <StatusChip status={task.status} size="xs" dot />
                              </div>

                              {/* Actions */}
                              {isManager && !isLocked && (
                                <div onClick={e => e.stopPropagation()} style={{ width: `${TV.actions}px`, flexShrink: 0, padding: `0 ${SP[1]}`, display: 'flex', gap: '3px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-start' }}>
                                  <button onClick={() => duplicateTask(task.id)}
                                    style={{ padding: '3px 7px', background: C.bgNested, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: 'pointer', fontSize: '11px' }} title="שכפל">⧉</button>
                                  <button
                                    onClick={() => setDialog({
                                      title: 'המרה לתת-שלב',
                                      message: `להפוך את "${task.title}" לתת-שלב?\nהמשימה תימחק וייווצר תת-שלב חדש במקומה.\nהפעולה בלתי הפיכה.`,
                                      variant: 'warning',
                                      confirmLabel: 'המר לתת-שלב',
                                      cancelLabel: 'ביטול',
                                      onConfirm: async () => {
                                        await axios.post(`${API}/versions/tasks/${task.id}/promote`, {}, { headers });
                                        onRefresh();
                                      },
                                      onCancel: () => {},
                                    })}
                                    style={{ padding: '3px 7px', background: C.bgWaiting, color: C.statusWaiting, border: `1px solid ${C.statusWaiting}44`, borderRadius: RADIUS.sm, cursor: 'pointer', fontSize: '11px' }} title="המר לתת-שלב">▲</button>
                                  <button onClick={() => {
                                    setSelectedTask(task);
                                    setSelectedTaskSubId(undefined);
                                    setSelectedTaskPhaseStart(phase.plannedStart ?? undefined);
                                    setSelectedTaskPhaseEnd(phase.plannedEnd ?? undefined);
                                  }} style={{ padding: '3px 7px', background: C.warningBg, color: C.warning, border: `1px solid ${C.warning}44`, borderRadius: RADIUS.sm, cursor: 'pointer', fontSize: '11px' }}>✏️</button>
                                  <button onClick={() => deleteTask(task.id, task.title)}
                                    style={{ padding: '3px 7px', background: C.dangerBg, color: C.danger, border: `1px solid ${C.danger}44`, borderRadius: RADIUS.sm, cursor: 'pointer', fontSize: '11px' }}>🗑</button>
                                </div>
                              )}
                            </div>
                          );
                        })()
                    ); })}
                    </>); })()}

                  {addingTask === sub.id && !isLocked && (
                    <div style={{ background: '#f0f7ff', borderRadius: '8px', padding: '16px', marginTop: '8px', border: '1px solid #bee3f8' }}>
                      {/* הצעות ראשי צוותים — מסוננות לפי שלב */}
                      {FEATURES.TEAM_LEAD_PROPOSAL && (() => {
                        const phaseProposals = proposals.filter((p: any) => p.phase === phase.orderIndex);
                        if (phaseProposals.length === 0) return null;
                        return (
                          <div style={{ marginBottom: '12px', background: '#f0faf4', border: '2px solid #27ae60', borderRadius: '8px', padding: '10px 14px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#1a5c2a', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ background: '#27ae60', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '11px' }}>
                                {phaseProposals.length}
                              </span>
                              💡 הצעות ראשי צוותים לשלב זה
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                              {phaseProposals.map((p: any) => {
                                const isSelected = selectedProposalId === p.id;
                                const teamName = teams.find((t: any) => t.id === p.teamId)?.name || '';
                                const sel = isSelected;
                                return (
                                  <div key={p.id} onClick={() => {
                                    setSelectedProposalId(p.id);
                                    const submitter = users.find((u: any) => u.id === p.submittedBy);
                                    setNewTask((t: any) => ({
                                      ...t,
                                      title: p.title,
                                      application: p.app ?? '',
                                      crNumber: p.crNumber ?? '',
                                      _durationMins: p.estimatedMins ? String(p.estimatedMins) : '',
                                      notes: p.notes ?? '',
                                      assignedUserName: p.assignedUserName || submitter?.fullName || t.assignedUserName,
                                    }));
                                    if (p.teamId) setSelectedTeam(p.teamId);
                                  }} style={{
                                    padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
                                    background: sel ? '#1a5c2a' : 'white',
                                    border: `1px solid ${sel ? '#27ae60' : '#c3e6cb'}`,
                                    borderRight: `4px solid ${sel ? '#27ae60' : '#a8d5b5'}`,
                                    transition: 'all 0.15s',
                                  }}>
                                    {/* שורה 1: CR badge + כותרת */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                      {p.crNumber && (
                                        <span style={{ background: sel ? 'rgba(255,255,255,0.2)' : '#1a2332', color: 'white', padding: '2px 8px', borderRadius: '5px', fontSize: '11px', fontFamily: 'monospace', flexShrink: 0, fontWeight: '700' }}>
                                          {p.crNumber}
                                        </span>
                                      )}
                                      <span style={{ fontWeight: '700', fontSize: '14px', color: sel ? 'white' : '#1a2332', flex: 1 }}>
                                        {p.title}
                                      </span>
                                    </div>
                                    {/* שורה 2: badges */}
                                    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
                                      {teamName && (
                                        <span style={{ fontSize: '12px', background: sel ? 'rgba(255,255,255,0.15)' : '#eef3fb', color: sel ? 'rgba(255,255,255,0.9)' : '#2d4a7a', padding: '2px 8px', borderRadius: '5px', fontWeight: '600' }}>
                                          👥 {teamName}
                                        </span>
                                      )}
                                      {p.app && (
                                        <span style={{ fontSize: '12px', background: sel ? 'rgba(255,255,255,0.15)' : '#f0f4fa', color: sel ? 'rgba(255,255,255,0.9)' : '#333', padding: '2px 8px', borderRadius: '5px', fontWeight: '600', border: `1px solid ${sel ? 'transparent' : '#dde3ee'}` }}>
                                          {p.app}
                                        </span>
                                      )}
                                      {p.estimatedMins && (
                                        <span style={{ fontSize: '12px', color: sel ? 'rgba(255,255,255,0.8)' : '#555', fontWeight: '600' }}>
                                          ⏱ {p.estimatedMins} דק'
                                        </span>
                                      )}
                                      {p.assignedUserName && (
                                        <span style={{ fontSize: '12px', color: sel ? 'rgba(255,255,255,0.75)' : '#666' }}>
                                          👤 {p.assignedUserName}
                                        </span>
                                      )}
                                      {p.notes && (
                                        <span style={{ fontSize: '11px', color: sel ? 'rgba(255,255,255,0.65)' : '#888', fontStyle: 'italic' }}>
                                          💬 {p.notes}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            {selectedProposalId && (
                              <button type="button" onClick={() => { setSelectedProposalId(null); setNewTask(EMPTY_TASK); }}
                                style={{ marginTop: '6px', fontSize: '11px', color: '#888', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                ✕ נקה בחירה
                              </button>
                            )}
                            <div style={{ fontSize: '11px', color: '#555', marginTop: '5px' }}>לחץ על הצעה לטעינה אוטומטית — ניתן לערוך לפני השמירה</div>
                          </div>
                        );
                      })()}
                      {/* Row 1: title | team | user (filtered by team) */}
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                        <input placeholder="שם המשימה *" value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                        <select value={selectedTeam} onChange={e => {
                          setSelectedTeam(e.target.value);
                          setNewTask((t: any) => ({ ...t, assignedUserName: '' }));
                        }}
                          style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}>
                          <option value="">צוות</option>
                          {teams.filter((t: any) => t.active).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        <select value={newTask.assignedUserName} onChange={e => setNewTask({ ...newTask, assignedUserName: e.target.value })}
                          style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}>
                          <option value="">-- עובד אחראי --</option>
                          {(selectedTeam
                            ? (teams.find((t: any) => t.id === selectedTeam)?.members || [])
                                .map((m: any) => m.user)
                                .sort((a: any, b: any) => a.fullName.localeCompare(b.fullName, 'he'))
                            : users
                          ).map((u: any) => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
                        </select>
                      </div>
                      {/* Row 2: CR# | app (filtered) | env | duration (minutes) */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                        {(() => {
                          const crList = (newTask.crNumber || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                          return (
                            <div style={{ border: '1px solid #ddd', borderRadius: '6px', padding: '4px 6px', background: 'white', minHeight: '36px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px', boxSizing: 'border-box' }}>
                              {crList.map((cr: string) => (
                                <span key={cr} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', background: '#e8f4fd', color: '#2980b9', borderRadius: '4px', padding: '2px 6px', fontSize: '12px' }}>
                                  {cr}
                                  <button onClick={() => setNewTask({ ...newTask, crNumber: crList.filter((c: string) => c !== cr).join(',') })}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2980b9', padding: '0', lineHeight: 1, fontSize: '14px' }}>×</button>
                                </span>
                              ))}
                              <input
                                list="cr-datalist"
                                value={newCrInput}
                                onChange={e => {
                                  setNewCrInput(e.target.value);
                                  const match = crItems.find(c => c.id === e.target.value || c.label === e.target.value);
                                  if (match) {
                                    if (!crList.includes(match.id)) {
                                      setNewTask({ ...newTask, crNumber: [...crList, match.id].join(',') });
                                    }
                                    setNewCrInput('');
                                  }
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' && newCrInput.trim()) {
                                    e.preventDefault();
                                    if (!crList.includes(newCrInput.trim())) {
                                      setNewTask({ ...newTask, crNumber: [...crList, newCrInput.trim()].join(',') });
                                    }
                                    setNewCrInput('');
                                  }
                                }}
                                placeholder={crList.length === 0 ? 'CR# (Enter להוספה)' : '+ הוסף CR'}
                                style={{ border: 'none', outline: 'none', fontSize: '13px', padding: '2px 4px', minWidth: '110px', flex: 1 }}
                              />
                            </div>
                          );
                        })()}
                        <select value={newTask.application} onChange={e => setNewTask({ ...newTask, application: e.target.value })}
                          style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}>
                          <option value="">Application</option>
                          {(selectedTeam && (teams.find((t: any) => t.id === selectedTeam)?.apps || []).length > 0
                            ? teams.find((t: any) => t.id === selectedTeam).apps
                            : APPS
                          ).map((a: string) => <option key={a} value={a}>{a}</option>)}
                        </select>
                        <select value={newTask.environment} onChange={e => setNewTask({ ...newTask, environment: e.target.value })} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}>
                          <option value="BOTH">HOT + HOTNET</option>
                          <option value="HOT">HOT בלבד</option>
                          <option value="HOTNET">HOTNET בלבד</option>
                        </select>
                        <div>
                          <label style={{ fontSize: '11px', color: '#777', display: 'block', marginBottom: '2px' }}>משך (דקות)</label>
                          <input type="number" min="1" value={newTask._durationMins}
                            onChange={e => {
                              const mins = parseInt(e.target.value);
                              const upd: any = { ...newTask, _durationMins: e.target.value };
                              if (mins > 0 && upd.plannedStart) upd.plannedEnd = calcEndFromMins(upd.plannedStart, mins);
                              setNewTask(upd);
                            }}
                            onBlur={e => {
                              const mins = parseInt(e.target.value);
                              if (mins > 0 && newTask.plannedStart)
                                setNewTask((t: any) => ({ ...t, plannedEnd: calcEndFromMins(t.plannedStart, mins) }));
                            }}
                            placeholder="דקות" style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} />
                        </div>
                      </div>
                      {/* Row 3: start | end (auto-calculated) */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                        <div>
                          <label style={{ fontSize: '11px', color: '#777', display: 'block', marginBottom: '3px' }}>תחילת משימה</label>
                          <input type="datetime-local" value={newTask.plannedStart}
                            onChange={e => {
                              const upd: any = { ...newTask, plannedStart: e.target.value };
                              const mins = parseInt(upd._durationMins);
                              if (mins > 0 && upd.plannedStart) upd.plannedEnd = calcEndFromMins(upd.plannedStart, mins);
                              setNewTask(upd);
                            }}
                            style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', color: '#777', display: 'block', marginBottom: '3px' }}>סיום משימה (מחושב)</label>
                          <input type="datetime-local" readOnly value={newTask.plannedEnd}
                            style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box', background: '#f5f5f5', color: '#666' }} />
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                        <input placeholder="הערת תלות (תלוי ב...)" value={newTask.dependencyNote} onChange={e => setNewTask({ ...newTask, dependencyNote: e.target.value })} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                        <input placeholder="הערה כללית" value={newTask.notes} onChange={e => setNewTask({ ...newTask, notes: e.target.value })} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                      </div>
                      {/* Dependency task selector */}
                      {(() => {
                        const allTasksInScope = version.phases
                          .filter((p: any) => p.orderIndex <= phase.orderIndex)
                          .flatMap((p: any) => (p.subPhases || []).flatMap((s: any) => (s.tasks || [])));
                        const available = allTasksInScope.filter((t: any) => !newTaskDepIds.includes(t.id));
                        if (allTasksInScope.length === 0) return null;
                        return (
                          <div style={{ background: '#f9f9ff', border: '1px solid #ddd', borderRadius: '6px', padding: '8px 10px', marginBottom: '8px' }}>
                            <label style={{ fontSize: '11px', color: '#777', display: 'block', marginBottom: '6px' }}>תלויות — המשימה תחכה לסיום:</label>
                            {newTaskDepIds.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                                {newTaskDepIds.map(depId => {
                                  const depTask = allTasksInScope.find((t: any) => t.id === depId);
                                  return (
                                    <span key={depId} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#e8f4fd', color: '#2d4a7a', padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>
                                      🔗 {depTask?.title || depId}
                                      <button type="button" onClick={() => setNewTaskDepIds(ids => ids.filter(id => id !== depId))}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontWeight: 'bold', fontSize: '13px', padding: '0 2px', lineHeight: 1 }}>✕</button>
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            {available.length > 0 && (
                              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <select value={newDepAddSelectId} onChange={e => setNewDepAddSelectId(e.target.value)}
                                  style={{ flex: 1, padding: '5px 7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px' }}>
                                  <option value="">— בחר משימה תלויה —</option>
                                  {version.phases
                                    .filter((p: any) => p.orderIndex <= phase.orderIndex)
                                    .map((p: any) => (
                                      <optgroup key={p.id} label={p.name}>
                                        {(p.subPhases || []).flatMap((s: any) =>
                                          (s.tasks || [])
                                            .filter((t: any) => !newTaskDepIds.includes(t.id))
                                            .map((t: any) => (
                                              <option key={t.id} value={t.id}>{t.title}</option>
                                            ))
                                        )}
                                      </optgroup>
                                    ))}
                                </select>
                                <button type="button" disabled={!newDepAddSelectId}
                                  onClick={() => {
                                    if (!newDepAddSelectId) return;
                                    const depTask = allTasksInScope.find((t: any) => t.id === newDepAddSelectId);
                                    setNewTaskDepIds(ids => [...ids, newDepAddSelectId]);
                                    setNewDepAddSelectId('');
                                    if (!depTask) return;
                                    // compute dep end time
                                    let depEnd = '';
                                    if (depTask.plannedEnd) {
                                      depEnd = utcToLocalInputStr(String(depTask.plannedEnd));
                                    } else if (depTask.plannedStart) {
                                      const sl = utcToLocalInputStr(String(depTask.plannedStart));
                                      const dm = parseDurationToMinutes(String(depTask.duration || ''));
                                      if (dm && dm > 0) depEnd = calcEndFromMins(sl, dm);
                                    }
                                    if (!depEnd) return;
                                    // update newTask with new start (and recompute end if duration set)
                                    const tm = parseInt(newTask._durationMins);
                                    const patch: any = { plannedStart: depEnd };
                                    if (tm > 0) patch.plannedEnd = calcEndFromMins(depEnd, tm);
                                    setNewTask((t: any) => ({ ...t, ...patch }));
                                  }}
                                  style={{ padding: '5px 12px', background: newDepAddSelectId ? '#2d4a7a' : '#ccc', color: 'white', border: 'none', borderRadius: '6px', cursor: newDepAddSelectId ? 'pointer' : 'not-allowed', fontSize: '12px', whiteSpace: 'nowrap' }}>
                                  + הוסף
                                </button>
                              </div>
                            )}
                            {available.length === 0 && newTaskDepIds.length === 0 && (
                              <span style={{ fontSize: '12px', color: '#aaa' }}>אין משימות קודמות זמינות לקישור</span>
                            )}
                          </div>
                        );
                      })()}
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => addTask(sub.id)} disabled={!newTask.title} style={{ padding: '8px 16px', background: newTask.title ? '#27ae60' : '#ccc', color: 'white', border: 'none', borderRadius: '6px', cursor: newTask.title ? 'pointer' : 'not-allowed', fontSize: '13px', fontWeight: 'bold' }}>הוסף</button>
                        <button onClick={() => { setAddingTask(null); setNewTask(EMPTY_TASK); setNewTaskDepIds([]); setNewDepAddSelectId(''); }} style={{ padding: '8px 16px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>ביטול</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {!collapsedPhases.has(phase.id) && !(phase.subPhases?.length > 0) && !isLocked && (
              <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '10px', color: C.textMuted, fontSize: '13px' }}>
                <span>אין תת-שלבים בשלב זה.</span>
                {isManager && (
                  <button onClick={() => addSubPhase(phase.id)} disabled={phaseManageLoading}
                    style={{ padding: '5px 14px', background: C.brand, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                    + הוסף תת-שלב
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Add Phase + error ── */}
      {isManager && !isLocked && (
        <div style={{ marginBottom: '12px' }}>
          {phaseManageError && (
            <div style={{ background: '#fee', border: '1px solid #e74c3c', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', color: '#c0392b', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              ⚠️ {phaseManageError}
              <button onClick={() => setPhaseManageError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontWeight: 'bold' }}>×</button>
            </div>
          )}
          {addingPhase ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'white', borderRadius: '10px', padding: '12px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
              <input
                autoFocus
                value={newPhaseName}
                onChange={e => setNewPhaseName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addPhase(); if (e.key === 'Escape') { setAddingPhase(false); setNewPhaseName(''); } }}
                placeholder="שם השלב החדש"
                style={{ flex: 1, padding: '8px 12px', border: '2px solid #2d4a7a', borderRadius: '6px', fontSize: '14px' }}
              />
              <button onClick={addPhase} disabled={!newPhaseName.trim() || phaseManageLoading} style={{ padding: '8px 16px', background: '#2d4a7a', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>הוסף</button>
              <button onClick={() => { setAddingPhase(false); setNewPhaseName(''); }} style={{ padding: '8px 14px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>ביטול</button>
            </div>
          ) : (
            <button
              onClick={() => setAddingPhase(true)}
              style={{ padding: '8px 18px', background: 'white', color: '#2d4a7a', border: '2px dashed #2d4a7a', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', width: '100%' }}>
              + הוסף שלב
            </button>
          )}
        </div>
      )}
    </>}

      {/* ── דיאלוג אישור העברת משימה ── */}
      {moveConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '14px', padding: '28px 32px', maxWidth: '420px', width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.25)', direction: 'rtl' }}>
            <div style={{ fontSize: '28px', marginBottom: '12px', textAlign: 'center' }}>🚚</div>
            <h3 style={{ margin: '0 0 10px', color: '#1a2332', textAlign: 'center' }}>העברת משימה</h3>
            <p style={{ margin: '0 0 20px', color: '#444', fontSize: '14px', lineHeight: 1.6, textAlign: 'center' }}>
              להעביר את <strong>"{moveConfirm.taskTitle}"</strong><br />
              לתת-שלב <strong>"{moveConfirm.targetSubName}"</strong>?
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button onClick={confirmMove} style={{ padding: '9px 24px', background: '#2d4a7a', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>אשר העברה</button>
              <button onClick={() => setMoveConfirm(null)} style={{ padding: '9px 24px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* ── דיאלוג תזמון מחדש ── */}
      {rescheduleOpen && (() => {
        // Compute overruns from current preview
        const overrunTaskIds = new Set<string>();
        if (reschPreview) {
          for (const u of reschPreview) {
            const phaseEnd = reschPhaseEnds[u.phaseId];
            if (phaseEnd && new Date(u.plannedEnd).getTime() > new Date(phaseEnd).getTime()) {
              overrunTaskIds.add(u.taskId);
            }
          }
        }
        // Group overrunning tasks by phase for display
        const overrunPhaseOrder: string[] = [];
        const overrunByPhase: Record<string, any[]> = {};
        if (reschPreview) {
          for (const u of reschPreview) {
            if (!overrunTaskIds.has(u.taskId)) continue;
            if (!overrunByPhase[u.phaseId]) { overrunByPhase[u.phaseId] = []; overrunPhaseOrder.push(u.phaseId); }
            overrunByPhase[u.phaseId].push(u);
          }
        }
        const totalOverrunTasks = overrunTaskIds.size;

        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'white', borderRadius: '14px', padding: '28px 32px', minWidth: '560px', maxWidth: '800px', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.3)', direction: 'rtl' }}>
              <h3 style={{ margin: '0 0 4px', color: '#1a2332' }}>📅 הכן ותזמן</h3>
              <p style={{ color: '#666', fontSize: '13px', margin: '0 0 16px' }}>
                הכן תלויות ומבנה, ואז הגדר שעות לכל שלב כדי לחשב את תוכנית הביצוע.
              </p>

              {/* ── Prep section ── */}
              <div style={{ background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: '10px', marginBottom: '18px', overflow: 'hidden' }}>
                <div
                  onClick={() => { setPrepOpen(o => !o); setPrepMessage(null); }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', cursor: 'pointer', userSelect: 'none' }}
                >
                  <span style={{ fontWeight: 'bold', fontSize: '13px', color: '#1a2332' }}>🔧 הכנה לפני תזמון — תלויות ומבנה</span>
                  <span style={{ fontSize: '12px', color: '#888' }}>{prepOpen ? '▲ סגור' : '▼ פתח'}</span>
                </div>
                {prepOpen && (
                  <div style={{ borderTop: '1px solid #e0e0e0', padding: '14px 16px' }}>
                    <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#666' }}>
                      הפעל לפי הסדר: סדר משימות ← תלויות לפי עובד ← עדכן שרשראות ← נקה תלויות שגויות
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      <button onClick={async () => {
                        try {
                          const res = await axios.post(`${API}/versions/${version.id}/fix-task-order`, {}, { headers });
                          setPrepMessage({ text: `✅ סדר משימות תוקן — ${res.data.fixed} משימות עודכנו`, ok: true });
                          onRefresh();
                        } catch (err: any) {
                          setPrepMessage({ text: `❌ ${err?.response?.data?.message || 'שגיאה בתיקון סדר משימות'}`, ok: false });
                        }
                      }} style={{ padding: '7px 14px', background: '#2d4a7a', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                        🔢 סדר משימות
                      </button>
                      <button onClick={async () => {
                        try {
                          const res = await axios.post(`${API}/versions/${version.id}/auto-deps-by-user`, {}, { headers });
                          setLastUserDepPairs(res.data.createdPairs ?? []);
                          setPrepMessage({ text: `✅ תלויות לפי עובד — ${res.data.created} חדשות, ${res.data.skipped} קיימות`, ok: true });
                          onRefresh();
                        } catch (err: any) {
                          setPrepMessage({ text: `❌ ${err?.response?.data?.message || 'שגיאה ביצירת תלויות'}`, ok: false });
                        }
                      }} style={{ padding: '7px 14px', background: '#7f3fbf', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                        👤 צור תלויות לפי עובד
                      </button>
                      {lastUserDepPairs && lastUserDepPairs.length > 0 && (
                        <button onClick={() => showConfirm(
                          'ביטול תלויות עובד',
                          `לבטל ${lastUserDepPairs.length} תלויות שנוצרו בריצה האחרונה?`,
                          async () => {
                            try {
                              const res = await axios.post(`${API}/versions/${version.id}/rollback-user-deps`, { pairs: lastUserDepPairs }, { headers });
                              setLastUserDepPairs(null);
                              setPrepMessage({ text: `✅ בוטלו ${res.data.deleted} תלויות`, ok: true });
                              onRefresh();
                            } catch (err: any) {
                              setPrepMessage({ text: `❌ ${err?.response?.data?.message || 'שגיאה ברולבק'}`, ok: false });
                            }
                          }, 'בטל תלויות', 'warning'
                        )} style={{ padding: '7px 14px', background: '#e67e22', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                          ↩ בטל תלויות עובד ({lastUserDepPairs.length})
                        </button>
                      )}
                      <button onClick={async () => {
                        try {
                          const res = await axios.post(`${API}/versions/${version.id}/resolve-deps`, {}, { headers });
                          setPrepMessage({ text: `✅ שרשראות תלות עודכנו — ${res.data.resolved} טופלו`, ok: true });
                          onRefresh();
                        } catch (err: any) {
                          setPrepMessage({ text: `❌ ${err?.response?.data?.message || 'שגיאה בעדכון תלויות'}`, ok: false });
                        }
                      }} style={{ padding: '7px 14px', background: '#7f3fbf', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                        🔗 עדכן שרשראות תלות
                      </button>
                      <button onClick={() => showConfirm(
                        'ניקוי תלויות שגויות',
                        'למחוק תלויות בין-שלביות שגויות? פעולה זו אינה הפיכה.',
                        async () => {
                          try {
                            const res = await axios.post(`${API}/versions/${version.id}/fix-cross-phase-deps`, {}, { headers });
                            setPrepMessage({ text: `✅ נמחקו ${res.data.deleted} תלויות בין-שלביות`, ok: true });
                            onRefresh();
                          } catch (err: any) {
                            setPrepMessage({ text: `❌ ${err?.response?.data?.message || 'שגיאה'}`, ok: false });
                          }
                        }, 'נקה', 'warning'
                      )} style={{ padding: '7px 14px', background: '#c0392b', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                        🗑 נקה תלויות בין-שלביות
                      </button>
                    </div>
                    {prepMessage && (
                      <div style={{ marginTop: '10px', padding: '8px 12px', borderRadius: '7px', fontSize: '12px', background: prepMessage.ok ? '#d5f0dc' : '#fee', color: prepMessage.ok ? '#1a5c2a' : '#c0392b', border: `1px solid ${prepMessage.ok ? '#a9dfbf' : '#e74c3c'}` }}>
                        {prepMessage.text}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Dependencies toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={reschRespectDeps} onChange={e => setReschRespectDeps(e.target.checked)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                <span style={{ fontSize: '13px', color: '#1a2332' }}>התחשב בתלויות בין משימות</span>
                <span style={{ fontSize: '11px', color: '#888' }}>(שעת התחלה = max(תחילת השלב, סיום תלויות))</span>
              </label>

              {/* Phase start/end inputs */}
              <div style={{ marginBottom: '6px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '11px', color: '#888', fontWeight: 'bold', paddingRight: '2px' }}>
                <span>שלב</span><span style={{ textAlign: 'center' }}>שעת התחלה</span><span style={{ textAlign: 'center' }}>שעת סיום (יעד)</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginBottom: '18px' }}>
                {([...(version.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex)).map((phase: any, idx: number, arr: any[]) => {
                  const prevPhase = idx > 0 ? arr[idx - 1] : null;

                  // Compute previous phase's known end (from preview data, or DB stored end)
                  let prevEnd: Date | null = null;
                  if (prevPhase) {
                    if (reschPreview) {
                      const prevTasks = reschPreview.filter((u: any) => u.phaseId === prevPhase.id);
                      if (prevTasks.length > 0)
                        prevEnd = new Date(Math.max(...prevTasks.map((u: any) => new Date(u.plannedEnd).getTime())));
                    }
                    if (!prevEnd && prevPhase.plannedEnd)
                      prevEnd = new Date(prevPhase.plannedEnd);
                  }

                  const thisStart = reschPhaseStarts[phase.id] ? new Date(reschPhaseStarts[phase.id]) : null;
                  const hasOverlap = !!(prevEnd && thisStart && thisStart.getTime() < prevEnd.getTime());

                  return (
                    <div key={phase.id}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', alignItems: 'center' }}>
                        <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#1a2332', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={phase.name}>{phase.name}</label>
                        <div>
                          <input type="datetime-local" value={reschPhaseStarts[phase.id] || ''}
                            onChange={e => setReschPhaseStarts(prev => ({ ...prev, [phase.id]: e.target.value }))}
                            style={{ padding: '6px 8px', border: `1.5px solid ${hasOverlap ? '#e74c3c' : '#ddd'}`, borderRadius: '7px', fontSize: '12px', width: '100%', boxSizing: 'border-box' as any }} />
                          {hasOverlap && prevEnd && (
                            <div style={{ color: '#e74c3c', fontSize: '10px', marginTop: '2px' }}>
                              ⚠️ מתחיל לפני סיום השלב הקודם ({prevEnd.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})
                            </div>
                          )}
                        </div>
                        <input type="datetime-local" value={reschPhaseEnds[phase.id] || ''}
                          onChange={e => setReschPhaseEnds(prev => ({ ...prev, [phase.id]: e.target.value }))}
                          style={{ padding: '6px 8px', border: '1.5px solid #e67e22', borderRadius: '7px', fontSize: '12px', width: '100%', boxSizing: 'border-box' as any }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {reschError && (
                <div style={{ background: '#fee', border: '1px solid #e74c3c', borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', color: '#c0392b', fontSize: '13px' }}>
                  {reschError}
                </div>
              )}

              {reschWarnings.length > 0 && (
                <div style={{ background: '#fff8e1', border: '1px solid #f39c12', borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '12px', color: '#7d5200' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>⚠️ התאמות אוטומטיות — שלבים שהוזזו קדימה:</div>
                  {reschWarnings.map((w, i) => <div key={i}>• {w}</div>)}
                </div>
              )}

              {/* Preview — only overrunning tasks */}
              {reschPreview && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#1a2332' }}>
                      תצוגה מקדימה — {reschPreview.length} משימות יעודכנו
                    </span>
                    {totalOverrunTasks > 0 ? (
                      <span style={{ background: '#fee', color: '#c0392b', padding: '2px 10px', borderRadius: '10px', fontSize: '12px', border: '1px solid #e74c3c', fontWeight: 'bold' }}>
                        ⚠️ {totalOverrunTasks} משימות חורגות
                      </span>
                    ) : (
                      <span style={{ background: '#d5f0dc', color: '#1a5c2a', padding: '2px 10px', borderRadius: '10px', fontSize: '12px', border: '1px solid #a9dfbf' }}>
                        ✅ אין חריגות
                      </span>
                    )}
                  </div>

                  {totalOverrunTasks > 0 && (
                    <div style={{ border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden', maxHeight: '320px', overflowY: 'auto' }}>
                      {overrunPhaseOrder.map(phaseId => {
                        const tasks = overrunByPhase[phaseId];
                        const phaseEndStr = reschPhaseEnds[phaseId];
                        return (
                          <React.Fragment key={phaseId}>
                            {/* Phase header */}
                            <div style={{ background: '#fff3e0', padding: '6px 12px', fontWeight: 'bold', fontSize: '12px', color: '#b7380a', borderBottom: '1px solid #ffe0b2', display: 'flex', justifyContent: 'space-between' }}>
                              <span>{tasks[0]?.phaseName}</span>
                              {phaseEndStr && (
                                <span style={{ fontWeight: 'normal', color: '#c0392b' }}>
                                  יעד סיום: {formatDateTimeShort(phaseEndStr)}
                                </span>
                              )}
                            </div>
                            {/* Overrunning task rows */}
                            {tasks.map((u: any) => {
                              const isEditing = reschEditingId === u.taskId;
                              const overrunMins = phaseEndStr
                                ? Math.round((new Date(u.plannedEnd).getTime() - new Date(phaseEndStr).getTime()) / 60000)
                                : 0;
                              return (
                                <div key={u.taskId} style={{ borderBottom: '1px solid #f5f5f5', background: isEditing ? '#fffbf0' : '#fff8f8' }}>
                                  {/* Task info row */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 12px' }}>
                                    <div style={{ flex: 1, fontSize: '12px' }}>
                                      <span style={{ fontWeight: 'bold', color: '#1a2332' }}>{u.title}</span>
                                      <span style={{ color: '#888', marginRight: '8px', fontFamily: 'monospace', fontSize: '11px' }}>
                                        {formatDateTimeShort(u.plannedStart)} — <span style={{ color: '#c0392b', fontWeight: 'bold' }}>{formatDateTimeShort(u.plannedEnd)}</span>
                                      </span>
                                      {u.duration && <span style={{ background: '#fef9e7', color: '#b7950b', padding: '1px 5px', borderRadius: '4px', fontSize: '11px' }}>⏱ {u.duration}</span>}
                                      {overrunMins > 0 && (
                                        <span style={{ color: '#c0392b', fontSize: '11px', marginRight: '6px' }}>({overrunMins} דק' חריגה)</span>
                                      )}
                                    </div>
                                    <button
                                      onClick={() => {
                                        if (isEditing) { setReschEditingId(null); setReschEditStart(''); setReschEditDur(''); setReschEditEnd(''); }
                                        else { setReschEditingId(u.taskId); setReschEditStart(utcToLocalInputStr(u.plannedStart)); setReschEditDur(u.duration || ''); setReschEditEnd(utcToLocalInputStr(u.plannedEnd)); }
                                      }}
                                      style={{ padding: '3px 10px', background: isEditing ? '#555' : '#e67e22', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}>
                                      {isEditing ? '✕ סגור' : '✏️ תקן'}
                                    </button>
                                  </div>
                                  {/* Inline edit form */}
                                  {isEditing && (
                                    <div style={{ background: '#fffde7', padding: '10px 12px', borderTop: '1px solid #ffe082', display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                      <div>
                                        <div style={{ fontSize: '11px', color: '#3498db', marginBottom: '3px', fontWeight: 'bold' }}>שעת התחלה</div>
                                        <input type="datetime-local" value={reschEditStart}
                                          onChange={e => {
                                            const v = e.target.value;
                                            setReschEditStart(v);
                                            const mins = parseDurationToMinutes(reschEditDur);
                                            if (mins && mins > 0 && v) setReschEditEnd(calcEndFromMins(v, mins));
                                          }}
                                          style={{ padding: '5px 8px', border: '1.5px solid #3498db', borderRadius: '6px', fontSize: '12px' }} />
                                      </div>
                                      <div style={{ color: '#bbb', fontWeight: 'bold', paddingBottom: '5px' }}>|</div>
                                      <div>
                                        <div style={{ fontSize: '11px', color: '#666', marginBottom: '3px' }}>משך (45ד' / 1ש' 30ד')</div>
                                        <input value={reschEditDur}
                                          onChange={e => {
                                            const v = e.target.value;
                                            setReschEditDur(v);
                                            const mins = parseDurationToMinutes(v);
                                            if (mins && mins > 0 && reschEditStart) setReschEditEnd(calcEndFromMins(reschEditStart, mins));
                                          }}
                                          placeholder="למשל: 30ד'"
                                          style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', width: '100px' }} />
                                      </div>
                                      <div style={{ color: '#888', fontWeight: 'bold', paddingBottom: '5px' }}>→</div>
                                      <div>
                                        <div style={{ fontSize: '11px', color: '#666', marginBottom: '3px' }}>שעת סיום</div>
                                        <input type="datetime-local" value={reschEditEnd} onChange={e => setReschEditEnd(e.target.value)}
                                          style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px' }} />
                                      </div>
                                      <button onClick={() => applyTaskEdit(u.taskId)}
                                        style={{ padding: '5px 14px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                                        עדכן חישוב
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid #eee', paddingTop: '14px' }}>
                <button onClick={() => { setRescheduleOpen(false); setReschPreview(null); setReschEditingId(null); }}
                  style={{ padding: '8px 18px', background: '#f0f0f0', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
                  ביטול
                </button>
                <button onClick={applyPhaseStartToAllTasks} disabled={reschLoading}
                  style={{ padding: '8px 18px', background: '#7f3fbf', color: 'white', border: 'none', borderRadius: '8px', cursor: reschLoading ? 'not-allowed' : 'pointer', fontSize: '13px' }}>
                  {reschLoading ? '...' : '⚡ קבע שעת שלב לכל המשימות'}
                </button>
                <button onClick={previewReschedule} disabled={reschLoading}
                  style={{ padding: '8px 18px', background: '#2d4a7a', color: 'white', border: 'none', borderRadius: '8px', cursor: reschLoading ? 'not-allowed' : 'pointer', fontSize: '13px' }}>
                  {reschLoading ? '...' : '👁 חשב ותצוגה מקדימה'}
                </button>
                {reschPreview && (
                  <button onClick={applyScheduleFromPreview} disabled={reschLoading}
                    style={{ padding: '8px 18px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '8px', cursor: reschLoading ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                    {reschLoading ? '...' : `✅ אשר ועדכן תוכנית (${reschPreview.length} משימות)`}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Global datalist for CR# combo-box — shared by add and edit forms */}
      <datalist id="cr-datalist">
        {crItems.map(cr => (
          <option key={cr.id} value={cr.id}>{cr.label}</option>
        ))}
      </datalist>

      {/* ── Save template modal ── */}
      {saveTemplateOpen && (() => {
        const selectedTemplate = localTemplates.find(t => t.id === saveTemplateSelectId);
        const effectiveName = saveTemplateMode === 'update'
          ? (selectedTemplate?.name ?? '')
          : saveTemplateName.trim();
        const canSave = !!effectiveName && !savingTemplate;

        const doSave = async () => {
          if (!canSave) return;
          setSavingTemplate(true);
          try {
            await axios.post(`${API}/version-templates/from-version/${version.id}`, { name: effectiveName }, { headers });
            setSaveTemplateOpen(false);
            // Refresh local template list
            const res = await axios.get(`${API}/version-templates`, { headers });
            setLocalTemplates(res.data);
            const verb = saveTemplateMode === 'update' ? 'עודכנה' : 'נשמרה';
            showAlert('תבנית נשמרה', `התבנית "${effectiveName}" ${verb} בהצלחה עם כל נתוני העובדים והצוותים.`, 'success');
          } catch (err: any) {
            showAlert('שגיאה', err?.response?.data?.message || 'שגיאה בשמירת התבנית', 'danger');
          } finally {
            setSavingTemplate(false);
          }
        };

        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'white', borderRadius: '14px', padding: '28px', width: '460px', maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.25)', direction: 'rtl' }}>
              <h3 style={{ margin: '0 0 6px', color: '#1a2332', fontSize: '18px' }}>💾 שמירת תבנית</h3>
              <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#666' }}>
                שומר עותק מלא של הגרסה כולל שמות עובדים, צוותים ותלויות.
              </p>

              {/* Mode selector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                {localTemplates.length > 0 && (
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', padding: '12px', border: `2px solid ${saveTemplateMode === 'update' ? '#27ae60' : '#e0e0e0'}`, borderRadius: '10px', background: saveTemplateMode === 'update' ? '#f0faf4' : 'white' }}>
                    <input type="radio" name="tplMode" value="update" checked={saveTemplateMode === 'update'} onChange={() => setSaveTemplateMode('update')} style={{ marginTop: '2px' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '6px' }}>🔄 עדכן תבנית קיימת</div>
                      <select
                        value={saveTemplateSelectId}
                        onChange={e => { setSaveTemplateSelectId(e.target.value); setSaveTemplateMode('update'); }}
                        style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
                      >
                        {localTemplates.map(t => (
                          <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>
                        ))}
                      </select>
                    </div>
                  </label>
                )}
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', padding: '12px', border: `2px solid ${saveTemplateMode === 'new' ? '#2d4a7a' : '#e0e0e0'}`, borderRadius: '10px', background: saveTemplateMode === 'new' ? '#f0f4fa' : 'white' }}>
                  <input type="radio" name="tplMode" value="new" checked={saveTemplateMode === 'new'} onChange={() => setSaveTemplateMode('new')} style={{ marginTop: '2px' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '6px' }}>✨ צור תבנית חדשה</div>
                    <input
                      type="text"
                      value={saveTemplateName}
                      onChange={e => { setSaveTemplateName(e.target.value); setSaveTemplateMode('new'); }}
                      placeholder="שם התבנית החדשה"
                      style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>
                </label>
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button onClick={() => setSaveTemplateOpen(false)} style={{ padding: '10px 20px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>ביטול</button>
                <button
                  onClick={doSave}
                  disabled={!canSave}
                  style={{ padding: '10px 24px', background: canSave ? '#27ae60' : '#ccc', color: 'white', border: 'none', borderRadius: '8px', cursor: canSave ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontSize: '14px' }}
                >
                  {savingTemplate ? 'שומר...' : '💾 שמור תבנית'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />

      {/* ── Reassign employee modal ── */}
      {reassignOpen && (() => {
        const sortedPhases = [...(version.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);

        // Distinct assigned user names currently in this version
        const nameSet = new Set<string>();
        sortedPhases.forEach((p: any) =>
          (p.subPhases || []).forEach((s: any) =>
            (s.tasks || []).forEach((t: any) => {
              if (t.assignedUserName && t.assignedUserName !== 'Missing') nameSet.add(t.assignedUserName);
            })
          )
        );
        const assignedNames = Array.from(nameSet).sort((a, b) => a.localeCompare(b, 'he'));

        // Per-phase task count for selected user
        const phaseCountsForUser: { phase: any; count: number }[] = reassignFrom
          ? sortedPhases.map((p: any) => ({
              phase: p,
              count: (p.subPhases || []).reduce((acc: number, s: any) =>
                acc + (s.tasks || []).filter((t: any) => t.assignedUserName === reassignFrom).length, 0),
            })).filter(x => x.count > 0)
          : [];

        const totalCount = phaseCountsForUser.reduce((a, x) => a + x.count, 0);
        const filteredCount = reassignPhaseId
          ? (phaseCountsForUser.find(x => x.phase.id === reassignPhaseId)?.count ?? 0)
          : totalCount;

        const canSubmit = !!reassignFrom && !!reassignTo && !reassigning;

        const doReassign = async () => {
          setReassigning(true);
          setReassignResult(null);
          try {
            const res = await axios.patch(
              `${API}/versions/${version.id}/reassign-tasks`,
              { fromUserName: reassignFrom, toUserId: reassignTo, ...(reassignPhaseId ? { phaseId: reassignPhaseId } : {}) },
              { headers },
            );
            setReassignResult(res.data);
            onRefresh();
          } catch (err: any) {
            showAlert('שגיאה', err?.response?.data?.message || 'שגיאה בהחלפת עובד', 'danger');
          } finally {
            setReassigning(false);
          }
        };

        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'white', borderRadius: '14px', padding: '28px', width: '480px', maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.25)', direction: 'rtl' }}>
              <h3 style={{ margin: '0 0 20px', color: '#1a2332', fontSize: '18px' }}>🔄 החלפת עובד במשימות</h3>

              {!reassignResult ? (
                <>
                  {/* From user */}
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '6px', fontSize: '14px', color: '#333' }}>החלף את</label>
                    <select
                      value={reassignFrom}
                      onChange={e => { setReassignFrom(e.target.value); setReassignPhaseId(''); }}
                      style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }}
                    >
                      <option value="">-- בחר עובד להחלפה --</option>
                      {(assignedNames as string[]).map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Phase scope — shown only after selecting a user */}
                  {reassignFrom && phaseCountsForUser.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '6px', fontSize: '14px', color: '#333' }}>בשלב</label>
                      <select
                        value={reassignPhaseId}
                        onChange={e => setReassignPhaseId(e.target.value)}
                        style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }}
                      >
                        <option value="">כל הגרסה ({totalCount} משימות)</option>
                        {phaseCountsForUser.map(({ phase, count }) => (
                          <option key={phase.id} value={phase.id}>{phase.name} ({count} משימות)</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {reassignFrom && phaseCountsForUser.length === 0 && (
                    <div style={{ marginBottom: '16px', padding: '10px 14px', background: '#fff8e1', border: '1px solid #f39c12', borderRadius: '8px', fontSize: '13px', color: '#856404' }}>
                      אין משימות מוקצות ל-{reassignFrom} בגרסה זו
                    </div>
                  )}

                  {/* To user */}
                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '6px', fontSize: '14px', color: '#333' }}>
                      {reassignPhaseId
                        ? `בעובד חדש — ${filteredCount} משימות יעודכנו`
                        : `בעובד חדש${filteredCount > 0 ? ` — ${filteredCount} משימות יעודכנו` : ''}`}
                    </label>
                    <select
                      value={reassignTo}
                      onChange={e => setReassignTo(e.target.value)}
                      style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }}
                    >
                      <option value="">-- בחר עובד חדש --</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.fullName}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button onClick={() => setReassignOpen(false)} style={{ padding: '10px 20px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>ביטול</button>
                    <button
                      onClick={doReassign}
                      disabled={!canSubmit || filteredCount === 0}
                      style={{ padding: '10px 24px', background: canSubmit && filteredCount > 0 ? '#e67e22' : '#ccc', color: 'white', border: 'none', borderRadius: '8px', cursor: canSubmit && filteredCount > 0 ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontSize: '14px' }}
                    >
                      {reassigning ? 'מחליף...' : `החלף (${filteredCount} משימות)`}
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '40px', marginBottom: '12px' }}>✅</div>
                  <p style={{ fontSize: '16px', color: '#1a2332', marginBottom: '4px' }}>
                    <strong>{reassignResult.updated}</strong> משימות עודכנו בהצלחה
                  </p>
                  <p style={{ fontSize: '14px', color: '#555', marginBottom: '24px' }}>
                    "{reassignFrom}" הוחלף ב-"{reassignResult.toUserName}"
                    {reassignPhaseId && ` בשלב הנבחר`}
                  </p>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                    <button
                      onClick={() => { setReassignFrom(''); setReassignTo(''); setReassignPhaseId(''); setReassignResult(null); }}
                      style={{ padding: '10px 20px', background: '#e67e22', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                      החלף עוד
                    </button>
                    <button onClick={() => setReassignOpen(false)} style={{ padding: '10px 20px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>סגור</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── פאנל סקירת הגשת צוות ── */}
      {teamPanelOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, direction: 'rtl' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,20,40,0.6)' }} onClick={closeTeamPanel} />
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '800px', maxWidth: '95vw', background: 'white', boxShadow: '-8px 0 32px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', background: '#1a2332', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '16px' }}>📋 סקירת הגשת משימות</div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>{teamPanelOpen.teamName} — {version.name}</div>
              </div>
              <button onClick={closeTeamPanel} style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>✕ סגור</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <TeamLeadProposalView
                token={token}
                versionId={version.id}
                versionName={version.name}
                teamIdOverride={teamPanelOpen.teamId}
                teamNameOverride={teamPanelOpen.teamName}
                isManager={isManager}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── אשף הכנת תוכנית ── */}
      {wizardOpen && (
        <PlanWizard
          version={version}
          token={token}
          users={users}
          teams={teams}
          onClose={() => setWizardOpen(false)}
          onRefresh={() => { onRefresh(); }}
        />
      )}

      {/* ── Task detail / edit / add modal ── */}
      {(selectedTask !== null || selectedTaskSubId) && (() => {
        const isExec = ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(version.status);
        const phaseForTask = selectedTask
          ? version.phases?.find((p: any) => p.subPhases?.some((s: any) => s.tasks?.some((t: any) => t.id === selectedTask.id)))
          : undefined;
        return (
          <>
            <div
              onClick={() => { setSelectedTask(null); setSelectedTaskSubId(undefined); }}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 499 }}
            />
            <div style={{
              position: 'fixed',
              top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '760px', maxWidth: '94vw',
              maxHeight: '84vh', height: 'auto',
              zIndex: 500, borderRadius: '16px',
              overflow: 'visible',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
            }}>
              <TaskDetailPanel
                key={selectedTask?.id ?? `add-${selectedTaskSubId}`}
                task={selectedTask}
                subPhaseId={selectedTaskSubId}
                versionId={version.id}
                token={token}
                isLocked={isLocked}
                readonlyStatus={!isExec}
                teams={teams}
                users={users}
                crItems={crItems}
                proposals={proposals.filter((p: any) => Number(p.phase) === Number(selectedTask
                  ? (version.phases?.find((ph: any) => ph.subPhases?.some((s: any) => s.tasks?.some((t: any) => t.id === selectedTask.id)))?.orderIndex ?? 0)
                  : selectedTaskPhaseOrder
                ))}
                versionPhases={version.phases ?? []}
                currentPhaseOrder={phaseForTask?.orderIndex ?? 999}
                phaseStart={selectedTaskPhaseStart}
                phaseEnd={selectedTaskPhaseEnd}
                onClose={() => { setSelectedTask(null); setSelectedTaskSubId(undefined); }}
                onSave={() => { onRefresh(); refreshProposals(); setSelectedTask(null); setSelectedTaskSubId(undefined); }}
              />
            </div>
          </>
        );
      })()}

      {/* ── Assign preview modal ── */}
      {showAssignPreview && (() => {
        // Phase colors matching TeamView environment palette (light theme)
        const PHASE_META: Record<number, { label: string; color: string; bg: string; border: string }> = {
          1: { label: 'שלב 1 — בוקר לפני גרסה', color: '#17a2b8', bg: 'rgba(23,162,184,0.08)',   border: '#17a2b8' },
          2: { label: 'שלב 2 — HOTNET',          color: C.statusOpen,    bg: C.bgOpen,             border: C.statusOpen },
          3: { label: 'שלב 3 — HOT',             color: C.statusBlocked, bg: C.bgBlocked,           border: C.statusBlocked },
          4: { label: 'שלב 4 — בוקר שלאחר גרסה', color: '#6366f1', bg: 'rgba(99,102,241,0.08)',   border: '#6366f1' },
        };
        const phaseOf = (n: number) => PHASE_META[n] ?? { label: `שלב ${n}`, color: C.textSecondary, bg: C.bgNested, border: C.border };

        const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
          APPROVED:       { label: '✓ מאושר',  color: '#2e7d32', bg: 'rgba(46,125,50,0.10)'   },
          PENDING:        { label: '⏳ ממתין',  color: '#d4840a', bg: 'rgba(212,132,10,0.10)'  },
          REJECTED:       { label: '✗ נדחה',   color: C.statusBlocked, bg: C.bgBlocked          },
          NEEDS_REVISION: { label: '↩ לתיקון', color: '#d4840a', bg: 'rgba(212,132,10,0.10)'  },
        };

        const teamMap = new Map<string, string>(teams.map((t: any) => [t.id, t.name]));
        const phases = Array.from(new Set(previewItems.map(i => i.proposal.phase))).sort((a, b) => a - b);
        const checkedCount = previewItems.filter(i => i.checked).length;
        const missingFields = (p: any) => !p.assignedUserName?.trim() || !p.estimatedMins;

        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
            onClick={() => setShowAssignPreview(false)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: C.bgCard, borderRadius: RADIUS.xl, padding: `${SP[5]} ${SP[6]}`,
                minWidth: '580px', maxWidth: '740px', width: '92%', maxHeight: '87vh',
                display: 'flex', flexDirection: 'column', gap: SP[4],
                boxShadow: SHADOW.lg, direction: 'rtl', fontFamily: FONT,
                border: `1px solid ${C.border}`,
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: SP[4] }}>
                <div>
                  <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary, letterSpacing: '-0.3px' }}>
                    📋 שיבוץ הצעות — תצוגה מקדימה
                  </div>
                  <div style={{ ...TEXT.sm, color: C.textMuted, marginTop: SP[1] }}>
                    {previewItems.length} הצעות •{' '}
                    <span style={{ color: checkedCount > 0 ? '#2e7d32' : C.textMuted, fontWeight: WEIGHT.semibold }}>{checkedCount} מסומנות לשיבוץ</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: SP[2] }}>
                  <button
                    onClick={() => setPreviewItems(prev => prev.map(i => ({ ...i, checked: true })))}
                    style={{ padding: '5px 12px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textPrimary, fontFamily: FONT, fontSize: '12px', cursor: 'pointer', fontWeight: WEIGHT.semibold }}
                  >
                    ✔ בחר הכל
                  </button>
                  <button
                    onClick={() => setPreviewItems(prev => prev.map(i => ({ ...i, checked: false })))}
                    style={{ padding: '5px 12px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textMuted, fontFamily: FONT, fontSize: '12px', cursor: 'pointer' }}
                  >
                    ☐ בטל הכל
                  </button>
                </div>
              </div>

              {/* Proposal list grouped by phase */}
              <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: SP[2] }}>
                {phases.map(phaseNum => {
                  const ph = phaseOf(phaseNum);
                  const phaseItems = previewItems.filter(i => i.proposal.phase === phaseNum);
                  return (
                    <div key={phaseNum} style={{ marginBottom: SP[2] }}>
                      {/* Phase header — matches TeamView env badge style */}
                      <div style={{
                        padding: `${SP[2]} ${SP[3]}`,
                        borderRadius: RADIUS.md,
                        background: `linear-gradient(135deg, ${C.bgElevated} 0%, ${C.bgCard} 100%)`,
                        borderBottom: `2px solid ${ph.border}`,
                        borderRight: `4px solid ${ph.border}`,
                        border: `1px solid ${C.border}`,
                        borderRightWidth: '4px',
                        fontSize: '12px', fontWeight: WEIGHT.bold, color: ph.color,
                        letterSpacing: '0.3px',
                        marginBottom: SP[2],
                        display: 'flex', alignItems: 'center', gap: SP[2],
                      }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: ph.color, flexShrink: 0, display: 'inline-block' }} />
                        {ph.label}
                        <span style={{ marginRight: 'auto', color: C.textMuted, fontWeight: WEIGHT.medium, fontSize: '11px' }}>{phaseItems.length} הצעות</span>
                      </div>

                      {/* Items */}
                      {phaseItems.map((item) => {
                        const p = item.proposal;
                        const warn = missingFields(p);
                        const sb = STATUS_BADGE[p.reviewStatus] ?? { label: p.reviewStatus, color: C.textMuted, bg: C.bgNested };
                        return (
                          <div
                            key={p.id}
                            onClick={() => setPreviewItems(prev => prev.map(i => i.proposal.id === p.id ? { ...i, checked: !i.checked } : i))}
                            style={{
                              display: 'grid', gridTemplateColumns: '22px 1fr auto auto',
                              alignItems: 'center', gap: SP[3],
                              padding: `${SP[2]} ${SP[3]}`,
                              borderRadius: RADIUS.md,
                              background: item.checked ? ph.bg : C.bgNested,
                              border: `1px solid ${item.checked ? ph.border + '55' : C.border}`,
                              borderRight: `3px solid ${item.checked ? ph.border : 'transparent'}`,
                              marginBottom: SP[1],
                              opacity: item.checked ? 1 : 0.7,
                              cursor: 'pointer',
                              transition: EASE.fast,
                            }}
                          >
                            {/* Checkbox */}
                            <input
                              type="checkbox"
                              checked={item.checked}
                              onChange={e => { e.stopPropagation(); setPreviewItems(prev => prev.map(i => i.proposal.id === p.id ? { ...i, checked: e.target.checked } : i)); }}
                              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: ph.color }}
                            />

                            {/* Title + meta */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: SP[1], minWidth: 0 }}>
                              <span style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {p.title}
                              </span>
                              <div style={{ display: 'flex', gap: SP[1], flexWrap: 'wrap', alignItems: 'center' }}>
                                {/* Team */}
                                <span style={{ fontSize: '11px', background: C.bgOpen, color: C.statusOpen, padding: '2px 8px', borderRadius: RADIUS.sm, fontWeight: WEIGHT.semibold, border: `1px solid ${C.statusOpen}33`, whiteSpace: 'nowrap' }}>
                                  {teamMap.get(p.teamId) ?? p.teamId}
                                </span>
                                {/* Assignee */}
                                {p.assignedUserName && (
                                  <span style={{ fontSize: '11px', color: C.textMuted }}>• {p.assignedUserName}</span>
                                )}
                                {/* CR badge */}
                                {p.crNumber && (
                                  <span style={{
                                    fontSize: '11px', fontWeight: WEIGHT.bold, fontFamily: 'monospace',
                                    background: 'rgba(23,162,184,0.10)', color: '#17a2b8',
                                    padding: '2px 8px', borderRadius: RADIUS.sm,
                                    border: '1px solid rgba(23,162,184,0.30)', whiteSpace: 'nowrap',
                                  }}>
                                    {p.crNumber}
                                  </span>
                                )}
                                {/* Duration */}
                                {p.estimatedMins && (
                                  <span style={{ fontSize: '11px', color: C.textMuted, background: C.bgCard, padding: '2px 7px', borderRadius: RADIUS.sm, border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                                    ⏱ {p.estimatedMins} דק׳
                                  </span>
                                )}
                                {warn && (
                                  <span style={{ fontSize: '11px', color: C.statusBlocked, fontWeight: WEIGHT.semibold }}>⚠ חסרים פרטי ביצוע</span>
                                )}
                              </div>
                            </div>

                            {/* Status badge */}
                            <span style={{ fontSize: '11px', fontWeight: WEIGHT.semibold, whiteSpace: 'nowrap', color: sb.color, background: sb.bg, padding: '3px 9px', borderRadius: RADIUS.sm, border: `1px solid ${sb.color}33` }}>
                              {sb.label}
                            </span>

                            {/* Delete */}
                            <button
                              onClick={e => { e.stopPropagation(); handleDeleteFromPreview(p.id); }}
                              title="מחק הצעה לצמיתות"
                              style={{ padding: '4px 8px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: 'transparent', color: C.statusBlocked, fontFamily: FONT, fontSize: '12px', cursor: 'pointer', opacity: 0.7 }}
                            >
                              🗑
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {previewItems.length === 0 && (
                  <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[8] }}>
                    אין הצעות ממתינות לשיבוץ
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{ display: 'flex', gap: SP[2], justifyContent: 'flex-end', borderTop: `1px solid ${C.border}`, paddingTop: SP[4] }}>
                <button
                  onClick={() => setShowAssignPreview(false)}
                  style={{ padding: `${SP[2]} ${SP[4]}`, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textMuted, fontFamily: FONT, fontSize: '13px', cursor: 'pointer', fontWeight: WEIGHT.semibold }}
                >
                  ביטול
                </button>
                <button
                  onClick={handleConfirmAssign}
                  disabled={checkedCount === 0}
                  style={{
                    padding: `${SP[2]} ${SP[5]}`, borderRadius: RADIUS.md, border: 'none',
                    background: checkedCount > 0 ? '#17a2b8' : C.bgNested,
                    color: checkedCount > 0 ? '#fff' : C.textDisabled,
                    fontFamily: FONT, fontSize: '13px', fontWeight: WEIGHT.bold,
                    cursor: checkedCount > 0 ? 'pointer' : 'not-allowed',
                    boxShadow: checkedCount > 0 ? '0 2px 8px rgba(23,162,184,0.35)' : 'none',
                    transition: EASE.fast,
                  }}
                >
                  ✔ אשר שיבוץ ({checkedCount})
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Convert proposals result dialog ── */}
      {convertResult && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300,
        }} onClick={() => setConvertResult(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: C.bgCard, borderRadius: RADIUS.lg, padding: SP[6],
            minWidth: '340px', maxWidth: '480px', width: '90%',
            boxShadow: SHADOW.lg, direction: 'rtl', fontFamily: FONT,
          }}>
            <h3 style={{ margin: `0 0 ${SP[4]} 0`, ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>
              תוצאות שיבוץ הצעות
            </h3>
            <div style={{
              display: 'flex', alignItems: 'center', gap: SP[2],
              padding: `${SP[2]} ${SP[3]}`, borderRadius: convertResult.tasks.length > 0 ? `${RADIUS.md} ${RADIUS.md} 0 0` : RADIUS.md,
              background: 'rgba(40,167,69,0.1)', marginBottom: convertResult.tasks.length > 0 ? 0 : SP[3],
            }}>
              <span style={{ fontSize: '18px' }}>✅</span>
              <span style={{ ...TEXT.sm, color: '#28a745', fontWeight: WEIGHT.semibold }}>
                {convertResult.created > 0 ? `שובצו ${convertResult.created} משימות לתוכנית` : 'לא שובצו משימות חדשות'}
              </span>
            </div>
            {convertResult.tasks.length > 0 && (
              <div style={{
                border: '1px solid rgba(40,167,69,0.25)', borderTop: 'none',
                borderRadius: `0 0 ${RADIUS.md} ${RADIUS.md}`,
                background: 'rgba(40,167,69,0.04)',
                maxHeight: '200px', overflowY: 'auto',
                marginBottom: SP[3],
              }}>
                {convertResult.tasks.map((t, i) => (
                  <div key={i} style={{
                    padding: `${SP[2]} ${SP[3]}`,
                    borderBottom: i < convertResult.tasks.length - 1 ? '1px solid rgba(40,167,69,0.12)' : 'none',
                    display: 'flex', flexDirection: 'column', gap: '2px',
                  }}>
                    <span style={{ ...TEXT.sm, color: C.textPrimary, fontWeight: WEIGHT.medium }}>{t.title}</span>
                    <span style={{ ...TEXT.xs, color: C.textMuted }}>
                      {t.phaseName}{t.subPhaseName ? ` › ${t.subPhaseName}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {convertResult.skipped.length > 0 && (
              <div style={{ marginBottom: SP[4] }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: SP[2],
                  padding: `${SP[2]} ${SP[3]}`, borderRadius: `${RADIUS.md} ${RADIUS.md} 0 0`,
                  background: 'rgba(255,193,7,0.12)',
                }}>
                  <span style={{ fontSize: '16px' }}>⚠️</span>
                  <span style={{ ...TEXT.sm, color: '#856404', fontWeight: WEIGHT.semibold }}>
                    דולגו {convertResult.skipped.length} הצעות:
                  </span>
                </div>
                <div style={{
                  border: `1px solid rgba(255,193,7,0.3)`, borderTop: 'none',
                  borderRadius: `0 0 ${RADIUS.md} ${RADIUS.md}`,
                  background: 'rgba(255,193,7,0.05)',
                  maxHeight: '180px', overflowY: 'auto',
                }}>
                  {convertResult.skipped.map((s, i) => (
                    <div key={i} style={{
                      padding: `${SP[2]} ${SP[3]}`,
                      borderBottom: i < convertResult.skipped.length - 1 ? `1px solid rgba(255,193,7,0.2)` : 'none',
                      display: 'flex', gap: SP[2], alignItems: 'flex-start',
                    }}>
                      <span style={{ ...TEXT.xs, color: C.textPrimary, fontWeight: WEIGHT.medium, flex: 1 }}>{s.title}</span>
                      <span style={{ ...TEXT.xs, color: C.textMuted, flexShrink: 0 }}>{s.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button
              onClick={() => setConvertResult(null)}
              style={{
                width: '100%', padding: `${SP[2]} 0`,
                background: C.bgNested, border: `1px solid ${C.border}`,
                borderRadius: RADIUS.md, color: C.textPrimary,
                fontFamily: FONT, ...TEXT.sm, cursor: 'pointer',
              }}
            >
              סגור
            </button>
          </div>
        </div>
      )}
  </div>
  );
};
