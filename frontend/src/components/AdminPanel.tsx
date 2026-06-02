import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { usePermissions } from '../context/PermissionsContext';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';
import { C, FONT, FONT_MONO } from '../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const APPS = [
  'BILI', 'CRM', 'OSB', 'DP', 'WEB-RETAIL', 'WEB-NEXT', 'WEB-HOT',
  'TOP', 'IRB', 'NC', 'ERP', 'CONNECT', 'CREDIT GUARD', 'ARCHIVE',
  'PRINT BOSS', 'NIFI', 'CAWA', 'BEERI', 'IVR', 'MEDIATION',
  'PROVISIONING LDAP', 'PROVISIONING TIBCO', 'PROVISIONING NAGRA',
  'PROVISIONING OTT', 'PROVISIONING TEL', 'REMEDY', 'ZOO', 'אחר',
];

const ROLES = ['EMPLOYEE', 'TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN', 'VIEWER'];
const ROLE_LABELS: Record<string, string> = {
  EMPLOYEE: 'עובד', TEAM_LEAD: 'ראש צוות',
  RELEASE_MANAGER: 'מנהל לילה', ADMIN: 'מנהל מערכת', VIEWER: 'צופה',
};
const ROLE_COLORS: Record<string, string> = {
  EMPLOYEE: '#3498db', TEAM_LEAD: '#e67e22', RELEASE_MANAGER: '#9b59b6',
  ADMIN: '#e74c3c', VIEWER: '#95a5a6',
};

interface Props { token: string; }

const emptyUser = { fullName: '', email: '', password: '', phone: '', role: 'EMPLOYEE', teamId: '' };

const PERMISSION_DEFS = [
  { key: 'screen:prep',        label: 'מסך הכנה',           group: 'מסכים' },
  { key: 'screen:handoff',     label: 'מסך ביצוע',          group: 'מסכים' },
  { key: 'screen:timeline',    label: 'מסך ציר זמן',        group: 'מסכים' },
  { key: 'screen:night',       label: 'מסך לילה (חמ"ל)',    group: 'מסכים' },
  { key: 'screen:summary',     label: 'מסך סיכום',          group: 'מסכים' },
  { key: 'screen:admin',       label: 'מסך ניהול',          group: 'מסכים' },
  { key: 'action:import',                label: 'ייבוא Excel',                        group: 'פעולות' },
  { key: 'action:gonogo',               label: 'GO / NO GO',                         group: 'פעולות' },
  { key: 'action:task_status',             label: 'שינוי סטטוס משימה',                 group: 'פעולות' },
  { key: 'action:open_task_for_execution', label: 'פתיחת משימה לביצוע (מנהל לילה)',   group: 'פעולות' },
  { key: 'action:user_manage',             label: 'ניהול משתמשים',                      group: 'פעולות' },
  { key: 'action:override_version_edit',   label: 'עריכת גרסה לאחר אישור (override)',  group: 'פעולות' },
  { key: 'action:select_all_tasks',        label: 'בחר הכל משימות',                    group: 'פעולות' },
  { key: 'action:template_delete',         label: 'מחיקת תבנית גרסה',                  group: 'פעולות' },
];

interface QcRelease {
  id: string;
  relId: number;
  relName: string;
  relStartDate?: string;
  relEndDate?: string;
  relTeam?: string;
  filterDate?: string;
  goLiveDate?: string;
  rehearsalDate?: string;
  active: boolean;
  lastSyncAt?: string;
}

export const AdminPanel: React.FC<Props> = ({ token }) => {
  const [tab, setTab]         = useState<'users' | 'teams' | 'permissions' | 'qc-releases' | 'qc-users' | 'params' | 'templates' | 'ldap' | 'email'>('users');
  const { allPermissions, updateRole, saving: permSaving } = usePermissions();
  const [users, setUsers]     = useState<any[]>([]);
  const [teams, setTeams]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [qcReleases, setQcReleases]         = useState<QcRelease[]>([]);
  const [qcSyncing, setQcSyncing]           = useState(false);
  const [qcSyncResult, setQcSyncResult]     = useState<string | null>(null);

  const [excelSyncing, setExcelSyncing]       = useState(false);
  const [excelSyncResult, setExcelSyncResult] = useState<string | null>(null);
  const [excelYear, setExcelYear]             = useState(new Date().getFullYear());

  const [userSyncing, setUserSyncing]       = useState(false);
  const [userSyncResult, setUserSyncResult] = useState<string | null>(null);

  const [systemParams, setSystemParams]     = useState<{ key: string; label: string; value: string; type: string }[]>([]);
  const [editingParam, setEditingParam]     = useState<string | null>(null);
  const [paramValue, setParamValue]         = useState('');
  const [savingParam, setSavingParam]       = useState(false);
  const [paramError, setParamError]         = useState<string | null>(null);

  const [templates, setTemplates]             = useState<any[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [templateError, setTemplateError]     = useState<string | null>(null);

  const [ldapTesting, setLdapTesting]         = useState(false);
  const [ldapTestResult, setLdapTestResult]   = useState<{ success: boolean; message: string } | null>(null);

  const [emailTesting, setEmailTesting]       = useState(false);
  const [emailTestResult, setEmailTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [showUserForm, setShowUserForm]   = useState(false);
  const [userForm, setUserForm]           = useState(emptyUser);
  const [savingUser, setSavingUser]       = useState(false);
  const [editingUser, setEditingUser]     = useState<any | null>(null);

  const [showTeamForm, setShowTeamForm] = useState(false);
  const [teamName, setTeamName]         = useState('');
  const [teamDesc, setTeamDesc]         = useState('');
  const [savingTeam, setSavingTeam]     = useState(false);

  const [editingTeamId, setEditingTeamId]   = useState<string | null>(null);
  const [editTeamName, setEditTeamName]     = useState('');
  const [editTeamDesc, setEditTeamDesc]     = useState('');
  const [editTeamApps, setEditTeamApps]     = useState<string[]>([]);
  const [savingEditTeam, setSavingEditTeam] = useState(false);

  const [resetUserId, setResetUserId]   = useState<string | null>(null);
  const [newPassword, setNewPassword]   = useState('');
  const [savingPwd, setSavingPwd]       = useState(false);

  const [userSearch, setUserSearch]     = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('');
  const [dialog, setDialog] = useState<DialogConfig | null>(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, t, qc, sp] = await Promise.all([
        axios.get(`${API}/users`, { headers }),
        axios.get(`${API}/teams`, { headers }),
        axios.get(`${API}/qc-releases`, { headers }),
        axios.get(`${API}/system-params`, { headers }),
      ]);
      setUsers(u.data);
      setTeams(t.data);
      setQcReleases(qc.data);
      setSystemParams(sp.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'שגיאה בטעינת נתונים');
    } finally {
      setLoading(false);
    }
  };

  const fetchTemplates = async () => {
    setTemplatesLoading(true);
    setTemplateError(null);
    try {
      const res = await axios.get(`${API}/version-templates`, { headers });
      setTemplates(res.data);
    } catch {
      setTemplateError('שגיאה בטעינת תבניות');
    } finally {
      setTemplatesLoading(false);
    }
  };

  const deleteTemplate = async (id: string) => {
    setDeletingTemplateId(id);
    try {
      await axios.delete(`${API}/version-templates/${id}`, { headers });
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch {
      setTemplateError('שגיאה במחיקת התבנית');
    } finally {
      setDeletingTemplateId(null);
    }
  };

  const syncQcReleases = async () => {
    setQcSyncing(true);
    setQcSyncResult(null);
    try {
      const res = await axios.post(`${API}/qc-releases/sync`, {}, { headers });
      if (res.data.error) {
        setQcSyncResult(`⚠️ ${res.data.error}`);
      } else {
        setQcSyncResult(`✓ סונכרנו ${res.data.synced} גרסאות QC`);
        const qcRes = await axios.get(`${API}/qc-releases`, { headers });
        setQcReleases(qcRes.data);
      }
    } catch (e: any) {
      setQcSyncResult(`שגיאה: ${e?.response?.data?.message || e.message}`);
    } finally {
      setQcSyncing(false);
    }
  };

  const syncQcFromExcel = async () => {
    setExcelSyncing(true);
    setExcelSyncResult(null);
    try {
      const res = await axios.post(`${API}/qc-releases/sync-excel-path?fromYear=${excelYear}`, {}, { headers });
      if (res.data.error) {
        setExcelSyncResult(`⚠️ ${res.data.error}`);
      } else {
        setExcelSyncResult(`✓ סונכרנו ${res.data.synced} גרסאות QC מהקובץ`);
        const qcRes = await axios.get(`${API}/qc-releases`, { headers });
        setQcReleases(qcRes.data);
      }
    } catch (e: any) {
      setExcelSyncResult(`שגיאה: ${e?.response?.data?.message || e.message}`);
    } finally {
      setExcelSyncing(false);
    }
  };

  const toggleQcRelease = async (id: string) => {
    try {
      await axios.patch(`${API}/qc-releases/${id}/toggle`, {}, { headers });
      const qcRes = await axios.get(`${API}/qc-releases`, { headers });
      setQcReleases(qcRes.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'שגיאה');
    }
  };

  const syncQcUsers = () => {
    setDialog({
      title: 'סנכרון משתמשי QC',
      message: 'פעולה זו תסנכרן את רשימת המשתמשים עם רשימת משתמשי QC.\nמשתמשים שאינם ברשימה יושבתו.',
      variant: 'warning',
      confirmLabel: 'סנכרן',
      cancelLabel: 'ביטול',
      onConfirm: async () => {
        setUserSyncing(true);
        setUserSyncResult(null);
        try {
          const res = await axios.post(`${API}/users/sync-qc`, {}, { headers });
          setUserSyncResult(`✓ נוצרו: ${res.data.created} | עודכנו: ${res.data.updated} | הושבתו: ${res.data.deactivated}`);
          fetchAll();
        } catch (e: any) {
          setUserSyncResult(`שגיאה: ${e?.response?.data?.message || e.message}`);
        } finally {
          setUserSyncing(false);
        }
      },
      onCancel: () => {},
    });
  };

  const testLdap = async () => {
    setLdapTesting(true);
    setLdapTestResult(null);
    try {
      const res = await axios.post(`${API}/auth/ldap-test`, {}, { headers });
      setLdapTestResult(res.data);
    } catch (e: any) {
      setLdapTestResult({ success: false, message: e?.response?.data?.message || e.message });
    } finally {
      setLdapTesting(false);
    }
  };

  const testEmailConfig = async () => {
    setEmailTesting(true);
    setEmailTestResult(null);
    try {
      await axios.post(`${API}/summary/test-version-id/send-email`,
        { subject: 'בדיקת חיבור', text: 'מייל בדיקה מהמערכת' },
        { headers }
      );
      setEmailTestResult({ success: true, message: 'שליחת מייל הצליחה' });
    } catch (e: any) {
      setEmailTestResult({ success: false, message: e?.response?.data?.message || e.message });
    } finally {
      setEmailTesting(false);
    }
  };

  const saveParam = async (key: string) => {
    setSavingParam(true); setParamError(null);
    try {
      await axios.patch(`${API}/system-params/${key}`, { value: paramValue }, { headers });
      setSystemParams(prev => prev.map(p => p.key === key ? { ...p, value: paramValue } : p));
      setEditingParam(null);
    } catch (e: any) {
      setParamError(e?.response?.data?.message || 'שגיאה בשמירה');
    } finally { setSavingParam(false); }
  };

  useEffect(() => { fetchAll(); }, []); // eslint-disable-line

  const openCreateUser = () => {
    setEditingUser(null);
    setUserForm(emptyUser);
    setShowUserForm(true);
    setError(null);
  };

  const openEditUser = (u: any) => {
    setEditingUser(u);
    setUserForm({
      fullName: u.fullName,
      email: u.email,
      password: '',
      phone: u.phone || '',
      role: u.role,
      teamId: u.teamMemberships?.[0]?.team?.id || '',
    });
    setShowUserForm(true);
    setError(null);
  };

  const saveUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSavingUser(true);
    setError(null);
    try {
      if (editingUser) {
        await axios.patch(`${API}/users/${editingUser.id}`, {
          fullName: userForm.fullName,
          phone: userForm.phone || undefined,
          role: userForm.role,
        }, { headers });
        await axios.patch(`${API}/users/${editingUser.id}/team`, {
          teamId: userForm.teamId || null,
        }, { headers });
      } else {
        const res = await axios.post(`${API}/users`, {
          fullName: userForm.fullName,
          email: userForm.email,
          password: userForm.password,
          phone: userForm.phone || undefined,
          role: userForm.role,
        }, { headers });
        if (userForm.teamId) {
          await axios.patch(`${API}/users/${res.data.id}/team`, { teamId: userForm.teamId }, { headers });
        }
      }
      setShowUserForm(false);
      setEditingUser(null);
      fetchAll();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'שגיאה בשמירת המשתמש');
    } finally {
      setSavingUser(false);
    }
  };

  const toggleActive = async (u: any) => {
    try {
      await axios.patch(`${API}/users/${u.id}`, { active: !u.active }, { headers });
      fetchAll();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'שגיאה');
    }
  };

  const deleteUser = (u: any) => {
    setDialog({
      title: 'מחיקת משתמש',
      message: `למחוק לצמיתות את "${u.fullName}"?\n\nהמשתמש יוסר מהמערכת לחלוטין — לא ניתן לשחזר.\nאם למשתמש יש גרסאות/משימות במערכת, המחיקה תיחסם — השתמש בהשבתה במקום.`,
      variant: 'danger',
      confirmLabel: 'מחק לצמיתות',
      cancelLabel: 'ביטול',
      onConfirm: async () => {
        setError(null);
        try {
          await axios.delete(`${API}/users/${u.id}`, { headers });
          fetchAll();
        } catch (e: any) {
          setError(e?.response?.data?.message || 'שגיאה במחיקת המשתמש');
        }
      },
      onCancel: () => {},
    });
  };

  const doResetPassword = async () => {
    if (!resetUserId || !newPassword.trim()) return;
    setSavingPwd(true);
    try {
      await axios.patch(`${API}/users/${resetUserId}/password`, { newPassword }, { headers });
      setResetUserId(null);
      setNewPassword('');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'שגיאה באיפוס סיסמה');
    } finally {
      setSavingPwd(false);
    }
  };

  const createTeam = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSavingTeam(true);
    setError(null);
    try {
      await axios.post(`${API}/teams`, { name: teamName, description: teamDesc }, { headers });
      setTeamName(''); setTeamDesc('');
      setShowTeamForm(false);
      fetchAll();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'שגיאה ביצירת הצוות');
    } finally {
      setSavingTeam(false);
    }
  };

  const toggleTeamActive = async (t: any) => {
    try {
      await axios.patch(`${API}/teams/${t.id}`, { active: !t.active }, { headers });
      fetchAll();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'שגיאה');
    }
  };

  const openEditTeam = (t: any) => {
    setEditingTeamId(t.id);
    setEditTeamName(t.name);
    setEditTeamDesc(t.description || '');
    setEditTeamApps(t.apps || []);
  };

  const saveTeamEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeamId) return;
    setSavingEditTeam(true);
    setError(null);
    try {
      await axios.patch(`${API}/teams/${editingTeamId}`, { name: editTeamName, description: editTeamDesc, apps: editTeamApps }, { headers });
      setEditingTeamId(null);
      fetchAll();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'שגיאה בשמירת הצוות');
    } finally {
      setSavingEditTeam(false);
    }
  };

  const deleteTeam = (t: any) => {
    setDialog({
      title: `מחיקת צוות`,
      message: `האם למחוק את הצוות "${t.name}"?\nפעולה זו בלתי הפיכה.`,
      variant: 'danger',
      confirmLabel: 'מחק צוות',
      cancelLabel: 'ביטול',
      onConfirm: async () => {
        setError(null);
        try {
          await axios.delete(`${API}/teams/${t.id}`, { headers });
          fetchAll();
        } catch (e: any) {
          setError(e?.response?.data?.message || e?.response?.data?.error || 'שגיאה במחיקת הצוות');
        }
      },
      onCancel: () => {},
    });
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', border: `1px solid ${C.border}`,
    borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box',
    background: C.bgNested, color: C.textPrimary, fontFamily: FONT,
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '12px', color: C.textSecondary, marginBottom: '4px', fontWeight: 'bold',
  };

  return (
    <div style={{ direction: 'rtl', fontFamily: FONT }}>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />

      {/* Header */}
      <div style={{ background: C.bgCard, borderRadius: '12px', padding: '20px', marginBottom: '20px', border: `1px solid ${C.border}` }}>
        <h2 style={{ margin: '0 0 16px', color: C.textPrimary }}>⚙️ ניהול מערכת</h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {([
            { key: 'users',       label: '👤 משתמשים' },
            { key: 'teams',       label: '👥 צוותים' },
            { key: 'permissions', label: '🔐 הרשאות' },
            { key: 'qc-releases', label: '📋 גרסאות QC' },
            { key: 'qc-users',    label: '🔄 סנכרון משתמשים' },
            { key: 'params',      label: '⚙️ פרמטרי מערכת' },
            { key: 'templates',   label: '📁 תבניות גרסה' },
            { key: 'ldap',        label: '🔒 AD / LDAP' },
            { key: 'email',       label: '📧 הגדרות מייל' },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '8px 20px', borderRadius: '8px', cursor: 'pointer', fontFamily: FONT,
              border: tab === t.key ? `1px solid ${C.brand}` : `1px solid ${C.border}`,
              background: tab === t.key ? C.brandDim : C.bgNested,
              color: tab === t.key ? C.textPrimary : C.textSecondary,
              fontWeight: tab === t.key ? 'bold' : 'normal', fontSize: '14px',
            }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ background: C.bgBlocked, border: `1px solid ${C.statusFailed}44`, borderRadius: '8px', padding: '10px 16px', marginBottom: '16px', color: C.statusFailed, fontSize: '13px' }}>
          ⚠️ {error}
          <button onClick={() => setError(null)} style={{ float: 'left', background: 'none', border: 'none', cursor: 'pointer', color: C.statusFailed, fontWeight: 'bold' }}>✕</button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted }}>טוען...</div>
      ) : (
        <>
          {/* ── USERS TAB ── */}
          {tab === 'users' && (
            <div>
              {showUserForm && (
                <form onSubmit={saveUser} style={{
                  background: C.bgCard, borderRadius: '12px', padding: '24px', marginBottom: '20px',
                  border: `2px solid ${C.brand}`,
                }}>
                  <h3 style={{ margin: '0 0 20px', color: C.textPrimary }}>
                    {editingUser ? `✏️ עריכת ${editingUser.fullName}` : '➕ משתמש חדש'}
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
                    <div>
                      <label style={labelStyle}>שם מלא *</label>
                      <input required style={inputStyle} value={userForm.fullName}
                        onChange={e => setUserForm(f => ({ ...f, fullName: e.target.value }))} />
                    </div>
                    <div>
                      <label style={labelStyle}>אימייל *</label>
                      <input required type="email" value={userForm.email} disabled={!!editingUser}
                        onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))}
                        style={{ ...inputStyle, background: editingUser ? C.bgHover : C.bgNested, color: editingUser ? C.textMuted : C.textPrimary }} />
                    </div>
                    {!editingUser && (
                      <div>
                        <label style={labelStyle}>סיסמה *</label>
                        <input required type="password" style={inputStyle} value={userForm.password}
                          onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))} />
                      </div>
                    )}
                    <div>
                      <label style={labelStyle}>טלפון</label>
                      <input style={inputStyle} value={userForm.phone}
                        onChange={e => setUserForm(f => ({ ...f, phone: e.target.value }))} />
                    </div>
                    <div>
                      <label style={labelStyle}>תפקיד</label>
                      <select style={inputStyle} value={userForm.role}
                        onChange={e => setUserForm(f => ({ ...f, role: e.target.value }))}>
                        {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>צוות</label>
                      <select style={inputStyle} value={userForm.teamId}
                        onChange={e => setUserForm(f => ({ ...f, teamId: e.target.value }))}>
                        <option value="">-- ללא צוות --</option>
                        {teams.filter(t => t.active).map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button type="submit" disabled={savingUser} style={{
                      padding: '10px 24px', background: savingUser ? C.bgHover : C.statusDone,
                      color: 'white', border: 'none', borderRadius: '8px',
                      cursor: savingUser ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontFamily: FONT,
                    }}>
                      {savingUser ? 'שומר...' : (editingUser ? '✓ שמור שינויים' : '✓ צור משתמש')}
                    </button>
                    <button type="button" onClick={() => { setShowUserForm(false); setEditingUser(null); setError(null); }}
                      style={{ padding: '10px 20px', background: C.bgHover, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', fontFamily: FONT }}>
                      ביטול
                    </button>
                  </div>
                </form>
              )}

              {resetUserId && (
                <div style={{
                  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
                }}>
                  <div style={{ background: C.bgCard, borderRadius: '12px', padding: '28px', minWidth: '340px', border: `1px solid ${C.border}` }}>
                    <h3 style={{ margin: '0 0 16px', color: C.textPrimary }}>🔑 איפוס סיסמה</h3>
                    <label style={labelStyle}>סיסמה חדשה</label>
                    <input type="password" style={{ ...inputStyle, marginBottom: '16px' }}
                      value={newPassword} onChange={e => setNewPassword(e.target.value)}
                      placeholder="הכנס סיסמה חדשה..." />
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button onClick={doResetPassword} disabled={savingPwd || !newPassword.trim()} style={{
                        padding: '9px 20px', background: newPassword.trim() ? C.brand : C.bgHover,
                        color: newPassword.trim() ? 'white' : C.textDisabled, border: 'none', borderRadius: '8px',
                        cursor: newPassword.trim() ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontFamily: FONT,
                      }}>
                        {savingPwd ? 'מאפס...' : 'אפס סיסמה'}
                      </button>
                      <button onClick={() => { setResetUserId(null); setNewPassword(''); }}
                        style={{ padding: '9px 20px', background: C.bgHover, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', fontFamily: FONT }}>
                        ביטול
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ background: C.bgCard, borderRadius: '12px', padding: '20px', border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <h3 style={{ margin: 0, color: C.textPrimary }}>משתמשים ({users.length})</h3>
                  <button onClick={openCreateUser} style={{
                    padding: '8px 18px', background: C.brand, color: 'white',
                    border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontFamily: FONT,
                  }}>
                    + משתמש חדש
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative', flex: '1', minWidth: '200px' }}>
                    <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: C.textMuted, fontSize: '15px', pointerEvents: 'none' }}>🔍</span>
                    <input
                      value={userSearch}
                      onChange={e => setUserSearch(e.target.value)}
                      placeholder="חיפוש לפי שם או אימייל..."
                      style={{ width: '100%', padding: '9px 34px 9px 12px', border: `1px solid ${C.border}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', background: C.bgNested, color: C.textPrimary, fontFamily: FONT }}
                    />
                    {userSearch && (
                      <button onClick={() => setUserSearch('')} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '16px', lineHeight: 1 }}>✕</button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {[
                      { key: '',                label: 'הכל',           count: users.length },
                      { key: 'EMPLOYEE',        label: 'עובדים',        count: users.filter(u => u.role === 'EMPLOYEE').length },
                      { key: 'TEAM_LEAD',       label: 'ראשי צוות',     count: users.filter(u => u.role === 'TEAM_LEAD').length },
                      { key: 'RELEASE_MANAGER', label: 'מנהלי לילה',    count: users.filter(u => u.role === 'RELEASE_MANAGER').length },
                      { key: 'ADMIN',           label: 'מנהלי מערכת',   count: users.filter(u => u.role === 'ADMIN').length },
                    ].map(f => (
                      <button key={f.key} onClick={() => setUserRoleFilter(f.key)} style={{
                        padding: '6px 14px', borderRadius: '20px',
                        border: `2px solid ${userRoleFilter === f.key ? (ROLE_COLORS[f.key] || C.brand) : C.border}`,
                        background: userRoleFilter === f.key ? (ROLE_COLORS[f.key] || C.brand) + '22' : C.bgNested,
                        color: userRoleFilter === f.key ? (ROLE_COLORS[f.key] || C.brand) : C.textSecondary,
                        fontWeight: userRoleFilter === f.key ? 'bold' : 'normal',
                        cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap', fontFamily: FONT,
                      }}>
                        {f.label}
                        <span style={{ marginRight: '5px', background: userRoleFilter === f.key ? (ROLE_COLORS[f.key] || C.brand) : C.bgHover, color: userRoleFilter === f.key ? 'white' : C.textMuted, borderRadius: '10px', padding: '1px 7px', fontSize: '11px' }}>
                          {f.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {(() => {
                  const q = userSearch.trim().toLowerCase();
                  const filtered = users.filter(u => {
                    const matchRole = !userRoleFilter || u.role === userRoleFilter;
                    const matchSearch = !q || u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
                    return matchRole && matchSearch;
                  });
                  return (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: C.bgNested }}>
                      {['שם', 'אימייל', 'תפקיד', 'צוות', 'סטטוס', 'פעולות'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'right', fontSize: '13px', color: C.textSecondary, borderBottom: `2px solid ${C.border}`, fontWeight: 'bold' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: C.textMuted, fontSize: '14px' }}>לא נמצאו משתמשים התואמים את החיפוש</td></tr>
                    ) : filtered.map(u => (
                      <tr key={u.id} style={{ borderBottom: `1px solid ${C.border}`, opacity: u.active ? 1 : 0.5 }}>
                        <td style={{ padding: '10px 12px', fontSize: '14px', fontWeight: 'bold', color: C.textPrimary }}>
                          {u.fullName}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: '13px', color: C.textSecondary }}>{u.email}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            background: (ROLE_COLORS[u.role] || '#95a5a6') + '22',
                            color: ROLE_COLORS[u.role] || '#95a5a6',
                            border: `1px solid ${ROLE_COLORS[u.role] || '#95a5a6'}`,
                            padding: '3px 10px', borderRadius: '10px', fontSize: '12px', fontWeight: 'bold',
                          }}>
                            {ROLE_LABELS[u.role] || u.role}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: '13px', color: C.textSecondary }}>
                          {u.teamMemberships?.map((m: any) => m.team?.name).filter(Boolean).join(', ') || '—'}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            background: u.active ? C.bgDone : C.bgBlocked,
                            color: u.active ? C.statusDone : C.statusFailed,
                            padding: '3px 10px', borderRadius: '10px', fontSize: '12px', fontWeight: 'bold',
                          }}>
                            {u.active ? 'פעיל' : 'מושבת'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={() => openEditUser(u)} title="עריכה"
                              style={{ padding: '5px 10px', background: '#3498db', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
                              ✏️ ערוך
                            </button>
                            <button onClick={() => { setResetUserId(u.id); setNewPassword(''); }} title="איפוס סיסמה"
                              style={{ padding: '5px 10px', background: '#e67e22', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
                              🔑
                            </button>
                            <button onClick={() => toggleActive(u)} title={u.active ? 'השבת' : 'הפעל'}
                              style={{ padding: '5px 10px', background: u.active ? C.statusFailed : C.statusDone, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
                              {u.active ? '🚫' : '✅'}
                            </button>
                            <button onClick={() => deleteUser(u)} title="מחק משתמש"
                              style={{ padding: '5px 10px', background: '#7f1d1d', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ── TEAMS TAB ── */}
          {tab === 'teams' && (
            <div>
              {showTeamForm && (
                <form onSubmit={createTeam} style={{
                  background: C.bgCard, borderRadius: '12px', padding: '24px', marginBottom: '20px',
                  border: `2px solid ${C.brand}`,
                }}>
                  <h3 style={{ margin: '0 0 16px', color: C.textPrimary }}>➕ צוות חדש</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
                    <div>
                      <label style={labelStyle}>שם הצוות *</label>
                      <input required style={inputStyle} value={teamName}
                        onChange={e => setTeamName(e.target.value)} placeholder="שם הצוות..." />
                    </div>
                    <div>
                      <label style={labelStyle}>תיאור</label>
                      <input style={inputStyle} value={teamDesc}
                        onChange={e => setTeamDesc(e.target.value)} placeholder="תיאור קצר..." />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button type="submit" disabled={savingTeam} style={{
                      padding: '10px 24px', background: savingTeam ? C.bgHover : C.statusDone,
                      color: 'white', border: 'none', borderRadius: '8px',
                      cursor: savingTeam ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontFamily: FONT,
                    }}>
                      {savingTeam ? 'יוצר...' : '✓ צור צוות'}
                    </button>
                    <button type="button" onClick={() => setShowTeamForm(false)}
                      style={{ padding: '10px 20px', background: C.bgHover, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', fontFamily: FONT }}>
                      ביטול
                    </button>
                  </div>
                </form>
              )}

              <div style={{ background: C.bgCard, borderRadius: '12px', padding: '20px', border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ margin: 0, color: C.textPrimary }}>צוותים ({teams.length})</h3>
                  <button onClick={() => setShowTeamForm(true)} style={{
                    padding: '8px 18px', background: C.brand, color: 'white',
                    border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontFamily: FONT,
                  }}>
                    + צוות חדש
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '14px' }}>
                  {teams.map(t => {
                    const members = users.filter(u =>
                      u.teamMemberships?.some((m: any) => m.team?.id === t.id)
                    );
                    const isEditing = editingTeamId === t.id;
                    return (
                      <div key={t.id} style={{
                        border: `2px solid ${isEditing ? '#e67e22' : t.active ? C.brand : C.border}`,
                        borderRadius: '10px', padding: '16px',
                        background: t.active ? C.bgNested : C.bgHover, opacity: t.active ? 1 : 0.6,
                      }}>
                        {isEditing ? (
                          <form onSubmit={saveTeamEdit}>
                            <div style={{ marginBottom: '10px' }}>
                              <label style={labelStyle}>שם הצוות *</label>
                              <input required style={inputStyle} value={editTeamName}
                                onChange={e => setEditTeamName(e.target.value)} autoFocus />
                            </div>
                            <div style={{ marginBottom: '12px' }}>
                              <label style={labelStyle}>תיאור</label>
                              <input style={inputStyle} value={editTeamDesc}
                                onChange={e => setEditTeamDesc(e.target.value)} />
                            </div>
                            <div style={{ marginBottom: '12px' }}>
                              <label style={{ ...labelStyle, marginBottom: '6px' }}>מערכות אחראיות</label>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {APPS.map(a => {
                                  const checked = editTeamApps.includes(a);
                                  return (
                                    <label key={a} style={{
                                      display: 'flex', alignItems: 'center', gap: '4px',
                                      fontSize: '12px', cursor: 'pointer',
                                      background: checked ? C.brandDim : C.bgHover,
                                      border: `1px solid ${checked ? C.brand : C.border}`,
                                      borderRadius: '6px', padding: '4px 10px',
                                      color: checked ? C.textPrimary : C.textSecondary, fontWeight: checked ? 'bold' : 'normal',
                                    }}>
                                      <input type="checkbox" checked={checked} style={{ margin: 0 }}
                                        onChange={e => setEditTeamApps(prev =>
                                          e.target.checked ? [...prev, a] : prev.filter(x => x !== a)
                                        )} />
                                      {a}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button type="submit" disabled={savingEditTeam} style={{
                                padding: '6px 14px', background: savingEditTeam ? C.bgHover : C.statusDone,
                                color: 'white', border: 'none', borderRadius: '6px',
                                cursor: savingEditTeam ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 'bold', fontFamily: FONT,
                              }}>
                                {savingEditTeam ? 'שומר...' : '✓ שמור'}
                              </button>
                              <button type="button" onClick={() => setEditingTeamId(null)} style={{
                                padding: '6px 14px', background: C.bgHover, color: C.textSecondary,
                                border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontFamily: FONT,
                              }}>
                                ביטול
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: '15px', color: C.textPrimary }}>{t.name}</div>
                                {t.description && <div style={{ fontSize: '12px', color: C.textMuted, marginTop: '2px' }}>{t.description}</div>}
                              </div>
                              <div style={{ display: 'flex', gap: '5px', flexShrink: 0, marginRight: '8px' }}>
                                <button onClick={() => openEditTeam(t)} title="ערוך צוות"
                                  style={{ padding: '4px 8px', fontSize: '12px', border: 'none', borderRadius: '6px', background: '#3498db', color: 'white', cursor: 'pointer' }}>
                                  ✏️
                                </button>
                                <button onClick={() => toggleTeamActive(t)} title={t.active ? 'השבת' : 'הפעל'}
                                  style={{ padding: '4px 8px', fontSize: '12px', border: 'none', borderRadius: '6px', background: t.active ? C.bgBlocked : C.bgDone, color: t.active ? C.statusFailed : C.statusDone, cursor: 'pointer' }}>
                                  {t.active ? 'השבת' : 'הפעל'}
                                </button>
                                <button onClick={() => deleteTeam(t)} title="מחק צוות"
                                  style={{ padding: '4px 8px', fontSize: '12px', border: 'none', borderRadius: '6px', background: C.statusFailed, color: 'white', cursor: 'pointer' }}>
                                  🗑️
                                </button>
                              </div>
                            </div>
                            <div style={{ fontSize: '12px', color: C.textMuted, marginBottom: '8px' }}>
                              {members.length} חברים
                            </div>
                            {members.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: t.apps?.length ? '10px' : '0' }}>
                                {members.map(m => (
                                  <span key={m.id} style={{
                                    background: C.brandDim, color: C.textPrimary,
                                    padding: '2px 8px', borderRadius: '10px', fontSize: '12px',
                                  }}>
                                    {m.fullName}
                                  </span>
                                ))}
                              </div>
                            )}
                            {t.apps?.length > 0 && (
                              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: '8px', marginTop: members.length ? '0' : '4px' }}>
                                <div style={{ fontSize: '11px', color: C.textMuted, marginBottom: '4px' }}>מערכות אחראיות</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                  {(t.apps as string[]).map(a => (
                                    <span key={a} style={{
                                      background: C.bgDone, color: C.statusDone,
                                      padding: '2px 7px', borderRadius: '8px', fontSize: '11px', fontWeight: 'bold',
                                    }}>
                                      {a}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── QC RELEASES TAB ── */}
          {tab === 'qc-releases' && (
            <div>
              <div style={{ background: C.bgCard, borderRadius: '12px', padding: '20px', border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px', color: C.textPrimary }}>📋 גרסאות QC ({qcReleases.length})</h3>
                    <p style={{ margin: 0, fontSize: '12px', color: C.textMuted }}>גרסאות מסונכרנות ממערכת QC. מוצגות ברשימת הגרסאות רק אם filterDate &gt; היום.</p>
                  </div>
                  <button onClick={syncQcReleases} disabled={qcSyncing} style={{
                    padding: '8px 18px', background: qcSyncing ? C.bgHover : C.brand, color: qcSyncing ? C.textDisabled : 'white',
                    border: 'none', borderRadius: '8px', cursor: qcSyncing ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontFamily: FONT,
                  }}>
                    {qcSyncing ? 'מסנכרן...' : '🔄 סנכרן מ-QC'}
                  </button>
                </div>

                {qcSyncResult && (
                  <div style={{ background: qcSyncResult.startsWith('✓') ? C.bgDone : C.bgBlocked, border: `1px solid ${qcSyncResult.startsWith('✓') ? C.statusDone : C.statusFailed}44`, borderRadius: '8px', padding: '10px 16px', marginBottom: '8px', fontSize: '13px', color: qcSyncResult.startsWith('✓') ? C.statusDone : C.statusFailed }}>
                    {qcSyncResult}
                  </div>
                )}

                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: '14px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: C.textSecondary, marginBottom: '3px' }}>📥 סנכרן מקובץ Excel (CR_LIST)</div>
                    <div style={{ fontSize: '12px', color: C.textMuted }}>קורא מהנתיב המוגדר בפרמטר EXCEL_FILE_PATH — ללא חיבור Oracle</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ fontSize: '12px', color: C.textSecondary, whiteSpace: 'nowrap' }}>שנה:</label>
                    <input
                      type="number"
                      value={excelYear}
                      onChange={e => setExcelYear(Number(e.target.value))}
                      style={{ width: '80px', padding: '6px 8px', border: `1px solid ${C.border}`, borderRadius: '6px', fontSize: '13px', background: C.bgNested, color: C.textPrimary, fontFamily: FONT }}
                      min={2020} max={2099}
                    />
                  </div>
                  <button
                    onClick={syncQcFromExcel}
                    disabled={excelSyncing}
                    style={{
                      padding: '8px 18px', background: excelSyncing ? C.bgHover : C.statusDone,
                      color: excelSyncing ? C.textDisabled : 'white', border: 'none', borderRadius: '8px',
                      cursor: excelSyncing ? 'not-allowed' : 'pointer',
                      fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap', fontFamily: FONT,
                    }}
                  >
                    {excelSyncing ? 'מסנכרן...' : '📥 סנכרן מ-Excel'}
                  </button>
                  {excelSyncResult && (
                    <div style={{ background: excelSyncResult.startsWith('✓') ? C.bgDone : C.bgBlocked, border: `1px solid ${excelSyncResult.startsWith('✓') ? C.statusDone : C.statusFailed}44`, borderRadius: '8px', padding: '8px 14px', fontSize: '13px', color: excelSyncResult.startsWith('✓') ? C.statusDone : C.statusFailed }}>
                      {excelSyncResult}
                    </div>
                  )}
                </div>

                {qcReleases.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>
                    <p>אין גרסאות QC. לחץ "סנכרן מ-QC" כדי לטעון (דורש חיבור Oracle).</p>
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: C.bgNested }}>
                          {['REL ID', 'שם גרסה', 'צוות', 'תאריך Go Live', 'תאריך Rehearsal', 'Filter Date', 'סטטוס', 'פעולות'].map(h => (
                            <th key={h} style={{ padding: '10px 12px', textAlign: 'right', fontSize: '12px', color: C.textSecondary, borderBottom: `2px solid ${C.border}`, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {qcReleases.map(r => {
                          const today = new Date(); today.setHours(0, 0, 0, 0);
                          const filterDate = r.filterDate ? new Date(r.filterDate) : null;
                          const isVisible = filterDate && filterDate > today;
                          return (
                            <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}`, opacity: r.active ? 1 : 0.5 }}>
                              <td style={{ padding: '8px 12px', fontSize: '13px', color: C.textMuted }}>{r.relId}</td>
                              <td style={{ padding: '8px 12px', fontSize: '13px', fontWeight: 'bold', color: C.textPrimary }}>{r.relName}</td>
                              <td style={{ padding: '8px 12px', fontSize: '12px', color: C.textSecondary }}>{r.relTeam || '—'}</td>
                              <td style={{ padding: '8px 12px', fontSize: '12px', color: C.textSecondary }}>
                                {r.goLiveDate ? new Date(r.goLiveDate).toLocaleDateString('he-IL') : '—'}
                              </td>
                              <td style={{ padding: '8px 12px', fontSize: '12px', color: C.textSecondary }}>
                                {r.rehearsalDate ? new Date(r.rehearsalDate).toLocaleDateString('he-IL') : '—'}
                              </td>
                              <td style={{ padding: '8px 12px', fontSize: '12px' }}>
                                {filterDate ? (
                                  <span style={{ color: isVisible ? C.statusDone : C.statusFailed, fontWeight: 'bold' }}>
                                    {filterDate.toLocaleDateString('he-IL')} {isVisible ? '✓' : '(עבר)'}
                                  </span>
                                ) : <span style={{ color: C.statusFailed }}>ריק — לא יוצג</span>}
                              </td>
                              <td style={{ padding: '8px 12px' }}>
                                <span style={{
                                  background: r.active ? C.bgDone : C.bgBlocked,
                                  color: r.active ? C.statusDone : C.statusFailed,
                                  padding: '2px 8px', borderRadius: '10px', fontSize: '12px', fontWeight: 'bold',
                                }}>
                                  {r.active ? 'פעיל' : 'מושבת'}
                                </span>
                              </td>
                              <td style={{ padding: '8px 12px' }}>
                                <button onClick={() => toggleQcRelease(r.id)} style={{
                                  padding: '4px 10px', fontSize: '12px', border: 'none', borderRadius: '6px',
                                  background: r.active ? C.bgBlocked : C.bgDone,
                                  color: r.active ? C.statusFailed : C.statusDone, cursor: 'pointer', fontFamily: FONT,
                                }}>
                                  {r.active ? 'השבת' : 'הפעל'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── QC USERS SYNC TAB ── */}
          {tab === 'qc-users' && (
            <div>
              <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px', border: `1px solid ${C.border}` }}>
                <h3 style={{ margin: '0 0 8px', color: C.textPrimary }}>🔄 סנכרון משתמשים מ-QC</h3>
                <p style={{ margin: '0 0 20px', fontSize: '13px', color: C.textSecondary }}>
                  פעולה זו תסנכרן את רשימת המשתמשים מול רשימת משתמשי QC (137 משתמשים).<br />
                  משתמשים שאינם ברשימת QC יושבתו. מנהלי מערכת (ADMIN) לא יושפעו.<br />
                  סיסמת ברירת מחדל למשתמשים חדשים: <code style={{ background: C.bgNested, padding: '1px 5px', borderRadius: '3px', fontFamily: FONT_MONO }}>123456</code>
                </p>
                <button onClick={syncQcUsers} disabled={userSyncing} style={{
                  padding: '12px 28px', background: userSyncing ? C.bgHover : C.statusFailed, color: userSyncing ? C.textDisabled : 'white',
                  border: 'none', borderRadius: '8px', cursor: userSyncing ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold', fontSize: '15px', fontFamily: FONT,
                }}>
                  {userSyncing ? 'מסנכרן...' : '🔄 סנכרן משתמשים'}
                </button>
                {userSyncResult && (
                  <div style={{ marginTop: '16px', background: userSyncResult.startsWith('✓') ? C.bgDone : C.bgBlocked, border: `1px solid ${userSyncResult.startsWith('✓') ? C.statusDone : C.statusFailed}44`, borderRadius: '8px', padding: '12px 16px', fontSize: '14px', color: userSyncResult.startsWith('✓') ? C.statusDone : C.statusFailed, fontWeight: 'bold' }}>
                    {userSyncResult}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── PERMISSIONS TAB ── */}
          {tab === 'permissions' && (
            <PermissionsTab allPermissions={allPermissions} updateRole={updateRole} saving={permSaving} />
          )}

          {/* ── TEMPLATES TAB ── */}
          {tab === 'templates' && (() => {
            if (!templates.length && !templatesLoading) fetchTemplates();
            return (
              <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px', border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px', color: C.textPrimary }}>📁 תבניות גרסה ({templates.length})</h3>
                    <p style={{ margin: 0, fontSize: '13px', color: C.textMuted }}>תבניות שמורות ליצירת גרסאות עתידיות</p>
                  </div>
                  <button onClick={fetchTemplates} disabled={templatesLoading}
                    style={{ padding: '8px 16px', background: C.bgHover, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: C.textSecondary, fontFamily: FONT }}>
                    {templatesLoading ? '...' : '🔄 רענן'}
                  </button>
                </div>
                {templateError && (
                  <div style={{ background: C.bgBlocked, border: `1px solid ${C.statusFailed}44`, borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '13px', color: C.statusFailed }}>
                    ⚠️ {templateError}
                    <button onClick={() => setTemplateError(null)} style={{ marginRight: '8px', background: 'none', border: 'none', cursor: 'pointer', color: C.statusFailed, fontWeight: 'bold' }}>×</button>
                  </div>
                )}
                {templatesLoading ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>טוען תבניות...</div>
                ) : templates.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>
                    <div style={{ fontSize: '36px', marginBottom: '8px' }}>📭</div>
                    <p>אין תבניות שמורות — שמור תבנית מגרסה קיימת</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {templates.map((t: any) => (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', border: `1px solid ${C.border}`, borderRadius: '10px', background: C.bgNested }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 'bold', fontSize: '15px', color: C.textPrimary }}>{t.name}</div>
                          {t.description && <div style={{ fontSize: '12px', color: C.textMuted, marginTop: '2px' }}>{t.description}</div>}
                          <div style={{ fontSize: '11px', color: C.textMuted, marginTop: '4px' }}>
                            נוצר ע"י {t.creator?.fullName ?? '—'} · {t.createdAt ? new Date(t.createdAt).toLocaleDateString('he-IL') : ''}
                          </div>
                        </div>
                        <button
                          disabled={deletingTemplateId === t.id}
                          onClick={() => deleteTemplate(t.id)}
                          style={{ padding: '7px 16px', background: deletingTemplateId === t.id ? C.bgHover : C.statusFailed, color: deletingTemplateId === t.id ? C.textDisabled : 'white', border: 'none', borderRadius: '8px', cursor: deletingTemplateId === t.id ? 'not-allowed' : 'pointer', fontSize: '13px', whiteSpace: 'nowrap', fontFamily: FONT }}
                        >
                          {deletingTemplateId === t.id ? 'מוחק...' : '🗑 מחק'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── LDAP / AD TAB ── */}
          {tab === 'ldap' && (() => {
            const ldapParams = systemParams.filter(p => p.key.startsWith('LDAP_'));
            const isEnabled = ldapParams.find(p => p.key === 'LDAP_ENABLED')?.value === 'true';
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{
                  background: C.bgCard, borderRadius: '12px', padding: '24px',
                  border: `1px solid ${C.border}`,
                  borderRight: `4px solid ${isEnabled ? C.statusDone : C.border}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                      <h3 style={{ margin: '0 0 4px', color: C.textPrimary }}>🔒 Active Directory / LDAP</h3>
                      <p style={{ margin: 0, fontSize: '13px', color: C.textMuted }}>
                        כשמופעל — משתמשים מתחברים עם שם משתמש AD. חשבונות המנהל הטכני משתמשים תמיד בהתחברות מקומית.
                      </p>
                    </div>
                    <span style={{
                      padding: '6px 18px', borderRadius: '20px', fontSize: '13px', fontWeight: 'bold',
                      background: isEnabled ? C.bgDone : C.bgHover,
                      color: isEnabled ? C.statusDone : C.textMuted,
                    }}>
                      {isEnabled ? 'מופעל' : 'מושבת'}
                    </span>
                  </div>
                </div>

                <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px', border: `1px solid ${C.border}` }}>
                  <h3 style={{ margin: '0 0 6px', color: C.textPrimary }}>הגדרות חיבור</h3>
                  <p style={{ margin: '0 0 20px', fontSize: '13px', color: C.textMuted }}>
                    שנה ערך → לחץ Enter לשמירה מיידית
                  </p>
                  {paramError && (
                    <div style={{ background: C.bgBlocked, border: `1px solid ${C.statusFailed}44`, borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '13px', color: C.statusFailed }}>
                      ⚠️ {paramError}
                    </div>
                  )}
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: C.bgNested }}>
                        {['תיאור', 'מפתח', 'ערך', 'פעולות'].map(h => (
                          <th key={h} style={{ padding: '10px 14px', textAlign: 'right', fontSize: '12px', color: C.textSecondary, fontWeight: 'bold', border: `1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ldapParams.length === 0 ? (
                        <tr><td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: C.textMuted, fontSize: '13px' }}>טוען הגדרות LDAP...</td></tr>
                      ) : ldapParams.map(p => (
                        <tr key={p.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '12px 14px', fontSize: '13px', fontWeight: 'bold', color: C.textPrimary, border: `1px solid ${C.border}` }}>
                            {p.label.replace(/^LDAP[^:]*: /, '')}
                          </td>
                          <td style={{ padding: '12px 14px', fontFamily: FONT_MONO, fontSize: '11px', color: C.textMuted, border: `1px solid ${C.border}` }}>{p.key}</td>
                          <td style={{ padding: '12px 14px', border: `1px solid ${C.border}`, minWidth: '240px' }}>
                            {editingParam === p.key ? (
                              <input
                                autoFocus
                                type={p.type === 'password' ? 'password' : 'text'}
                                value={paramValue}
                                onChange={e => setParamValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveParam(p.key); if (e.key === 'Escape') setEditingParam(null); }}
                                style={{ width: '100%', padding: '6px 10px', border: `2px solid ${C.brand}`, borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box', direction: 'ltr', background: C.bgNested, color: C.textPrimary, fontFamily: FONT_MONO }}
                              />
                            ) : (
                              <span style={{ fontSize: '13px', color: p.value ? C.textPrimary : C.textMuted, fontStyle: p.value ? 'normal' : 'italic', direction: 'ltr', display: 'inline-block', fontFamily: p.value ? FONT_MONO : FONT }}>
                                {p.type === 'password' && p.value ? '••••••••' : (p.value || 'לא הוגדר')}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '10px 14px', border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                            {editingParam === p.key ? (
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={() => saveParam(p.key)} disabled={savingParam}
                                  style={{ padding: '5px 14px', background: savingParam ? C.bgHover : C.statusDone, color: savingParam ? C.textDisabled : 'white', border: 'none', borderRadius: '6px', cursor: savingParam ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 'bold', fontFamily: FONT }}>
                                  {savingParam ? '...' : 'שמור'}
                                </button>
                                <button onClick={() => { setEditingParam(null); setParamError(null); }}
                                  style={{ padding: '5px 12px', background: C.bgHover, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontFamily: FONT }}>
                                  ביטול
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => { setEditingParam(p.key); setParamValue(p.value); setParamError(null); }}
                                style={{ padding: '5px 14px', background: C.brand, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontFamily: FONT }}>
                                ✏️ ערוך
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px', border: `1px solid ${C.border}` }}>
                  <h3 style={{ margin: '0 0 8px', color: C.textPrimary }}>בדיקת חיבור</h3>
                  <p style={{ margin: '0 0 16px', fontSize: '13px', color: C.textMuted }}>
                    בודק את החיבור לשרת LDAP ואת חשבון השירות (Bind DN). לא מאמת משתמש ספציפי.
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <button
                      onClick={testLdap}
                      disabled={ldapTesting}
                      style={{
                        padding: '9px 22px', background: ldapTesting ? C.bgHover : C.brand,
                        color: ldapTesting ? C.textDisabled : 'white', border: 'none', borderRadius: '8px',
                        cursor: ldapTesting ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '14px', fontFamily: FONT,
                      }}
                    >
                      {ldapTesting ? 'בודק...' : '🔌 בדוק חיבור'}
                    </button>
                    {ldapTestResult && (
                      <div style={{
                        padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold',
                        background: ldapTestResult.success ? C.bgDone : C.bgBlocked,
                        color: ldapTestResult.success ? C.statusDone : C.statusFailed,
                      }}>
                        {ldapTestResult.success ? '✓' : '✕'} {ldapTestResult.message}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ background: C.bgNested, borderRadius: '12px', padding: '20px', border: `1px solid ${C.border}`, fontSize: '13px', color: C.textSecondary, lineHeight: '1.7' }}>
                  <strong style={{ color: C.textPrimary, display: 'block', marginBottom: '8px' }}>כיצד ההתחברות פועלת:</strong>
                  <ul style={{ margin: 0, paddingRight: '20px' }}>
                    <li>כשה-LDAP מופעל, המשתמשים מזינים את <strong>שם המשתמש ב-AD</strong> (לא אימייל) ואת הסיסמה שלהם.</li>
                    <li>המערכת מאמתת מול Active Directory ומביאה את כתובת האימייל של המשתמש.</li>
                    <li>המשתמש חייב להיות <strong>מוגדר מראש</strong> במערכת (לשוניות "משתמשים") עם אותה כתובת אימייל.</li>
                    <li>חשבונות <code style={{ background: C.bgCard, padding: '1px 5px', borderRadius: '3px', fontFamily: FONT_MONO }}>nissim@test.com</code> ודומיהם תמיד משתמשים בהתחברות מקומית.</li>
                  </ul>
                </div>
              </div>
            );
          })()}

          {/* ── EMAIL TAB ── */}
          {tab === 'email' && (() => {
            const emailParams = systemParams.filter(p => p.key.startsWith('EMAIL_'));
            const isEnabled = emailParams.find(p => p.key === 'EMAIL_ENABLED')?.value === 'true';
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ background: isEnabled ? C.bgDone : C.bgNested, borderRadius: '12px', padding: '20px 24px', border: `2px solid ${isEnabled ? C.statusDone : C.border}`, display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <span style={{ fontSize: '32px' }}>{isEnabled ? '📧' : '📪'}</span>
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '16px', color: isEnabled ? C.statusDone : C.textSecondary }}>
                      {isEnabled ? 'שליחת מייל מופעלת' : 'שליחת מייל מושבתת'}
                    </div>
                    <div style={{ fontSize: '13px', color: C.textMuted, marginTop: '2px' }}>
                      הגדר <code style={{ fontFamily: FONT_MONO }}>EMAIL_ENABLED = true</code> להפעלה
                    </div>
                  </div>
                </div>

                <div style={{ background: C.bgCard, borderRadius: '12px', padding: '20px 24px', border: `1px solid ${C.border}` }}>
                  <div style={{ fontWeight: 'bold', fontSize: '15px', color: C.textPrimary, marginBottom: '16px' }}>⚙️ הגדרות SMTP</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: C.bgNested }}>
                        {['תיאור', 'מפתח', 'ערך', 'פעולות'].map(h => (
                          <th key={h} style={{ padding: '9px 14px', textAlign: 'right', fontSize: '12px', color: C.textSecondary, fontWeight: 'bold', border: `1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {emailParams.map(p => (
                        <tr key={p.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: 'bold', color: C.textPrimary, border: `1px solid ${C.border}` }}>{p.label}</td>
                          <td style={{ padding: '10px 14px', fontFamily: FONT_MONO, fontSize: '11px', color: C.textMuted, border: `1px solid ${C.border}` }}>{p.key}</td>
                          <td style={{ padding: '10px 14px', border: `1px solid ${C.border}`, minWidth: '240px' }}>
                            {editingParam === p.key ? (
                              <input
                                autoFocus
                                type={p.type === 'password' ? 'password' : 'text'}
                                value={paramValue}
                                onChange={e => setParamValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveParam(p.key); if (e.key === 'Escape') setEditingParam(null); }}
                                style={{ width: '100%', padding: '5px 9px', border: `2px solid ${C.brand}`, borderRadius: '6px', fontSize: '12px', boxSizing: 'border-box', direction: 'ltr', background: C.bgNested, color: C.textPrimary, fontFamily: FONT_MONO }}
                              />
                            ) : (
                              <span style={{ fontSize: '13px', color: p.value ? C.textPrimary : C.textMuted, fontStyle: p.value ? 'normal' : 'italic', direction: 'ltr', display: 'inline-block', fontFamily: p.value ? FONT_MONO : FONT }}>
                                {p.type === 'password' && p.value ? '••••••••' : (p.value || 'לא הוגדר')}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '8px 14px', border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                            {editingParam === p.key ? (
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={() => saveParam(p.key)} disabled={savingParam}
                                  style={{ padding: '4px 12px', background: savingParam ? C.bgHover : C.statusDone, color: savingParam ? C.textDisabled : 'white', border: 'none', borderRadius: '6px', cursor: savingParam ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 'bold', fontFamily: FONT }}>
                                  {savingParam ? '...' : 'שמור'}
                                </button>
                                <button onClick={() => { setEditingParam(null); setParamError(null); }}
                                  style={{ padding: '4px 10px', background: C.bgHover, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontFamily: FONT }}>
                                  ביטול
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => { setEditingParam(p.key); setParamValue(p.value); setParamError(null); }}
                                style={{ padding: '4px 12px', background: C.brand, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontFamily: FONT }}>
                                ✏️ ערוך
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ background: C.bgCard, borderRadius: '12px', padding: '20px 24px', border: `1px solid ${C.border}` }}>
                  <div style={{ fontWeight: 'bold', fontSize: '15px', color: C.textPrimary, marginBottom: '12px' }}>🔌 בדיקת שליחה</div>
                  <p style={{ fontSize: '13px', color: C.textSecondary, margin: '0 0 14px' }}>
                    שולח מייל בדיקה לרשימת התפוצה המוגדרת ב-<code style={{ fontFamily: FONT_MONO }}>EMAIL_DISTRIBUTION_LIST</code>.
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <button
                      onClick={testEmailConfig}
                      disabled={emailTesting || !isEnabled}
                      style={{
                        padding: '9px 22px', background: emailTesting ? C.bgHover : !isEnabled ? C.bgHover : '#2980b9',
                        color: (emailTesting || !isEnabled) ? C.textDisabled : 'white', border: 'none', borderRadius: '8px',
                        cursor: (emailTesting || !isEnabled) ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '14px', fontFamily: FONT,
                      }}
                    >
                      {emailTesting ? 'שולח...' : '📤 שלח מייל בדיקה'}
                    </button>
                    {!isEnabled && <span style={{ fontSize: '12px', color: C.textMuted }}>יש להפעיל EMAIL_ENABLED תחילה</span>}
                    {emailTestResult && (
                      <div style={{
                        padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold',
                        background: emailTestResult.success ? C.bgDone : C.bgBlocked,
                        color: emailTestResult.success ? C.statusDone : C.statusFailed,
                      }}>
                        {emailTestResult.success ? '✓' : '✕'} {emailTestResult.message}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ background: C.bgNested, borderRadius: '12px', padding: '20px', border: `1px solid ${C.border}`, fontSize: '13px', color: C.textSecondary, lineHeight: '1.7' }}>
                  <strong style={{ color: C.textPrimary, display: 'block', marginBottom: '8px' }}>הגדרות SMTP נפוצות:</strong>
                  <ul style={{ margin: 0, paddingRight: '20px' }}>
                    <li>Gmail: <code style={{ fontFamily: FONT_MONO }}>HOST=smtp.gmail.com, PORT=587, SECURE=false</code> — נדרש App Password</li>
                    <li>Outlook/Office365: <code style={{ fontFamily: FONT_MONO }}>HOST=smtp.office365.com, PORT=587, SECURE=false</code></li>
                    <li>שרת פנימי: <code style={{ fontFamily: FONT_MONO }}>HOST=mail.corp.local, PORT=25, SECURE=false</code> (ללא משתמש/סיסמה)</li>
                    <li><code style={{ fontFamily: FONT_MONO }}>EMAIL_DISTRIBUTION_LIST</code> — רשימת נמענים מופרדת בפסיקים</li>
                  </ul>
                </div>
              </div>
            );
          })()}

          {/* ── SYSTEM PARAMS TAB ── */}
          {tab === 'params' && (
            <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px', border: `1px solid ${C.border}` }}>
              <h3 style={{ margin: '0 0 4px', color: C.textPrimary }}>⚙️ פרמטרי מערכת</h3>
              <p style={{ margin: '0 0 20px', fontSize: '13px', color: C.textMuted }}>הגדרות גלובליות השולטות בתהליכים במערכת</p>
              {paramError && (
                <div style={{ background: C.bgBlocked, border: `1px solid ${C.statusFailed}44`, borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '13px', color: C.statusFailed }}>
                  ⚠️ {paramError}
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: C.bgNested }}>
                    {['תיאור', 'מפתח', 'ערך נוכחי', 'פעולות'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'right', fontSize: '12px', color: C.textSecondary, fontWeight: 'bold', border: `1px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {systemParams.map(p => (
                    <tr key={p.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: 'bold', color: C.textPrimary, border: `1px solid ${C.border}` }}>{p.label}</td>
                      <td style={{ padding: '12px 14px', fontFamily: FONT_MONO, fontSize: '12px', color: C.textMuted, border: `1px solid ${C.border}` }}>{p.key}</td>
                      <td style={{ padding: '12px 14px', border: `1px solid ${C.border}`, minWidth: '260px' }}>
                        {editingParam === p.key ? (
                          <input
                            autoFocus
                            value={paramValue}
                            onChange={e => setParamValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveParam(p.key); if (e.key === 'Escape') setEditingParam(null); }}
                            style={{ width: '100%', padding: '6px 10px', border: `2px solid ${C.brand}`, borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box', direction: 'ltr', background: C.bgNested, color: C.textPrimary, fontFamily: FONT_MONO }}
                            placeholder="הזן ערך..."
                          />
                        ) : (
                          <span style={{ fontSize: '13px', color: p.value ? C.textPrimary : C.textMuted, fontStyle: p.value ? 'normal' : 'italic', direction: 'ltr', display: 'inline-block', fontFamily: p.value ? FONT_MONO : FONT }}>
                            {p.value || 'לא הוגדר'}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                        {editingParam === p.key ? (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={() => saveParam(p.key)} disabled={savingParam}
                              style={{ padding: '5px 14px', background: savingParam ? C.bgHover : C.statusDone, color: savingParam ? C.textDisabled : 'white', border: 'none', borderRadius: '6px', cursor: savingParam ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 'bold', fontFamily: FONT }}>
                              {savingParam ? '...' : 'שמור'}
                            </button>
                            <button onClick={() => { setEditingParam(null); setParamError(null); }}
                              style={{ padding: '5px 12px', background: C.bgHover, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontFamily: FONT }}>
                              ביטול
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditingParam(p.key); setParamValue(p.value); setParamError(null); }}
                            style={{ padding: '5px 14px', background: C.brand, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontFamily: FONT }}>
                            ✏️ ערוך
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {systemParams.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ padding: '30px', textAlign: 'center', color: C.textMuted, fontSize: '13px' }}>אין פרמטרים מוגדרים</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ─── Permissions matrix component ────────────────────────────────────────────

const PermissionsTab: React.FC<{
  allPermissions: Record<string, string[]>;
  updateRole: (role: string, permissions: string[]) => Promise<void>;
  saving: boolean;
}> = ({ allPermissions, updateRole, saving }) => {
  const [local, setLocal] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setLocal(JSON.parse(JSON.stringify(allPermissions)));
  }, [allPermissions]);

  const toggle = (role: string, perm: string) => {
    setLocal(prev => {
      const cur = prev[role] ?? [];
      const next = cur.includes(perm) ? cur.filter(p => p !== perm) : [...cur, perm];
      return { ...prev, [role]: next };
    });
  };

  const save = async (role: string) => {
    await updateRole(role, local[role] ?? []);
  };

  const groups = ['מסכים', 'פעולות'];

  const thStyle: React.CSSProperties = {
    padding: '10px 14px', fontSize: '12px', fontWeight: 'bold',
    color: C.textSecondary, textAlign: 'center', borderBottom: `2px solid ${C.border}`,
    whiteSpace: 'nowrap', background: C.bgNested,
  };
  const tdStyle: React.CSSProperties = {
    padding: '8px 14px', textAlign: 'center', borderBottom: `1px solid ${C.border}`,
  };

  return (
    <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px', border: `1px solid ${C.border}` }}>
      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 4px', color: C.textPrimary }}>🔐 ניהול הרשאות לפי תפקיד</h3>
        <p style={{ margin: 0, fontSize: '13px', color: C.textMuted }}>סמן / בטל סימון ולחץ "שמור" בשורת התפקיד</p>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', direction: 'rtl' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'right', minWidth: '180px' }}>הרשאה</th>
              {ROLES.map(role => (
                <th key={role} style={thStyle}>
                  <div style={{ color: ROLE_COLORS[role], fontWeight: 'bold' }}>{ROLE_LABELS[role]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(group => (
              <React.Fragment key={group}>
                <tr>
                  <td colSpan={ROLES.length + 1} style={{
                    padding: '10px 14px', background: C.bgNested,
                    fontSize: '11px', fontWeight: 'bold', color: C.textMuted,
                    textTransform: 'uppercase', letterSpacing: '1px',
                  }}>
                    {group}
                  </td>
                </tr>
                {PERMISSION_DEFS.filter(p => p.group === group).map(perm => (
                  <tr key={perm.key}
                    onMouseEnter={e => (e.currentTarget.style.background = C.bgHover)}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <td style={{ ...tdStyle, textAlign: 'right', fontSize: '13px', color: C.textSecondary, fontWeight: '500' }}>
                      {perm.label}
                    </td>
                    {ROLES.map(role => {
                      const checked = (local[role] ?? []).includes(perm.key);
                      return (
                        <td key={role} style={tdStyle}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(role, perm.key)}
                            style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: ROLE_COLORS[role] }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}

            <tr>
              <td style={{ ...tdStyle, fontSize: '12px', color: C.textMuted }}>שמירה</td>
              {ROLES.map(role => (
                <td key={role} style={tdStyle}>
                  <button
                    onClick={() => save(role)}
                    disabled={saving}
                    style={{
                      padding: '5px 12px', fontSize: '12px', border: 'none',
                      borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer',
                      background: ROLE_COLORS[role], color: 'white', fontWeight: 'bold',
                      opacity: saving ? 0.6 : 1, fontFamily: FONT,
                    }}
                  >
                    שמור
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
