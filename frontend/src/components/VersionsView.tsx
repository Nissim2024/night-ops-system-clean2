import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { usePermissions } from '../context/PermissionsContext';
import { TeamView } from './TeamView';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';
import { FEATURES } from '../featureFlags';

const API = 'http://localhost:3000';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#95a5a6', COLLECTING: '#3498db', REFINING: '#e67e22',
  REVIEW: '#9b59b6', APPROVED: '#27ae60', REHEARSAL: '#f39c12',
  ACTIVE: '#e74c3c', MORNING_AFTER: '#8e44ad', COMPLETED: '#1a5c2a', ROLLED_BACK: '#7f8c8d',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'טיוטה', COLLECTING: 'איסוף משימות', REFINING: 'טיוב תלויות',
  REVIEW: 'ישיבת מעבר', APPROVED: 'מאושר', REHEARSAL: 'חזרה גנרלית',
  ACTIVE: 'פעיל', MORNING_AFTER: 'פעילות בוקר לאחר גרסה', COMPLETED: 'הושלם', ROLLED_BACK: 'Rollback',
};

const NEXT_STATUS: Record<string, string> = {
  DRAFT: 'COLLECTING', COLLECTING: 'REFINING', REFINING: 'REVIEW',
  REVIEW: 'APPROVED', APPROVED: 'REHEARSAL',
};

const NEXT_LABEL: Record<string, string> = {
  DRAFT: 'פתח לאיסוף משימות', COLLECTING: 'עבור לטיוב',
  REFINING: 'פתח ישיבת מעבר', REVIEW: 'אשר תוכנית',
  APPROVED: 'התחל חזרה גנרלית',
};

const APPS = ['WIZ', 'CRM', 'EAI', 'OSB', 'DP', 'NC', 'ERP', 'ETL', 'OTHER'];

interface Version {
  id: string;
  name: string;
  description: string;
  status: string;
  plannedStart: string;
  plannedEnd?: string;
  importedFileName?: string;
  createdAt: string;
  approvedAt?: string;
  creator: { fullName: string };
  approver?: { fullName: string };
  taskCount?: number;
  lastRehearsalAt?: string;
  lastNightAt?: string;
}

interface QcRelease {
  id: string;
  relId: number;
  relName: string;
  goLiveDate?: string;
  rehearsalDate?: string;
  filterDate?: string;
}

interface Props {
  token: string;
  onImportClick?: () => void;
  onVersionsChanged?: () => void;
  onGoLive?: (versionId: string, versionName: string, isRehearsal: boolean) => void;
  onVersionFocus?: (versionId: string) => void;
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

export const VersionsView: React.FC<Props> = ({ token, onImportClick, onVersionsChanged, onGoLive, onVersionFocus }) => {
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newVersion, setNewVersion] = useState({ name: '', description: '', plannedStart: '', plannedEnd: '', qcReleaseId: '' });
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
  const [showTemplates, setShowTemplates] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

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

  const handlePlannedStartChange = (val: string) => {
    setNewVersion(prev => ({
      ...prev,
      plannedStart: val,
      plannedEnd: prev.plannedEnd ? prev.plannedEnd : defaultPlannedEnd(val),
    }));
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
      setShowNew(false);
      setNewVersion({ name: '', description: '', plannedStart: '', plannedEnd: '', qcReleaseId: '' });
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
        setShowNew(false);
        setNewVersion({ name: '', description: '', plannedStart: '', plannedEnd: '', qcReleaseId: '' });
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
    if (!selectedTemplateId || !newVersion.name.trim()) return;
    setCreatingFromTemplate(true);
    try {
      const res = await axios.post(`${API}/versions`, {
        ...newVersion,
        qcReleaseId: newVersion.qcReleaseId || undefined,
      }, { headers });
      const versionId = res.data.id;
      await axios.post(`${API}/version-templates/${selectedTemplateId}/apply-to-version/${versionId}`, {}, { headers });
      setShowNew(false);
      setNewVersion({ name: '', description: '', plannedStart: '', plannedEnd: '', qcReleaseId: '' });
      setSelectedTemplateId('');
      await fetchVersions();
      await fetchVersion(versionId);
      onVersionsChanged?.();
    } catch (err: any) {
      setActionError(err?.response?.data?.message || 'שגיאה ביצירה מתבנית');
    } finally { setCreatingFromTemplate(false); }
  };

  const updateStatus = async (id: string, status: string): Promise<void> => {
    await axios.patch(`${API}/versions/${id}/status`, { status }, { headers });
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
          await axios.patch(`${API}/versions/${id}/status`, { status: 'COMPLETED' }, { headers });
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
      <VersionDetail
        version={selected}
        token={token}
        userRole={userRole}
        onBack={() => { setSelected(null); fetchVersions(); }}
        onRefresh={() => fetchVersion(selected.id)}
        onStatusChange={(status) => updateStatus(selected.id, status)}
        onGoLive={onGoLive}
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={{ color: '#1a2332', margin: 0 }}>גרסאות ({versions.filter(v => !['COMPLETED','ROLLED_BACK'].includes(v.status)).length})</h2>
          <button
            onClick={() => setShowArchived(a => !a)}
            style={{ padding: '6px 14px', background: showArchived ? '#7f8c8d' : '#f0f0f0', color: showArchived ? 'white' : '#555', border: '1px solid #ccc', borderRadius: '20px', cursor: 'pointer', fontSize: '13px' }}
          >
            📦 ארכיון ({versions.filter(v => ['COMPLETED','ROLLED_BACK'].includes(v.status)).length})
          </button>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {onImportClick && (
            <button onClick={onImportClick} style={{ padding: '10px 20px', background: '#2d7a2d', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
              📤 ייבוא מ-Excel
            </button>
          )}
          {isManager && templates.length > 0 && (
            <button onClick={() => setShowTemplates(true)} style={{ padding: '10px 20px', background: '#5d4e8a', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
              📋 תבניות ({templates.length})
            </button>
          )}
          <button onClick={() => { setShowNew(true); setImportFile(null); }} style={{ padding: '10px 20px', background: '#1a2332', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
            + גרסה חדשה
          </button>
        </div>
      </div>

      {showNew && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '24px', marginBottom: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', border: '2px solid #1a2332' }}>
          <h3 style={{ margin: '0 0 20px', color: '#1a2332' }}>יצירת גרסה חדשה</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '16px', marginBottom: '20px' }}>

            {/* שם גרסה — dropdown מ-QC או הקלדה חופשית */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: '#333', fontSize: '14px' }}>
                שם גרסה *
                {qcReleases.length === 0 && (
                  <span style={{ fontSize: '11px', color: '#e67e22', marginRight: '6px', fontWeight: 'normal' }}>
                    (סנכרן גרסאות QC מ-AdminPanel)
                  </span>
                )}
              </label>
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
                style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', marginBottom: '6px' }}
              >
                <option value="__manual__">✏️ הקלד ידנית</option>
                {qcReleases.length > 0 && <option disabled>── גרסאות QC ──</option>}
                {qcReleases.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.relName}
                    {r.filterDate ? ` — ${new Date(r.filterDate).toLocaleDateString('he-IL')}` : ''}
                  </option>
                ))}
              </select>
              {/* שדה טקסט חופשי — מוצג תמיד, מתעדכן אוטומטית בבחירה מ-QC */}
              <input
                value={newVersion.name}
                onChange={e => setNewVersion(v => ({ ...v, name: e.target.value, qcReleaseId: '' }))}
                placeholder="לדוגמה: ITv04-2026"
                style={{ width: '100%', padding: '10px', border: `2px solid ${newVersion.qcReleaseId ? '#27ae60' : '#e0e0e0'}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: '#333', fontSize: '14px' }}>
                תאריך ושעת התחלה מתוכנן <span style={{ color: '#e74c3c' }}>*</span>
              </label>
              <input
                type="datetime-local"
                value={newVersion.plannedStart}
                onChange={e => handlePlannedStartChange(e.target.value)}
                style={{ width: '100%', padding: '10px', border: `2px solid ${!newVersion.plannedStart ? '#e74c3c' : '#27ae60'}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }}
              />
              {!newVersion.plannedStart && (
                <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#e74c3c' }}>שדה חובה — נדרש לחישוב ברירות מחדל בתזמון</p>
              )}
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: '#333', fontSize: '14px' }}>
                שעת סיום מתוכנן
                {!isManager && <span style={{ fontSize: '11px', color: '#e74c3c', marginRight: '4px' }}>(מנהל לילה בלבד)</span>}
              </label>
              <input
                type="datetime-local"
                value={newVersion.plannedEnd}
                onChange={e => setNewVersion({ ...newVersion, plannedEnd: e.target.value })}
                disabled={!isManager}
                placeholder="ברירת מחדל: 04:00 למחרת"
                style={{ width: '100%', padding: '10px', border: `2px solid ${isManager ? '#e0e0e0' : '#f0f0f0'}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', background: isManager ? 'white' : '#fafafa', color: isManager ? 'inherit' : '#999' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: '#333', fontSize: '14px' }}>תיאור</label>
              <input value={newVersion.description} onChange={e => setNewVersion({ ...newVersion, description: e.target.value })} placeholder="תיאור קצר" style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
            </div>
          </div>

          {/* ── Create options ── */}
          <div style={{ borderTop: '1px solid #eee', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Row 1: compact template selector */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <label style={{ fontSize: '13px', color: '#555', fontWeight: 'bold', whiteSpace: 'nowrap' }}>📋 תבנית שמורה:</label>
              {templates.length > 0 ? (
                <select
                  value={selectedTemplateId}
                  onChange={e => setSelectedTemplateId(e.target.value)}
                  style={{ padding: '7px 10px', border: '2px solid #27ae60', borderRadius: '8px', fontSize: '13px', maxWidth: '280px' }}
                >
                  <option value="">-- בחר תבנית --</option>
                  {templates.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>
                  ))}
                </select>
              ) : (
                <span style={{ fontSize: '12px', color: '#aaa', fontStyle: 'italic' }}>אין תבניות שמורות — שמור תבנית מגרסה קיימת</span>
              )}
            </div>

            {/* Row 2: action buttons */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={createFromTemplate}
                disabled={creatingFromTemplate || !selectedTemplateId || !newVersion.name.trim() || !newVersion.plannedStart}
                style={{ padding: '9px 18px', background: !selectedTemplateId || !newVersion.name.trim() || !newVersion.plannedStart ? '#ccc' : '#27ae60', color: 'white', border: 'none', borderRadius: '8px', cursor: !selectedTemplateId || !newVersion.name.trim() || !newVersion.plannedStart ? 'not-allowed' : 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap', fontSize: '13px' }}>
                {creatingFromTemplate ? 'יוצר...' : '📋 צור תוכנית גרסה מתבנית שמורה'}
              </button>
              <button
                onClick={createEmpty}
                disabled={creatingTemplate || !newVersion.name.trim() || !newVersion.plannedStart}
                style={{ padding: '9px 18px', background: creatingTemplate || !newVersion.name.trim() || !newVersion.plannedStart ? '#ccc' : '#7f3fbf', color: 'white', border: 'none', borderRadius: '8px', cursor: creatingTemplate || !newVersion.name.trim() || !newVersion.plannedStart ? 'not-allowed' : 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap', fontSize: '13px' }}>
                {creatingTemplate ? 'יוצר...' : '📄 גרסה ריקה'}
              </button>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <label style={{ padding: '9px 18px', background: '#2d4a7a', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap', fontSize: '13px' }}>
                  📤 {importFile ? importFile.name : 'ייבוא מ-Excel'}
                  <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                    onChange={e => setImportFile(e.target.files?.[0] || null)} />
                </label>
                {importFile && (
                  <button
                    onClick={importFromFile}
                    disabled={importing || !newVersion.name.trim() || !newVersion.plannedStart}
                    style={{ padding: '9px 14px', background: importing || !newVersion.name.trim() || !newVersion.plannedStart ? '#ccc' : '#1a5c2a', color: 'white', border: 'none', borderRadius: '8px', cursor: importing || !newVersion.name.trim() || !newVersion.plannedStart ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>
                    {importing ? 'מייבא...' : 'ייבא'}
                  </button>
                )}
                {importFile && (
                  <button onClick={() => setImportFile(null)} style={{ padding: '9px 12px', background: '#f0f0f0', color: '#666', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                )}
              </div>

              <button onClick={() => { setShowNew(false); setImportFile(null); setSelectedTemplateId(''); }} style={{ padding: '9px 18px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>ביטול</button>
            </div>
          </div>
          {(!newVersion.name.trim() || !newVersion.plannedStart) && (
            <p style={{ margin: '10px 0 0', fontSize: '12px', color: '#e74c3c' }}>
              {!newVersion.name.trim() && !newVersion.plannedStart
                ? 'נדרשים שם גרסה ותאריך התחלה לפני יצירה'
                : !newVersion.name.trim()
                  ? 'נדרש שם גרסה לפני יצירה'
                  : 'נדרש תאריך התחלה מתוכנן לפני יצירה'}
            </p>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#666' }}>טוען...</div>
      ) : versions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#666' }}>
          <div style={{ fontSize: '48px' }}>📋</div>
          <p>אין גרסאות עדיין — צור את הראשונה!</p>
        </div>
      ) : (
        <>
        {actionError && (
          <div style={{ background: '#fee', border: '1px solid #e74c3c', borderRadius: '8px', padding: '10px 16px', marginBottom: '12px', color: '#c0392b', fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontWeight: 'bold', fontSize: '16px' }}>×</button>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {versions
            .filter(v => !['COMPLETED', 'ROLLED_BACK'].includes(v.status))
            .map(v => (
            <VersionCard
              key={v.id}
              v={v}
              isDeleting={deletingId === v.id}
              onOpen={() => fetchVersion(v.id)}
              onDelete={(e) => deleteVersion(v.id, v.name, e)}
              onArchive={(e) => archiveVersion(v.id, e)}
            />
          ))}
        </div>

        {showArchived && (
          <div style={{ marginTop: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#7f8c8d' }}>📦 ארכיון</h3>
              <span style={{ fontSize: '12px', color: '#aaa' }}>גרסאות שהסתיימו — ניתן לשחזר</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', opacity: 0.8 }}>
              {versions
                .filter(v => ['COMPLETED', 'ROLLED_BACK'].includes(v.status))
                .map(v => (
                <VersionCard
                  key={v.id}
                  v={v}
                  isDeleting={deletingId === v.id}
                  onOpen={() => fetchVersion(v.id)}
                  onDelete={(e) => deleteVersion(v.id, v.name, e)}
                  onArchive={undefined}
                  onRestore={(e) => restoreVersion(v.id, e)}
                />
              ))}
              {versions.filter(v => ['COMPLETED', 'ROLLED_BACK'].includes(v.status)).length === 0 && (
                <div style={{ textAlign: 'center', padding: '30px', color: '#aaa', background: 'white', borderRadius: '12px' }}>
                  אין גרסאות בארכיון
                </div>
              )}
            </div>
          </div>
        )}
        </>
      )}
      <ConfirmDialog config={outerDialog} onClose={() => setOuterDialog(null)} />

      {/* ── Templates management modal ── */}
      {showTemplates && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '14px', padding: '28px', width: '520px', maxWidth: '95vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, color: '#1a2332' }}>📋 ניהול תבניות</h3>
              <button onClick={() => setShowTemplates(false)} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#888' }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {templates.length === 0 ? (
                <p style={{ color: '#888', textAlign: 'center' }}>אין תבניות שמורות</p>
              ) : templates.map((t: any) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', border: '1px solid #e0e0e0', borderRadius: '10px', background: '#fafafa' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#1a2332' }}>{t.name}</div>
                    {t.description && <div style={{ fontSize: '12px', color: '#777', marginTop: '2px' }}>{t.description}</div>}
                    <div style={{ fontSize: '11px', color: '#aaa', marginTop: '3px' }}>
                      נוצר ע"י {t.creator?.fullName ?? '—'} · {t.createdAt ? new Date(t.createdAt).toLocaleDateString('he-IL') : ''}
                    </div>
                  </div>
                  {outerCan('action:template_delete') && (
                    <button
                      disabled={deletingTemplateId === t.id}
                      onClick={async () => {
                        if (!window.confirm(`למחוק את התבנית "${t.name}"?`)) return;
                        setDeletingTemplateId(t.id);
                        try {
                          await axios.delete(`${API}/version-templates/${t.id}`, { headers });
                          const updated = templates.filter((x: any) => x.id !== t.id);
                          setTemplates(updated);
                          if (updated.length === 0) setShowTemplates(false);
                        } catch {
                          alert('שגיאה במחיקת התבנית');
                        } finally {
                          setDeletingTemplateId(null);
                        }
                      }}
                      style={{ padding: '6px 14px', background: deletingTemplateId === t.id ? '#ccc' : '#e74c3c', color: 'white', border: 'none', borderRadius: '8px', cursor: deletingTemplateId === t.id ? 'not-allowed' : 'pointer', fontSize: '13px', flexShrink: 0 }}
                    >
                      {deletingTemplateId === t.id ? 'מוחק...' : '🗑 מחק'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
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
  onDelete: (e: React.MouseEvent) => void;
  onArchive?: (e: React.MouseEvent) => void;
  onRestore?: (e: React.MouseEvent) => void;
}> = ({ v, isDeleting, onOpen, onDelete, onArchive, onRestore }) => (
  <div
    onClick={onOpen}
    style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', borderRight: `5px solid ${STATUS_COLORS[v.status]}`, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
    onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.15)')}
    onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)')}
  >
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 'bold', fontSize: '18px', color: '#1a2332' }}>{v.name}</span>
        <span style={{ background: STATUS_COLORS[v.status], color: 'white', padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>{STATUS_LABELS[v.status]}</span>
        {v.status === 'APPROVED' && v.lastRehearsalAt && (
          <span style={{ background: '#eaf0fb', color: '#2d4a7a', padding: '3px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', border: '1px solid #b6caf5' }}>
            🚀 ממתין לפעילות ההטמעה בייצור
          </span>
        )}
        {v.status === 'MORNING_AFTER' && (
          <span style={{ background: '#f3e8ff', color: '#6c3483', padding: '3px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', border: '1px solid #d7bff5' }}>
            🌅 ממתין לפעילות בוקר
          </span>
        )}
        {v.status === 'COMPLETED' && (
          <span style={{ background: '#d5f0dc', color: '#1a5c2a', padding: '3px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', border: '1px solid #a9dfbf' }}>
            ✅ גרסה בייצור{v.lastNightAt ? ` · ${fmtDateTime(v.lastNightAt)}` : ''}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: '#666', flexWrap: 'wrap' }}>
        {v.description && <span>{v.description}</span>}
        {v.importedFileName && (
          <span style={{ background: '#f0f7ff', color: '#2d4a7a', padding: '1px 8px', borderRadius: '10px' }}>
            📎 {v.importedFileName}
          </span>
        )}
        {v.plannedStart && (
          <span>📅 התחלה: {fmtDateTime(v.plannedStart)}</span>
        )}
        {v.plannedEnd && (
          <span style={{ color: '#e65100' }}>🏁 סיום מתוכנן: {fmtDateTime(v.plannedEnd)}</span>
        )}
        <span>👤 {v.creator?.fullName}</span>
        <span>🗓 נוצר: {new Date(v.createdAt).toLocaleDateString('he-IL')}</span>
        {v.approvedAt && v.approver && (
          <span style={{ color: '#27ae60' }}>✅ אושר: {new Date(v.approvedAt).toLocaleDateString('he-IL')} ע"י {v.approver.fullName}</span>
        )}
        {v.taskCount !== undefined && (
          <span style={{ background: '#e8f4fd', color: '#2980b9', padding: '1px 8px', borderRadius: '10px', fontWeight: 'bold' }}>
            {v.taskCount} משימות
          </span>
        )}
        {v.lastRehearsalAt && (
          <span style={{ background: '#fff3e0', color: '#8B4000', padding: '1px 8px', borderRadius: '10px', fontWeight: 'bold' }}>
            🎭 חזרה: {fmtDateTime(v.lastRehearsalAt)}
          </span>
        )}
        {v.lastNightAt && (
          <span style={{ background: '#e8f4fd', color: '#1a5276', padding: '1px 8px', borderRadius: '10px', fontWeight: 'bold' }}>
            🌙 הטמעה: {fmtDateTime(v.lastNightAt)}
          </span>
        )}
      </div>
    </div>
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
      {onRestore && (
        <button onClick={onRestore} style={{ padding: '6px 12px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>↩ שחזר</button>
      )}
      {onArchive && (
        <button onClick={onArchive} style={{ padding: '6px 12px', background: '#7f8c8d', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>📦 ארכיון</button>
      )}
      <button
        onClick={onDelete}
        disabled={isDeleting}
        style={{ padding: '6px 12px', background: isDeleting ? '#f0f0f0' : '#fee', color: isDeleting ? '#999' : '#e74c3c', border: `1px solid ${isDeleting ? '#ccc' : '#e74c3c'}`, borderRadius: '6px', cursor: isDeleting ? 'not-allowed' : 'pointer', fontSize: '12px' }}
      >
        {isDeleting ? 'מוחק...' : '🗑 מחק'}
      </button>
      <span style={{ color: '#999', fontSize: '20px', marginRight: '4px' }}>←</span>
    </div>
  </div>
);

const VersionDetail: React.FC<{
  version: any;
  token: string;
  userRole: string;
  onBack: () => void;
  onRefresh: () => void;
  onStatusChange: (s: string) => Promise<void>;
  onGoLive?: (versionId: string, versionName: string, isRehearsal: boolean) => void;
}> = ({ version, token, userRole, onBack, onRefresh, onStatusChange, onGoLive }) => {
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

  const handleStatusChange = async (s: string) => {
    setStatusError(null);
    setStatusLoading(true);
    try {
      await onStatusChange(s);
      if ((s === 'ACTIVE' || s === 'REHEARSAL') && onGoLive) {
        onGoLive(version.id, version.name, s === 'REHEARSAL');
      }
    } catch (err: any) {
      setStatusError(err?.response?.data?.message || err?.message || 'שגיאה');
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

  useEffect(() => {
    axios.get(`${API}/teams`, { headers }).then(r => setTeams(r.data));
    axios.get(`${API}/users`, { headers })
      .then(r => setUsers(r.data.filter((u: any) => u.active).sort((a: any, b: any) => a.fullName.localeCompare(b.fullName, 'he'))))
      .catch(() => {});
    axios.get(`${API}/version-templates`, { headers }).then(r => setLocalTemplates(r.data)).catch(() => {});
    axios.get(`${API}/qc/cr-items`, { headers }).then(r => setCrItems(r.data)).catch(() => {});
  }, []); // eslint-disable-line

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
    if (phaseCutoff) {
      console.log('[overrun]', {
        maxEndUTC: endIso,
        cutoffUTC: effectiveCutoff?.toISOString(),
        diffMs: maxEnd && effectiveCutoff ? maxEnd - effectiveCutoff.getTime() : null,
        overrun,
      });
    }
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

  const openReschedule = () => {
    const starts: Record<string, string> = {};
    const ends: Record<string, string> = {};

    // Fixed default times per phase position (Day D = version.plannedStart date)
    const PHASE_DEFAULTS = [
      { startH: 8,  startM: 0,  startOff: 0, endH: 15, endM: 29, endOff: 0 }, // Phase 1: בוקר גרסה
      { startH: 22, startM: 0,  startOff: 0, endH: 23, endM: 59, endOff: 0 }, // Phase 2: לילה HOTNET — מסתיים לפני חצות (יום D)
      { startH: 23, startM: 45, startOff: 0, endH: 4,  endM: 20, endOff: 1 }, // Phase 3: לילה HOT
      { startH: 8,  startM: 0,  startOff: 1, endH: 16, endM: 15, endOff: 1 }, // Phase 4: בוקר לאחר
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
      console.log('[applySchedule] phases to save:', phases.map(p => ({ phaseId: p.phaseId, endTime: p.endTime })));
      console.log('[applySchedule] sending', updates.length, 'updates, sample:', updates[0]);
      const res = await axios.post(`${API}/versions/${version.id}/apply-schedule`, { updates, phases }, { headers });
      console.log('[applySchedule] response:', res.data);
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
      if (FEATURES.TEAM_LEAD_PROPOSAL && selectedProposalId) {
        await axios.patch(`${API}/task-proposals/${selectedProposalId}/mark-used`, { taskId: res.data.id }, { headers }).catch(() => {});
        setSelectedProposalId(null);
        setProposals(prev => prev.filter(p => p.id !== selectedProposalId));
      }
      setAddingTask(null);
      setNewTask(EMPTY_TASK);
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

  const addDep = async (taskId: string, dependsOnTaskId: string, depTask: any) => {
    if (!dependsOnTaskId) return;
    try {
      await axios.post(`${API}/versions/tasks/${taskId}/dependencies`, { dependsOnTaskId }, { headers });
      setEditingTask((prev: any) => ({
        ...prev,
        dependencies: [...(prev.dependencies || []), {
          dependsOnTaskId,
          dependsOn: { id: depTask.id, title: depTask.title, status: depTask.status },
        }],
      }));
      setNewDepId('');
      onRefresh();
    } catch (err) { console.error(err); }
  };

  const removeDep = async (taskId: string, dependsOnTaskId: string) => {
    try {
      await axios.post(`${API}/versions/tasks/${taskId}/dependencies/remove`, { dependsOnTaskId }, { headers });
      setEditingTask((prev: any) => ({
        ...prev,
        dependencies: prev.dependencies?.filter((d: any) => d.dependsOnTaskId !== dependsOnTaskId),
      }));
      onRefresh();
    } catch (err) { console.error(err); }
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
      const { _durationMins, ...rest } = data;
      const mins = parseInt(_durationMins);
      if (mins > 0) {
        rest.duration = minsToStr(mins);
        if (rest.plannedStart) rest.plannedEnd = calcEndFromMins(rest.plannedStart, mins);
      }
      if (rest.plannedStart) rest.plannedStart = toUtcIso(rest.plannedStart);
      if (rest.plannedEnd) rest.plannedEnd = toUtcIso(rest.plannedEnd);
      await axios.patch(`${API}/tasks/${taskId}`, rest, { headers });
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
      {/* ── Version header ── */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <button onClick={onBack} style={{ padding: '8px 16px', background: '#f0f0f0', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>→ חזור</button>
            <div>
              <h2 style={{ margin: 0, color: '#1a2332' }}>{version.name}</h2>
              {version.description && <p style={{ margin: '4px 0 0', color: '#666', fontSize: '14px' }}>{version.description}</p>}
            </div>
            <span style={{ background: STATUS_COLORS[version.status], color: 'white', padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: 'bold' }}>{STATUS_LABELS[version.status]}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* UI utilities */}
            <button onClick={() => setCollapsedPhases(new Set(version.phases?.map((p: any) => p.id)))} style={{ padding: '6px 14px', background: '#e8ecf0', color: '#333', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>▶ קפל הכל</button>
            <button onClick={() => { setCollapsedPhases(new Set()); setCollapsedSubPhases(new Set()); }} style={{ padding: '6px 14px', background: '#e8ecf0', color: '#333', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>▼ פתח הכל</button>

            {/* Manager tools */}
            {isManager && (
              <button onClick={openReschedule} style={{ padding: '6px 14px', background: '#2d4a7a', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>📅 הכן ותזמן</button>
            )}
            {isManager && (
              <button
                onClick={() => {
                  setSaveTemplateMode(localTemplates.length > 0 ? 'update' : 'new');
                  setSaveTemplateSelectId(localTemplates[0]?.id ?? '');
                  setSaveTemplateName('');
                  setSaveTemplateOpen(true);
                }}
                style={{ padding: '6px 14px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                💾 שמור כתבנית
              </button>
            )}
            {isManager && (
              <button
                onClick={() => { setReassignOpen(true); setReassignFrom(''); setReassignTo(''); setReassignPhaseId(''); setReassignResult(null); }}
                style={{ padding: '6px 14px', background: '#e67e22', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                🔄 החלף עובד
              </button>
            )}

            {/* Status progression */}
            {version.status === 'APPROVED' && (
              <button onClick={() => handleStatusChange('DRAFT')} disabled={statusLoading} style={{ padding: '8px 16px', background: '#f0f0f0', color: '#666', border: '1px solid #ddd', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>← איפוס לטיוטה</button>
            )}
            {version.status === 'APPROVED' && !version.lastRehearsalAt && (
              <button onClick={() => handleStatusChange('ACTIVE')} disabled={statusLoading} style={{ padding: '10px 20px', background: statusLoading ? '#aaa' : '#95a5a6', color: 'white', border: 'none', borderRadius: '8px', cursor: statusLoading ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
                {statusLoading ? '...' : 'הפעל ללא חזרה →'}
              </button>
            )}
            {nextStatus && (
              <button onClick={() => handleStatusChange(nextStatus)} disabled={statusLoading} style={{ padding: '10px 20px', background: statusLoading ? '#aaa' : STATUS_COLORS[nextStatus], color: 'white', border: 'none', borderRadius: '8px', cursor: statusLoading ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
                {statusLoading ? '...' : `${nextLabel} →`}
              </button>
            )}
            {statusError && (
              <div style={{ background: '#fee', border: '1px solid #e74c3c', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', color: '#c0392b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                ⚠️ {statusError}
                <button onClick={() => setStatusError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontWeight: 'bold' }}>×</button>
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
        <div style={{ marginTop: '14px', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '13px', color: '#555', alignItems: 'center' }}>
          {version.importedFileName && (
            <span style={{ background: '#f0f7ff', color: '#2d4a7a', padding: '3px 10px', borderRadius: '12px', fontWeight: 'bold' }}>
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
              <span style={{ color: '#e65100' }} title={`שעת סיום של "${phaseC.name}"`}>
                {fmtDateTime(phaseC.plannedEnd)}
              </span>
            ) : editingPlannedEnd ? (
              <>
                <input
                  type="datetime-local"
                  value={plannedEndValue}
                  onChange={e => setPlannedEndValue(e.target.value)}
                  style={{ padding: '4px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}
                />
                <button onClick={savePlannedEnd} style={{ padding: '4px 10px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>שמור</button>
                <button onClick={() => setEditingPlannedEnd(false)} style={{ padding: '4px 10px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>ביטול</button>
              </>
            ) : (
              <>
                <span style={{ color: version.plannedEnd ? '#e65100' : '#aaa' }}>
                  {version.plannedEnd ? fmtDateTime(version.plannedEnd) : 'לא הוגדר (ברירת מחדל: 04:00)'}
                </span>
                {isManager && (
                  <button onClick={() => setEditingPlannedEnd(true)} style={{ padding: '2px 8px', background: '#fff3e0', color: '#e65100', border: '1px solid #ffcc80', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}>עריכה</button>
                )}
              </>
            )}
          </span>
          {version.creator && <span>👤 {version.creator.fullName}</span>}
          {version.approvedAt && version.approver && (
            <span style={{ color: '#27ae60' }}>✅ אושר: {new Date(version.approvedAt).toLocaleDateString('he-IL')} ע"י {version.approver.fullName}</span>
          )}
          {version.lastRehearsalAt && (
            <span style={{ background: '#fff3e0', color: '#8B4000', padding: '3px 10px', borderRadius: '12px', fontWeight: 'bold', fontSize: '12px' }}>
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
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: '#999' }}>סנן לפי צוות:</span>
            <span onClick={() => setFilterTeam(null)} style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', background: filterTeam === null ? '#1a2332' : '#f0f0f0', color: filterTeam === null ? 'white' : '#666' }}>כולם</span>
            {version.submissions.map((sub: any) => (
              <span key={sub.id} onClick={() => setFilterTeam(filterTeam === sub.team.id ? null : sub.team.id)}
                style={{
                  padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer',
                  background: filterTeam === sub.team.id ? '#1a2332' : sub.status === 'SUBMITTED' ? '#d5f0dc' : sub.status === 'IN_PROGRESS' ? '#fff0e0' : '#f0f0f0',
                  color: filterTeam === sub.team.id ? 'white' : sub.status === 'SUBMITTED' ? '#1a5c2a' : sub.status === 'IN_PROGRESS' ? '#8b4000' : '#666',
                  border: filterTeam === sub.team.id ? '2px solid #1a2332' : '2px solid transparent',
                }}>
                {sub.team.name}: {sub.status === 'SUBMITTED' ? 'הגיש' : sub.status === 'IN_PROGRESS' ? 'בתהליך' : 'לא התחיל'}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── View mode tabs ── */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', background: 'white', borderRadius: '10px', padding: '6px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <button
          onClick={() => setViewMode('detail')}
          style={{ flex: 1, padding: '8px 0', background: viewMode === 'detail' ? '#1a2332' : 'transparent', color: viewMode === 'detail' ? 'white' : '#666', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}
        >
          ⚙️ עריכת גרסה
        </button>
        <button
          onClick={() => setViewMode('plan')}
          style={{ flex: 1, padding: '8px 0', background: viewMode === 'plan' ? '#2d4a7a' : 'transparent', color: viewMode === 'plan' ? 'white' : '#666', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}
        >
          🔍 תוכנית ביצוע + חריגות
        </button>
      </div>

      {/* ── Plan view (TeamView with anomaly detection) ── */}
      {viewMode === 'plan' && (
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
                  APPROVED: 'מאושר — התוכנית נעולה',
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

      {viewMode === 'detail' && <>

      {/* ── Lock banner ── */}
      {isLocked && (
        <div style={{ background: '#fff3e0', border: '2px solid #e65100', borderRadius: '10px', padding: '12px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>🔒</span>
          <div>
            <div style={{ fontWeight: 'bold', color: '#b7380a', fontSize: '15px' }}>
              {['APPROVED', 'ACTIVE'].includes(version.status) ? 'גרסה נעולה לעריכה' : 'גרסה פעילה — מצב קריאה בלבד'}
            </div>
            <div style={{ color: '#e65100', fontSize: '13px', marginTop: '2px' }}>
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
          <div key={phase.id} style={{ background: 'white', borderRadius: '12px', padding: '20px', marginBottom: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
            <h3 onClick={() => togglePhase(phase.id)} style={{ margin: '0 0 16px', color: '#1a2332', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' as any, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '14px', color: '#999' }}>{collapsedPhases.has(phase.id) ? '►' : '▼'}</span>
              <span style={{ background: phase.environment === 'HOT' ? '#fee' : phase.environment === 'HOTNET' ? '#e8f4fd' : '#f0f0f0', color: phase.environment === 'HOT' ? '#c0392b' : phase.environment === 'HOTNET' ? '#2980b9' : '#666', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>{phase.environment}</span>
              {phase.name}
              <span style={{ fontSize: '12px', color: '#999', fontWeight: 'normal' }}>({phase.subPhases?.length || 0} תת-שלבים)</span>
              {phaseTimes && (
                <span style={{ fontSize: '12px', background: phaseTimes.overrun ? '#fee' : '#fff8e1', color: phaseTimes.overrun ? '#c0392b' : '#e65100', padding: '2px 10px', borderRadius: '12px', fontWeight: phaseTimes.overrun ? 'bold' : 'normal', marginRight: '4px', border: phaseTimes.overrun ? '1px solid #e74c3c' : 'none' }}>
                  {phaseTimes.overrun ? '⚠️ ' : '⏰ '}
                  {phaseTimes.startIso ? formatTime(phaseTimes.startIso) : '?'}
                  {phaseTimes.endIso ? ` — ${formatTime(phaseTimes.endIso)}` : ''}
                  {phaseTimes.dur ? ` · ${phaseTimes.dur}` : ''}
                  {phaseTimes.overrun && phaseCutoff ? ` (חורג מ-${formatDateTimeShort(phaseCutoff.toISOString())})` : ''}
                </span>
              )}
              {phaseCutoff && (
                <span style={{ fontSize: '11px', color: phaseTimes?.overrun ? '#c0392b' : '#999', background: phaseTimes?.overrun ? '#fff0f0' : '#f5f5f5', padding: '1px 7px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                  יעד: {formatDateTimeShort(phaseCutoff.toISOString())}
                </span>
              )}
            </h3>

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
                  style={{ marginBottom: '12px', paddingRight: '16px', borderRight: dragOverSubId === sub.id ? '3px solid #2d4a7a' : '3px solid #e0e0e0', background: dragOverSubId === sub.id ? '#f0f4ff' : 'transparent', borderRadius: dragOverSubId === sub.id ? '0 8px 8px 0' : undefined, transition: 'background 0.15s, border-color 0.15s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <h4 onClick={() => toggleSubPhase(sub.id)} style={{ margin: 0, color: '#444', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', userSelect: 'none' as any, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', color: '#bbb' }}>{collapsedSubPhases.has(sub.id) ? '►' : '▼'}</span>
                      {sub.name}
                      <span style={{ fontSize: '11px', color: '#bbb', fontWeight: 'normal' }}>({sub.tasks?.length || 0})</span>
                      {subTimes && (
                        <span style={{ fontSize: '11px', background: subTimes.overrun ? '#fee' : '#f3f0ff', color: subTimes.overrun ? '#c0392b' : '#5b2d90', padding: '1px 8px', borderRadius: '10px', fontWeight: subTimes.overrun ? 'bold' : 'normal', border: subTimes.overrun ? '1px solid #e74c3c' : 'none' }}>
                          {subTimes.overrun ? '⚠️ ' : '⏰ '}
                          {subTimes.startIso ? formatTime(subTimes.startIso) : '?'}
                          {subTimes.endIso ? ` — ${formatTime(subTimes.endIso)}` : ''}
                          {subTimes.dur ? ` · ${subTimes.dur}` : ''}
                          {subTimes.overrun && phaseCutoff ? ` (חורג מ-${formatDateTimeShort(phaseCutoff.toISOString())})` : ''}
                        </span>
                      )}
                    </h4>
                    {!isLocked && <button onClick={() => {
                      const defaultStart = subTimes?.startIso || phaseTimes?.startIso || '';
                      setAddingTask(sub.id);
                      setNewTask({ ...EMPTY_TASK, plannedStart: defaultStart ? utcToLocalInputStr(defaultStart) : '' });
                      setEditFilters({ user: '', team: '', app: '' });
                      setSelectedProposalId(null);
                      if (FEATURES.TEAM_LEAD_PROPOSAL) {
                        axios.get(`${API}/task-proposals/version/${version.id}`, { headers }).then(r => setProposals(r.data.filter((p: any) => !p.usedInTaskId))).catch(() => {});
                      }
                    }} style={{ padding: '4px 12px', background: '#1a2332', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>+ משימה</button>}
                  </div>

                  {!collapsedSubPhases.has(sub.id) && (() => {
                    const sortedTasks = [...(sub.tasks || [])].sort(
                      (a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
                    );
                    const orderMap = new Map(sortedTasks.map((t: any, i: number) => [t.id, i + 1]));
                    return sortedTasks
                      .filter((task: any) => !filterTeam || task.assignedTeam?.id === filterTeam || task.assignedTeamId === filterTeam)
                      .map((task: any) => {
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
                                {users.filter(u => !editFilters.user || u.fullName.toLowerCase().startsWith(editFilters.user.toLowerCase())).map(u => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
                              </select>
                            </div>
                            {/* Team with letter filter */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <input value={editFilters.team} onChange={e => setEditFilters(f => ({ ...f, team: e.target.value }))}
                                placeholder="סנן צוות..." style={{ padding: '4px 7px', border: '1px solid #ddd', borderRadius: '6px 6px 0 0', fontSize: '11px', borderBottom: 'none' }} />
                              <select value={editingTask.assignedTeamId || ''} onChange={e => setEditingTask({ ...editingTask, assignedTeamId: e.target.value })}
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
                                {APPS.filter(a => !editFilters.app || a.toLowerCase().startsWith(editFilters.app.toLowerCase())).map(a => <option key={a} value={a}>{a}</option>)}
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
                                          onClick={() => removeDep(task.id, dep.dependsOnTaskId)}
                                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontWeight: 'bold', fontSize: '13px', padding: '0 2px', lineHeight: 1 }}>
                                          ✕
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {/* הוספת תלות */}
                                {available.length > 0 && (
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
                                        if (depTask) addDep(task.id, newDepId, depTask);
                                      }}
                                      style={{ padding: '5px 12px', background: newDepId ? '#2d4a7a' : '#ccc', color: 'white', border: 'none', borderRadius: '6px', cursor: newDepId ? 'pointer' : 'not-allowed', fontSize: '12px', whiteSpace: 'nowrap' }}>
                                      + הוסף
                                    </button>
                                  </div>
                                )}
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
                          return (
                            <div key={task.id}
                              draggable={!isLocked}
                              onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragging({ taskId: task.id, fromSubId: sub.id }); }}
                              onDragEnd={() => { setDragging(null); setDragOverSubId(null); setDragOverTaskId(null); }}
                              onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (dragging && dragging.fromSubId === sub.id && dragging.taskId !== task.id) setDragOverTaskId(task.id); }}
                              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverTaskId(t => t === task.id ? null : t); }}
                              onDrop={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (!dragging || dragging.fromSubId !== sub.id || dragging.taskId === task.id) return;
                                setDragOverTaskId(null);
                                // Insert dragged task before this task
                                const currentTasks = [...(sub.tasks || [])].sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
                                const withoutDragged = currentTasks.filter((t: any) => t.id !== dragging.taskId);
                                const dropIdx = withoutDragged.findIndex((t: any) => t.id === task.id);
                                const draggedTask = currentTasks.find((t: any) => t.id === dragging.taskId)!;
                                withoutDragged.splice(dropIdx, 0, draggedTask);
                                const newOrder = withoutDragged.map((t: any) => t.id);
                                axios.post(`${API}/versions/sub-phases/${sub.id}/reorder`, { taskIds: newOrder }, { headers }).then(() => onRefresh()).catch(console.error);
                                setDragging(null);
                              }}
                              style={{ background: dragOverTaskId === task.id ? '#ddeeff' : dragging?.taskId === task.id ? '#e8edf5' : '#f8f9fa', borderRadius: '8px', padding: '10px 14px', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', opacity: dragging?.taskId === task.id ? 0.5 : 1, cursor: isLocked ? 'default' : 'grab', borderTop: dragOverTaskId === task.id ? '2px solid #2d6abe' : undefined }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: '11px', background: '#e0e0e0', color: '#555', padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace', minWidth: '28px', textAlign: 'center' }}>#{displayOrder}</span>
                                  <span style={{ fontWeight: 'bold', color: '#1a2332', fontSize: '14px' }}>{task.title}</span>
                                  {task.dependencies?.length > 0 && (() => {
                                    const names = task.dependencies.map((d: any) => d.dependsOn?.title).filter(Boolean);
                                    if (!names.length) return null;
                                    const multi = names.length > 1;
                                    return (
                                      <span style={{ fontSize: '12px', color: '#6c3483', background: '#f5eef8', padding: '2px 9px', borderRadius: '10px', border: '1px solid #d2b4de', whiteSpace: 'nowrap' }}>
                                        🔗 לא לפני ש{multi ? 'משימות' : 'משימה'} {names.join(', ')} {multi ? 'מבוצעות' : 'מבוצעת'}
                                      </span>
                                    );
                                  })()}
                                </div>
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                  {task.assignedUserName && <span style={{ fontSize: '12px', color: '#666' }}>👤 {task.assignedUserName}</span>}
                                  {task.assignedTeam && <span style={{ fontSize: '12px', color: '#666' }}>👥 {task.assignedTeam.name}</span>}
                                  {task.crNumber && task.crNumber.split(',').map((cr: string) => cr.trim()).filter(Boolean).map((cr: string) => (
                                    <span key={cr} style={{ fontSize: '12px', background: '#e8f4fd', color: '#2980b9', padding: '1px 6px', borderRadius: '4px' }}>CR# {cr}</span>
                                  ))}
                                  {task.application && <span style={{ fontSize: '12px', background: '#f0f0f0', color: '#555', padding: '1px 6px', borderRadius: '4px' }}>{task.application}</span>}
                                  <span style={{ fontSize: '12px', background: task.environment === 'HOT' ? '#fee' : task.environment === 'HOTNET' ? '#e8f4fd' : '#f0f0f0', color: task.environment === 'HOT' ? '#c0392b' : task.environment === 'HOTNET' ? '#2980b9' : '#555', padding: '1px 6px', borderRadius: '4px' }}>{task.environment}</span>
                                  {task.duration && <span style={{ fontSize: '12px', background: '#fef9e7', color: '#b7950b', padding: '1px 6px', borderRadius: '4px' }}>⏱ {task.duration}</span>}
                                  {(task.plannedStart || displayEnd) && (
                                    <span style={{ fontSize: '12px', background: '#fff3e0', color: '#e65100', padding: '1px 6px', borderRadius: '4px' }}>
                                      📅 {task.plannedStart ? `${formatDate(task.plannedStart)} ` : ''}{formatTime(task.plannedStart)}
                                      {displayEnd && ` — ${formatTime(displayEnd)}`}
                                      {computedEnd && !task.plannedEnd && ' (מחושב)'}
                                      {task.plannedStart && displayEnd && calcDuration(task.plannedStart, displayEnd) && ` · ${calcDuration(task.plannedStart, displayEnd)}`}
                                    </span>
                                  )}
                                  {task.startedAt && task.completedAt && (
                                    <span style={{ fontSize: '12px', background: '#e8f5e9', color: '#2e7d32', padding: '1px 6px', borderRadius: '4px' }}>
                                      ✅ {formatTime(task.startedAt)} — {formatTime(task.completedAt)}
                                      {calcDuration(task.startedAt, task.completedAt) && ` (${calcDuration(task.startedAt, task.completedAt)})`}
                                    </span>
                                  )}
                                  {task.dependencyNote && <span style={{ fontSize: '12px', background: '#f9ebff', color: '#7d3c98', padding: '1px 6px', borderRadius: '4px' }}>🔗 {task.dependencyNote}</span>}
                                  {task.notes && <span style={{ fontSize: '12px', background: '#f0f0f0', color: '#555', padding: '1px 6px', borderRadius: '4px' }}>📝 {task.notes}</span>}
                                  {task.isCritical && <span style={{ fontSize: '12px', background: '#fee', color: '#e74c3c', padding: '1px 6px', borderRadius: '4px' }}>קריטי</span>}
                                  {task.isCriticalForGo && <span style={{ fontSize: '12px', background: '#fff3e0', color: '#d35400', padding: '1px 6px', borderRadius: '4px' }}>GO/NO GO</span>}
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginRight: '8px', flexShrink: 0 }}>
                                <span style={{ fontSize: '12px', background: '#e8f4fd', color: '#2980b9', padding: '3px 8px', borderRadius: '12px' }}>{task.status}</span>
                                {!isLocked && <>
                                  <button onClick={() => duplicateTask(task.id)} style={{ padding: '4px 10px', background: '#7f8c8d', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }} title="שכפל משימה">⧉</button>
                                  {isManager && (
                                    <button
                                      onClick={async () => {
                                        if (!window.confirm(`להפוך את "${task.title}" לתת-שלב? המשימה תימחק וייווצר תת-שלב חדש במקומה.`)) return;
                                        await axios.post(`${API}/versions/tasks/${task.id}/promote`, {}, { headers });
                                        onRefresh();
                                      }}
                                      style={{ padding: '4px 10px', background: '#8e44ad', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
                                      title="הפוך לתת-שלב">
                                      ▲ תת-שלב
                                    </button>
                                  )}
                                  <button onClick={() => {
                                    const base = { ...task, assignedTeamId: task.assignedTeam?.id || task.assignedTeamId };
                                    base._durationMins = task.duration ? (parseDurationToMinutes(task.duration) ?? '') : '';
                                    setEditingTask(base);
                                    setEditFilters({ user: '', team: '', app: '' });
                                    setEditSaveOk(false);
                                  }} style={{ padding: '4px 10px', background: '#f39c12', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>עריכה</button>
                                  <button onClick={() => deleteTask(task.id, task.title)} style={{ padding: '4px 10px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>מחק</button>
                                </>}
                              </div>
                            </div>
                          );
                        })()
                    ); }); })()}

                  {addingTask === sub.id && !isLocked && (
                    <div style={{ background: '#f0f7ff', borderRadius: '8px', padding: '16px', marginTop: '8px', border: '1px solid #bee3f8' }}>
                      {/* הצעות ראשי צוותים — מסוננות לפי שלב */}
                      {FEATURES.TEAM_LEAD_PROPOSAL && (() => {
                        const phaseProposals = proposals.filter((p: any) => p.phase === phase.orderIndex);
                        if (phaseProposals.length === 0) return null;
                        return (
                          <div style={{ marginBottom: '12px', background: 'white', border: '1px solid #bee3f8', borderRadius: '8px', padding: '10px 14px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#2c5282', marginBottom: '8px' }}>
                              📋 הצעות ראשי צוותים לשלב זה ({phaseProposals.length})
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                              {phaseProposals.map((p: any) => {
                                const isSelected = selectedProposalId === p.id;
                                const teamName = teams.find((t: any) => t.id === p.teamId)?.name || '';
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
                                    padding: '6px 10px', borderRadius: '6px', cursor: 'pointer',
                                    background: isSelected ? '#2d4a7a' : '#f8fafc',
                                    border: `1px solid ${isSelected ? '#2d4a7a' : '#e0e8f0'}`,
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                  }}>
                                    {p.crNumber && (
                                      <span style={{ background: isSelected ? 'rgba(255,255,255,0.2)' : '#1a2332', color: 'white', padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontFamily: 'monospace', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                        {p.crNumber}
                                      </span>
                                    )}
                                    <span style={{ fontWeight: 'bold', fontSize: '13px', color: isSelected ? 'white' : '#1a2332', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {p.title}
                                    </span>
                                    <span style={{ fontSize: '11px', color: isSelected ? 'rgba(255,255,255,0.75)' : '#888', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                      {[teamName, p.app, p.estimatedMins ? `${p.estimatedMins} דק'` : ''].filter(Boolean).join(' · ')}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            {selectedProposalId && (
                              <button type="button" onClick={() => { setSelectedProposalId(null); setNewTask(EMPTY_TASK); }}
                                style={{ marginTop: '6px', fontSize: '11px', color: '#c0392b', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                ✕ נקה בחירה
                              </button>
                            )}
                            <div style={{ fontSize: '11px', color: '#888', marginTop: '5px' }}>לחץ על הצעה לטעינה אוטומטית — ניתן לערוך לפני השמירה</div>
                          </div>
                        );
                      })()}
                      {/* Row 1: title | user (filtered) | team (filtered) */}
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                        <input placeholder="שם המשימה *" value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <input value={editFilters.user} onChange={e => setEditFilters(f => ({ ...f, user: e.target.value }))}
                            placeholder="סנן עובד..." style={{ padding: '4px 7px', border: '1px solid #ddd', borderRadius: '6px 6px 0 0', fontSize: '11px', borderBottom: 'none' }} />
                          <select value={newTask.assignedUserName} onChange={e => setNewTask({ ...newTask, assignedUserName: e.target.value })}
                            style={{ padding: '5px 7px', border: '1px solid #ddd', borderRadius: '0 0 6px 6px', fontSize: '13px', borderTop: 'none' }}>
                            <option value="">-- עובד אחראי --</option>
                            {users.filter(u => !editFilters.user || u.fullName.toLowerCase().startsWith(editFilters.user.toLowerCase())).map(u => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
                          </select>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <input value={editFilters.team} onChange={e => setEditFilters(f => ({ ...f, team: e.target.value }))}
                            placeholder="סנן צוות..." style={{ padding: '4px 7px', border: '1px solid #ddd', borderRadius: '6px 6px 0 0', fontSize: '11px', borderBottom: 'none' }} />
                          <select value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)}
                            style={{ padding: '5px 7px', border: '1px solid #ddd', borderRadius: '0 0 6px 6px', fontSize: '13px', borderTop: 'none' }}>
                            <option value="">צוות</option>
                            {teams.filter((t: any) => t.active && (!editFilters.team || t.name.toLowerCase().startsWith(editFilters.team.toLowerCase()))).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <input value={editFilters.app} onChange={e => setEditFilters(f => ({ ...f, app: e.target.value }))}
                            placeholder="סנן..." style={{ padding: '4px 7px', border: '1px solid #ddd', borderRadius: '6px 6px 0 0', fontSize: '11px', borderBottom: 'none' }} />
                          <select value={newTask.application} onChange={e => setNewTask({ ...newTask, application: e.target.value })}
                            style={{ padding: '5px 7px', border: '1px solid #ddd', borderRadius: '0 0 6px 6px', fontSize: '13px', borderTop: 'none' }}>
                            <option value="">Application</option>
                            {APPS.filter(a => !editFilters.app || a.toLowerCase().startsWith(editFilters.app.toLowerCase())).map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                        </div>
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
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => addTask(sub.id)} disabled={!newTask.title} style={{ padding: '8px 16px', background: newTask.title ? '#27ae60' : '#ccc', color: 'white', border: 'none', borderRadius: '6px', cursor: newTask.title ? 'pointer' : 'not-allowed', fontSize: '13px', fontWeight: 'bold' }}>הוסף</button>
                        <button onClick={() => setAddingTask(null)} style={{ padding: '8px 16px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>ביטול</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
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
  </div>
  );
};
