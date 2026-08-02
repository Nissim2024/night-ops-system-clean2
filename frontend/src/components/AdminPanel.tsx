import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { usePermissions } from '../context/PermissionsContext';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';
import { C, FONT, FONT_MONO, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../theme';
import { Card, Badge, Button, TextField, Select, Toggle, SectionHeader, Avatar, TabBar, EmptyState, Divider, Alert } from './ui';
import { cleanHtmlText } from '../utils/textSanitize';
import { VersionCard } from './VersionsView';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const APPS = [
  'BILI', 'CRM', 'OSB', 'DP', 'WEB-RETAIL', 'WEB-NEXT', 'WEB-HOT',
  'TOP', 'IRB', 'NC', 'ERP', 'CONNECT', 'CREDIT GUARD', 'ARCHIVE',
  'PRINT BOSS', 'NIFI', 'CAWA', 'BEERI', 'IVR', 'MEDIATION',
  'PROVISIONING LDAP', 'PROVISIONING TIBCO', 'PROVISIONING NAGRA',
  'PROVISIONING OTT', 'PROVISIONING TEL', 'REMEDY', 'ZOO', 'אחר',
];

const ROLES = ['EMPLOYEE', 'TEAM_LEAD', 'RELEASE_MANAGER', 'CR_MANAGER', 'ADMIN', 'VIEWER'];
const ROLE_LABELS: Record<string, string> = {
  EMPLOYEE: 'עובד', TEAM_LEAD: 'ראש צוות',
  RELEASE_MANAGER: 'מנהל לילה', CR_MANAGER: 'מנהל CR', ADMIN: 'מנהל מערכת', VIEWER: 'צופה',
};
const ROLE_COLORS: Record<string, string> = {
  EMPLOYEE:        C.statusOpen,
  TEAM_LEAD:       C.warning,
  RELEASE_MANAGER: C.statusWaiting,
  CR_MANAGER:      C.success,
  ADMIN:           C.statusBlocked,
  VIEWER:          C.textMuted,
};
const ROLE_BG: Record<string, string> = {
  EMPLOYEE:        C.bgOpen,
  TEAM_LEAD:       C.bgInProgress,
  RELEASE_MANAGER: C.bgWaiting,
  CR_MANAGER:      C.successBg,
  ADMIN:           C.bgBlocked,
  VIEWER:          C.bgRollback,
};

interface Props { token: string; }

const emptyUser = { fullName: '', email: '', password: '', phone: '', role: 'EMPLOYEE', teamId: '' };

const PERMISSION_DEFS = [
  // Screens
  { key: 'screen:prep',        label: 'מסך הכנה',           group: 'מסכים' },
  { key: 'screen:handoff',     label: 'מסך ביצוע',          group: 'מסכים' },
  { key: 'screen:timeline',    label: 'מסך ציר זמן',        group: 'מסכים' },
  { key: 'screen:night',       label: 'מסך לילה (חמ"ל)',    group: 'מסכים' },
  { key: 'screen:summary',     label: 'מסך סיכום',          group: 'מסכים' },
  { key: 'screen:admin',       label: 'מסך ניהול',          group: 'מסכים' },
  { key: 'screen:qa',          label: 'מסך בקרת איכות',     group: 'מסכים' },
  { key: 'screen:release-intelligence', label: 'מסך Release Intelligence', group: 'מסכים' },
  { key: 'screen:quality-hub',          label: 'מסך איכות גרסה (Quality Hub)', group: 'מסכים' },
  // Deployment actions
  { key: 'action:import',                  label: 'ייבוא Excel',                       group: 'פעולות — הטמעות' },
  { key: 'action:gonogo',                  label: 'GO / NO GO',                        group: 'פעולות — הטמעות' },
  { key: 'action:task_status',             label: 'שינוי סטטוס משימה',                group: 'פעולות — הטמעות' },
  { key: 'action:open_task_for_execution', label: 'פתיחת משימה לביצוע (מנהל לילה)',  group: 'פעולות — הטמעות' },
  { key: 'action:override_version_edit',   label: 'עריכת גרסה לאחר אישור (override)', group: 'פעולות — הטמעות' },
  { key: 'action:select_all_tasks',        label: 'בחר הכל משימות',                   group: 'פעולות — הטמעות' },
  // System management
  { key: 'action:user_manage',    label: 'ניהול משתמשים',        group: 'פעולות — ניהול' },
  { key: 'action:template_delete', label: 'מחיקת תבנית גרסה',   group: 'פעולות — ניהול' },
  // QA module
  { key: 'action:qa_leave_request', label: 'בקשת חופשה / צפייה בסטטוס',          group: 'בקרת איכות' },
  { key: 'action:qa_manage',        label: 'ניהול QA (שיבוץ / מועדים / דוחות)',   group: 'בקרת איכות' },
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
  const [tab, setTab]         = useState<'users' | 'teams' | 'permissions' | 'qc-releases' | 'qc-users' | 'params' | 'templates' | 'versions' | 'ldap' | 'oracle' | 'email' | 'notifications' | 'quality-hub'>('users');
  const { allPermissions, updateRole, saving: permSaving } = usePermissions();
  const [users, setUsers]     = useState<any[]>([]);
  const [teams, setTeams]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [qcReleases, setQcReleases]         = useState<QcRelease[]>([]);
  const [qcSyncing, setQcSyncing]           = useState(false);
  const [qcSyncResult, setQcSyncResult]     = useState<string | null>(null);

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

  // Full-version delete/archive/restore — moved here from VersionsView per
  // product decision: once a version has real work in QA/deployments/etc,
  // that day-to-day list shouldn't carry destructive whole-version actions.
  const [adminVersions, setAdminVersions]       = useState<any[]>([]);
  const [adminVersionsLoading, setAdminVersionsLoading] = useState(false);
  const [showArchivedVersions, setShowArchivedVersions] = useState(false);
  const [deletingVersionId, setDeletingVersionId] = useState<string | null>(null);
  const [versionActionError, setVersionActionError] = useState<string | null>(null);

  const [ldapTesting, setLdapTesting]         = useState(false);
  const [ldapTestResult, setLdapTestResult]   = useState<{ success: boolean; message: string } | null>(null);

  const [qhDefFile, setQhDefFile]             = useState<File | null>(null);
  const [qhScoresFile, setQhScoresFile]       = useState<File | null>(null);
  const [qhImporting, setQhImporting]         = useState<'definitions' | 'scores' | null>(null);
  const [qhResult, setQhResult]               = useState<{ target: 'definitions' | 'scores'; success: boolean; message: string } | null>(null);
  const [qhServerImporting, setQhServerImporting] = useState(false);
  const [qhServerResult, setQhServerResult]   = useState<{ success: boolean; message: string } | null>(null);

  const [emailTesting, setEmailTesting]       = useState(false);
  const [emailTestResult, setEmailTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [notifTesting, setNotifTesting]       = useState<'teams' | 'telegram' | null>(null);
  const [notifTestResult, setNotifTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});

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

  const [userSearch, setUserSearch]             = useState('');
  const [userRoleFilter, setUserRoleFilter]     = useState<string>('');
  const [userLetterFilter, setUserLetterFilter] = useState('');
  const [teamSearch, setTeamSearch]             = useState('');
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

  const fetchAdminVersions = async () => {
    setAdminVersionsLoading(true);
    try {
      const res = await axios.get(`${API}/versions`, { headers });
      setAdminVersions(res.data);
    } catch {
      setVersionActionError('שגיאה בטעינת גרסאות');
    } finally {
      setAdminVersionsLoading(false);
    }
  };

  const deleteAdminVersion = (id: string, name: string) => {
    setDialog({
      title: 'מחיקת גרסה',
      message: `למחוק את הגרסה "${name}" וכל הנתונים שלה לצמיתות — משימות, שיבוצי QA, תוכנית בדיקות, סיכונים, הכל?\nפעולה זו אינה הפיכה.`,
      confirmLabel: 'מחק',
      variant: 'danger',
      onConfirm: async () => {
        setDialog(null);
        setDeletingVersionId(id);
        setVersionActionError(null);
        try {
          await axios.delete(`${API}/versions/${id}`, { headers });
          await fetchAdminVersions();
        } catch (err: any) {
          setVersionActionError(`שגיאת מחיקה: ${err?.response?.data?.message || err?.message || 'שגיאה'}`);
        } finally { setDeletingVersionId(null); }
      },
      onCancel: () => setDialog(null),
    });
  };

  const archiveAdminVersion = (id: string) => {
    setDialog({
      title: 'העברה לארכיון',
      message: 'להעביר גרסה זו לארכיון? ניתן לשחזר בכל עת.',
      confirmLabel: 'העבר לארכיון',
      variant: 'warning',
      onConfirm: async () => {
        setDialog(null);
        setVersionActionError(null);
        try {
          await axios.patch(`${API}/versions/${id}/archive`, {}, { headers });
          await fetchAdminVersions();
        } catch (err: any) {
          setVersionActionError(`שגיאת ארכיון: ${err?.response?.data?.message || err?.message || 'שגיאה'}`);
        }
      },
      onCancel: () => setDialog(null),
    });
  };

  const restoreAdminVersion = (id: string) => {
    setDialog({
      title: 'שחזור גרסה',
      message: 'לשחזר גרסה זו מהארכיון? הסטטוס ישוחזר ל"מאושר".',
      confirmLabel: 'שחזר',
      variant: 'info',
      onConfirm: async () => {
        setDialog(null);
        setVersionActionError(null);
        try {
          await axios.patch(`${API}/versions/${id}/restore`, {}, { headers });
          await fetchAdminVersions();
        } catch (err: any) {
          setVersionActionError(`שגיאת שחזור: ${err?.response?.data?.message || err?.message || 'שגיאה'}`);
        }
      },
      onCancel: () => setDialog(null),
    });
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

  const testNotifChannel = async (channel: 'teams' | 'telegram') => {
    setNotifTesting(channel);
    setNotifTestResult(prev => ({ ...prev, [channel]: undefined as any }));
    try {
      const res = await axios.post(`${API}/notifications/test/${channel}`, {}, { headers });
      setNotifTestResult(prev => ({ ...prev, [channel]: res.data }));
    } catch (e: any) {
      setNotifTestResult(prev => ({ ...prev, [channel]: { ok: false, message: e?.response?.data?.message || e.message } }));
    } finally {
      setNotifTesting(null);
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

  const importQualityHubFile = async (target: 'definitions' | 'scores') => {
    const file = target === 'definitions' ? qhDefFile : qhScoresFile;
    if (!file) return;
    setQhImporting(target);
    setQhResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const endpoint = target === 'definitions' ? 'kpi-definitions' : 'kpi-scores';
      const res = await axios.post(`${API}/quality-hub/import/${endpoint}`, formData, {
        headers: { ...headers, 'Content-Type': 'multipart/form-data' },
      });
      if (res.data.success) {
        const msg = target === 'definitions'
          ? `יובאו בהצלחה — ${res.data.created} חדשים, ${res.data.updated} עודכנו`
          : `יובאו בהצלחה — ${res.data.created} חדשים, ${res.data.updated} עודכנו, ${res.data.releasesAffected} גרסאות`;
        setQhResult({ target, success: true, message: msg });
      } else {
        setQhResult({ target, success: false, message: res.data.message || 'שגיאה בייבוא' });
      }
    } catch (e: any) {
      setQhResult({ target, success: false, message: e?.response?.data?.message || 'שגיאה בייבוא הקובץ' });
    } finally {
      setQhImporting(null);
    }
  };

  const importQualityHubFromServer = async () => {
    setQhServerImporting(true);
    setQhServerResult(null);
    try {
      const res = await axios.post(`${API}/quality-hub/import/from-server`, {}, { headers });
      const { setup, scores } = res.data;
      const setupOk = !('error' in setup);
      const scoresOk = !('error' in scores);
      if (setupOk && scoresOk) {
        setQhServerResult({
          success: true,
          message: `יובא בהצלחה — הגדרות KPI: ${setup.created} חדשים/${setup.updated} עודכנו · ציוני גרסאות: ${scores.created} חדשים/${scores.updated} עודכנו (${scores.releasesAffected} גרסאות)`,
        });
      } else {
        const errs = [!setupOk && `הגדרות KPI: ${setup.error}`, !scoresOk && `ציוני גרסאות: ${scores.error}`].filter(Boolean).join(' · ');
        setQhServerResult({ success: false, message: errs });
      }
    } catch (e: any) {
      setQhServerResult({ success: false, message: e?.response?.data?.message || 'שגיאה בייבוא מהשרת' });
    } finally {
      setQhServerImporting(false);
    }
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

  const toggleTeamRequiresPlan = async (t: any) => {
    try {
      await axios.patch(`${API}/teams/${t.id}`, { requiresPlan: !t.requiresPlan }, { headers });
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
    borderRadius: '6px', fontSize: '15px', boxSizing: 'border-box',
    background: C.bgNested, color: C.textPrimary, fontFamily: FONT,
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '14px', color: C.textSecondary, marginBottom: '4px', fontWeight: 'bold',
  };

  const ADMIN_TABS = [
    { key: 'users',       label: 'משתמשים',     icon: '👤' },
    { key: 'teams',       label: 'צוותים',       icon: '👥' },
    { key: 'permissions', label: 'הרשאות',       icon: '🔐' },
    { key: 'qc-releases', label: 'גרסאות QC',    icon: '📋' },
    { key: 'qc-users',    label: 'סנכרון',       icon: '🔄' },
    { key: 'params',      label: 'פרמטרים',      icon: '⚙️' },
    { key: 'templates',   label: 'תבניות',        icon: '📁' },
    { key: 'versions',    label: 'ניהול גרסאות',  icon: '🗑️' },
    { key: 'ldap',          label: 'AD / LDAP',     icon: '🔒' },
    { key: 'oracle',        label: 'QC Oracle',     icon: '🗄️' },
    { key: 'email',         label: 'מייל',          icon: '📧' },
    { key: 'notifications', label: 'התראות',        icon: '🔔' },
    { key: 'quality-hub',   label: 'איכות גרסה',    icon: '🏆' },
  ] as const;

  return (
    <div style={{ direction: 'rtl', fontFamily: FONT }}>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />

      {/* Header */}
      <Card style={{ marginBottom: SP[5] }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SP[3], marginBottom: SP[4] }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: RADIUS.lg,
            background: C.brandDim, border: `1px solid rgba(56,139,253,0.30)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '18px',
          }}>⚙️</div>
          <div>
            <h2 style={{ margin: 0, ...TEXT['2xl'], fontWeight: WEIGHT.bold, color: C.textPrimary }}>
              ניהול מערכת
            </h2>
            <p style={{ margin: 0, ...TEXT.sm, color: C.textMuted, marginTop: '2px' }}>
              ניהול משתמשים, צוותים, הרשאות והגדרות מערכת
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: SP[1], flexWrap: 'wrap' }}>
          {ADMIN_TABS.map(t => {
            const isActive = tab === t.key;
            return (
              <button key={t.key} onClick={() => setTab(t.key as any)} style={{
                display: 'flex', alignItems: 'center', gap: SP[1],
                padding: '6px 14px',
                borderRadius: RADIUS.md, cursor: 'pointer', fontFamily: FONT,
                border: `1px solid ${isActive ? 'rgba(56,139,253,0.40)' : C.border}`,
                background: isActive
                  ? `linear-gradient(135deg, rgba(56,139,253,0.15), rgba(56,139,253,0.08))`
                  : C.bgNested,
                color: isActive ? C.brand : C.textSecondary,
                ...TEXT.sm, fontWeight: isActive ? WEIGHT.semibold : WEIGHT.normal,
                transition: EASE.fast,
                boxShadow: isActive ? `0 0 0 1px rgba(56,139,253,0.20)` : 'none',
              }}>
                <span style={{ fontSize: '14px' }}>{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </div>
      </Card>

      {error && (
        <Alert variant="danger" onClose={() => setError(null)} style={{ marginBottom: SP[4] }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Card style={{ textAlign: 'center', padding: SP[12] }}>
          <div style={{ ...TEXT.sm, color: C.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SP[2] }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 0.7s linear infinite' }}>
              <circle cx="12" cy="12" r="10" stroke={C.brand} strokeOpacity="0.20" strokeWidth="2.5" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke={C.brand} strokeWidth="2.5" strokeLinecap="round" />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </svg>
            טוען...
          </div>
        </Card>
      ) : (
        <>
          {/* ── USERS TAB ── */}
          {tab === 'users' && (
            <div>
              <div style={{ background: C.bgNested, borderRadius: '12px', padding: '14px 20px', marginBottom: '16px', border: `1px solid ${C.border}`, fontSize: '15px', color: C.textSecondary, lineHeight: '1.6' }}>
                <strong style={{ color: C.textPrimary, display: 'block', marginBottom: '6px' }}>ניהול משתמשים</strong>
                <ul style={{ margin: 0, paddingRight: '18px' }}>
                  <li>האימייל הוא המזהה הייחודי של המשתמש — לא ניתן לשינוי לאחר יצירה.</li>
                  <li>אם LDAP מופעל — הסיסמה המקומית אינה בשימוש; ההתחברות תעבור דרך AD. משתמשי ADMIN תמיד מתחברים עם סיסמה מקומית.</li>
                  <li>שיוך לצוות קובע אילו משימות יוצגו לעובד בתצוגת <strong>לוח</strong>.</li>
                  <li>ניתן לאפס סיסמה בלחיצה על "ערוך" ← שדה "סיסמה חדשה".</li>
                </ul>
              </div>
              {showUserForm && (
                <div style={{
                  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
                }} onClick={e => { if (e.target === e.currentTarget) { setShowUserForm(false); setEditingUser(null); setError(null); } }}>
                  <form onSubmit={saveUser} style={{
                    background: C.bgCard, borderRadius: '14px', padding: '28px 32px',
                    border: `2px solid ${C.brand}`, width: '100%', maxWidth: '560px',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                      <h3 style={{ margin: 0, color: C.textPrimary }}>
                        {editingUser ? `✏️ עריכת ${editingUser.fullName}` : '➕ משתמש חדש'}
                      </h3>
                      <button type="button" onClick={() => { setShowUserForm(false); setEditingUser(null); setError(null); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '22px', color: C.textMuted, lineHeight: 1 }}>×</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
                      <div>
                        <label style={labelStyle}>שם מלא *</label>
                        <input required style={inputStyle} value={userForm.fullName} autoFocus
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
                    {error && (
                      <div style={{ background: C.bgBlocked, border: `1px solid ${C.statusFailed}44`, borderRadius: '6px', padding: '8px 12px', marginBottom: '14px', fontSize: '15px', color: C.statusFailed }}>
                        ⚠️ {error}
                      </div>
                    )}
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
                </div>
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
                    <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: C.textMuted, fontSize: '16px', pointerEvents: 'none' }}>🔍</span>
                    <input
                      value={userSearch}
                      onChange={e => setUserSearch(e.target.value)}
                      placeholder="חיפוש לפי שם או אימייל..."
                      style={{ width: '100%', padding: '9px 34px 9px 12px', border: `1px solid ${C.border}`, borderRadius: '8px', fontSize: '15px', boxSizing: 'border-box', background: C.bgNested, color: C.textPrimary, fontFamily: FONT }}
                    />
                    {userSearch && (
                      <button onClick={() => setUserSearch('')} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '17px', lineHeight: 1 }}>✕</button>
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
                        cursor: 'pointer', fontSize: '15px', whiteSpace: 'nowrap', fontFamily: FONT,
                      }}>
                        {f.label}
                        <span style={{ marginRight: '5px', background: userRoleFilter === f.key ? (ROLE_COLORS[f.key] || C.brand) : C.bgHover, color: userRoleFilter === f.key ? 'white' : C.textMuted, borderRadius: '10px', padding: '1px 7px', fontSize: '13px' }}>
                          {f.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Letter filter A–Z */}
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '14px' }}>
                  {['הכל', 'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'].map(l => {
                    const val = l === 'הכל' ? '' : l;
                    const active = userLetterFilter === val;
                    return (
                      <button key={l} onClick={() => setUserLetterFilter(val)} style={{
                        padding: '3px 8px', borderRadius: '6px',
                        border: `1px solid ${active ? C.brand : C.border}`,
                        background: active ? C.brand + '22' : C.bgNested,
                        color: active ? C.brand : C.textMuted,
                        fontWeight: active ? 'bold' : 'normal',
                        cursor: 'pointer', fontSize: '14px', fontFamily: FONT, minWidth: '28px',
                      }}>{l}</button>
                    );
                  })}
                </div>

                {(() => {
                  const q = userSearch.trim().toLowerCase();
                  const filtered = users.filter(u => {
                    const matchRole   = !userRoleFilter   || u.role === userRoleFilter;
                    const matchSearch = !q               || u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
                    const matchLetter = !userLetterFilter || u.fullName.trimStart().toUpperCase().startsWith(userLetterFilter);
                    return matchRole && matchSearch && matchLetter;
                  });
                  return (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
                  <thead>
                    <tr style={{ background: C.bgNested }}>
                      {['שם', 'אימייל', 'תפקיד', 'צוות', 'סטטוס', 'פעולות'].map(h => (
                        <th key={h} style={{
                          padding: `${SP[2]} ${SP[3]}`, textAlign: 'right',
                          ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textMuted,
                          borderBottom: `1px solid ${C.borderEm}`, textTransform: 'uppercase', letterSpacing: '0.06em',
                          whiteSpace: 'nowrap',
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={6}><EmptyState icon="👤" title="לא נמצאו משתמשים" style={{ padding: SP[8] }} /></td></tr>
                    ) : filtered.map(u => (
                      <tr key={u.id} style={{ borderBottom: `1px solid ${C.border}`, opacity: u.active ? 1 : 0.45, transition: EASE.fast }}>
                        <td style={{ padding: `${SP[3]} ${SP[3]}` }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: SP[2] }}>
                            <Avatar name={u.fullName} size={28} />
                            <span style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{u.fullName}</span>
                          </div>
                        </td>
                        <td style={{ padding: `${SP[3]} ${SP[3]}`, ...TEXT.xs, color: C.textMuted, fontFamily: FONT_MONO }}>
                          {u.email}
                        </td>
                        <td style={{ padding: `${SP[3]} ${SP[3]}` }}>
                          <Badge color={ROLE_COLORS[u.role] ?? C.textMuted} bg={ROLE_BG[u.role] ?? C.bgActive}>
                            {ROLE_LABELS[u.role] || u.role}
                          </Badge>
                        </td>
                        <td style={{ padding: `${SP[3]} ${SP[3]}`, ...TEXT.xs, color: C.textSecondary }}>
                          {u.teamMemberships?.map((m: any) => m.team?.name).filter(Boolean).join(', ') || (
                            <span style={{ color: C.textDisabled }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: `${SP[3]} ${SP[3]}` }}>
                          <Badge
                            color={u.active ? C.success : C.statusFailed}
                            bg={u.active ? C.successBg : C.dangerBg}
                          >
                            {u.active ? '● פעיל' : '○ מושבת'}
                          </Badge>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={() => openEditUser(u)} title="עריכה"
                              style={{ padding: '5px 10px', background: '#3498db', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>
                              ✏️ ערוך
                            </button>
                            <button onClick={() => { setResetUserId(u.id); setNewPassword(''); }} title="איפוס סיסמה"
                              style={{ padding: '5px 10px', background: '#e67e22', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>
                              🔑
                            </button>
                            <button onClick={() => toggleActive(u)} title={u.active ? 'השבת' : 'הפעל'}
                              style={{ padding: '5px 10px', background: u.active ? C.statusFailed : C.statusDone, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>
                              {u.active ? '🚫' : '✅'}
                            </button>
                            <button onClick={() => deleteUser(u)} title="מחק משתמש"
                              style={{ padding: '5px 10px', background: '#7f1d1d', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>
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
              <div style={{ background: C.bgNested, borderRadius: '12px', padding: '14px 20px', marginBottom: '16px', border: `1px solid ${C.border}`, fontSize: '15px', color: C.textSecondary, lineHeight: '1.6' }}>
                <strong style={{ color: C.textPrimary, display: 'block', marginBottom: '6px' }}>ניהול צוותים</strong>
                <ul style={{ margin: 0, paddingRight: '18px' }}>
                  <li><strong>מערכות אחראיות</strong> — הגדר אילו מערכות הצוות מטפל בהן; משמש לסינון תצוגות ודוחות.</li>
                  <li><strong>דורש תוכנית CR</strong> (<code style={{ fontFamily: FONT_MONO }}>requiresPlan</code>) — כשמושבת, הצוות מוחרג מתצוגת כרטיסיות CR ולא חייב להגיש תוכנית. מתאים לצוותים שאינם משתתפים בתהליך CR.</li>
                  <li>ניתן להשבית צוות (כחול ← אפור) בלי למחוק — השבתה מסתירה אותו מרשימות.</li>
                </ul>
              </div>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <h3 style={{ margin: 0, color: C.textPrimary }}>צוותים ({teams.length})</h3>
                  <button onClick={() => setShowTeamForm(true)} style={{
                    padding: '8px 18px', background: C.brand, color: 'white',
                    border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontFamily: FONT,
                  }}>
                    + צוות חדש
                  </button>
                </div>

                {/* Team search */}
                <div style={{ position: 'relative', marginBottom: '16px' }}>
                  <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: C.textMuted, fontSize: '16px', pointerEvents: 'none' }}>🔍</span>
                  <input
                    value={teamSearch}
                    onChange={e => setTeamSearch(e.target.value)}
                    placeholder="חיפוש צוות לפי שם..."
                    style={{ width: '100%', padding: '8px 34px 8px 12px', border: `1px solid ${C.border}`, borderRadius: '8px', fontSize: '15px', boxSizing: 'border-box', background: C.bgNested, color: C.textPrimary, fontFamily: FONT }}
                  />
                  {teamSearch && (
                    <button onClick={() => setTeamSearch('')} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '17px', lineHeight: 1 }}>✕</button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '14px' }}>
                  {teams.filter(t => !teamSearch || t.name.toLowerCase().includes(teamSearch.trim().toLowerCase())).map(t => {
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
                                      fontSize: '14px', cursor: 'pointer',
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
                                cursor: savingEditTeam ? 'not-allowed' : 'pointer', fontSize: '15px', fontWeight: 'bold', fontFamily: FONT,
                              }}>
                                {savingEditTeam ? 'שומר...' : '✓ שמור'}
                              </button>
                              <button type="button" onClick={() => setEditingTeamId(null)} style={{
                                padding: '6px 14px', background: C.bgHover, color: C.textSecondary,
                                border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '15px', fontFamily: FONT,
                              }}>
                                ביטול
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <div style={{ marginBottom: '10px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: 'bold', fontSize: '16px', color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                                  {t.description && <div style={{ fontSize: '14px', color: C.textMuted, marginTop: '2px' }}>{cleanHtmlText(t.description)}</div>}
                                </div>
                                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>
                                  <button onClick={() => openEditTeam(t)} title="ערוך צוות"
                                    style={{ padding: '4px 8px', fontSize: '14px', border: 'none', borderRadius: '6px', background: '#3498db', color: 'white', cursor: 'pointer' }}>
                                    ✏️ ערוך
                                  </button>
                                  <button onClick={() => toggleTeamActive(t)} title={t.active ? 'השבת' : 'הפעל'}
                                    style={{ padding: '4px 8px', fontSize: '14px', border: 'none', borderRadius: '6px', background: t.active ? C.bgBlocked : C.bgDone, color: t.active ? C.statusFailed : C.statusDone, cursor: 'pointer' }}>
                                    {t.active ? 'השבת' : 'הפעל'}
                                  </button>
                                  <button onClick={() => deleteTeam(t)} title="מחק צוות"
                                    style={{ padding: '4px 8px', fontSize: '14px', border: 'none', borderRadius: '6px', background: C.statusFailed, color: 'white', cursor: 'pointer' }}>
                                    🗑️
                                  </button>
                                </div>
                              </div>
                              <button
                                onClick={() => toggleTeamRequiresPlan(t)}
                                title={t.requiresPlan !== false ? 'סמן כפטור מהגשת תוכנית' : 'חייב הגשת תוכנית'}
                                style={{ padding: '3px 10px', fontSize: '13px', border: `1px solid ${t.requiresPlan !== false ? '#2980b9' : '#94a3b8'}`, borderRadius: '6px', background: t.requiresPlan !== false ? 'rgba(41,128,185,0.12)' : 'rgba(148,163,184,0.12)', color: t.requiresPlan !== false ? '#2980b9' : '#64748b', cursor: 'pointer', fontFamily: FONT }}>
                                {t.requiresPlan !== false ? '📋 מגיש תוכנית' : '🚫 פטור מתוכנית'}
                              </button>
                            </div>
                            <div style={{ fontSize: '14px', color: C.textMuted, marginBottom: '8px' }}>
                              {members.length} חברים
                            </div>
                            {members.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: t.apps?.length ? '10px' : '0' }}>
                                {members.map(m => (
                                  <span key={m.id} style={{
                                    background: C.brandDim, color: C.textPrimary,
                                    padding: '2px 8px', borderRadius: '10px', fontSize: '14px',
                                  }}>
                                    {m.fullName}
                                  </span>
                                ))}
                              </div>
                            )}
                            {t.apps?.length > 0 && (
                              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: '8px', marginTop: members.length ? '0' : '4px' }}>
                                <div style={{ fontSize: '13px', color: C.textMuted, marginBottom: '4px' }}>מערכות אחראיות</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                  {(t.apps as string[]).map(a => (
                                    <span key={a} style={{
                                      background: C.bgDone, color: C.statusDone,
                                      padding: '2px 7px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold',
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
                    <p style={{ margin: 0, fontSize: '14px', color: C.textMuted }}>גרסאות מסונכרנות ממערכת QC. מוצגות ברשימת הגרסאות רק אם filterDate &gt; היום.</p>
                  </div>
                  <button onClick={syncQcReleases} disabled={qcSyncing} style={{
                    padding: '8px 18px', background: qcSyncing ? C.bgHover : C.brand, color: qcSyncing ? C.textDisabled : 'white',
                    border: 'none', borderRadius: '8px', cursor: qcSyncing ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontFamily: FONT,
                  }}>
                    {qcSyncing ? 'מסנכרן...' : '🔄 סנכרן מ-QC'}
                  </button>
                </div>

                {qcSyncResult && (
                  <div style={{ background: qcSyncResult.startsWith('✓') ? C.bgDone : C.bgBlocked, border: `1px solid ${qcSyncResult.startsWith('✓') ? C.statusDone : C.statusFailed}44`, borderRadius: '8px', padding: '10px 16px', marginBottom: '8px', fontSize: '15px', color: qcSyncResult.startsWith('✓') ? C.statusDone : C.statusFailed }}>
                    {qcSyncResult}
                  </div>
                )}

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
                            <th key={h} style={{ padding: '10px 12px', textAlign: 'right', fontSize: '14px', color: C.textSecondary, borderBottom: `2px solid ${C.border}`, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
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
                              <td style={{ padding: '8px 12px', fontSize: '15px', color: C.textMuted }}>{r.relId}</td>
                              <td style={{ padding: '8px 12px', fontSize: '15px', fontWeight: 'bold', color: C.textPrimary }}>{r.relName}</td>
                              <td style={{ padding: '8px 12px', fontSize: '14px', color: C.textSecondary }}>{r.relTeam || '—'}</td>
                              <td style={{ padding: '8px 12px', fontSize: '14px', color: C.textSecondary }}>
                                {r.goLiveDate ? new Date(r.goLiveDate).toLocaleDateString('he-IL') : '—'}
                              </td>
                              <td style={{ padding: '8px 12px', fontSize: '14px', color: C.textSecondary }}>
                                {r.rehearsalDate ? new Date(r.rehearsalDate).toLocaleDateString('he-IL') : '—'}
                              </td>
                              <td style={{ padding: '8px 12px', fontSize: '14px' }}>
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
                                  padding: '2px 8px', borderRadius: '10px', fontSize: '14px', fontWeight: 'bold',
                                }}>
                                  {r.active ? 'פעיל' : 'מושבת'}
                                </span>
                              </td>
                              <td style={{ padding: '8px 12px' }}>
                                <button onClick={() => toggleQcRelease(r.id)} style={{
                                  padding: '4px 10px', fontSize: '14px', border: 'none', borderRadius: '6px',
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

              <div style={{ background: C.bgNested, borderRadius: '12px', padding: '16px 20px', marginTop: '16px', border: `1px solid ${C.border}`, fontSize: '15px', color: C.textSecondary, lineHeight: '1.7' }}>
                <strong style={{ color: C.textPrimary, display: 'block', marginBottom: '8px' }}>🔌 שיטות סנכרון גרסאות QC</strong>
                <ul style={{ margin: 0, paddingRight: '20px' }}>
                  <li><strong>מ-Oracle QC (מומלץ לסביבת ייצור)</strong> — יש להפעיל בלשונית <strong>"QC Oracle"</strong> (לא ב-.env!):
                    <ul style={{ marginTop: '4px' }}>
                      <li><code style={{ fontFamily: FONT_MONO }}>ORACLE_ENABLED</code> — יש לערוך בלשונית "QC Oracle" ולהזין <code style={{ fontFamily: FONT_MONO }}>true</code>. הגדרת משתנה סביבה בשם זה ב-.env <strong>לא</strong> משפיעה — הערך נקרא אך ורק מהפרמטר השמור במסד הנתונים.</li>
                      <li><code style={{ fontFamily: FONT_MONO }}>ORACLE_USER</code>, <code style={{ fontFamily: FONT_MONO }}>ORACLE_PASSWORD</code>, <code style={{ fontFamily: FONT_MONO }}>ORACLE_CONNECT_STRING</code> — ניתן להגדיר גם כאן בלשונית זו וגם כמשתני סביבה ב-.env (לדוגמה: <code style={{ fontFamily: FONT_MONO }}>qcdb01:1521/QCPROD</code>).</li>
                    </ul>
                  </li>
                  <li>גרסאות QC מסונכרנות אך ורק מ-Oracle — שמות ו-ID של גרסה אינם נטענים עוד מקובץ Excel.</li>
                  <li>גרסאות שתאריך הסינון שלהן (filterDate) עבר — לא יוצגו אוטומטית ברשימת הגרסאות. ניתן לשנות זאת ידנית בכל גרסה.</li>
                </ul>
                <div style={{ marginTop: '10px', padding: '8px 12px', borderRadius: '6px', background: '#2a1e0a', border: '1px solid #e67e2244', fontSize: '14px', color: '#e67e22', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <span>🔒</span>
                  <span><strong>Firewall נדרש:</strong> Outbound TCP <strong>1521</strong> משרת האפליקציה → שרת Oracle QC (כתובת ה-ORACLE_CONNECT_STRING). נדרש רק כשמשתמשים בסנכרון מ-Oracle (לא Excel).</span>
                </div>
              </div>
            </div>
          )}

          {/* ── QC USERS SYNC TAB ── */}
          {tab === 'qc-users' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: C.bgNested, borderRadius: '12px', padding: '16px 20px', border: `1px solid ${C.border}`, fontSize: '15px', color: C.textSecondary, lineHeight: '1.7' }}>
                <strong style={{ color: C.textPrimary, display: 'block', marginBottom: '6px' }}>מה עושה הסנכרון?</strong>
                <ul style={{ margin: 0, paddingRight: '20px' }}>
                  <li>שולף את רשימת המשתמשים הפעילים ממערכת QC דרך Oracle.</li>
                  <li>יוצר חשבונות חדשים למשתמשים שאינם קיימים עם סיסמת ברירת מחדל <code style={{ fontFamily: FONT_MONO }}>123456</code>.</li>
                  <li>משתמשים שלא מופיעים ב-QC — יושבתו (לא יימחקו).</li>
                  <li>חשבונות <strong>ADMIN</strong> לא נפגעים בשום תרחיש.</li>
                  <li><strong>נדרש:</strong> <code style={{ fontFamily: FONT_MONO }}>ORACLE_ENABLED</code> מופעל בלשונית <strong>"QC Oracle"</strong> (לא כמשתנה סביבה — ראה שם).</li>
                </ul>
                <div style={{ marginTop: '10px', padding: '8px 12px', borderRadius: '6px', background: '#2a1e0a', border: '1px solid #e67e2244', fontSize: '14px', color: '#e67e22', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <span>🔒</span>
                  <span><strong>Firewall נדרש:</strong> Outbound TCP <strong>1521</strong> משרת האפליקציה → שרת Oracle QC.</span>
                </div>
              </div>
              <div>
              <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px', border: `1px solid ${C.border}` }}>
                <h3 style={{ margin: '0 0 8px', color: C.textPrimary }}>🔄 סנכרון משתמשים מ-QC</h3>
                <p style={{ margin: '0 0 20px', fontSize: '15px', color: C.textSecondary }}>
                  פעולה זו תסנכרן את רשימת המשתמשים מול רשימת משתמשי QC (137 משתמשים).<br />
                  משתמשים שאינם ברשימת QC יושבתו. מנהלי מערכת (ADMIN) לא יושפעו.<br />
                  סיסמת ברירת מחדל למשתמשים חדשים: <code style={{ background: C.bgNested, padding: '1px 5px', borderRadius: '3px', fontFamily: FONT_MONO }}>123456</code>
                </p>
                <button onClick={syncQcUsers} disabled={userSyncing} style={{
                  padding: '12px 28px', background: userSyncing ? C.bgHover : C.statusFailed, color: userSyncing ? C.textDisabled : 'white',
                  border: 'none', borderRadius: '8px', cursor: userSyncing ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold', fontSize: '16px', fontFamily: FONT,
                }}>
                  {userSyncing ? 'מסנכרן...' : '🔄 סנכרן משתמשים'}
                </button>
                {userSyncResult && (
                  <div style={{ marginTop: '16px', background: userSyncResult.startsWith('✓') ? C.bgDone : C.bgBlocked, border: `1px solid ${userSyncResult.startsWith('✓') ? C.statusDone : C.statusFailed}44`, borderRadius: '8px', padding: '12px 16px', fontSize: '15px', color: userSyncResult.startsWith('✓') ? C.statusDone : C.statusFailed, fontWeight: 'bold' }}>
                    {userSyncResult}
                  </div>
                )}
              </div>
              </div>
            </div>
          )}

          {/* ── PERMISSIONS TAB ── */}
          {tab === 'permissions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: C.bgNested, borderRadius: '12px', padding: '16px 20px', border: `1px solid ${C.border}`, fontSize: '15px', color: C.textSecondary, lineHeight: '1.7' }}>
                <strong style={{ color: C.textPrimary, display: 'block', marginBottom: '8px' }}>תפקידים במערכת</strong>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
                  {[
                    { role: 'ADMIN', label: 'מנהל מערכת', desc: 'גישה מלאה לכל הפונקציות. יכול לנהל משתמשים, תפקידים ופרמטרים.' },
                    { role: 'RELEASE_MANAGER', label: 'מנהל הטמעות', desc: 'ניהול גרסאות ותוכניות לילה — יצירה, עדכון, קבלת החלטת GO/NO-GO.' },
                    { role: 'CR_MANAGER', label: 'מנהל CR', desc: 'ניהול תוכניות CR — אישור ועדכון תוכניות צוותים.' },
                    { role: 'TEAM_LEAD', label: 'ראש צוות', desc: 'הגשת תוכנית צוות, עדכון סטטוס משימות, אישור CR.' },
                    { role: 'DEVELOPER', label: 'מפתח', desc: 'גישה לתצוגת משימות ועדכון סטטוס אישי.' },
                    { role: 'VIEWER', label: 'צופה', desc: 'קריאה בלבד — אין יכולת עדכון.' },
                  ].map(r => (
                    <div key={r.role} style={{ background: C.bgCard, borderRadius: '8px', padding: '10px 14px', border: `1px solid ${C.border}` }}>
                      <div style={{ fontWeight: 'bold', fontSize: '15px', color: C.textPrimary }}>{r.label}</div>
                      <div style={{ fontSize: '13px', color: C.brand, fontFamily: FONT_MONO, marginBottom: '4px' }}>{r.role}</div>
                      <div style={{ fontSize: '14px', color: C.textMuted }}>{r.desc}</div>
                    </div>
                  ))}
                </div>
                <p style={{ margin: '10px 0 0', fontSize: '14px', color: C.textMuted }}>
                  מטריצת ההרשאות מאפשרת לשנות אילו פעולות כל תפקיד יכול לבצע. לחץ על תא כדי להפעיל/לכבות הרשאה, ואז "שמור" לשורת התפקיד.
                </p>
              </div>
              <PermissionsTab allPermissions={allPermissions} updateRole={updateRole} saving={permSaving} />
            </div>
          )}

          {/* ── TEMPLATES TAB ── */}
          {tab === 'templates' && (() => {
            if (!templates.length && !templatesLoading) fetchTemplates();
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: C.bgNested, borderRadius: '12px', padding: '16px 20px', border: `1px solid ${C.border}`, fontSize: '15px', color: C.textSecondary, lineHeight: '1.7' }}>
                <strong style={{ color: C.textPrimary, display: 'block', marginBottom: '6px' }}>מהן תבניות גרסה?</strong>
                <p style={{ margin: 0 }}>
                  תבנית היא "צילום" של תוכנית לילה קיימת — שלבים, משימות, שיוכי צוות — שניתן להשתמש בה ליצירת גרסאות עתידיות.
                  ליצירת תבנית: פתח גרסה קיימת ← לחץ <strong>שמור כתבנית</strong>. בעת יצירת גרסה חדשה בחר "מתבנית" ותקבל את כל המשימות מוכנות לעריכה.
                  ניתן לנהל כאן ולמחוק תבניות ישנות.
                </p>
              </div>
              <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px', border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px', color: C.textPrimary }}>📁 תבניות גרסה ({templates.length})</h3>
                    <p style={{ margin: 0, fontSize: '15px', color: C.textMuted }}>תבניות שמורות ליצירת גרסאות עתידיות</p>
                  </div>
                  <button onClick={fetchTemplates} disabled={templatesLoading}
                    style={{ padding: '8px 16px', background: C.bgHover, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '15px', color: C.textSecondary, fontFamily: FONT }}>
                    {templatesLoading ? '...' : '🔄 רענן'}
                  </button>
                </div>
                {templateError && (
                  <div style={{ background: C.bgBlocked, border: `1px solid ${C.statusFailed}44`, borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '15px', color: C.statusFailed }}>
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
                          <div style={{ fontWeight: 'bold', fontSize: '16px', color: C.textPrimary }}>{t.name}</div>
                          {t.description && <div style={{ fontSize: '14px', color: C.textMuted, marginTop: '2px' }}>{cleanHtmlText(t.description)}</div>}
                          <div style={{ fontSize: '13px', color: C.textMuted, marginTop: '4px' }}>
                            נוצר ע"י {t.creator?.fullName ?? '—'} · {t.createdAt ? new Date(t.createdAt).toLocaleDateString('he-IL') : ''}
                          </div>
                        </div>
                        <button
                          disabled={deletingTemplateId === t.id}
                          onClick={() => deleteTemplate(t.id)}
                          style={{ padding: '7px 16px', background: deletingTemplateId === t.id ? C.bgHover : C.statusFailed, color: deletingTemplateId === t.id ? C.textDisabled : 'white', border: 'none', borderRadius: '8px', cursor: deletingTemplateId === t.id ? 'not-allowed' : 'pointer', fontSize: '15px', whiteSpace: 'nowrap', fontFamily: FONT }}
                        >
                          {deletingTemplateId === t.id ? 'מוחק...' : '🗑 מחק'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </div>
            );
          })()}

          {/* ── VERSIONS TAB — full-version delete/archive/restore, moved here
               from the day-to-day versions list (VersionsView) so a manager
               working the active list can't accidentally nuke a version that
               already has real QA/deployment work in it. ── */}
          {tab === 'versions' && (() => {
            if (!adminVersions.length && !adminVersionsLoading) fetchAdminVersions();
            const active = adminVersions.filter((v: any) => !v.isArchived);
            const archived = adminVersions.filter((v: any) => v.isArchived);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ background: C.bgNested, borderRadius: '12px', padding: '16px 20px', border: `1px solid ${C.border}`, fontSize: '15px', color: C.textSecondary, lineHeight: '1.7' }}>
                  <strong style={{ color: C.textPrimary, display: 'block', marginBottom: '6px' }}>⚠️ פעולות בלתי הפיכות</strong>
                  <p style={{ margin: 0 }}>
                    מחיקת גרסה מוחקת <strong>לצמיתות</strong> את כל הנתונים שלה — תוכנית הטמעה, שיבוצי QA, תוכנית בדיקות, סיכונים, הכל.
                    להסרה זמנית/הפיכה, השתמשו בהעברה לארכיון במקום.
                  </p>
                </div>
                <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px', border: `1px solid ${C.border}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <h3 style={{ margin: 0, color: C.textPrimary }}>🗑️ ניהול גרסאות ({active.length})</h3>
                      <button
                        onClick={() => setShowArchivedVersions(v => !v)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 12px',
                          background: showArchivedVersions ? C.bgActive : C.bgNested,
                          color: showArchivedVersions ? C.textPrimary : C.textMuted,
                          border: `1px solid ${showArchivedVersions ? C.borderEm : C.border}`,
                          borderRadius: RADIUS.full, cursor: 'pointer', fontSize: '13px', fontWeight: 600, fontFamily: FONT,
                        }}
                      >
                        📦 ארכיון ({archived.length})
                      </button>
                    </div>
                    <button onClick={fetchAdminVersions} disabled={adminVersionsLoading}
                      style={{ padding: '8px 16px', background: C.bgHover, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '15px', color: C.textSecondary, fontFamily: FONT }}>
                      {adminVersionsLoading ? '...' : '🔄 רענן'}
                    </button>
                  </div>
                  {versionActionError && (
                    <div style={{ background: C.bgBlocked, border: `1px solid ${C.statusFailed}44`, borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '15px', color: C.statusFailed }}>
                      ⚠️ {versionActionError}
                      <button onClick={() => setVersionActionError(null)} style={{ marginRight: '8px', background: 'none', border: 'none', cursor: 'pointer', color: C.statusFailed, fontWeight: 'bold' }}>×</button>
                    </div>
                  )}
                  {adminVersionsLoading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>טוען גרסאות...</div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {active.map((v: any) => (
                          <VersionCard
                            key={v.id}
                            v={v}
                            isDeleting={deletingVersionId === v.id}
                            onOpen={() => {}}
                            onDelete={(e) => { e.stopPropagation(); deleteAdminVersion(v.id, v.name); }}
                            onArchive={(e) => { e.stopPropagation(); archiveAdminVersion(v.id); }}
                          />
                        ))}
                      </div>
                      {showArchivedVersions && (
                        <div style={{ marginTop: '20px' }}>
                          <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textMuted, marginBottom: '10px' }}>📦 ארכיון — ניתן לשחזר</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', opacity: 0.85 }}>
                            {archived.length === 0 ? (
                              <div style={{ textAlign: 'center', padding: '30px', color: C.textMuted, background: C.bgNested, borderRadius: '12px', border: `1px solid ${C.border}` }}>
                                אין גרסאות בארכיון
                              </div>
                            ) : archived.map((v: any) => (
                              <VersionCard
                                key={v.id}
                                v={v}
                                isDeleting={deletingVersionId === v.id}
                                onOpen={() => {}}
                                onDelete={(e) => { e.stopPropagation(); deleteAdminVersion(v.id, v.name); }}
                                onRestore={(e) => { e.stopPropagation(); restoreAdminVersion(v.id); }}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
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
                      <p style={{ margin: 0, fontSize: '15px', color: C.textMuted }}>
                        כשמופעל — משתמשים מתחברים עם שם משתמש AD. חשבונות המנהל הטכני משתמשים תמיד בהתחברות מקומית.
                      </p>
                    </div>
                    <span style={{
                      padding: '6px 18px', borderRadius: '20px', fontSize: '15px', fontWeight: 'bold',
                      background: isEnabled ? C.bgDone : C.bgHover,
                      color: isEnabled ? C.statusDone : C.textMuted,
                    }}>
                      {isEnabled ? 'מופעל' : 'מושבת'}
                    </span>
                  </div>
                </div>

                <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px', border: `1px solid ${C.border}` }}>
                  <h3 style={{ margin: '0 0 6px', color: C.textPrimary }}>הגדרות חיבור</h3>
                  <p style={{ margin: '0 0 20px', fontSize: '15px', color: C.textMuted }}>
                    שנה ערך → לחץ Enter לשמירה מיידית
                  </p>
                  {paramError && (
                    <div style={{ background: C.bgBlocked, border: `1px solid ${C.statusFailed}44`, borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '15px', color: C.statusFailed }}>
                      ⚠️ {paramError}
                    </div>
                  )}
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: C.bgNested }}>
                        {['תיאור', 'מפתח', 'ערך', 'פעולות'].map(h => (
                          <th key={h} style={{ padding: '10px 14px', textAlign: 'right', fontSize: '14px', color: C.textSecondary, fontWeight: 'bold', border: `1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ldapParams.length === 0 ? (
                        <tr><td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: C.textMuted, fontSize: '15px' }}>טוען הגדרות LDAP...</td></tr>
                      ) : ldapParams.map(p => (
                        <tr key={p.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '12px 14px', fontSize: '15px', fontWeight: 'bold', color: C.textPrimary, border: `1px solid ${C.border}` }}>
                            {p.label.replace(/^LDAP[^:]*: /, '')}
                          </td>
                          <td style={{ padding: '12px 14px', fontFamily: FONT_MONO, fontSize: '13px', color: C.textMuted, border: `1px solid ${C.border}` }}>{p.key}</td>
                          <td style={{ padding: '12px 14px', border: `1px solid ${C.border}`, minWidth: '240px' }}>
                            {editingParam === p.key ? (
                              <input
                                autoFocus
                                type={p.type === 'password' ? 'password' : 'text'}
                                value={paramValue}
                                onChange={e => setParamValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveParam(p.key); if (e.key === 'Escape') setEditingParam(null); }}
                                style={{ width: '100%', padding: '6px 10px', border: `2px solid ${C.brand}`, borderRadius: '6px', fontSize: '15px', boxSizing: 'border-box', direction: 'ltr', background: C.bgNested, color: C.textPrimary, fontFamily: FONT_MONO }}
                              />
                            ) : (
                              <span style={{ fontSize: '15px', color: p.value ? C.textPrimary : C.textMuted, fontStyle: p.value ? 'normal' : 'italic', direction: 'ltr', display: 'inline-block', fontFamily: p.value ? FONT_MONO : FONT }}>
                                {p.type === 'password' && p.value ? '••••••••' : (p.value || 'לא הוגדר')}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '10px 14px', border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                            {editingParam === p.key ? (
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={() => saveParam(p.key)} disabled={savingParam}
                                  style={{ padding: '5px 14px', background: savingParam ? C.bgHover : C.statusDone, color: savingParam ? C.textDisabled : 'white', border: 'none', borderRadius: '6px', cursor: savingParam ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 'bold', fontFamily: FONT }}>
                                  {savingParam ? '...' : 'שמור'}
                                </button>
                                <button onClick={() => { setEditingParam(null); setParamError(null); }}
                                  style={{ padding: '5px 12px', background: C.bgHover, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontFamily: FONT }}>
                                  ביטול
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => { setEditingParam(p.key); setParamValue(p.value); setParamError(null); }}
                                style={{ padding: '5px 14px', background: C.brand, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontFamily: FONT }}>
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
                  <p style={{ margin: '0 0 16px', fontSize: '15px', color: C.textMuted }}>
                    בודק את החיבור לשרת LDAP ואת חשבון השירות (Bind DN). לא מאמת משתמש ספציפי.
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <button
                      onClick={testLdap}
                      disabled={ldapTesting}
                      style={{
                        padding: '9px 22px', background: ldapTesting ? C.bgHover : C.brand,
                        color: ldapTesting ? C.textDisabled : 'white', border: 'none', borderRadius: '8px',
                        cursor: ldapTesting ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '15px', fontFamily: FONT,
                      }}
                    >
                      {ldapTesting ? 'בודק...' : '🔌 בדוק חיבור'}
                    </button>
                    {ldapTestResult && (
                      <div style={{
                        padding: '8px 16px', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold',
                        background: ldapTestResult.success ? C.bgDone : C.bgBlocked,
                        color: ldapTestResult.success ? C.statusDone : C.statusFailed,
                      }}>
                        {ldapTestResult.success ? '✓' : '✕'} {ldapTestResult.message}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ background: C.bgNested, borderRadius: '12px', padding: '20px', border: `1px solid ${C.border}`, fontSize: '15px', color: C.textSecondary, lineHeight: '1.7' }}>
                  <strong style={{ color: C.textPrimary, display: 'block', marginBottom: '8px' }}>כיצד ההתחברות פועלת:</strong>
                  <ul style={{ margin: 0, paddingRight: '20px' }}>
                    <li>כשה-LDAP מופעל, המשתמשים מזינים את <strong>שם המשתמש ב-AD</strong> (לא אימייל) ואת הסיסמה שלהם.</li>
                    <li>המערכת מאמתת מול Active Directory ומביאה את כתובת האימייל של המשתמש.</li>
                    <li>המשתמש חייב להיות <strong>מוגדר מראש</strong> במערכת (לשוניות "משתמשים") עם אותה כתובת אימייל.</li>
                    <li>חשבונות <code style={{ background: C.bgCard, padding: '1px 5px', borderRadius: '3px', fontFamily: FONT_MONO }}>nissim@test.com</code> ודומיהם תמיד משתמשים בהתחברות מקומית.</li>
                  </ul>
                  <div style={{ marginTop: '12px', background: '#fff8e1', borderRadius: '8px', padding: '12px 16px', border: '1px solid #ffe082' }}>
                    <strong style={{ color: '#795548', display: 'block', marginBottom: '8px', fontSize: '15px' }}>🔥 דרישות Firewall</strong>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                      <thead>
                        <tr style={{ background: '#fff3e0' }}>
                          {['כיוון', 'מקור', 'יעד', 'פורט / פרוטוקול', 'מטרה'].map(h => (
                            <th key={h} style={{ padding: '6px 10px', textAlign: 'right', color: '#5d4037', fontWeight: 'bold', border: '1px solid #ffcc80' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { dir: 'יוצא ←', src: 'שרת DeployCenter (Backend)', dst: 'שרת Active Directory', port: 'TCP 636 (LDAPS) / 389 (LDAP)', purpose: 'אימות משתמשים מול AD' },
                        ].map((r, i) => (
                          <tr key={i}>
                            <td style={{ padding: '6px 10px', border: '1px solid #ffcc80', fontWeight: 'bold', color: '#e65100', whiteSpace: 'nowrap' }}>{r.dir}</td>
                            <td style={{ padding: '6px 10px', border: '1px solid #ffcc80', fontFamily: FONT_MONO, fontSize: '13px' }}>{r.src}</td>
                            <td style={{ padding: '6px 10px', border: '1px solid #ffcc80', fontFamily: FONT_MONO, fontSize: '13px' }}>{r.dst}</td>
                            <td style={{ padding: '6px 10px', border: '1px solid #ffcc80', fontWeight: 'bold', whiteSpace: 'nowrap', fontFamily: FONT_MONO }}>{r.port}</td>
                            <td style={{ padding: '6px 10px', border: '1px solid #ffcc80', color: '#555' }}>{r.purpose}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── ORACLE QC TAB ── */}
          {tab === 'oracle' && (() => {
            const oracleParams = systemParams.filter(p => p.key.startsWith('ORACLE_'));
            const isEnabled = oracleParams.find(p => p.key === 'ORACLE_ENABLED')?.value === 'true';
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                {/* Status */}
                <div style={{
                  background: C.bgCard, borderRadius: '12px', padding: '24px',
                  border: `1px solid ${C.border}`,
                  borderRight: `4px solid ${isEnabled ? C.statusDone : C.border}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                      <h3 style={{ margin: '0 0 4px', color: C.textPrimary }}>🗄️ חיבור Oracle — HP ALM QC</h3>
                      <p style={{ margin: 0, fontSize: '15px', color: C.textMuted }}>
                        כשמופעל — נתוני כיסוי הבדיקות והתקלות נשלפים ישירות מבסיס הנתונים של QC (Oracle).
                        כשמושבת — מוצגים נתוני Mock לצורך פיתוח ובדיקות.
                      </p>
                    </div>
                    <span style={{
                      padding: '6px 18px', borderRadius: '20px', fontSize: '15px', fontWeight: 'bold',
                      background: isEnabled ? C.bgDone : C.bgHover,
                      color: isEnabled ? C.statusDone : C.textMuted,
                    }}>
                      {isEnabled ? '✓ מחובר' : 'Mock'}
                    </span>
                  </div>
                </div>

                {/* Settings */}
                <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px', border: `1px solid ${C.border}` }}>
                  <h3 style={{ margin: '0 0 6px', color: C.textPrimary }}>הגדרות חיבור</h3>
                  <p style={{ margin: '0 0 20px', fontSize: '15px', color: C.textMuted }}>
                    שנה ערך → לחץ Enter לשמירה מיידית. שינויים נכנסים לתוקף בקריאה הבאה (ללא restart).
                  </p>
                  {paramError && (
                    <div style={{ background: C.bgBlocked, border: `1px solid ${C.statusFailed}44`, borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '15px', color: C.statusFailed }}>
                      ⚠️ {paramError}
                    </div>
                  )}
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: C.bgNested }}>
                        {['תיאור', 'מפתח', 'ערך', 'פעולות'].map(h => (
                          <th key={h} style={{ padding: '10px 14px', textAlign: 'right', fontSize: '14px', color: C.textSecondary, fontWeight: 'bold', border: `1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {oracleParams.length === 0 ? (
                        <tr><td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: C.textMuted, fontSize: '15px' }}>טוען הגדרות Oracle...</td></tr>
                      ) : oracleParams.map(p => (
                        <tr key={p.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '12px 14px', fontSize: '15px', fontWeight: 'bold', color: C.textPrimary, border: `1px solid ${C.border}` }}>
                            {p.label.replace(/^QC Oracle: /, '')}
                          </td>
                          <td style={{ padding: '12px 14px', fontFamily: FONT_MONO, fontSize: '13px', color: C.textMuted, border: `1px solid ${C.border}` }}>{p.key}</td>
                          <td style={{ padding: '12px 14px', border: `1px solid ${C.border}`, minWidth: '240px' }}>
                            {editingParam === p.key ? (
                              <input
                                autoFocus
                                type={p.type === 'password' ? 'password' : 'text'}
                                value={paramValue}
                                onChange={e => setParamValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveParam(p.key); if (e.key === 'Escape') setEditingParam(null); }}
                                style={{ width: '100%', padding: '6px 10px', border: `2px solid ${C.brand}`, borderRadius: '6px', fontSize: '15px', boxSizing: 'border-box', direction: 'ltr', background: C.bgNested, color: C.textPrimary, fontFamily: FONT_MONO }}
                              />
                            ) : (
                              <span style={{ fontSize: '15px', color: p.value ? C.textPrimary : C.textMuted, fontStyle: p.value ? 'normal' : 'italic', direction: 'ltr', display: 'inline-block', fontFamily: p.value ? FONT_MONO : FONT }}>
                                {p.type === 'password' && p.value ? '••••••••' : (p.value || 'לא הוגדר')}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '10px 14px', border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                            {editingParam === p.key ? (
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={() => saveParam(p.key)} disabled={savingParam}
                                  style={{ padding: '5px 14px', background: savingParam ? C.bgHover : C.statusDone, color: savingParam ? C.textDisabled : 'white', border: 'none', borderRadius: '6px', cursor: savingParam ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 'bold', fontFamily: FONT }}>
                                  {savingParam ? '...' : 'שמור'}
                                </button>
                                <button onClick={() => { setEditingParam(null); setParamError(null); }}
                                  style={{ padding: '5px 12px', background: C.bgHover, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontFamily: FONT }}>
                                  ביטול
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => { setEditingParam(p.key); setParamValue(p.value); setParamError(null); }}
                                style={{ padding: '5px 14px', background: C.brand, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontFamily: FONT }}>
                                ✏️ ערוך
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Firewall requirements */}
                <div style={{ background: '#fff8e1', borderRadius: '12px', padding: '20px 24px', border: '1px solid #ffe082' }}>
                  <strong style={{ color: '#795548', display: 'block', marginBottom: '10px', fontSize: '15px' }}>
                    🔥 דרישות Firewall — מה נדרש לפתוח
                  </strong>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px' }}>
                    <thead>
                      <tr style={{ background: '#fff3e0' }}>
                        {['כיוון', 'מקור', 'יעד', 'פורט / פרוטוקול', 'מטרה'].map(h => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: 'right', color: '#5d4037', fontWeight: 'bold', border: '1px solid #ffcc80' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { dir: 'יוצא ←', src: 'שרת DeployCenter (Backend)', dst: 'שרת Oracle / QC DB', port: 'TCP 1521', purpose: 'חיבור JDBC/Oracle Net לבסיס הנתונים של QC' },
                      ].map((r, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fff8e1' }}>
                          <td style={{ padding: '8px 12px', border: '1px solid #ffcc80', fontWeight: 'bold', color: '#e65100', whiteSpace: 'nowrap' }}>{r.dir}</td>
                          <td style={{ padding: '8px 12px', border: '1px solid #ffcc80', fontFamily: FONT_MONO, fontSize: '14px' }}>{r.src}</td>
                          <td style={{ padding: '8px 12px', border: '1px solid #ffcc80', fontFamily: FONT_MONO, fontSize: '14px' }}>{r.dst}</td>
                          <td style={{ padding: '8px 12px', border: '1px solid #ffcc80', fontWeight: 'bold', whiteSpace: 'nowrap', fontFamily: FONT_MONO }}>{r.port}</td>
                          <td style={{ padding: '8px 12px', border: '1px solid #ffcc80', color: '#555' }}>{r.purpose}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <ul style={{ margin: '14px 0 0', paddingRight: '20px', color: '#6d4c41', lineHeight: '1.8', fontSize: '15px' }}>
                    <li><strong>Connect String:</strong> הפורמט הוא <code style={{ background: '#fff3e0', padding: '1px 6px', borderRadius: '4px', fontFamily: FONT_MONO }}>host:1521/service_name</code> — לדוגמה: <code style={{ background: '#fff3e0', padding: '1px 6px', borderRadius: '4px', fontFamily: FONT_MONO }}>qc-oracle.company.local:1521/ALMDB</code></li>
                    <li><strong>Oracle Instant Client:</strong> חייב להיות מותקן על שרת ה-Backend. גרסה מומלצת: 21c Basic Light.</li>
                    <li><strong>משתמש DB:</strong> נדרשת הרשאת <code style={{ background: '#fff3e0', padding: '1px 6px', borderRadius: '4px', fontFamily: FONT_MONO }}>SELECT</code> על הטבלאות <code style={{ background: '#fff3e0', padding: '1px 6px', borderRadius: '4px', fontFamily: FONT_MONO }}>TEST, REQ, REQ_COVER, REQ_RELEASES, REQ_CYCLES, RELEASES, ALL_LISTS, REQ_TYPE, BUG</code></li>
                    <li><strong>Schema:</strong> אם הטבלאות נמצאות תחת schema ספציפי — יש להוסיף prefix לשאילתות (לדוגמה: <code style={{ background: '#fff3e0', padding: '1px 6px', borderRadius: '4px', fontFamily: FONT_MONO }}>TD.TEST</code>)</li>
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
                    <div style={{ fontWeight: 'bold', fontSize: '17px', color: isEnabled ? C.statusDone : C.textSecondary }}>
                      {isEnabled ? 'שליחת מייל מופעלת' : 'שליחת מייל מושבתת'}
                    </div>
                    <div style={{ fontSize: '15px', color: C.textMuted, marginTop: '2px' }}>
                      הגדר <code style={{ fontFamily: FONT_MONO }}>EMAIL_ENABLED = true</code> להפעלה
                    </div>
                  </div>
                </div>

                <div style={{ background: C.bgCard, borderRadius: '12px', padding: '20px 24px', border: `1px solid ${C.border}` }}>
                  <div style={{ fontWeight: 'bold', fontSize: '16px', color: C.textPrimary, marginBottom: '16px' }}>⚙️ הגדרות SMTP</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: C.bgNested }}>
                        {['תיאור', 'מפתח', 'ערך', 'פעולות'].map(h => (
                          <th key={h} style={{ padding: '9px 14px', textAlign: 'right', fontSize: '14px', color: C.textSecondary, fontWeight: 'bold', border: `1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {emailParams.map(p => (
                        <tr key={p.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '10px 14px', fontSize: '15px', fontWeight: 'bold', color: C.textPrimary, border: `1px solid ${C.border}` }}>{p.label}</td>
                          <td style={{ padding: '10px 14px', fontFamily: FONT_MONO, fontSize: '13px', color: C.textMuted, border: `1px solid ${C.border}` }}>{p.key}</td>
                          <td style={{ padding: '10px 14px', border: `1px solid ${C.border}`, minWidth: '240px' }}>
                            {editingParam === p.key ? (
                              <input
                                autoFocus
                                type={p.type === 'password' ? 'password' : 'text'}
                                value={paramValue}
                                onChange={e => setParamValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveParam(p.key); if (e.key === 'Escape') setEditingParam(null); }}
                                style={{ width: '100%', padding: '5px 9px', border: `2px solid ${C.brand}`, borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box', direction: 'ltr', background: C.bgNested, color: C.textPrimary, fontFamily: FONT_MONO }}
                              />
                            ) : (
                              <span style={{ fontSize: '15px', color: p.value ? C.textPrimary : C.textMuted, fontStyle: p.value ? 'normal' : 'italic', direction: 'ltr', display: 'inline-block', fontFamily: p.value ? FONT_MONO : FONT }}>
                                {p.type === 'password' && p.value ? '••••••••' : (p.value || 'לא הוגדר')}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '8px 14px', border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                            {editingParam === p.key ? (
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={() => saveParam(p.key)} disabled={savingParam}
                                  style={{ padding: '4px 12px', background: savingParam ? C.bgHover : C.statusDone, color: savingParam ? C.textDisabled : 'white', border: 'none', borderRadius: '6px', cursor: savingParam ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 'bold', fontFamily: FONT }}>
                                  {savingParam ? '...' : 'שמור'}
                                </button>
                                <button onClick={() => { setEditingParam(null); setParamError(null); }}
                                  style={{ padding: '4px 10px', background: C.bgHover, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontFamily: FONT }}>
                                  ביטול
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => { setEditingParam(p.key); setParamValue(p.value); setParamError(null); }}
                                style={{ padding: '4px 12px', background: C.brand, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontFamily: FONT }}>
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
                  <div style={{ fontWeight: 'bold', fontSize: '16px', color: C.textPrimary, marginBottom: '12px' }}>🔌 בדיקת שליחה</div>
                  <p style={{ fontSize: '15px', color: C.textSecondary, margin: '0 0 14px' }}>
                    שולח מייל בדיקה לרשימת התפוצה המוגדרת ב-<code style={{ fontFamily: FONT_MONO }}>EMAIL_DISTRIBUTION_LIST</code>.
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <button
                      onClick={testEmailConfig}
                      disabled={emailTesting || !isEnabled}
                      style={{
                        padding: '9px 22px', background: emailTesting ? C.bgHover : !isEnabled ? C.bgHover : '#2980b9',
                        color: (emailTesting || !isEnabled) ? C.textDisabled : 'white', border: 'none', borderRadius: '8px',
                        cursor: (emailTesting || !isEnabled) ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '15px', fontFamily: FONT,
                      }}
                    >
                      {emailTesting ? 'שולח...' : '📤 שלח מייל בדיקה'}
                    </button>
                    {!isEnabled && <span style={{ fontSize: '14px', color: C.textMuted }}>יש להפעיל EMAIL_ENABLED תחילה</span>}
                    {emailTestResult && (
                      <div style={{
                        padding: '8px 16px', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold',
                        background: emailTestResult.success ? C.bgDone : C.bgBlocked,
                        color: emailTestResult.success ? C.statusDone : C.statusFailed,
                      }}>
                        {emailTestResult.success ? '✓' : '✕'} {emailTestResult.message}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ background: C.bgNested, borderRadius: '12px', padding: '20px', border: `1px solid ${C.border}`, fontSize: '15px', color: C.textSecondary, lineHeight: '1.7' }}>
                  <strong style={{ color: C.textPrimary, display: 'block', marginBottom: '8px' }}>הגדרות SMTP נפוצות:</strong>
                  <ul style={{ margin: 0, paddingRight: '20px' }}>
                    <li>Gmail: <code style={{ fontFamily: FONT_MONO }}>HOST=smtp.gmail.com, PORT=587, SECURE=false</code> — נדרש App Password</li>
                    <li>Outlook/Office365: <code style={{ fontFamily: FONT_MONO }}>HOST=smtp.office365.com, PORT=587, SECURE=false</code></li>
                    <li>שרת פנימי: <code style={{ fontFamily: FONT_MONO }}>HOST=mail.corp.local, PORT=25, SECURE=false</code> (ללא משתמש/סיסמה)</li>
                    <li><code style={{ fontFamily: FONT_MONO }}>EMAIL_DISTRIBUTION_LIST</code> — רשימת נמענים מופרדת בפסיקים</li>
                  </ul>
                  <div style={{ marginTop: '12px', background: '#fff8e1', borderRadius: '8px', padding: '12px 16px', border: '1px solid #ffe082' }}>
                    <strong style={{ color: '#795548', display: 'block', marginBottom: '8px', fontSize: '15px' }}>🔥 דרישות Firewall</strong>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                      <thead>
                        <tr style={{ background: '#fff3e0' }}>
                          {['כיוון', 'מקור', 'יעד', 'פורט / פרוטוקול', 'מטרה'].map(h => (
                            <th key={h} style={{ padding: '6px 10px', textAlign: 'right', color: '#5d4037', fontWeight: 'bold', border: '1px solid #ffcc80' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { dir: 'יוצא ←', src: 'שרת DeployCenter (Backend)', dst: 'שרת SMTP (EMAIL_HOST)', port: 'TCP 587 / 465 / 25', purpose: 'שליחת הודעות אימייל' },
                        ].map((r, i) => (
                          <tr key={i}>
                            <td style={{ padding: '6px 10px', border: '1px solid #ffcc80', fontWeight: 'bold', color: '#e65100', whiteSpace: 'nowrap' }}>{r.dir}</td>
                            <td style={{ padding: '6px 10px', border: '1px solid #ffcc80', fontFamily: FONT_MONO, fontSize: '13px' }}>{r.src}</td>
                            <td style={{ padding: '6px 10px', border: '1px solid #ffcc80', fontFamily: FONT_MONO, fontSize: '13px' }}>{r.dst}</td>
                            <td style={{ padding: '6px 10px', border: '1px solid #ffcc80', fontWeight: 'bold', whiteSpace: 'nowrap', fontFamily: FONT_MONO }}>{r.port}</td>
                            <td style={{ padding: '6px 10px', border: '1px solid #ffcc80', color: '#555' }}>{r.purpose}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}

          {tab === 'notifications' && (() => {
            const notifParams = systemParams.filter(p => p.key.startsWith('TEAMS_') || p.key.startsWith('TELEGRAM_'));
            const getP = (key: string) => notifParams.find(p => p.key === key)?.value ?? '';
            const teamsEnabled   = getP('TEAMS_ENABLED')   === 'true';
            const teamsBotEnabled = getP('TEAMS_BOT_ENABLED') === 'true';
            const telegramEnabled = getP('TELEGRAM_ENABLED') === 'true';

            const channelCard = (
              opts: {
                icon: string; title: string; subtitle: string;
                enabledKey: string; enabled: boolean;
                fields: { key: string; label: string; placeholder: string; isPassword?: boolean }[];
                channel?: 'teams' | 'telegram';
                helpNode?: React.ReactNode;
              }
            ) => {
              const res = opts.channel ? notifTestResult[opts.channel] : undefined;
              const isTesting = notifTesting === opts.channel;
              return (
                <div style={{ background: opts.enabled ? C.bgDone : C.bgCard, borderRadius: '12px', padding: '20px 24px', border: `2px solid ${opts.enabled ? C.statusDone : C.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
                    <span style={{ fontSize: '32px' }}>{opts.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', fontSize: '17px', color: opts.enabled ? C.statusDone : C.textSecondary }}>{opts.title}</div>
                      <div style={{ fontSize: '15px', color: C.textMuted, marginTop: '2px' }}>{opts.subtitle}</div>
                    </div>
                    <div style={{ fontSize: '14px', color: C.textMuted, textAlign: 'left' }}>
                      ערך: <code style={{ fontFamily: FONT_MONO }}>{opts.enabledKey}</code>
                    </div>
                  </div>

                  <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '14px' }}>
                    <thead>
                      <tr style={{ background: C.bgNested }}>
                        {['תיאור', 'מפתח', 'ערך', 'פעולות'].map(h => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: 'right', fontSize: '14px', color: C.textSecondary, fontWeight: 'bold', border: `1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {notifParams.filter(p => p.key === opts.enabledKey || opts.fields.some(f => f.key === p.key)).map(p => (
                        <tr key={p.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '9px 12px', fontSize: '15px', fontWeight: 'bold', color: C.textPrimary, border: `1px solid ${C.border}` }}>{p.label}</td>
                          <td style={{ padding: '9px 12px', fontFamily: FONT_MONO, fontSize: '13px', color: C.textMuted, border: `1px solid ${C.border}` }}>{p.key}</td>
                          <td style={{ padding: '9px 12px', border: `1px solid ${C.border}`, minWidth: '220px' }}>
                            {editingParam === p.key ? (
                              <input autoFocus
                                type={opts.fields.find(f => f.key === p.key)?.isPassword ? 'password' : 'text'}
                                value={paramValue}
                                onChange={e => setParamValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveParam(p.key); if (e.key === 'Escape') setEditingParam(null); }}
                                placeholder={opts.fields.find(f => f.key === p.key)?.placeholder || ''}
                                style={{ width: '100%', padding: '5px 9px', border: `2px solid ${C.brand}`, borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box', direction: 'ltr', background: C.bgNested, color: C.textPrimary, fontFamily: FONT_MONO }}
                              />
                            ) : (
                              <span style={{ fontSize: '15px', color: p.value ? C.textPrimary : C.textMuted, fontStyle: p.value ? 'normal' : 'italic', direction: 'ltr', display: 'inline-block', fontFamily: p.value ? FONT_MONO : FONT }}>
                                {opts.fields.find(f => f.key === p.key)?.isPassword && p.value ? '••••••••' : (p.value || 'לא הוגדר')}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '7px 12px', border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                            {editingParam === p.key ? (
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={() => saveParam(p.key)} disabled={savingParam}
                                  style={{ padding: '4px 12px', background: savingParam ? C.bgHover : C.statusDone, color: savingParam ? C.textDisabled : 'white', border: 'none', borderRadius: '6px', cursor: savingParam ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 'bold', fontFamily: FONT }}>
                                  {savingParam ? '...' : 'שמור'}
                                </button>
                                <button onClick={() => { setEditingParam(null); setParamError(null); }}
                                  style={{ padding: '4px 10px', background: C.bgHover, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontFamily: FONT }}>
                                  ביטול
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => { setEditingParam(p.key); setParamValue(p.value); setParamError(null); }}
                                style={{ padding: '4px 12px', background: C.brand, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontFamily: FONT }}>
                                ✏️ ערוך
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {opts.channel && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => testNotifChannel(opts.channel!)}
                        disabled={isTesting || !opts.enabled}
                        style={{
                          padding: '8px 20px', background: isTesting ? C.bgHover : !opts.enabled ? C.bgHover : '#2980b9',
                          color: (isTesting || !opts.enabled) ? C.textDisabled : 'white', border: 'none', borderRadius: '8px',
                          cursor: (isTesting || !opts.enabled) ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '15px', fontFamily: FONT,
                        }}
                      >
                        {isTesting ? 'שולח...' : '🔌 שלח הודעת בדיקה'}
                      </button>
                      {!opts.enabled && <span style={{ fontSize: '14px', color: C.textMuted }}>יש להפעיל {opts.enabledKey} תחילה</span>}
                      {res && (
                        <div style={{
                          padding: '7px 14px', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold',
                          background: res.ok ? C.bgDone : C.bgBlocked,
                          color: res.ok ? C.statusDone : C.statusFailed,
                        }}>
                          {res.ok ? '✓' : '✕'} {res.message}
                        </div>
                      )}
                    </div>
                  )}

                  {opts.helpNode && <div style={{ marginTop: '14px' }}>{opts.helpNode}</div>}
                </div>
              );
            };

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* ─ Web Push ─ */}
                <div style={{ background: C.bgDone, borderRadius: '12px', padding: '20px 24px', border: `2px solid ${C.statusDone}`, display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <span style={{ fontSize: '32px' }}>🔔</span>
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '17px', color: C.statusDone }}>Web Push — פעיל תמיד</div>
                    <div style={{ fontSize: '15px', color: C.textMuted, marginTop: '2px' }}>
                      הודעות דחיפה לדפדפן. עובד ללא הגדרה נוספת — כל המשתמשים שאישרו הרשאות יקבלו התראות.
                    </div>
                    <div style={{ marginTop: '10px', background: '#fff8e1', borderRadius: '8px', padding: '10px 14px', border: '1px solid #ffe082' }}>
                      <strong style={{ color: '#795548', display: 'block', marginBottom: '6px', fontSize: '14px' }}>🔥 דרישות Firewall</strong>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                          <tr style={{ background: '#fff3e0' }}>
                            {['כיוון', 'מקור', 'יעד', 'פורט', 'מטרה'].map(h => (
                              <th key={h} style={{ padding: '5px 8px', textAlign: 'right', color: '#5d4037', fontWeight: 'bold', border: '1px solid #ffcc80' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { dir: 'יוצא ←', src: 'DeployCenter Backend', dst: 'fcm.googleapis.com', port: 'TCP 443', purpose: 'Web Push — Chrome' },
                            { dir: 'יוצא ←', src: 'DeployCenter Backend', dst: 'updates.push.services.mozilla.com', port: 'TCP 443', purpose: 'Web Push — Firefox' },
                          ].map((r, i) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fff8e1' }}>
                              <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', fontWeight: 'bold', color: '#e65100', whiteSpace: 'nowrap' }}>{r.dir}</td>
                              <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', fontFamily: FONT_MONO, fontSize: '12px' }}>{r.src}</td>
                              <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', fontFamily: FONT_MONO, fontSize: '12px' }}>{r.dst}</td>
                              <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', fontWeight: 'bold', whiteSpace: 'nowrap', fontFamily: FONT_MONO }}>{r.port}</td>
                              <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', color: '#555' }}>{r.purpose}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* ─ Microsoft Teams ─ */}
                {channelCard({
                  icon: '💬', title: 'Microsoft Teams', subtitle: teamsEnabled ? 'ערוץ פעיל — הודעות נשלחות לצ\'אט' : 'ערוץ מושבת',
                  enabledKey: 'TEAMS_ENABLED', enabled: teamsEnabled, channel: 'teams',
                  fields: [
                    { key: 'TEAMS_WEBHOOK_URL', label: 'Webhook URL', placeholder: 'https://outlook.office.com/webhook/...' },
                  ],
                  helpNode: (
                    <div style={{ background: C.bgNested, borderRadius: '8px', padding: '14px 18px', fontSize: '15px', color: C.textSecondary, lineHeight: '1.7' }}>
                      <strong style={{ color: C.textPrimary, display: 'block', marginBottom: '6px' }}>כיצד לקבל Webhook URL:</strong>
                      <ol style={{ margin: 0, paddingRight: '20px' }}>
                        <li>בנד ב-Teams, פתח את הערוץ הרצוי ← <strong>⋯ (More options)</strong> ← <strong>Connectors</strong></li>
                        <li>חפש <strong>Incoming Webhook</strong> ← לחץ <strong>Configure</strong></li>
                        <li>תן שם (למשל: "DeployCenter") ← לחץ <strong>Create</strong></li>
                        <li>העתק את ה-URL שנוצר ← לחץ <strong>Done</strong></li>
                        <li>הדבק את ה-URL בשדה TEAMS_WEBHOOK_URL למעלה</li>
                      </ol>
                      <div style={{ marginTop: '10px', background: '#fff8e1', borderRadius: '8px', padding: '10px 14px', border: '1px solid #ffe082' }}>
                        <strong style={{ color: '#795548', display: 'block', marginBottom: '6px', fontSize: '14px' }}>🔥 דרישות Firewall</strong>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                          <thead>
                            <tr style={{ background: '#fff3e0' }}>
                              {['כיוון', 'מקור', 'יעד', 'פורט', 'מטרה'].map(h => (
                                <th key={h} style={{ padding: '5px 8px', textAlign: 'right', color: '#5d4037', fontWeight: 'bold', border: '1px solid #ffcc80' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              { dir: 'יוצא ←', src: 'DeployCenter Backend', dst: '*.office.com / *.office365.com', port: 'TCP 443', purpose: 'שליחה דרך Teams Webhook' },
                            ].map((r, i) => (
                              <tr key={i}>
                                <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', fontWeight: 'bold', color: '#e65100', whiteSpace: 'nowrap' }}>{r.dir}</td>
                                <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', fontFamily: FONT_MONO, fontSize: '12px' }}>{r.src}</td>
                                <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', fontFamily: FONT_MONO, fontSize: '12px' }}>{r.dst}</td>
                                <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', fontWeight: 'bold', whiteSpace: 'nowrap', fontFamily: FONT_MONO }}>{r.port}</td>
                                <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', color: '#555' }}>{r.purpose}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ),
                })}

                {/* ─ Microsoft Teams Bot (פעולות אינטראקטיביות) ─ */}
                {channelCard({
                  icon: '🤖', title: 'Teams Bot — פעולות אינטראקטיביות (התחל/סיים/חסום)',
                  subtitle: teamsBotEnabled ? 'הבוט מוגדר — כפתורי פעולה יופיעו בכרטיסי המשימה ב-Teams' : 'דורש הקמת Bot ב-Azure לפני הפעלה',
                  enabledKey: 'TEAMS_BOT_ENABLED', enabled: teamsBotEnabled,
                  fields: [
                    { key: 'TEAMS_BOT_APP_ID',       label: 'Application (client) ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
                    { key: 'TEAMS_BOT_APP_PASSWORD', label: 'Client Secret',            placeholder: '••••••••', isPassword: true },
                  ],
                  helpNode: (
                    <div style={{ background: C.bgNested, borderRadius: '8px', padding: '14px 18px', fontSize: '15px', color: C.textSecondary, lineHeight: '1.7' }}>
                      <div style={{ marginBottom: '10px', background: '#e3f2fd', borderRadius: '8px', padding: '10px 14px', border: '1px solid #90caf9' }}>
                        <strong style={{ color: '#1565c0' }}>שונה מה-Webhook למעלה:</strong> זה חלק נפרד שדורש הקמת משאב ב-Azure (לא רק שדה ב-Teams). בלי זה, הכפתורים לא יעבדו — ה-Webhook הרגיל ממשיך לשלוח הודעות טקסט בלבד.
                      </div>
                      <strong style={{ color: C.textPrimary, display: 'block', marginBottom: '6px' }}>הקמה חד-פעמית (דורש הרשאות Azure AD + Azure Bot Service):</strong>
                      <ol style={{ margin: 0, paddingRight: '20px' }}>
                        <li>ב-<a href="https://portal.azure.com" target="_blank" rel="noreferrer" style={{ color: C.brand }}>Azure Portal</a> ← <strong>Azure Active Directory (Entra ID)</strong> ← <strong>App registrations</strong> ← <strong>New registration</strong> (שם: "DeployCenter Bot")</li>
                        <li>העתק את <strong>Application (client) ID</strong> שנוצר ← הדבק בשדה למעלה</li>
                        <li>באפליקציה שנוצרה ← <strong>Certificates &amp; secrets</strong> ← <strong>New client secret</strong> ← העתק את הערך (מוצג פעם אחת בלבד!) ← הדבק בשדה Client Secret למעלה</li>
                        <li>ב-Azure Portal ← צור משאב חדש מסוג <strong>Azure Bot</strong> ← שייך אותו לאפליקציה שנוצרה (Type: Multi Tenant / App ID קיים)</li>
                        <li>במשאב ה-Bot ← <strong>Configuration</strong> ← <strong>Messaging endpoint</strong> — הזן:
                          <div style={{ marginTop: '4px' }}>
                            <code style={{ fontFamily: FONT_MONO, background: 'white', padding: '3px 8px', borderRadius: '4px', border: `1px solid ${C.border}`, direction: 'ltr', display: 'inline-block' }}>
                              https://&lt;הכתובת-הציבורית-של-השרת&gt;/notifications/teams/bot/messages
                            </code>
                          </div>
                        </li>
                        <li>במשאב ה-Bot ← <strong>Channels</strong> ← הוסף ערוץ <strong>Microsoft Teams</strong></li>
                        <li>ב-<a href="https://admin.teams.microsoft.com" target="_blank" rel="noreferrer" style={{ color: C.brand }}>Teams Admin Center</a> — ודא שמדיניות הארגון מאפשרת התקנת אפליקציות מותאמות-אישית (custom apps), ואז התקן/הוסף את הבוט לערוץ הרצוי</li>
                        <li>הפעל את <strong>TEAMS_BOT_ENABLED</strong> למעלה</li>
                      </ol>
                      <div style={{ marginTop: '10px', fontSize: '14px', color: C.textMuted }}>
                        זיהוי משתמש: הבוט מזהה מי לחץ על הכפתור לפי כתובת המייל שלו ב-Teams ומשווה מול טבלת המשתמשים הקיימת — אין צורך בשיוך ידני לכל משתמש.
                      </div>
                      <div style={{ marginTop: '10px', background: '#fff8e1', borderRadius: '8px', padding: '10px 14px', border: '1px solid #ffe082' }}>
                        <strong style={{ color: '#795548', display: 'block', marginBottom: '6px', fontSize: '14px' }}>🔥 דרישות Firewall</strong>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                          <thead>
                            <tr style={{ background: '#fff3e0' }}>
                              {['כיוון', 'מקור', 'יעד', 'פורט', 'מטרה'].map(h => (
                                <th key={h} style={{ padding: '5px 8px', textAlign: 'right', color: '#5d4037', fontWeight: 'bold', border: '1px solid #ffcc80' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              { dir: 'יוצא ←', src: 'DeployCenter Backend', dst: 'login.botframework.com / login.microsoftonline.com', port: 'TCP 443', purpose: 'אימות ואסימוני גישה ל-Bot Framework' },
                              { dir: 'יוצא ←', src: 'DeployCenter Backend', dst: 'smba.trafficmanager.net (או serviceUrl של השיחה)', port: 'TCP 443', purpose: 'שליחת/עדכון כרטיסים ב-Teams' },
                              { dir: 'נכנס ←', src: 'Bot Framework (Azure)', dst: 'DeployCenter Backend', port: 'TCP 443', purpose: 'קבלת פעולות כפתור (Start/Complete/Block)' },
                            ].map((r, i) => (
                              <tr key={i}>
                                <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', fontWeight: 'bold', color: '#e65100', whiteSpace: 'nowrap' }}>{r.dir}</td>
                                <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', fontFamily: FONT_MONO, fontSize: '12px' }}>{r.src}</td>
                                <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', fontFamily: FONT_MONO, fontSize: '12px' }}>{r.dst}</td>
                                <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', fontWeight: 'bold', whiteSpace: 'nowrap', fontFamily: FONT_MONO }}>{r.port}</td>
                                <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', color: '#555' }}>{r.purpose}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ),
                })}

                {/* ─ Telegram ─ */}
                {channelCard({
                  icon: '✈️', title: 'Telegram Bot', subtitle: telegramEnabled ? 'ערוץ פעיל — הודעות נשלחות לצ\'אט' : 'ערוץ מושבת',
                  enabledKey: 'TELEGRAM_ENABLED', enabled: telegramEnabled, channel: 'telegram',
                  fields: [
                    { key: 'TELEGRAM_BOT_TOKEN', label: 'Bot Token', placeholder: '123456789:AAF...', isPassword: true },
                    { key: 'TELEGRAM_CHAT_ID',   label: 'Chat ID',   placeholder: '-1001234567890 (קבוצה) או 123456 (פרטי)' },
                  ],
                  helpNode: (
                    <div style={{ background: C.bgNested, borderRadius: '8px', padding: '14px 18px', fontSize: '15px', color: C.textSecondary, lineHeight: '1.7' }}>
                      <strong style={{ color: C.textPrimary, display: 'block', marginBottom: '6px' }}>כיצד ליצור Telegram Bot:</strong>
                      <ol style={{ margin: 0, paddingRight: '20px' }}>
                        <li>שלח הודעה ל-<strong>@BotFather</strong> בטלגרם ← <code style={{ fontFamily: FONT_MONO }}>/newbot</code></li>
                        <li>בחר שם לבוט (למשל: <em>DeployCenter Bot</em>) ← username (חייב להסתיים ב-bot)</li>
                        <li>קבל את ה-<strong>Bot Token</strong> (פורמט: <code style={{ fontFamily: FONT_MONO }}>123456:AAF...</code>)</li>
                        <li>הוסף את הבוט לקבוצה שרוצים לקבל הודעות ← הקנה לו הרשאות שליחה</li>
                        <li>לקבלת Chat ID: שלח הודעה לקבוצה, אחר כך קרא <code style={{ fontFamily: FONT_MONO }}>api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code></li>
                        <li>מצא <code style={{ fontFamily: FONT_MONO }}>"chat":&#123;"id": -1001234567890&#125;</code> — זה ה-Chat ID</li>
                      </ol>
                      <div style={{ marginTop: '10px', background: '#fff8e1', borderRadius: '8px', padding: '10px 14px', border: '1px solid #ffe082' }}>
                        <strong style={{ color: '#795548', display: 'block', marginBottom: '6px', fontSize: '14px' }}>🔥 דרישות Firewall</strong>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                          <thead>
                            <tr style={{ background: '#fff3e0' }}>
                              {['כיוון', 'מקור', 'יעד', 'פורט', 'מטרה'].map(h => (
                                <th key={h} style={{ padding: '5px 8px', textAlign: 'right', color: '#5d4037', fontWeight: 'bold', border: '1px solid #ffcc80' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              { dir: 'יוצא ←', src: 'DeployCenter Backend', dst: 'api.telegram.org', port: 'TCP 443', purpose: 'שליחה דרך Telegram Bot API' },
                            ].map((r, i) => (
                              <tr key={i}>
                                <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', fontWeight: 'bold', color: '#e65100', whiteSpace: 'nowrap' }}>{r.dir}</td>
                                <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', fontFamily: FONT_MONO, fontSize: '12px' }}>{r.src}</td>
                                <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', fontFamily: FONT_MONO, fontSize: '12px' }}>{r.dst}</td>
                                <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', fontWeight: 'bold', whiteSpace: 'nowrap', fontFamily: FONT_MONO }}>{r.port}</td>
                                <td style={{ padding: '5px 8px', border: '1px solid #ffcc80', color: '#555' }}>{r.purpose}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ),
                })}
              </div>
            );
          })()}

          {/* ── QUALITY HUB TAB ── */}
          {tab === 'quality-hub' && (() => {
            const uploadCard = (opts: {
              title: string; subtitle: string; target: 'definitions' | 'scores';
              file: File | null; setFile: (f: File | null) => void;
            }) => {
              const inputId = `qh-file-${opts.target}`;
              const isImporting = qhImporting === opts.target;
              const result = qhResult?.target === opts.target ? qhResult : null;
              return (
                <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px', border: `1px solid ${C.border}`, flex: 1, minWidth: '340px' }}>
                  <h3 style={{ margin: '0 0 4px', color: C.textPrimary }}>{opts.title}</h3>
                  <p style={{ margin: '0 0 16px', fontSize: '15px', color: C.textMuted }}>{opts.subtitle}</p>
                  <div
                    style={{ border: `2px dashed ${C.border}`, borderRadius: '8px', padding: '24px', textAlign: 'center', background: C.bgNested, cursor: 'pointer' }}
                    onClick={() => document.getElementById(inputId)?.click()}
                  >
                    <div style={{ fontSize: '32px', marginBottom: '6px' }}>📊</div>
                    {opts.file ? (
                      <div>
                        <div style={{ fontWeight: 'bold', color: C.textPrimary, fontSize: '15px' }}>{opts.file.name}</div>
                        <div style={{ color: C.textMuted, fontSize: '13px', marginTop: '2px' }}>{(opts.file.size / 1024).toFixed(1)} KB</div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ color: C.textMuted, fontSize: '14px' }}>לחץ לבחירת קובץ</div>
                        <div style={{ color: C.textDisabled, fontSize: '13px', marginTop: '2px' }}>xlsx, xls — עד 10MB</div>
                      </div>
                    )}
                  </div>
                  <input
                    id={inputId}
                    type="file"
                    accept=".xlsx,.xls"
                    style={{ display: 'none' }}
                    onChange={e => opts.setFile(e.target.files?.[0] || null)}
                  />
                  <button
                    onClick={() => importQualityHubFile(opts.target)}
                    disabled={!opts.file || isImporting}
                    style={{
                      marginTop: '14px', width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
                      background: !opts.file || isImporting ? C.textDisabled : C.brand, color: '#fff',
                      fontWeight: 'bold', fontSize: '15px', cursor: !opts.file || isImporting ? 'default' : 'pointer',
                    }}
                  >
                    {isImporting ? 'מייבא...' : 'ייבא קובץ'}
                  </button>
                  {result && (
                    <div style={{
                      marginTop: '12px', padding: '10px 12px', borderRadius: '6px', fontSize: '14px',
                      background: result.success ? C.bgDone : C.bgBlocked,
                      color: result.success ? C.statusDone : C.statusFailed,
                      border: `1px solid ${result.success ? C.statusDone : C.statusFailed}44`,
                    }}>
                      {result.success ? '✅ ' : '⚠️ '}{result.message}
                    </div>
                  )}
                </div>
              );
            };

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ background: C.bgCard, borderRadius: '12px', padding: '20px 24px', border: `1px solid ${C.border}` }}>
                  <h3 style={{ margin: '0 0 4px', color: C.textPrimary }}>🏆 ייבוא נתוני איכות גרסה</h3>
                  <p style={{ margin: 0, fontSize: '15px', color: C.textMuted }}>
                    מודל ציון האיכות מחושב מחוץ ל-DeployCenter (Excel מה-QC). כאן רק מייבאים את הקבצים — לא משנים נוסחאות או משקלים.
                    ייבוא חוזר מעדכן (upsert) רשומות קיימות ומוסיף חדשות.
                  </p>
                </div>

                <div style={{ background: C.bgCard, borderRadius: '12px', padding: '20px 24px', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '260px' }}>
                    <h3 style={{ margin: '0 0 4px', color: C.textPrimary }}>🔄 ייבוא אוטומטי מהשרת</h3>
                    <p style={{ margin: 0, fontSize: '15px', color: C.textMuted }}>
                      הקבצים נטענים אוטומטית כל לילה מאותו נתיב שרת בו נמצא קובץ ה-CR_LIST (ללא בחירת קובץ ידנית).
                      ניתן גם להריץ ייבוא מיידי בלחיצת כפתור.
                    </p>
                  </div>
                  <button
                    onClick={importQualityHubFromServer}
                    disabled={qhServerImporting}
                    style={{
                      padding: '10px 20px', borderRadius: '8px', border: 'none', whiteSpace: 'nowrap',
                      background: qhServerImporting ? C.textDisabled : C.brand, color: '#fff',
                      fontWeight: 'bold', fontSize: '15px', cursor: qhServerImporting ? 'default' : 'pointer',
                    }}
                  >
                    {qhServerImporting ? 'מייבא...' : '🔄 ייבא מהשרת עכשיו'}
                  </button>
                  {qhServerResult && (
                    <div style={{
                      width: '100%', padding: '10px 12px', borderRadius: '6px', fontSize: '14px',
                      background: qhServerResult.success ? C.bgDone : C.bgBlocked,
                      color: qhServerResult.success ? C.statusDone : C.statusFailed,
                      border: `1px solid ${qhServerResult.success ? C.statusDone : C.statusFailed}44`,
                    }}>
                      {qhServerResult.success ? '✅ ' : '⚠️ '}{qhServerResult.message}
                    </div>
                  )}
                </div>

                <div>
                  <p style={{ margin: '0 0 12px', fontSize: '14px', color: C.textMuted }}>לחלופין ניתן להעלות קבצים ידנית:</p>
                  <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                    {uploadCard({
                      title: 'הגדרות KPI (KPI_RELEASE_SCORE_SETUP)',
                      subtitle: 'קובץ ה-12 מדדים: שם, יעד, משקל, אחראי, מטרה ותיאור',
                      target: 'definitions', file: qhDefFile, setFile: setQhDefFile,
                    })}
                    {uploadCard({
                      title: 'ציוני גרסאות (RELEASES_KPI_SCORES)',
                      subtitle: 'טבלת עובדות היסטורית: ציון בפועל לכל מדד בכל גרסה',
                      target: 'scores', file: qhScoresFile, setFile: setQhScoresFile,
                    })}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── SYSTEM PARAMS TAB ── */}
          {tab === 'params' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px', border: `1px solid ${C.border}` }}>
              <h3 style={{ margin: '0 0 4px', color: C.textPrimary }}>⚙️ פרמטרי מערכת</h3>
              <p style={{ margin: '0 0 20px', fontSize: '15px', color: C.textMuted }}>הגדרות גלובליות השולטות בתהליכים במערכת</p>
              {paramError && (
                <div style={{ background: C.bgBlocked, border: `1px solid ${C.statusFailed}44`, borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '15px', color: C.statusFailed }}>
                  ⚠️ {paramError}
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: C.bgNested }}>
                    {['תיאור', 'מפתח', 'ערך נוכחי', 'פעולות'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'right', fontSize: '14px', color: C.textSecondary, fontWeight: 'bold', border: `1px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {systemParams.filter(p => !p.key.startsWith('EMAIL_') && !p.key.startsWith('LDAP_') && !p.key.startsWith('TEAMS_') && !p.key.startsWith('TELEGRAM_') && !p.key.startsWith('ORACLE_')).map(p => (
                    <tr key={p.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '12px 14px', fontSize: '15px', fontWeight: 'bold', color: C.textPrimary, border: `1px solid ${C.border}` }}>{p.label}</td>
                      <td style={{ padding: '12px 14px', fontFamily: FONT_MONO, fontSize: '14px', color: C.textMuted, border: `1px solid ${C.border}` }}>{p.key}</td>
                      <td style={{ padding: '12px 14px', border: `1px solid ${C.border}`, minWidth: '260px' }}>
                        {editingParam === p.key ? (
                          <input
                            autoFocus
                            value={paramValue}
                            onChange={e => setParamValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveParam(p.key); if (e.key === 'Escape') setEditingParam(null); }}
                            style={{ width: '100%', padding: '6px 10px', border: `2px solid ${C.brand}`, borderRadius: '6px', fontSize: '15px', boxSizing: 'border-box', direction: 'ltr', background: C.bgNested, color: C.textPrimary, fontFamily: FONT_MONO }}
                            placeholder="הזן ערך..."
                          />
                        ) : (
                          <span style={{ fontSize: '15px', color: p.value ? C.textPrimary : C.textMuted, fontStyle: p.value ? 'normal' : 'italic', direction: 'ltr', display: 'inline-block', fontFamily: p.value ? FONT_MONO : FONT }}>
                            {p.value || 'לא הוגדר'}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                        {editingParam === p.key ? (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={() => saveParam(p.key)} disabled={savingParam}
                              style={{ padding: '5px 14px', background: savingParam ? C.bgHover : C.statusDone, color: savingParam ? C.textDisabled : 'white', border: 'none', borderRadius: '6px', cursor: savingParam ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 'bold', fontFamily: FONT }}>
                              {savingParam ? '...' : 'שמור'}
                            </button>
                            <button onClick={() => { setEditingParam(null); setParamError(null); }}
                              style={{ padding: '5px 12px', background: C.bgHover, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontFamily: FONT }}>
                              ביטול
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditingParam(p.key); setParamValue(p.value); setParamError(null); }}
                            style={{ padding: '5px 14px', background: C.brand, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontFamily: FONT }}>
                            ✏️ ערוך
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {systemParams.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ padding: '30px', textAlign: 'center', color: C.textMuted, fontSize: '15px' }}>אין פרמטרים מוגדרים</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ─ Params help section ─ */}
            <div style={{ background: C.bgNested, borderRadius: '12px', padding: '20px 24px', border: `1px solid ${C.border}`, fontSize: '15px', color: C.textSecondary, lineHeight: '1.8' }}>
              <strong style={{ color: C.textPrimary, display: 'block', marginBottom: '12px', fontSize: '15px' }}>📖 מדריך פרמטרים</strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <code style={{ fontFamily: FONT_MONO, color: C.brand }}>EXCEL_FILE_PATH</code>
                  <span style={{ marginRight: '8px' }}>— נתיב מלא לקובץ ה-Excel של הגשת פיתוחים (CR_LIST).</span>
                  <div style={{ color: C.textMuted, marginTop: '2px', paddingRight: '0' }}>
                    הנתיב חייב להיות נגיש משרת הבאק-אנד. דוגמאות: <code style={{ fontFamily: FONT_MONO, fontSize: '13px' }}>C:\Files\cr_list.xlsx</code> (Windows) · <code style={{ fontFamily: FONT_MONO, fontSize: '13px' }}>\\server\share\cr_list.xlsx</code> (UNC) · <code style={{ fontFamily: FONT_MONO, fontSize: '13px' }}>/data/cr_list.xlsx</code> (Linux/Docker).
                    הקובץ משמש לסנכרון מטלות CR וגרסאות QC (לשונית "גרסאות QC").
                  </div>
                </div>
                <div>
                  <code style={{ fontFamily: FONT_MONO, color: C.brand }}>SUMMARY_OVERRUN_THRESHOLD_MINS</code>
                  <span style={{ marginRight: '8px' }}>— ספר הדקות שמעליו דוח הסיכום מדגיש חריגת זמן.</span>
                  <div style={{ color: C.textMuted, marginTop: '2px' }}>
                    ברירת מחדל: <strong>30 דקות</strong>. אם משימה ארכה יותר מהסף הזה מהזמן המתוכנן, השורה תסומן כחריגה ומחייבת הסבר בדוח.
                  </div>
                </div>
                <div>
                  <code style={{ fontFamily: FONT_MONO, color: C.brand }}>WIZARD_AUTO_OPEN</code>
                  <span style={{ marginRight: '8px' }}>— האם לפתוח אוטומטית את אשף הכנת התוכנית בעת יצירת גרסה מתבנית.</span>
                  <div style={{ color: C.textMuted, marginTop: '2px' }}>
                    ערכים: <code style={{ fontFamily: FONT_MONO }}>true</code> / <code style={{ fontFamily: FONT_MONO }}>false</code>. ברירת מחדל: <strong>true</strong>.
                    אם <code style={{ fontFamily: FONT_MONO }}>false</code> — האשף לא יפתח אוטומטית; ניתן להפעיל אותו ידנית מתוך הגרסה.
                  </div>
                </div>
                <div>
                  <code style={{ fontFamily: FONT_MONO, color: C.brand }}>USER_DEPS_CROSS_PHASE</code>
                  <span style={{ marginRight: '8px' }}>— האם לאפשר יצירת תלויות בין-שלביות לאותו משתמש.</span>
                  <div style={{ color: C.textMuted, marginTop: '2px' }}>
                    ערכים: <code style={{ fontFamily: FONT_MONO }}>true</code> / <code style={{ fontFamily: FONT_MONO }}>false</code>. ברירת מחדל: <strong>false</strong> (תלויות בתוך שלב בלבד).
                    אפשרות זו מתאימה כשאותו אדם מבצע משימות בשלבים שונים ויש סדר ביניהם.
                  </div>
                </div>
              </div>
            </div>
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

  const groups = ['מסכים', 'פעולות — הטמעות', 'פעולות — ניהול', 'בקרת איכות'];

  const thStyle: React.CSSProperties = {
    padding: '10px 14px', fontSize: '14px', fontWeight: 'bold',
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
        <p style={{ margin: 0, fontSize: '15px', color: C.textMuted }}>סמן / בטל סימון ולחץ "שמור" בשורת התפקיד</p>
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
                    fontSize: '13px', fontWeight: 'bold', color: C.textMuted,
                    textTransform: 'uppercase', letterSpacing: '1px',
                  }}>
                    {group}
                  </td>
                </tr>
                {PERMISSION_DEFS.filter(p => p.group === group).map(perm => (
                  <tr key={perm.key}
                    onMouseEnter={e => (e.currentTarget.style.background = C.bgHover)}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <td style={{ ...tdStyle, textAlign: 'right', fontSize: '15px', color: C.textSecondary, fontWeight: '500' }}>
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
              <td style={{ ...tdStyle, fontSize: '14px', color: C.textMuted }}>שמירה</td>
              {ROLES.map(role => (
                <td key={role} style={tdStyle}>
                  <button
                    onClick={() => save(role)}
                    disabled={saving}
                    style={{
                      padding: '5px 12px', fontSize: '14px', border: 'none',
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
